// Operations that are more than one CRUD call: imports (ratings, bank), reconciliation, accounting exports, calendar export, checklists, scheduling helpers.
import { q, getSetting } from "./db.mjs";
import { create, update, rawGet, label } from "./engine.mjs";
import { has } from "./access.mjs";
import { ENTITIES } from "./schema.mjs";
import { bad, forbidden, parseCsv, csvRows, parseNum, isDate, today, addDays, diffDays, round2, fromCents, esc } from "./util.mjs";

// ---- CSV import helpers --------------------------------------------------------------------------------------------------------------
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function table(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw bad("empty_csv");
  const head = rows[0].map(norm); return { head, rows: rows.slice(1) };
}
const col = (head, names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
function toIsoDate(s) {
  const t = String(s || "").trim(); if (isDate(t.slice(0, 10))) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Ratings CSV: date, [programme], [episode], [channel], audience (thousands), share, rating, reach, target, source. Matches broadcasts by date (+ programme/episode when given). */
export async function importRatings(ctx, { csv, program_id, source = "", target_label = "", dry = false }) {
  if (!has(ctx, "app.edit")) throw forbidden("needs:app.edit");
  const { head, rows } = table(csv);
  const c = { date: col(head, ["fecha", "date", "dia"]), aud: col(head, ["audiencia media", "audiencia", "audience", "espectadores", "miles", "audience avg"]), share: col(head, ["share", "cuota", "cuota de pantalla", "cuota pantalla", "share pct"]),
    rating: col(head, ["rating", "rating pct"]), reach: col(head, ["cobertura", "reach", "audiencia acumulada", "acumulada"]), target: col(head, ["target", "demografia", "individuos", "perfil"]), src: col(head, ["fuente", "source"]),
    ep: col(head, ["episodio", "episode", "capitulo", "numero"]), prog: col(head, ["programa", "program", "programme"]), start: col(head, ["inicio", "hora", "start", "hora inicio"]) };
  if (c.date < 0 || (c.aud < 0 && c.share < 0)) throw bad("csv_columns_missing", { need: "date + audience/share", got: head });
  const batch = "imp-" + Date.now().toString(36); const out = { created: 0, skipped: 0, errors: [], matched: 0, batch };
  for (const [i, r] of rows.entries()) {
    const date = toIsoDate(r[c.date]); if (!date) { out.errors.push({ row: i + 2, error: "date" }); continue; }
    let pid = program_id ? Number(program_id) : null;
    if (c.prog >= 0 && r[c.prog]) { const p = q.get("SELECT id FROM programs WHERE lower(name) = lower(?)", r[c.prog].trim()); if (p) pid = p.id; }
    if (!pid) { out.errors.push({ row: i + 2, error: "program" }); continue; }
    let bc = q.get("SELECT * FROM broadcasts WHERE program_id = ? AND date = ? ORDER BY start_time LIMIT 1", pid, date);
    if (c.ep >= 0 && r[c.ep]) { const n = parseNum(r[c.ep]); const ep = q.get("SELECT id FROM episodes WHERE program_id = ? AND number = ?", pid, n); if (ep) bc = q.get("SELECT * FROM broadcasts WHERE episode_id = ? ORDER BY date LIMIT 1", ep.id) || bc; }
    const body = { program_id: pid, date, broadcast_id: bc?.id, episode_id: bc?.episode_id, source: (c.src >= 0 && r[c.src]) || source || "Kantar", target_label: (c.target >= 0 && r[c.target]) || target_label || "Total individuos",
      audience_avg: c.aud >= 0 ? Math.round(parseNum(r[c.aud])) : null, share_pct: c.share >= 0 ? parseNum(r[c.share]) : null, rating_pct: c.rating >= 0 ? parseNum(r[c.rating]) : null, reach: c.reach >= 0 ? Math.round(parseNum(r[c.reach])) : null };
    if (bc) out.matched++;
    if (dry) { out.created++; continue; }
    try { const row = await create(ctx, "ratings", body); q.run("UPDATE ratings SET batch = ? WHERE id = ?", batch, row.id); out.created++; } catch (e) { out.errors.push({ row: i + 2, error: e.message }); }
  }
  return out;
}

/** Bank CSV: date, concept, amount (or debit/credit), reference, counterparty. Duplicates (same date+amount+concept) are skipped. */
export async function importBank(ctx, { csv, account = "", dry = false }) {
  if (!has(ctx, "fin.edit")) throw forbidden("needs:fin.edit");
  const { head, rows } = table(csv);
  const c = { date: col(head, ["fecha", "fecha operacion", "fecha valor", "date", "f operacion"]), concept: col(head, ["concepto", "descripcion", "movimiento", "concept", "detalle"]), amount: col(head, ["importe", "amount", "cantidad"]),
    debit: col(head, ["cargo", "debe", "debit"]), credit: col(head, ["abono", "haber", "credit"]), ref: col(head, ["referencia", "reference", "ref"]), cp: col(head, ["contraparte", "beneficiario", "ordenante", "counterparty"]) };
  if (c.date < 0 || c.concept < 0 || (c.amount < 0 && c.debit < 0 && c.credit < 0)) throw bad("csv_columns_missing", { need: "date, concept, amount", got: head });
  const batch = "bank-" + Date.now().toString(36), out = { created: 0, skipped: 0, errors: [], batch };
  for (const [i, r] of rows.entries()) {
    const date = toIsoDate(r[c.date]); const amt = c.amount >= 0 ? parseNum(r[c.amount]) : parseNum(r[c.credit]) - parseNum(r[c.debit]);
    if (!date || !r[c.concept]) { out.errors.push({ row: i + 2, error: "row" }); continue; }
    const dup = q.get("SELECT id FROM bank_movements WHERE date = ? AND amount = ? AND concept = ?", date, Math.round(amt * 100), r[c.concept].trim().slice(0, 500));
    if (dup) { out.skipped++; continue; }
    if (dry) { out.created++; continue; }
    try { const row = await create(ctx, "bank_movements", { date, concept: r[c.concept].trim().slice(0, 500), amount: amt, reference: c.ref >= 0 ? r[c.ref] : "", counterparty: c.cp >= 0 ? r[c.cp] : "", account }); q.run("UPDATE bank_movements SET batch = ? WHERE id = ?", batch, row.id); out.created++; } catch (e) { out.errors.push({ row: i + 2, error: e.message }); }
  }
  return out;
}

/** Candidate invoices/bills for an unreconciled bank movement (same amount; reference or counterparty text hints raise the score). */
export function suggestMatches(ctx, movementId) {
  if (!has(ctx, "fin.view")) throw forbidden("needs:fin.view");
  const m = rawGet("bank_movements", movementId); if (!m) throw bad("no_movement");
  const out = [], text = norm(`${m.concept} ${m.reference} ${m.counterparty}`);
  if (m.amount > 0) for (const i of q.all("SELECT * FROM client_invoices WHERE status IN ('issued','partial')")) {
    const open = i.total - i.paid_amount, exact = open === m.amount || i.total === m.amount, hint = i.number && text.includes(norm(i.number));
    if (exact || hint) out.push({ entity: "client_invoices", id: i.id, label: `${i.number} · ${i.concept}`, amount: fromCents(open), score: (exact ? 2 : 0) + (hint ? 3 : 0) });
  } else for (const b of q.all("SELECT * FROM bills WHERE status IN ('approved','pending')")) {
    const exact = b.total === -m.amount, hint = (b.number && text.includes(norm(b.number))) || (b.supplier_name && text.includes(norm(b.supplier_name).split(" ")[0] || "@@"));
    if (exact || (hint && Math.abs(b.total + m.amount) < 100)) out.push({ entity: "bills", id: b.id, label: `${b.number || ""} ${b.supplier_name || ""} ${b.description}`.trim(), amount: fromCents(b.total), score: (exact ? 2 : 0) + (hint ? 2 : 0) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}
export async function matchMovement(ctx, { movement_id, entity, id }) {
  if (!has(ctx, "fin.edit")) throw forbidden("needs:fin.edit");
  const m = rawGet("bank_movements", movement_id); if (!m) throw bad("no_movement"); if (m.matched) throw bad("already_matched");
  if (entity === "client_invoices" && m.amount > 0) {
    const inv = rawGet("client_invoices", id); if (!inv) throw bad("no_invoice");
    const pay = await create(ctx, "payments", { invoice_id: inv.id, date: m.date, amount: m.amount / 100, method: "transfer", reference: m.reference || m.concept.slice(0, 100) });
    q.run("UPDATE payments SET bank_movement_id = ? WHERE id = ?", m.id, pay.id);
  } else if (entity === "bills" && m.amount < 0) {
    const bill = rawGet("bills", id); if (!bill) throw bad("no_bill");
    if (bill.status === "pending" && !has(ctx, "fin.approve")) throw forbidden("needs:fin.approve");
    await update(ctx, "bills", id, { status: "paid", paid_date: m.date, payment_method: "transfer" }, { force: true });
    q.run("UPDATE bills SET bank_movement_id = ? WHERE id = ?", m.id, id);
  } else throw bad("cannot_match");
  q.run("UPDATE bank_movements SET matched = 1, matched_entity = ?, matched_id = ? WHERE id = ?", entity, Number(id), m.id);
  return { ok: true };
}
export function unmatchMovement(ctx, movement_id) {
  if (!has(ctx, "fin.edit")) throw forbidden("needs:fin.edit");
  const m = rawGet("bank_movements", movement_id); if (!m || !m.matched) throw bad("not_matched");
  if (m.matched_entity === "client_invoices") q.run("DELETE FROM payments WHERE bank_movement_id = ?", m.id);
  if (m.matched_entity === "bills") q.run("UPDATE bills SET status = 'approved', paid_date = NULL, bank_movement_id = NULL WHERE id = ?", m.matched_id);
  q.run("UPDATE bank_movements SET matched = 0, matched_entity = NULL, matched_id = NULL WHERE id = ?", m.id);
  import("./logic.mjs").then(({ recalcInvoice }) => { if (m.matched_entity === "client_invoices") recalcInvoice(m.matched_id); });
  return { ok: true };
}

// ---- ad traffic -> invoice -------------------------------------------------------------------------------------------------------------
export async function invoiceAdSpots(ctx, { sponsorship_id, date }) {
  if (!has(ctx, "fin.edit")) throw forbidden("needs:fin.edit");
  const s = rawGet("sponsorships", sponsorship_id); if (!s) throw bad("no_sponsorship");
  const spots = q.all("SELECT * FROM ad_spots WHERE sponsorship_id = ? AND status = 'aired' AND invoice_id IS NULL", s.id);
  if (!spots.length) throw bad("nothing_to_invoice");
  const base = spots.reduce((a, x) => a + (x.price || 0), 0);
  const inv = await create(ctx, "client_invoices", { client_id: s.sponsor_id, program_id: s.program_id, date: date || today(), concept: `${s.name}: ${spots.length} pases`, base: base / 100, status: "draft" });
  for (const x of spots) q.run("UPDATE ad_spots SET status = 'invoiced', invoice_id = ? WHERE id = ?", inv.id, x.id);
  return inv;
}

// ---- compliance checklists --------------------------------------------------------------------------------------------------------------
export const DEFAULT_COMPLIANCE = {
  minors: ["age_rating", "protected_slot", "minors_authorisation", "minors_image_protection", "no_harmful_content"],
  advertising: ["ads_identifiable", "sponsor_notice", "placement_notice", "ad_limits", "no_hidden_advertising"],
  accessibility: ["subtitles", "audio_description", "sign_language", "accessible_graphics"],
  data_protection: ["image_releases", "privacy_notice", "data_minimisation"],
  pluralism: ["editorial_line_respected", "right_of_reply", "sources_checked"],
  copyright: ["music_cleared", "archive_cleared", "third_party_content"],
};
export async function initCompliance(ctx, { episode_id, areas }) {
  const ep = rawGet("episodes", episode_id); if (!ep) throw bad("no_episode");
  const cfg = getSetting("compliance_checklists", DEFAULT_COMPLIANCE); const made = [];
  for (const [area, items] of Object.entries(cfg)) {
    if (areas && !areas.includes(area)) continue;
    for (const item of items) {
      if (q.get("SELECT 1 AS x FROM compliance_checks WHERE episode_id = ? AND area = ? AND item = ?", ep.id, area, item)) continue;
      made.push((await create(ctx, "compliance_checks", { episode_id: ep.id, program_id: ep.program_id, area, item, status: "pending" })).id);
    }
  }
  return { created: made.length };
}

// ---- scheduling helpers -----------------------------------------------------------------------------------------------------------------
/** Fills shoot/edit/delivery dates of an episode back from its air date using the programme template's deadlines ([{status, days_before_air}]). */
export async function planEpisode(ctx, { episode_id }) {
  const ep = rawGet("episodes", episode_id); if (!ep?.air_date) throw bad("no_air_date");
  const prog = rawGet("programs", ep.program_id), tpl = prog?.template_id ? rawGet("workflow_templates", prog.template_id) : null;
  let pipe = []; try { pipe = JSON.parse(tpl?.episode_pipeline || "[]"); } catch { /* defaults */ }
  const days = Object.fromEntries((pipe.length ? pipe : [{ status: "recorded", days_before_air: 10 }, { status: "edited", days_before_air: 5 }, { status: "delivered", days_before_air: 3 }]).map((x) => [x.status, x.days_before_air]));
  return update(ctx, "episodes", ep.id, { shoot_date: addDays(ep.air_date, -(days.recorded ?? 10)), edit_due: addDays(ep.air_date, -(days.edited ?? 5)), delivery_due: addDays(ep.air_date, -(days.delivered ?? 3)) });
}
/** Reassigns rundown positions: ids in the new order get 10, 20, 30... */
export async function reorderRundown(ctx, { episode_id, ids }) {
  if (!has(ctx, "app.edit")) throw forbidden("needs:app.edit");
  const have = new Set(q.all("SELECT id FROM rundown_items WHERE episode_id = ?", Number(episode_id)).map((r) => r.id));
  const list = (ids || []).map(Number).filter((x) => have.has(x));
  list.forEach((id, i) => q.run("UPDATE rundown_items SET position = ?, rev = rev + 1 WHERE id = ?", (i + 1) * 10, id));
  return { ok: true, n: list.length };
}
export async function duplicateEpisodeRundown(ctx, { from_episode_id, to_episode_id }) {
  const rows = q.all("SELECT * FROM rundown_items WHERE episode_id = ? ORDER BY position", Number(from_episode_id)); const to = rawGet("episodes", to_episode_id);
  if (!to) throw bad("no_episode");
  for (const r of rows) await create(ctx, "rundown_items", { episode_id: to.id, program_id: to.program_id, position: r.position, block: r.block, title: r.title, kind: r.kind, duration_sec: r.duration_sec, responsible: r.responsible, location: r.location, content: r.content, notes: r.notes, status: "draft" });
  return { copied: rows.length };
}

// ---- exports -----------------------------------------------------------------------------------------------------------------------------
const money = (c) => (c / 100).toFixed(2);
/** Vendor bills in a shape close to Odoo's import template (adjust account/tax mapping in Settings -> finance.odoo). */
export function exportOdooBills(ctx, { from, to } = {}) {
  if (!has(ctx, "fin.view")) throw forbidden("needs:fin.view");
  const cfg = getSetting("finance", {}).odoo || {}; const taxName = (r) => (cfg.purchase_taxes && cfg.purchase_taxes[String(r)]) || `${r}% IVA soportado`;
  const rows = [["partner_id", "invoice_date", "invoice_date_due", "ref", "move_type", "invoice_line_ids/name", "invoice_line_ids/quantity", "invoice_line_ids/price_unit", "invoice_line_ids/account_id", "invoice_line_ids/tax_ids"]];
  for (const b of q.all("SELECT * FROM bills WHERE status IN ('approved','paid') AND date BETWEEN ? AND ? ORDER BY date, id", from || "0000-01-01", to || "9999-12-31")) {
    const acct = b.budget_line_id ? rawGet("budget_lines", b.budget_line_id)?.account : ""; 
    rows.push([b.supplier_name, b.date, b.due_date || "", b.number, "in_invoice", b.description, 1, money(b.base), acct || cfg.default_expense_account || "", b.vat_rate ? taxName(b.vat_rate) : ""]);
  }
  return csvRows(rows, ",");
}
export function exportOdooInvoices(ctx, { from, to } = {}) {
  if (!has(ctx, "fin.view")) throw forbidden("needs:fin.view");
  const cfg = getSetting("finance", {}).odoo || {}; const taxName = (r) => (cfg.sale_taxes && cfg.sale_taxes[String(r)]) || `${r}% IVA repercutido`;
  const rows = [["partner_id", "invoice_date", "invoice_date_due", "name", "move_type", "invoice_line_ids/name", "invoice_line_ids/quantity", "invoice_line_ids/price_unit", "invoice_line_ids/account_id", "invoice_line_ids/tax_ids"]];
  for (const i of q.all("SELECT * FROM client_invoices WHERE status NOT IN ('draft','void') AND date BETWEEN ? AND ? ORDER BY date, id", from || "0000-01-01", to || "9999-12-31"))
    rows.push([label("partners", i.client_id), i.date, i.due_date || "", i.number, "out_invoice", i.concept, 1, money(i.base), cfg.default_income_account || "", i.vat_rate ? taxName(i.vat_rate) : ""]);
  return csvRows(rows, ",");
}
export function exportCsv(ctx, entity, rows) {
  const e = ENTITIES[entity]; const cols = e.list.filter((c) => e.fields[c]).concat(Object.keys(e.fields).filter((c) => !e.list.includes(c) && e.fields[c].type !== "secret" && e.fields[c].type !== "json").slice(0, 20));
  return csvRows([cols, ...rows.map((r) => cols.map((c) => r[c] ?? ""))]);
}

/** iCalendar feed of the dates that matter (shoots, air dates, deliveries, bookings, milestones, contract ends). */
export function icsExport(ctx, { program } = {}) {
  const ev = [], d8 = (s) => s.replace(/-/g, ""), dt = (s) => s.replace(/[-:]/g, "").slice(0, 15).padEnd(15, "0");
  const esc2 = (s) => String(s || "").replace(/[\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
  const w = program ? " AND program_id = " + Number(program) : "";
  const allDay = (uid, date, summary, desc = "") => ev.push(["BEGIN:VEVENT", `UID:${uid}@collado`, `DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d8(date)}`, `DTEND;VALUE=DATE:${d8(addDays(date, 1))}`, `SUMMARY:${esc2(summary)}`, desc ? `DESCRIPTION:${esc2(desc)}` : "", "END:VEVENT"].filter(Boolean).join("\r\n"));
  const pname = (id) => (id ? label("programs", id) : "");
  for (const e of q.all(`SELECT * FROM episodes WHERE 1=1 ${w}`)) {
    if (e.shoot_date) allDay(`ep-shoot-${e.id}`, e.shoot_date, `Rodaje ${pname(e.program_id)} E${e.number}`);
    if (e.delivery_due) allDay(`ep-del-${e.id}`, e.delivery_due, `Entrega ${pname(e.program_id)} E${e.number}`);
    if (e.air_date) allDay(`ep-air-${e.id}`, e.air_date, `Emisión ${pname(e.program_id)} E${e.number}`);
  }
  for (const b of q.all(`SELECT b.*, r.name AS rname FROM bookings b JOIN resources r ON r.id = b.resource_id WHERE b.status != 'cancelled' ${w.replace("program_id", "b.program_id")}`))
    ev.push(["BEGIN:VEVENT", `UID:bk-${b.id}@collado`, `DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`, `DTSTART:${dt(b.start)}`, `DTEND:${dt(b.end)}`, `SUMMARY:${esc2(b.title + " · " + b.rname)}`, "END:VEVENT"].join("\r\n"));
  for (const m of q.all(`SELECT * FROM milestones WHERE 1=1 ${w}`)) allDay(`ms-${m.id}`, m.end_date || m.start_date, `${pname(m.program_id)}: ${m.title}`);
  if (has(ctx, "legal.view")) for (const c of q.all(`SELECT * FROM contracts WHERE end_date != '' AND status IN ('active','signing') ${w}`)) allDay(`ct-${c.id}`, c.end_date, `Vence contrato: ${c.title}`);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Collado//ES", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Collado", ...ev, "END:VCALENDAR", ""].join("\r\n");
}
