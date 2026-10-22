// Authentication for the Gitea API without a token: HTTP Signatures (draft-cavage) made with an SSH key that is registered in the Gitea account. Gitea looks the key up by its
// fingerprint (keyId = "SHA256:...") and verifies rsa-sha256 / ed25519 over "(request-target)" and "date". Only RSA keys in PEM (PKCS#1/PKCS#8) or OpenSSH format that Node can read.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** "SHA256:xxxx" fingerprint of an OpenSSH public key file (what `ssh-keygen -l` prints and Gitea stores). */
export function fingerprint(pubFile) {
  const blob = Buffer.from(fs.readFileSync(pubFile, "utf8").trim().split(/\s+/)[1], "base64");
  return "SHA256:" + crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
}
/** Node cannot read the OpenSSH private-key format: convert a COPY to PEM with ssh-keygen (the original is never modified; the key must have no passphrase). The copy is deleted right away. */
function loadKey(keyFile) {
  const raw = fs.readFileSync(keyFile);
  try { return crypto.createPrivateKey(raw); } catch { /* OpenSSH format */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitea-key-")), copy = path.join(dir, "k");
  try { fs.writeFileSync(copy, raw, { mode: 0o600 }); execFileSync("ssh-keygen", ["-p", "-N", "", "-m", "PEM", "-f", copy], { stdio: "ignore" }); return crypto.createPrivateKey(fs.readFileSync(copy)); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** -> (method, url) => headers carrying a fresh signature. */
export function sshSigner({ keyFile, pubFile = keyFile + ".pub" }) {
  const key = loadKey(keyFile), keyId = fingerprint(pubFile);
  const type = key.asymmetricKeyType, algorithm = type === "rsa" ? "rsa-sha256" : type === "ed25519" ? "ed25519" : null; if (!algorithm) throw new Error(`unsupported key type ${type}`);
  return (method, url) => {
    const u = new URL(url), date = new Date().toUTCString(), signing = `(request-target): ${method.toLowerCase()} ${u.pathname}${u.search}\ndate: ${date}`;
    const sig = crypto.sign(type === "rsa" ? "sha256" : null, Buffer.from(signing), key).toString("base64");
    return { date, signature: `keyId="${keyId}",algorithm="${algorithm}",headers="(request-target) date",signature="${sig}"` };
  };
}
