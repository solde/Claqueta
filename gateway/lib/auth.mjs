// Users, roles (RBAC), sessions and audit log of the Collado gateway. Completely independent from the login used by the other homelab portals:
// its own store (GW_DIR/auth.json, mode 0600), its own cookie, its own passwords. Everything the admin does goes through here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Fixed catalogue of permissions (the code enforces these; roles are free combinations of them). */
export const PERMISSIONS = {
  "app.view": "Ver programas, planificación, contenidos y tareas",
  "app.edit": "Crear y editar datos de producción (sin finanzas, contratos ni datos personales)",
  "fin.view": "Ver presupuestos, gastos, facturas y tesorería",
  "fin.edit": "Crear y editar presupuestos, gastos, facturas y órdenes de compra",
  "fin.approve": "Aprobar presupuestos, órdenes de compra y facturas de proveedores",
  "legal.view": "Ver contratos, derechos, cue sheets y RGPD",
  "legal.edit": "Crear y editar contratos, derechos, cue sheets y RGPD",
  "people.view": "Ver datos personales y tarifas del equipo (DNI, IBAN, tarifas)",
  "people.edit": "Editar datos personales y tarifas del equipo",
  "external": "Acceso externo: solo ve los programas en los que es miembro y lo que se comparte con él",
  "agent.jobs": "Lanzar generaciones del agente desde la app",
  "agent.console": "Usar la consola de Claude Code (con su propio usuario de sistema y su propia sesión de Claude)",
  "agent.shell": "Usar la terminal bash propia",
  "service.manage": "Servicio (plataforma): logs, reinicio y restauración de la app; el agente puede modificar su código. Solo super-admin",
  "users.manage": "Gestionar los usuarios, roles y auditoría de su organización",
  "platform.admin": "Super-admin: gestiona las organizaciones y salta entre ellas. Solo super-admin",
};
/** Platform-level permissions: only a super-admin has them (they act on the whole service, not on one company). No role of an organization can carry them. */
export const PLATFORM_PERMS = ["service.manage", "platform.admin"];
const ALL = Object.keys(PERMISSIONS), ORG_ALL = ALL.filter((p) => !PLATFORM_PERMS.includes(p));
/** The organization that existed before multi-company support: its data stays where it was (see the app's db.mjs). */
export const LEGACY_ORG = "principal";
export const ORG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const VIEW = ["app.view", "fin.view", "legal.view", "people.view"];

export const DEFAULT_ROLES = {
  admin: { description: "Administrador de la organización: todo lo de la organización (no editable)", permissions: ORG_ALL, locked: true },
  ejecutivo: { description: "Productor ejecutivo: ve todo y aprueba", permissions: [...VIEW, "app.edit", "fin.approve", "agent.jobs", "agent.console"] },
  productor: { description: "Productor: planificación, equipo y contenidos; ve finanzas y contratos", permissions: [...VIEW, "app.edit", "agent.jobs", "agent.console"] },
  contabilidad: { description: "Contabilidad: presupuestos, gastos, facturación y tesorería", permissions: ["app.view", "fin.view", "fin.edit", "legal.view", "people.view", "agent.jobs"] },
  juridico: { description: "Jurídico: contratos, derechos y RGPD", permissions: ["app.view", "legal.view", "legal.edit", "people.view", "people.edit", "agent.jobs"] },
  rrhh: { description: "Personas: datos del equipo, tarifas y horas", permissions: ["app.view", "app.edit", "people.view", "people.edit"] },
  externo: { description: "Externo (cadena, freelance, proveedor): solo sus programas y lo que se comparte con él", permissions: ["app.view", "external"] },
  editor: { description: "Trabaja con el equipo y el agente", permissions: ["app.view", "app.edit", "agent.jobs", "agent.console"] },
  analista: { description: "Edita programas y lanza generaciones, sin consola", permissions: ["app.view", "app.edit", "agent.jobs"] },
  lector: { description: "Solo lectura", permissions: ["app.view"] },
};

const USER_RE = /^[a-z][a-z0-9._-]{1,31}$/;
const ROLE_RE = /^[a-z][a-z0-9_-]{1,31}$/;
export const MIN_PASSWORD = 10;
const SESSION_IDLE_MS = 12 * 3600e3;
const SESSION_MAX_MS = 7 * 24 * 3600e3;

// ---- TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 digits) -------------------------------------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function b32encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function b32decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/=+$/, "")) { const i = B32.indexOf(ch); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totpCode(secretB32, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secretB32)).update(msg).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
/** Counter that matches `code` within ±1 step and is newer than `last` (a code can be used once), or null. */
export function verifyTotp(secretB32, code, last = 0, now = Date.now()) {
  code = String(code || "").replace(/\s/g, ""); if (!/^\d{6}$/.test(code)) return null;
  const c0 = Math.floor(now / 30000);
  for (const c of [c0, c0 - 1, c0 + 1]) if (c > last && timingEq(totpCode(secretB32, c), code)) return c;
  return null;
}
const timingEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- password hashing (argon2id from node:crypto, no native dependency) -------------------------------------------------------------
const A2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const argon2 = (message, nonce, p = A2) => new Promise((res, rej) =>
  crypto.argon2("argon2id", { message, nonce, ...p }, (e, k) => (e ? rej(e) : res(k))));

// Electron's Node (BoringSSL) has no crypto.argon2: the desktop build falls back to scrypt (also memory-hard), tagged in the stored hash so both kinds verify.
const SC = { N: 32768, r: 8, p: 1 };
const scrypt = (message, salt, { N, r, p }) => new Promise((res, rej) => crypto.scrypt(message, salt, 32, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
let argonOk = null;   // the function exists in Electron's Node but throws ERR_CRYPTO_ARGON2_NOT_SUPPORTED: probe it once
const hasArgon2 = async () => (argonOk ??= await new Promise((res) => { try { crypto.argon2("argon2id", { message: "x", nonce: Buffer.alloc(8), memory: 64, passes: 1, parallelism: 1, tagLength: 16 }, (e) => res(!e)); } catch { res(false); } }));
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  if (!(await hasArgon2())) return `scrypt$${SC.N},${SC.r},${SC.p}$${salt.toString("base64")}$${(await scrypt(pw, salt, SC)).toString("base64")}`;
  const k = await argon2(pw, salt);
  return `argon2id$${A2.memory},${A2.passes},${A2.parallelism}$${salt.toString("base64")}$${k.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, params, salt, hash] = String(stored || "").split("$");
  if ((alg !== "argon2id" && alg !== "scrypt") || !hash) return false;
  const q = params.split(",").map(Number);
  if (alg === "argon2id" && !(await hasArgon2())) return false;
  const k = alg === "scrypt" ? await scrypt(pw, Buffer.from(salt, "base64"), { N: q[0], r: q[1], p: q[2] }) : await argon2(pw, Buffer.from(salt, "base64"), { memory: q[0], passes: q[1], parallelism: q[2], tagLength: 32 });
  const h = Buffer.from(hash, "base64");
  return k.length === h.length && crypto.timingSafeEqual(k, h);
}
let dummyHash;
async function burn(pw) { dummyHash ||= await hashPassword("dummy-password-for-timing"); await verifyPassword(pw, dummyHash); }

export function randomPassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
export function checkPasswordPolicy(pw, username = "") {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) throw new AuthError(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`);
  if (pw.length > 200) throw new AuthError(400, "Contraseña demasiado larga");
  if (username && pw.toLowerCase().includes(username.toLowerCase())) throw new AuthError(400, "La contraseña no puede contener el usuario");
}

// ---- store -----------------------------------------------------------------------------------------------------------------------------
export class AuthStore {
  constructor(dir, { trustProxy = false, require2fa = false, sessionIdleMs = SESSION_IDLE_MS, sessionMaxMs = SESSION_MAX_MS } = {}) {
    this.require2fa = require2fa; this.sessionIdleMs = sessionIdleMs; this.sessionMaxMs = sessionMaxMs; this.pending = new Map();   // pending 2FA logins: sha256(token) -> { user, until, tries }
    this.dir = dir; this.file = path.join(dir, "auth.json"); this.sessFile = path.join(dir, "sessions.json");
    this.auditFile = path.join(dir, "audit.log"); this.trustProxy = trustProxy;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = this.#load();
    this.sessions = this.#loadSessions();   // sha256(token) -> { user, created, last, ip, ua }
    this.failures = new Map();              // "user|ip" and "ip" -> { n, until }
    this.listeners = new Set();             // called with ({type, user}) on revocations/permission changes
    this.#stamp();
  }

  #load() {
    let db;
    try { db = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { db = null; }
    let dirty = false;
    if (!db) { db = { version: 2, orgs: {}, users: {} }; dirty = true; }
    if (!db.orgs) {   // v1 (one company) -> v2: everything that existed becomes the legacy organization; the old administrators become super-admins (they already controlled the whole service)
      const t = new Date().toISOString();
      db.orgs = { [LEGACY_ORG]: { slug: LEGACY_ORG, name: "Organización principal", created: t, roles: db.roles || structuredClone(DEFAULT_ROLES) } };
      for (const u of Object.values(db.users || {})) { u.memberships = { [LEGACY_ORG]: { roles: u.roles || [] } }; if ((u.roles || []).includes("admin")) u.super = true; delete u.roles; }
      delete db.roles; db.version = 2; dirty = true;
    }
    db.users ||= {};
    if (!db.orgs[LEGACY_ORG] && !Object.keys(db.orgs).length) { db.orgs[LEGACY_ORG] = { slug: LEGACY_ORG, name: "Organización principal", created: new Date().toISOString(), roles: {} }; dirty = true; }
    for (const o of Object.values(db.orgs)) {
      o.roles ||= {};
      o.roles.admin = structuredClone(DEFAULT_ROLES.admin);   // admin is always complete, whatever the file says
      for (const [n, r] of Object.entries(DEFAULT_ROLES)) if (!o.roles[n]) o.roles[n] = structuredClone(r);   // new built-in roles appear on upgrade; existing ones are never touched
      for (const r of Object.values(o.roles)) if (r.permissions.some((p) => PLATFORM_PERMS.includes(p))) { r.permissions = r.permissions.filter((p) => !PLATFORM_PERMS.includes(p)); dirty = true; }
    }
    if (dirty) this.#save(db);
    return db;
  }
  #save(db = this.db) {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.#stamp();
  }
  /** The CLI (user:create, user:passwd, ...) runs in another process and edits the same files: pick its changes up before serving a login or a request. */
  #stamp() { this.mt = this.#mtimes(); }
  #mtimes() { return [this.file, this.sessFile].map((f) => { try { const t = fs.statSync(f); return `${t.mtimeMs}:${t.size}`; } catch { return "-"; } }).join("|"); }
  #sync() {
    const now = this.#mtimes();
    if (now === this.mt) return;
    this.db = this.#load(); this.sessions = this.#loadSessions(); this.mt = now;
  }
  #loadSessions() {
    try { return new Map(Object.entries(JSON.parse(fs.readFileSync(this.sessFile, "utf8")))); } catch { return new Map(); }
  }
  #saveSessions() {
    const tmp = this.sessFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 });
    fs.renameSync(tmp, this.sessFile);
    this.#stamp();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(ev) { for (const fn of this.listeners) try { fn(ev); } catch { /* listener errors never break auth */ } }

  audit(actor, action, detail = {}) {
    const line = JSON.stringify({ t: new Date().toISOString(), actor, action, ...detail }) + "\n";
    try {
      if (fs.existsSync(this.auditFile) && fs.statSync(this.auditFile).size > 2e6) fs.renameSync(this.auditFile, this.auditFile + ".1");
      fs.appendFileSync(this.auditFile, line, { mode: 0o600 });
    } catch { /* the audit log must never take the service down */ }
  }
  /** Events of one organization: those tagged with it plus account events (logins...) of its members. Without `org` (super-admin) everything. */
  readAudit(n = 200, org = null) {
    try {
      const members = org ? new Set(Object.values(this.db.users).filter((u) => u.memberships?.[org]).map((u) => u.username)) : null;
      const lines = fs.readFileSync(this.auditFile, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return lines.filter((e) => !org || e.org === org || (!e.org && members.has(e.actor))).slice(-Math.min(n, 1000)).reverse();
    } catch { return []; }
  }

  // ---- queries
  hasUsers() { return Object.keys(this.db.users).length > 0; }
  /** A super-admin sees every organization; everybody else only those they belong to. Disabled organizations are never usable. */
  accessibleOrgs(user) {
    return Object.values(this.db.orgs).filter((o) => !o.disabled && (user.super || user.memberships?.[o.slug])).map((o) => ({ slug: o.slug, name: o.name }))
      .sort((a, b) => (a.slug === LEGACY_ORG ? -1 : b.slug === LEGACY_ORG ? 1 : a.name.localeCompare(b.name)));
  }
  canUseOrg(user, slug) { return !!this.db.orgs[slug] && !this.db.orgs[slug].disabled && (!!user.super || !!user.memberships?.[slug]); }
  rolesIn(user, org) { return user.memberships?.[org]?.roles || []; }
  /** Permissions of a person INSIDE an organization (platform permissions only for super-admins, who have everything everywhere). */
  permissionsOf(user, org) {
    if (user.super) return [...ALL].sort();
    const set = new Set();
    for (const r of this.rolesIn(user, org)) for (const p of this.db.orgs[org]?.roles[r]?.permissions || []) if (p in PERMISSIONS && !PLATFORM_PERMS.includes(p)) set.add(p);
    return [...set].sort();
  }
  publicUser(u, org = this.accessibleOrgs(u)[0]?.slug) {
    return { username: u.username, name: u.name, super: !!u.super, org: org || null, orgs: this.accessibleOrgs(u), roles: [...(u.super ? ["super-admin"] : []), ...this.rolesIn(u, org)], permissions: org ? this.permissionsOf(u, org) : [],
      memberships: Object.keys(u.memberships || {}), disabled: !!u.disabled, must_change: !!u.must_change, totp: !!u.totp?.confirmed, needs_enroll: this.needsEnroll(u), created: u.created, last_login: u.last_login || null };
  }
  needsEnroll(u) { return this.require2fa && !u.totp?.confirmed; }
  /** Users of one organization (roles = their roles THERE); without `org` every user (CLI). */
  listUsers(org) {
    return Object.values(this.db.users).filter((u) => !org || u.memberships?.[org]).map((u) => ({ ...this.publicUser(u, org), orgs_of: Object.keys(u.memberships || {}) })).sort((a, b) => a.username.localeCompare(b.username));
  }
  listRoles(org) {
    const o = this.#org(org);
    return Object.entries(o.roles).map(([name, r]) => ({ name, description: r.description || "", permissions: r.permissions, locked: !!r.locked,
      users: Object.values(this.db.users).filter((u) => this.rolesIn(u, org).includes(name)).length })).sort((a, b) => a.name.localeCompare(b.name));
  }
  #org(slug) { const o = this.db.orgs[slug]; if (!o) throw new AuthError(404, "Organización no encontrada"); return o; }
  #supers(except) { return Object.values(this.db.users).filter((u) => u.super && !u.disabled && u.username !== except); }

  // ---- organizations (super-admin only: the caller checks platform.admin)
  listOrgs() {
    return Object.values(this.db.orgs).map((o) => ({ slug: o.slug, name: o.name, disabled: !!o.disabled, created: o.created, users: Object.values(this.db.users).filter((u) => u.memberships?.[o.slug]).length }))
      .sort((a, b) => (a.slug === LEGACY_ORG ? -1 : b.slug === LEGACY_ORG ? 1 : a.name.localeCompare(b.name)));
  }
  createOrg(actor, { slug, name }) {
    slug = String(slug || "").toLowerCase().trim(); name = String(name || "").trim().slice(0, 80);
    if (!ORG_RE.test(slug)) throw new AuthError(400, "Identificador no válido (2-31 caracteres: minúsculas, números y guiones; empieza por letra)");
    if (!name) throw new AuthError(400, "Falta el nombre de la organización");
    if (this.db.orgs[slug]) throw new AuthError(409, "Ya existe una organización con ese identificador");
    this.db.orgs[slug] = { slug, name, created: new Date().toISOString(), roles: structuredClone(DEFAULT_ROLES) };
    this.#save(); this.audit(actor, "org.create", { org: slug, name }); return this.listOrgs().find((o) => o.slug === slug);
  }
  updateOrg(actor, slug, patch) {
    const o = this.#org(slug);
    if (patch.name !== undefined) { const n = String(patch.name).trim().slice(0, 80); if (!n) throw new AuthError(400, "Falta el nombre"); o.name = n; }
    if (patch.disabled !== undefined) { if (slug === LEGACY_ORG && patch.disabled) throw new AuthError(409, "La organización principal no se puede desactivar"); o.disabled = !!patch.disabled; }
    this.#save(); this.audit(actor, "org.update", { org: slug, ...patch }); this.#emit({ type: "perms" }); return this.listOrgs().find((x) => x.slug === slug);
  }

  // ---- login / sessions
  clientIp(req) {
    // behind our own proxy the RIGHTMOST X-Forwarded-For entry is the one it added; everything to its left is client-controlled
    if (this.trustProxy) { const x = String(req.headers["x-forwarded-for"] || "").split(",").pop().trim(); if (x) return x; }
    return req.socket.remoteAddress || "?";
  }
  #throttle(keys) {
    const now = Date.now();
    for (const k of keys) { const f = this.failures.get(k); if (f && f.until > now) throw new AuthError(429, `Demasiados intentos. Espera ${Math.ceil((f.until - now) / 1000)} s`); }
  }
  #fail(keys, limits) {
    const now = Date.now();
    keys.forEach((k, i) => {
      const f = this.failures.get(k) || { n: 0, until: 0, first: now };
      if (now - f.first > 15 * 60e3) { f.n = 0; f.first = now; }
      f.n++;
      if (f.n >= limits[i]) f.until = now + Math.min(15 * 60e3, 30e3 * 2 ** Math.min(f.n - limits[i], 5));
      this.failures.set(k, f);
    });
    if (this.failures.size > 5000) for (const [k, f] of this.failures) if (f.until < now && now - f.first > 15 * 60e3) this.failures.delete(k);
  }

  #newSession(u, req) {
    const token = crypto.randomBytes(32).toString("base64url"), ip = this.clientIp(req);
    this.sessions.set(hashToken(token), { user: u.username, created: Date.now(), last: Date.now(), ip, ua: String(req.headers["user-agent"] || "").slice(0, 120), org: this.#lastOrg(u) });
    this.#saveSessions(); u.last_login = new Date().toISOString(); this.#save();
    this.audit(u.username, "login.ok", { ip }); return token;
  }
  #lastOrg(u) { const o = u.last_org; return o && this.canUseOrg(u, o) ? o : this.accessibleOrgs(u)[0]?.slug; }
  /** Step 1. Returns { token, user } (session) or { pending } when the user has 2FA and must still send a code. */
  async login(username, password, req) {
    this.#sync();
    const ip = this.clientIp(req);
    const keys = [`u:${String(username).toLowerCase()}|${ip}`, `ip:${ip}`];
    this.#throttle(keys);
    const u = this.db.users[String(username || "").toLowerCase()];
    const ok = u ? await verifyPassword(String(password ?? ""), u.hash) : (await burn(String(password ?? "")), false);
    if (!ok || u.disabled) {
      this.#fail(keys, [5, 30]);
      this.audit(String(username).slice(0, 40), "login.fail", { ip, reason: !u ? "unknown" : u.disabled ? "disabled" : "password" });
      throw new AuthError(401, "Usuario o contraseña incorrectos");
    }
    this.failures.delete(keys[0]);
    if (u.totp?.confirmed) {
      const token = crypto.randomBytes(24).toString("base64url");
      this.pending.set(hashToken(token), { user: u.username, until: Date.now() + 5 * 60e3, tries: 0 });
      for (const [h, p] of this.pending) if (p.until < Date.now()) this.pending.delete(h);
      return { pending: token };
    }
    return { token: this.#newSession(u, req), user: this.publicUser(u) };
  }
  /** Step 2: a TOTP code (or a one-time recovery code) for the pending login. */
  async loginTotp(pendingToken, code, req) {
    this.#sync();
    const ip = this.clientIp(req), h = hashToken(String(pendingToken || "")), p = this.pending.get(h);
    if (!p || p.until < Date.now()) { this.pending.delete(h); throw new AuthError(401, "La verificación caducó. Vuelve a introducir usuario y contraseña"); }
    const keys = [`t:${p.user}|${ip}`, `ip:${ip}`]; this.#throttle(keys);
    const u = this.db.users[p.user];
    const fail = (why) => {
      this.#fail(keys, [5, 30]); p.tries++; if (p.tries >= 5) this.pending.delete(h);
      this.audit(p.user, "login.fail", { ip, reason: why }); throw new AuthError(401, "Código incorrecto");
    };
    if (!u || u.disabled || !u.totp?.confirmed) { this.pending.delete(h); throw new AuthError(401, "Sesión no válida"); }
    const clean = String(code || "").replace(/[\s-]/g, "");
    if (/^\d{6}$/.test(clean)) {
      const c = verifyTotp(u.totp.secret, clean, u.totp.last || 0); if (c === null) return fail("totp");
      u.totp.last = c;
    } else {
      const i = (u.recovery || []).indexOf(sha(clean.toLowerCase())); if (i < 0) return fail("recovery");
      u.recovery.splice(i, 1); this.audit(u.username, "2fa.recovery.used", { left: u.recovery.length });
    }
    this.pending.delete(h); this.failures.delete(keys[0]);
    return { token: this.#newSession(u, req), user: this.publicUser(u) };
  }

  // ---- 2FA enrolment (own account)
  startEnroll(username) {
    const u = this.db.users[username]; if (u.totp?.confirmed) throw new AuthError(409, "Ya tienes la verificación en dos pasos activada");
    const secret = b32encode(crypto.randomBytes(20)); u.totp = { secret, confirmed: false }; this.#save();
    return { secret, uri: `otpauth://totp/Collado:${encodeURIComponent(username)}?secret=${secret}&issuer=Collado&algorithm=SHA1&digits=6&period=30` };
  }
  confirmEnroll(username, code) {
    const u = this.db.users[username]; if (!u.totp || u.totp.confirmed) throw new AuthError(409, "Empieza de nuevo la activación");
    const c = verifyTotp(u.totp.secret, code, 0); if (c === null) throw new AuthError(400, "El código no es correcto (comprueba la hora del móvil)");
    u.totp.confirmed = true; u.totp.last = c;
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex")); u.recovery = codes.map(sha); this.#save();
    this.audit(username, "2fa.enable"); return codes;
  }
  async disableOwn2fa(username, password) {
    if (this.require2fa) throw new AuthError(403, "La verificación en dos pasos es obligatoria en este servicio");
    const u = this.db.users[username]; if (!(await verifyPassword(String(password ?? ""), u.hash))) throw new AuthError(403, "La contraseña no es correcta");
    delete u.totp; delete u.recovery; this.#save(); this.audit(username, "2fa.disable");
  }
  reset2fa(actor, username) {
    const u = this.db.users[username]; if (!u) throw new AuthError(404, "Usuario no encontrado");
    delete u.totp; delete u.recovery; this.#save(); this.#revokeSessions(username); this.audit(actor, "2fa.reset", { user: username });
  }

  /** Resolves a session cookie token to the live user (roles are read now, so permission changes apply immediately). */
  resolve(token) {
    if (!token) return null;
    this.#sync();
    const h = hashToken(token), s = this.sessions.get(h);
    if (!s) return null;
    const now = Date.now();
    if (now - s.last > this.sessionIdleMs || now - s.created > this.sessionMaxMs) { this.sessions.delete(h); this.#saveSessions(); return null; }
    const u = this.db.users[s.user];
    if (!u || u.disabled) { this.sessions.delete(h); this.#saveSessions(); return null; }
    if (now - s.last > 60e3) { s.last = now; this.#saveSessions(); }
    return u;
  }
  /** Session -> { user, org, perms } for the ACTIVE organization (the session remembers it; falls back to another one if access was withdrawn). */
  contextOf(token) {
    const u = this.resolve(token); if (!u) return null;
    const s = this.sessions.get(hashToken(token));
    let org = s?.org; if (!org || !this.canUseOrg(u, org)) { org = this.accessibleOrgs(u)[0]?.slug || null; if (s && s.org !== org) { s.org = org; this.#saveSessions(); } }
    return { user: u, org, perms: new Set(org ? this.permissionsOf(u, org) : []) };
  }
  switchOrg(token, slug) {
    const u = this.resolve(token); if (!u) throw new AuthError(401, "Sesión no válida");
    if (!this.canUseOrg(u, slug)) throw new AuthError(403, "No tienes acceso a esa organización");
    const s = this.sessions.get(hashToken(token)); s.org = slug; this.#saveSessions(); u.last_org = slug; this.#save();
    this.audit(u.username, "org.switch", { org: slug }); this.#emit({ type: "org", user: u.username });
    return this.db.orgs[slug];
  }
  logout(token) { if (token && this.sessions.delete(hashToken(token))) this.#saveSessions(); }
  #revokeSessions(username, keepToken) {
    const keep = keepToken ? hashToken(keepToken) : null;
    for (const [h, s] of this.sessions) if (s.user === username && h !== keep) this.sessions.delete(h);
    this.#saveSessions();
    this.#emit({ type: "revoke", user: username });
  }
  sessionsOf(username) { return [...this.sessions.values()].filter((s) => s.user === username).length; }

  // ---- mutations (the caller has already checked users.manage, except changeOwnPassword)
  async changeOwnPassword(username, current, next, token) {
    const u = this.db.users[username];
    if (!u || !(await verifyPassword(String(current ?? ""), u.hash))) throw new AuthError(403, "La contraseña actual no es correcta");
    checkPasswordPolicy(next, username);
    if (await verifyPassword(next, u.hash)) throw new AuthError(400, "La nueva contraseña debe ser distinta");
    u.hash = await hashPassword(next); u.must_change = false; this.#save();
    this.#revokeSessions(username, token);
    this.audit(username, "password.change");
  }
  /** Creates a person in `org` (or adds an EXISTING person to it: only a super-admin can). A person can belong to several organizations. */
  async createUser(actor, { username, name, password, roles = [], super: makeSuper }, org, { actorSuper = false } = {}) {
    username = String(username || "").toLowerCase();
    if (!USER_RE.test(username)) throw new AuthError(400, "Usuario no válido (2-32 caracteres: minúsculas, números, . _ -)");
    this.#org(org); this.#checkRoles(org, roles);
    if (makeSuper && !actorSuper) throw new AuthError(403, "Solo un super-admin puede crear super-admins");
    const ex = this.db.users[username];
    if (ex) {
      if (!actorSuper) throw new AuthError(409, "Ese usuario ya existe");
      if (ex.memberships?.[org]) throw new AuthError(409, "Esa persona ya está en esta organización");
      (ex.memberships ||= {})[org] = { roles: [...new Set(roles)] }; this.#save(); this.audit(actor, "user.add-to-org", { user: username, org, roles }); this.#emit({ type: "perms", user: username });
      return { user: this.publicUser(ex, org), existing: true };
    }
    const generated = !password;
    password = password || randomPassword();
    checkPasswordPolicy(password, username);
    this.db.users[username] = { username, name: String(name || username).slice(0, 60), hash: await hashPassword(password), memberships: { [org]: { roles: [...new Set(roles)] } }, ...(makeSuper ? { super: true } : {}), must_change: true,
      created: new Date().toISOString() };
    this.#save(); this.audit(actor, "user.create", { user: username, org, roles, ...(makeSuper ? { super: true } : {}) });
    return { user: this.publicUser(this.db.users[username], org), password: generated ? password : undefined };
  }
  #checkRoles(org, roles) {
    if (!Array.isArray(roles)) throw new AuthError(400, "roles debe ser una lista");
    for (const r of roles) if (!this.#org(org).roles[r]) throw new AuthError(400, `El rol «${r}» no existe`);
  }
  /** An organization administrator manages roles in THEIR organization; name, password, 2FA, disabling and super-admin status are account-wide, so for people who
   *  also belong to other organizations (or are super-admins) only a super-admin can touch them. */
  #assertOwn(u, org, actorSuper, what) {
    if (actorSuper) return;
    if (u.super || Object.keys(u.memberships || {}).some((o) => o !== org)) throw new AuthError(403, `${what}: esta persona también pertenece a otras organizaciones; lo gestiona un super-admin`);
  }
  async updateUser(actor, username, patch, org, { actorSuper = false } = {}) {
    const u = this.db.users[username];
    if (!u || (!u.memberships?.[org] && !actorSuper)) throw new AuthError(404, "Usuario no encontrado");
    this.#org(org);
    const res = {};
    if (patch.roles !== undefined) {
      if (!u.memberships?.[org]) throw new AuthError(404, "Esa persona no está en esta organización");
      this.#checkRoles(org, patch.roles);
      if (u.super && !actorSuper) throw new AuthError(403, "Solo un super-admin puede cambiar a un super-admin");
    }
    if (patch.super !== undefined) {
      if (!actorSuper) throw new AuthError(403, "Solo un super-admin puede asignar el rol de super-admin");
      if (!patch.super && u.super && this.#supers(username).length === 0) throw new AuthError(409, "Debe quedar al menos un super-admin activo");
      if (username === actor && !patch.super) throw new AuthError(409, "No puedes quitarte a ti mismo el rol de super-admin");
    }
    const newDisabled = patch.disabled !== undefined ? !!patch.disabled : !!u.disabled;
    if (patch.name !== undefined || patch.disabled !== undefined || patch.reset_password) this.#assertOwn(u, org, actorSuper, "Cuenta");
    if (u.super && !u.disabled && newDisabled && this.#supers(username).length === 0) throw new AuthError(409, "Debe quedar al menos un super-admin activo");
    if (username === actor && newDisabled) throw new AuthError(409, "No puedes desactivarte a ti mismo");
    if (patch.name !== undefined) u.name = String(patch.name).slice(0, 60);
    if (patch.roles !== undefined) { u.memberships[org].roles = [...new Set(patch.roles)]; this.audit(actor, "user.roles", { user: username, org, roles: u.memberships[org].roles }); }
    if (patch.super !== undefined && !!patch.super !== !!u.super) { if (patch.super) u.super = true; else delete u.super; this.audit(actor, patch.super ? "user.super.grant" : "user.super.revoke", { user: username }); }
    if (patch.disabled !== undefined && newDisabled !== !!u.disabled) { u.disabled = newDisabled; this.audit(actor, newDisabled ? "user.disable" : "user.enable", { user: username, org }); }
    if (patch.reset_password) {
      const pw = patch.password || randomPassword();
      checkPasswordPolicy(pw, username);
      u.hash = await hashPassword(pw); u.must_change = true;
      if (!patch.password) res.password = pw;
      this.audit(actor, "user.password.reset", { user: username, org });
    }
    this.#save();
    if (newDisabled || patch.reset_password) this.#revokeSessions(username);
    else this.#emit({ type: "perms", user: username });
    return { user: this.publicUser(u, org), ...res };
  }
  /** Removes the person from `org`; the account itself is deleted when it was their only organization (or `everywhere`, super-admin only). */
  deleteUser(actor, username, org, { actorSuper = false, everywhere = false } = {}) {
    const u = this.db.users[username];
    if (!u || (!u.memberships?.[org] && !actorSuper)) throw new AuthError(404, "Usuario no encontrado");
    if (username === actor) throw new AuthError(409, "No puedes borrarte a ti mismo");
    if (u.super && !actorSuper) throw new AuthError(403, "Solo un super-admin puede gestionar a un super-admin");
    if (everywhere && !actorSuper) throw new AuthError(403, "Solo un super-admin puede borrar la cuenta en todas las organizaciones");
    const others = Object.keys(u.memberships || {}).filter((o) => o !== org);
    if (!everywhere && others.length) { delete u.memberships[org]; this.#save(); this.audit(actor, "user.remove-from-org", { user: username, org }); this.#emit({ type: "perms", user: username }); return { removed_from: org }; }
    if (u.super && !u.disabled && this.#supers(username).length === 0) throw new AuthError(409, "Debe quedar al menos un super-admin activo");
    delete this.db.users[username]; this.#save(); this.#revokeSessions(username);
    this.audit(actor, "user.delete", { user: username, org }); return { deleted: true };
  }
  upsertRole(actor, name, { description = "", permissions = [] }, create, org) {
    const o = this.#org(org);
    if (!ROLE_RE.test(name)) throw new AuthError(400, "Nombre de rol no válido (minúsculas, números, _ -)");
    if (create && o.roles[name]) throw new AuthError(409, "Ese rol ya existe");
    if (!create && !o.roles[name]) throw new AuthError(404, "Rol no encontrado");
    if (o.roles[name]?.locked) throw new AuthError(409, "El rol admin no se puede modificar");
    if (!Array.isArray(permissions) || permissions.some((p) => !(p in PERMISSIONS))) throw new AuthError(400, "Permiso desconocido");
    if (permissions.some((p) => PLATFORM_PERMS.includes(p))) throw new AuthError(400, "Los permisos de plataforma (Servicio, organizaciones) solo los tiene el super-admin");
    o.roles[name] = { description: String(description).slice(0, 120), permissions: [...new Set(permissions)].sort() };
    this.#save(); this.audit(actor, create ? "role.create" : "role.update", { role: name, org, permissions });
    this.#emit({ type: "perms" });
    return this.listRoles(org).find((r) => r.name === name);
  }
  deleteRole(actor, name, org) {
    const o = this.#org(org), r = o.roles[name];
    if (!r) throw new AuthError(404, "Rol no encontrado");
    if (r.locked) throw new AuthError(409, "El rol admin no se puede borrar");
    delete o.roles[name];
    for (const u of Object.values(this.db.users)) if (u.memberships?.[org]) u.memberships[org].roles = u.memberships[org].roles.filter((x) => x !== name);
    this.#save(); this.audit(actor, "role.delete", { role: name, org });
    this.#emit({ type: "perms" });
  }

  /** CLI bootstrap/recovery: creates the user (in `org`, default the legacy one) or resets its password, always with must_change. The FIRST user ever created is a super-admin. */
  async cliUpsert(username, { roles, password, org = LEGACY_ORG, super: makeSuper } = {}) {
    username = String(username).toLowerCase();
    const pw = password || randomPassword();
    if (this.db.users[username]) {
      const u = this.db.users[username]; checkPasswordPolicy(pw, username);
      u.hash = await hashPassword(pw); u.must_change = true; u.disabled = false;
      if (roles) { this.#checkRoles(org, roles); (u.memberships ||= {})[org] = { roles }; }
      if (makeSuper) u.super = true;
      this.#save(); this.#revokeSessions(username); this.audit("cli", "user.password.reset", { user: username });
    } else {
      await this.createUser("cli", { username, name: username, password: pw, roles: roles || ["admin"], super: makeSuper || !Object.values(this.db.users).some((x) => x.super) }, org, { actorSuper: true });
    }
    return pw;
  }
  /** Desktop build: the person who owns this computer. Created once as super-admin of the legacy organization with a random password nobody ever sees (there is no login screen). */
  async ensureLocalUser(username, name) {
    username = String(username).toLowerCase();
    if (!this.db.users[username]) {
      await this.createUser("desktop", { username, name: name || username, password: randomPassword(), roles: ["admin"], super: true }, LEGACY_ORG, { actorSuper: true });
    }
    const u = this.db.users[username]; if (u.must_change || u.disabled) { u.must_change = false; u.disabled = false; this.#save(); }
    return u;
  }
  /** Desktop build: opens a session without a password (the caller has already proven it owns the process, see DESKTOP_NONCE in the gateway). */
  openLocalSession(username, req) { this.#sync(); const u = this.db.users[String(username).toLowerCase()]; if (!u || u.disabled) throw new AuthError(401, "Usuario no válido"); return this.#newSession(u, req); }
  setSuper(username, on) {
    const u = this.db.users[String(username).toLowerCase()]; if (!u) throw new AuthError(404, "Usuario no encontrado");
    if (!on && u.super && this.#supers(u.username).length === 0) throw new AuthError(409, "Debe quedar al menos un super-admin activo");
    if (on) u.super = true; else delete u.super;
    this.#save(); this.audit("cli", on ? "user.super.grant" : "user.super.revoke", { user: u.username }); this.#emit({ type: "perms", user: u.username });
  }
}

function hashToken(t) { return crypto.createHash("sha256").update(t).digest("hex"); }

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
