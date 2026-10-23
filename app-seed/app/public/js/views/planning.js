// Planning: master calendar with resource conflicts, rundown (escaleta) editor, gantt.
import { h } from "../dom.js";
import { api, entityApi, qs } from "../api.js";
import { S, t, entName, fieldLabel, optLabel, fmt, parseDuration } from "../i18n.js";
import { btn, badge, statusBadge, icon, card, tabs, pageHead, emptyState, spinner, toast, modal, statusColor, ch, confirmDialog, selectWrap } from "../ui.js";
import { entityList, go } from "../lists.js";
import { openForm, remember, refLabel, labelFor } from "../forms.js";
import { monthGrid, timeline, mondayOf, addDays, todayIso } from "../calendar.js";

const sch = (e) => S.schema.entities[e]; const can = (e) => !!sch(e);
const programPicker = async (cur, onChange) => { const r = await api.get("api/e/programs?limit=200&sort=name&refs=0"); return h("div.nb-selectwrap", { style: { maxWidth: "280px" } }, h("select.nb-select", { "aria-label": entName("programs"), onchange: (e) => onChange(e.target.value || null) }, h("option", { value: "" }, t("all_programs")), r.rows.map((p) => h("option", { value: p.id, selected: String(p.id) === String(cur) }, p.name)))); };

// ---- gantt ---------------------------------------------------------------------------------------------------------------------------------
export async function ganttView(programId) {
  const g = await api.get(`api/reports/gantt?program=${programId}`);
  if (!g.tasks.length) return emptyState(t("no_milestones"));
  const days = Math.max(1, Math.round((Date.parse(g.to) - Date.parse(g.from)) / 864e5) + 2); const pxDay = Math.max(6, Math.min(28, 900 / days)); const LW = 220, RH = 34, TH = 44; const W = LW + days * pxDay + 20, H = TH + g.tasks.length * RH + 10;
  const x = (d) => LW + ((Date.parse(d) - Date.parse(g.from)) / 864e5) * pxDay; const NS = "http://www.w3.org/2000/svg";
  const el = (tag, a = {}, ...k) => { const e = document.createElementNS(NS, tag); for (const [n, v] of Object.entries(a)) e.setAttribute(n, v); for (const c of k) if (c) e.append(c instanceof Node ? c : document.createTextNode(c)); return e; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": t("nav_gantt") });
  // axis: months
  let d = g.from.slice(0, 7) + "-01"; while (d <= g.to) { const xx = x(d < g.from ? g.from : d); svg.append(el("line", { x1: xx, x2: xx, y1: 0, y2: H, style: "stroke:var(--nb-ink);opacity:.25" }), el("text", { x: xx + 4, y: 18, class: "g-axis" }, fmt.month(d.slice(0, 7)))); const nd = new Date(d + "T00:00:00Z"); nd.setUTCMonth(nd.getUTCMonth() + 1); d = nd.toISOString().slice(0, 10); }
  svg.append(el("line", { x1: LW, x2: LW, y1: 0, y2: H, style: "stroke:var(--nb-ink);stroke-width:3" }));
  const t0 = todayIso(); if (t0 >= g.from && t0 <= g.to) svg.append(el("line", { x1: x(t0), x2: x(t0), y1: TH - 6, y2: H, style: "stroke:var(--nb-red);stroke-width:3;stroke-dasharray:6 4" }));
  const pos = {}; g.tasks.forEach((tk, i) => { pos[tk.id] = { y: TH + i * RH, x0: x(tk.start), x1: x(tk.end) + pxDay }; });
  for (const tk of g.tasks) for (const dep of tk.depends_on) if (pos[dep]) { const a = pos[dep], b = pos[tk.id]; svg.append(el("path", { d: `M${a.x1},${a.y + RH / 2} H${Math.max(a.x1 + 6, b.x0 - 8)} V${b.y + RH / 2} H${b.x0}`, fill: "none", class: "dep", style: tk.violates.includes(dep) ? "stroke:var(--nb-red);stroke-width:3" : "" })); }
  g.tasks.forEach((tk, i) => { const y = TH + i * RH, p = pos[tk.id];
    const a = el("a", { href: `#/e/milestones/${tk.id}` }); a.append(el("text", { x: 8, y: y + 21 }, (tk.title.length > 30 ? tk.title.slice(0, 29) + "…" : tk.title)), tk.kind === "milestone" ? el("polygon", { points: `${p.x0},${y + 17} ${p.x0 + 12},${y + 5} ${p.x0 + 24},${y + 17} ${p.x0 + 12},${y + 29}`, class: "bar ms" }) : el("rect", { x: p.x0, y: y + 6, width: Math.max(8, p.x1 - p.x0), height: 22, class: ["bar", tk.status === "done" ? "done" : tk.critical ? "crit" : "nor"].join(" ") }));
    if (tk.kind !== "milestone" && tk.progress) a.append(el("rect", { x: p.x0, y: y + 22, width: Math.max(4, (p.x1 - p.x0) * (tk.progress / 100)), height: 6, style: "fill:var(--nb-ink)" }));
    a.append(el("title", {}, `${tk.title}\n${fmt.date(tk.start)} → ${fmt.date(tk.end)}${tk.owner ? "\n" + tk.owner : ""}`)); svg.append(a); svg.append(el("line", { x1: 0, x2: W, y1: y + RH, y2: y + RH, style: "stroke:var(--nb-ink);opacity:.15" })); });
  const viol = g.tasks.filter((x) => x.violates.length);
  return h("div.stack", viol.length ? h("div.nb-alert.nb-alert--warn", icon("warn"), t("gantt_violations", { n: viol.length })) : null, h("div.gantt", svg), h("div.legend", h("span", h("i.c-red"), t("critical_path")), h("span", h("i.c-blue"), t("normal")), h("span", h("i.c-green"), t("done_m")), h("span", h("i.c-yellow"), entName("milestones"))));
}
/** Gantt chart of a programme's milestones with dependencies and critical path. */
export async function ganttPage(root, m, params) {
  const pid = params.get("program"); root.append(pageHead(t("nav_gantt"), null, null));
  const picker = await programPicker(pid, (v) => go(v ? `#/gantt?program=${v}` : "#/gantt")); root.append(h("div", { style: { marginBottom: "16px" } }, picker));
  if (!pid) { const r = await api.get("api/e/programs?limit=1&sort=name&refs=0"); if (r.rows[0]) { go(`#/gantt?program=${r.rows[0].id}`); return; } root.append(emptyState(t("no_programs"))); return; }
  root.append(await ganttView(pid), h("div", { style: { marginTop: "24px" } }, entityList({ entity: "milestones", filters: { program_id: pid }, create: { defaults: { program_id: Number(pid) }, lock: ["program_id"] }, compact: true })));
}

// ---- master calendar --------------------------------------------------------------------------------------------------------------------
export async function masterCalendar(root, m, params) {
  let program = params.get("program") || ""; let view = params.get("view") || "month";
  const body = h("div");
  const picker = await programPicker(program, (v) => { program = v || ""; draw(); });
  const mode = h("div.nb-row", [["month", t("view_calendar")], ["resources", t("view_resources")], ["people", t("view_people")]].map(([k, l]) => btn(l, { sm: true, kind: view === k ? undefined : "secondary", onclick: () => { view = k; draw(); updMode(); } })));
  const updMode = () => { [...mode.children].forEach((b, i) => b.classList.toggle("nb-btn--secondary", ["month", "resources", "people"][i] !== view)); };
  root.append(pageHead(t("nav_calendar"), t("calendar_help"), [btn("ICS", { ico: "download", kind: "secondary", sm: true, onclick: async () => { const res = await api.raw("GET", `api/export/ics${qs({ program })}`); const blob = await res.blob(); const a = h("a", { href: URL.createObjectURL(blob), download: "collado.ics" }); document.body.append(a); a.click(); setTimeout(() => a.remove(), 500); } })]), h("div.nb-row", { style: { marginBottom: "16px" } }, picker, mode), body);
  async function draw() { body.replaceChildren(spinner()); body.replaceChildren(await (view === "month" ? monthView() : timelineView(view))); }
  async function monthView() {
    const f = program ? { "f.program_id": program } : {}; const get = (e, extra = {}) => (can(e) ? api.get(`api/e/${e}${qs({ ...f, limit: 500, refs: 0, ...extra })}`, { silent: true }).then((r) => r.rows).catch(() => []) : Promise.resolve([]));
    const [eps, bks, mss, tks, cts, bcs] = await Promise.all([get("episodes"), get("bookings"), get("milestones"), get("tasks", { "f.status": "!=done" }), get("contracts", { "f.status": "in:active|signing" }), get("broadcasts")]);
    const ev = [];
    for (const e of eps) { if (e.shoot_date) ev.push({ date: e.shoot_date, icon: "reel", label: `E${e.number}`, color: "blue", onclick: () => go(`#/e/episodes/${e.id}`) }); if (e.delivery_due) ev.push({ date: e.delivery_due, icon: "truck", label: `E${e.number}`, color: "orange", onclick: () => go(`#/e/episodes/${e.id}`) }); if (e.air_date) ev.push({ date: e.air_date, icon: "antenna", label: `E${e.number}`, color: "green", onclick: () => go(`#/e/episodes/${e.id}`) }); }
    for (const b of bks) if (b.status !== "cancelled") ev.push({ date: b.start.slice(0, 10), end: b.end.slice(0, 10), label: `${b.start.slice(11, 16)} ${b.title}`, color: b.status === "confirmed" ? "pink" : "white", onclick: () => go(`#/e/bookings/${b.id}`) });
    for (const x of mss) ev.push({ date: x.start_date, end: x.end_date || undefined, icon: "flag", label: x.title, color: "yellow", onclick: () => go(`#/e/milestones/${x.id}`) });
    for (const x of tks) if (x.due) ev.push({ date: x.due, icon: "check", label: x.title, color: "white", onclick: () => go(`#/e/tasks/${x.id}`) });
    for (const x of cts) if (x.end_date) ev.push({ date: x.end_date, icon: "contract", label: x.title, color: "red", onclick: () => go(`#/e/contracts/${x.id}`) });
    return monthGrid({ events: ev }).el;
  }
  async function timelineView(kind) {
    let from = mondayOf(todayIso()); const wrap = h("div");
    async function render() {
      wrap.replaceChildren(spinner());
      const to = addDays(from, 13); const conf = (await api.get(`api/reports/conflicts${qs({ from, to, program })}`, { silent: true }).catch(() => ({ conflicts: [] }))).conflicts;
      const conflicted = new Set(conf.flatMap((c) => [c.a, c.b].filter(Boolean).map((x) => `${x.entity}:${x.id}`)));
      let rows;
      if (kind === "resources") {
        const [res, bks] = await Promise.all([api.get("api/e/resources?limit=300&sort=kind,name&refs=0"), api.get(`api/e/bookings${qs({ limit: 1000, refs: 0, "f.end": `>=${from}`, "f.start": `<=${to}T23:59`, "f.status": "!=cancelled", ...(program ? { "f.program_id": program } : {}) })}`)]);
        rows = res.rows.map((r) => ({ id: r.id, label: `${r.name}`, sub: optLabel("resources", "kind", r.kind), kind: "resource", bars: bks.rows.filter((b) => b.resource_id === r.id).map((b) => ({ id: b.id, entity: "bookings", label: b.title, start: b.start, end: b.end, color: b.status === "confirmed" ? "pink" : "yellow", conflict: conflicted.has(`bookings:${b.id}`) })) }));
      } else {
        const [ppl, crew, av] = await Promise.all([api.get("api/e/people?limit=300&sort=name&refs=0"), api.get(`api/e/crew_assignments${qs({ limit: 1000, refs: 0, "f.end": `>=${from}`, "f.start": `<=${to}T23:59`, "f.status": "!=declined", ...(program ? { "f.program_id": program } : {}) })}`), api.get(`api/e/availability${qs({ limit: 500, refs: 0, "f.end_date": `>=${from}`, "f.start_date": `<=${to}` })}`)]);
        rows = ppl.rows.map((p) => ({ id: p.id, label: p.name, sub: p.profession, kind: "person", bars: [...crew.rows.filter((c) => c.person_id === p.id).map((c) => ({ id: c.id, entity: "crew_assignments", label: c.role, start: c.start, end: c.end, color: "blue", conflict: conflicted.has(`crew_assignments:${c.id}`) })), ...av.rows.filter((a) => a.person_id === p.id && a.kind !== "available").map((a) => ({ id: a.id, entity: "availability", label: optLabel("availability", "kind", a.kind), start: a.start_date, end: a.end_date, color: "red" }))] }));
      }
      const tl = timeline({ from, days: 14, rows, onBar: (b) => go(`#/e/${b.entity}/${b.id}`), onCell: async (r, day) => {
        if (r.kind === "resource" && sch("bookings").canWrite) { const row = await openForm("bookings", { defaults: { resource_id: r.id, start: `${day}T09:00`, end: `${day}T18:00`, program_id: program ? Number(program) : undefined, status: "tentative" } }); if (row) render(); }
        else if (r.kind === "person" && sch("crew_assignments").canWrite) { const row = await openForm("crew_assignments", { defaults: { person_id: r.id, start: `${day}T08:00`, end: `${day}T16:00`, program_id: program ? Number(program) : undefined, status: "proposed" } }); if (row) render(); } } });
      tl.querySelector(".tl").style.setProperty("--cols", 14);
      for (const c of tl.querySelectorAll(".tl__cells")) c.style.setProperty("--cols", 14);
      wrap.replaceChildren(h("div.nb-row.between", { style: { marginBottom: "12px" } }, h("div.nb-row", btn("", { ico: "back", sm: true, kind: "secondary", onclick: () => { from = addDays(from, -7); render(); } }), btn(t("today"), { sm: true, kind: "secondary", onclick: () => { from = mondayOf(todayIso()); render(); } }), btn("", { ico: "next", sm: true, kind: "secondary", onclick: () => { from = addDays(from, 7); render(); } }), h("span.nb-caption", `${fmt.date(from)} → ${fmt.date(to)}`)), conf.length ? badge(`${conf.length} ${t("conflicts")}`, "red") : badge(t("no_conflicts"), "green")),
        conf.length ? h("ul.alertlist", { style: { marginBottom: "12px" } }, conf.slice(0, 6).map((c) => h("li", badge(c.severity === "high" ? "!!" : "!", c.severity === "high" ? "red" : "orange", "nb-badge--sq"), h("span", `${t("conflict." + c.kind)} · ${c.resource || c.person || ""} · ${c.a.label}${c.b ? " / " + c.b.label : ""}`)))) : null, tl);
    }
    await render(); return wrap;
  }
  draw();
}

// ---- rundown ---------------------------------------------------------------------------------------------------------------------------------
export async function rundownIndex(root) {
  root.append(pageHead(t("nav_rundowns"), t("rundowns_help")), entityList({ entity: "episodes", columns: ["program_id", "number", "title", "status", "air_date", "duration_target"], onOpen: (r) => go(`#/rundown/${r.id}`), canCreate: false, rowActions: false }));
}
/** Rundown editor of an episode: blocks, durations and running time against the target. */
export async function rundownEditor(root, m) {
  const epId = Number(m[1]); const [epr, items] = await Promise.all([entityApi.get("episodes", epId), api.get(`api/e/rundown_items?f.episode_id=${epId}&sort=position&limit=500&refs=0`)]);
  const ep = epr.row; remember(epr.refs); const canEdit = sch("rundown_items").canWrite; let rows = items.rows;
  const list = h("div.rd"); const sum = h("div.rd__sum"); const timeEls = {};
  const kinds = sch("rundown_items").fields.kind.options;
  const refreshTiming = async () => { const r = await api.get(`api/reports/rundown?episode=${epId}`, { silent: true }).catch(() => null); if (!r) return; for (const it of r.items) { const c = timeEls[it.id]; if (c) { c.time.textContent = it.start; c.note.textContent = it.note ? (it.note.startsWith("gap") ? `+${it.note.split(":")[1]}s` : `−${it.note.split(":")[1]}s`) : ""; } }
    const diff = r.diff_sec; sum.replaceChildren(h("span", `${t("total")}: ${fmt.duration(r.total_sec)}`), r.target_sec ? h("span", `${t("target")}: ${fmt.duration(r.target_sec)}`) : null, r.target_sec ? badge(`${diff > 0 ? "+" : ""}${fmt.duration(Math.abs(diff))} ${diff > 0 ? t("over") : diff < 0 ? t("under") : "OK"}`, diff === 0 ? "green" : Math.abs(diff) > 60 ? "red" : "orange") : null, r.blocks.length > 1 ? h("span.nb-caption", r.blocks.map((b) => `${b.block || "—"}: ${fmt.duration(b.sec)}`).join(" · ")) : null); };
  const patch = async (it, field, val) => { try { const u = await entityApi.update("rundown_items", it.id, { [field]: val, rev: it.rev }, field === "status" ? "rundown" : undefined); Object.assign(it, u); refreshTiming(); } catch { draw(); } };
  const edit = async (it) => { const row = (await entityApi.get("rundown_items", it.id)).row; const s = await openForm("rundown_items", { row, hide: ["episode_id", "program_id", "position"] }); if (s) load(); };
  let dragId = null;
  function draw() {
    list.replaceChildren(h("div.rd__row.head", h("span"), h("span", t("time")), h("span", fieldLabel("rundown_items", "kind")), h("span", fieldLabel("rundown_items", "title")), h("span", fieldLabel("rundown_items", "duration_sec")), h("span", fieldLabel("rundown_items", "block")), h("span", fieldLabel("rundown_items", "responsible")), h("span")));
    let lastBlock = null;
    for (const it of rows) {
      const time = h("span.rd__time", "—"), note = h("span.rd__note"); timeEls[it.id] = { time, note };
      const mk = (field, o = {}) => { const i = h("input.nb-input", { value: it[field] ?? "", disabled: !canEdit, "aria-label": fieldLabel("rundown_items", field), onchange: (e) => patch(it, field, o.parse ? o.parse(e.target.value) : e.target.value), ...o.attrs }); return i; };
      const dur = h("input.nb-input", { value: fmt.duration(it.duration_sec), disabled: !canEdit, "aria-label": fieldLabel("rundown_items", "duration_sec"), onchange: (e) => { const s = parseDuration(e.target.value); e.target.value = fmt.duration(s); patch(it, "duration_sec", s); } });
      const kind = h("div.nb-selectwrap", h("select.nb-select", { disabled: !canEdit, "aria-label": fieldLabel("rundown_items", "kind"), onchange: (e) => patch(it, "kind", e.target.value) }, kinds.map((k) => h("option", { value: k, selected: k === it.kind }, optLabel("rundown_items", "kind", k)))));
      const row = h("div", { class: ["rd__row"], draggable: canEdit ? "true" : "false", "data-id": it.id, ondragstart: (e) => { dragId = it.id; e.dataTransfer.setData("text/plain", String(it.id)); row.classList.add("dragging"); }, ondragend: () => row.classList.remove("dragging"), ondragover: (e) => { e.preventDefault(); row.classList.add("over"); }, ondragleave: () => row.classList.remove("over"), ondrop: async (e) => { e.preventDefault(); row.classList.remove("over"); const from = rows.findIndex((x) => x.id === dragId), to = rows.findIndex((x) => x.id === it.id); if (from < 0 || from === to) return; const [mv] = rows.splice(from, 1); rows.splice(to, 0, mv); await api.post("api/actions/reorder-rundown", { episode_id: epId, ids: rows.map((x) => x.id) }); draw(); refreshTiming(); } },
        it.block !== lastBlock && h("div.rd__block", it.block || "—"), h("span.rd__grip", { title: t("drag") }, canEdit ? "⠿" : ""), h("div", time, note), kind, mk("title"), dur, mk("block"), mk("responsible"), h("div.nb-row", { style: { flexWrap: "nowrap", gap: "4px" } }, btn("", { ico: "edit", sm: true, kind: "secondary", title: t("edit"), onclick: () => edit(it) }), canEdit && btn("", { ico: "trash", sm: true, kind: "danger", title: t("delete"), onclick: async () => { if (await confirmDialog(t("confirm_delete", { name: it.title }), { danger: true })) { await entityApi.remove("rundown_items", it.id); load(); } } })));
      lastBlock = it.block; list.append(row);
    }
    if (!rows.length) list.append(h("div.rd__row", emptyState(t("empty_rundown"))));
  }
  async function load() { rows = (await api.get(`api/e/rundown_items?f.episode_id=${epId}&sort=position&limit=500&refs=0`)).rows; draw(); refreshTiming(); }
  const add = canEdit && btn(t("add_block"), { ico: "plus", onclick: async () => { const last = rows[rows.length - 1]; const s = await openForm("rundown_items", { defaults: { episode_id: epId, program_id: ep.program_id, block: last?.block || "", kind: "studio", duration_sec: 60 }, hide: ["episode_id", "program_id", "position"] }); if (s) load(); } });
  const copy = canEdit && btn(t("copy_from"), { ico: "copy", kind: "secondary", onclick: async () => { const sib = (await api.get(`api/e/episodes?f.program_id=${ep.program_id}&limit=100&sort=number&refs=0`)).rows.filter((x) => x.id !== epId); const sel = h("select.nb-select", sib.map((x) => h("option", { value: x.id }, `E${x.number} ${x.title || ""}`))); const mm = modal({ title: t("copy_from"), body: h("div.nb-selectwrap", sel), actions: [btn(t("cancel"), { kind: "secondary", onclick: () => mm.close() }), btn(t("accept"), { onclick: async () => { await api.post("api/actions/copy-rundown", { from_episode_id: Number(sel.value), to_episode_id: epId }); mm.close(); load(); } })] }); } });
  const docs = can("documents") && btn(t("generate_doc"), { ico: "doc", kind: "secondary", onclick: async () => (await import("./docs.js")).generateDialog({ program_id: ep.program_id, episode_id: epId, only: ["rundown", "callsheet", "broadcast-sheet", "cue-sheet"] }) });
  root.append(h("header.pagehead", h("div", h("div.nb-caption", h("a", { href: `#/p/${ep.program_id}/episodes` }, refLabel("programs", ep.program_id)), " · ", h("a", { href: `#/e/episodes/${epId}` }, `E${ep.number}`)), h("h1.nb-h1", `${t("nav_rundowns")} · E${ep.number} ${ep.title || ""}`), statusBadge("episodes", "status", ep.status)), h("div.nb-row", add, copy, docs)), list, sum);
  draw(); refreshTiming();
}
