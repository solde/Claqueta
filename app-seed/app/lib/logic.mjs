// Business rules attached to the engine: computed amounts, numbering, approvals, notifications, status side effects.
// Hooks receive DB-level values (money in cents) and may set any column, including read-only ones.
import { q, nextSeq, getSetting } from "./db.mjs";
import { hook, create, update, rawGet, notify, label, getRow } from "./engine.mjs";
import { has } from "./access.mjs";
import { forbidden, bad, now, today, addDays, hhmmToMin, round2 } from "./util.mjs";
import { EPISODE_STATUS } from "./schema/core.mjs";
import { ensureProjectGuide, validateProjectFolder } from "./project-guide.mjs";

const cents = (n) => Math.round(n);
const pick = (data, existing, k) => (data[k] !== undefined ? data[k] : existing?.[k]);
const year = (d) => String(d || today()).slice(0, 4);
const LINK = (entity, id) => `#/e/${entity}/${id}`;

// ---- budgets --------------------------------------------------------------------------------------------------------------------------
hook("budget_lines", "before", (op, ctx, data, ex) => {
  if (op === "delete") return;
  const qty = pick(data, ex, "qty") ?? 1, uc = pick(data, ex, "unit_cost") ?? 0;
  data.amount = cents(qty * uc);
  if (op === "create" && data.budget_id) { const b = rawGet("budgets", data.budget_id); if (b && !data.program_id) data.program_id = b.program_id; if (b && b.status === "approved") throw bad("budget_locked"); }
  if (op === "update" && ex) { const b = rawGet("budgets", ex.budget_id); if (b?.status === "approved") throw bad("budget_locked"); }
  if (op === "delete" && ex) { const b = rawGet("budgets", ex.budget_id); if (b?.status === "approved") throw bad("budget_locked"); }
});
/** Recomputes subtotal, VAT and total of a budget from its lines and contingency (money in cents). */
export function recalcBudget(id) {
  const b = rawGet("budgets", id); if (!b) return;
  const lines = q.all("SELECT amount, vat_rate FROM budget_lines WHERE budget_id = ?", id);
  const base = lines.reduce((s, l) => s + (l.amount || 0), 0), vatBase = lines.reduce((s, l) => s + (l.amount || 0) * (l.vat_rate || 0) / 100, 0);
  const k = 1 + (b.contingency_pct || 0) / 100;
  q.run("UPDATE budgets SET subtotal = ?, vat = ?, total = ? WHERE id = ?", cents(base * k), cents(vatBase * k), cents(base * k + vatBase * k), id);
}
hook("budget_lines", "after", (op, ctx, row) => recalcBudget(row.budget_id));
hook("budgets", "before", (op, ctx, data, ex) => {
  if (op === "delete") { if (ex.status === "approved") throw bad("budget_locked"); return; }
  const st = data.status;
  if (st && st !== ex?.status) {
    if (st === "approved") { if (!has(ctx, "fin.approve")) throw forbidden("needs:fin.approve"); data.approved_by = ctx.user; data.approved_at = now(); }
    else if (ex?.status === "approved" && st !== "obsolete") throw bad("budget_locked");
  }
  if (op === "update" && ex?.status === "approved" && Object.keys(data).some((k) => !["status", "notes", "approved_by", "approved_at"].includes(k))) throw bad("budget_locked");
});
hook("budgets", "after", (op, ctx, row, ex) => {
  if (op === "delete") return;
  recalcBudget(row.id);
  if (op === "update" && row.status === "approved" && ex?.status !== "approved" && row.program_id && row.kind === "budget")
    q.run("UPDATE budgets SET status = 'obsolete' WHERE program_id = ? AND name = ? AND id != ? AND status = 'approved'", row.program_id, row.name, row.id);
});

// ---- purchase orders, supplier bills, client invoices ---------------------------------------------------------------------------
hook("purchase_orders", "before", (op, ctx, data, ex) => {
  if (op === "delete") { if (ex.status !== "draft") throw bad("only_drafts_can_be_deleted"); return; }
  if (op === "create") { data.number = `PO-${year()}-${String(nextSeq(`po-${year()}`)).padStart(4, "0")}`; data.requested_by = ctx.user; if (!data.status) data.status = "draft"; }
  const st = data.status;
  if (st && st !== ex?.status && ["approved", "rejected"].includes(st)) { if (!has(ctx, "fin.approve")) throw forbidden("needs:fin.approve"); data.approved_by = ctx.user; data.approved_at = now(); }
});
hook("purchase_orders", "after", (op, ctx, row, ex) => {
  if (op === "update" && row.status === "pending" && ex?.status !== "pending") notifyApprovers(`PO ${row.number}: ${row.description}`, LINK("purchase_orders", row.id), `po-${row.id}-pending-${row.rev}`);
  if (op === "update" && ex && row.status !== ex.status && ["approved", "rejected"].includes(row.status)) notify(row.requested_by, `PO ${row.number}: ${row.status}`, row.description, LINK("purchase_orders", row.id), `po-${row.id}-${row.status}-${row.rev}`);
});
function notifyApprovers(title, link, key) {
  for (const u of q.all("SELECT username, perms FROM app_users")) if (String(u.perms).split(",").includes("fin.approve")) notify(u.username, title, "", link, `${key}-${u.username}`, "approval");
}

function money3(data, ex) {
  const base = pick(data, ex, "base") ?? 0, vr = pick(data, ex, "vat_rate") ?? 0, ir = pick(data, ex, "irpf_rate") ?? 0;
  data.vat = cents(base * vr / 100); data.irpf = cents(base * ir / 100); data.total = base + data.vat - data.irpf;
}
hook("bills", "before", (op, ctx, data, ex) => {
  if (op === "delete") { if (ex.status === "paid") throw bad("paid_bills_cannot_be_deleted"); return; }
  money3(data, ex);
  const st = data.status;
  if (st && st !== ex?.status && ["approved", "rejected"].includes(st)) { if (!has(ctx, "fin.approve")) throw forbidden("needs:fin.approve"); data.approved_by = ctx.user; data.approved_at = now(); }
  if (st === "paid" && ex?.status !== "paid" && !pick(data, ex, "paid_date")) data.paid_date = today();
  if (!pick(data, ex, "supplier_name")) { const s = rawGet("partners", pick(data, ex, "supplier_id")) || rawGet("people", pick(data, ex, "person_id")); if (s) data.supplier_name = s.name; }
  if (op === "create" && !data.due_date && data.date) { const s = rawGet("partners", data.supplier_id); data.due_date = addDays(data.date, s?.payment_days ?? 30); }
});
hook("bills", "after", (op, ctx, row) => { if (row.po_id && row.status !== "rejected") q.run("UPDATE purchase_orders SET status = 'invoiced' WHERE id = ? AND status = 'approved'", row.po_id); });

hook("client_invoices", "before", (op, ctx, data, ex) => {
  if (op === "delete") { if (ex.status !== "draft") throw bad("only_drafts_can_be_deleted"); return; }
  money3(data, ex);
  if (op === "update" && ex.status !== "draft" && Object.keys(data).some((k) => ["base", "vat_rate", "irpf_rate", "client_id", "concept", "date", "series"].includes(k)) && data.status !== "void") throw bad("invoice_locked");
  const st = data.status || ex?.status;
  if (st && st !== "draft" && !pick(data, ex, "number")) data.number = `${pick(data, ex, "series") || "F"}-${year(pick(data, ex, "date"))}-${String(nextSeq(`inv-${pick(data, ex, "series") || "F"}-${year(pick(data, ex, "date"))}`)).padStart(4, "0")}`;
  if (op === "create" && !data.due_date && data.date) { const c = rawGet("partners", data.client_id); data.due_date = addDays(data.date, c?.payment_days ?? 30); }
});
hook("client_invoices", "after", (op, ctx, row) => { if (op !== "delete" && row.plan_id) q.run("UPDATE billing_plan SET status = 'invoiced' WHERE id = ?", row.plan_id); });
/** Sets paid amount and status (issued / partial / paid) of a client invoice from the payments that point to it. */
export function recalcInvoice(id) {
  const inv = rawGet("client_invoices", id); if (!inv || ["draft", "void"].includes(inv.status)) return;
  const paid = q.get("SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE invoice_id = ?", id).s;
  const st = paid >= inv.total && inv.total > 0 ? "paid" : paid > 0 ? "partial" : "issued";
  q.run("UPDATE client_invoices SET paid_amount = ?, status = ? WHERE id = ?", paid, st, id);
}
hook("payments", "before", (op, ctx, data, ex) => { if (op === "create" && data.invoice_id) { const i = rawGet("client_invoices", data.invoice_id); if (!i || ["draft", "void"].includes(i.status)) throw bad("invoice_not_issued"); data.program_id ||= i.program_id; } });
hook("payments", "after", (op, ctx, row) => recalcInvoice(row.invoice_id));

// ---- people & time ----------------------------------------------------------------------------------------------------------------------
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
/** Worked, overtime and night hours of a timesheet entry according to the person's collective agreement; handles shifts that cross midnight. */
export function calcTimesheet(ts, ag) {
  const s = hhmmToMin(ts.start); let e = hhmmToMin(ts.end); if (e <= s) e += 1440;
  const worked = Math.max(0, e - s - (ts.break_min || 0)), maxD = (ag?.max_daily_hours ?? 8) * 60;
  const nf = hhmmToMin(ag?.night_from || "22:00"), nt = hhmmToMin(ag?.night_to || "06:00");
  const night = nt <= nf ? overlap(s, e, nf, 1440 + nt) + overlap(s, e, nf - 1440, nt) : overlap(s, e, nf, nt);
  return { hours: round2(worked / 60), overtime: round2(Math.max(0, worked - maxD) / 60), night_hours: round2(Math.min(night, worked) / 60), startMin: s, endMin: e };
}
/** Stores computed hours and the rest-period check of a timesheet, comparing with the person's previous shift. */
function recalcTimesheet(id) {
  const t = rawGet("timesheets", id); if (!t) return;
  const person = rawGet("people", t.person_id), ag = person?.agreement_id ? rawGet("agreements", person.agreement_id) : null;
  const c = calcTimesheet(t, ag);
  const prev = q.get("SELECT date, start, end FROM timesheets WHERE person_id = ? AND (date < ? OR (date = ? AND id < ?)) ORDER BY date DESC, id DESC LIMIT 1", t.person_id, t.date, t.date, t.id);
  let restOk = 1;
  if (prev) {
    const pe = hhmmToMin(prev.end), ps = hhmmToMin(prev.start), prevEndAbs = Date.parse(prev.date + "T00:00:00Z") / 60000 + (pe <= ps ? pe + 1440 : pe);
    const startAbs = Date.parse(t.date + "T00:00:00Z") / 60000 + c.startMin;
    restOk = (startAbs - prevEndAbs) / 60 >= (ag?.min_daily_rest ?? 12) ? 1 : 0;
  }
  q.run("UPDATE timesheets SET hours = ?, overtime = ?, night_hours = ?, rest_ok = ? WHERE id = ?", c.hours, c.overtime, c.night_hours, restOk, id);
}
hook("timesheets", "after", (op, ctx, row) => {
  if (op === "delete") return;
  recalcTimesheet(row.id);
  const next = q.get("SELECT id FROM timesheets WHERE person_id = ? AND (date > ? OR (date = ? AND id > ?)) ORDER BY date, id LIMIT 1", row.person_id, row.date, row.date, row.id);
  if (next) recalcTimesheet(next.id);
});
hook("people", "after", (op, ctx, row, ex) => { if (op === "update" && ex && row.agreement_id !== ex.agreement_id) for (const t of q.all("SELECT id FROM timesheets WHERE person_id = ?", row.id)) recalcTimesheet(t.id); });
hook("agreements", "after", (op, ctx, row) => { if (op === "update") for (const t of q.all("SELECT t.id FROM timesheets t JOIN people p ON p.id = t.person_id WHERE p.agreement_id = ?", row.id)) recalcTimesheet(t.id); });

// ---- collaboration -----------------------------------------------------------------------------------------------------------------------
hook("tasks", "after", (op, ctx, row, ex) => {
  if (op === "delete" || !row.assignee || row.assignee === ctx.user) return;
  if (op === "create" || row.assignee !== ex?.assignee) notify(row.assignee, row.title, row.due ? `${row.due}` : "", LINK("tasks", row.id), `task-${row.id}-${row.assignee}`, "task");
});
hook("approvals", "before", (op, ctx, data, ex) => {
  if (op === "delete") return;
  if (op === "create") { data.requested_by = ctx.user; data.status = "pending"; return; }
  const st = data.status;
  if (st && st !== ex.status) {
    const isApprover = ex.approver && ex.approver === ctx.user;
    if (ex.kind === "financial" && !has(ctx, "fin.approve") && !isApprover) throw forbidden("needs:fin.approve");
    if (!isApprover && !(has(ctx, "users.manage") || (!ex.approver && has(ctx, "app.edit")))) throw forbidden("not_the_approver");
    data.decided_at = now(); data.decided_by = ctx.user;
  }
});
hook("approvals", "after", (op, ctx, row, ex) => {
  if (op === "create" && row.approver) notify(row.approver, `Aprobación: ${row.subject}`, row.kind, LINK("approvals", row.id), `appr-${row.id}`, "approval");
  if (op === "update" && ex && row.status !== ex.status) {
    notify(row.requested_by, `${row.subject}: ${row.status}`, row.comment || "", LINK("approvals", row.id), `appr-${row.id}-${row.status}`, "approval");
    if (row.status === "approved" && row.entity === "documents") q.run("UPDATE documents SET status = 'approved' WHERE id = ? AND status IN ('draft','review')", row.row_id);
    if (row.status === "approved" && row.entity === "budgets") { /* budgets are approved explicitly with fin.approve */ }
  }
});
hook("comments", "before", (op, ctx, data, ex) => {
  if (op === "create") { const m = String(data.body || "").match(/@[a-z][a-z0-9._-]{1,31}/g); data.mentions = JSON.stringify([...new Set((m || []).map((x) => x.slice(1)))]); }
  if (op !== "create" && ex.created_by !== ctx.user && !has(ctx, "users.manage")) throw forbidden("not_the_author");
});
hook("comments", "after", (op, ctx, row) => {
  if (op !== "create") return;
  let ments = []; try { ments = JSON.parse(row.mentions || "[]"); } catch { /* none */ }
  for (const u of ments) if (u !== ctx.user) notify(u, `${ctx.name}: ${row.body.slice(0, 80)}`, "", LINK(row.entity, row.row_id), `cm-${row.id}-${u}`, "mention");
});

// ---- misc rules -------------------------------------------------------------------------------------------------------------------------
hook("risks", "before", (op, ctx, data, ex) => { if (op !== "delete") data.score = (pick(data, ex, "probability") ?? 3) * (pick(data, ex, "impact") ?? 3); });
hook("qc_issues", "before", (op, ctx, data, ex) => { if (op !== "delete" && data.status && ["resolved", "wontfix"].includes(data.status) && !["resolved", "wontfix"].includes(ex?.status)) data.resolved_at = now(); });
hook("editorial_lines", "before", (op, ctx, data, ex) => { if (op !== "delete" && data.approved === 1 && !ex?.approved) data.approved_by = ctx.user; });
function recalcCue(id) { const s = q.get("SELECT COALESCE(SUM(duration_sec),0) AS s FROM cue_items WHERE cue_sheet_id = ?", id).s; q.run("UPDATE cue_sheets SET total_music_sec = ? WHERE id = ?", s, id); }
hook("cue_items", "after", (op, ctx, row) => recalcCue(row.cue_sheet_id));
hook("cue_items", "before", (op, ctx, data) => { if (op === "create" && data.cue_sheet_id) { const s = rawGet("cue_sheets", data.cue_sheet_id); data.program_id ||= s?.program_id; if (data.position === undefined || data.position === 0) data.position = q.get("SELECT COALESCE(MAX(position),0)+1 AS n FROM cue_items WHERE cue_sheet_id = ?", data.cue_sheet_id).n; } });
hook("rundown_items", "before", (op, ctx, data) => {
  if (op === "create" && data.episode_id) {
    const ep = rawGet("episodes", data.episode_id); data.program_id ||= ep?.program_id;
    if (!data.position) data.position = q.get("SELECT COALESCE(MAX(position),0)+10 AS n FROM rundown_items WHERE episode_id = ?", data.episode_id).n;
  }
});

hook("deliveries", "before", (op, ctx, data, ex) => {
  if (op === "delete") { if (ex.status !== "preparing") throw bad("sent_deliveries_cannot_be_deleted"); return; }
  const st = data.status;
  if (st === "sent" && ex?.status !== "sent") {
    data.sent_at = now(); data.sent_by = ctx.user;
    const items = pick(data, ex, "items");
    let list = []; try { list = JSON.parse(items || "[]"); } catch { /* ignore */ }
    if (!list.length) { const ep = pick(data, ex, "episode_id"); list = q.all("SELECT id AS asset_id, title AS name, size_mb, checksum, version FROM assets WHERE episode_id = ? AND status = 'approved'", ep); data.items = JSON.stringify(list); }
    data.manifest_hash = createHashHex(JSON.stringify({ ep: pick(data, ex, "episode_id"), v: pick(data, ex, "version"), items: list }));
  }
  if (st === "accepted" && !pick(data, ex, "accepted_at")) data.accepted_at = now();
});
hook("deliveries", "after", (op, ctx, row, ex) => {
  if (op === "update" && row.status === "accepted" && ex?.status !== "accepted") advanceEpisode(row.episode_id, "delivered");
});
hook("broadcasts", "after", (op, ctx, row, ex) => { if (op !== "delete" && row.status === "aired" && row.episode_id && ex?.status !== "aired") advanceEpisode(row.episode_id, "aired"); });
function advanceEpisode(id, status) {
  const ep = rawGet("episodes", id); if (!ep) return;
  if (EPISODE_STATUS.indexOf(status) > EPISODE_STATUS.indexOf(ep.status)) q.run("UPDATE episodes SET status = ?, updated = ? WHERE id = ?", status, now(), id);
}
import crypto from "node:crypto";
const createHashHex = (s) => crypto.createHash("sha256").update(s).digest("hex");

hook("episodes", "before", (op, ctx, data, ex) => {
  if (op === "create" && !data.number) data.number = q.get("SELECT COALESCE(MAX(number),0)+1 AS n FROM episodes WHERE program_id = ? AND COALESCE(season_id,0) = COALESCE(?,0)", data.program_id, data.season_id ?? null).n;
});
// the programme id is denormalised on children that carry it; keep it right when only the parent is given
for (const [entity, parent, pf] of [["milestones", "episode_id", "program_id"], ["bookings", "episode_id", "program_id"], ["qc_reports", "episode_id", "program_id"], ["qc_issues", "episode_id", "program_id"], ["deliveries", "episode_id", "program_id"],
  ["compliance_checks", "episode_id", "program_id"], ["crew_assignments", "episode_id", "program_id"], ["assets", "episode_id", "program_id"], ["ratings", "broadcast_id", "program_id"], ["consents", "episode_id", "program_id"]]) {
  hook(entity, "before", (op, ctx, data) => {
    if (op !== "create" || data[pf] || !data[parent]) return;
    const table = parent === "broadcast_id" ? "broadcasts" : "episodes"; const p = rawGet(table, data[parent]); if (p?.program_id) data[pf] = p.program_id;
  });
}

// ---- documents: versions -----------------------------------------------------------------------------------------------------------------
hook("documents", "before", (op, ctx, data, ex) => {
  if (op === "delete") return;
  if (op === "update" && ex && ((data.content !== undefined && data.content !== ex.content) || (data.title !== undefined && data.title !== ex.title))) data.version = (ex.version || 1) + 1;
});
hook("documents", "after", (op, ctx, row, ex) => {
  if (op === "delete") return;
  if (op === "create" || (ex && row.version !== ex.version)) q.run("INSERT INTO doc_versions(document_id, version, title, content, created, updated, created_by, rev) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", row.id, row.version, row.title, row.content, now(), now(), ctx.user);
  q.run("DELETE FROM doc_versions WHERE document_id = ? AND id NOT IN (SELECT id FROM doc_versions WHERE document_id = ? ORDER BY id DESC LIMIT 60)", row.id, row.id);
});

// ---- programme workflow templates ---------------------------------------------------------------------------------------------------------
export async function applyTemplate(ctx, programId) {
  const p = rawGet("programs", programId); if (!p) throw bad("no_program");
  const t = p.template_id && rawGet("workflow_templates", p.template_id); if (!t) throw bad("no_template");
  const start = p.start_date || today(), parse = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
  const season = await create(ctx, "seasons", { program_id: programId, number: 1, name: "T1", status: "planning", start_date: start, episodes_planned: p.episodes_per_season || 0 });
  const made = [];
  for (const [i, m] of parse(t.milestones).entries()) {
    const s = addDays(start, m.offset_days || 0), after = (m.after || []).map((k) => made[k]).filter(Boolean);
    made[i] = (await create(ctx, "milestones", { program_id: programId, season_id: season.id, title: m.title, kind: m.kind || "phase", start_date: s, end_date: addDays(s, m.duration_days ?? 0), status: "todo", depends_on: after })).id;
  }
  for (const k of parse(t.tasks)) await create(ctx, "tasks", { program_id: programId, title: k.title, due: addDays(start, k.offset_days || 0), priority: k.priority || "medium", status: "todo" });
  const n = Math.min(p.episodes_per_season || 0, 60);
  for (let i = 1; i <= n; i++) await create(ctx, "episodes", { program_id: programId, season_id: season.id, number: i, title: "", status: "planned" });
  let budget = null;
  if (t.budget_template_id) budget = await cloneBudget(ctx, t.budget_template_id, { program_id: programId, season_id: season.id, name: "Presupuesto", kind: "budget", version: 1 });
  return { season, milestones: made.length, budget };
}
/** Copies a budget and all its lines into a new draft (optionally for another programme or season). */
export async function cloneBudget(ctx, id, over = {}) {
  const b = rawGet("budgets", id); if (!b) throw bad("no_budget");
  const nb = await create(ctx, "budgets", { program_id: over.program_id ?? b.program_id, season_id: over.season_id ?? b.season_id, name: over.name ?? b.name, kind: over.kind ?? b.kind, version: over.version ?? 1,
    status: "draft", currency: b.currency, contingency_pct: b.contingency_pct, episodes: b.episodes, notes: over.notes ?? "", parent_id: b.id }, { internal: true });
  for (const l of q.all("SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY code, id", id))
    await create(ctx, "budget_lines", { budget_id: nb.id, program_id: nb.program_id, episode_id: l.episode_id, chapter: l.chapter, code: l.code, description: l.description, qty: l.qty, unit: l.unit,
      unit_cost: l.unit_cost / 100, vat_rate: l.vat_rate, irpf_rate: l.irpf_rate, account: l.account, notes: l.notes });
  return getRow(ctx, "budgets", nb.id);
}
/** Creates the next version of a budget (same name, version + 1) as a draft copy; approved budgets are locked and change only through new versions. */
export async function newBudgetVersion(ctx, id) {
  const b = rawGet("budgets", id); if (!b) throw bad("no_budget");
  const max = q.get("SELECT COALESCE(MAX(version),0) AS v FROM budgets WHERE COALESCE(program_id,0) = COALESCE(?,0) AND name = ?", b.program_id, b.name).v;
  return cloneBudget(ctx, id, { version: max + 1, name: b.name });
}

hook("programs", "before", (op, ctx, data, ex) => { validateProjectFolder(op, data, ex); });
// desktop: a programme with a local folder gets its own CLAUDE.md there (rules for the agent in that project), once
hook("programs", "after", (op, ctx, row) => { ensureProjectGuide(row); });
