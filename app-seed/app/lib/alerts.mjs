// Alerts (things that need attention) and the portfolio dashboard. Every alert is { key, severity: high|medium|low, kind, entity, id, program_id, date, params } and the UI
// builds the sentence from i18n `alert.<kind>`. Alerts are computed on demand from the data, filtered by what the caller may see.
import { q, getSetting } from "./db.mjs";
import { has, memberPrograms } from "./access.mjs";
import { today, addDays, diffDays, mondayOf, round2 } from "./util.mjs";
import * as R from "./reports.mjs";

const OK_BILL = "('approved','paid')";
const E = (c) => Math.round(c || 0) / 100;

export function alerts(ctx, { program } = {}) {
  const t = today(), out = [];
  const add = (severity, kind, entity, id, program_id, date, params = {}) => out.push({ key: `${kind}:${entity}:${id}`, severity, kind, entity, id, program_id, date, params });
  const scope = ctx.external ? memberPrograms(ctx) : null;
  const P = (col = "program_id") => { const a = [], w = []; if (program) { w.push(`${col} = ${Number(program)}`); } if (scope) w.push(scope.length ? `${col} IN (${scope.join(",") || 0})` : "0"); return w.length ? " AND " + w.join(" AND ") : ""; };
  const prod = has(ctx, "app.view"), fin = has(ctx, "fin.view") && !ctx.external, legal = has(ctx, "legal.view") && !ctx.external;
  const thresholds = getSetting("alerts", { contract_days: 60, right_days: 60, grant_days: 45, overrun_warn: 90, delivery_days: 7 });

  if (prod) {
    for (const e of q.all(`SELECT id, program_id, number, title, status, delivery_due, air_date FROM episodes WHERE status NOT IN ('delivered','aired') AND ((delivery_due != '' AND delivery_due < ?) OR (air_date != '' AND air_date <= ?)) ${P()}`, t, addDays(t, thresholds.delivery_days)))
      add(e.delivery_due && e.delivery_due < t ? "high" : "medium", "episode_late", "episodes", e.id, e.program_id, e.delivery_due || e.air_date, { number: e.number, status: e.status });
    for (const k of q.all(`SELECT id, program_id, title, due, assignee FROM tasks WHERE status != 'done' AND due != '' AND due < ? ${ctx.external ? "AND assignee = '" + String(ctx.user).replace(/'/g, "''") + "'" : ""} ${P()} ORDER BY due LIMIT 60`, t))
      add("low", "task_overdue", "tasks", k.id, k.program_id, k.due, { title: k.title, assignee: k.assignee });
    for (const a of q.all(`SELECT id, program_id, subject, created FROM approvals WHERE status = 'pending' AND created < ? ${P()} LIMIT 40`, addDays(t, -3) + "T")) add("low", "approval_waiting", "approvals", a.id, a.program_id, a.created.slice(0, 10), { subject: a.subject });
    for (const i of q.all(`SELECT id, program_id, episode_id, severity FROM qc_issues WHERE status IN ('open','in_progress') AND severity IN ('high','blocker') ${P()}`)) add(i.severity === "blocker" ? "high" : "medium", "qc_issue_open", "qc_issues", i.id, i.program_id, "", { episode_id: i.episode_id, severity: i.severity });
    for (const c of q.all(`SELECT c.id, c.program_id, c.episode_id, c.area, c.status, e.air_date FROM compliance_checks c JOIN episodes e ON e.id = c.episode_id WHERE c.status IN ('breach','review') AND e.air_date != '' AND e.air_date <= ? ${P("c.program_id")}`, addDays(t, 14)))
      add(c.status === "breach" ? "high" : "medium", "compliance_issue", "compliance_checks", c.id, c.program_id, c.air_date, { area: c.area, status: c.status });
    for (const d of q.all(`SELECT d.id, d.program_id, d.episode_id, e.air_date FROM deliveries d JOIN episodes e ON e.id = d.episode_id WHERE d.status = 'preparing' AND e.air_date != '' AND e.air_date <= ? ${P("d.program_id")}`, addDays(t, thresholds.delivery_days)))
      add("medium", "delivery_pending", "deliveries", d.id, d.program_id, d.air_date, { episode_id: d.episode_id });
    for (const c of R.conflicts(ctx, { from: t, to: addDays(t, 30), program })) add(c.severity, c.kind === "booking_overlap" ? "booking_conflict" : c.kind === "resource_unavailable" ? "resource_unavailable" : c.kind === "person_double_booked" ? "person_double_booked" : "person_unavailable", c.a.entity, c.a.id, c.a.program_id, (c.a.start || "").slice(0, 10), { resource: c.resource, person: c.person, other: c.b?.label });
    for (const r of q.all(`SELECT b.id, b.program_id, b.episode_id, b.date FROM broadcasts b WHERE b.status = 'aired' AND b.date < ? AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.broadcast_id = b.id) ${P("b.program_id")} LIMIT 20`, addDays(t, -3))) add("low", "ratings_missing", "broadcasts", r.id, r.program_id, r.date, {});
    for (const e of q.all(`SELECT e.id, e.program_id, e.number FROM episodes e WHERE e.status IN ('delivered','aired') AND NOT EXISTS (SELECT 1 FROM cue_sheets s WHERE s.episode_id = e.id AND s.status IN ('ready','submitted')) AND EXISTS (SELECT 1 FROM cue_items i JOIN cue_sheets s2 ON s2.id = i.cue_sheet_id WHERE s2.episode_id = e.id) ${P("e.program_id")} LIMIT 20`)) add("low", "cue_sheet_open", "episodes", e.id, e.program_id, "", { number: e.number });
  }
  if (has(ctx, "people.view") && !ctx.external) {
    const tr = R.timesheetReport(ctx, { from: addDays(t, -14), to: t });
    for (const p of tr.people) for (const v of p.violations.slice(0, 4)) add(v.kind === "rest" ? "high" : "medium", `work_${v.kind}`, "people", p.person_id, null, v.date, { person: p.name, hours: v.hours });
  }
  if (fin) {
    for (const b of q.all(`SELECT id, program_id, supplier_name, description, due_date, total FROM bills WHERE status IN ('pending','approved') AND due_date != '' AND due_date < ? ${P()} LIMIT 60`, t)) add("medium", "bill_overdue", "bills", b.id, b.program_id, b.due_date, { supplier: b.supplier_name, amount: E(b.total) });
    for (const b of q.all(`SELECT id, program_id, supplier_name, total FROM bills WHERE status = 'pending' AND date < ? ${P()} LIMIT 30`, addDays(t, -7))) add("low", "bill_pending_approval", "bills", b.id, b.program_id, "", { supplier: b.supplier_name, amount: E(b.total) });
    for (const o of q.all(`SELECT id, program_id, number FROM purchase_orders WHERE status = 'pending' ${P()}`)) add("low", "po_pending", "purchase_orders", o.id, o.program_id, "", { number: o.number });
    for (const i of q.all(`SELECT id, program_id, number, due_date, total, paid_amount FROM client_invoices WHERE status IN ('issued','partial') AND due_date != '' AND due_date < ? ${P()}`, t)) add("high", "invoice_overdue", "client_invoices", i.id, i.program_id, i.due_date, { number: i.number, amount: E(i.total - i.paid_amount) });
    for (const g of q.all(`SELECT id, program_id, name, justify_by FROM grants WHERE status IN ('granted','partial_paid','paid') AND justify_by != '' AND justify_by <= ? ${P()}`, addDays(t, thresholds.grant_days))) add(g.justify_by < t ? "high" : "medium", "grant_justify", "grants", g.id, g.program_id, g.justify_by, { name: g.name });
    for (const b of q.all(`SELECT id, program_id FROM budgets WHERE kind = 'budget' AND status = 'approved' ${P()}`)) {
      const r = R.budgetReport(ctx, { budget_id: b.id });
      if (r.totals.pct != null && r.totals.pct >= thresholds.overrun_warn) add(r.totals.pct > 100 ? "high" : "medium", "budget_overrun", "budgets", b.id, b.program_id, "", { pct: r.totals.pct, name: r.budget.name });
    }
  }
  if (legal) {
    for (const c of q.all(`SELECT id, program_id, title, end_date, notice_days, auto_renew FROM contracts WHERE status IN ('active','signing') AND end_date != '' AND end_date <= ? ${P()}`, addDays(t, thresholds.contract_days))) {
      const left = diffDays(t, c.end_date); if (left > Math.max(c.notice_days || 0, 15) && left > 0 && left > thresholds.contract_days) continue;
      add(left < 0 ? "high" : left <= (c.notice_days || 30) ? "medium" : "low", left < 0 ? "contract_expired" : "contract_expiring", "contracts", c.id, c.program_id, c.end_date, { title: c.title, days: left });
    }
    for (const r of q.all(`SELECT id, program_id, title, window_end FROM rights WHERE perpetual = 0 AND status != 'expired' AND window_end != '' AND window_end <= ? ${P()}`, addDays(t, thresholds.right_days))) add(r.window_end < t ? "high" : "medium", r.window_end < t ? "right_expired" : "right_expiring", "rights", r.id, r.program_id, r.window_end, { title: r.title, days: diffDays(t, r.window_end) });
    for (const d of q.all("SELECT id, requester, due FROM dsr_requests WHERE status IN ('received','in_progress') AND due != '' AND due <= ?", addDays(t, 10))) add(d.due < t ? "high" : "medium", "dsr_due", "dsr_requests", d.id, null, d.due, { requester: d.requester });
    for (const c of q.all(`SELECT id, program_id, subject, expires FROM consents WHERE status = 'granted' AND expires != '' AND expires <= ? ${P()}`, addDays(t, 30))) add(c.expires < t ? "medium" : "low", "consent_expiring", "consents", c.id, c.program_id, c.expires, { subject: c.subject });
    for (const p of q.all("SELECT * FROM retention_policies")) {
      try {
        if (!/^[a-z_]+$/.test(p.entity) || !/^[a-z_]+$/.test(p.date_field) || /\b(select|union|insert|update|delete|drop|attach|pragma|create|alter)\b/i.test(p.filter || "")) continue; const cut = addDays(t, -30 * p.months);
        const n = q.get(`SELECT COUNT(*) AS n FROM ${p.entity} WHERE ${p.date_field} != '' AND ${p.date_field} < ? ${p.filter && /^[\w\s='<>!(),.%-]+$/.test(p.filter) ? " AND " + p.filter : ""}`, cut).n;
        if (n) add("low", "retention_due", "retention_policies", p.id, null, "", { name: p.name, count: n, action: p.action });
      } catch { /* a bad policy never breaks alerts */ }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.date || "9").localeCompare(b.date || "9"));
}

export function dashboard(ctx, { program } = {}) {
  const t = today(), scope = ctx.external ? memberPrograms(ctx) : null;
  const pw = (col = "id") => (scope ? ` AND ${col} IN (${scope.join(",") || 0})` : "") + (program ? ` AND ${col} = ${Number(program)}` : "");
  const programs = q.all(`SELECT status, COUNT(*) AS n FROM programs WHERE 1=1 ${pw()} GROUP BY status`);
  const pipeline = q.all(`SELECT status, COUNT(*) AS n FROM episodes WHERE 1=1 ${pw("program_id")} GROUP BY status`);
  const upcoming = q.all(`SELECT e.id, e.number, e.title, e.status, e.air_date, e.program_id, p.name AS program FROM episodes e JOIN programs p ON p.id = e.program_id WHERE e.air_date >= ? AND e.status != 'aired' ${pw("e.program_id")} ORDER BY e.air_date LIMIT 8`, t);
  const week = mondayOf(t), weekEnd = addDays(week, 6);
  const bookings = ctx.external ? [] : q.all("SELECT b.id, b.title, b.start, b.end, r.name AS resource, b.status FROM bookings b JOIN resources r ON r.id = b.resource_id WHERE b.status != 'cancelled' AND substr(b.start,1,10) BETWEEN ? AND ? ORDER BY b.start LIMIT 12", t, addDays(t, 7));
  const out = { today: t, programs, pipeline, upcoming, bookings, alerts: alerts(ctx, { program }).slice(0, 40) };
  out.alert_counts = out.alerts.reduce((a, x) => { a[x.severity] = (a[x.severity] || 0) + 1; return a; }, {});
  const myTasks = q.all(`SELECT id, title, due, status, program_id FROM tasks WHERE assignee = ? AND status != 'done' ORDER BY (due = ''), due LIMIT 10`, ctx.user);
  out.my_tasks = myTasks;
  out.my_approvals = q.all("SELECT id, subject, kind, program_id, due FROM approvals WHERE approver = ? AND status = 'pending' ORDER BY (due = ''), due LIMIT 10", ctx.user);
  if (has(ctx, "fin.view") && !ctx.external) {
    const prof = R.profitability(ctx, { program });
    const cf = R.cashflow(ctx, { program, months: 6 });
    const recv = q.get(`SELECT COALESCE(SUM(total - paid_amount),0) AS s FROM client_invoices WHERE status IN ('issued','partial') ${pw("program_id")}`).s;
    const over = q.get(`SELECT COALESCE(SUM(total - paid_amount),0) AS s FROM client_invoices WHERE status IN ('issued','partial') AND due_date != '' AND due_date < ? ${pw("program_id")}`, t).s;
    const pay = q.get(`SELECT COALESCE(SUM(total),0) AS s FROM bills WHERE status IN ('pending','approved') ${pw("program_id")}`).s;
    out.finance = { profitability: prof.programs, totals: prof.totals, cashflow: cf.buckets, receivable: E(recv), receivable_overdue: E(over), payable: E(pay) };
  }
  if (has(ctx, "people.view") && !ctx.external) {
    const hrs = q.all("SELECT p.name, ROUND(SUM((julianday(replace(c.end,'T',' ')) - julianday(replace(c.start,'T',' '))) * 24), 1) AS hours FROM crew_assignments c JOIN people p ON p.id = c.person_id WHERE c.status != 'declined' AND substr(c.start,1,10) BETWEEN ? AND ? GROUP BY p.id ORDER BY hours DESC LIMIT 8", week, addDays(week, 27));
    out.workload = hrs;
  }
  const rs = q.all(`SELECT p.name AS program, ROUND(AVG(r.share_pct),1) AS share, ROUND(AVG(r.audience_avg)) AS audience, COUNT(*) AS n FROM ratings r JOIN programs p ON p.id = r.program_id WHERE r.date >= ? ${pw("r.program_id")} GROUP BY r.program_id ORDER BY share DESC LIMIT 8`, addDays(t, -60));
  out.audiences = rs;
  out.risks = q.all(`SELECT id, title, score, status, program_id, owner FROM risks WHERE status IN ('open') ${pw("program_id")} ORDER BY score DESC LIMIT 6`);
  return out;
}
