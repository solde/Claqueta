// Data sources for documents: named queries that return { title, columns, rows, totals?, chart? } already filtered by the caller's permissions.
// A document embeds them with `:::data source=<name> param=value :::` (table) or `:::chart source=<name> type=bar x=.. y=.. :::` (SVG chart).
import { q } from "../db.mjs";
import * as E from "../engine.mjs";
import * as R from "../reports.mjs";
import { alerts as alertsFn } from "../alerts.mjs";
import { ENTITIES } from "../schema.mjs";
import { fieldLabel, optionLabel, entityName, ciLabel } from "../i18n/index.mjs";
import { str } from "./format.mjs";
import { bad, round2, today } from "../util.mjs";

const col = (key, label, type = "text", extra = {}) => ({ key, label, type, ...extra });
const fl = (lang, entity, field) => fieldLabel(lang, entity, field);

/** columns/rows for any entity: refs show their label, enums their translation, money/dates keep their type so renderers format them. */
async function entityTable(ctx, lang, entity, params) {
  const e = ENTITIES[entity]; if (!e) throw bad(`unknown_entity:${entity}`);
  const cols = (params.cols ? String(params.cols).split(",") : e.list).filter((c) => e.fields[c] || ["id", "created", "updated"].includes(c));
  const filters = {}; for (const [k, v] of Object.entries(params)) { if (k.startsWith("f.")) filters[k.slice(2)] = v; }
  if (params.program && e.fields[e.program || "program_id"]) filters[e.program === "id" ? "id" : e.program || "program_id"] = params.program;
  if (params.episode && e.fields.episode_id) filters.episode_id = params.episode;
  if (params.season && e.fields.season_id) filters.season_id = params.season;
  const { rows, refs } = E.list(ctx, entity, { filters, sort: params.sort, limit: Number(params.limit) || 500, q: params.q });
  const columns = cols.map((c) => { const fd = e.fields[c]; const type = fd ? ({ ref: "text", enum: "enum", money: "money", date: "date", datetime: "datetime", num: "num", int: "num", pct: "pct", bool: "bool", tags: "tags" }[fd.type] || "text") : "text"; return col(c, fd ? fl(lang, entity, c) : c, type, { enum: fd?.type === "enum" ? [entity, c] : undefined, align: ["money", "num", "pct"].includes(type) ? "right" : "" }); });
  const out = rows.map((r) => { const o = {}; for (const c of cols) { const fd = e.fields[c]; o[c] = fd?.type === "ref" ? (refs?.[fd.to]?.[r[c]] ?? "") : entity === "compliance_checks" && c === "item" ? ciLabel(lang, r[c]) : r[c]; } return o; });
  return { title: entityName(lang, entity, true), columns, rows: out };
}

/** The data sources documents can query with `:::data source=name` and `:::chart source=name`: each declares its label, parameters and a `run(ctx, params, lang)` that returns typed columns, rows and optional totals, always under the caller's permissions. */
export const DATASETS = {
  entity: { label: "Any entity (entity=, cols=, program=, f.field=value)", params: ["entity", "cols", "program", "episode", "season", "sort", "limit", "q"], run: (ctx, p, lang) => entityTable(ctx, lang, p.entity, p) },
  episodes: { label: "Episodes of a programme", params: ["program", "season"], run: (ctx, p, lang) => entityTable(ctx, lang, "episodes", { ...p, cols: "number,title,status,shoot_date,delivery_due,air_date", sort: "season_id,number" }) },
  tasks: { label: "Tasks", params: ["program", "f.status"], run: (ctx, p, lang) => entityTable(ctx, lang, "tasks", { ...p, cols: "title,assignee,due,priority,status", sort: "due" }) },
  milestones: { label: "Milestones", params: ["program"], run: (ctx, p, lang) => entityTable(ctx, lang, "milestones", { ...p, cols: "title,start_date,end_date,owner,status", sort: "start_date" }) },
  contracts: { label: "Contracts", params: ["program", "f.status"], run: (ctx, p, lang) => entityTable(ctx, lang, "contracts", { ...p, cols: "title,type,party,start_date,end_date,status", sort: "end_date" }) },
  rights: { label: "Rights", params: ["program"], run: (ctx, p, lang) => entityTable(ctx, lang, "rights", { ...p, cols: "title,kind,holder,media,territory,window_start,window_end,status", sort: "window_end" }) },
  targets: { label: "Audience targets", params: ["program"], run: (ctx, p, lang) => entityTable(ctx, lang, "targets", { ...p, cols: "name,age_range,description,habits,channels,needs" }) },
  competitors: { label: "Competition", params: ["program"], run: (ctx, p, lang) => entityTable(ctx, lang, "competitors", { ...p, cols: "programme,channel,slot,share,notes" }) },
  risks: { label: "Risks", params: ["program"], run: (ctx, p, lang) => entityTable(ctx, lang, "risks", { ...p, cols: "title,category,probability,impact,score,owner,status,mitigation", sort: "-score" }) },
  cue_sheet: { label: "Cue sheet items of an episode", params: ["episode"], run: async (ctx, p, lang) => {
    const sheet = q.get("SELECT id FROM cue_sheets WHERE episode_id = ? ORDER BY id DESC LIMIT 1", Number(p.episode)); if (!sheet) return { title: str(lang, "c_cue_sheet"), columns: [], rows: [] };
    return entityTable(ctx, lang, "cue_items", { cols: "position,title,composer,publisher,usage,tc_in,duration_sec,share_pct", "f.cue_sheet_id": sheet.id, sort: "position", limit: 500 }); } },
  qc_issues: { label: "QC issues of an episode", params: ["episode"], run: (ctx, p, lang) => entityTable(ctx, lang, "qc_issues", { ...p, cols: "severity,description,tc,status,assigned" }) },
  rundown: { label: "Rundown with running times", params: ["episode"], run: (ctx, p, lang) => {
    const r = R.rundownTiming(ctx, { episode_id: p.episode });
    return { title: entityName(lang, "rundown_items"), columns: [col("start", str(lang, "c_hora")), col("block", fl(lang, "rundown_items", "block")), col("title", fl(lang, "rundown_items", "title")), col("kind", fl(lang, "rundown_items", "kind"), "enum", { enum: ["rundown_items", "kind"] }),
      col("duration_sec", fl(lang, "rundown_items", "duration_sec"), "duration", { align: "right", total: "sum" }), col("responsible", fl(lang, "rundown_items", "responsible"))], rows: r.items.map((i) => ({ ...i })), meta: { total_sec: r.total_sec, target_sec: r.target_sec, diff_sec: r.diff_sec } }; } },
  crew: { label: "Crew call list of an episode", params: ["episode"], run: (ctx, p, lang) => {
    const rows = q.all("SELECT c.role, c.call_time, c.start, c.end, c.status, pe.name, pe.phone, pe.email FROM crew_assignments c JOIN people pe ON pe.id = c.person_id WHERE c.episode_id = ? AND c.status != 'declined' ORDER BY c.start, pe.name", Number(p.episode));
    return { title: str(lang, "c_equipo"), columns: [col("name", fl(lang, "people", "name")), col("role", fl(lang, "crew_assignments", "role")), col("call_time", fl(lang, "crew_assignments", "call_time")), col("start", fl(lang, "crew_assignments", "start"), "datetime"), col("phone", fl(lang, "people", "phone"))], rows }; } },
  bookings: { label: "Resource bookings of an episode", params: ["episode", "program"], run: (ctx, p, lang) => {
    const w = [], a = []; if (p.episode) { w.push("b.episode_id = ?"); a.push(Number(p.episode)); } if (p.program) { w.push("b.program_id = ?"); a.push(Number(p.program)); }
    const rows = q.all(`SELECT b.title, b.start, b.end, b.status, r.name AS resource, r.location FROM bookings b JOIN resources r ON r.id = b.resource_id WHERE b.status != 'cancelled' ${w.length ? "AND " + w.join(" AND ") : ""} ORDER BY b.start`, ...a);
    return { title: entityName(lang, "bookings", true), columns: [col("resource", fl(lang, "bookings", "resource_id")), col("title", fl(lang, "bookings", "title")), col("start", fl(lang, "bookings", "start"), "datetime"), col("end", fl(lang, "bookings", "end"), "datetime"), col("location", fl(lang, "resources", "location"))], rows }; } },
  budget: { label: "Budget by chapter and line (budget=ID, actuals=1 adds actual/committed)", params: ["budget", "actuals", "lines"], run: (ctx, p, lang) => {
    const r = R.budgetReport(ctx, { budget_id: p.budget }); const actuals = p.actuals === true || p.actuals === "1" || p.actuals === "true", withLines = p.lines === true || p.lines === "1" || p.lines === "true";
    const columns = [col("name", fl(lang, "budget_lines", "description")), col("planned", str(lang, "c_presupuestado"), "money", { align: "right", total: "sum" })];
    if (actuals) columns.push(col("actual", str(lang, "c_real"), "money", { align: "right", total: "sum" }), col("committed", str(lang, "c_comprometido"), "money", { align: "right", total: "sum" }), col("variance", str(lang, "c_desviacion"), "money", { align: "right", total: "sum" }), col("pct", str(lang, "c_usado"), "pct", { align: "right" }));
    const rows = []; for (const c of r.chapters) { rows.push({ name: optionLabel(lang, "budget_lines", "chapter", c.chapter), planned: c.planned, actual: c.actual, committed: c.committed, variance: c.variance, pct: c.pct, _bold: true });
      if (withLines) for (const l of c.lines) rows.push({ name: `${l.code ? l.code + " · " : ""}${l.description}`, planned: l.planned, actual: l.actual, committed: l.committed, variance: l.variance, pct: l.pct, _indent: true }); }
    return { title: `${r.budget.name} v${r.budget.version}`, columns, rows, totals: { name: str(lang, "total"), planned: r.totals.planned_lines, actual: r.totals.actual, committed: r.totals.committed, variance: r.totals.variance, pct: r.totals.pct }, meta: r.totals }; } },
  budget_chapters: { label: "Budget chapters (chart source)", params: ["budget"], run: (ctx, p, lang) => {
    const r = R.budgetReport(ctx, { budget_id: p.budget });
    return { title: str(lang, "c_presupuesto_por_capitulo"), columns: [col("name", str(lang, "c_capitulo")), col("planned", str(lang, "c_presupuestado"), "money"), col("actual", str(lang, "c_real"), "money"), col("committed", str(lang, "c_comprometido"), "money")], rows: r.chapters.map((c) => ({ name: optionLabel(lang, "budget_lines", "chapter", c.chapter), planned: c.planned, actual: c.actual, committed: c.committed })) }; } },
  variance_episodes: { label: "Planned vs actual cost per episode", params: ["program", "season"], run: (ctx, p, lang) => {
    const r = R.episodeVariance(ctx, { program_id: p.program, season_id: p.season });
    return { title: str(lang, "c_desviacion_por_episodio"), columns: [col("ep", entityName(lang, "episodes")), col("planned", str(lang, "c_previsto"), "money", { align: "right", total: "sum" }), col("actual", str(lang, "c_real"), "money", { align: "right", total: "sum" }), col("variance", str(lang, "c_desviacion"), "money", { align: "right", total: "sum" }), col("pct", str(lang, "c_usado"), "pct", { align: "right" })],
      rows: r.episodes.map((e) => ({ ep: `E${e.number}${e.title ? " · " + e.title : ""}`, planned: e.planned, actual: e.actual, variance: e.variance, pct: e.pct })), totals: { ep: str(lang, "total"), ...r.total } }; } },
  cashflow: { label: "Cashflow by month (months=6, forecast=1)", params: ["program", "months", "forecast"], run: (ctx, p, lang) => {
    const r = R.cashflow(ctx, { program: p.program, months: p.months, forecast: p.forecast === "1" || p.forecast === true });
    return { title: str(lang, "c_cashflow"), columns: [col("month", str(lang, "c_mes")), col("in", str(lang, "c_cobros"), "money", { align: "right", total: "sum" }), col("out", str(lang, "c_pagos"), "money", { align: "right", total: "sum" }), col("net", str(lang, "c_neto"), "money", { align: "right", total: "sum" }), col("balance", str(lang, "c_saldo"), "money", { align: "right" })], rows: r.buckets }; } },
  tax: { label: "VAT and withholdings (year=, quarter=Q1..Q4)", params: ["year", "quarter"], run: (ctx, p, lang) => {
    const r = R.taxReport(ctx, p);
    const rows = [...r.vat_collected.map((x) => ({ concept: `${str(lang, "c_iva_repercutido")} ${x.vat_rate}%`, base: x.base, vat: x.vat, n: x.invoices })), ...r.vat_paid.map((x) => ({ concept: `${str(lang, "c_iva_soportado")} ${x.vat_rate}%`, base: x.base, vat: -x.vat, n: x.invoices }))];
    return { title: `${str(lang, "vat")} ${r.period.year} ${r.period.quarter}`.trim(), columns: [col("concept", str(lang, "c_concepto")), col("base", str(lang, "c_base"), "money", { align: "right" }), col("vat", str(lang, "c_cuota"), "money", { align: "right", total: "sum" }), col("n", str(lang, "c_facturas"), "num", { align: "right" })], rows, totals: { concept: str(lang, "c_resultado_a_ingresar_devolver"), vat: r.totals.vat_balance }, meta: r.totals }; } },
  withholdings: { label: "Withholdings paid per payee", params: ["year", "quarter"], run: (ctx, p, lang) => {
    const r = R.taxReport(ctx, p); return { title: str(lang, "c_retenciones"), columns: [col("name", str(lang, "c_perceptor")), col("tax_id", str(lang, "c_nif")), col("base", str(lang, "c_base"), "money", { align: "right", total: "sum" }), col("irpf", str(lang, "c_retencion"), "money", { align: "right", total: "sum" }), col("invoices", str(lang, "c_facturas"), "num", { align: "right" })], rows: r.withholding_paid }; } },
  profitability: { label: "Profitability per programme", params: ["program"], run: (ctx, p, lang) => {
    const r = R.profitability(ctx, p); return { title: str(lang, "c_rentabilidad"), columns: [col("name", entityName(lang, "programs")), col("forecast_income", str(lang, "c_ingresos_previstos"), "money", { align: "right", total: "sum" }), col("forecast_cost", str(lang, "c_coste_previsto"), "money", { align: "right", total: "sum" }), col("forecast_margin", str(lang, "c_margen_previsto"), "money", { align: "right", total: "sum" }), col("forecast_margin_pct", str(lang, "c_margen_pct"), "pct", { align: "right" }), col("invoiced", str(lang, "c_facturado"), "money", { align: "right", total: "sum" }), col("cost", str(lang, "c_coste_real"), "money", { align: "right", total: "sum" })], rows: r.programs }; } },
  ratings: { label: "Audience data of a programme", params: ["program", "season"], run: (ctx, p, lang) => {
    const r = R.ratingsSummary(ctx, { program_id: p.program, season_id: p.season });
    return { title: entityName(lang, "ratings", true), columns: [col("date", fl(lang, "ratings", "date"), "date"), col("episode", entityName(lang, "episodes")), col("audience", str(lang, "c_audiencia_miles"), "num", { align: "right" }), col("share", str(lang, "c_cuota_pct"), "pct", { align: "right" }), col("rating", str(lang, "c_rating"), "pct", { align: "right" }), col("reach", str(lang, "c_cobertura_miles"), "num", { align: "right" }), col("target", fl(lang, "ratings", "target_label"))], rows: r.series, meta: r } ; } },
  pipeline: { label: "Episodes per status (chart source)", params: ["program"], run: (ctx, p, lang) => {
    const rows = q.all(`SELECT status, COUNT(*) AS n FROM episodes ${p.program ? "WHERE program_id = ?" : ""} GROUP BY status`, ...(p.program ? [Number(p.program)] : []));
    const order = ["planned", "script", "recorded", "edited", "qc", "delivered", "aired"]; rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    return { title: str(lang, "c_pipeline"), columns: [col("name", fl(lang, "episodes", "status")), col("n", str(lang, "c_episodios"), "num", { align: "right" })], rows: rows.map((r) => ({ name: optionLabel(lang, "episodes", "status", r.status), n: r.n })) }; } },
  timesheets: { label: "Working time per person (from, to)", params: ["from", "to", "person", "program"], run: (ctx, p, lang) => {
    const r = R.timesheetReport(ctx, { from: p.from, to: p.to, person_id: p.person, program_id: p.program });
    return { title: str(lang, "c_horas"), columns: [col("name", entityName(lang, "people")), col("agreement", entityName(lang, "agreements")), col("hours", str(lang, "c_horas"), "num", { align: "right", total: "sum" }), col("overtime", str(lang, "c_extra"), "num", { align: "right", total: "sum" }), col("night", str(lang, "c_nocturnas"), "num", { align: "right", total: "sum" }), col("violations_n", str(lang, "c_incidencias"), "num", { align: "right", total: "sum" })], rows: r.people.map((x) => ({ ...x, violations_n: x.violations.length })) }; } },
  alerts: { label: "Open alerts", params: ["program"], run: (ctx, p, lang) => ({ title: str(lang, "c_alertas"), columns: [col("severity", str(lang, "c_gravedad")), col("kind", str(lang, "c_tipo")), col("date", str(lang, "c_fecha"), "date")], rows: alertsFn(ctx, { program: p.program }).map((a) => ({ severity: a.severity, kind: a.kind, date: a.date })) }) },
  rights_check: { label: "Rights coverage of an episode", params: ["episode"], run: (ctx, p, lang) => {
    const r = R.rightsCheck(ctx, { episode_id: p.episode }); return { title: str(lang, "c_derechos"), columns: [col("title", str(lang, "c_derecho")), col("kind", str(lang, "c_tipo")), col("window_end", str(lang, "c_fin_ventana"), "date"), col("state", str(lang, "c_estado"))], rows: r.rights }; } },
};

/** Names, labels and parameters of the sources (what `collado-doc sources` prints). */
export function listSources() { return Object.entries(DATASETS).map(([name, d]) => ({ name, label: d.label, params: d.params })); }
/** Runs a source by name with the caller's permissions; unknown names are a 400. */
export async function runSource(ctx, name, params, lang) {
  const d = DATASETS[name]; if (!d) throw bad(`unknown_source:${name}`);
  return d.run(ctx, params, lang);
}
