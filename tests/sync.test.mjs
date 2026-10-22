import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SyncEngine, SyncError, initRemote, unlockRemote, LEASE_MS } from "../desktop/sync/engine.mjs";
import { FolderProvider } from "../desktop/sync/providers/folder.mjs";
import { seal, open, subkeys, masterFrom, newSalt } from "../desktop/sync/crypto.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "collado-sync-test-"));
const w = (p, c = "x") => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const PASS = "una-contraseña-larga";

/** A "computer": its own data folders, sync state and backups. `cloud` is the shared folder that plays Google Drive. */
function computer(name, cloud, master, { now } = {}) {
  const base = tmp(), appdata = path.join(base, "data/appdata"), home = path.join(base, "data/homes/yo"), gw = path.join(base, "gateway"), clock = now || (() => Date.now());
  const engine = new SyncEngine({ provider: new FolderProvider({ dir: cloud }), master, device: { id: name, name }, statePath: path.join(base, "sync/state.json"), backupsDir: path.join(base, "sync/backups"), now: clock,
    roots: [{ ns: "appdata", dir: appdata, sqlite: true }, { ns: "home", dir: home }, { ns: "gateway", dir: gw, exclude: (r) => r !== "auth.json" }] });
  return { base, appdata, home, gw, engine };
}
const seedA = (c) => {
  const db = new DatabaseSync(path.join(c.appdata, "collado.db")); fs.mkdirSync(c.appdata, { recursive: true });
  return db;
};
function makeDb(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); const db = new DatabaseSync(file); db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS t(id INTEGER PRIMARY KEY, v TEXT)"); for (const r of rows) db.prepare("INSERT INTO t(v) VALUES (?)").run(r); return db; }
const rowsOf = (file) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare("SELECT v FROM t ORDER BY id").all().map((r) => r.v); } finally { db.close(); } };

async function setup() {
  const cloud = tmp(), provider = new FolderProvider({ dir: cloud }); await provider.init();
  const master = await initRemote(provider, PASS);
  return { cloud, provider, master };
}

test("sync: a workspace pushed from one computer arrives intact on another; databases are consistent; credentials and machine-specific links never travel", async () => {
  const { cloud, master } = await setup(), A = computer("equipo-A", cloud, master), B = computer("equipo-B", cloud, master);
  const live = makeDb(path.join(A.appdata, "collado.db"), ["uno", "dos"]); makeDb(path.join(A.appdata, "orgs/acme/collado.db"), ["acme"]).close();   // `live` stays open and in WAL mode, like the running app
  w(path.join(A.appdata, "data.key"), "k".repeat(64)); w(path.join(A.appdata, "files/ab/cd.bin"), "adjunto cifrado"); w(path.join(A.home, "work/guion.md"), "# Guion\nhola");
  w(path.join(A.home, ".claude/.credentials.json"), "SECRETO"); w(path.join(A.home, ".claude/settings.json"), "{}"); w(path.join(A.home, ".collado/token"), "TOKEN"); w(path.join(A.home, "work/node_modules/x/index.js"), "x");
  fs.mkdirSync(path.join(A.home, "Proyectos"), { recursive: true }); fs.symlinkSync(os.tmpdir(), path.join(A.home, "Proyectos/enlace")); w(path.join(A.gw, "auth.json"), '{"orgs":{}}'); w(path.join(A.gw, "sessions.json"), "{}");
  const r = await A.engine.push(); live.close();
  assert.equal(r.generation, 1); assert.ok(r.uploaded >= 7);
  for (const f of fs.readdirSync(cloud)) { const txt = fs.readFileSync(path.join(cloud, f)).toString("latin1"); for (const secret of ["SECRETO", "TOKEN", "hola", "adjunto cifrado", "guion", "SQLite format", "collado.db"]) if (f !== "config.json") assert.ok(!txt.includes(secret), `${f} leaks ${secret}`); }
  assert.ok(fs.readdirSync(cloud).every((f) => f === "config.json" || f === "manifest.bin" || /^o-[0-9a-f]{48}$/.test(f)), "object names are opaque");

  w(path.join(B.home, ".claude/.credentials.json"), "OTRO-SECRETO"); w(path.join(B.home, "local-only.txt"), "solo aquí");
  const p = await B.engine.pull(); assert.equal(p.generation, 1);
  assert.deepEqual(rowsOf(path.join(B.appdata, "collado.db")), ["uno", "dos"]); assert.deepEqual(rowsOf(path.join(B.appdata, "orgs/acme/collado.db")), ["acme"]);
  assert.equal(fs.readFileSync(path.join(B.appdata, "data.key"), "utf8"), "k".repeat(64)); assert.equal(fs.readFileSync(path.join(B.home, "work/guion.md"), "utf8"), "# Guion\nhola"); assert.equal(fs.readFileSync(path.join(B.appdata, "files/ab/cd.bin"), "utf8"), "adjunto cifrado");
  assert.equal(fs.readFileSync(path.join(B.home, ".claude/.credentials.json"), "utf8"), "OTRO-SECRETO", "B's own credentials are untouched"); assert.ok(fs.existsSync(path.join(B.home, "local-only.txt")), "files that were never synced stay");
  for (const nope of [".collado/token", "work/node_modules", "Proyectos"]) assert.ok(!fs.existsSync(path.join(B.home, nope)), nope);
  assert.ok(!fs.existsSync(path.join(B.gw, "sessions.json")) && fs.existsSync(path.join(B.gw, "auth.json")));
  assert.equal((await B.engine.pull()).upToDate, true);
});

test("sync: wrong or weak passphrases are refused; a tampered or missing object stops the pull before anything is changed", async () => {
  const { cloud, provider, master } = await setup(), A = computer("A", cloud, master), B = computer("B", cloud, master);
  await assert.rejects(unlockRemote(provider, "otra contraseña distinta"), { code: "bad_passphrase" }); await assert.doesNotReject(unlockRemote(provider, PASS));
  await assert.rejects(initRemote(provider, "x"), { code: "weak_passphrase" }); await assert.rejects(initRemote(new FolderProvider({ dir: tmp() }), "corta"), { code: "weak_passphrase" }); await assert.rejects(initRemote(provider, PASS), { code: "remote_exists" });
  w(path.join(A.home, "a.txt"), "contenido A"); w(path.join(A.home, "b.txt"), "contenido B"); await A.engine.push();
  const objs = fs.readdirSync(cloud).filter((f) => f.startsWith("o-")); const victim = path.join(cloud, objs[0]), good = fs.readFileSync(victim);
  const bad = Buffer.from(good); bad[bad.length - 1] ^= 1; fs.writeFileSync(victim, bad); w(path.join(B.home, "a.txt"), "mío"); w(path.join(B.home, "b.txt"), "mío");
  await assert.rejects(B.engine.pull(), (e) => e instanceof Error && /bad_key|object_corrupt/.test(e.message)); assert.equal(fs.readFileSync(path.join(B.home, "a.txt"), "utf8"), "mío", "nothing was changed");
  fs.rmSync(victim); await assert.rejects(B.engine.pull(), { code: "object_missing" }); assert.equal(fs.readFileSync(path.join(B.home, "b.txt"), "utf8"), "mío");
  const wrong = new SyncEngine({ ...B.engine, provider: B.engine.provider, master: masterFrom("otra contraseña", newSalt()), device: { id: "C", name: "C" }, roots: B.engine.roots, statePath: path.join(tmp(), "s.json"), backupsDir: tmp() });
  await assert.rejects(wrong.readManifest(), { code: "bad_passphrase" });
});

test("sync: incremental pushes upload only what changed and garbage-collect what nobody references any more", async () => {
  const { cloud, master } = await setup(), A = computer("A", cloud, master);
  w(path.join(A.home, "uno.txt"), "uno"); w(path.join(A.home, "dos.txt"), "dos"); w(path.join(A.home, "copia.txt"), "uno");   // duplicate content = one object
  const r1 = await A.engine.push(); assert.equal(r1.uploaded, 2); const n1 = fs.readdirSync(cloud).filter((f) => f.startsWith("o-")).length; assert.equal(n1, 2);
  const r2 = await A.engine.push(); assert.equal(r2.uploaded, 0); assert.equal(r2.generation, 1, "no change, no new generation");
  await new Promise((r) => setTimeout(r, 15)); w(path.join(A.home, "dos.txt"), "dos v2"); const r3 = await A.engine.push(); assert.equal(r3.uploaded, 1); assert.equal(r3.generation, 2); assert.equal(r3.removed, 1, "the old content of dos.txt is gone from the cloud");
  assert.equal(fs.readdirSync(cloud).filter((f) => f.startsWith("o-")).length, 2); const ch = await A.engine.localChanges(); assert.equal(ch.dirty, false);
  fs.rmSync(path.join(A.home, "uno.txt")); assert.deepEqual((await A.engine.localChanges()).removed, ["home/uno.txt"]);
  const big = computer("big", cloud, master); big.engine.maxFile = 10; w(path.join(big.home, "grande.bin"), "x".repeat(50)); w(path.join(big.home, "ok.txt"), "ok"); const rb = await big.engine.scan(); assert.deepEqual([...rb.keys()], ["home/ok.txt"]); assert.equal(big.engine.skipped.length, 1);
});

test("sync: one computer at a time (lease); a newer cloud copy must be pulled first; deletions propagate; replaced files are backed up", async () => {
  const { cloud, master } = await setup(); let t = 1_000_000; const clock = () => t;
  const A = computer("equipo-A", cloud, master, { now: clock }), B = computer("equipo-B", cloud, master, { now: clock });
  w(path.join(A.home, "doc.txt"), "v1"); w(path.join(A.home, "borrame.txt"), "adiós"); await A.engine.push();
  await assert.rejects(B.engine.push(), { code: "lease_held", by: "equipo-A" }); const chk = await B.engine.checkRemote(); assert.equal(chk.exists, true); assert.equal(chk.lease.name, "equipo-A"); assert.equal(chk.newer, true);
  await A.engine.releaseLease(); assert.equal((await B.engine.checkRemote()).lease, null);
  await assert.rejects(B.engine.push(), { code: "remote_newer" }, "B has never pulled: pushing would overwrite A's work");
  w(path.join(B.home, "doc.txt"), "versión local de B"); const pr = await B.engine.pull(); assert.ok(pr.backup && pr.backedUp >= 1);
  assert.equal(fs.readFileSync(path.join(B.home, "doc.txt"), "utf8"), "v1"); assert.equal(fs.readFileSync(path.join(pr.backup, "home/doc.txt"), "utf8"), "versión local de B", "what pull replaced is recoverable");
  fs.rmSync(path.join(B.home, "borrame.txt")); w(path.join(B.home, "nuevo.txt"), "de B"); await B.engine.push(); await B.engine.releaseLease();
  await A.engine.pull(); assert.ok(!fs.existsSync(path.join(A.home, "borrame.txt")), "deleted on B, deleted on A"); assert.equal(fs.readFileSync(path.join(A.home, "nuevo.txt"), "utf8"), "de B");
  const bk = fs.readdirSync(A.engine.backupsDir).sort().pop(); assert.equal(fs.readFileSync(path.join(A.engine.backupsDir, bk, "home/borrame.txt"), "utf8"), "adiós");
  await A.engine.push(); t += LEASE_MS + 1; await B.engine.pull(); await B.engine.push(); assert.equal((await A.engine.checkRemote()).lease.name, "equipo-B", "an expired lease (a crashed computer) can be taken");
  t += 10; await assert.rejects(A.engine.push(), (e) => ["lease_held", "remote_newer"].includes(e.code)); await A.engine.pull(); await assert.doesNotReject(A.engine.push({ force: true }), "taking over is an explicit decision");
});

test("sync: the engine refuses paths that leave its roots, and database snapshots are stable when nothing changed", async () => {
  const { cloud, master } = await setup(), A = computer("A", cloud, master);
  for (const bad of ["appdata/../../etc/passwd", "nope/x", "home//x", "home/a/../../b"]) assert.throws(() => A.engine.abs(bad), (e) => e instanceof SyncError);
  const db = makeDb(path.join(A.appdata, "collado.db"), ["a"]); w(path.join(A.home, "x.txt"), "x"); await A.engine.push();
  assert.equal((await A.engine.localChanges()).dirty, false, "an idle database does not look modified (fingerprint, not a second snapshot)");
  db.prepare("INSERT INTO t(v) VALUES ('b')").run(); assert.deepEqual((await A.engine.localChanges()).changed, ["appdata/collado.db"], "a write that is still only in the WAL is noticed");
  const r = await A.engine.push(); assert.equal(r.uploaded, 1); db.close();
  const B = computer("B", cloud, master); await A.engine.releaseLease(); await B.engine.pull(); assert.deepEqual(rowsOf(path.join(B.appdata, "collado.db")), ["a", "b"], "the WAL content reached the other computer");
});
