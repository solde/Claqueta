import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { compareVersions, pickAsset, checkForUpdate, releasesUrl } from "../desktop/update.mjs";

const assets = (v) => ["mac-arm64.dmg", "mac-x64.dmg", "win-x64-setup.exe", "win-x64-portable.exe", "linux-x64.AppImage", "linux-arm64.AppImage", "mac-arm64.zip"].map((s) => ({ name: `Claqueta-${v}-${s}`, browser_download_url: `https://g/dl/${v}/Claqueta-${v}-${s}`, size: 1 }));

test("versions compare numerically (1.10 > 1.9), ignore a leading v, and a pre-release is older than its release", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1); assert.equal(compareVersions("v1.0.0", "1.0.0"), 0); assert.equal(compareVersions("1.0.0", "1.0.1"), -1); assert.equal(compareVersions("2.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.1.0-beta.1", "1.1.0"), -1); assert.equal(compareVersions("1.1.0", "1.1.0-beta.1"), 1);
});
test("the installer for each system and architecture is the right one; none when the release does not carry it", () => {
  const a = assets("1.2.0"), name = (p, arch) => pickAsset(a, { platform: p, arch })?.name;
  assert.equal(name("darwin", "arm64"), "Claqueta-1.2.0-mac-arm64.dmg"); assert.equal(name("darwin", "x64"), "Claqueta-1.2.0-mac-x64.dmg"); assert.equal(name("win32", "x64"), "Claqueta-1.2.0-win-x64-setup.exe");
  assert.equal(name("linux", "x64"), "Claqueta-1.2.0-linux-x64.AppImage"); assert.equal(name("linux", "arm64"), "Claqueta-1.2.0-linux-arm64.AppImage"); assert.equal(name("win32", "arm64"), undefined); assert.equal(name("freebsd", "x64"), undefined);
  assert.equal(releasesUrl({ host: "https://g", repo: "o/r" }), "https://g/o/r/releases");
});
test("update check: newer release found with its installer; same or older = current; drafts and pre-releases are ignored; private repo or no network = unreachable with a hint", async () => {
  let mode = "ok"; const srv = http.createServer((req, res) => {
    if (mode === "private") { res.writeHead(404); return res.end("{}"); }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify([
      { tag_name: "v1.3.0-beta.1", prerelease: true, assets: assets("1.3.0-beta.1"), html_url: "x" }, { tag_name: "v9.0.0", draft: true, assets: [], html_url: "x" },
      { tag_name: "v1.2.0", name: "Claqueta 1.2", body: "Novedades de la 1.2", html_url: "https://g/o/r/releases/tag/v1.2.0", assets: assets("1.2.0") }, { tag_name: "v1.1.0", assets: assets("1.1.0"), html_url: "y" }]));
  }); await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const host = `http://127.0.0.1:${srv.address().port}`, base = { host, repo: "o/r", platform: "darwin", arch: "arm64" };
  const up = await checkForUpdate({ ...base, current: "1.1.0" }); assert.equal(up.status, "available"); assert.equal(up.latest.version, "1.2.0"); assert.equal(up.latest.asset.name, "Claqueta-1.2.0-mac-arm64.dmg"); assert.equal(up.latest.notes, "Novedades de la 1.2");
  assert.equal((await checkForUpdate({ ...base, current: "1.2.0" })).status, "current"); assert.equal((await checkForUpdate({ ...base, current: "1.3.0-beta.1" })).status, "current", "someone on a newer pre-release is not pushed back to an older stable");
  try { mode = "private"; const priv = await checkForUpdate({ ...base, current: "1.0.0" }); assert.equal(priv.status, "unreachable"); assert.match(priv.error, /público/);
  srv.close(); srv.closeAllConnections?.(); const off = await checkForUpdate({ ...base, current: "1.0.0", timeoutMs: 2000 }); assert.equal(off.status, "unreachable"); assert.match(off.error, /Sin conexión/); } finally { srv.close(); srv.closeAllConnections?.(); }
});
