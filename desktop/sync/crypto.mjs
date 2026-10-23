// Encryption of everything that leaves this computer. A passphrase chosen by the person is stretched with scrypt; two sub-keys come from it with HKDF:
// one encrypts (AES-256-GCM, a random IV per object), the other turns the content hash into the object's name (HMAC), so the cloud provider sees neither contents nor file names.
import crypto from "node:crypto";

const MAGIC = Buffer.from("CLD1");
/** scrypt parameters that stretch the passphrase. */
export const KDF = { N: 32768, r: 8, p: 1 };

/** A random 16-byte salt. */
export const newSalt = () => crypto.randomBytes(16);
/** Master key from a passphrase and salt (scrypt, NFKC-normalised passphrase). */
export function masterFrom(passphrase, salt, kdf = KDF) {
  const pw = String(passphrase ?? "").normalize("NFKC");
  return crypto.scryptSync(pw, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 });
}
/** { enc, name } sub-keys from the stretched master key. */
export function subkeys(master) {
  const k = (info) => Buffer.from(crypto.hkdfSync("sha256", master, Buffer.alloc(0), info, 32));
  return { enc: k("collado-sync-enc-v1"), name: k("collado-sync-name-v1") };
}
/** Encrypts a buffer (AES-256-GCM, random IV, `CLD1` magic). */
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
/** Name of a cloud object from its content hash (HMAC, so the provider learns nothing about the content). */
export const objectName = (nameKey, sha) => "o-" + crypto.createHmac("sha256", nameKey).update(sha).digest("hex").slice(0, 48);
/** Hex SHA-256 of a buffer. */
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
