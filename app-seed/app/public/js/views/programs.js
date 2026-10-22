// Programme list (cards) and the programme workspace: one place with every module filtered to the programme.
import { h } from "../dom.js";
import { api, entityApi, qs } from "../api.js";
import { S, t, entName, fieldLabel, optLabel, fmt, errText } from "../i18n.js";
import { btn, badge, statusBadge, icon, card, tabs, pageHead, emptyState, spinner, toast, modal, statusColor, ch, kv, progress } from "../ui.js";
import { entityList, go } from "../lists.js";
import { openForm, remember, refLabel, formFields, saveForm } from "../forms.js";
import { alertItem } from "./dashboard.js";
import { barChart, hbars } from "../charts.js";

const sch = (e) => S.schema.entities[e]; const has = (p) => S.me.perms.includes("*") || S.me.perms.includes(p); const can = (e) => !!sch(e);

export async function programList(root, m, params) {
  const rows = await api.get("api/e/programs?limit=200&sort=name"); remember(rows.refs);
  const stats = await api.get("api/e/episodes?limit=2000&refs=0").catch(() => ({ rows: [] }));
  const eps = {}; for (const e of stats.rows) (eps[e.program_id] ||= []).push(e);
  const create = async () => {
    const tpls = await api.get("api/e/workflow_templates?limit=50&refs=0").catch(() => ({ rows: [] }));
    const form = formFields("programs", { defaults: { status: "development", language: S.lang }, hide: ["template_id", "contract_value", "currency", "notes"] });
    const tplSel = h("select.nb-select", { "aria-label": t("template") }, h("option", { value: "" }, t("no_template")), tpls.rows.map((x) => h("option", { value: x.id }, x.name)));
    const body = h("div", form.el, h("label.nb-label", t("apply_template")), h("div.nb-selectwrap", tplSel), h("div.nb-help", t("apply_template_help")));
    const m = modal({ title: t("new_program"), wide: true, body, actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }), btn(t("create"), { ico: "plus", onclick: async () => { try { const pr = await saveForm("programs", form, null, tplSel.value ? { template_id: Number(tplSel.value) } : {}); if (tplSel.value) await api.post("api/actions/apply-template", { program_id: pr.id }); toast("created"); m.close(); go(`#/p/${pr.id}`); } catch { /* inline */ } } })] });
  };
  root.append(pageHead(entName("programs", true), null, sch("programs").canWrite && btn(t("new_program"), { ico: "plus", onclick: create })));
  if (!rows.rows.length) { root.append(emptyState(t("no_programs"), sch("programs").canWrite && btn(t("new_program"), { ico: "plus", onclick: create }))); }
  else root.append(h("div.nb-grid", rows.rows.map((p) => { const es = eps[p.id] || []; const done = es.filter((e) => ["delivered", "aired"].includes(e.status)).length; const next = es.filter((e) => e.air_date && e.status !== "aired").sort((a, b) => a.air_date.localeCompare(b.air_date))[0];
    return h("a.nb-card.nb-card--interactive.pcard", { href: `#/p/${p.id}`, style: { textDecoration: "none", borderTopWidth: "12px", borderTopColor: p.color || "var(--nb-ink)" } }, h("div.nb-row.between", h("h3", p.name), statusBadge("programs", "status", p.status)), h("div.nb-row", badge(optLabel("programs", "kind", p.kind), "white"), p.channel_id && badge(refLabel("partners", p.channel_id), "blue")), p.logline && h("p.nb-help", p.logline.slice(0, 120)), es.length ? [progress(Math.round((done / es.length) * 100)), h("span.nb-caption", `${done}/${es.length} ${entName("episodes", true)}`)] : null, next && h("span.nb-caption", `${t("next_air")}: ${fmt.date(next.air_date)} · E${next.number}`)); })));
  if (params.get("new")) create();
}

// ---- workspace ---------------------------------------------------------------------------------------------------------------------
const section = (title, entity, progId, o = {}) => ({ title, entity, o });
function listFor(entity, progId, o = {}) { return entityList({ entity, filters: { [sch(entity).program === "id" ? "id" : (sch(entity).program || "program_id")]: progId }, create: { defaults: { program_id: progId }, lock: ["program_id"], stay: true }, hideCols: ["program_id"], ...o }); }
function subTabs(root, items, progId, initial) {
  const avail = items.filter((i) => can(i.entity)); if (!avail.length) return h("div"); let cur = initial && avail.find((i) => i.entity === initial)?.entity || avail[0].entity; const body = h("div");
  const bar = h("div.tabs"); const draw = () => { bar.replaceChildren(...avail.map((i) => h("button.nb-tab", { type: "button", "aria-selected": String(i.entity === cur), onclick: () => { cur = i.entity; draw(); } }, icon(sch(i.entity).icon), entName(i.entity, true)))); body.replaceChildren(i_content(avail.find((i) => i.entity === cur))); };
  const i_content = (i) => (i.custom ? i.custom() : listFor(i.entity, progId, i.opts));
  draw(); return h("div", bar, body);
}

export async function workspace(root, m, params) {
  const id = Number(m[1]); let tab = m[2] || "overview";
  let data; try { data = await entityApi.get("programs", id); } catch { root.append(emptyState(t("not_found"))); return; }
  remember(data.refs); const p = data.row;
  const TABS = [
    { id: "overview", label: t("tab_overview"), icon: "home" },
    can("episodes") && { id: "episodes", label: entName("episodes", true), icon: "film" },
    can("milestones") && { id: "plan", label: t("tab_plan"), icon: "flag" },
    can("tasks") && { id: "tasks", label: entName("tasks", true), icon: "check" },
    can("budgets") && { id: "money", label: t("tab_money"), icon: "euro" },
    can("contracts") && { id: "legal", label: t("tab_legal"), icon: "contract" },
    can("assets") && { id: "quality", label: t("tab_quality"), icon: "reel" },
    can("broadcasts") && { id: "broadcast", label: t("tab_broadcast"), icon: "antenna" },
    can("documents") && { id: "docs", label: entName("documents", true), icon: "doc" },
    { id: "team", label: t("tab_team"), icon: "users" },
    { id: "edit", label: t("tab_edit"), icon: "edit" },
  ].filter(Boolean);
  const head = h("header.pagehead", h("div", h("div.nb-caption", h("a", { href: "#/programs" }, entName("programs", true))), h("h1.nb-h1", p.name), h("div.nb-row", statusBadge("programs", "status", p.status), badge(optLabel("programs", "kind", p.kind), "white"), p.channel_id && badge(refLabel("partners", p.channel_id), "blue"), p.code && badge(p.code, "white"))),
    h("div.nb-row", p.folder && window.parent !== window && window.parent.colladoDesktop && btn(t("open_folder"), { kind: "secondary", onclick: () => window.parent.postMessage({ type: "collado:open-folder", id, name: p.name, folder: p.folder }, location.origin) }),
      can("documents") && btn(t("generate_doc"), { ico: "doc", kind: "secondary", onclick: async () => (await import("./docs.js")).generateDialog({ program_id: id }) })));
  const body = h("div"); const bar = tabs(TABS, tab, (x) => { tab = x; history.replaceState(null, "", `#/p/${id}/${x}`); draw(); });
  async function draw() { for (const b of bar.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab)); body.replaceChildren(spinner()); const fn = BUILDERS[tab] || BUILDERS.overview; body.replaceChildren(await fn(id, p, m[3])); }
  root.append(head, bar, body); draw();
}

const BUILDERS = {
  async overview(id, p) {
    const [d, act, gantt] = await Promise.all([api.get(`api/dashboard?program=${id}`), api.get(`api/activity?program=${id}`, { silent: true }).catch(() => ({ activity: [] })), can("milestones") ? api.get(`api/reports/gantt?program=${id}`, { silent: true }).catch(() => null) : null]);
    const order = ["planned", "script", "recorded", "edited", "qc", "delivered", "aired"]; const pipe = d.pipeline.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)); const total = pipe.reduce((a, b) => a + b.n, 0);
    let budget = null; if (has("fin.view") && can("budgets")) { const b = (await api.get(`api/e/budgets?f.program_id=${id}&f.kind=budget&sort=-version&limit=5`, { silent: true }).catch(() => ({ rows: [] }))).rows.find((x) => x.status === "approved") || null; if (b) budget = await api.get(`api/reports/budget?budget=${b.id}`, { silent: true }).catch(() => null); }
    const nextMs = gantt?.tasks.filter((x) => x.status !== "done").slice(0, 4) || [];
    const folderCard = S.schema?.entities?.programs?.fields?.folder ? card(h("div.nb-stack", h("div.nb-caption", fieldLabel("programs", "folder")), h("div.nb-mono", { style: "word-break:break-all" }, p.folder || "—"), h("div.nb-row",
      p.folder && window.parent !== window && window.parent.colladoDesktop && btn(t("open_folder"), { kind: "secondary", sm: true, onclick: () => window.parent.postMessage({ type: "collado:open-folder", id, name: p.name, folder: p.folder }, location.origin) }),
      btn(t("change_folder"), { kind: "secondary", sm: true, onclick: async () => {   // pick a new folder (native dialog when available, otherwise type the path) and save it on the programme; existing files are not moved
        const bridge = window.parent !== window ? window.parent.colladoDesktop : null; let nf = bridge?.pickFolder ? await bridge.pickFolder(p.folder || "") : prompt(t("folder_hint"), p.folder || ""); nf = String(nf || "").trim(); if (!nf || nf === p.folder) return;
        try { const r = await entityApi.update("programs", id, { folder: nf, rev: p.rev }); toast(t("folder_changed")); p.folder = r.folder; p.rev = r.rev; location.reload(); } catch (e) { toast(errText(e)); } } })),
      h("div.nb-help", t("folder_move_note")))) : null;
    return h("div.cols2",
      h("div.stack",
        folderCard,
        card(kv([[fieldLabel("programs", "logline"), p.logline], [fieldLabel("programs", "genre"), p.genre], [fieldLabel("programs", "slot_desc"), p.slot_desc], [fieldLabel("programs", "start_date"), fmt.date(p.start_date)], [fieldLabel("programs", "end_date"), fmt.date(p.end_date)], [fieldLabel("programs", "producer"), p.producer], [fieldLabel("programs", "executive"), p.executive], p.contract_value != null ? [fieldLabel("programs", "contract_value"), fmt.money(p.contract_value, p.currency)] : null]), { head: ch("tv", t("tab_overview")) }),
        card(total ? [h("div.pipeline", pipe.map((x) => h("i", { class: `c-${statusColor(x.status)}`, style: { flex: x.n } }, x.n))), h("div.legend", pipe.map((x) => h("span", h("i", { class: `c-${statusColor(x.status)}` }), `${optLabel("episodes", "status", x.status)} · ${x.n}`)))] : emptyState(t("empty_list")), { head: ch("film", t("pipeline")) }),
        budget && card([h("div.nb-row.between", h("b", `${budget.budget.name} v${budget.budget.version}`), h("span.nb-mono", `${fmt.money(budget.totals.actual + budget.totals.committed)} / ${fmt.money(budget.totals.planned_lines)}`)), progress(budget.totals.pct || 0, { warn: 90 }), hbars({ items: budget.chapters.map((c) => ({ label: optLabel("budget_lines", "chapter", c.chapter), value: c.actual + c.committed, color: "var(--nb-green)" })), money: true })], { head: ch("euro", t("tab_money")) })),
      h("div.stack",
        card(d.alerts.length ? h("ul.alertlist", d.alerts.slice(0, 8).map((a) => alertItem(a))) : emptyState(t("no_alerts")), { head: ch("alert", t("nav_alerts")) }),
        nextMs.length ? card(h("ul.alertlist", nextMs.map((x) => h("li", statusBadge("milestones", "status", x.status), h("a", { href: `#/e/milestones/${x.id}` }, x.title), h("span.nb-caption", `${fmt.dateShort(x.start)} → ${fmt.dateShort(x.end)}`), x.critical && badge("CP", "red", "nb-badge--sq")))), { head: ch("flag", entName("milestones", true)) }) : null,
        card(act.activity.length ? h("ul.alertlist", act.activity.slice(0, 12).map((a) => h("li", h("span.nb-caption", fmt.datetime(a.ts)), h("span", `${a.user} · ${a.action} · ${entName(a.entity)} `), a.label && h("a", { href: `#/e/${a.entity}/${a.row_id}` }, a.label)))) : emptyState(t("empty_list")), { head: ch("history", t("activity")) })));
  },
  episodes: async (id) => h("div", listFor("episodes", id, { sort: "season_id,number" }), can("seasons") && h("div", { style: { marginTop: "24px" } }, h("h3", entName("seasons", true)), listFor("seasons", id, { compact: true }))),
  async plan(id) { const { ganttView } = await import("./planning.js"); return h("div.stack", await ganttView(id), listFor("milestones", id, { compact: true })); },
  tasks: async (id) => listFor("tasks", id, { view: "board" }),
  async money(id) {
    return h("div.stack", subTabs(null, [{ entity: "budgets" }, { entity: "bills" }, { entity: "purchase_orders" }, { entity: "client_invoices" }, { entity: "billing_plan" }, { entity: "grants" }, { entity: "sponsorships" }, { entity: "payments", opts: {} }], id), has("fin.view") && can("budgets") ? card(await varianceBlock(id), { head: ch("chart", t("variance_by_episode")) }) : null);
  },
  legal: async (id) => subTabs(null, [{ entity: "contracts" }, { entity: "rights" }, { entity: "cue_sheets" }, { entity: "consents" }], id),
  quality: async (id) => subTabs(null, [{ entity: "assets" }, { entity: "qc_reports" }, { entity: "qc_issues", opts: { view: "board" } }, { entity: "deliveries" }, { entity: "compliance_checks" }, { entity: "editorial_lines" }], id),
  async broadcast(id) {
    const { ratingsBlock } = await import("./broadcast.js");
    return h("div.stack", await ratingsBlock(id), subTabs(null, [{ entity: "broadcasts" }, { entity: "ratings" }, { entity: "targets" }, { entity: "competitors" }, { entity: "ad_spots" }, { entity: "sponsorships" }], id));
  },
  docs: async (id) => listFor("documents", id, { columns: ["title", "type", "status", "language", "updated"] }),
  team: async (id) => subTabs(null, [{ entity: "crew_assignments" }, { entity: "members" }, { entity: "risks" }, { entity: "approvals" }, { entity: "jobs" }], id),
  async edit(id, p) {
    const form = formFields("programs", { values: p }); const save = btn(t("save"), { ico: "save", onclick: async () => { try { await saveForm("programs", form, p); toast("saved"); location.reload(); } catch { /* inline */ } } });
    const del = sch("programs").canWrite && btn(t("delete"), { kind: "danger", ico: "trash", onclick: async () => { const { confirmDialog } = await import("../ui.js"); if (await confirmDialog(t("confirm_delete", { name: p.name }), { danger: true })) { try { await entityApi.remove("programs", id); toast("deleted"); go("#/programs"); } catch { /* toast */ } } } });
    return h("div.stack", card(form.el), sch("programs").canWrite && h("div.nb-row", save, del));
  },
};
async function varianceBlock(id) {
  const seasons = await api.get(`api/e/seasons?f.program_id=${id}&limit=50&refs=0`, { silent: true }).catch(() => ({ rows: [] }));
  const r = await api.get(`api/reports/episode-variance?program=${id}`, { silent: true }).catch(() => null);
  if (!r || !r.episodes.length) return emptyState(t("empty_list"));
  return h("div", barChart({ rows: r.episodes.map((e) => ({ label: `E${e.number}`, values: [e.planned, e.actual] })), series: [t("planned"), t("actual")], money: true }), h("div.nb-table-wrap", h("table.nb-table", h("thead", h("tr", h("th", entName("episodes")), h("th.num", t("planned")), h("th.num", t("actual")), h("th.num", t("variance")), h("th.num", "%"))), h("tbody", r.episodes.map((e) => h("tr", h("td", `E${e.number} ${e.title || ""}`), h("td.num", fmt.money(e.planned)), h("td.num", fmt.money(e.actual)), h("td.num", h("span", { class: e.variance < 0 ? "var-neg" : "" }, fmt.money(e.variance))), h("td.num", e.pct == null ? "" : e.pct + "%")))))));
}
