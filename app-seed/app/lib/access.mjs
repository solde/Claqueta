// Identity and permissions. The gateway authenticates and sends x-collado-* headers; requests without them come from inside the pod
// (the agent, curl on 127.0.0.1) and are trusted with every permission. External users are scoped to the programmes they are members of.
import { q, LEGACY_ORG, ORG_RE, currentSlug } from "./db.mjs";
import { PERMS, MODULES, ENTITIES } from "./schema.mjs";
import { now, HttpError } from "./util.mjs";
import { safeEqual, verifyToken } from "./token.mjs";

const APP_KEY = process.env.APP_KEY || "", TOKEN_KEY = process.env.COLLADO_TOKEN_KEY || "";
/** Production: both keys are set and every API call must prove who it is. Development/tests: no keys, headers (or nothing) are trusted as before. */
export const STRICT = !!(APP_KEY || TOKEN_KEY);

export function ctxFromReq(req) {
  const k = req.headers["x-collado-key"], bearer = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (STRICT) {
    if (k && APP_KEY && safeEqual(k, APP_KEY) && req.headers["x-collado-user"]) return fromGateway(req);
    if (bearer) {   // a person's agent: acts with the permissions that person had when the token was issued
      const t = verifyToken(TOKEN_KEY, bearer[1]);
      if (t) { const perms = new Set(t.perms); return { user: t.user, name: t.user, perms, roles: ["agent"], local: false, external: false, agent: true, lang: "", org: t.org || LEGACY_ORG, orgName: "" }; }
    }
    throw new HttpError(401, "unauthorized");
  }
  return req.headers["x-collado-user"] ? fromGateway(req) : localCtx();
}
function fromGateway(req) {
  const u = req.headers["x-collado-user"];
  const perms = new Set(String(req.headers["x-collado-perms"] || "").split(",").filter(Boolean));
  let name = u; try { name = decodeURIComponent(req.headers["x-collado-name"] || u); } catch { /* keep username */ }
  const roles = String(req.headers["x-collado-roles"] || "").split(",").filter(Boolean);
  const lang = String(req.headers["accept-language"] || "").slice(0, 2).toLowerCase();
  // the organization comes from the gateway (it knows which one the person has open); without it (development) the legacy one
  const org = String(req.headers["x-collado-org"] || LEGACY_ORG); if (!ORG_RE.test(org)) throw new HttpError(400, "invalid_org");
  let orgName = ""; try { orgName = decodeURIComponent(req.headers["x-collado-org-name"] || ""); } catch { /* keep empty */ }
  return { user: u, name, perms, roles, local: false, external: perms.has("external") && !perms.has("users.manage"), lang, org, orgName };
}
export const localCtx = (user = "agente") => ({ user, name: user, perms: new Set(PERMS), roles: ["agent"], local: true, external: false, lang: "", org: LEGACY_ORG, orgName: "" });

const seen = new Map();
/** Remembers who is active in the current organization (called inside the organization's context). */
export function touchUser(ctx) {
  const k = currentSlug() + "|" + ctx.user, t = seen.get(k) || 0;
  if (Date.now() - t < 60000) return;
  seen.set(k, Date.now());
  try {
    q.run("INSERT INTO app_users(username, name, roles, perms, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET name = excluded.name, roles = excluded.roles, perms = excluded.perms, last_seen = excluded.last_seen",
      k, ctx.name, ctx.roles.join(","), [...ctx.perms].join(","), now());
  } catch { /* never block a request on this */ }
}

export const has = (ctx, perm) => ctx.local || ctx.perms.has(perm);
export const canRead = (ctx, e) => e.module === "own" || (has(ctx, MODULES[e.module].view) && (!ctx.external || !!e.ext?.read));
export const canWrite = (ctx, e) => {
  if (e.module === "own") return true;
  if (ctx.external) return !!e.ext?.write;
  return has(ctx, MODULES[e.module].edit);
};
/** Field-level permission ({read, write} on the field definition). */
export const canReadField = (ctx, fd) => !fd.perm?.read || has(ctx, fd.perm.read);
export const canWriteField = (ctx, fd) => !fd.perm?.write || has(ctx, fd.perm.write);

export function memberPrograms(ctx) {
  if (!ctx.external) return null;
  return (ctx._programs ||= q.all("SELECT program_id FROM members WHERE username = ?", ctx.user).map((r) => r.program_id));
}
export function memberInfo(ctx, programId) { return q.get("SELECT * FROM members WHERE username = ? AND program_id = ?", ctx.user, programId); }
export const entityOf = (name) => ENTITIES[name];
