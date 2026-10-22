#!/usr/bin/env node
// Collado gateway: the ONLY thing exposed to the network (via the private Traefik). Own login + RBAC, serves the shell (tabs, admin screens),
// proxies /app/* to the editable app and /_gw/ws/term to the Claude Code console, both of which live in the other container (agentd).
// Users/sessions are in GW_DIR, a volume the workbench container does not mount.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { AuthStore, AuthError, PERMISSIONS, PLATFORM_PERMS, LEGACY_ORG, parseCookies } from "./lib/auth.mjs";
import { internalKeys, safeEqual } from "./lib/agentd/keys.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 8080), BIND = env.HOST || undefined;   // HOST unset = every interface (the pod); the desktop build binds 127.0.0.1
// Desktop build (Electron): a single local person, no login screen. The program that launched us knows DESKTOP_NONCE and uses it once per start to open the window's session.
const DESKTOP = env.COLLADO_DESKTOP === "1", NONCE = env.DESKTOP_NONCE || "", APP_NAME = env.APP_DISPLAY_NAME || "Collado";
if (DESKTOP && NONCE.length < 24) { console.error("DESKTOP_NONCE is required in desktop mode"); process.exit(1); }
const GW_DIR = env.GW_DIR || "/gw";
const AGENTD = new URL(env.AGENTD_URL || "http://127.0.0.1:8081");
const APP = new URL(env.APP_URL || "http://127.0.0.1:3000");
const SECURE = env.COOKIE_SECURE !== "0";
const COOKIE = SECURE ? "__Host-collado" : "collado";
const STATIC = env.STATIC_DIR || path.join(HERE, "static");
const ALLOWED_HOSTS = (env.ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);   // empty = any Host (dev)
const auth = new AuthStore(GW_DIR, { trustProxy: env.TRUST_PROXY === "1", require2fa: env.REQUIRE_2FA === "1",
  sessionIdleMs: Number(env.SESSION_IDLE_H || 12) * 3600e3, sessionMaxMs: Number(env.SESSION_MAX_H || 168) * 3600e3 });
const KEYS = internalKeys(env.INTERNAL_KEY);   // shared with agentd; the app only gets a derived key
if (!KEYS && env.REQUIRE_INTERNAL_KEY === "1") { console.error("INTERNAL_KEY is required"); process.exit(1); }
const hostOk = (req) => !ALLOWED_HOSTS.length || ALLOWED_HOSTS.includes(String(req.headers.host || "").toLowerCase().replace(/:\d+$/, ""));

// ---- CLI (run with kubectl exec; prints nothing secret to the logs, the password goes to a 0600 file or stdout of the exec session) ---------
const [, , cmd, ...cliArgs] = process.argv;
if (cmd) {
  const opt = (n) => { const i = cliArgs.indexOf(`--${n}`); return i >= 0 ? cliArgs[i + 1] : undefined; };
  const out = opt("out");
  const emit = (text) => { if (out) { fs.writeFileSync(out, text + "\n", { mode: 0o600 }); console.log(`written to ${out}`); } else console.log(text); };
  try {
    if (cmd === "user:create" || cmd === "user:passwd") {
      const name = cliArgs[0]; if (!name || name.startsWith("--")) throw new Error(`usage: ${cmd} <user> [--roles admin,editor] [--org slug] [--super] [--out file]`);
      const roles = opt("roles")?.split(",").filter(Boolean);
      const pw = await auth.cliUpsert(name, { roles: roles || (cmd === "user:create" ? ["admin"] : undefined), org: opt("org") || LEGACY_ORG, super: cliArgs.includes("--super") });
      emit(`usuario: ${name}\ncontraseña: ${pw}\n(temporal: se pedirá cambiarla al entrar)`);
    } else if (cmd === "user:super") {
      const name = cliArgs[0], on = cliArgs[1] !== "off"; if (!name) throw new Error("usage: user:super <user> [on|off]");
      auth.setSuper(name, on); console.log(`${name}: super-admin ${on ? "activado" : "desactivado"}`);
    } else if (cmd === "org:create") {
      const [slug, ...nm] = cliArgs; if (!slug || !nm.length) throw new Error("usage: org:create <slug> <name...>");
      console.log(JSON.stringify(auth.createOrg("cli", { slug, name: nm.join(" ") })));
    } else if (cmd === "org:list") {
      for (const o of auth.listOrgs()) console.log(`${o.slug}\t${o.name}\t${o.disabled ? "DESACTIVADA" : "activa"}\t${o.users} usuarios`);
    } else if (cmd === "user:2fa-reset") {
      const name = cliArgs[0]; if (!name || !auth.db.users[name.toLowerCase()]) throw new Error("usage: user:2fa-reset <existing user>");
      auth.reset2fa("cli", name.toLowerCase()); console.log(`2FA removed for ${name}: they must enrol again at the next login`);
    } else if (cmd === "user:list") {
      for (const u of auth.listUsers()) console.log(`${u.username}\t${u.super ? "SUPER-ADMIN" : "-"}\t${u.memberships.map((o) => `${o}:${auth.rolesIn(auth.db.users[u.username], o).join("+") || "-"}`).join(",") || "sin-organización"}\t${u.disabled ? "DESACTIVADO" : "activo"}\t${u.totp ? "2fa" : "sin-2fa"}`);
    } else if (cmd === "has-users") { process.exit(auth.hasUsers() ? 0 : 1);
    } else { console.error("commands: user:create|user:passwd <user> [--roles r1,r2] [--org slug] [--super] [--out file], user:super <user> [on|off], user:2fa-reset <user>, user:list, org:create <slug> <name>, org:list, has-users"); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
  process.exit(0);
}

// ---- helpers --------------------------------------------------------------------------------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".map": "application/json", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const SHELL_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob: data:; " +
  "connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";
const baseHeaders = { "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(self), clipboard-write=(self)" };
if (SECURE) baseHeaders["strict-transport-security"] = "max-age=31536000";

const send = (res, code, body, headers = {}) => { res.writeHead(code, { ...baseHeaders, ...headers }); res.end(body); };
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), { "content-type": "application/json", "cache-control": "no-store" });
const readJson = (req, max = 100e3) => new Promise((resolve, reject) => {
  let b = ""; req.on("data", (c) => { b += c; if (b.length > max) { reject(new AuthError(413, "Cuerpo demasiado grande")); req.destroy(); } });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new AuthError(400, "JSON no válido")); } });
});
const sessionToken = (req) => parseCookies(req.headers.cookie)[COOKIE];
const sameOrigin = (req) => { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };
const setCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${SECURE ? "; Secure" : ""}; Max-Age=${maxAge}`;

function serveStatic(res, rel, csp = SHELL_CSP, req = null) {
  const file = path.normalize(path.join(STATIC, rel));
  if (!file.startsWith(STATIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, "not found", { "content-type": "text/plain" });
  const ext = path.extname(file), st = fs.statSync(file), etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  // always revalidate (ETag): a new image must never run with a stale shell.js/shell.css next to a fresh index.html
  const h = { "content-type": TYPES[ext] || "application/octet-stream", "content-security-policy": csp, "cache-control": ext === ".woff2" ? "public, max-age=31536000, immutable" : "no-cache", etag };
  if (req && req.headers["if-none-match"] === etag) return send(res, 304, "", h);
  // desktop build: the Neumorphism skin (neu.css) is switched on from here, so the web service serves exactly the same HTML as before
  if (DESKTOP && ext === ".html") return send(res, 200, fs.readFileSync(file, "utf8").replace("<html ", '<html data-skin="neu" ').replace("</head>", '<link rel="stylesheet" href="/_gw/static/neu.css">\n</head>').replace(/<script src="\/_gw\/static\/vendor\/qrcode\.js"><\/script>\n?/, "").replaceAll("Collado", APP_NAME), h);
  send(res, 200, fs.readFileSync(file), h);
}

/** Authenticated context for a request, or null. */
function ctx(req) {
  const c = auth.contextOf(sessionToken(req));
  if (!c) return null;
  return { ...c, orgName: c.org ? auth.db.orgs[c.org].name : "", token: sessionToken(req) };
}
/** Audit entry tagged with the organization it happened in. */
const aud = (c, action, detail = {}) => auth.audit(c.user.username, action, { org: c.org, ...detail });
const need = (c, perm) => { if (!c.perms.has(perm)) throw new AuthError(403, "No tienes permiso para esto"); };

async function agentd(method, p, body) {
  const r = await fetch(new URL(p, AGENTD), { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(KEYS ? { "x-collado-key": KEYS.gateway } : {}) }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(502, data.error || "El servicio del agente no responde");
  return data;
}


// ---- File manager: the person's own home, every operation runs as their system user inside agentd ----------------------------------------------
const INLINE = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
const TEXTLIKE = new Set([".txt", ".md", ".json", ".csv", ".log", ".yaml", ".yml", ".js", ".mjs", ".ts", ".css", ".py", ".sh", ".xml", ".ini", ".toml", ".sql", ".tsv", ".ics", ".html", ".htm", ".svg"]);
const attach = (name, disp = "attachment") => `${disp}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
function filesProxy(req, res, me, c, op, query, hdr) {
  const q = new URLSearchParams(query); q.set("user", me.username); q.set("perms", [...c.perms].join(","));
  const ureq = http.request(new URL(`/files/${op}?${q}`, AGENTD), { method: req.method === "PUT" ? "POST" : req.method, headers: { ...(KEYS ? { "x-collado-key": KEYS.gateway } : {}), ...(hdr || {}) } }, (ures) => {
    const h = { ...baseHeaders, "cache-control": "no-store" };
    for (const k of ["content-type"]) if (ures.headers[k]) h[k] = ures.headers[k];
    res.writeHead(ures.statusCode || 502, { ...h, ...(ures.statusCode === 200 ? res.__extra || {} : {}) }); ures.pipe(res);
  });
  ureq.on("error", () => { if (!res.headersSent) sendJson(res, 502, { error: "El servicio del agente no responde" }); else res.destroy(); });
  res.on("close", () => ureq.destroy());
  return ureq;
}
async function filesApi(req, res, url, me, c, p, m) {
  if (!c.perms.has("agent.console") && !c.perms.has("agent.shell")) throw new AuthError(403, "No tienes permiso para esto");
  const op = p.slice("files/".length), rel = url.searchParams.get("path") || "";
  if (op === "download" && m === "GET") {   // one file (inline preview for safe types) or a folder / several paths as a zip
    const paths = url.searchParams.getAll("path"), disp = url.searchParams.get("inline") ? "inline" : "attachment";
    const one = paths.length === 1 ? paths[0] : null, base = one ? path.posix.basename(one) : "";
    const ext = path.extname(base).toLowerCase();
    let st = null; if (one) st = (await agentd("GET", `/files/stat?${new URLSearchParams({ user: me.username, perms: [...c.perms].join(","), path: one })}`).catch(() => { throw new AuthError(404, "No encontrado"); }));
    aud(c, "files.download", { path: paths.join(",").slice(0, 200) });
    if (one && st && st.type === "file") {
      const inl = disp === "inline" && INLINE[ext], txt = disp === "inline" && TEXTLIKE.has(ext);
      res.__extra = { "content-type": inl || (txt ? "text/plain; charset=utf-8" : "application/octet-stream"), "content-disposition": attach(base, inl || txt ? "inline" : "attachment"),
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" };
      return filesProxy(req, res, me, c, "read", new URLSearchParams({ path: one }), {}).end();
    }
    if (!paths.length) throw new AuthError(400, "Falta la ruta");
    const name = (one ? base : "archivos") + ".zip";
    res.__extra = { "content-type": "application/zip", "content-disposition": attach(name) };
    const q = new URLSearchParams(); for (const x of paths) q.append("path", x);
    return filesProxy(req, res, me, c, "zip", q, {}).end();
  }
  if (op === "upload" && (m === "PUT" || m === "POST")) {
    if (!rel) throw new AuthError(400, "Falta la ruta");
    aud(c, "files.upload", { path: rel.slice(0, 200) });
    const q = new URLSearchParams({ path: rel }); if (url.searchParams.get("overwrite")) q.set("overwrite", "1"); if (url.searchParams.get("mkdirs")) q.set("mkdirs", "1");
    const up = filesProxy(req, res, me, c, "write", q, {}); return void req.pipe(up);
  }
  const JSON_GET = new Set(["list", "stat", "find", ...(DESKTOP ? ["abspath"] : [])]), JSON_POST = new Set(["mkdir", "touch", "rename", "copy", "trash", "restore", "rm", "emptytrash", ...(DESKTOP ? ["link"] : [])]);
  if (JSON_GET.has(op) && m === "GET") { const q = new URLSearchParams(); for (const k of ["path", "q"]) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k)); return void filesProxy(req, res, me, c, op, q, {}).end(); }
  if (JSON_POST.has(op) && m === "POST") {
    const body = await readJson(req, 200e3); aud(c, `files.${op}`, { path: String(body.path || body.from || (body.paths || body.names || [])[0] || "").slice(0, 200) });
    const ureq = filesProxy(req, res, me, c, op, "", { "content-type": "application/json" }); return void ureq.end(JSON.stringify(body));
  }
  throw new AuthError(404, "No encontrado");
}

// ---- API ------------------------------------------------------------------------------------------------------------------------------
async function api(req, res, url) {
  const p = url.pathname.slice("/_gw/api/".length), m = req.method;
  if (m !== "GET" && (req.headers["x-requested-with"] !== "collado" || !sameOrigin(req))) throw new AuthError(403, "Petición no permitida");

  if (p === "login" && m === "POST") {
    const { username, password } = await readJson(req);
    const r = await auth.login(username, password, req);
    if (r.pending) return sendJson(res, 200, { need_totp: true, pending: r.pending });
    res.setHeader("set-cookie", setCookie(r.token, Math.round(auth.sessionMaxMs / 1000)));
    return sendJson(res, 200, { user: r.user });
  }
  if (p === "login/totp" && m === "POST") {
    const { pending, code } = await readJson(req);
    const r = await auth.loginTotp(pending, code, req);
    res.setHeader("set-cookie", setCookie(r.token, Math.round(auth.sessionMaxMs / 1000)));
    return sendJson(res, 200, { user: r.user });
  }
  const c = ctx(req);
  if (!c) throw new AuthError(401, "Sesión no válida");
  const me = auth.publicUser(c.user, c.org);

  if (p === "logout" && m === "POST") {
    auth.logout(c.token); aud(c, "logout");
    res.setHeader("set-cookie", setCookie("", 0)); return sendJson(res, 200, { ok: true });
  }
  if (p === "me" && m === "GET") return sendJson(res, 200, { user: me, catalogue: PERMISSIONS, platform: PLATFORM_PERMS, org: c.org ? { slug: c.org, name: c.orgName } : null, ...(DESKTOP ? { desktop: true, appName: APP_NAME, ...(env.DESKTOP_NO_AUTOLOGIN === "1" ? { noAutoLogin: true } : {}) } : {}) });
  if (p === "me/org" && m === "POST") {   // jump to another organization (a super-admin: any; everybody else: the ones they belong to)
    const { org } = await readJson(req); const o = auth.switchOrg(c.token, String(org || ""));
    const nc = ctx(req);
    try { await agentd("POST", "/org", { user: me.username, org: o.slug, perms: [...nc.perms] }); } catch { /* no agent / no console: nothing to move */ }
    return sendJson(res, 200, { org: { slug: o.slug, name: o.name } });
  }
  if (p === "me/password" && m === "POST") {
    const { current, next } = await readJson(req);
    await auth.changeOwnPassword(me.username, current, next, c.token);
    return sendJson(res, 200, { ok: true });
  }
  if (p === "me/2fa/start" && m === "POST") return sendJson(res, 200, auth.startEnroll(me.username));
  if (p === "me/2fa/confirm" && m === "POST") { const { code } = await readJson(req); return sendJson(res, 200, { recovery: auth.confirmEnroll(me.username, code) }); }
  if (p === "me/2fa/disable" && m === "POST") { const { password } = await readJson(req); await auth.disableOwn2fa(me.username, password); return sendJson(res, 200, { ok: true }); }
  if (me.must_change) return sendJson(res, 403, { error: "Debes cambiar la contraseña antes de continuar", must_change: true });
  if (me.needs_enroll) return sendJson(res, 403, { error: "Activa la verificación en dos pasos para continuar", must_enroll: true });

  if (p === "service/status" && m === "GET") {
    if (!c.perms.has("app.view") && !c.perms.has("service.manage") && !c.perms.has("agent.console")) throw new AuthError(403, "No tienes permiso para esto");
    try { const s = await agentd("GET", `/status?user=${encodeURIComponent(me.username)}`); return sendJson(res, 200, c.perms.has("service.manage") ? s : { app: { state: s.app.state, healthy: s.app.healthy }, console: s.console }); }
    catch { return sendJson(res, 200, { app: { state: "down", healthy: false }, console: {}, agentd: false }); }
  }
  if (p === "service/logs" && m === "GET") { need(c, "service.manage"); return sendJson(res, 200, await agentd("GET", `/logs?n=${Math.min(+url.searchParams.get("n") || 200, 1500)}`)); }
  if (/^service\/(restart|rollback|reset)$/.test(p) && m === "POST") {
    need(c, "service.manage"); const action = p.split("/")[1];
    aud(c, `service.${action}`);
    return sendJson(res, 200, await agentd("POST", `/${action}`));
  }
  if (p.startsWith("files/")) return await filesApi(req, res, url, me, c, p, m);
  if (p === "agent/login-status" && m === "GET") {   // first-login tutorial: has this person logged in to Claude Code yet? (shared pod-level credentials count as logged in)
    need(c, "agent.console");
    try { const r = await agentd("GET", `/claude-status?user=${encodeURIComponent(me.username)}`); return sendJson(res, 200, { logged_in: !!(r.logged_in || r.shared), shared: !!r.shared }); }
    catch { return sendJson(res, 200, { logged_in: null }); }
  }
  if (DESKTOP && p.startsWith("agent/login")) {   // automatic Claude login (see agentd/claudelogin.mjs)
    need(c, "agent.console"); const sub = p.slice("agent/login".length) || "/status", q = `user=${encodeURIComponent(me.username)}&perms=${encodeURIComponent([...c.perms].join(","))}`;
    if (sub === "/status" && m === "GET") return sendJson(res, 200, await agentd("GET", `/claude-login?${q}`));
    if (sub === "/start" && m === "POST") { aud(c, "agent.login.start"); return sendJson(res, 200, await agentd("POST", `/claude-login?${q}`, {})); }
    if (sub === "/code" && m === "POST") { const { code } = await readJson(req, 4e3); return sendJson(res, 200, await agentd("POST", `/claude-login/code?${q}`, { code })); }
    if (sub === "/cancel" && m === "POST") return sendJson(res, 200, await agentd("POST", `/claude-login/cancel?${q}`, {}));
  }
  if (p === "agent/send" && m === "POST") {
    need(c, "agent.console");
    const { text } = await readJson(req, 40e3);
    aud(c, "agent.send", { text: String(text).slice(0, 80) });
    return sendJson(res, 200, await agentd("POST", "/send", { text, user: me.username, perms: [...c.perms], org: c.org }));
  }

  // organizations: only a super-admin creates them (and can create users in all of them)
  if (p === "orgs" || p.startsWith("orgs/")) {
    need(c, "platform.admin");
    if (p === "orgs" && m === "GET") return sendJson(res, 200, { orgs: auth.listOrgs() });
    if (p === "orgs" && m === "POST") {   // optionally with the first administrator of the new organization (temporary password, shown once)
      const b = await readJson(req); const org = auth.createOrg(me.username, b); let admin = null;
      if (b.admin?.username) admin = await auth.createUser(me.username, { username: b.admin.username, name: b.admin.name, roles: ["admin"] }, org.slug, { actorSuper: true });
      aud(c, "org.created-by", { target: org.slug });
      return sendJson(res, 201, { org, admin });
    }
    if (/^orgs\/[a-z][a-z0-9-]*$/.test(p) && m === "PATCH") return sendJson(res, 200, auth.updateOrg(me.username, p.slice(5), await readJson(req)));
  }

  // administration: users, roles, audit (of the active organization; a super-admin can name another with ?org=)
  if (p === "users" || p.startsWith("users/") || p === "roles" || p.startsWith("roles/") || p === "audit") {
    need(c, "users.manage");
    const super_ = c.perms.has("platform.admin"), org = url.searchParams.get("org") || c.org;
    if (org !== c.org && !super_) throw new AuthError(403, "No tienes permiso para esto");
    const opts = { actorSuper: super_ };
    if (p === "users" && m === "GET") return sendJson(res, 200, { users: auth.listUsers(org), org, ...(super_ ? { orgs: auth.listOrgs() } : {}) });
    if (p === "users" && m === "POST") { const b = await readJson(req); return sendJson(res, 201, await auth.createUser(me.username, b, org, opts)); }
    if (/^users\/[^/]+\/2fa-reset$/.test(p) && m === "POST") {
      const name = decodeURIComponent(p.split("/")[1]), u = auth.db.users[name];
      if (!u || (!u.memberships?.[org] && !super_)) throw new AuthError(404, "Usuario no encontrado");
      if (!super_ && (u.super || Object.keys(u.memberships || {}).some((o) => o !== org))) throw new AuthError(403, "Esta persona también pertenece a otras organizaciones; lo gestiona un super-admin");
      auth.reset2fa(me.username, name); return sendJson(res, 200, { ok: true });
    }
    if (p.startsWith("users/")) {
      const name = decodeURIComponent(p.slice(6));
      if (m === "PATCH") return sendJson(res, 200, await auth.updateUser(me.username, name, await readJson(req), org, opts));
      if (m === "DELETE") return sendJson(res, 200, auth.deleteUser(me.username, name, org, { ...opts, everywhere: url.searchParams.get("everywhere") === "1" }));
    }
    if (p === "roles" && m === "GET") return sendJson(res, 200, { roles: auth.listRoles(org), permissions: Object.fromEntries(Object.entries(PERMISSIONS).filter(([k]) => !PLATFORM_PERMS.includes(k))) });
    if (p === "roles" && m === "POST") { const b = await readJson(req); return sendJson(res, 201, auth.upsertRole(me.username, String(b.name || ""), b, true, org)); }
    if (p.startsWith("roles/")) {
      const name = decodeURIComponent(p.slice(6));
      if (m === "PUT") return sendJson(res, 200, auth.upsertRole(me.username, name, await readJson(req), false, org));
      if (m === "DELETE") { auth.deleteRole(me.username, name, org); return sendJson(res, 200, { ok: true }); }
    }
    if (p === "audit" && m === "GET") return sendJson(res, 200, { events: auth.readAudit(+url.searchParams.get("n") || 200, super_ && !url.searchParams.get("org") && url.searchParams.get("all") === "1" ? null : org) });
  }
  throw new AuthError(404, "No encontrado");
}

// ---- proxy to the app -----------------------------------------------------------------------------------------------------------------
function identityHeaders(c) {
  return { "x-collado-user": c.user.username, "x-collado-name": encodeURIComponent(c.user.name || c.user.username), "x-collado-perms": [...c.perms].join(","),
    "x-collado-roles": auth.publicUser(c.user, c.org).roles.join(","), "x-collado-org": c.org, "x-collado-org-name": encodeURIComponent(c.orgName), "x-forwarded-prefix": "/app", ...(KEYS ? { "x-collado-key": KEYS.app } : {}) };
}
function cleanHeaders(req, c) {
  if (!c.org) throw new AuthError(403, "Tu cuenta no tiene ninguna organización activa");   // never let a request reach the app without a company: it would fall back to the legacy one
  const h = { ...req.headers };
  for (const k of Object.keys(h)) if (k.startsWith("x-collado-")) delete h[k];
  const ck = parseCookies(h.cookie); delete ck[COOKIE];
  const rest = Object.entries(ck).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  if (rest) h.cookie = rest; else delete h.cookie;
  delete h["content-security-policy"];
  return { ...h, ...identityHeaders(c) };
}
const appPath = (url) => url.pathname.slice(4) + url.search || "/";   // "/app/x?y" -> "/x?y"

async function proxyApp(req, res, url, c) {
  const read = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  // writes need app.edit, or the external-access permission (the app then limits externals to comments, approvals and their own tasks)
  if (read) need(c, "app.view"); else if (!c.perms.has("app.edit") && !c.perms.has("external")) throw new AuthError(403, "No tienes permiso para esto");
  if (!read && !sameOrigin(req)) throw new AuthError(403, "Petición no permitida");
  const up = http.request({ host: APP.hostname, port: APP.port, method: req.method, path: appPath(url) || "/", headers: cleanHeaders(req, c) }, (r) => {
    const h = { ...r.headers, ...baseHeaders, "content-security-policy": APP_CSP };
    delete h["x-powered-by"];
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  up.setTimeout(120000, () => up.destroy(new Error("timeout")));
  up.on("error", async () => {
    if (res.headersSent) { res.destroy(); return; }
    let logs = "";
    if (c.perms.has("service.manage")) { try { logs = (await agentd("GET", "/logs?n=25")).lines.join("\n"); } catch { /* agentd down too */ } }
    send(res, 503, unavailablePage(logs, c.perms.has("service.manage")), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
  });
  req.pipe(up);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
function unavailablePage(logs, admin) {
  return `<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=4><meta name=viewport content="width=device-width,initial-scale=1"><title>App no disponible</title>
<style>body{font:16px system-ui;margin:0;padding:32px 16px;background:#14161a;color:#e8e6e1}main{max-width:720px;margin:auto}h1{font-size:20px}code,pre{font:13px ui-monospace,monospace}
pre{background:#0b0c0e;padding:12px;border-radius:6px;overflow:auto;max-height:50vh}</style><main><h1>La app no está respondiendo</h1>
<p>Se está reiniciando o tiene un error. Esta página se recarga sola cada pocos segundos.${admin ? " Puedes ver el registro, restaurar la última versión que funcionaba o la original desde la pestaña <b>Servicio</b>." : ""}</p>
${logs ? `<pre>${esc(logs)}</pre>` : ""}</main>`;
}

// ---- HTTP server ----------------------------------------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
    if (!hostOk(req)) return send(res, 421, "misdirected request", { "content-type": "text/plain" });
    // behind the public Traefik the plain-HTTP entrypoint reaches us too (it only serves the ACME challenge itself): never serve the app or the login in clear
    if (env.TRUST_PROXY === "1" && String(req.headers["x-forwarded-proto"] || "").split(",").pop().trim() === "http")
      return send(res, 301, "", { location: `https://${req.headers.host}${req.url}` });
    if (url.pathname.startsWith("/_gw/static/")) return serveStatic(res, url.pathname.slice("/_gw/static/".length), SHELL_CSP, req);
    if (DESKTOP && url.pathname === "/_gw/desktop-login") {
      if (req.method !== "GET" || !safeEqual(url.searchParams.get("nonce"), NONCE)) return send(res, 403, "forbidden", { "content-type": "text/plain" });
      await auth.ensureLocalUser(env.DESKTOP_USER || "usuario", env.DESKTOP_NAME || "");
      const token = auth.openLocalSession(env.DESKTOP_USER || "usuario", req);
      return send(res, 302, "", { location: "/", "set-cookie": setCookie(token, Math.round(auth.sessionMaxMs / 1000)), "cache-control": "no-store" });
    }
    if (url.pathname === "/login") {
      if (ctx(req)) return send(res, 302, "", { location: "/" });
      return serveStatic(res, "login.html");
    }
    if (url.pathname.startsWith("/_gw/api/")) {
      try { return await api(req, res, url); }
      catch (e) {
        if (e instanceof AuthError) return sendJson(res, e.status, { error: e.message });
        console.error("api error", e); return sendJson(res, 500, { error: "Error interno" });
      }
    }
    const c = ctx(req);
    if (url.pathname === "/" || url.pathname === "/index.html") return c ? serveStatic(res, "index.html") : send(res, 302, "", { location: "/login" });
    if (url.pathname === "/app") return send(res, 302, "", { location: "/app/" });
    if (url.pathname.startsWith("/app/")) {
      if (!c) return send(res, 401, "unauthorized", { "content-type": "text/plain" });
      if (c.user.must_change || auth.needsEnroll(c.user)) return send(res, 403, "account setup incomplete", { "content-type": "text/plain" });
      return await proxyApp(req, res, url, c);
    }
    send(res, 404, "not found", { "content-type": "text/plain" });
  } catch (e) {
    if (e instanceof AuthError) return sendJson(res, e.status, { error: e.message });
    console.error("request error", e); if (!res.headersSent) sendJson(res, 500, { error: "Error interno" });
  }
});

// ---- WebSocket: console (terminal) and app upgrades -----------------------------------------------------------------------------------------
const live = new Set();   // { ws, user, perm }
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
auth.onChange((ev) => {
  for (const s of live) {
    if (ev.user && ev.user !== s.user) continue;
    const cx = auth.contextOf(s.token);
    if (ev.type === "revoke" || !cx || cx.user.disabled || !cx.perms.has(s.perm)) s.ws.close(4403, "permissions changed");
  }
});
setInterval(() => { for (const s of live) if (!auth.resolve(s.token)) s.ws.close(4401, "session expired"); }, 30000).unref();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const deny = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  if (!hostOk(req)) return deny(421, "Misdirected Request");
  const c = ctx(req);
  if (!c || c.user.must_change || auth.needsEnroll(c.user)) return deny(401, "Unauthorized");
  if (!sameOrigin(req) || !req.headers.origin) return deny(403, "Forbidden");
  if (url.pathname === "/_gw/ws/term") {
    const session = url.searchParams.get("session") === "shell" ? "shell" : "claude";
    const perm = session === "shell" ? "agent.shell" : "agent.console";
    if (!c.perms.has(perm)) return deny(403, "Forbidden");
    return wss.handleUpgrade(req, socket, head, (ws) => bridgeTerminal(ws, c, session, perm, url));
  }
  if (url.pathname.startsWith("/app/")) {   // raw pipe, for apps that use WebSockets/SSE of their own
    if (!c.perms.has("app.edit") && !c.perms.has("external")) return deny(403, "Forbidden");
    const up = net.connect(Number(APP.port), APP.hostname, () => {
      const h = cleanHeaders(req, c);
      let raw = `${req.method} ${appPath(url)} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(h)) raw += `${k}: ${v}\r\n`;
      up.write(raw + "\r\n"); up.write(head); socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy()); socket.on("error", () => up.destroy());
    return;
  }
  deny(404, "Not Found");
});

function bridgeTerminal(ws, c, session, perm, url) {
  const target = new URL(`/term?session=${session}&cols=${+url.searchParams.get("cols") || 120}&rows=${+url.searchParams.get("rows") || 32}&user=${encodeURIComponent(c.user.username)}&perms=${encodeURIComponent([...c.perms].join(","))}&org=${encodeURIComponent(c.org || "")}`, AGENTD);
  target.protocol = "ws:";
  const up = new WebSocket(target, { headers: KEYS ? { "x-collado-key": KEYS.gateway } : {} });
  const entry = { ws, user: c.user.username, perm, token: c.token };
  live.add(entry);
  auth.audit(entry.user, "console.open", { session, org: c.org });
  const pending = [];
  const ping = setInterval(() => { if (ws.readyState === 1) ws.ping(); }, 25000);   // keeps idle consoles alive through proxies
  up.on("open", () => { for (const m of pending) up.send(m.data, { binary: m.isBinary }); pending.length = 0; });
  up.on("message", (data, isBinary) => { if (ws.readyState === 1) ws.send(isBinary ? data : data.toString("utf8")); });
  up.on("close", () => ws.close(1000)); up.on("error", () => ws.close(1011, "agentd unavailable"));
  ws.on("message", (data, isBinary) => { if (up.readyState === 1) up.send(data, { binary: isBinary }); else pending.push({ data, isBinary }); });
  ws.on("close", () => { clearInterval(ping); live.delete(entry); up.close(); });
}

server.listen(PORT, BIND, () => console.log(`collado gateway on ${BIND || ""}:${PORT}, auth in ${GW_DIR}, users: ${auth.listUsers().length}${DESKTOP ? " (desktop)" : ""}`));
if (!env.COLLADO_HUB) for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); process.exit(0); });   // in the hub, agentd handles shutdown
if (DESKTOP && !env.COLLADO_HUB) { process.stdin.resume(); process.stdin.on("end", () => process.exit(0)); process.stdin.on("error", () => process.exit(0)); }
