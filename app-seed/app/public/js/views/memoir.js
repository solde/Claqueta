// Project memoirs: list and creation, and the editor that works section by section (guide, real data, structured fields, text, images, graphics, agent).
import { h } from "../dom.js";
import { api, qs, entityApi } from "../api.js";
import { S, t, entName, optLabel, fieldLabel, fmt } from "../i18n.js";
import { btn, badge, icon, card, pageHead, emptyState, toast, modal, confirmDialog, selectWrap, progress, ch } from "../ui.js";
import { go } from "../lists.js";
import { openForm, remember } from "../forms.js";
import { openGraphicDialog } from "./graphics.js";
import { askAgent } from "../agent.js";

const STATUS_COLOR = { empty: "white", draft: "yellow", review: "blue", approved: "green", skipped: "white" };
const MSTATUS = { draft: "white", writing: "yellow", review: "blue", approved: "green", delivered: "green" };
const words = (s) => (String(s || "").trim() ? String(s).trim().split(/\s+/).length : 0);

// ---- list ---------------------------------------------------------------------------------------------------------------------------------
export async function memoirsPage(root, m, params) {
  const progs = await api.get("api/e/programs?limit=200&sort=name&refs=0"); const pid = params.get("program") || progs.rows[0]?.id, canWrite = !!S.schema.entities.memoirs?.canWrite;
  const progSel = h("div.nb-selectwrap", { style: { maxWidth: "300px", marginBottom: "16px" } }, h("select.nb-select", { "aria-label": entName("programs"), onchange: (e) => go(`#/memoirs?program=${e.target.value}`) }, progs.rows.map((p) => h("option", { value: p.id, selected: String(p.id) === String(pid) }, p.name))));
  root.append(pageHead(t("nav_memoirs"), t("memoirs_help"), canWrite && pid ? btn(t("memoir_new"), { ico: "plus", onclick: () => newDialog(pid, progs.rows.find((p) => String(p.id) === String(pid))) }) : null), progSel);
  if (!pid) return void root.append(emptyState(t("no_programs")));
  const r = await api.get(`api/e/memoirs${qs({ "f.program_id": pid, limit: 50, sort: "-updated", refs: 0 })}`);
  if (!r.rows.length) return void root.append(emptyState(t("memoirs_empty")));
  const briefs = await Promise.all(r.rows.slice(0, 12).map((x) => api.get(`api/reports/memoir-brief?memoir=${x.id}`, { silent: true }).catch(() => null)));
  root.append(h("div.fc-page", r.rows.map((x, i) => { const b = briefs[i];
    return h("a.memoir-card", { href: `#/memoir/${x.id}` }, h("div.nb-row.between", h("b", x.title), h("span", badge(optLabel("memoirs", "status", x.status), MSTATUS[x.status] || "white"))),
      h("div.nb-caption", [optLabel("memoirs", "kind", x.kind), x.funder, [x.period_start && fmt.date(x.period_start), x.period_end && fmt.date(x.period_end)].filter(Boolean).join(" – ")].filter(Boolean).join(" · ")),
      b ? h("div.memoir-card__prog", progress(b.overall), h("span.nb-caption", t("memoir_complete", { n: b.overall }))) : null); })));
}
/** Dialog to create a memoir: kind (with the sections it will include), title, funder, period, language, tone and brief. */
async function newDialog(pid, prog) {
  const cat = await api.get(`api/reports/memoir-catalog?lang=${S.lang}`);
  const kind = h("select.nb-select", { onchange: () => { chosen.replaceChildren(...secList()); } }, cat.kinds.map((k) => h("option", { value: k.key }, k.label))), title = h("input.nb-input", { placeholder: `${cat.kinds[0].label} · ${prog?.name || ""}` }), funder = h("input.nb-input"), ref = h("input.nb-input"),
    from = h("input.nb-input", { type: "date", value: prog?.start_date || "" }), to = h("input.nb-input", { type: "date", value: prog?.end_date || "" }), brief = h("textarea.nb-textarea", { rows: 3, placeholder: t("memoir_brief_ph") });
  const tone = h("select.nb-select", S.schema.entities.memoirs.fields.tone.options.map((o) => h("option", { value: o }, optLabel("memoirs", "tone", o)))), lang = h("select.nb-select", ["es", "ca", "en"].map((o) => h("option", { value: o, selected: (prog?.language || S.lang) === o }, o.toUpperCase())));
  const byKey = Object.fromEntries(cat.sections.map((s) => [s.key, s])), secList = () => cat.kinds.find((k) => k.key === kind.value).sections.map((k) => badge(byKey[k].title, "white")), chosen = h("div.nb-row", { style: { flexWrap: "wrap", gap: "6px" } }, ...secList());
  const L = (label, el) => h("label", h("span.nb-caption", label), el);
  const mm = modal({ title: t("memoir_new"), wide: true, body: h("div.nb-stack", L(fieldLabel("memoirs", "kind"), selectWrap(kind)), h("p.nb-help", t("memoir_sections_included")), chosen, L(fieldLabel("memoirs", "title"), title), h("div.nb-row", { style: { gap: "10px" } }, L(fieldLabel("memoirs", "funder"), funder), L(fieldLabel("memoirs", "funder_ref"), ref)),
    h("div.nb-row", { style: { gap: "10px" } }, L(fieldLabel("memoirs", "period_start"), from), L(fieldLabel("memoirs", "period_end"), to), L(fieldLabel("memoirs", "language"), selectWrap(lang)), L(fieldLabel("memoirs", "tone"), selectWrap(tone))), L(fieldLabel("memoirs", "brief"), brief)),
    actions: [btn(t("cancel"), { kind: "secondary", onclick: () => mm.close() }), btn(t("create"), { ico: "plus", onclick: async () => { try { const x = await api.post("api/actions/memoir-create", { program_id: Number(pid), kind: kind.value, title: title.value || undefined, funder: funder.value, funder_ref: ref.value, period_start: from.value || undefined, period_end: to.value || undefined, language: lang.value, tone: tone.value, brief: brief.value }); mm.close(); go(`#/memoir/${x.id}`); } catch { /* toast */ } } })] });
}

// ---- fields ---------------------------------------------------------------------------------------------------------------------------------
function factLines(keys, f) {
  const out = []; const set = new Set(keys);
  if (set.has("episodes") && f.episodes.count) out.push(`${fmt.num(f.episodes.count)} ${entName("episodes", true).toLowerCase()}${f.episodes.aired ? ` (${f.episodes.aired} ${t("memoir_aired")})` : ""}`);
  if (set.has("runtime") && (f.runtime.actual_min || f.runtime.planned_min)) out.push(`${fmt.num(f.runtime.actual_min || f.runtime.planned_min)} min`);
  if (set.has("shoot") && f.shoot.days) out.push(`${f.shoot.days} ${t("memoir_shoot_days")}`);
  if (set.has("crew") && f.crew.people) out.push(`${f.crew.people} ${t("memoir_people")}`);
  if (set.has("locations") && f.locations.length) out.push(`${f.locations.length} ${entName("locations", true).toLowerCase()}`);
  if (set.has("milestones") && f.milestones.length) out.push(`${f.milestones.length} ${entName("milestones", true).toLowerCase()}`);
  if (set.has("audience") && f.audience) out.push(`${t("memoir_audience")}: ${fmt.num(f.audience.avg_audience_k)} k · ${fmt.pct(f.audience.avg_share)}`);
  if ((set.has("budget") || set.has("chapters")) && f.budget) out.push(`${t("memoir_budget")}: ${fmt.money(f.budget.planned)} → ${fmt.money(f.budget.actual)}`);
  if (set.has("billing") && f.billing) out.push(`${t("memoir_invoiced")}: ${fmt.money(f.billing.invoiced)}`);
  if (set.has("risks") && f.risks.length) out.push(`${f.risks.length} ${entName("risks", true).toLowerCase()}`);
  if (set.has("rights") && f.rights.count) out.push(`${f.rights.count} ${entName("rights", true).toLowerCase()}`);
  if (set.has("media") && f.media.count) out.push(`${f.media.count} ${t("memoir_images")}`);
  if (set.has("targets") && f.targets.length) out.push(f.targets.map((x) => x.name).slice(0, 3).join(", "));
  return out;
}
/** Editable table for a list field (add and remove rows). */
function listWidget(fd, value, onChange) {
  let list = Array.isArray(value) && value.length ? value.map((r) => ({ ...r })) : [{}]; const box = h("div.rows");
  const cellOf = (row, c) => h("td", h("input", { class: "nb-input", type: c.type === "num" ? "number" : c.type === "date" ? "date" : "text", step: c.type === "num" ? "any" : undefined, value: row[c.key] ?? "", "aria-label": c.label,
    oninput: (e) => { row[c.key] = c.type === "num" && e.target.value !== "" ? Number(e.target.value) : e.target.value; onChange(list); } }));
  const rowOf = (row, i) => h("tr", ...fd.cols.map((c) => cellOf(row, c)), h("td", btn("", { ico: "trash", kind: "secondary", sm: true, title: t("delete"), onclick: () => { list.splice(i, 1); if (!list.length) list = [{}]; onChange(list); draw(); } })));
  const draw = () => box.replaceChildren(h("div.nb-table-wrap", h("table.nb-table", h("thead", h("tr", ...fd.cols.map((c) => h("th", c.label)), h("th"))), h("tbody", ...list.map(rowOf)))),
    btn(t("memoir_add_row"), { ico: "plus", kind: "secondary", sm: true, onclick: () => { list.push({}); onChange(list); draw(); } }));
  draw(); return box;
}
/** Image selector for a media field, with a picker over the programme's gallery. */
function mediaWidget(ids, gallery, max, onChange) {
  let sel = [...(ids || [])]; const strip = h("div.gal__strip");
  const draw = () => strip.replaceChildren(...sel.map((id) => { const g = gallery.find((x) => x.id === id); return g ? h("figure.gal__mini", { title: g.title }, g.attachment_id ? h("img", { src: `api/files/${g.attachment_id}?thumb=1`, alt: g.title }) : icon("image")) : null; }).filter(Boolean), sel.length ? null : h("span.nb-caption", t("memoir_no_images")));
  const pick = () => { const chosen = new Set(sel), grid = h("div.gal.gal--pick", gallery.filter((x) => x.attachment_id).map((x) => { const box = h("input", { type: "checkbox", checked: chosen.has(x.id), onchange: () => { if (box.checked) { if (max && chosen.size >= max) { box.checked = false; return; } chosen.add(x.id); } else chosen.delete(x.id); } });
      return h("label.gal__item", h("div.gal__img", h("img", { src: `api/files/${x.attachment_id}?thumb=1`, alt: x.title, loading: "lazy" })), h("figcaption", box, " ", x.title)); }));
    const mm = modal({ title: t("memoir_pick_images"), wide: true, body: gallery.length ? grid : h("p.nb-help", t("gallery_empty")), actions: [btn(t("cancel"), { kind: "secondary", onclick: () => mm.close() }), btn(t("accept"), { onclick: () => { sel = [...chosen]; onChange(sel); draw(); mm.close(); } })] }); };
  draw(); return h("div", strip, btn(t("memoir_pick_images"), { ico: "image", kind: "secondary", sm: true, onclick: pick }));
}

// ---- editor ---------------------------------------------------------------------------------------------------------------------------------
export async function memoirPage(root, m) {
  const id = Number(m[1]), canWrite = !!S.schema.entities.memoir_sections?.canWrite; let cur = null, dirty = false, brief;
  const catP = api.get(`api/reports/memoir-catalog?lang=${S.lang}`); const load = async () => { brief = await api.get(`api/reports/memoir-brief?memoir=${id}`); };
  const [cat] = await Promise.all([catP, load()]); const byKey = Object.fromEntries(cat.sections.map((s) => [s.key, s])); const memo = brief.memoir;
  const side = h("nav.memoir__nav", { "aria-label": t("memoir_sections") }), main = h("div.memoir__main");
  const askAll = () => askAgent(t("agent_prompt_memoir", { id, title: memo.title }));
  const build = async () => { if (dirty && !(await save())) return; try { const r = await api.post("api/actions/memoir-build", { memoir_id: id }); toast(t("memoir_built", { n: r.words })); await load(); memo.document_id = r.document_id; header(); go(`#/doc/${r.document_id}`); } catch { /* toast */ } };
  const head = h("div");
  const header = () => head.replaceChildren(pageHead(memo.title, [optLabel("memoirs", "kind", memo.kind), memo.funder, memo.language?.toUpperCase()].filter(Boolean).join(" · "), [
    h("a.nb-btn.nb-btn--secondary", { href: `#/memoirs?program=${brief.facts.program.id}` }, icon("back"), t("nav_memoirs")),
    canWrite && btn(t("memoir_edit_data"), { ico: "settings", kind: "secondary", onclick: async () => { const row = (await entityApi.get("memoirs", id)).row; openForm("memoirs", { row, hide: ["document_id", "built_at"], afterSave: async () => { Object.assign(memo, (await entityApi.get("memoirs", id)).row); header(); } }); } }),
    canWrite && btn(t("ask_agent_memoir"), { ico: "robot", kind: "secondary", onclick: askAll }),
    memo.document_id && h("a.nb-btn.nb-btn--secondary", { href: `#/doc/${memo.document_id}` }, icon("doc"), t("memoir_open_doc")),
    canWrite && btn(t("memoir_build"), { ico: "save", onclick: build })]));
  header();
  root.append(head, h("div.memoir", side, main));

  function drawNav() {
    side.replaceChildren(h("div.nb-row.between", { style: { padding: "4px 8px" } }, h("b", t("memoir_overall")), h("span", `${brief.overall} %`)), progress(brief.overall),
      ...brief.sections.map((s) => h("button", { type: "button", class: ["memoir__link", cur?.key === s.key && "active"], onclick: () => select(s.key) }, h("span.memoir__dot", { class: `st-${s.status}` }), h("span", s.title), s.status !== "skipped" && h("span.nb-caption", `${s.completeness} %`))));
  }
  async function select(key) { if (dirty && !(await confirmDialog(t("memoir_unsaved"), { ok: t("memoir_discard") }))) return; const sec = (await api.get(`api/e/memoir_sections${qs({ "f.memoir_id": id, "f.key": key, limit: 1, refs: 0 })}`)).rows[0]; cur = { ...sec, fields: sec.fields || {}, media_ids: sec.media_ids || [], visuals: sec.visuals ?? null }; dirty = false; drawNav(); drawSection(); }

  async function save() {
    try { await api.post("api/actions/memoir-section", { memoir_id: id, key: cur.key, title: cur.title, body: cur.body || "", fields: cur.fields, media_ids: cur.media_ids, visuals: cur.visuals, status: cur.status, author: S.me?.name || S.me?.username, origin: "human" }); dirty = false; await load(); drawNav(); toast(t("saved")); return true; } catch { return false; }
  }
  const mark = () => { dirty = true; saveBtn.disabled = false; };
  const saveBtn = btn(t("save"), { ico: "save", onclick: save });

  function drawSection() {
    const def = byKey[cur.key], info = brief.sections.find((s) => s.key === cur.key), facts = factLines(def?.facts || [], brief.facts), gallery = brief.gallery;
    const statusSel = h("select.nb-select", { "aria-label": fieldLabel("memoir_sections", "status"), disabled: !canWrite, onchange: (e) => { cur.status = e.target.value; mark(); } }, ["empty", "draft", "review", "approved", "skipped"].map((o) => h("option", { value: o, selected: cur.status === o }, optLabel("memoir_sections", "status", o))));
    const body = h("textarea.nb-textarea.memoir__body", { rows: 14, disabled: !canWrite, spellcheck: "true", placeholder: t("memoir_body_ph"), oninput: (e) => { cur.body = e.target.value; count.textContent = wordInfo(); mark(); } }, cur.body || "");
    const wordInfo = () => `${words(cur.body)} ${t("memoir_words")}${def?.words?.[1] ? ` · ${t("memoir_recommended")}: ${def.words[0]}–${def.words[1]}` : ""}`, count = h("span.nb-caption", wordInfo());
    const fieldEls = (def?.fields || []).map((fd) => {
      const v = cur.fields[fd.key], set = (x) => { cur.fields[fd.key] = x; mark(); }; let el;
      if (fd.type === "list") el = listWidget(fd, v, set);
      else if (fd.type === "media") el = mediaWidget(Array.isArray(v) ? v : [], gallery, fd.max, set);
      else if (fd.type === "long") el = h("textarea.nb-textarea", { rows: 4, disabled: !canWrite, oninput: (e) => set(e.target.value) }, v ?? "");
      else if (fd.type === "enum") el = selectWrap(h("select.nb-select", { disabled: !canWrite, onchange: (e) => set(e.target.value) }, h("option", { value: "" }, "—"), fd.options.map((o) => h("option", { value: o, selected: v === o }, t(`layout_${o}`)))));
      else el = h("input.nb-input", { type: fd.type === "num" ? "number" : fd.type === "date" ? "date" : "text", step: fd.type === "num" ? "any" : undefined, value: v ?? "", disabled: !canWrite, oninput: (e) => set(fd.type === "num" && e.target.value !== "" ? Number(e.target.value) : e.target.value) });
      return h("div.memoir__field", h("label.nb-label", fd.label, fd.required && h("span.nb-caption", " *")), el);
    });
    const visualsBox = h("div"), drawVisuals = () => visualsBox.replaceChildren(
      h("div.nb-row", { style: { flexWrap: "wrap", gap: "6px", marginBottom: "6px" } }, cur.visuals === null ? badge(t("memoir_visuals_auto"), "green") : null, ...(cur.visuals || []).map((v, i) => h("span.nb-row", { style: { gap: "4px" } }, badge(typeof v === "string" ? "…" : v.type, "blue"), canWrite && btn("", { ico: "close", kind: "secondary", sm: true, title: t("delete"), onclick: () => { cur.visuals.splice(i, 1); mark(); drawVisuals(); } })))),
      canWrite && h("div.nb-row", { style: { gap: "8px", flexWrap: "wrap" } }, btn(t("gr_use_in_section"), { ico: "sparkle", kind: "secondary", sm: true, onclick: () => openGraphicDialog({ program_id: brief.facts.program.id, onUse: (spec) => { cur.visuals = [...(cur.visuals || []), spec]; mark(); drawVisuals(); } }) }), cur.visuals !== null && btn(t("memoir_visuals_reset"), { kind: "secondary", sm: true, onclick: () => { cur.visuals = null; mark(); drawVisuals(); } }), cur.visuals === null && btn(t("memoir_visuals_custom"), { kind: "secondary", sm: true, onclick: () => { cur.visuals = []; mark(); drawVisuals(); } })));
    drawVisuals();
    const mediaBox = !def?.fields.some((f) => f.type === "media") ? h("div.memoir__field", h("label.nb-label", t("memoir_images")), mediaWidget(cur.media_ids, gallery, 0, (ids) => { cur.media_ids = ids; mark(); })) : null;
    saveBtn.disabled = !dirty;
    main.replaceChildren(card([
      h("div.memoir__head", h("h2", { style: { margin: 0 } }, cur.title || def?.title || cur.key), h("div.nb-row", { style: { gap: "8px" } }, h("div.nb-selectwrap", statusSel), canWrite && btn(t("ask_agent_section"), { ico: "robot", kind: "secondary", sm: true, onclick: () => askAgent(t("agent_prompt_section", { id, key: cur.key, title: cur.title || def?.title || cur.key })) }), canWrite && saveBtn)),
      def && h("div.memoir__guide", h("p", h("b", t("memoir_purpose")), " ", def.purpose), facts.length ? h("p.nb-caption", h("b", t("memoir_auto_data")), ": ", facts.join(" · ")) : null, info?.missing?.length ? h("p.nb-caption.gal__warn", icon("warn"), " ", t("memoir_missing"), ": ", info.missing.map((x) => (x.kind === "field" ? def.fields.find((f) => f.key === x.key)?.label : t("memoir_more_text", { have: x.have, need: x.need }))).join(", ")) : null),
      ...fieldEls, h("div.memoir__field", h("label.nb-label", t("memoir_text")), body, count), mediaBox, h("div.memoir__field", h("label.nb-label", t("memoir_graphics")), visualsBox),
      cur.agent_brief || cur.notes ? h("p.nb-help", cur.agent_brief, " ", cur.notes) : null], { head: ch("book", def?.title || cur.key) }));
  }
  window.addEventListener("keydown", function onKey(e) { if (!document.body.contains(main)) return window.removeEventListener("keydown", onKey); if ((e.metaKey || e.ctrlKey) && e.key === "s" && dirty) { e.preventDefault(); save(); } });
  drawNav(); await select(brief.sections.find((s) => s.status !== "skipped" && s.completeness < 100 && s.guide?.words?.[1] > 0)?.key || brief.sections[0]?.key);
}
