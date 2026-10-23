// Unit tests of the cloud-sync providers and OAuth (desktop/sync/oauth.mjs, providers/*) against fake servers: PKCE flow, retries, Google Drive and OneDrive uploads and downloads.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { authorize, TokenSource, OAuthError } from "../desktop/sync/oauth.mjs";
import { GoogleDriveProvider } from "../desktop/sync/providers/google.mjs";
import { OneDriveProvider } from "../desktop/sync/providers/microsoft.mjs";
import { send, HttpError } from "../desktop/sync/providers/http.mjs";
import { SyncEngine, initRemote } from "../desktop/sync/engine.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "collado-cloud-test-"));
const body = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const listen = (handler) => new Promise((res) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => res({ s: { close: () => { s.close(); s.closeAllConnections(); } }, url: `http://127.0.0.1:${s.address().port}` })); });
const tokensOf = (t = "good-token") => ({ get: async () => t, invalidate() {} });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
test("oauth: PKCE loopback flow — the code is exchanged with the right verifier, foreign callbacks are ignored, a denial rejects, refresh keeps the refresh token", async () => {
  const seen = {}; const tokenSrv = await listen(async (req, res) => {
    const p = new URLSearchParams((await body(req)).toString()); seen[p.get("grant_type")] = Object.fromEntries(p);
    res.setHeader("content-type", "application/json");
    if (p.get("grant_type") === "authorization_code") { const ok = crypto.createHash("sha256").update(p.get("code_verifier")).digest("base64url") === seen.challenge && p.get("code") === "the-code"; return res.end(JSON.stringify(ok ? { access_token: "A1", refresh_token: "R1", expires_in: 3600 } : { error: "invalid_grant" })); }
    res.end(JSON.stringify({ access_token: "A2", expires_in: 3600 }));
  });
  const openUrl = async (url) => {
    const u = new URL(url); assert.equal(u.searchParams.get("code_challenge_method"), "S256"); assert.equal(u.searchParams.get("access_type"), "offline"); assert.match(u.searchParams.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    seen.challenge = u.searchParams.get("code_challenge"); const cb = u.searchParams.get("redirect_uri");
    await fetch(`${cb}?code=evil&state=WRONG`); const ok = await (await fetch(`${cb}?code=the-code&state=${u.searchParams.get("state")}`)).text(); assert.match(ok, /Listo/);
  };
  const t = await authorize({ authUrl: "https://accounts.example/auth", tokenUrl: `${tokenSrv.url}/token`, clientId: "cid", clientSecret: "sec", scope: "drive.file", extra: { access_type: "offline" }, openUrl });
  assert.equal(t.access, "A1"); assert.equal(t.refresh, "R1"); assert.ok(t.expiresAt > Date.now()); assert.equal(seen.authorization_code.client_id, "cid"); assert.equal(seen.authorization_code.client_secret, "sec");
  let saved = null; const ts = new TokenSource({ tokens: { ...t, expiresAt: 0 }, tokenUrl: `${tokenSrv.url}/token`, clientId: "cid", persist: (x) => { saved = x; } });
  assert.equal(await ts.get(), "A2"); assert.equal(saved.refresh, "R1", "the refresh token survives a refresh that does not return a new one"); assert.equal(await ts.get(), "A2");
  await assert.rejects(authorize({ authUrl: "https://x/auth", tokenUrl: `${tokenSrv.url}/token`, clientId: "cid", scope: "s", openUrl: async (url) => { const u = new URL(url); await fetch(`${u.searchParams.get("redirect_uri")}?error=access_denied&state=${u.searchParams.get("state")}`); } }), { code: "access_denied" });
  await assert.rejects(authorize({ authUrl: "x", tokenUrl: "x", clientId: "", scope: "s", openUrl() {} }), { code: "no_client_id" });
  await assert.rejects(new TokenSource({ tokens: null, tokenUrl: "x", clientId: "c" }).get(), OAuthError); tokenSrv.s.close();
});

test("http layer: retries throttling and server errors, refreshes once on 401, gives up with a readable error", async () => {
  let n = 0, auth = []; const srv = await listen((req, res) => { auth.push(req.headers.authorization); n++; if (req.url === "/flaky") { res.writeHead(n < 3 ? 503 : 200); return res.end("ok"); } if (req.url === "/limited") { res.writeHead(n < 2 ? 429 : 200, { "retry-after": "0" }); return res.end("ok"); } if (req.url === "/expired") { res.writeHead(req.headers.authorization === "Bearer new" ? 200 : 401); return res.end(); } res.writeHead(404); res.end("nope"); });
  const fast = { sleepMs: () => 1 }; n = 0; assert.equal((await send({ url: `${srv.url}/flaky`, tokens: tokensOf(), ...fast })).status, 200); assert.equal(n, 3);
  n = 0; assert.equal((await send({ url: `${srv.url}/limited`, tokens: tokensOf(), ...fast })).status, 200);
  let t = "old"; const tk = { get: async () => t, invalidate() { t = "new"; } }; auth = []; assert.equal((await send({ url: `${srv.url}/expired`, tokens: tk, ...fast })).status, 200); assert.deepEqual(auth, ["Bearer old", "Bearer new"]);
  await assert.rejects(send({ url: `${srv.url}/missing?secret=1`, tokens: tokensOf(), ...fast }), (e) => e instanceof HttpError && e.status === 404 && !e.url.includes("secret")); srv.s.close();
});

// ---- a miniature Google Drive v3 ---------------------------------------------------------------------------------------------------------------------------
async function fakeDrive() {
  const files = new Map(), log = []; let seq = 0; const sessions = new Map(); let folderId = null, uploads = 0;
  const add = (name, buf, parents) => { const id = "f" + ++seq; files.set(id, { id, name, parents, buf }); return id; };
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url, "http://x"), b = await body(req), json = (o, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== "Bearer good-token" && !u.pathname.startsWith("/session/")) { res.writeHead(401); return res.end(); }
    log.push(`${req.method} ${u.pathname}`);
    if (req.method === "GET" && u.pathname === "/drive/v3/files") {
      const q = u.searchParams.get("q"); let list = [...files.values()];
      if (/mimeType='application\/vnd.google-apps.folder'/.test(q)) list = list.filter((f) => f.folder && f.name === /name='([^']+)'/.exec(q)[1]);
      else if (/ in parents/.test(q)) { const pid = /'([^']+)' in parents/.exec(q)[1], nm = /name='([^']+)'/.exec(q)?.[1]; list = list.filter((f) => f.parents?.includes(pid) && !f.folder && (!nm || f.name === nm)); }
      const page = u.searchParams.get("pageToken") ? Number(u.searchParams.get("pageToken")) : 0, size = Number(u.searchParams.get("pageSize")) > 2 && list.length > 2 ? 2 : Number(u.searchParams.get("pageSize"));   // force pagination on big listings
      const slice = list.slice(page, page + size); return json({ files: slice.map((f) => ({ id: f.id, name: f.name, size: String(f.buf?.length ?? 0) })), ...(page + size < list.length ? { nextPageToken: String(page + size) } : {}) });
    }
    if (req.method === "POST" && u.pathname === "/drive/v3/files") { const m = JSON.parse(b.toString()); const id = add(m.name, null, m.parents); files.get(id).folder = true; folderId = id; return json({ id }); }
    if (u.pathname.startsWith("/upload/drive/v3/files")) {
      const id = u.pathname.split("/")[5] || null; const type = u.searchParams.get("uploadType");
      if (type === "multipart") { const m = /boundary=(.+)$/.exec(req.headers["content-type"])[1]; const parts = b.toString("latin1").split(`--${m}`); const meta = JSON.parse(parts[1].split("\r\n\r\n")[1].replace(/\r\n$/, "")); const start = b.indexOf("\r\n\r\n", b.indexOf(`--${m}`, 10)) + 4, end = b.lastIndexOf(`\r\n--${m}--`); const data = b.subarray(start, end); uploads++;
        if (id) { files.get(id).buf = Buffer.from(data); return json({ id }); } return json({ id: add(meta.name, Buffer.from(data), meta.parents) }); }
      if (type === "resumable") { const meta = b.length ? JSON.parse(b.toString()) : {}; const sid = "s" + ++seq; sessions.set(sid, { id, meta }); res.writeHead(200, { location: `${srv.url}/session/${sid}` }); return res.end(); }
    }
    if (u.pathname.startsWith("/session/") && req.method === "PUT") { const s = sessions.get(u.pathname.split("/")[2]); uploads++; if (s.id) { files.get(s.id).buf = b; return json({ id: s.id }); } return json({ id: add(s.meta.name, b, s.meta.parents) }); }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === "GET") { const f = files.get(m[1]); if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200); return res.end(f.buf); }
    if (m && req.method === "DELETE") { files.delete(m[1]); res.writeHead(204); return res.end(); }
    res.writeHead(400); res.end("unhandled " + req.method + " " + u.pathname);
  });
  return { ...srv, files, log, uploads: () => uploads };
}
const roundTrip = async (providerA, providerB, bigBytes) => {
  await providerA.init(); await providerB.init();
  const passphrase = "contraseña de prueba", master = await initRemote(providerA, passphrase);
  const mk = (provider, device) => { const base = tmp(); return { base, home: path.join(base, "home"), engine: new SyncEngine({ provider, master, device: { id: device, name: device }, statePath: path.join(base, "s.json"), backupsDir: path.join(base, "bk"), roots: [{ ns: "home", dir: path.join(base, "home") }] }) }; };
  const A = mk(providerA, "A"), B = mk(providerB, "B"); fs.mkdirSync(A.home, { recursive: true }); fs.writeFileSync(path.join(A.home, "pequeño.txt"), "hola nube"); fs.writeFileSync(path.join(A.home, "grande.bin"), bigBytes);
  const r = await A.engine.push(); assert.equal(r.uploaded, 2); await A.engine.releaseLease(); await B.engine.pull();
  assert.equal(fs.readFileSync(path.join(B.home, "pequeño.txt"), "utf8"), "hola nube"); assert.ok(fs.readFileSync(path.join(B.home, "grande.bin")).equals(bigBytes));
  fs.writeFileSync(path.join(B.home, "pequeño.txt"), "hola nube v2"); await B.engine.push(); await B.engine.releaseLease(); await A.engine.pull(); assert.equal(fs.readFileSync(path.join(A.home, "pequeño.txt"), "utf8"), "hola nube v2");
  return { A, B };
};

test("google drive: folder, listing with pagination, small (multipart) and large (resumable) uploads, update in place, download, delete — and a full two-computer round trip", async () => {
  const d = await fakeDrive(), prov = () => new GoogleDriveProvider({ tokens: tokensOf(), apiBase: d.url }); const p = prov(); await p.init(); await p.init();
  assert.equal([...d.files.values()].filter((f) => f.folder).length, 1, "the folder is created once, then found"); assert.equal(await p.read("nada.bin"), null);
  await p.write("a.bin", Buffer.from("uno")); await p.write("b.bin", Buffer.from("dos")); await p.write("c.bin", Buffer.from("tres")); await p.write("a.bin", Buffer.from("uno v2")); assert.equal((await p.read("a.bin")).toString(), "uno v2");
  assert.deepEqual([...(await p.list()).keys()].sort(), ["a.bin", "b.bin", "c.bin"], "pagination is followed"); await p.remove("b.bin"); await p.remove("b.bin"); assert.equal(await p.read("b.bin"), null); assert.ok(!(await p.list()).has("b.bin"));
  await assert.rejects(p.write("../x", Buffer.from("x")), /bad_name/);
  const big = crypto.randomBytes(6 * 1048576); await p.write("big.bin", big); assert.ok((await p.read("big.bin")).equals(big)); assert.ok(d.log.some((l) => l.includes("/upload/drive/v3/files")), "uploads go to the upload endpoint");
  const d2 = await fakeDrive(); const { A } = await roundTrip(new GoogleDriveProvider({ tokens: tokensOf(), apiBase: d2.url }), new GoogleDriveProvider({ tokens: tokensOf(), apiBase: d2.url }), crypto.randomBytes(5.5 * 1048576));
  for (const f of d2.files.values()) if (f.buf) assert.ok(!f.buf.includes(Buffer.from("hola nube")), "Google only ever sees ciphertext");
  await assert.rejects(new GoogleDriveProvider({ tokens: tokensOf("wrong"), apiBase: d.url }).init(), { status: 401 }); d.s.close(); d2.s.close();
});

// ---- a miniature Microsoft Graph (approot) ----------------------------------------------------------------------------------------------------------------
async function fakeGraph() {
  const files = new Map(), up = new Map(); let log = [];
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url, "http://x"), b = await body(req); log.push(`${req.method} ${decodeURIComponent(u.pathname)}`);
    if (u.pathname.startsWith("/up/")) { const name = decodeURIComponent(u.pathname.slice(4)), m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers["content-range"]); assert.equal(req.headers.authorization, undefined, "the pre-authorised upload URL gets no token"); const cur = up.get(name) || []; cur.push(b); up.set(name, cur); if (Number(m[2]) + 1 === Number(m[3])) { files.set(name, Buffer.concat(cur)); up.delete(name); res.writeHead(201, { "content-type": "application/json" }); return res.end("{}"); } res.writeHead(202, { "content-type": "application/json" }); return res.end("{}"); }
    if (u.pathname.startsWith("/dl/")) { assert.equal(req.headers.authorization, undefined, "the download redirect does not carry our token"); const f = files.get(decodeURIComponent(u.pathname.slice(4))); res.writeHead(200); return res.end(f); }
    if (req.headers.authorization !== "Bearer good-token") { res.writeHead(401); return res.end(); }
    const json = (o, c = 200) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/v1.0/me/drive/special/approot") return json({ id: "root" });
    if (u.pathname === "/v1.0/me/drive/special/approot/children") { const all = [...files.entries()].map(([name, buf]) => ({ name, size: buf.length, file: {} })); const at = Number(u.searchParams.get("skip") || 0); const page = all.slice(at, at + 2); return json({ value: page, ...(at + 2 < all.length ? { "@odata.nextLink": `${srv.url}/v1.0/me/drive/special/approot/children?skip=${at + 2}` } : {}) }); }
    const m = /^\/v1\.0\/me\/drive\/special\/approot:\/([^:]+):(\/content|\/createUploadSession)?$/.exec(decodeURIComponent(u.pathname)); if (!m) { res.writeHead(400); return res.end("unhandled " + u.pathname); }
    const name = m[1];
    if (m[2] === "/content" && req.method === "PUT") { assert.ok(b.length <= 4_000_000, "simple upload is for small content only"); files.set(name, b); return json({}, 201); }
    if (m[2] === "/content" && req.method === "GET") { if (!files.has(name)) { res.writeHead(404); return res.end(); } res.writeHead(302, { location: `${srv.url.replace("127.0.0.1", "localhost")}/dl/${encodeURIComponent(name)}` }); return res.end(); }
    if (m[2] === "/createUploadSession") return json({ uploadUrl: `${srv.url}/up/${encodeURIComponent(name)}` });
    if (!m[2] && req.method === "DELETE") { if (!files.delete(name)) { res.writeHead(404); return res.end(); } res.writeHead(204); return res.end(); }
    res.writeHead(400); res.end("unhandled");
  });
  return { ...srv, files, log };
}
test("onedrive (graph approot): paging, simple and chunked uploads, redirected download without the token, delete — and a full two-computer round trip", async () => {
  const g = await fakeGraph(), p = new OneDriveProvider({ tokens: tokensOf(), graphBase: `${g.url}/v1.0` }); await p.init();
  for (const n of ["a.bin", "b.bin", "c.bin"]) await p.write(n, Buffer.from(n)); assert.deepEqual([...(await p.list()).keys()].sort(), ["a.bin", "b.bin", "c.bin"]); assert.equal((await p.read("b.bin")).toString(), "b.bin"); assert.equal(await p.read("zz.bin"), null);
  await p.remove("b.bin"); await p.remove("b.bin"); assert.equal(await p.read("b.bin"), null); await assert.rejects(p.write("a/b", Buffer.from("x")), /bad_name/);
  const big = crypto.randomBytes(9 * 1048576); await p.write("big.bin", big); assert.ok((await p.read("big.bin")).equals(big)); assert.ok(g.log.filter((l) => l.startsWith("PUT /up/")).length >= 3, "large content goes in several chunks");
  const g2 = await fakeGraph(); await roundTrip(new OneDriveProvider({ tokens: tokensOf(), graphBase: `${g2.url}/v1.0` }), new OneDriveProvider({ tokens: tokensOf(), graphBase: `${g2.url}/v1.0` }), crypto.randomBytes(4.5 * 1048576));
  for (const b of g2.files.values()) assert.ok(!b.includes(Buffer.from("hola nube")), "Microsoft only ever sees ciphertext");
  await assert.rejects(new OneDriveProvider({ tokens: tokensOf("wrong"), graphBase: `${g.url}/v1.0` }).init(), { status: 401 }); g.s.close(); g2.s.close();
});
