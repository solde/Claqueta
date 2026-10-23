// Read-only computations over the data: budget vs actual, cashflow, taxes, profitability, resource conflicts, working time, rundown timing, gantt,
// ratings, delivery readiness, rights coverage. All amounts leave here as plain numbers (euros). Also used as data sources by the document engine.
import { q, getSetting } from "./db.mjs";
import { rawGet, label } from "./engine.mjs";
import { has, memberPrograms } from "./access.mjs";
import { ENTITIES, rowLabel } from "./schema.mjs";
import { forbidden, bad, today, addDays, addMonths, diffDays, mondayOf, quarterOf, dtMin, hhmmToMin, minToHhmm, fromCents, round2 } from "./util.mjs";
import { decField } from "./crypto.mjs";
import { CHAPTERS } from "./schema/finance.mjs";
import { forecastMeasure } from "./forecast.mjs";

const E = (c) => (c == null ? 0 : Math.round(c) / 100);
const need = (ctx, perm) => { if (!has(ctx, perm)) throw forbidden(`needs:${perm}`); };
const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
const inList = (a) => a.map(() => "?").join(",");
const OK_BILL = "('approved','paid')";

/** Programme ids the caller may see (null = all). */
const scopeProgs = (ctx) => (ctx.external ? memberPrograms(ctx) : null);
const progFilter = (ctx, col, program, args) => {
  const w = [];
  if (program) { w.push(`${col} = ?`); args.push(Number(program)); }
  const sp = scopeProgs(ctx); if (sp) { w.push(sp.length ? `${col} IN (${inList(sp)})` : "0"); args.push(...sp); }
  return w;
};

// ---- budgets --------------------------------------------------------------------------------------------------------------------------
export function budgetReport(ctx, { budget_id }) {
  need(ctx, "fin.view");
  const b = rawGet("budgets", budget_id); if (!b) throw bad("no_budget");
  const lines = q.all("SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY chapter, code, id", b.id);
  const act = {}, pend = {}, com = {};
  for (const r of q.all(`SELECT budget_line_id AS id, status, SUM(base) AS s FROM bills WHERE budget_line_id IN (SELECT id FROM budget_lines WHERE budget_id = ?) AND status != 'rejected' GROUP BY budget_line_id, status`, b.id))
    (r.status === "pending" ? pend : act)[r.id] = ((r.status === "pending" ? pend : act)[r.id] || 0) + r.s;
  for (const r of q.all(`SELECT budget_line_id AS id, SUM(amount) AS s FROM purchase_orders WHERE status = 'approved' AND budget_line_id IN (SELECT id FROM budget_lines WHERE budget_id = ?) GROUP BY budget_line_id`, b.id)) com[r.id] = r.s;
  const chapters = new Map();
  for (const l of lines) {
    const c = chapters.get(l.chapter) || { chapter: l.chapter, planned: 0, actual: 0, committed: 0, pending: 0, lines: [] };
    const row = { id: l.id, code: l.code, description: l.description, qty: l.qty, unit: l.unit, unit_cost: E(l.unit_cost), episode_id: l.episode_id, planned: E(l.amount), actual: E(act[l.id] || 0), committed: E(com[l.id] || 0), pending: E(pend[l.id] || 0) };
    row.variance = round2(row.planned - row.actual - row.committed); row.pct = row.planned ? Math.round(((row.actual + row.committed) / row.planned) * 100) : null;
    c.planned += l.amount; c.actual += act[l.id] || 0; c.committed += com[l.id] || 0; c.pending += pend[l.id] || 0; c.lines.push(row); chapters.set(l.chapter, c);
  }
  const chs = [...chapters.values()].sort((a, b) => CHAPTERS.indexOf(a.chapter) - CHAPTERS.indexOf(b.chapter)).map((c) => ({ ...c, planned: E(c.planned), actual: E(c.actual), committed: E(c.committed), pending: E(c.pending), variance: E(c.planned - c.actual - c.committed), pct: c.planned ? Math.round(((c.actual + c.committed) / c.planned) * 100) : null }));
  const unb = b.program_id ? q.get(`SELECT COALESCE(SUM(base),0) AS s FROM bills WHERE program_id = ? AND budget_line_id IS NULL AND status IN ${OK_BILL}`, b.program_id).s : 0;
  const totals = { planned: E(b.subtotal), planned_lines: E(sum(lines, "amount")), vat: E(b.vat), total: E(b.total), actual: E(sum(chapters.size ? [...chapters.values()] : [], "actual")), committed: E(sum([...chapters.values()], "committed")), pending: E(sum([...chapters.values()], "pending")), unbudgeted: E(unb) };
  totals.actual = E(sum([...chapters.values()], "actual"));
  totals.variance = round2(totals.planned_lines - totals.actual - totals.committed - totals.unbudgeted);
  totals.pct = totals.planned_lines ? Math.round(((totals.actual + totals.committed + totals.unbudgeted) / totals.planned_lines) * 100) : null;
  return { budget: { id: b.id, name: b.name, version: b.version, status: b.status, program_id: b.program_id, season_id: b.season_id, contingency_pct: b.contingency_pct, episodes: b.episodes, currency: b.currency }, chapters: chs, totals };
}

/** Planned vs actual cost per episode: lines tied to an episode count for it, general lines/bills are spread evenly over the episodes. */
export function episodeVariance(ctx, { program_id, season_id }) {
  need(ctx, "fin.view");
  const eps = q.all(`SELECT id, number, title, status FROM episodes WHERE program_id = ? ${season_id ? "AND season_id = ?" : ""} ORDER BY number`, ...[Number(program_id), ...(season_id ? [Number(season_id)] : [])]);
  if (!eps.length) return { episodes: [], total: {} };
  const b = q.get(`SELECT * FROM budgets WHERE program_id = ? AND kind = 'budget' AND status != 'obsolete' ${season_id ? "AND (season_id = ? OR season_id IS NULL)" : ""} ORDER BY (status = 'approved') DESC, version DESC LIMIT 1`, ...[Number(program_id), ...(season_id ? [Number(season_id)] : [])]);
  const n = eps.length;
  const plannedEp = Object.fromEntries(eps.map((e) => [e.id, 0])); let planGeneral = 0;
  if (b) for (const l of q.all("SELECT episode_id, amount FROM budget_lines WHERE budget_id = ?", b.id)) { if (l.episode_id && plannedEp[l.episode_id] !== undefined) plannedEp[l.episode_id] += l.amount; else planGeneral += l.amount; }
  const actEp = Object.fromEntries(eps.map((e) => [e.id, 0])); let actGeneral = 0;
  for (const r of q.all(`SELECT episode_id, base FROM bills WHERE program_id = ? AND status IN ${OK_BILL}`, Number(program_id))) { if (r.episode_id && actEp[r.episode_id] !== undefined) actEp[r.episode_id] += r.base; else actGeneral += r.base; }
  const rows = eps.map((e) => { const planned = plannedEp[e.id] + planGeneral / n, actual = actEp[e.id] + actGeneral / n; return { id: e.id, number: e.number, title: e.title, status: e.status, planned: E(planned), actual: E(actual), variance: E(planned - actual), pct: planned ? Math.round((actual / planned) * 100) : null }; });
  return { budget: b ? { id: b.id, name: b.name, version: b.version, status: b.status } : null, episodes: rows, total: { planned: round2(sum(rows, "planned")), actual: round2(sum(rows, "actual")), variance: round2(sum(rows, "variance")) } };
}

// ---- cashflow -------------------------------------------------------------------------------------------------------------------------
export function cashflow(ctx, { program, from, months = 6, forecast = false } = {}) {
  need(ctx, "fin.view");
  const t = today(); const start = (from || t).slice(0, 7) + "-01"; const n = Math.max(1, Math.min(36, Number(months) || 6)); const mk = (d) => d.slice(0, 7);
  const buckets = Array.from({ length: n }, (_, i) => ({ month: mk(addMonths(start, i)), in: 0, out: 0 }));
  const idx = Object.fromEntries(buckets.map((b, i) => [b.month, i])); const details = [];
  const put = (date, amount, kind, entity, id, text, actual) => {
    if (!date) return; let m = mk(date); const cur = mk(t);
    if (!actual && date < t) m = cur;             // expected but overdue: it will move this month
    if (!(m in idx)) return;
    const b = buckets[idx[m]]; if (amount >= 0) b.in += amount; else b.out += -amount;
    details.push({ date, month: m, amount: E(amount), kind, entity, id, label: text, actual: !!actual });
  };
  const args = [], pw = progFilter(ctx, "program_id", program, args), W = pw.length ? " AND " + pw.join(" AND ") : "";
  for (const i of q.all(`SELECT * FROM client_invoices WHERE status IN ('issued','partial') ${W}`, ...args)) put(i.due_date || i.date, i.total - i.paid_amount - 0, "invoice", "client_invoices", i.id, `${i.number} ${i.concept}`, false);
  for (const p of q.all(`SELECT * FROM payments WHERE date >= ? ${W}`, start, ...args)) put(p.date, p.amount, "payment", "payments", p.id, `Cobro ${label("client_invoices", p.invoice_id)}`, true);
  for (const pl of q.all(`SELECT * FROM billing_plan WHERE status = 'planned' ${W}`, ...args)) put(addDays(pl.expected_date, rawGet("partners", pl.client_id)?.payment_days ?? 30), Math.round(pl.amount * (1 + (pl.vat_rate || 0) / 100)), "plan", "billing_plan", pl.id, pl.description, false);
  for (const g of q.all(`SELECT * FROM grants WHERE status IN ('granted','partial_paid','paid') ${W}`, ...args)) {
    let ins = []; try { ins = JSON.parse(g.installments || "[]"); } catch { /* none */ }
    if (ins.length) for (const x of ins) { if (!x.received) put(x.date, Math.round((Number(x.amount) || 0) * 100), "grant", "grants", g.id, g.name, false); }
    else if ((g.granted || 0) > (g.received || 0)) put(addDays(g.resolution_date || t, 60), g.granted - g.received, "grant", "grants", g.id, g.name, false);
  }
  for (const b of q.all(`SELECT * FROM bills WHERE status IN ('pending','approved') ${W}`, ...args)) put(b.due_date || b.date, -b.total, "bill", "bills", b.id, `${b.supplier_name || ""} ${b.description}`.trim(), false);
  for (const b of q.all(`SELECT * FROM bills WHERE status = 'paid' AND paid_date >= ? ${W}`, start, ...args)) put(b.paid_date, -b.total, "bill", "bills", b.id, `${b.supplier_name || ""} ${b.description}`.trim(), true);
  for (const o of q.all(`SELECT * FROM purchase_orders WHERE status = 'approved' ${W}`, ...args)) put(o.needed_date || addDays(t, 30), -Math.round(o.amount * (1 + (o.vat_rate || 0) / 100)), "po", "purchase_orders", o.id, `${o.number} ${o.description}`, false);
  if (forecast) {
    for (const b of q.all(`SELECT * FROM budgets WHERE kind = 'budget' AND status = 'approved' ${W}`, ...args)) {
      const r = budgetRemaining(b.id); if (r <= 0) continue;
      const end = rawGet("seasons", b.season_id)?.end_date || rawGet("programs", b.program_id)?.end_date || addMonths(t, 3); const span = Math.max(1, Math.min(n, Math.round(diffDays(t, end) / 30) || 1));
      for (let i = 0; i < span; i++) put(addMonths(t, i), -Math.round(r / span), "forecast", "budgets", b.id, `${b.name} v${b.version}`, false);
    }
  }
  let opening = Math.round((getSetting("finance", {}).opening_balance || 0) * 100);
  const out = buckets.map((b) => { opening += b.in - b.out; return { month: b.month, in: E(b.in), out: E(b.out), net: E(b.in - b.out), balance: E(opening) }; });
  return { buckets: out, details: details.sort((a, b) => a.date.localeCompare(b.date)), opening_balance: getSetting("finance", {}).opening_balance || 0, totals: { in: round2(sum(out, "in")), out: round2(sum(out, "out")) } };
}
function budgetRemaining(budgetId) {
  const planned = q.get("SELECT COALESCE(SUM(amount),0) AS s FROM budget_lines WHERE budget_id = ?", budgetId).s;
  const act = q.get(`SELECT COALESCE(SUM(base),0) AS s FROM bills WHERE budget_line_id IN (SELECT id FROM budget_lines WHERE budget_id = ?) AND status IN ('approved','paid','pending')`, budgetId).s;
  const com = q.get("SELECT COALESCE(SUM(amount),0) AS s FROM purchase_orders WHERE status = 'approved' AND budget_line_id IN (SELECT id FROM budget_lines WHERE budget_id = ?)", budgetId).s;
  return planned - act - com;
}

// ---- taxes ----------------------------------------------------------------------------------------------------------------------------
export function taxReport(ctx, { year, quarter } = {}) {
  need(ctx, "fin.view");
  const y = String(year || today().slice(0, 4)); const qn = quarter ? Number(String(quarter).replace(/\D/g, "")) : 0;
  const from = qn ? `${y}-${String((qn - 1) * 3 + 1).padStart(2, "0")}-01` : `${y}-01-01`, to = qn ? addDays(addMonths(from, 3), -1) : `${y}-12-31`;
  const out = q.all("SELECT vat_rate, SUM(base) AS base, SUM(vat) AS vat, SUM(irpf) AS irpf, COUNT(*) AS n FROM client_invoices WHERE status NOT IN ('draft','void') AND date BETWEEN ? AND ? GROUP BY vat_rate ORDER BY vat_rate", from, to);
  const inn = q.all(`SELECT vat_rate, SUM(base) AS base, SUM(vat) AS vat, COUNT(*) AS n FROM bills WHERE status IN ${OK_BILL} AND date BETWEEN ? AND ? GROUP BY vat_rate ORDER BY vat_rate`, from, to);
  const payees = q.all(`SELECT COALESCE(person_id, 0) AS person_id, COALESCE(supplier_id, 0) AS supplier_id, COALESCE(NULLIF(supplier_name,''), '') AS name, SUM(base) AS base, SUM(irpf) AS irpf, COUNT(*) AS n FROM bills WHERE status IN ${OK_BILL} AND irpf > 0 AND date BETWEEN ? AND ? GROUP BY person_id, supplier_id, name ORDER BY irpf DESC`, from, to)
    .map((r) => { const p = r.person_id ? rawGet("people", r.person_id) : null; const s = r.supplier_id ? rawGet("partners", r.supplier_id) : null; let nid = ""; if (p?.national_id && has(ctx, "people.view")) { try { nid = decField(p.national_id); } catch { nid = ""; } } return { name: p?.name || s?.name || r.name, tax_id: nid || s?.vat_id || "", base: E(r.base), irpf: E(r.irpf), invoices: r.n }; });
  const mapRows = (rows) => rows.map((r) => ({ vat_rate: r.vat_rate, base: E(r.base), vat: E(r.vat), invoices: r.n, irpf: E(r.irpf || 0) }));
  const rep = mapRows(out), sop = mapRows(inn);
  return { period: { year: y, quarter: qn ? `Q${qn}` : "", from, to }, vat_collected: rep, vat_paid: sop, withholding_paid: payees,
    totals: { vat_collected: round2(sum(rep, "vat")), vat_paid: round2(sum(sop, "vat")), vat_balance: round2(sum(rep, "vat") - sum(sop, "vat")), withholding_paid: round2(sum(payees, "irpf")), withholding_suffered: round2(sum(rep, "irpf")), base_sales: round2(sum(rep, "base")), base_purchases: round2(sum(sop, "base")) } };
}

// ---- profitability --------------------------------------------------------------------------------------------------------------------
export function profitability(ctx, { program } = {}) {
  need(ctx, "fin.view");
  const args = []; const w = []; if (program) { w.push("id = ?"); args.push(Number(program)); } const sp = scopeProgs(ctx); if (sp) { w.push(sp.length ? `id IN (${inList(sp)})` : "0"); args.push(...sp); }
  const rows = q.all(`SELECT id, name, status, contract_value FROM programs ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY name`, ...args).map((p) => {
    const inv = q.get("SELECT COALESCE(SUM(base),0) AS b, COALESCE(SUM(paid_amount),0) AS p FROM client_invoices WHERE program_id = ? AND status NOT IN ('draft','void')", p.id);
    const spons = q.get("SELECT COALESCE(SUM(fee),0) AS s FROM sponsorships WHERE program_id = ? AND status IN ('signed','executed','invoiced')", p.id).s;
    const grants = q.get("SELECT COALESCE(SUM(granted),0) AS s FROM grants WHERE program_id = ? AND status IN ('granted','partial_paid','paid','justified')", p.id).s;
    const cost = q.get(`SELECT COALESCE(SUM(base),0) AS s FROM bills WHERE program_id = ? AND status IN ${OK_BILL}`, p.id).s;
    const com = q.get("SELECT COALESCE(SUM(amount),0) AS s FROM purchase_orders WHERE program_id = ? AND status = 'approved'", p.id).s;
    const bud = q.get("SELECT COALESCE(SUM(subtotal),0) AS s FROM budgets WHERE program_id = ? AND kind = 'budget' AND status = 'approved'", p.id).s;
    const expectedIncome = (p.contract_value || 0) + spons + grants;
    const costF = Math.max(bud, cost + com);
    return { id: p.id, name: p.name, status: p.status, contract_value: E(p.contract_value), invoiced: E(inv.b), collected: E(inv.p), sponsorship: E(spons), grants: E(grants), budget: E(bud), cost: E(cost), committed: E(com),
      margin_to_date: E(inv.b - cost), forecast_income: E(expectedIncome), forecast_cost: E(costF), forecast_margin: E(expectedIncome - costF), forecast_margin_pct: expectedIncome ? Math.round(((expectedIncome - costF) / expectedIncome) * 100) : null };
  });
  return { programs: rows, totals: { invoiced: round2(sum(rows, "invoiced")), cost: round2(sum(rows, "cost")), forecast_margin: round2(sum(rows, "forecast_margin")) } };
}

// ---- resources: conflicts -------------------------------------------------------------------------------------------------------------
const evtLabel = (e) => e;
/** Double bookings of resources and people, and people assigned while unavailable, between two dates. */
export function conflicts(ctx, { from, to, program } = {}) {
  const f = (from || today()).slice(0, 10), t = (to || addDays(f, 60)).slice(0, 10);
  const out = [];
  const bks = q.all("SELECT b.*, r.name AS rname, r.status AS rstatus FROM bookings b JOIN resources r ON r.id = b.resource_id WHERE b.status != 'cancelled' AND substr(b.end,1,10) >= ? AND substr(b.start,1,10) <= ? ORDER BY b.resource_id, b.start", f, t);
  for (let i = 0; i < bks.length; i++) {
    if (["maintenance", "retired"].includes(bks[i].rstatus)) out.push({ kind: "resource_unavailable", severity: "high", resource: bks[i].rname, a: ref("bookings", bks[i]) });
    for (let j = i + 1; j < bks.length && bks[j].resource_id === bks[i].resource_id; j++)
      if (dtMin(bks[j].start) < dtMin(bks[i].end) && dtMin(bks[i].start) < dtMin(bks[j].end)) out.push({ kind: "booking_overlap", severity: bks[i].status === "confirmed" && bks[j].status === "confirmed" ? "high" : "medium", resource: bks[i].rname, a: ref("bookings", bks[i]), b: ref("bookings", bks[j]) });
  }
  const crew = q.all("SELECT c.*, p.name AS pname FROM crew_assignments c JOIN people p ON p.id = c.person_id WHERE c.status != 'declined' AND substr(c.end,1,10) >= ? AND substr(c.start,1,10) <= ? ORDER BY c.person_id, c.start", f, t);
  for (let i = 0; i < crew.length; i++) for (let j = i + 1; j < crew.length && crew[j].person_id === crew[i].person_id; j++)
    if (dtMin(crew[j].start) < dtMin(crew[i].end) && dtMin(crew[i].start) < dtMin(crew[j].end)) out.push({ kind: "person_double_booked", severity: "high", person: crew[i].pname, a: ref("crew_assignments", crew[i]), b: ref("crew_assignments", crew[j]) });
  for (const c of crew) for (const a of q.all("SELECT * FROM availability WHERE person_id = ? AND kind IN ('unavailable','holiday','sick') AND end_date >= ? AND start_date <= ?", c.person_id, c.start.slice(0, 10), c.end.slice(0, 10)))
    out.push({ kind: "person_unavailable", severity: "high", person: c.pname, a: ref("crew_assignments", c), b: { entity: "availability", id: a.id, label: `${a.kind} ${a.start_date}→${a.end_date}`, start: a.start_date, end: a.end_date } });
  const res = ctx.external ? out.filter(() => false) : out;
  return program ? res.filter((c) => [c.a, c.b].some((x) => x && x.program_id == program)) : res;
}
const ref = (entity, r) => ({ entity, id: r.id, label: r.title || r.role || "", start: r.start, end: r.end, program_id: r.program_id });
/** Used by the UI before saving a booking/assignment: who/what collides with this slot. */
export function checkSlot(ctx, { resource_id, person_id, start, end, exclude_booking, exclude_crew }) {
  const s = dtMin(start), e = dtMin(end), hits = [];
  if (resource_id) for (const b of q.all("SELECT * FROM bookings WHERE resource_id = ? AND status != 'cancelled' AND id != ?", Number(resource_id), Number(exclude_booking) || 0)) if (dtMin(b.start) < e && s < dtMin(b.end)) hits.push({ kind: "booking_overlap", ...ref("bookings", b) });
  if (person_id) {
    for (const c of q.all("SELECT * FROM crew_assignments WHERE person_id = ? AND status != 'declined' AND id != ?", Number(person_id), Number(exclude_crew) || 0)) if (dtMin(c.start) < e && s < dtMin(c.end)) hits.push({ kind: "person_double_booked", ...ref("crew_assignments", c) });
    for (const a of q.all("SELECT * FROM availability WHERE person_id = ? AND kind IN ('unavailable','holiday','sick') AND end_date >= ? AND start_date <= ?", Number(person_id), start.slice(0, 10), end.slice(0, 10))) hits.push({ kind: "person_unavailable", entity: "availability", id: a.id, label: a.kind, start: a.start_date, end: a.end_date });
  }
  return { conflicts: hits };
}

// ---- working time -----------------------------------------------------------------------------------------------------------------------
export function timesheetReport(ctx, { from, to, person_id, program_id } = {}) {
  const f = from || addDays(today(), -28), t = to || today();
  const where = ["t.date BETWEEN ? AND ?"], args = [f, t];
  if (person_id) { where.push("t.person_id = ?"); args.push(Number(person_id)); } if (program_id) { where.push("t.program_id = ?"); args.push(Number(program_id)); }
  const rows = q.all(`SELECT t.*, p.name AS pname, p.agreement_id FROM timesheets t JOIN people p ON p.id = t.person_id WHERE ${where.join(" AND ")} ORDER BY p.name, t.date`, ...args);
  const byP = new Map();
  for (const r of rows) {
    const ag = r.agreement_id ? rawGet("agreements", r.agreement_id) : null, p = byP.get(r.person_id) || { person_id: r.person_id, name: r.pname, agreement: ag?.name || "", max_weekly: ag?.max_weekly_hours ?? 40, max_overtime_year: ag?.max_overtime_year ?? 80, weeks: new Map(), hours: 0, overtime: 0, night: 0, violations: [] };
    const wk = mondayOf(r.date), w = p.weeks.get(wk) || { week: wk, hours: 0, overtime: 0, night: 0, days: 0 };
    w.hours += r.hours || 0; w.overtime += r.overtime || 0; w.night += r.night_hours || 0; w.days++; p.weeks.set(wk, w);
    p.hours += r.hours || 0; p.overtime += r.overtime || 0; p.night += r.night_hours || 0;
    if (!r.rest_ok) p.violations.push({ kind: "rest", date: r.date, id: r.id });
    if (r.overtime > 0) p.violations.push({ kind: "overtime", date: r.date, id: r.id, hours: r.overtime });
    byP.set(r.person_id, p);
  }
  const people = [...byP.values()].map((p) => {
    const weeks = [...p.weeks.values()].map((w) => ({ ...w, hours: round2(w.hours), overtime: round2(w.overtime), night: round2(w.night), over_limit: w.hours > p.max_weekly }));
    for (const w of weeks) if (w.over_limit) p.violations.push({ kind: "weekly", date: w.week, hours: w.hours });
    const yr = q.get("SELECT COALESCE(SUM(overtime),0) AS s FROM timesheets WHERE person_id = ? AND substr(date,1,4) = ?", p.person_id, t.slice(0, 4)).s;
    return { person_id: p.person_id, name: p.name, agreement: p.agreement, hours: round2(p.hours), overtime: round2(p.overtime), night: round2(p.night), overtime_year: round2(yr), max_overtime_year: p.max_overtime_year, weeks, violations: p.violations };
  });
  return { from: f, to: t, people, totals: { hours: round2(sum(people, "hours")), overtime: round2(sum(people, "overtime")), violations: people.reduce((s, p) => s + p.violations.length, 0) } };
}

// ---- rundown, gantt -----------------------------------------------------------------------------------------------------------------------
export function rundownTiming(ctx, { episode_id }) {
  const ep = rawGet("episodes", episode_id); if (!ep) throw bad("no_episode");
  const items = q.all("SELECT * FROM rundown_items WHERE episode_id = ? ORDER BY position, id", ep.id);
  const bc = q.get("SELECT start_time FROM broadcasts WHERE episode_id = ? ORDER BY date, start_time LIMIT 1", ep.id);
  const base = bc ? hhmmToMin(bc.start_time) * 60 : 0; let t = 0; const rows = [], blocks = new Map();
  for (const it of items) {
    let note = "";
    if (it.fixed_time) { const fixed = hhmmToMin(it.fixed_time) * 60 - base; if (fixed !== t) note = fixed > t ? `gap:${fixed - t}` : `over:${t - fixed}`; }
    const startSec = base + t; rows.push({ ...it, start: clock(startSec), end: clock(startSec + it.duration_sec), offset_sec: t, note });
    t += it.duration_sec || 0; const k = it.block || ""; blocks.set(k, (blocks.get(k) || 0) + (it.duration_sec || 0));
  }
  return { episode_id: ep.id, start: bc ? bc.start_time : "00:00", items: rows, total_sec: t, target_sec: ep.duration_target || 0, diff_sec: ep.duration_target ? t - ep.duration_target : 0, blocks: [...blocks].map(([block, sec]) => ({ block, sec })) };
}
const clock = (sec) => { const s = ((sec % 86400) + 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/** Milestones of a programme with their dependencies, the critical path and which ones start before their predecessors end. */
export function gantt(ctx, { program_id, season_id }) {
  const rows = q.all(`SELECT * FROM milestones WHERE program_id = ? ${season_id ? "AND season_id = ?" : ""} ORDER BY start_date, id`, ...[Number(program_id), ...(season_id ? [Number(season_id)] : [])]);
  const byId = new Map(rows.map((r) => [r.id, { ...r, deps: safeArr(r.depends_on), end: r.end_date || r.start_date }]));
  const memo = new Map(), dur = (m) => Math.max(1, diffDays(m.start_date, m.end) + 1);
  const longest = (id, seen = new Set()) => { if (memo.has(id)) return memo.get(id); if (seen.has(id)) return { len: 0, path: [] }; seen.add(id); const m = byId.get(id); let best = { len: 0, path: [] };
    for (const d of m.deps) if (byId.has(d)) { const r = longest(d, seen); if (r.len > best.len) best = r; } const res = { len: best.len + dur(m), path: [...best.path, id] }; memo.set(id, res); return res; };
  let crit = { len: 0, path: [] }; for (const id of byId.keys()) { const r = longest(id); if (r.len > crit.len) crit = r; }
  const cset = new Set(crit.path);
  const tasks = [...byId.values()].map((m) => {
    const viol = m.deps.filter((d) => byId.has(d) && byId.get(d).end > m.start_date);
    return { id: m.id, title: m.title, kind: m.kind, start: m.start_date, end: m.end, progress: m.progress, status: m.status, owner: m.owner, depends_on: m.deps, critical: cset.has(m.id), violates: viol, late: m.status !== "done" && m.end < today() };
  });
  const min = tasks.reduce((a, t) => (!a || t.start < a ? t.start : a), ""), max = tasks.reduce((a, t) => (!a || t.end > a ? t.end : a), "");
  return { tasks, from: min, to: max, critical_days: crit.len };
}
const safeArr = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(Number) : []; } catch { return []; } };

// ---- audiences ------------------------------------------------------------------------------------------------------------------------
export function ratingsSummary(ctx, { program_id, season_id }) {
  const args = [Number(program_id)]; let w = "r.program_id = ?"; if (season_id) { w += " AND e.season_id = ?"; args.push(Number(season_id)); }
  const rows = q.all(`SELECT r.*, e.number AS epn, e.title AS ept, e.season_id FROM ratings r LEFT JOIN episodes e ON e.id = r.episode_id WHERE ${w} ORDER BY r.date`, ...args);
  const avg = (a) => (a.length ? round2(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const series = rows.map((r) => ({ id: r.id, date: r.date, episode: r.epn ? `E${r.epn}` : "", audience: r.audience_avg, share: r.share_pct, rating: r.rating_pct, reach: r.reach, target: r.target_label, source: r.source }));
  const sh = rows.map((r) => r.share_pct).filter((x) => x != null), au = rows.map((r) => r.audience_avg).filter((x) => x != null);
  const best = rows.reduce((b, r) => (r.share_pct != null && (!b || r.share_pct > b.share_pct) ? r : b), null), worst = rows.reduce((b, r) => (r.share_pct != null && (!b || r.share_pct < b.share_pct) ? r : b), null);
  const bySeason = {}; for (const r of rows) { const k = r.season_id || 0; (bySeason[k] ||= []).push(r); }
  return { series, avg_share: avg(sh), avg_audience: avg(au), best: best && { date: best.date, share: best.share_pct, episode: best.epn }, worst: worst && { date: worst.date, share: worst.share_pct, episode: worst.epn },
    seasons: Object.entries(bySeason).map(([id, a]) => ({ season_id: Number(id) || null, share: avg(a.map((r) => r.share_pct).filter((x) => x != null)), audience: avg(a.map((r) => r.audience_avg).filter((x) => x != null)), n: a.length })) };
}

/** Audience forecast of a programme for a target: the upcoming planned broadcasts (or, with none, the next weekly slots) and an optional what-if slot { date, time, kind }. */
export function audienceForecast(ctx, { program_id, target, scenario, weeks = 6 }) {
  const rows = q.all(`SELECT r.date, r.audience_avg, r.share_pct, r.target_label, r.broadcast_id, b.start_time, b.kind FROM ratings r LEFT JOIN broadcasts b ON b.id = r.broadcast_id WHERE r.program_id = ? ORDER BY r.date, r.id`, Number(program_id));
  const counts = {}; for (const r of rows) counts[r.target_label || ""] = (counts[r.target_label || ""] || 0) + 1;
  const targets = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n })), chosen = target != null && target in counts ? target : targets[0]?.label;
  const hist = rows.filter((r) => (r.target_label || "") === chosen);
  const mk = (key) => hist.filter((r) => r[key] != null).map((r) => ({ value: Number(r[key]), date: r.date, time: r.start_time, kind: r.kind }));
  const withRatings = new Set(rows.map((r) => r.broadcast_id).filter(Boolean));
  let slots = q.all(`SELECT b.id, b.date, b.start_time AS time, b.kind, b.status, e.number AS episode FROM broadcasts b LEFT JOIN episodes e ON e.id = b.episode_id WHERE b.program_id = ? AND b.date >= ? AND b.status IN ('planned','confirmed') ORDER BY b.date, b.start_time`, Number(program_id), today()).filter((b) => !withRatings.has(b.id)).map((b) => ({ id: b.id, date: b.date, time: b.start_time, kind: b.kind, episode: b.episode ? `E${b.episode}` : "" }));
  let projected = false;
  if (!slots.length && hist.length) {   // nothing planned: repeat the usual slot every week
    const last = hist[hist.length - 1], kinds = {}; for (const r of hist) if (r.kind) kinds[r.kind] = (kinds[r.kind] || 0) + 1; const kind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0];
    let d = last.date; while (d < today()) d = addDays(d, 7);
    slots = Array.from({ length: Math.max(1, Math.min(12, Number(weeks) || 6)) }, (_, i) => ({ date: addDays(d, 7 * (i + (d === last.date ? 1 : 0))), time: last.start_time || "", kind: kind || "", episode: "" })); projected = true;
  }
  const aud = forecastMeasure(mk("audience_avg"), slots, 0), shr = forecastMeasure(mk("share_pct"), slots, 1);
  let what_if = null;
  if (scenario?.date) { const sl = [{ date: scenario.date, time: scenario.time || "", kind: scenario.kind || "" }]; const a = forecastMeasure(mk("audience_avg"), sl, 0), h = forecastMeasure(mk("share_pct"), sl, 1); what_if = { slot: sl[0], audience: a.slots[0].forecast, share: h.slots[0].forecast, factors: a.slots[0].factors || [] }; }
  return { target: chosen || null, targets, history: hist.map((r) => ({ date: r.date, audience: r.audience_avg, share: r.share_pct })), projected,
    quality: aud.quality, model: { audience: aud.model, share: shr.model }, slots: slots.map((s, i) => ({ ...s, audience: aud.slots[i].forecast, share: shr.slots[i].forecast, factors: aud.slots[i].factors || [] })), what_if };
}

// ---- delivery readiness & rights coverage ------------------------------------------------------------------------------------------------------
export function rightsCheck(ctx, { episode_id }) {
  const ep = rawGet("episodes", episode_id); if (!ep) throw bad("no_episode");
  const air = ep.air_date || q.get("SELECT date FROM broadcasts WHERE episode_id = ? ORDER BY date LIMIT 1", ep.id)?.date || "";
  const rights = q.all("SELECT * FROM rights WHERE (episode_id = ? OR (program_id = ? AND episode_id IS NULL)) AND status != 'expired'", ep.id, ep.program_id);
  const items = rights.map((r) => {
    let state = "ok", why = "";
    if (r.status === "negotiating") { state = "bad"; why = "negotiating"; }
    else if (!r.perpetual && air && r.window_start && air < r.window_start) { state = "bad"; why = "before_window"; }
    else if (!r.perpetual && air && r.window_end && air > r.window_end) { state = "bad"; why = "after_window"; }
    else if (!r.perpetual && r.window_end && diffDays(today(), r.window_end) < 60) { state = "warn"; why = "expiring"; }
    if (state === "ok" && r.max_runs && r.runs_used >= r.max_runs) { state = "bad"; why = "runs_exhausted"; }
    return { id: r.id, title: r.title, kind: r.kind, holder: r.holder, media: r.media, territory: r.territory, window_start: r.window_start, window_end: r.window_end, perpetual: r.perpetual, state, why };
  });
  const cues = q.all("SELECT i.* FROM cue_items i JOIN cue_sheets s ON s.id = i.cue_sheet_id WHERE s.episode_id = ?", ep.id);
  const unlicensed = cues.filter((c) => !c.right_id).map((c) => ({ id: c.id, title: c.title }));
  const contracts = q.all("SELECT id, title, status, end_date FROM contracts WHERE episode_id = ?", ep.id);
  return { episode_id: ep.id, air_date: air, rights: items, music_without_right: unlicensed, music_total: cues.length, contracts, ok: !items.some((i) => i.state === "bad") && !unlicensed.length };
}

/** Checklist of what is missing for an episode to be delivered: approved assets, QC result, blocking issues, compliance checks, rights, cue sheet, approvals and the chosen delivery spec's own checklist. */
export function deliveryReadiness(ctx, { episode_id, spec_id }) {
  const ep = rawGet("episodes", episode_id); if (!ep) throw bad("no_episode");
  const spec = spec_id ? rawGet("delivery_specs", spec_id) : null;
  const assets = q.all("SELECT * FROM assets WHERE episode_id = ? AND status = 'approved'", ep.id);
  const qc = q.get("SELECT * FROM qc_reports WHERE episode_id = ? ORDER BY date DESC, id DESC LIMIT 1", ep.id);
  const issues = q.get("SELECT COUNT(*) AS n FROM qc_issues WHERE episode_id = ? AND status IN ('open','in_progress') AND severity IN ('high','blocker')", ep.id).n;
  const cue = q.get("SELECT status FROM cue_sheets WHERE episode_id = ? ORDER BY id DESC LIMIT 1", ep.id);
  const comp = q.get("SELECT COUNT(*) AS n FROM compliance_checks WHERE episode_id = ? AND status IN ('pending','review','breach')", ep.id).n;
  const appr = q.all("SELECT kind, status FROM approvals WHERE entity = 'episodes' AND row_id = ?", ep.id);
  const rc = rightsCheck(ctx, { episode_id });
  let checklist = []; try { checklist = JSON.parse(spec?.checklist || "[]"); } catch { /* none */ }
  const steps = [
    { key: "assets", ok: assets.length > 0, detail: assets.length },
    { key: "qc", ok: !!qc && qc.result !== "fail", detail: qc?.result || null },
    { key: "issues", ok: issues === 0, detail: issues },
    { key: "compliance", ok: comp === 0, detail: comp },
    { key: "rights", ok: rc.ok, detail: rc.rights.filter((r) => r.state === "bad").length + rc.music_without_right.length },
    { key: "cue_sheet", ok: !!cue && ["ready", "submitted"].includes(cue.status), detail: cue?.status || null },
    { key: "approvals", ok: appr.length > 0 && appr.every((a) => a.status === "approved"), detail: appr.map((a) => `${a.kind}:${a.status}`) },
  ];
  return { episode_id: ep.id, steps, ready: steps.every((s) => s.ok), checklist };
}
