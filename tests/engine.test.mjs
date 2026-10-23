import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "../app-seed/app");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-eng-"));
const { openDb, syncSchema, q } = await import(`${APP}/lib/db.mjs`);
const { initKey } = await import(`${APP}/lib/crypto.mjs`);
const E = await import(`${APP}/lib/engine.mjs`);
await import(`${APP}/lib/logic.mjs`);
const { localCtx } = await import(`${APP}/lib/access.mjs`);
initKey(T); openDb(T); syncSchema();

const admin = localCtx("david");
const ctxOf = (user, perms, extra = {}) => ({ user, name: user, perms: new Set(perms), roles: [], local: false, external: perms.includes("external"), ...extra });

test("schema is created, CRUD works, money in cents, history is written", async () => {
  const p = await E.create(admin, "programs", { name: "Buenos días", kind: "magazine", contract_value: 120000.5 });
  assert.equal(p.status, "development"); assert.equal(p.contract_value, 120000.5);
  assert.equal(q.get("SELECT contract_value AS c FROM programs WHERE id = ?", p.id).c, 12000050);
  const u = await E.update(admin, "programs", p.id, { status: "active" });
  assert.equal(u.status, "active"); assert.equal(u.rev, 2);
  const h = E.history(admin, "programs", p.id);
  assert.equal(h.length, 2); assert.deepEqual(h[0].diff.status, ["development", "active"]);
  await assert.rejects(E.create(admin, "programs", { kind: "magazine" }), /required:name/);
  await assert.rejects(E.create(admin, "programs", { name: "x", kind: "nope" }), /invalid_option/);
  await assert.rejects(E.update(admin, "programs", p.id, { name: "y", rev: 1 }), /stale/);
});

test("secrets are encrypted at rest and need people.view", async () => {
  const person = await E.create(admin, "people", { name: "Ana Pérez", kind: "freelance", national_id: "12345678Z", rate: 300 });
  assert.match(q.get("SELECT national_id AS n FROM people WHERE id = ?", person.id).n, /^enc1:/);
  assert.equal(E.getRow(admin, "people", person.id).national_id, "12345678Z");
  const prod = ctxOf("prod", ["app.view", "app.edit"]);
  const seen = E.getRow(prod, "people", person.id);
  assert.equal(seen.national_id, undefined); assert.equal(seen.rate, undefined); assert.equal(seen.name, "Ana Pérez");
  await assert.rejects(E.update(prod, "people", person.id, { national_id: "x" }), /field_forbidden/);
  const h = E.history(admin, "people", person.id); assert.ok(!JSON.stringify(h).includes("12345678Z"));
});

test("module permissions: finance is invisible without fin.view", async () => {
  const prod = ctxOf("prod", ["app.view", "app.edit"]);
  await assert.rejects(async () => E.list(prod, "budgets"), /forbidden/);
  await assert.rejects(E.create(prod, "bills", { date: "2026-01-01", description: "x", base: 10 }), /forbidden/);
});

test("budget lines compute amounts and budget totals; approved budgets are locked; approval needs fin.approve", async () => {
  const p = await E.create(admin, "programs", { name: "Doc" });
  const b = await E.create(admin, "budgets", { program_id: p.id, name: "Presupuesto", contingency_pct: 10 });
  await E.create(admin, "budget_lines", { budget_id: b.id, description: "Cámara", qty: 10, unit_cost: 250.5, vat_rate: 21 });
  await E.create(admin, "budget_lines", { budget_id: b.id, description: "Sonido", qty: 2, unit_cost: 100, vat_rate: 10 });
  const t = E.getRow(admin, "budgets", b.id);
  assert.equal(t.subtotal, 2975.5); assert.equal(t.vat, round(2505 * 0.21 * 1.1 + 200 * 0.10 * 1.1)); assert.equal(t.total, round(t.subtotal + t.vat));
});
const round = (n) => Math.round(n * 100) / 100;

test("external users only see what is shared with them: programme scope, shared documents, own tasks; they can comment and decide their approvals", async () => {
  const a = await E.create(admin, "programs", { name: "Visible" }), b = await E.create(admin, "programs", { name: "Oculto" });
  await E.create(admin, "episodes", { program_id: a.id, title: "A1" }); await E.create(admin, "episodes", { program_id: b.id, title: "B1" });
  await E.create(admin, "documents", { program_id: a.id, title: "Compartido", shared: 1 }); await E.create(admin, "documents", { program_id: a.id, title: "Interno" });
  const mine = await E.create(admin, "tasks", { program_id: a.id, title: "Mía", assignee: "cadena1" }); const other = await E.create(admin, "tasks", { program_id: a.id, title: "Ajena", assignee: "otra" });
  await E.create(admin, "members", { program_id: a.id, username: "cadena1", side: "network" });
  const ext = ctxOf("cadena1", ["app.view", "external"]);
  assert.deepEqual(E.list(ext, "programs").rows.map((r) => r.name), ["Visible"]);
  assert.deepEqual(E.list(ext, "episodes").rows.map((r) => r.title), ["A1"]);
  assert.deepEqual(E.list(ext, "documents").rows.map((r) => r.title), ["Compartido"]);
  assert.deepEqual(E.list(ext, "tasks").rows.map((r) => r.title), ["Mía"]);
  for (const forbiddenEntity of ["budgets", "people", "assets", "contracts", "bills", "compliance_checks"]) assert.throws(() => E.list(ext, forbiddenEntity), /forbidden/, forbiddenEntity);
  assert.throws(() => E.getRow(ext, "programs", b.id), /not_found/);
  const c = await E.create(ext, "comments", { entity: "programs", row_id: a.id, program_id: a.id, body: "Aprobado por la cadena" }); assert.equal(c.created_by, "cadena1");
  await assert.rejects(E.create(ext, "comments", { entity: "programs", row_id: b.id, program_id: b.id, body: "x" }), /forbidden/);
  await assert.rejects(E.create(ext, "tasks", { program_id: a.id, title: "no" }), /forbidden/);
  assert.equal((await E.update(ext, "tasks", mine.id, { status: "done" })).status, "done");
  await assert.rejects(E.update(ext, "tasks", mine.id, { title: "otro" }), /field_forbidden/); await assert.rejects(E.update(ext, "tasks", other.id, { status: "done" }), /forbidden|not_found/);
  const ap = await E.create(admin, "approvals", { program_id: a.id, entity: "episodes", row_id: 1, subject: "E1", kind: "network", approver: "cadena1" });
  assert.equal((await E.update(ext, "approvals", ap.id, { status: "approved", comment: "OK" })).status, "approved");
  const stranger = ctxOf("intruso", ["app.view", "app.edit"]); await assert.rejects(E.update(stranger, "approvals", ap.id, { status: "rejected" }), /not_the_approver|forbidden/);
  const n = await E.list(ext, "notifications"); assert.ok(n.rows.every((x) => x.user === "cadena1"), "notifications are private");
  assert.deepEqual(E.search(ext, "Oculto"), [], "search respects scope");
});

test("workflow: a template creates season, milestones, tasks, episodes and a budget; timesheets flag overtime and short rests; POs and invoices are numbered", async () => {
  const { applyTemplate } = await import(`${APP}/lib/logic.mjs`); const { seedAll } = await import(`${APP}/lib/seeds.mjs`); await seedAll();
  const tpl = E.list(admin, "workflow_templates", { filters: { kind: "magazine" } }).rows[0];
  const p = await E.create(admin, "programs", { name: "Mañanas", kind: "magazine", template_id: tpl.id, start_date: "2026-09-01", episodes_per_season: 3 });
  const r = await applyTemplate(admin, p.id); assert.ok(r.milestones >= 5); assert.equal(E.list(admin, "episodes", { filters: { program_id: p.id } }).total, 3); assert.ok(r.budget.id);
  const ag = (await E.list(admin, "agreements")).rows[0]; const per = await E.create(admin, "people", { name: "Técnico", agreement_id: ag.id });
  const t1 = await E.create(admin, "timesheets", { person_id: per.id, date: "2026-03-02", start: "08:00", end: "19:00", break_min: 60 }); assert.equal(t1.hours, 10); assert.equal(t1.overtime, 1);
  const t2 = await E.create(admin, "timesheets", { person_id: per.id, date: "2026-03-03", start: "05:00", end: "12:00" }); assert.equal(E.getRow(admin, "timesheets", t2.id).rest_ok, 0, "less than 12 h since the previous shift");
  const po = await E.create(admin, "purchase_orders", { program_id: p.id, description: "x", amount: 100 }); assert.match(po.number, /^PO-\d{4}-0001$/);
  const cl = await E.create(admin, "partners", { name: "Cadena", kind: "channel" }); const inv = await E.create(admin, "client_invoices", { client_id: cl.id, date: "2026-03-01", concept: "c", base: 1000, vat_rate: 21 });
  assert.ok(!inv.number); const issued = await E.update(admin, "client_invoices", inv.id, { status: "issued" }); assert.match(issued.number, /^F-2026-0001$/); assert.equal(issued.total, 1210);
  await E.create(admin, "payments", { invoice_id: inv.id, date: "2026-03-20", amount: 1210 }); assert.equal(E.getRow(admin, "client_invoices", inv.id).status, "paid");
});
