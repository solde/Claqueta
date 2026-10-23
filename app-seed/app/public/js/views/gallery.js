// Image gallery of a programme: upload (also by drag and drop), captions, credits and rights, featured pictures, generated graphics, and a request to the agent.
import { h } from "../dom.js";
import { api, qs, entityApi } from "../api.js";
import { S, t, entName, optLabel, fieldLabel, fmt } from "../i18n.js";
import { btn, badge, icon, card, pageHead, emptyState, toast, modal, confirmDialog, selectWrap } from "../ui.js";
import { go } from "../lists.js";
import { openForm, remember } from "../forms.js";
import { openGraphicDialog } from "./graphics.js";
import { askAgent } from "../agent.js";

const thumb = (x) => `api/files/${x.attachment_id}?thumb=1`;
const RIGHTS_COLOR = { owned: "green", licensed: "blue", release_pending: "orange", restricted: "red" };

export async function galleryPage(root, m, params) {
  const progs = await api.get("api/e/programs?limit=200&sort=name&refs=0"); const pid = params.get("program") || progs.rows[0]?.id;
  const canWrite = !!S.schema.entities.media_items?.canWrite;
  const prog = progs.rows.find((p) => String(p.id) === String(pid));
  const progSel = h("div.nb-selectwrap", { style: { maxWidth: "300px" } }, h("select.nb-select", { "aria-label": entName("programs"), onchange: (e) => go(`#/gallery?program=${e.target.value}`) }, progs.rows.map((p) => h("option", { value: p.id, selected: String(p.id) === String(pid) }, p.name))));
  if (!pid) return void root.append(pageHead(t("nav_gallery"), t("gallery_help")), emptyState(t("no_programs")));
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", multiple: true, hidden: true, onchange: () => upload([...fileIn.files]) });
  const agentBtn = btn(t("ask_agent_images"), { ico: "robot", kind: "secondary", onclick: () => askAgent(t("agent_prompt_gallery", { id: pid, name: prog?.name || "" })) });
  root.append(pageHead(t("nav_gallery"), t("gallery_help"), canWrite ? [fileIn, btn(t("gallery_upload"), { ico: "upload", onclick: () => fileIn.click() }), btn(t("gr_new"), { ico: "sparkle", kind: "secondary", onclick: () => openGraphicDialog({ program_id: Number(pid), onSaved: load }) }), agentBtn] : null), progSel);
  const summary = h("div.stats", { style: { margin: "16px 0" } }), filters = h("div.nb-row", { style: { gap: "10px", flexWrap: "wrap", margin: "0 0 12px" } }), grid = h("div.gal"), drop = h("div.gal__drop", { hidden: true }, icon("upload"), " ", t("gallery_drop"));
  root.append(summary, filters, drop, grid);
  const f = { kind: params.get("kind") || "", phase: params.get("phase") || "", q: "", featured: false };
  let rows = [];

  const opts = (field) => (S.schema.entities.media_items.fields[field].options || []);
  const sel = (key, label, field) => h("div.nb-selectwrap", h("select.nb-select", { "aria-label": label, onchange: (e) => { f[key] = e.target.value; draw(); } }, h("option", { value: "" }, label), opts(field).map((o) => h("option", { value: o, selected: f[key] === o }, optLabel("media_items", field, o)))));
  filters.append(h("input.nb-input", { type: "search", placeholder: t("search"), "aria-label": t("search"), style: { maxWidth: "260px" }, oninput: (e) => { f.q = e.target.value.toLowerCase(); draw(); } }), sel("kind", fieldLabel("media_items", "kind"), "kind"), sel("phase", fieldLabel("media_items", "phase"), "phase"),
    h("label.nb-check", h("input", { type: "checkbox", onchange: (e) => { f.featured = e.target.checked; draw(); } }), t("gallery_only_featured")));

  async function load() { const r = await api.get(`api/e/media_items${qs({ "f.program_id": pid, limit: 500, sort: "-featured,position,-id", refs: 0 })}`); remember(r.refs); rows = r.rows; draw(); }
  function draw() {
    const noCap = rows.filter((x) => !x.caption && x.kind !== "logo").length, pending = rows.filter((x) => x.rights === "release_pending" || x.rights === "restricted").length;
    summary.replaceChildren(...[["c-blue", rows.length, t("gallery_count")], ["c-yellow", rows.filter((x) => x.featured).length, t("gallery_featured")], ["c-red", noCap, t("gallery_no_caption")], ["c-orange", pending, t("gallery_rights_attention")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", String(v)), h("span", l))));
    const list = rows.filter((x) => (!f.kind || x.kind === f.kind) && (!f.phase || x.phase === f.phase) && (!f.featured || x.featured) && (!f.q || [x.title, x.caption, x.credit, x.people].join(" ").toLowerCase().includes(f.q)));
    grid.replaceChildren(...(list.length ? list.map(item) : [emptyState(rows.length ? t("no_results") : t("gallery_empty"))]));
  }
  function item(x) {
    const star = btn("", { ico: "star", kind: x.featured ? "primary" : "secondary", sm: true, title: t("gallery_featured"), disabled: !canWrite, onclick: async (e) => { e.stopPropagation(); await entityApi.update("media_items", x.id, { featured: x.featured ? 0 : 1 }); load(); } });
    return h("figure", { class: ["gal__item", x.featured && "is-featured"], tabindex: "0", onclick: () => open(x), onkeydown: (e) => { if (e.key === "Enter") open(x); } },
      h("div.gal__img", { class: x.kind === "graphic" && "is-graphic" }, x.attachment_id ? h("img", { src: thumb(x), alt: x.alt_text || x.title, loading: "lazy" }) : icon("image"), h("div.gal__flags", x.rights && x.rights !== "owned" && badge(optLabel("media_items", "rights", x.rights), RIGHTS_COLOR[x.rights] || "white"), x.origin !== "upload" && badge(optLabel("media_items", "origin", x.origin), "white")), h("div.gal__star", star)),
      h("figcaption", h("b", x.title), h("span.nb-caption", [optLabel("media_items", "kind", x.kind), x.phase && optLabel("media_items", "phase", x.phase)].filter(Boolean).join(" · ")), x.caption ? h("span", x.caption) : (x.kind !== "logo" && h("span.gal__warn", icon("warn"), " ", t("gallery_no_caption_one")))));
  }
  function open(x) {
    const body = h("div.gal__open", x.attachment_id && h("img", { src: `api/files/${x.attachment_id}?max=1400`, alt: x.alt_text || x.title }), h("dl.kv", [["caption", x.caption], ["credit", x.credit], ["shot_date", x.shot_date && fmt.date(x.shot_date)], ["people", x.people], ["rights", x.rights && optLabel("media_items", "rights", x.rights)], ["width", x.width && x.height ? `${x.width} × ${x.height}` : ""]].filter(([, v]) => v).map(([k, v]) => h("div", h("dt", k === "width" ? t("gallery_size") : fieldLabel("media_items", k)), h("dd", v)))));
    const mm = modal({ title: x.title, wide: true, body, actions: [btn(t("close"), { kind: "secondary", onclick: () => mm.close() }), x.attachment_id && h("a.nb-btn.nb-btn--secondary", { href: `api/files/${x.attachment_id}`, download: x.title }, icon("download"), t("download")),
      canWrite && btn(t("delete"), { ico: "trash", kind: "danger", onclick: async () => { if (await confirmDialog(t("confirm_delete", { name: x.title }), { ok: t("delete") })) { await entityApi.remove("media_items", x.id); mm.close(); load(); } } }),
      canWrite && btn(t("edit"), { ico: "edit", onclick: () => { mm.close(); openForm("media_items", { row: x, hide: ["spec", "position"], afterSave: load }); } })] });
  }
  async function upload(files) {
    files = files.filter((x) => /^image\//.test(x.type)); if (!files.length) return toast(t("gallery_only_images"), "warn"); let ok = 0;
    for (const file of files) { try { await api.post(`api/media${qs({ program: pid, name: file.name })}`, file); ok++; } catch { /* toast shown */ } }
    if (ok) toast(t("gallery_uploaded", { n: ok })); load();
  }
  if (canWrite) { for (const ev of ["dragenter", "dragover"]) root.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); drop.hidden = false; } }); root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) drop.hidden = true; }); root.addEventListener("drop", (e) => { e.preventDefault(); drop.hidden = true; upload([...(e.dataTransfer?.files || [])]); }); }
  await load();
}
