// Verification of the signed tokens agentd gives to console users (the same format agentd signs). Nothing in the pod is trusted for being on 127.0.0.1.
import crypto from "node:crypto";
/** Constant-time string comparison; false for empty or different-length values. */
export const safeEqual = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
/** Checks the HMAC signature and expiry of a person's agent token and returns { user, perms, org }, or null when it is invalid. */
export function verifyToken(tokenKey, token) {
  const [p, sig] = String(token || "").split("."); if (!tokenKey || !p || !sig) return null;
  if (!safeEqual(sig, crypto.createHmac("sha256", tokenKey).update(p).digest("base64url"))) return null;
  try { const j = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); if (!j.u || !Array.isArray(j.p) || j.e < Date.now() / 1000) return null; return { user: j.u, perms: j.p, org: j.o || "principal" }; } catch { return null; }
}
