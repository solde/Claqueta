// Shared secrets inside the pod. INTERNAL_KEY (Secret `collado-internal`) is known to the gateway and agentd only; the app only receives keys derived from it,
// so a compromised app (or an agent editing it) cannot impersonate the gateway towards agentd. Console users get signed, expiring tokens (their own permissions).
import crypto from "node:crypto";

export const derive = (master, label) => crypto.createHmac("sha256", master).update(label).digest("hex");
export const safeEqual = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const b64 = (s) => Buffer.from(s).toString("base64url");

export function internalKeys(master) {
  if (!master) return null;
  return { gateway: master, app: derive(master, "app-v1"), token: derive(master, "user-token-v1") };
}
/** token = base64url(payload).hmac ; payload { u: username, p: [permissions], o: organization, e: expiry (epoch s) }. The organization is part of the signature: an agent cannot move to another one. */
export function signToken(tokenKey, { user, perms, org = "principal", ttlS = 86400 }) {
  const p = b64(JSON.stringify({ u: user, p: perms, o: org, e: Math.floor(Date.now() / 1000) + ttlS }));
  return `${p}.${crypto.createHmac("sha256", tokenKey).update(p).digest("base64url")}`;
}
export function verifyToken(tokenKey, token) {
  const [p, sig] = String(token || "").split("."); if (!p || !sig) return null;
  const want = crypto.createHmac("sha256", tokenKey).update(p).digest("base64url");
  if (!safeEqual(sig, want)) return null;
  try { const j = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); if (!j.u || !Array.isArray(j.p) || j.e < Date.now() / 1000) return null; return { user: j.u, perms: j.p, org: j.o || "principal", exp: j.e }; } catch { return null; }
}
