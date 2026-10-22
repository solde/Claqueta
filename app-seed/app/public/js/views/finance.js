// Finance: budget editor (versions, actuals), cashflow, taxes, bank reconciliation, profitability.
import { h } from "../dom.js";
import { api, entityApi, qs } from "../api.js";
import { S, t, entName, fieldLabel, optLabel, fmt } from "../i18n.js";
import { btn, badge, statusBadge, icon, card, pageHead, emptyState, spinner, toast, modal, ch, confirmDialog, progress, dropdown } from "../ui.js";
import { entityList, go } from "../lists.js";
import { openForm, remember, refLabel } from "../forms.js";
import { registerDetail } from "../detail.js";
import { barChart, hbars, PAL } from "../charts.js";

const sch = (e) => S.schema.entities[e]; const has = (p) => S.me.perms.includes("*") || S.me.perms.includes(p);
export async function downloadXlsx(source, params, filename, extra = {}) {
  const res = await api.raw("POST", "api/docs/xlsx", { source, params, filename, ...extra }); const blob = await res.blob(); const a = h("a", { href: URL.createObjectURL(blob), download: `${filename || source}.xlsx` }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
const chapters = () => sch("budget_lines")?.fields.chapter.options || [];

// ---- budget editor -------------------------------------------------------------------------------------------------------------------------
registerDetail("budgets", async (row, refs, { reload }) => {
  const locked = row.status === "approved"; const canEdit = sch("budget_lines").canWrite && !locked; const showActuals = row.kind === "budget" && row.status !== "draft";
  const rep = await api.get(`api/reports/budget?budget=${row.id}`); const lines = (await api.get(`api/e/budget_lines?f.budget_id=${row.id}&limit=2000&sort=code,id&refs=0`)).rows; const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  const cell = {}; const wrap = h("div");
  const totalsEl = h("tbody"); const body = h("tbody");
  const input = (l, field, o = {}) => h("input.nb-input", { value: l[field] ?? "", type: o.num ? "number" : "text", step: o.step || "any", disabled: !canEdit, "aria-label": fieldLabel("budget_lines", field), onchange: async (e) => { const v = o.num ? (e.target.value === "" ? 0 : Number(e.target.value)) : e.target.value; try { const u = await entityApi.update("budget_lines", l.id, { [field]: v, rev: byId[l.id].rev }); byId[l.id] = u; if (cell[l.id]) cell[l.id].textContent = fmt.money(u.amount); refreshTotals(); } catch { reload(); } } });
  function lineRow(l) {
    const a = h("td.amt", fmt.money(l.amount)); cell[l.id] = a; const r = rep.chapters.flatMap((c) => c.lines).find((x) => x.id === l.id);
    return h("tr", h("td.txt", input(l, "code", { attrs: {} })), h("td.txt", input(l, "description")), h("td", input(l, "qty", { num: true })), h("td.txt", input(l, "unit")), h("td", input(l, "unit_cost", { num: true, step: "0.01" })), h("td", input(l, "vat_rate", { num: true })), a,
      showActuals && h("td.amt", fmt.money(r?.actual || 0)), showActuals && h("td.amt", fmt.money(r?.committed || 0)), showActuals && h("td.amt", h("span", { class: (r?.variance || 0) < 0 ? "var-neg" : "" }, fmt.money(r?.variance ?? l.amount / 1))), h("td.actions", canEdit && btn("", { ico: "trash", sm: true, kind: "danger", title: t("delete"), onclick: async () => { await entityApi.remove("budget_lines", l.id); reload(); } })));
  }
  const sub = {}; const draw = () => {
    body.replaceChildren(); const order = [...chapters()]; const present = [...new Set(lines.map((l) => l.chapter))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const ch_ of present) { const cs = lines.filter((l) => l.chapter === ch_); const tot = h("td.amt"); sub[ch_] = tot;
      body.append(h("tr.chap", h("td", { colSpan: 6 }, optLabel("budget_lines", "chapter", ch_), canEdit && h("span", " "), canEdit && btn("", { ico: "plus", sm: true, kind: "secondary", title: t("add_line"), onclick: async () => { const s = await openForm("budget_lines", { defaults: { budget_id: row.id, program_id: row.program_id, chapter: ch_ }, lock: ["budget_id"], hide: ["program_id"] }); if (s) reload(); } })), tot, showActuals && h("td", { colSpan: 3 }), h("td")), ...cs.map(lineRow)); }
    if (canEdit) body.append(h("tr", h("td", { colSpan: 11 }, btn(t("add_line"), { ico: "plus", sm: true, kind: "secondary", onclick: async () => { const s = await openForm("budget_lines", { defaults: { budget_id: row.id, program_id: row.program_id }, lock: ["budget_id"], hide: ["program_id"] }); if (s) reload(); } }))));
  };
  const refreshTotals = async () => { const r = await api.get(`api/reports/budget?budget=${row.id}`, { silent: true }).catch(() => null); if (!r) return; for (const c of r.chapters) if (sub[c.chapter]) sub[c.chapter].textContent = fmt.money(c.planned);
    totalsEl.replaceChildren(h("tr", h("td", { colSpan: 6, class: "txt" }, t("subtotal") + (r.budget.contingency_pct ? ` (+${r.budget.contingency_pct}% ${t("contingency")})` : "")), h("td.amt", fmt.money(rep.totals.planned_lines ? r.totals.planned : 0)), showActuals && h("td.amt", fmt.money(r.totals.actual)), showActuals && h("td.amt", fmt.money(r.totals.committed)), showActuals && h("td.amt", fmt.money(r.totals.variance)), h("td")), h("tr", h("td", { colSpan: 6 }, t("vat")), h("td.amt", fmt.money(r.totals.vat)), h("td", { colSpan: showActuals ? 4 : 1 })), h("tr", h("td", { colSpan: 6 }, h("b", t("total"))), h("td.amt", h("b", fmt.money(r.totals.total))), h("td", { colSpan: showActuals ? 4 : 1 }))); };
  draw(); refreshTotals();
  const actions = h("div.nb-row", { style: { margin: "0 0 12px" } },
    sch("budgets").canWrite && btn(t("new_version"), { ico: "copy", kind: "secondary", sm: true, onclick: async () => { const nb = await api.post("api/actions/budget-version", { budget_id: row.id }); toast("created"); go(`#/e/budgets/${nb.id}`); } }),
    sch("budgets").canWrite && row.status === "draft" && btn(t("submit_budget"), { sm: true, kind: "secondary", onclick: async () => { await entityApi.update("budgets", row.id, { status: "submitted", rev: row.rev }); reload(); } }),
    has("fin.approve") && ["draft", "submitted"].includes(row.status) && btn(t("approve_budget"), { sm: true, kind: "green", ico: "ok", onclick: async () => { if (await confirmDialog(t("approve_budget_confirm"))) { try { await entityApi.update("budgets", row.id, { status: "approved", rev: row.rev }); reload(); } catch { /* toast */ } } } }),
    dropdown(t("export"), [{ label: "Excel (.xlsx)", icon: "download", onclick: () => downloadXlsx("budget", { budget: row.id, actuals: showActuals ? "1" : "", lines: "1" }, `presupuesto-${row.id}`) }, { label: t("generate_doc"), icon: "doc", onclick: async () => (await import("./docs.js")).generateDialog({ program_id: row.program_id, vars: { budget: row.id }, only: ["budget", "variance"] }) }], { ico: "download" }));
  return [card([locked && h("div.nb-alert.nb-alert--info", { style: { marginBottom: "12px" } }, icon("info"), t("budget_locked")), actions, h("div.nb-table-wrap", h("table.nb-table.bgrid", h("thead", h("tr", h("th", fieldLabel("budget_lines", "code")), h("th", fieldLabel("budget_lines", "description")), h("th", fieldLabel("budget_lines", "qty")), h("th", fieldLabel("budget_lines", "unit")), h("th", fieldLabel("budget_lines", "unit_cost")), h("th", fieldLabel("budget_lines", "vat_rate")), h("th.num", t("planned")), showActuals && h("th.num", t("actual")), showActuals && h("th.num", t("committed")), showActuals && h("th.num", t("variance")), h("th")), ), body, h("tfoot", totalsEl)))], { head: ch("euro", entName("budget_lines", true)) }),
    rep.chapters.length ? card(barChart({ rows: rep.chapters.map((c) => ({ label: optLabel("budget_lines", "chapter", c.chapter).slice(0, 14), values: showActuals ? [c.planned, c.actual + c.committed] : [c.planned] })), series: showActuals ? [t("planned"), t("actual") + " + " + t("committed")] : [t("planned")], money: true }), { head: ch("chart", t("by_chapter")) }) : null];
});

// ---- purchase orders / bills / invoices actions --------------------------------------------------------------------------------------------
const statusActions = (entity, items) => async (row, refs, { reload }) => items.filter((i) => i.show(row)).length ? [h("div.nb-row", items.filter((i) => i.show(row) && (!i.perm || has(i.perm))).map((i) => btn(i.label(), { kind: i.kind, ico: i.ico, onclick: async () => { try { await entityApi.update(entity, row.id, { status: i.to, rev: row.rev }); toast("saved"); reload(); } catch { /* toast */ } } })))] : [];
registerDetail("purchase_orders", statusActions("purchase_orders", [{ show: (r) => r.status === "draft", to: "pending", label: () => t("request_approval"), ico: "stamp" }, { show: (r) => r.status === "pending", to: "approved", label: () => t("approve"), kind: "green", ico: "ok", perm: "fin.approve" }, { show: (r) => r.status === "pending", to: "rejected", label: () => t("reject"), kind: "danger", perm: "fin.approve" }, { show: (r) => r.status === "approved", to: "closed", label: () => t("close"), kind: "secondary" }]));
registerDetail("bills", statusActions("bills", [{ show: (r) => r.status === "pending", to: "approved", label: () => t("approve"), kind: "green", ico: "ok", perm: "fin.approve" }, { show: (r) => r.status === "pending", to: "rejected", label: () => t("reject"), kind: "danger", perm: "fin.approve" }, { show: (r) => r.status === "approved", to: "paid", label: () => t("mark_paid"), ico: "money" }]));
registerDetail("client_invoices", async (row, refs, { reload }) => {
  const out = []; const acts = [];
  if (row.status === "draft") acts.push(btn(t("issue_invoice"), { ico: "send", onclick: async () => { await entityApi.update("client_invoices", row.id, { status: "issued", rev: row.rev }); toast("saved"); reload(); } }));
  if (["issued", "partial"].includes(row.status)) acts.push(btn(t("register_payment"), { ico: "money", kind: "green", onclick: async () => { const s = await openForm("payments", { defaults: { invoice_id: row.id, amount: Math.max(0, row.total - row.paid_amount), date: new Date().toISOString().slice(0, 10), program_id: row.program_id }, lock: ["invoice_id"], hide: ["program_id"] }); if (s) reload(); } }));
  if (row.status !== "draft" && row.status !== "void") acts.push(btn(t("void_invoice"), { kind: "danger", sm: true, onclick: async () => { if (await confirmDialog(t("confirm"), { danger: true })) { await entityApi.update("client_invoices", row.id, { status: "void", rev: row.rev }); reload(); } } }));
  if (acts.length) out.push(h("div.nb-row", acts)); return out;
});

// ---- cashflow ---------------------------------------------------------------------------------------------------------------------------------
async function programSelect(cur, onChange) { const r = await api.get("api/e/programs?limit=200&sort=name&refs=0"); return h("div.nb-selectwrap", { style: { maxWidth: "260px" } }, h("select.nb-select", { "aria-label": entName("programs"), onchange: (e) => onChange(e.target.value) }, h("option", { value: "" }, t("all_programs")), r.rows.map((p) => h("option", { value: p.id, selected: String(p.id) === String(cur) }, p.name)))); }
export async function cashflowPage(root, m, params) {
  let program = params.get("program") || "", months = 6, forecast = false; const body = h("div");
  const opts = h("div.nb-row", { style: { marginBottom: "16px" } }, await programSelect(program, (v) => { program = v; draw(); }), h("div.nb-selectwrap", { style: { maxWidth: "160px" } }, h("select.nb-select", { onchange: (e) => { months = Number(e.target.value); draw(); }, "aria-label": t("months") }, [3, 6, 12, 18].map((n) => h("option", { value: n, selected: n === months }, `${n} ${t("months")}`)))), h("label.nb-check", h("input", { type: "checkbox", onchange: (e) => { forecast = e.target.checked; draw(); } }), t("include_forecast")), btn("Excel", { ico: "download", kind: "secondary", sm: true, onclick: () => downloadXlsx("cashflow", { program, months, forecast: forecast ? "1" : "" }, "cashflow") }));
  root.append(pageHead(t("nav_cashflow"), t("cashflow_help")), opts, body);
  async function draw() {
    body.replaceChildren(spinner()); const r = await api.get(`api/reports/cashflow${qs({ program, months, forecast: forecast ? 1 : "" })}`);
    const KIND = { invoice: "invoice", payment: "payment", plan: "plan", grant: "grants", bill: "bills", po: "purchase_orders", forecast: "budgets" };
    body.replaceChildren(h("div.stats", [["c-green", fmt.money(r.totals.in), t("cash_in")], ["c-red", fmt.money(r.totals.out), t("cash_out")], ["c-blue", fmt.money(r.buckets.at(-1)?.balance ?? 0), t("final_balance")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", v), h("span", l)))),
      card([barChart({ rows: r.buckets.map((b) => ({ label: fmt.month(b.month), values: [b.in, b.out] })), series: [t("cash_in"), t("cash_out")], money: true, colors: ["var(--nb-green)", "var(--nb-red)"] }), barChart({ rows: r.buckets.map((b) => ({ label: fmt.month(b.month), values: [b.balance] })), series: [t("balance")], type: "line", money: true, height: 200, colors: ["var(--nb-blue)"] })], { head: ch("money", t("nav_cashflow")) }),
      h("div.nb-table-wrap", { style: { marginTop: "16px" } }, h("table.nb-table", h("thead", h("tr", ["month", "cash_in", "cash_out", "net", "balance"].map((k, i) => h("th", { class: i ? "num" : "" }, t(k === "month" ? "month" : k))))), h("tbody", r.buckets.map((b) => h("tr", h("td", fmt.month(b.month)), h("td.num", fmt.money(b.in)), h("td.num", fmt.money(b.out)), h("td.num", fmt.money(b.net)), h("td.num", h("b", fmt.money(b.balance)))))))),
      h("h3", { style: { margin: "24px 0 8px" } }, t("details")), h("ul.alertlist", r.details.slice(0, 80).map((d) => h("li", badge(d.actual ? "✓" : "~", d.actual ? "green" : "yellow", "nb-badge--sq"), h("span.nb-caption", fmt.date(d.date)), KIND[d.kind] ? h("a", { href: d.kind === "payment" ? "#/e/payments/" + d.id : `#/e/${d.entity}/${d.id}` }, d.label) : h("span", d.label), h("b.nb-mono", { style: { marginLeft: "auto" } }, fmt.money(d.amount))))));
  }
  draw();
}

// ---- tax ---------------------------------------------------------------------------------------------------------------------------------------
export async function taxPage(root) {
  const year = new Date().getFullYear(); let y = String(year), qn = ""; const body = h("div");
  const ysel = h("div.nb-selectwrap", { style: { maxWidth: "140px" } }, h("select.nb-select", { "aria-label": t("year"), onchange: (e) => { y = e.target.value; draw(); } }, [year, year - 1, year - 2].map((v) => h("option", { value: v }, v))));
  const qsel = h("div.nb-selectwrap", { style: { maxWidth: "140px" } }, h("select.nb-select", { "aria-label": t("quarter"), onchange: (e) => { qn = e.target.value; draw(); } }, h("option", { value: "" }, t("full_year")), ["Q1", "Q2", "Q3", "Q4"].map((v) => h("option", { value: v }, v))));
  root.append(pageHead(t("nav_tax"), t("tax_help"), [btn("Excel IVA", { ico: "download", kind: "secondary", sm: true, onclick: () => downloadXlsx("tax", { year: y, quarter: qn }, `iva-${y}${qn}`) }), btn("Excel IRPF", { ico: "download", kind: "secondary", sm: true, onclick: () => downloadXlsx("withholdings", { year: y, quarter: qn }, `retenciones-${y}${qn}`) }), btn("Odoo (compras)", { ico: "download", kind: "secondary", sm: true, onclick: async () => { const r = await api.raw("GET", "api/export/odoo-bills"); const b = await r.blob(); const a = h("a", { href: URL.createObjectURL(b), download: "odoo-vendor-bills.csv" }); document.body.append(a); a.click(); } }), btn("Odoo (ventas)", { ico: "download", kind: "secondary", sm: true, onclick: async () => { const r = await api.raw("GET", "api/export/odoo-invoices"); const b = await r.blob(); const a = h("a", { href: URL.createObjectURL(b), download: "odoo-customer-invoices.csv" }); document.body.append(a); a.click(); } })]), h("div.nb-row", { style: { marginBottom: "16px" } }, ysel, qsel), body);
  async function draw() {
    body.replaceChildren(spinner()); const r = await api.get(`api/reports/tax${qs({ year: y, quarter: qn })}`); const T = r.totals;
    const vt = (rows, title) => card(h("div.nb-table-wrap", h("table.nb-table", h("thead", h("tr", h("th", t("vat_rate")), h("th.num", t("base")), h("th.num", t("vat")), h("th.num", t("invoices")))), h("tbody", rows.map((x) => h("tr", h("td", x.vat_rate + " %"), h("td.num", fmt.money(x.base)), h("td.num", fmt.money(x.vat)), h("td.num", x.invoices)))))), { head: title });
    body.replaceChildren(h("div.stats", [["c-green", fmt.money(T.vat_collected), t("vat_collected")], ["c-blue", fmt.money(T.vat_paid), t("vat_paid")], ["c-yellow", fmt.money(T.vat_balance), t("vat_balance")], ["c-pink", fmt.money(T.withholding_paid), t("withholding_paid")], ["c-orange", fmt.money(T.withholding_suffered), t("withholding_suffered")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", v), h("span", l)))),
      h("div.cols2", vt(r.vat_collected, t("vat_collected")), vt(r.vat_paid, t("vat_paid"))),
      card(r.withholding_paid.length ? h("div.nb-table-wrap", h("table.nb-table", h("thead", h("tr", h("th", t("payee")), h("th", "NIF"), h("th.num", t("base")), h("th.num", t("withholding")), h("th.num", t("invoices")))), h("tbody", r.withholding_paid.map((x) => h("tr", h("td", x.name), h("td.nb-mono", x.tax_id), h("td.num", fmt.money(x.base)), h("td.num", fmt.money(x.irpf)), h("td.num", x.invoices)))))) : emptyState(t("empty_list")), { head: ch("receipt", t("withholding_paid")) }), h("p.nb-help", { style: { marginTop: "12px" } }, t("tax_disclaimer")));
  }
  draw();
}

// ---- bank reconciliation -------------------------------------------------------------------------------------------------------------------------
export async function bankPage(root) {
  const list = h("div"); const file = h("input", { type: "file", accept: ".csv,.txt", hidden: true, onchange: async () => { const f = file.files[0]; if (!f) return; const csv = await f.text(); const dry = await api.post("api/actions/import-bank", { csv, dry: true }); if (await confirmDialog(t("import_bank_confirm", { n: dry.created, skip: dry.skipped }), { ok: t("import") })) { const r = await api.post("api/actions/import-bank", { csv }); toast(t("imported", { n: r.created })); draw(); } file.value = ""; } });
  root.append(pageHead(t("nav_bank"), t("bank_help"), [file, btn(t("import_csv"), { ico: "upload", onclick: () => file.click() })]), list);
  async function draw() {
    list.replaceChildren(entityList({ entity: "bank_movements", columns: ["date", "concept", "amount", "counterparty", "matched"], rowActions: false, canCreate: true, onOpen: (r) => openMovement(r) }));
  }
  async function openMovement(r) {
    if (r.matched) { const m = modal({ title: r.concept, body: h("div", h("p", `${fmt.date(r.date)} · ${fmt.money(r.amount)}`), h("p", `${t("matched_with")}: ${entName(r.matched_entity)} #${r.matched_id}`), h("a", { href: `#/e/${r.matched_entity}/${r.matched_id}`, onclick: () => m.close() }, t("open"))), actions: [btn(t("unmatch"), { kind: "danger", onclick: async () => { await api.post("api/actions/unmatch-movement", { movement_id: r.id }); m.close(); draw(); } })] }); return; }
    const s = await api.post("api/actions/suggest-matches", { movement_id: r.id });
    const m = modal({ title: `${r.concept} · ${fmt.money(r.amount)}`, wide: true, body: s.matches.length ? h("ul.alertlist", s.matches.map((x) => h("li", badge(String(x.score), x.score >= 4 ? "green" : "yellow", "nb-badge--sq"), h("span", `${entName(x.entity)} · ${x.label}`), h("b.nb-mono", fmt.money(x.amount)), btn(t("match"), { sm: true, onclick: async () => { try { await api.post("api/actions/match-movement", { movement_id: r.id, entity: x.entity, id: x.id }); toast("saved"); m.close(); draw(); } catch { /* toast */ } } })))) : emptyState(t("no_matches")) });
  }
  draw();
}

// ---- profitability --------------------------------------------------------------------------------------------------------------------------------
export async function profitPage(root) {
  const r = await api.get("api/reports/profitability");
  root.append(pageHead(t("nav_profit"), t("profit_help"), btn("Excel", { ico: "download", kind: "secondary", sm: true, onclick: () => downloadXlsx("profitability", {}, "rentabilidad") })),
    h("div.stats", [["c-green", fmt.money(r.totals.invoiced), t("invoiced")], ["c-red", fmt.money(r.totals.cost), t("actual_cost")], ["c-yellow", fmt.money(r.totals.forecast_margin), t("forecast_margin")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", v), h("span", l)))),
    card(barChart({ rows: r.programs.map((p) => ({ label: p.name.slice(0, 14), values: [p.forecast_income, p.forecast_cost] })), series: [t("forecast_income"), t("forecast_cost")], money: true }), { head: ch("chart", t("nav_profit")) }),
    h("div.nb-table-wrap", { style: { marginTop: "16px" } }, h("table.nb-table", h("thead", h("tr", h("th", entName("programs")), ["forecast_income", "forecast_cost", "forecast_margin", "margin_pct", "invoiced", "actual_cost"].map((k) => h("th.num", t(k))))), h("tbody", r.programs.map((p) => h("tr", h("td", h("a", { href: `#/p/${p.id}/money` }, p.name)), h("td.num", fmt.money(p.forecast_income)), h("td.num", fmt.money(p.forecast_cost)), h("td.num", h("span", { class: p.forecast_margin < 0 ? "var-neg" : "" }, fmt.money(p.forecast_margin))), h("td.num", p.forecast_margin_pct == null ? "" : p.forecast_margin_pct + " %"), h("td.num", fmt.money(p.invoiced)), h("td.num", fmt.money(p.cost))))))));
}
