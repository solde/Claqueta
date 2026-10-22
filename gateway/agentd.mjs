#!/usr/bin/env node
// agentd: runs in the "workbench" container. Listens ONLY on 127.0.0.1 and trusts nobody by network position: the gateway authenticates with INTERNAL_KEY, the app with a
// derived key, console users with signed tokens that carry their own permissions. It owns:
//   1. one persistent Claude Code console per person (a real system user with its own /home/<user> and Claude login when running as root)
//   2. the supervisor of the editable app ($DATA/app), installed/upgraded from the image seed with a git merge
//   3. the control API (status / logs / restart / rollback / reset / send / job) used by the gateway, the app and the `collado-app` command
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { internalKeys, safeEqual, verifyToken } from "./lib/agentd/keys.mjs";
import { Users } from "./lib/agentd/users.mjs";
import { Consoles } from "./lib/agentd/console.mjs";
import { PtyConsoles } from "./lib/agentd/ptyconsole.mjs";
import { ClaudeLogin } from "./lib/agentd/claudelogin.mjs";
import { installToolLaunchers, which } from "./lib/agentd/platform.mjs";
import { spawn } from "node:child_process";
import { Supervisor } from "./lib/agentd/supervisor.mjs";
import { Jobs } from "./lib/agentd/jobs.mjs";
import { Files } from "./lib/agentd/files.mjs";
import { installOrUpgradeApp, installShared } from "./lib/agentd/upgrade.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
// COLLADO_DESKTOP=1 (Electron build): one local person on macOS / Windows / Linux, the app runs from the read-only copy bundled with the program, consoles are node-pty processes (no tmux)
const DESKTOP = env.COLLADO_DESKTOP === "1", ROOT = !DESKTOP && process.getuid?.() === 0 && env.AGENTD_FORCE_USER_MODE !== "1";
const DATA = env.DATA_DIR || "/data";
const SEED = env.SEED_DIR || "/opt/app-seed", WORK_SEED = env.WORKSPACE_SEED || path.join(SEED, "workspace");
const D = { app: DESKTOP ? path.join(SEED, "app") : path.join(DATA, "app"), appdata: path.join(DATA, "appdata"), shared: path.join(DATA, "shared"), backups: path.join(DATA, "app-backups") };
const STATE = path.join(DATA, "state"), HOMES = env.HOMES_DIR || (ROOT ? "/home" : path.join(DATA, "homes"));
const APP_PORT = Number(env.APP_PORT || 3000), PORT = Number(env.AGENTD_PORT || 8081);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const keys = internalKeys(env.INTERNAL_KEY || env.AGENTD_KEY);
if (!keys) { if (ROOT || env.AGENTD_REQUIRE_KEY === "1") { console.error("INTERNAL_KEY is required"); process.exit(1); } log("WARNING: no INTERNAL_KEY: development mode, the control API is open"); }

const apiUrl = `http://127.0.0.1:${APP_PORT}`, ctlUrl = `http://127.0.0.1:${PORT}`;
const sharedClaude = Object.fromEntries(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].filter((k) => env[k]).map((k) => [k, env[k]]));
const users = new Users({ root: ROOT, homes: HOMES, shared: D.shared, state: STATE, apiUrl, ctlUrl, tokenKey: keys?.token || "dev-token-key", log, sharedClaude, portable: DESKTOP, toolsDir: DESKTOP ? (env.TOOLS_DIR || path.join(HERE, "..", "tools")) : "", appName: env.APP_DISPLAY_NAME || "Collado" });
const APP_PASSTHROUGH = ["APP_FLAGS", "MAX_JOBS", "AGENT_JOB_CMD", "RENDER_URL", "RENDER_KEY", "COLLADO_DESKTOP", "APP_DISPLAY_NAME"];   // the only variables the app inherits from agentd
const sup = new Supervisor({ root: ROOT, dirs: D, appPort: APP_PORT, env: Object.fromEntries(APP_PASSTHROUGH.filter((k) => env[k]).map((k) => [k, env[k]])), log, keys, ctlUrl, managed: !DESKTOP });
const consoles = DESKTOP ? new PtyConsoles({ users, agentCmd: env.AGENT_BIN || "claude", shellCmd: env.SHELL_BIN || "", maxUsers: Number(env.MAX_CONSOLE_USERS || 6), idleHours: Number(env.CONSOLE_IDLE_HOURS || 12), log }) : new Consoles({ users, tmuxBin: env.TMUX_BIN || "tmux", tmuxConf: env.TMUX_CONF || path.join(HERE, "tmux.conf"), agentCmd: env.AGENT_CMD || "claude --continue || exec claude", shellCmd: env.SHELL_CMD || "bash -l",
  maxUsers: Number(env.MAX_CONSOLE_USERS || 6), idleHours: Number(env.CONSOLE_IDLE_HOURS || 12), log });
const jobs = new Jobs({ users, jobCmd: env.AGENT_JOB_CMD, log });
const files = new Files({ users, maxUploadMb: Number(env.FILES_MAX_UPLOAD_MB || 200) });

// ---- install / upgrade -------------------------------------------------------------------------------------------------------------------
for (const d of [D.shared, D.backups, STATE]) fs.mkdirSync(d, { recursive: true });
installShared({ seedWorkspace: WORK_SEED, shared: D.shared, log });
if (ROOT) { fs.chmodSync(D.shared, 0o755); fs.chmodSync(STATE, 0o700); }
if (DESKTOP) installToolLaunchers(path.join(D.shared, "bin"), env.TOOLS_DIR || path.join(HERE, "..", "tools"));
else { const how = installOrUpgradeApp({ sup, seedAppDir: path.join(SEED, "app"), appDir: D.app, log }); if (how !== "current") log(`app: ${how}`); }
sup.prepareDirs();
if (ROOT) { try { for (const f of fs.readdirSync(D.shared)) fs.chmodSync(path.join(D.shared, f), f === "TEAM.md" ? 0o664 : 0o755); fs.chownSync(path.join(D.shared, "TEAM.md"), 0, 10011); } catch { /* best effort */ } }

// ---- control API ------------------------------------------------------------------------------------------------------------------------
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = 2e6) => new Promise((res, rej) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > max) { rej(new Error("too large")); req.destroy(); } }); req.on("end", () => res(b)); });
/** Who is calling: "gateway" | "app" | { user, perms } | null. */
function who(req) {
  if (!keys) return "gateway";
  const k = req.headers["x-collado-key"]; if (k) return safeEqual(k, keys.gateway) ? "gateway" : safeEqual(k, keys.app) ? "app" : null;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || ""); if (!m) return null; return verifyToken(keys.token, m[1]);
}
const permsOf = (w, body) => (w === "gateway" || w === "app" ? body.perms || [] : w.perms);
const orgOf = (w, body, url) => (w === "gateway" ? body.org || url.searchParams.get("org") || null : null);
const userOf = (w, body, url) => (w === "gateway" || w === "app" ? body.user || url.searchParams.get("user") : w.user);
const has = (w, body, p) => w === "gateway" || (typeof w === "object" && w.perms.includes(p));
const myConsole = (u) => ({ claude: consoles.hasSession(u, "claude"), shell: consoles.hasSession(u, "shell") });
const status = (u) => ({ app: sup.status(), console: u ? myConsole(u) : {}, mode: DESKTOP ? "desktop" : ROOT ? "users" : "shared-uid", users: ROOT ? users.list().length : undefined });
/** Is this person logged in to Claude Code? Only the answer of `claude auth status` (or, without it, the EXISTENCE of the credentials file) is used, never the credentials themselves.
 *  Desktop: the login lives in the keychain (macOS) under a name derived from the person's config dir, so the CLI is the only reliable judge. Cached for a few seconds (the tutorial polls). */
const loginCache = new Map();
async function claudeLoggedIn(name, fresh = false) {
  const u = users.get(name); if (!u) return false; if (fresh) loginCache.delete(name);
  const file = () => { try { return fs.statSync(path.join(users.homeOf(name), ".claude", ".credentials.json")).size > 0; } catch { return false; } };
  if (!DESKTOP) return file();
  const hit = loginCache.get(name); if (hit && Date.now() - hit.at < 3000) return hit.ok;
  const env = users.env(u), bin = which("claude", env.PATH.split(path.delimiter)); let ok = false;
  if (bin) {
    ok = await new Promise((res) => { let out = ""; const c = spawn(bin, ["auth", "status"], { env, cwd: path.join(users.homeOf(name), "work"), stdio: ["ignore", "pipe", "ignore"] }); const t = setTimeout(() => { c.kill(); res(file()); }, 10_000);
      c.stdout.on("data", (d) => { out += d; }); c.on("error", () => { clearTimeout(t); res(file()); }); c.on("close", () => { clearTimeout(t); try { res(!!JSON.parse(out).loggedIn); } catch { res(file()); } }); });
  }
  loginCache.set(name, { ok, at: Date.now() }); return ok;
}
const claudeLogin = DESKTOP ? new ClaudeLogin({ users, isLoggedIn: claudeLoggedIn, log, onDone: (u) => consoles.reset?.(u, "claude") }) : null;   // after a login the open Claude session restarts (it would keep asking for one)
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true });
    const w = who(req); if (!w) return json(res, 401, { error: "unauthorized" });
    if (url.pathname.startsWith("/files/")) {   // file manager: gateway only; every operation runs as the person
      if (w !== "gateway") return json(res, 403, { error: "forbidden" });
      const name = url.searchParams.get("user"); if (!name) return json(res, 400, { error: "user required" });
      const u = users.ensure(name, (url.searchParams.get("perms") || "").split(",").filter(Boolean)); const op = url.pathname.slice(7), P = (k) => url.searchParams.getAll(k);
      const reply = (r) => json(res, r.status, r.body);
      if (op === "read") return files.stream(u, "read", [P("path")[0] || "", url.searchParams.get("max") || "0"], res, { "content-type": "application/octet-stream", "cache-control": "no-store" });
      if (op === "zip") return files.stream(u, "zip", P("path"), res, { "content-type": "application/zip", "cache-control": "no-store" });
      if (op === "write") return reply(await files.write(u, req, P("path")[0] || "", [...(url.searchParams.get("overwrite") ? ["--overwrite"] : []), ...(url.searchParams.get("mkdirs") ? ["--mkdirs"] : [])]));
      const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
      if (op === "link") { if (!DESKTOP) return json(res, 404, { error: "not found" }); return reply(files.link(u, body.name, body.target)); }   // desktop only: projects live in folders chosen by the person
      if (op === "abspath") { if (!DESKTOP) return json(res, 404, { error: "not found" }); return reply(files.abspath(u, P("path")[0] || "")); }
      const OPS = { list: () => [P("path")[0] || ""], stat: () => [P("path")[0] || ""], find: () => [P("path")[0] || "", url.searchParams.get("q") || ""], mkdir: () => [body.path], touch: () => [body.path], rename: () => [body.from, body.to, ...(body.overwrite ? ["--overwrite"] : [])],
        copy: () => [body.from, body.to], trash: () => body.paths, restore: () => body.names, rm: () => body.paths, emptytrash: () => [] };
      if (!OPS[op]) return json(res, 404, { error: "not found" });
      const a = OPS[op](); if (!a.every((x) => typeof x === "string" || x === undefined) || (["trash", "restore", "rm"].includes(op) && !a.length)) return json(res, 400, { error: "invalid" });
      return reply(await files.json(u, op, a.filter((x) => x !== undefined)));
    }
    const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
    if (url.pathname.startsWith("/claude-login")) {   // automatic Claude login (desktop only, gateway only)
      if (!claudeLogin) return json(res, 404, { error: "not found" }); if (w !== "gateway") return json(res, 403, { error: "forbidden" });
      const name = url.searchParams.get("user"), u = name && users.ensure(name, (url.searchParams.get("perms") || "").split(",").filter(Boolean)); if (!u) return json(res, 400, { error: "user required" });
      if (req.method === "GET") return json(res, 200, { ...claudeLogin.state(name), logged_in: await claudeLoggedIn(name) });
      if (url.pathname === "/claude-login/code") return json(res, 200, { ok: claudeLogin.code(u, body.code) });
      if (url.pathname === "/claude-login/cancel") { claudeLogin.cancel(u); return json(res, 200, { ok: true }); }
      return json(res, 200, await claudeLogin.start(u));
    }
    if (req.method === "GET" && url.pathname === "/claude-status") {   // is this person logged in to Claude Code? Only the EXISTENCE of the credentials file is checked, never its content
      if (w !== "gateway") return json(res, 403, { error: "forbidden" });
      const name = url.searchParams.get("user"), shared = "CLAUDE_CODE_OAUTH_TOKEN" in sharedClaude || "ANTHROPIC_API_KEY" in sharedClaude;
      const ok = !!name && await claudeLoggedIn(name);
      return json(res, 200, { logged_in: !!ok, shared });
    }
    if (req.method === "GET" && url.pathname === "/status") { const name = userOf(w, body, url); const u = name && users.get(name); return json(res, 200, status(u)); }
    if (req.method === "GET" && url.pathname === "/logs") { if (!has(w, body, "service.manage")) return json(res, 403, { error: "forbidden" }); return json(res, 200, { lines: sup.lines.slice(-Math.min(+url.searchParams.get("n") || 200, 1500)) }); }
    if (req.method === "POST" && ["/restart", "/rollback", "/reset"].includes(url.pathname)) {
      if (!has(w, body, "service.manage")) return json(res, 403, { error: "forbidden" });
      if (DESKTOP && url.pathname !== "/restart") return json(res, 400, { error: "En la versión de escritorio la app es de solo lectura: no hay versiones anteriores que restaurar." });
      if (url.pathname === "/restart") await sup.restart("requested");
      else if (url.pathname === "/rollback") await sup.rollback();
      else { await sup.stop(); const tar = path.join(D.backups, `app-${new Date().toISOString().replace(/[:.]/g, "-")}.tgz`); sup.sh(["tar", "-C", D.app, "--exclude=node_modules", "-czf", tar, "."]); for (const f of fs.readdirSync(D.app)) if (f !== "node_modules" && f !== ".git") fs.rmSync(path.join(D.app, f), { recursive: true, force: true }); fs.rmSync(path.join(D.app, ".collado-seed"), { force: true }); installOrUpgradeApp({ sup, seedAppDir: path.join(SEED, "app"), appDir: D.app, log }); sup.prepareDirs(); sup.s.want = true; sup.s.backoff = 1000; sup.start(); return json(res, 200, { ...status(null), backup: tar }); }
      return json(res, 200, status(null));
    }
    if (req.method === "POST" && url.pathname === "/send") {
      const name = userOf(w, body, url); const text = body.text; if (!name) return json(res, 400, { error: "user required" });
      if (typeof text !== "string" || !text.trim() || text.length > 20000) return json(res, 400, { error: "text required (max 20000 characters)" });
      const u = users.ensure(name, permsOf(w, body), orgOf(w, body, url)); users.refreshToken(u); consoles.send(u, text); return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/org") {   // the person switched organization in the portal: their agent's API token now belongs to it
      if (w !== "gateway") return json(res, 403, { error: "forbidden" });
      if (!body.user || !/^[a-z][a-z0-9-]{1,30}$/.test(body.org || "")) return json(res, 400, { error: "user and org required" });
      users.ensure(body.user, body.perms || [], body.org); return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/job") {
      if (w !== "app" && w !== "gateway") return json(res, 403, { error: "forbidden" });
      if (!body.user || typeof body.prompt !== "string") return json(res, 400, { error: "user and prompt required" });
      const ac = new AbortController(); res.on("close", () => { if (!res.writableEnded) jobs.cancel(body.id); });
      return json(res, 200, await jobs.run(body));
    }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
const clamp = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo ? Math.min(v, hi) : d);
wss.on("connection", (ws, req, url) => {
  const name = url.searchParams.get("user"), session = url.searchParams.get("session") === "shell" ? "shell" : "claude";
  let term;
  try {
    const u = users.ensure(name, (url.searchParams.get("perms") || "").split(",").filter(Boolean), url.searchParams.get("org")); users.refreshToken(u);
    term = consoles.attach(u, session, clamp(+url.searchParams.get("cols"), 20, 500, 120), clamp(+url.searchParams.get("rows"), 5, 200, 32));
  } catch (e) { ws.send(JSON.stringify({ type: "error", message: String(e.message || e) })); ws.close(1011); return; }
  term.onData((d) => { if (ws.readyState === 1) ws.send(Buffer.from(d, "utf8")); });   // terminal bytes = binary frames, control = text frames
  term.onExit(() => { try { ws.send(JSON.stringify({ type: "exit" })); } catch { /* closed */ } ws.close(1000); });
  ws.on("message", (data, isBinary) => {
    if (isBinary) { term.write(data.toString("utf8")); return; }
    try { const m = JSON.parse(data.toString("utf8")); if (m.type === "resize") term.resize(clamp(m.cols, 20, 500, 120), clamp(m.rows, 5, 200, 32)); } catch { /* ignore */ }
  });
  ws.on("close", () => { try { term.kill(); } catch { /* gone */ } });   // only kills the tmux CLIENT; the session (and Claude) keeps running
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/term" || who(req) !== "gateway") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, url));
});
setInterval(() => consoles.reap(), 10 * 60e3).unref();
setInterval(() => { for (const u of consoles.active()) users.refreshToken(u); }, 6 * 3600e3).unref();
server.listen(PORT, "127.0.0.1", () => { log(`agentd on 127.0.0.1:${PORT}; app dir ${D.app}; mode ${DESKTOP ? "desktop" : ROOT ? "one system user per person" : "single uid (development)"}`); if (!DESKTOP) sup.watch(); sup.start(); });
const shutdown = async () => { sup.s.want = false; await sup.stop(); if (DESKTOP) consoles.killAll(); process.exit(0); };
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, shutdown);
if (DESKTOP) { process.stdin.resume(); process.stdin.on("end", shutdown); process.stdin.on("error", shutdown); }   // the desktop program closes our stdin to ask for a clean stop (works on Windows, and when it crashes)
