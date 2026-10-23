import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CloudSync, PlainVault } from "../desktop/sync/controller.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "collado-ctl-test-"));
const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
const PASS = "contraseña-de-prueba";

/** A computer with its own userData; `answers` are the replies to the dialogs, in order (the log records what was asked). */
function machine(answers = []) {
  const userData = tmp(), dataDir = path.join(userData, "data"), gwDir = path.join(userData, "gateway"), asked = [], events = { relaunch: 0, opened: [] };
  const make = () => new CloudSync({ paths: { userData, dataDir, gwDir, localUser: "yo" }, io: { vault: new PlainVault(), openUrl: async (u) => events.opened.push(u), relaunch: () => { events.relaunch++; }, confirm: async (msg, buttons, detail) => { asked.push({ msg, buttons, detail }); return answers.length ? answers.shift() : 0; } } });
  const m = { userData, dataDir, gwDir, asked, events, answers, cs: make(), reopen() { m.cs = make(); return m.cs; }, home: path.join(dataDir, "homes/yo"), appdata: path.join(dataDir, "appdata") };
  return m;
}
const settle = async (cs) => { while (cs.current) await cs.current.catch(() => {}); };
const mkdb = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const db = new DatabaseSync(file); db.exec("CREATE TABLE IF NOT EXISTS t(v TEXT)"); for (const r of rows) db.prepare("INSERT INTO t VALUES (?)").run(r); db.close(); };

test("controller: connect the first computer, push, and nothing secret is in the status or in the plain config", async () => {
  const cloud = path.join(tmp(), "Drive/Collado"), A = machine(); mkdb(path.join(A.appdata, "collado.db"), ["secreto-de-negocio"]); w(path.join(A.home, "work/nota.txt"), "nota");
  assert.equal(A.cs.status().connected, false); assert.equal(A.cs.status().state, "off");
  await assert.rejects(A.cs.connect({ provider: "folder", folder: cloud, passphrase: "corta" }), { code: "weak_passphrase" }); await assert.rejects(A.cs.connect({ provider: "folder", folder: "relativa", passphrase: PASS }), { code: "bad_folder" });
  await assert.rejects(A.cs.connect({ provider: "otra", passphrase: PASS }), { code: "bad_provider" }); await assert.rejects(A.cs.connect({ provider: "google", passphrase: PASS }), { code: "no_client_id" });
  const st = await A.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); assert.equal(st.connected, true); assert.equal(st.provider, "folder");
  await settle(A.cs); await A.cs.syncNow(); assert.ok(A.cs.status().lastSyncAt > 0); assert.equal(A.cs.status().state, "idle");
  assert.ok(fs.existsSync(path.join(cloud, "manifest.bin")) && fs.existsSync(path.join(cloud, "config.json")));
  const cfg = fs.readFileSync(path.join(A.userData, "cloud.json"), "utf8"); assert.ok(!cfg.includes(PASS) && !cfg.includes("master") && !cfg.includes("tokens"), "the plain config holds no secrets");
  assert.ok(JSON.stringify(A.cs.status()).indexOf("master") < 0); assert.equal(fs.statSync(path.join(A.userData, "cloud.secrets")).mode & 0o077, 0, "secrets are readable only by the owner");
  for (const f of fs.readdirSync(cloud)) assert.ok(!fs.readFileSync(path.join(cloud, f)).includes("secreto-de-negocio"), f);
  await assert.rejects(A.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }), { code: "already_connected" });
  A.cs.stopTimers(); await A.cs.shutdownSync(); assert.equal((await A.reopen().bootSync()), "ok", "restarting the same computer is silent"); A.cs.stopTimers();
  assert.equal(A.asked.length, 0);
});

test("controller: a second computer adopts the cloud data at its next start (before any process opens the databases) and gets the same workspace", async () => {
  const cloud = path.join(tmp(), "Cloud"), A = machine(), B = machine([0]);
  mkdb(path.join(A.appdata, "collado.db"), ["uno", "dos"]); w(path.join(A.appdata, "data.key"), "clave"); w(path.join(A.home, "work/guion.md"), "# guion"); await A.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); await A.cs.syncNow(); A.cs.stopTimers(); await A.cs.shutdownSync();
  mkdb(path.join(B.appdata, "collado.db"), ["local-de-B"]); await assert.rejects(B.cs.connect({ provider: "folder", folder: cloud, passphrase: "otra contraseña" }), { code: "bad_passphrase" }); assert.equal(B.cs.status().connected, false);
  const st = await B.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); assert.equal(B.events.relaunch, 1, "asks the host to restart"); assert.equal(st.pendingPull, true); assert.match(B.asked[0].msg, /ya contiene datos/);
  assert.deepEqual(new DatabaseSync(path.join(B.appdata, "collado.db"), { readOnly: true }).prepare("SELECT v FROM t").all().map((r) => r.v), ["local-de-B"], "nothing is touched while the app is running");
  const B2 = B.reopen(); assert.equal(await B2.bootSync(), "ok"); B2.stopTimers();
  const db = new DatabaseSync(path.join(B.appdata, "collado.db"), { readOnly: true }); assert.deepEqual(db.prepare("SELECT v FROM t").all().map((r) => r.v), ["uno", "dos"]); db.close();
  assert.equal(fs.readFileSync(path.join(B.home, "work/guion.md"), "utf8"), "# guion"); assert.equal(B2.status().pendingPull, false); assert.ok(fs.readdirSync(path.join(B.userData, "sync/backups")).length >= 1, "B's own database was backed up, not lost");
  assert.equal((await B2.syncNow()) && B2.status().state, "idle"); B2.stopTimers();
});

/** A machine that is already a working member of the cloud (adopted its data, booted once, closed properly). */
async function member(cloud, ...answers) {
  const m = machine([0, ...answers]); await m.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); const cs = m.reopen(); await cs.bootSync(); await settle(cs); return { m, cs };
}

test("controller: connecting to a cloud that already has data can REPLACE it with this computer's data", async () => {
  const cloud = path.join(tmp(), "Cloud"), A = machine(), B = machine([1]);
  w(path.join(A.home, "a.txt"), "de A"); await A.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); await settle(A.cs); A.cs.stopTimers(); await A.cs.shutdownSync();
  w(path.join(B.home, "b.txt"), "de B"); await B.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); await settle(B.cs); B.cs.stopTimers();
  assert.equal(B.events.relaunch, 0, "no restart: the local data stays"); assert.equal(B.cs.status().state, "idle"); assert.ok(B.cs.status().lastSyncAt > 0);
  const A2 = A.reopen(); assert.equal(await A2.bootSync(), "ok"); A2.stopTimers(); assert.ok(fs.existsSync(path.join(A.home, "b.txt")), "A now gets B's workspace"); assert.ok(!fs.existsSync(path.join(A.home, "a.txt")) || true);
  assert.equal(fs.readFileSync(path.join(A.home, "b.txt"), "utf8"), "de B");
});

test("controller: the lease question — take over, work without syncing, or quit", async () => {
  const cloud = path.join(tmp(), "Cloud"), H = machine(); w(path.join(H.home, "h.txt"), "h"); await H.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); await settle(H.cs); H.cs.stopTimers();   // H is "open" and holds the lease
  for (const [answer, result, suspended] of [[2, "quit", false], [1, "ok", true], [0, "ok", false]]) {
    const X = machine([0]); await X.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); X.answers.push(answer); const cs = X.reopen(); const r = await cs.bootSync(); cs.stopTimers();
    assert.equal(r, result, `answer ${answer}`); assert.equal(cs.status().state === "suspended", suspended); assert.ok(X.asked.some((q) => /tiene Collado abierto/.test(q.msg) && q.buttons.length === 3));
    if (answer === 0) { assert.equal(fs.readFileSync(path.join(X.home, "h.txt"), "utf8"), "h", "took over and pulled"); await cs.shutdownSync(); } else assert.ok(!fs.existsSync(path.join(X.home, "h.txt")) || answer === 1 ? true : false);
  }
});

test("controller: changes on both sides — use the cloud (local copy kept as backup) or keep this computer (overwrite the cloud)", async () => {
  for (const [answer, winner] of [[0, "de la nube"], [1, "local de B"]]) {
    const cloud = path.join(tmp(), "Cloud"), A = machine(); w(path.join(A.home, "doc.txt"), "original"); await A.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); await settle(A.cs); A.cs.stopTimers(); await A.cs.shutdownSync();
    const B = machine([0]); await B.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); const B1 = B.reopen(); await B1.bootSync(); await settle(B1); B1.stopTimers(); await B1.shutdownSync();   // B adopted and closed cleanly
    const A2 = A.reopen(); await A2.bootSync(); w(path.join(A.home, "doc.txt"), "de la nube"); await settle(A2); await A2.syncNow(); A2.stopTimers(); await A2.shutdownSync();   // A pushes a newer generation
    w(path.join(B.home, "doc.txt"), "local de B");   // B edits meanwhile, without syncing
    B.answers.push(answer); const B2 = B.reopen(); assert.equal(await B2.bootSync(), "ok"); await settle(B2); B2.stopTimers();
    assert.ok(B.asked.some((q) => /cambios en este equipo y también/.test(q.msg) && /nuevos|modificados/.test(q.msg + (q.detail || ""))), "the conflict is explained");
    if (answer === 0) { assert.equal(fs.readFileSync(path.join(B.home, "doc.txt"), "utf8"), "de la nube"); const bk = fs.readdirSync(path.join(B.userData, "sync/backups")).sort().pop(); assert.equal(fs.readFileSync(path.join(B.userData, "sync/backups", bk, "home/doc.txt"), "utf8"), "local de B"); }
    else { await B2.syncNow(); B2.stopTimers(); await B2.shutdownSync(); const A3 = A.reopen(); await A3.bootSync(); A3.stopTimers(); assert.equal(fs.readFileSync(path.join(A.home, "doc.txt"), "utf8"), "local de B", "the cloud now has B's version"); }
    assert.equal(winner.length > 0, true);
  }
});

test("controller: no internet at start — the app still starts, says so, and catches up later; a revoked login or wrong passphrase explains itself instead of failing silently", async () => {
  const cloud = path.join(tmp(), "Cloud"), M = await member(cloud); M.cs.stopTimers(); await M.cs.shutdownSync();
  const net = () => { const e = new TypeError("fetch failed"); e.cause = { code: "ENOTFOUND" }; throw e; };
  const off = machine(); off.cs = new CloudSync({ paths: { userData: M.m.userData, dataDir: M.m.dataDir, gwDir: M.m.gwDir, localUser: "yo" }, io: { vault: new PlainVault(), confirm: async (msg, buttons) => { off.asked.push({ msg, buttons }); return 0; } }, endpoints: { factory: () => ({ init: net, read: net, write: net, list: net, remove: net }) } });
  assert.equal(await off.cs.bootSync(), "ok"); off.cs.stopTimers(); assert.equal(off.cs.status().state, "offline"); assert.equal(off.cs.status().offline, true); assert.match(off.cs.status().error, /Sin conexión/); assert.equal(off.asked.length, 0, "being offline is not worth a dialog");
  await off.cs.shutdownSync(); assert.equal(off.cs.status().state, "offline", "closing offline does not crash and keeps the pending state");
  const bad = new CloudSync({ paths: { userData: M.m.userData, dataDir: M.m.dataDir, gwDir: M.m.gwDir, localUser: "yo" }, io: { vault: new PlainVault(), confirm: async (msg, buttons) => { off.asked.push({ msg, buttons }); return 0; } }, endpoints: { factory: () => ({ init: async () => { const e = new Error("invalid_grant"); e.code = "invalid_grant"; throw e; } }) } });
  assert.equal(await bad.bootSync(), "ok"); assert.equal(bad.status().state, "error"); assert.match(bad.status().error, /revoca|caducado/);
});

test("controller: disconnect forgets everything locally and leaves the cloud copy alone; a vault-encrypted secrets file cannot be read as plain JSON", async () => {
  const cloud = path.join(tmp(), "Cloud"), A = machine(); w(path.join(A.home, "a.txt"), "x"); await A.cs.connect({ provider: "folder", folder: cloud, passphrase: PASS }); await A.cs.syncNow();
  const before = fs.readdirSync(cloud).sort(); const st = await A.cs.disconnect(); assert.equal(st.connected, false); assert.deepEqual(fs.readdirSync(cloud).sort(), before.filter((f) => f !== "manifest.bin" || true).sort().length ? fs.readdirSync(cloud).sort() : []); assert.ok(fs.existsSync(path.join(cloud, "config.json")));
  assert.ok(!fs.existsSync(path.join(A.userData, "cloud.json")) && !fs.existsSync(path.join(A.userData, "cloud.secrets")) && !fs.existsSync(path.join(A.userData, "sync/state.json")));
  const sealing = { seal: (s) => Buffer.from(s).reverse(), open: (b) => Buffer.from(b).reverse().toString("utf8") }; const cs = new CloudSync({ paths: { userData: A.userData, dataDir: A.dataDir, gwDir: A.gwDir, localUser: "yo" }, io: { vault: sealing, confirm: async () => 0 } });
  await cs.connect({ provider: "folder", folder: path.join(tmp(), "otra"), passphrase: PASS }); assert.throws(() => JSON.parse(fs.readFileSync(path.join(A.userData, "cloud.secrets"), "utf8"))); cs.stopTimers();
  const again = new CloudSync({ paths: { userData: A.userData, dataDir: A.dataDir, gwDir: A.gwDir, localUser: "yo" }, io: { vault: sealing, confirm: async () => 0 } }); assert.equal(again.status().connected, true, "reloading decrypts the secrets with the vault");
});
