// Generic entity list: table / board / calendar views, search, sort, status chips, create, row actions, CSV export. Used everywhere a collection appears.
import { h, debounce, clear } from "./dom.js";
import { api, entityApi, qs } from "./api.js";
import { S, t, fieldLabel, optLabel, entName, fmt } from "./i18n.js";
import { btn, badge, statusBadge, statusColor, icon, confirmDialog, toast, emptyState, spinner, selectWrap, progress, dropdown } from "./ui.js";
import { openForm, remember, refLabel, labelFor } from "./forms.js";
import { monthGrid } from "./calendar.js";

export const go = (hash) => { location.hash = hash; };
export const detailHref = (entity, id) => `#/e/${entity}/${id}`;
const sch = (e) => S.schema.entities[e];
export const canWrite = (e) => !!sch(e)?.canWrite;

/** Cell content for a column. `refs` carries labels for reference fields. */
export function cell(entity, col, row) {
  const fd = sch(entity).fields[col]; const v = row[col];
  if (!fd) return col === "updated" || col === "created" ? fmt.datetime(v) : (v ?? "");
  if (v === null || v === undefined || v === "") return fd.type === "bool" ? "" : "";
  switch (fd.type) {
    case "money": return fmt.money(v);
    case "num": return col === "hours" || col === "overtime" || col === "night_hours" ? fmt.num(v, 2) : fmt.num(v, Number.isInteger(v) ? 0 : 2);
    case "int": return col.includes("duration") && col !== "duration_min" ? fmt.duration(v) : fmt.num(v);
    case "pct": return col === "progress" ? progress(v) : fmt.pct(v);
    case "date": return fmt.date(v);
    case "datetime": return fmt.datetime(v);
    case "enum": return statusBadge(entity, col, v);
    case "bool": return v ? badge(icon("ok"), "green", "nb-badge--sq") : "";
    case "ref": return refLabel(fd.to, v);
    case "tags": return (v || []).map((x) => badge(x, "white"));
    case "secret": return "••••";
    case "long": case "text": { if (entity === "compliance_checks" && col === "item" && S.d.ci?.[v]) return S.d.ci[v]; const s = String(v); if (fd.format === "color") return h("span", { class: "swatch", style: { background: s }, title: s }); return s.length > 90 ? s.slice(0, 88) + "…" : s; }
    case "json": return Array.isArray(v) ? `[${v.length}]` : "{…}";
    default: return String(v);
  }
}
const isNum = (fd) => fd && ["money", "num", "int", "pct"].includes(fd.type);

export function entityList(opts) {
  const { entity, filters = {}, create, compact = false, hideCols = [], limit = compact ? 25 : 50, onOpen, extraActions, canCreate = true, showSearch = !compact, views, emptyText, rowActions = true, onChange, hideToolbar } = opts;
  const ent = sch(entity); if (!ent) return h("div.nb-alert.nb-alert--error", `?${entity}`);
  const cols = (opts.columns || ent.list).filter((c) => !hideCols.includes(c) && (ent.fields[c] || ["updated", "created"].includes(c)));
  const state = { q: "", sort: opts.sort || ent.sort, offset: 0, rows: [], total: 0, status: "", view: opts.view || "table" };
  const statusField = ent.board?.field || (ent.fields.status ? "status" : null);
  const wrap = h("div.elist"); const body = h("div.elist__body");
  const available = views || ["table", ...(ent.board && !compact ? ["board"] : []), ...(ent.calendar && !compact ? ["calendar"] : [])];

  const fetchRows = async (more = false) => {
    const f = Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])); if (state.status) f[`f.${statusField}`] = state.status;
    const board = state.view !== "table";
    const r = await api.get(`api/e/${entity}${qs({ ...f, q: state.q, sort: state.sort, limit: board ? 500 : limit, offset: more ? state.offset : 0 })}`);
    remember(r.refs); state.rows = more ? state.rows.concat(r.rows) : r.rows; state.total = r.total; state.offset = state.rows.length;
  };
  const toolbar = () => {
    if (hideToolbar) return null;
    const search = showSearch && h("input.nb-input.elist__search", { type: "search", placeholder: t("search") + "…", "aria-label": t("search"), value: state.q, oninput: debounce((e) => { state.q = e.target.value; reload(); }, 300) });
    const chips = statusField && ent.fields[statusField]?.type === "enum" && !compact && h("div.chips", [["", t("all")], ...ent.fields[statusField].options.map((o) => [o, optLabel(entity, statusField, o)])].map(([v, l]) => h("button", { type: "button", class: ["nb-tab", "chip"], "data-chip": v, "aria-selected": String(state.status === v), onclick: () => { state.status = v; reload(); } }, l)));
    const viewBtns = available.length > 1 && h("div.nb-row", available.map((v) => btn("", { sm: true, kind: state.view === v ? undefined : "secondary", ico: { table: "list", board: "layers", calendar: "calendar" }[v], title: t(`view_${v}`), cls: "viewbtn", "data-view": v, onclick: () => { state.view = v; reload(); } })));
    const add = canCreate && ent.canWrite && !ent.noCreate && btn(t("new"), { ico: "plus", onclick: async () => { const row = await openForm(entity, { defaults: create?.defaults, lock: create?.lock, hide: create?.hide }); if (row) { onChange?.(); if (opts.openAfterCreate !== false && !compact && !create?.stay) go(detailHref(entity, row.id)); else reload(); } } });
    const exp = !compact && dropdown(t("export"), [{ label: "CSV", icon: "download", onclick: () => csvExport() }], { ico: "download" });
    return h("div.elist__bar", h("div.nb-row.between", h("div.nb-row", search, viewBtns), h("div.nb-row", extraActions, exp, add)), chips);
  };
  const csvExport = async () => { const f = Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])); const res = await api.raw("GET", `api/export/csv/${entity}${qs({ ...f, q: state.q })}`); const blob = await res.blob(); const a = h("a", { href: URL.createObjectURL(blob), download: `${entity}.csv` }); document.body.append(a); a.click(); setTimeout(() => a.remove(), 500); };

  function drawTable() {
    if (!state.rows.length) return emptyState(emptyText || t("empty_list"), canCreate && ent.canWrite && btn(t("new"), { ico: "plus", onclick: () => toolbarAdd() }));
    const th = cols.map((c) => { const fd = ent.fields[c]; const asc = state.sort === c, desc = state.sort === `-${c}`; return h("th", { class: ["sortable", isNum(fd) && "num"], "aria-sort": asc ? "ascending" : desc ? "descending" : "none", tabindex: "0", onclick: () => { state.sort = asc ? `-${c}` : c; reload(); }, onkeydown: (e) => { if (e.key === "Enter") e.target.click(); } }, fieldLabel(entity, c), (asc || desc) && icon(asc ? "up" : "down", "sort")); });
    const trs = state.rows.map((r) => h("tr", { "data-clickable": "1", tabindex: "0", onclick: (e) => { if (e.target.closest("button,a")) return; (onOpen || ((x) => go(detailHref(entity, x.id))))(r); }, onkeydown: (e) => { if (e.key === "Enter" && !e.target.closest("button,a")) e.currentTarget.click(); } },
      cols.map((c, i) => h("td", { class: isNum(ent.fields[c]) && "num" }, i === 0 ? h("strong", cell(entity, c, r)) : cell(entity, c, r))),
      rowActions && ent.canWrite && h("td.actions", btn("", { ico: "edit", sm: true, kind: "secondary", title: t("edit"), onclick: async () => { const row = (await entityApi.get(entity, r.id)).row; const saved = await openForm(entity, { row }); if (saved) { onChange?.(); reload(); } } }), " ", btn("", { ico: "trash", sm: true, kind: "danger", title: t("delete"), onclick: async () => { if (await confirmDialog(t("confirm_delete", { name: labelFor(ent, r) }), { danger: true, ok: t("delete") })) { try { await entityApi.remove(entity, r.id); toast("deleted"); onChange?.(); reload(); } catch { /* toast */ } } } }))));
    return h("div", h("div.nb-table-wrap", h("table.nb-table", h("thead", h("tr", th, rowActions && ent.canWrite && h("th", ""))), h("tbody", trs))),
      h("div.nb-row.between.elist__foot", h("span.nb-caption", `${state.rows.length} / ${state.total}`), state.rows.length < state.total && btn(t("load_more"), { kind: "secondary", sm: true, onclick: async () => { await fetchRows(true); draw(); } })));
  }
  const toolbarAdd = async () => { const row = await openForm(entity, { defaults: create?.defaults, lock: create?.lock, hide: create?.hide }); if (row) { onChange?.(); reload(); } };

  function drawBoard() {
    const fd = ent.fields[ent.board.field]; const groups = Object.fromEntries(fd.options.map((o) => [o, []])); for (const r of state.rows) (groups[r[fd.name]] ||= []).push(r);
    const move = async (r, to) => { if (r[fd.name] === to) return; try { await entityApi.update(entity, r.id, { [fd.name]: to, rev: r.rev }); onChange?.(); reload(); } catch { reload(); } };
    return h("div.board", fd.options.map((o) => h("section", { class: "board__col", "data-opt": o, ondragover: (e) => e.preventDefault(), ondrop: (e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")); const r = state.rows.find((x) => x.id === id); if (r) move(r, o); } },
      h("header", { class: `board__head c-${statusColor(o)}` }, h("b", optLabel(entity, fd.name, o)), badge(String(groups[o].length), "white")),
      groups[o].map((r) => h("article.board__card", { draggable: ent.canWrite ? "true" : "false", ondragstart: (e) => e.dataTransfer.setData("text/plain", String(r.id)) },
        h("a.board__title", { href: detailHref(entity, r.id) }, labelFor(ent, r)),
        h("div.board__meta", cols.filter((c) => c !== fd.name && !ent.title.includes(c)).slice(0, 3).map((c) => r[c] != null && r[c] !== "" ? h("span", { title: fieldLabel(entity, c) }, cell(entity, c, r)) : null)),
        ent.canWrite && h("div.nb-selectwrap.board__move", h("select.nb-select", { "aria-label": t("move_to"), onchange: (e) => move(r, e.target.value) }, fd.options.map((x) => h("option", { value: x, selected: x === r[fd.name] }, optLabel(entity, fd.name, x))))))))));
  }
  function drawCalendar() {
    const c = ent.calendar; const colorOf = (r) => (ent.fields.status ? statusColor(r.status) : "blue");
    const evs = state.rows.filter((r) => r[c.start]).map((r) => ({ date: String(r[c.start]).slice(0, 10), end: c.end && r[c.end] ? String(r[c.end]).slice(0, 10) : undefined, label: (c.label && ent.fields[c.label]?.type === "ref" ? refLabel(ent.fields[c.label].to, r[c.label]) : r[c.label || ent.title[0]]) || labelFor(ent, r), color: colorOf(r), onclick: () => go(detailHref(entity, r.id)) }));
    return monthGrid({ events: evs }).el;
  }
  async function reload() {
    body.replaceChildren(spinner());
    try { await fetchRows(); } catch { body.replaceChildren(h("div.nb-alert.nb-alert--error", t("load_failed"))); return; }
    draw();
    for (const c of wrap.querySelectorAll("[data-chip]")) c.setAttribute("aria-selected", String(c.dataset.chip === state.status));
    for (const b of wrap.querySelectorAll(".viewbtn")) b.classList.toggle("nb-btn--secondary", b.dataset.view !== state.view);
  }
  function draw() { body.replaceChildren(state.view === "board" ? drawBoard() : state.view === "calendar" ? drawCalendar() : drawTable()); }
  const bar = toolbar(); wrap.append(bar || "", body);
  wrap.reload = reload; reload();
  return wrap;
}
