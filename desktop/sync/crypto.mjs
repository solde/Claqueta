// Encryption of everything that leaves this computer. A passphrase chosen by the person is stretched with scrypt; two sub-keys come from it with HKDF:
// one encrypts (AES-256-GCM, a random IV per object), the other turns the content hash into the object's name (HMAC), so the cloud provider sees neither contents nor file names.
import crypto from "node:crypto";

const MAGIC = Buffer.from("CLD1");
export const KDF = { N: 32768, r: 8, p: 1 };

export const newSalt = () => crypto.randomBytes(16);
export function masterFrom(passphrase, salt, kdf = KDF) {
  const pw = String(passphrase ?? "").normalize("NFKC");
  return crypto.scryptSync(pw, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 });
}
/** { enc, name } sub-keys from the stretched master key. */
export function subkeys(master) {
  const k = (info) => Buffer.from(crypto.hkdfSync("sha256", master, Buffer.alloc(0), info, 32));
  return { enc: k("collado-sync-enc-v1"), name: k("collado-sync-name-v1") };
}
export function seal(key, plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv), ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
/** Throws when the blob is not ours, was tampered with, or the key is wrong. */
export function open(key, blob) {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("bad_format");
  const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(4, 16)); d.setAuthTag(blob.subarray(16, 32));
  try { return Buffer.concat([d.update(blob.subarray(32)), d.final()]); } catch { throw new Error("bad_key"); }
}
export const objectName = (nameKey, sha) => "o-" + crypto.createHmac("sha256", nameKey).update(sha).digest("hex").slice(0, 48);
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
