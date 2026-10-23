// AES-256-GCM for `secret` fields and attachments. The key comes from COLLADO_DATA_KEY (base64, 32 bytes) or is generated once into
// DATA/appdata/data.key (mode 0600). Backups exclude the key file, so a leaked backup/DB dump does not expose personal data or contracts.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let master;
/** Loads (or creates) the install's master key from COLLADO_DATA_KEY or `<dataDir>/data.key`; returns "env" or the key file path. */
export function initKey(dataDir) {
  const env = process.env.COLLADO_DATA_KEY;
  if (env) { const k = Buffer.from(env, "base64"); if (k.length !== 32) throw new Error("COLLADO_DATA_KEY must be 32 bytes in base64"); master = k; return "env"; }
  const f = path.join(dataDir, "data.key");
  if (fs.existsSync(f)) master = Buffer.from(fs.readFileSync(f, "utf8").trim(), "base64");
  else { master = crypto.randomBytes(32); fs.writeFileSync(f, master.toString("base64") + "\n", { mode: 0o600 }); }
  if (master.length !== 32) throw new Error("data.key is corrupt");
  return f;
}
// One data key for the install, but every organization gets its OWN sub-keys (HKDF with the organization in the label), so ciphertext copied between companies is
// unreadable. The legacy organization keeps the original labels (its existing data stays readable).
/** Registers the function that says which organization is current, so every company derives its own sub-keys. */
let orgOf = () => "principal"; export const setOrgResolver = (fn) => { orgOf = fn; };
const sub = (info) => Buffer.from(crypto.hkdfSync("sha256", master, Buffer.alloc(0), info, 32));
const subs = new Map();
const key = (kind) => { const o = orgOf(), id = `${kind}:${o}`; let k = subs.get(id); if (!k) { k = sub(o === "principal" ? `collado-${kind}-v1` : `collado-${kind}-v1:${o}`); subs.set(id, k); } return k; };
/** Encrypts a `secret` field value with AES-256-GCM (`enc1:` + iv + tag + ciphertext, base64); empty values stay empty. */
export function encField(text) {
  if (text == null || text === "") return text;
  const kField = key("field");
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", kField, iv);
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return "enc1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
/** True when a stored value is an `enc1:` ciphertext produced by encField. */
export const isEnc = (v) => typeof v === "string" && v.startsWith("enc1:");
/** Decrypts an `enc1:` value (anything else is returned as is); throws if the authentication tag does not match. */
export function decField(v) {
  if (!isEnc(v)) return v;
  const kField = key("field");
  const b = Buffer.from(v.slice(5), "base64"), d = crypto.createDecipheriv("aes-256-gcm", kField, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
/** Encrypts a file (`CLD1` magic + iv + tag + ciphertext) with the organization's file key. */
export function encBuffer(buf) {
  const kFile = key("file");
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", kFile, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from("CLD1"), iv, c.getAuthTag(), ct]);
}
/** Decrypts a buffer produced by encBuffer; throws when it is not one or has been tampered with. */
export function decBuffer(buf) {
  const kFile = key("file");
  if (buf.subarray(0, 4).toString() !== "CLD1") throw new Error("not an encrypted file");
  const d = crypto.createDecipheriv("aes-256-gcm", kFile, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}
/** Hex SHA-256 of a buffer (attachment fingerprints and delivery checksums). */
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
/** Random URL-safe identifier of `n` random bytes (file names inside the attachments folder). */
export const randomId = (n = 12) => crypto.randomBytes(n).toString("base64url");
