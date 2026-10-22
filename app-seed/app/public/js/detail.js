// Generic record page: editable form + comments, files, approvals, history, and automatic "related records" for every entity that points here.
import { h } from "./dom.js";
import { api, entityApi, qs } from "./api.js";
import { S, t, entName, fieldLabel, optLabel, fmt, errText } from "./i18n.js";
import { btn, badge, statusBadge, icon, card, tabs, toast, confirmDialog, modal, emptyState, spinner, pageHead, selectWrap } from "./ui.js";
import { formFields, saveForm, remember, refLabel, labelFor, openForm } from "./forms.js";
import { entityList, go, detailHref } from "./lists.js";
import { md } from "./md.js";

const sch = (e) => S.schema.entities[e];
export const EXTRAS = {};
const WIDE = new Set(["budgets"]);   // wide editors: comments/history panel collapsed by default
const TOP = new Set(["budgets", "episodes", "deliveries", "qc_reports", "cue_sheets", "jobs", "purchase_orders", "bills", "client_invoices"]);   // specialised sections shown above the form                       // entity -> async (row, refs, ctx) => Node[]  (specialised sections, registered by views/*)
export const registerDetail = (entity, fn) => { EXTRAS[entity] = fn; };

export async function renderDetail(entity, id, root) {
  root.replaceChildren(spinner());
  let data; try { data = await entityApi.get(entity, id); } catch (e) { root.replaceChildren(emptyState(e.status === 404 ? t("not_found") : t("load_failed"), btn(t("back"), { ico: "back", onclick: () => history.back() }))); return; }
  const { row, refs } = data; remember(refs); const ent = sch(entity);
  if (entity === "programs" && !root.dataset.noWorkspace) { go(`#/p/${id}`); return; }
  const label = labelFor(ent, row); const form = formFields(entity, { values: row, defaults: {} });
  const progId = ent.program === "id" ? row.id : ent.program ? row[ent.program] : null;
  let dirty = false; form.el.addEventListener("input", () => { dirty = true; save.disabled = false; });
  const save = btn(t("save"), { ico: "save", disabled: true, onclick: async () => { try { const saved = await saveForm(entity, form, row); toast("saved"); renderDetail(entity, id, root); } catch { /* shown inline */ } } });
  const del = ent.canWrite && btn("", { ico: "trash", kind: "danger", title: t("delete"), onclick: async () => { if (await confirmDialog(t("confirm_delete", { name: label }), { danger: true, ok: t("delete") })) { try { await entityApi.remove(entity, id); toast("deleted"); history.back(); } catch { /* toast */ } } } });
  const stField = ent.fields.status ? "status" : ent.board?.field;
  const head = h("header.pagehead", h("div", h("div.nb-caption", h("a", { href: "#/e/" + entity }, entName(entity, true)), progId && entity !== "programs" ? h("span", " · ", h("a", { href: `#/p/${progId}` }, refLabel("programs", progId))) : null), h("h1.nb-h1", label), stField && statusBadge(entity, stField, row[stField])),
    h("div.nb-row", btn(t("back"), { ico: "back", kind: "secondary", onclick: () => history.back() }), ent.canWrite && save, del));
  const side = h("div.detail__side");
  const panelTabs = [{ id: "comments", label: t("comments"), icon: "chat" }, { id: "files", label: t("files"), icon: "link" }, { id: "approvals", label: t("approvals"), icon: "stamp" }, { id: "history", label: t("history"), icon: "history" }];
  let active = "comments"; const panel = h("div.detail__panel");
  const showPanel = async () => { panel.replaceChildren(spinner()); const fn = { comments, files, approvals, history: historyPanel }[active]; panel.replaceChildren(await fn(entity, row, progId, showPanel)); for (const b of side.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === active)); };
  const bar = tabs(panelTabs, active, (id) => { active = id; showPanel(); });
  side.append(bar, panel);
  const related = relatedSections(entity, row);
  const extras = EXTRAS[entity] ? await EXTRAS[entity](row, refs, { reload: () => renderDetail(entity, id, root), progId }) : [];
  const top = TOP.has(entity); const wide = WIDE.has(entity); const layout = h("div", { class: ["detail", wide && "detail--wide"] }, h("div.detail__main", top ? extras : null, card(form.el), top ? null : extras, related), side);
  if (wide) { side.hidden = true; head.querySelector(".nb-row").prepend(btn(t("comments"), { ico: "chat", kind: "secondary", onclick: () => { side.hidden = !side.hidden; layout.classList.toggle("detail--wide", side.hidden); } })); }
  root.replaceChildren(head, layout);
  showPanel();
  window.onbeforeunload = null;
}

function relatedSections(entity, row) {
  const out = [];
  for (const e2 of Object.values(S.schema.entities)) {
    if (e2.hidden || ["comments", "approvals", "notifications", "exports"].includes(e2.name)) continue;
    for (const fd of Object.values(e2.fields)) {
      if (fd.type !== "ref" || fd.to !== entity) continue;
      const det = h("details.related", { ontoggle: (ev) => { if (ev.target.open && !det.dataset.loaded) { det.dataset.loaded = "1"; det.append(entityList({ entity: e2.name, filters: { [fd.name]: row.id }, compact: true, hideCols: [fd.name], create: { defaults: { [fd.name]: row.id, ...(e2.program && e2.program !== "id" && fd.name !== e2.program ? { [e2.program]: S.schema.entities[entity].program === "id" ? row.id : row[S.schema.entities[entity].program] } : {}) }, lock: [fd.name], stay: true } })); } } },
        h("summary", icon(e2.icon), " ", entName(e2.name, true), fd.name !== "program_id" && fd.name !== "episode_id" ? h("span.nb-caption", ` · ${fieldLabel(e2.name, fd.name)}`) : null));
      out.push(det);
    }
  }
  return out.length ? h("div.related", h("h3", t("related")), out) : null;
}

// ---- panels ---------------------------------------------------------------------------------------------------------------------------
async function comments(entity, row, progId, refresh) {
  const r = await api.get(`api/e/${entity}/${row.id}/comments`, { silent: true }).catch(() => ({ rows: [] }));
  const ta = h("textarea.nb-textarea", { rows: 3, placeholder: t("comment_placeholder"), "aria-label": t("comments") });
  const post = btn(t("send"), { ico: "send", sm: true, onclick: async () => { if (!ta.value.trim()) return; try { await entityApi.create("comments", { entity, row_id: row.id, program_id: progId, body: ta.value.trim() }); refresh(); } catch { /* toast */ } } });
  return h("div", (r.rows || []).length ? r.rows.map((c) => h("article.comment", h("header", h("b", c.created_by), h("span.nb-caption", fmt.datetime(c.created)), c.created_by === S.me.user && btn("", { ico: "trash", sm: true, kind: "ghost", title: t("delete"), onclick: async () => { await entityApi.remove("comments", c.id); refresh(); } })), h("div.md", { html: md(c.body) }))) : h("p.nb-help", t("no_comments")), h("div.nb-stack", ta, h("div.nb-row.end", post)));
}
async function files(entity, row, progId, refresh) {
  const r = await api.get(`api/e/${entity}/${row.id}/files`, { silent: true }).catch(() => ({ files: [] }));
  const input = h("input", { type: "file", hidden: true, onchange: async () => { const f = input.files[0]; if (!f) return; try { await api.post(`api/files${qs({ entity, id: row.id, name: f.name })}`, f, { silent: false }); toast("uploaded"); refresh(); } catch { /* toast */ } } });
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  return h("div", (r.files || []).length ? h("ul.filelist", r.files.map((f) => h("li", f.kind === "link" ? h("a", { href: f.url, target: "_blank", rel: "noopener noreferrer" }, icon("link"), " ", f.label || f.name) : h("a", { href: `api/files/${f.id}` }, icon("doc"), " ", f.name, h("span.nb-caption", ` · ${size(f.size)}`)), h("span.nb-caption", ` ${fmt.date(f.created)} · ${f.created_by}`), f.shared ? badge(t("shared"), "blue") : null, sch(entity).canWrite && btn("", { ico: "trash", sm: true, kind: "ghost", title: t("delete"), onclick: async () => { if (await confirmDialog(t("confirm_delete", { name: f.name }), { danger: true })) { await api.del(`api/files/${f.id}`); refresh(); } } })))) : h("p.nb-help", t("no_files")),
    sch(entity).canWrite && h("div.nb-row", input, btn(t("upload"), { ico: "upload", sm: true, kind: "secondary", onclick: () => input.click() }), btn(t("add_link"), { ico: "link", sm: true, kind: "secondary", onclick: async () => { const m = await linkDialog(); if (m) { await api.post("api/links", { entity, id: row.id, ...m }); refresh(); } } })));
}
function linkDialog() {
  return new Promise((res) => { const url = h("input.nb-input", { placeholder: "https://… / smb://… / \\\\nas\\carpeta", autofocus: true }), lab = h("input.nb-input"); let out = null;
    const m = modal({ title: t("add_link"), body: h("div", h("label.nb-label", "URL"), url, h("label.nb-label", t("name")), lab), onclose: () => res(out), actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }), btn(t("accept"), { onclick: () => { out = { url: url.value, label: lab.value }; m.close(); } })] }); });
}
async function approvals(entity, row, progId, refresh) {
  const r = await api.get(`api/e/${entity}/${row.id}/approvals`, { silent: true }).catch(() => ({ rows: [] }));
  const decide = async (a, status) => { const c = status === "approved" ? "" : prompt(t("comment")) ; try { await entityApi.update("approvals", a.id, { status, comment: c || a.comment || "", rev: a.rev }); refresh(); } catch { /* toast */ } };
  return h("div", (r.rows || []).length ? r.rows.map((a) => h("article.comment", h("header", h("b", optLabel("approvals", "kind", a.kind)), statusBadge("approvals", "status", a.status), h("span.nb-caption", `${a.requested_by} → ${a.approver || "—"}`)), a.comment && h("div.md", { html: md(a.comment) }), a.status === "pending" && (a.approver === S.me.user || !a.approver) && h("div.nb-row", btn(t("approve"), { kind: "green", sm: true, onclick: () => decide(a, "approved") }), btn(t("request_changes"), { kind: "secondary", sm: true, onclick: () => decide(a, "changes") }), btn(t("reject"), { kind: "danger", sm: true, onclick: () => decide(a, "rejected") })))) : h("p.nb-help", t("no_approvals")),
    sch("approvals")?.canWrite && btn(t("request_approval"), { ico: "stamp", sm: true, onclick: async () => { const ok = await requestApproval(entity, row, progId); if (ok) refresh(); } }));
}
export async function requestApproval(entity, row, progId) {
  const users = (await api.get("api/users", { silent: true }).catch(() => ({ users: [] }))).users;
  const form = formFields("approvals", { values: undefined, defaults: { kind: "internal" }, only: ["kind", "approver", "due", "comment"] });
  // approver: pick from known users (free text still allowed through the datalist)
  const dl = h("datalist", { id: "dl-users" }, users.map((u) => h("option", { value: u.username }, u.name))); form.widgets.approver.el.setAttribute?.("list", "dl-users");
  return new Promise((res) => { let ok = false; const m = modal({ title: t("request_approval"), body: h("div", form.el, dl), onclose: () => res(ok), actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }), btn(t("send"), { onclick: async () => { try { const body = form.collect(); await entityApi.create("approvals", { ...body, entity, row_id: row.id, program_id: progId, subject: labelFor(sch(entity), row) }); ok = true; toast("created"); m.close(); } catch { /* toast */ } } })] }); });
}
async function historyPanel(entity, row) {
  const r = await api.get(`api/e/${entity}/${row.id}/history`, { silent: true }).catch(() => ({ history: [] }));
  const val = (f, v) => { const fd = sch(entity).fields[f]; if (v === null || v === undefined || v === "") return "∅"; if (fd?.type === "enum") return optLabel(entity, f, v); if (fd?.type === "ref") return refLabel(fd.to, v); if (typeof v === "object") return JSON.stringify(v).slice(0, 40); return String(v).slice(0, 60); };
  return h("ol.history", (r.history || []).map((x) => h("li", h("div", h("b", x.user), " ", h("span.nb-badge.nb-badge--white", x.action), " ", h("span.nb-caption", fmt.datetime(x.ts))),
    x.action === "update" ? h("ul", Object.entries(x.diff || {}).map(([f, [a, b]]) => h("li", h("span.nb-caption", fieldLabel(entity, f) + ": "), val(f, a), " → ", h("b", val(f, b))))) : null)));
}
