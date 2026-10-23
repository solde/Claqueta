// Publishes installers to a Gitea release: creates the release for the tag if it does not exist, uploads every installer found in --dir (replacing an asset of the same name)
// and a SHA256SUMS.txt covering everything attached. Usage: node scripts/publish-release.mjs --tag v1.0.0 [--dir dist] [--notes "text" | --notes-file f] [--draft] [--dry-run]
// Auth: GITEA_TOKEN, the file ~/.config/claqueta/gitea-token, or --ssh-key <private key> (HTTP signatures with an SSH key registered in the Gitea account; no token needed). Host and repository come from desktop/update.config.json (or --host / --repo).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { sshSigner } from "./gitea-auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; }, flag = (n) => args.includes(`--${n}`);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "desktop", "update.config.json"), "utf8"));
/** Gitea host, repository, tag and installer folder from the options and desktop/update.config.json. */
const host = (opt("host", cfg.host)).replace(/\/$/, ""), repo = opt("repo", cfg.repo), tag = opt("tag"), dir = path.resolve(opt("dir", path.join(ROOT, "dist")));
if (!tag || !/^v\d+\.\d+/.test(tag)) { console.error("usage: publish-release.mjs --tag vX.Y.Z [--dir dist]"); process.exit(2); }
let token = process.env.GITEA_TOKEN; if (!token) { try { token = fs.readFileSync(path.join(os.homedir(), ".config", "claqueta", "gitea-token"), "utf8").trim(); } catch { /* none */ } }
const sshKey = opt("ssh-key", process.env.GITEA_SSH_KEY), sign = !token && sshKey ? sshSigner({ keyFile: path.resolve(sshKey.replace(/^~(?=\/)/, os.homedir())) }) : null;
if (!token && !sign && !flag("dry-run")) { console.error("no credentials: set GITEA_TOKEN, write it to ~/.config/claqueta/gitea-token, or pass --ssh-key <private key>"); process.exit(2); }
/** Authorization headers: a token, or an HTTP signature made with an SSH key. */
const authHeaders = (method, url) => (token ? { authorization: `token ${token}` } : sign ? sign(method, url) : {});
const INSTALLER = /\.(dmg|exe|AppImage|deb|zip|tar\.gz)$/i;
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => INSTALLER.test(f) && !/blockmap/.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort() : [];
if (!files.length) { console.error(`no installers in ${dir}`); process.exit(1); }
/** Calls the repository's Gitea API and throws on an unexpected status. */
const api = async (p, init = {}, ok = [200, 201]) => {
  const url = `${host}/api/v1/repos/${repo}${p}`, r = await fetch(url, { ...init, headers: { ...authHeaders(init.method || "GET", url), accept: "application/json", ...(init.headers || {}) } });
  if (!ok.includes(r.status)) throw new Error(`${init.method || "GET"} ${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`); return r;
};
/** SHA-256 of a file (for SHA256SUMS.txt). */
const sha = (f) => new Promise((res, rej) => { const h = crypto.createHash("sha256"); fs.createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });

const sums = []; for (const f of files) sums.push(`${await sha(path.join(dir, f))}  ${f}`);
if (flag("dry-run")) { console.log(`would publish to ${host}/${repo} tag ${tag}:\n${sums.join("\n")}`); process.exit(0); }

let rel; const found = await api(`/releases/tags/${encodeURIComponent(tag)}`, {}, [200, 404]);
if (found.status === 200) rel = await found.json();
else {
  const notes = opt("notes-file") ? fs.readFileSync(opt("notes-file"), "utf8") : opt("notes", `Claqueta ${tag.slice(1)}\n\nInstaladores para cada sistema (ver DESCARGAS.md). Las versiones no están firmadas.`);
  rel = await (await api("/releases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tag_name: tag, name: `Claqueta ${tag.slice(1)}`, body: notes, draft: flag("draft"), prerelease: /-/.test(tag) }) })).json();
  console.log(`created release ${tag}`);
}
const existing = new Map((rel.assets || []).map((a) => [a.name, a.id]));
const sizes = new Map((rel.assets || []).map((a) => [a.name, a.size]));
/** Uploads one installer as a release asset, replacing an asset of the same name. */
const upload = async (name, blob, size) => {
  if (size !== undefined && sizes.get(name) === size) { console.log(`unchanged ${name}`); return; }   // same name and size already attached: do not upload it again
  if (existing.has(name)) await api(`/releases/${rel.id}/assets/${existing.get(name)}`, { method: "DELETE" }, [204]);
  const fd = new FormData(); fd.append("attachment", blob, name); await api(`/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, { method: "POST", body: fd }, [201]); console.log(`uploaded ${name}`);
};
for (const f of files) await upload(f, await fs.openAsBlob(path.join(dir, f)), fs.statSync(path.join(dir, f)).size);
// the checksum file lists what THIS run uploaded plus what other runs (other operating systems) already attached; if the existing one cannot be read, this run writes its own file instead of replacing it
const prior = rel.assets?.find((a) => a.name === "SHA256SUMS.txt"); let merged = new Map(), name = "SHA256SUMS.txt";
if (prior) { try { const u = `${host}/${repo}/releases/download/${encodeURIComponent(tag)}/SHA256SUMS.txt`, r = await fetch(u, { headers: authHeaders("GET", u) }); if (!r.ok) throw new Error(String(r.status)); for (const l of (await r.text()).split("\n")) { const m = /^([0-9a-f]{64})  (.+)$/.exec(l); if (m) merged.set(m[2], m[1]); } } catch { name = `SHA256SUMS-${files[0].replace(/^.*?-(mac|win|linux)-([a-z0-9]+).*$/, "$1-$2")}.txt`; merged = new Map(); } }
for (const l of sums) { const [h, n] = l.split("  "); merged.set(n, h); }
await upload(name, new Blob([[...merged].sort((a, b) => a[0].localeCompare(b[0])).map(([n, h]) => `${h}  ${n}`).join("\n") + "\n"]));
console.log(`done: ${host}/${repo}/releases/tag/${tag}`);
