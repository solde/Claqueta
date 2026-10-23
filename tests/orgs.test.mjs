// Unit tests of multi-organization isolation in the app (app/lib/db.mjs): separate databases, settings, sequences, encryption sub-keys and attachments per company.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Multi-company isolation inside the app: one SQLite file, one attachments folder and one set of encryption sub-keys per organization
const APP = path.resolve(import.meta.dirname, "../app-seed/app");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-orgs-"));
const D = await import(`${APP}/lib/db.mjs`); const { q, inOrg, setOrgInit, syncSchema, listOrgSlugs, currentSlug } = D;
const C = await import(`${APP}/lib/crypto.mjs`); const E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`);
const F = await import(`${APP}/lib/files.mjs`); const { localCtx } = await import(`${APP}/lib/access.mjs`);
C.initKey(T); C.setOrgResolver(currentSlug); D.openDb(T);
setOrgInit(async () => { syncSchema(); F.initFiles(); });
syncSchema(); F.initFiles();
const ctxIn = (org) => ({ ...localCtx("david"), org });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("each organization has its own database; concurrent requests never see each other's rows", async () => {
  const work = (org, name, n) => inOrg(org, async () => {
    for (let i = 0; i < n; i++) { await E.create(ctxIn(org), "programs", { name: `${name} ${i}`, kind: "magazine" }); await sleep(5); }   // awaiting between writes: the context must survive it
    return q.all("SELECT name FROM programs ORDER BY id").map((r) => r.name);
  });
  const [a, b, c] = await Promise.all([work("principal", "Principal", 4), work("acme", "Acme", 3), work("beta-tv", "Beta", 2)]);
  assert.equal(a.length, 4); assert.ok(a.every((x) => x.startsWith("Principal")));
  assert.equal(b.length, 3); assert.ok(b.every((x) => x.startsWith("Acme")));
  assert.equal(c.length, 2); assert.ok(c.every((x) => x.startsWith("Beta")));
  assert.ok(fs.existsSync(path.join(T, "collado.db")) && fs.existsSync(path.join(T, "orgs/acme/collado.db")) && fs.existsSync(path.join(T, "orgs/beta-tv/collado.db")), "legacy data stays where it was; the others live under orgs/");
  assert.deepEqual(listOrgSlugs().sort(), ["acme", "beta-tv", "principal"]);
  await assert.rejects(inOrg("../etc", () => 1), /invalid_org/); await assert.rejects(inOrg("Bad Org", () => 1), /invalid_org/);
  assert.equal(q.all("SELECT * FROM programs").length, 4, "outside a request the legacy organization is used");
});

test("settings, sequences and transactions are per organization", async () => {
  await inOrg("acme", () => { D.setSetting("company", { name: "Acme TV" }); assert.equal(D.nextSeq("inv"), 1); assert.equal(D.nextSeq("inv"), 2); });
  await inOrg("beta-tv", () => { assert.equal(D.getSetting("company"), null); assert.equal(D.nextSeq("inv"), 1); });
  await Promise.all([inOrg("acme", async () => D.tx(() => { q.run("INSERT INTO settings(key,value) VALUES ('t','1')"); })), inOrg("beta-tv", async () => { await sleep(2); D.tx(() => { q.run("INSERT INTO settings(key,value) VALUES ('t','2')"); }); })]);
  assert.equal(await inOrg("acme", () => q.get("SELECT value FROM settings WHERE key='t'").value), "1"); assert.equal(await inOrg("beta-tv", () => q.get("SELECT value FROM settings WHERE key='t'").value), "2");
});

test("every organization has its own encryption sub-keys; the legacy one keeps the original ones", async () => {
  const enc = await inOrg("acme", () => C.encField("ES91 2100 0418 4502 0005 1332"));
  assert.equal(await inOrg("acme", () => C.decField(enc)), "ES91 2100 0418 4502 0005 1332");
  assert.throws(() => C.decField(enc), "the legacy organization cannot read Acme's ciphertext");
  await assert.rejects(inOrg("beta-tv", () => C.decField(enc)));
  const buf = await inOrg("acme", () => C.encBuffer(Buffer.from("secret contract")));
  assert.throws(() => C.decBuffer(buf)); assert.equal(await inOrg("acme", () => C.decBuffer(buf).toString()), "secret contract");
  const old = C.encField("legacy value"); assert.equal(C.decField(old), "legacy value");
});

test("attachments are stored and read per organization", async () => {
  const mk = (org) => inOrg(org, async () => {
    const p = q.get("SELECT id FROM programs ORDER BY id LIMIT 1");
    const a = F.addFile(ctxIn(org), { entity: "programs", id: p.id, name: "c.txt", mime: "text/plain", buffer: Buffer.from(`file of ${org}`) });
    return { id: a.id };
  });
  const a = await mk("acme"); const b = await mk("beta-tv");
  assert.ok(fs.readdirSync(path.join(T, "orgs/acme/files")).length === 1 && fs.readdirSync(path.join(T, "orgs/beta-tv/files")).length === 1);
  assert.equal(await inOrg("acme", () => F.readFile(ctxIn("acme"), a.id).buffer.toString()), "file of acme");
  assert.equal(await inOrg("beta-tv", () => F.readFile(ctxIn("beta-tv"), b.id).buffer.toString()), "file of beta-tv");
  // the same numeric id in another organization is a different (or no) file: it can never serve Acme's bytes
  const other = await inOrg("beta-tv", () => { try { return F.readFile(ctxIn("beta-tv"), a.id).buffer.toString(); } catch { return "none"; } });
  assert.notEqual(other, "file of acme");
});
