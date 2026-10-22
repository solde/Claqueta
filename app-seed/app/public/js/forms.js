// Generic form builder driven by the schema: every field type, reference pickers, sections, validation, create/update with optimistic concurrency.
import { h, debounce } from "./dom.js";
import { api, entityApi, qs } from "./api.js";
import { S, t, fieldLabel, optLabel, entName, errText, parseDuration, fmt } from "./i18n.js";
import { btn, modal, toast, selectWrap, icon } from "./ui.js";

export const refCache = {};            // entity -> { id: label }
export const remember = (refs) => { for (const [e, m] of Object.entries(refs || {})) Object.assign((refCache[e] ||= {}), m); };
export const refLabel = (entity, id) => (id ? refCache[entity]?.[id] ?? `#${id}` : "");
const schemaOf = (e) => S.schema.entities[e];

// ---- field widgets: each returns { el, get(), set(v), focus() } ---------------------------------------------------------------------------
function labelEl(entity, fd, id) { return h("label.nb-label", { for: id }, fieldLabel(entity, fd.name), fd.required && h("span", { "aria-hidden": "true" }, " *")); }
let uid = 0;
export function widget(entity, fd, value, o = {}) {
  const id = `f${++uid}`; const disabled = !fd.writable || o.readonly; const ph = o.placeholder || "";
  const base = { id, disabled, "aria-required": fd.required ? "true" : undefined, placeholder: ph };
  let el, get, set = (v) => { el.value = v ?? ""; };
  switch (fd.type) {
    case "long": el = h("textarea.nb-textarea", { ...base, rows: fd.max && fd.max > 20000 ? 14 : 4 }, value ?? ""); get = () => el.value; break;
    case "int": el = h("input.nb-input", { ...base, type: "number", step: "1", min: fd.min, max: fd.max, value: value ?? "" }); get = () => (el.value === "" ? null : Number(el.value)); break;
    case "num": case "pct": el = h("input.nb-input", { ...base, type: "number", step: "any", min: fd.min, max: fd.max, value: value ?? "" }); get = () => (el.value === "" ? null : Number(el.value)); break;
    case "money": el = h("input.nb-input", { ...base, type: "number", step: "0.01", value: value ?? "", inputmode: "decimal" }); get = () => (el.value === "" ? null : Number(el.value)); break;
    case "bool": { const cb = h("input", { type: "checkbox", id, checked: !!value, disabled }); el = h("label.nb-switch", { for: id }, cb, h("span", t("yes"))); get = () => (cb.checked ? 1 : 0); set = (v) => { cb.checked = !!v; }; break; }
    case "date": el = h("input.nb-input", { ...base, type: "date", value: value ?? "" }); get = () => el.value || null; break;
    case "time": el = h("input.nb-input", { ...base, type: "time", value: value ?? "" }); get = () => el.value || null; break;
    case "datetime": el = h("input.nb-input", { ...base, type: "datetime-local", value: (value || "").slice(0, 16) }); get = () => el.value || null; set = (v) => { el.value = (v || "").slice(0, 16); }; break;
    case "enum": { const sel = h("select.nb-select", { ...base }, fd.options.map((op) => h("option", { value: op, selected: (value ?? fd.default) === op }, optLabel(entity, fd.name, op)))); if (!fd.required && !fd.default) sel.prepend(h("option", { value: "" }, "—")); el = selectWrap(sel); get = () => sel.value || null; set = (v) => { sel.value = v ?? ""; }; el.focusEl = sel; break; }
    case "ref": return refWidget(entity, fd, value, { ...o, id, disabled });
    case "tags": { const inp = h("input.nb-input", { ...base, value: (value || []).join(", ") }); el = inp; get = () => inp.value.split(",").map((x) => x.trim()).filter(Boolean); set = (v) => { inp.value = (v || []).join(", "); }; break; }
    case "json": { const ta = h("textarea.nb-textarea.nb-mono", { ...base, rows: 6, spellcheck: "false" }, value == null ? "" : JSON.stringify(value, null, 2)); el = ta; get = () => { const s = ta.value.trim(); if (!s) return null; try { const v = JSON.parse(s); ta.setAttribute("aria-invalid", "false"); return v; } catch { ta.setAttribute("aria-invalid", "true"); throw new Error(`invalid_json:${fd.name}`); } }; set = (v) => { ta.value = v == null ? "" : JSON.stringify(v, null, 2); }; break; }
    case "secret": { const inp = h("input.nb-input", { ...base, type: "password", autocomplete: "off", value: value ?? "" }); const eye = btn("", { ico: "eye", sm: true, kind: "secondary", title: t("show"), onclick: () => { inp.type = inp.type === "password" ? "text" : "password"; } }); el = h("div.nb-row", { style: { flexWrap: "nowrap" } }, h("div.nb-grow", inp), eye); el.focusEl = inp; get = () => inp.value; set = (v) => { inp.value = v ?? ""; }; break; }
    default: {
      if (fd.format === "color") { const c = h("input.nb-input.nb-input--color", { id, type: "color", value: /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#000000", disabled }); const tx = h("input.nb-input", { value: value ?? "", disabled, placeholder: "#RRGGBB", "aria-label": fieldLabel(entity, fd.name) }); c.addEventListener("input", () => { tx.value = c.value; }); tx.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(tx.value)) c.value = tx.value; }); el = h("div.nb-row", { style: { flexWrap: "nowrap" } }, c, h("div.nb-grow", tx)); el.focusEl = tx; get = () => tx.value || null; set = (v) => { tx.value = v ?? ""; if (/^#[0-9a-f]{6}$/i.test(v || "")) c.value = v; }; break; }
      if (fd.format === "folder") {   // a folder on this computer: typed, or chosen with the system dialog when the desktop shell offers one (the shell is a same-origin parent frame)
        const inp = h("input.nb-input", { ...base, type: "text", value: value ?? "", maxlength: fd.max, placeholder: t("folder_hint"), spellcheck: "false", autocomplete: "off" });
        const bridge = window.parent !== window ? window.parent.colladoDesktop : null;
        if (bridge?.pickFolder && !disabled) {
          const pick = btn(t("choose_folder"), { sm: true, kind: "secondary", onclick: async () => { const p = await bridge.pickFolder(inp.value.trim()); if (p) { inp.value = p; inp.dispatchEvent(new Event("input", { bubbles: true })); } } });
          el = h("div.nb-row", { style: "flex-wrap:nowrap" }, h("div.nb-grow", inp), pick); el.focusEl = inp;
        } else el = inp;
        get = () => inp.value.trim(); set = (v) => { inp.value = v ?? ""; };
        return { el, id, get, set, focus: () => inp.focus(), fd };
      }
      const type = fd.format === "email" ? "email" : fd.format === "url" ? "url" : "text"; el = h("input.nb-input", { ...base, type, value: value ?? "", maxlength: fd.max }); get = () => el.value;
    }
  }
  return { el, id, get, set, focus: () => (el.focusEl || el).focus?.(), fd };
}

function refWidget(entity, fd, value, { id, disabled, defaults }) {
  const to = fd.to; let current = value || null; let items = null;
  const sel = h("select.nb-select", { id, disabled, "aria-required": fd.required ? "true" : undefined });
  const wrap = selectWrap(sel);
  const fill = (rows) => { clear(sel); if (!fd.required || !current) sel.append(h("option", { value: "" }, "—")); const seen = new Set(); for (const r of rows) { seen.add(r.id); sel.append(h("option", { value: r.id }, r.label)); } if (current && !seen.has(current)) sel.append(h("option", { value: current }, refLabel(to, current))); sel.value = current || ""; };
  const clear = (el) => { while (el.firstChild) el.firstChild.remove(); };
  fill(current ? [{ id: current, label: refLabel(to, current) }] : []);
  const load = async () => {
    if (items) return; items = [];
    const filter = Object.fromEntries(Object.entries(fd.filter || {}).map(([k, v]) => [`f.${k}`, v]));
    try { const r = await api.get(`api/e/${to}${qs({ ...filter, limit: 300, sort: schemaOf(to)?.sort?.replace(/^-/, "") })}`, { silent: true }); remember(r.refs); const ent = schemaOf(to); items = r.rows.map((x) => ({ id: x.id, label: labelFor(ent, x) })); for (const x of items) (refCache[to] ||= {})[x.id] = x.label; } catch { items = []; }
    fill(items);
  };
  sel.addEventListener("focus", load, { once: true }); sel.addEventListener("mousedown", load, { once: true });
  sel.addEventListener("change", () => { current = sel.value ? Number(sel.value) : null; });
  if (current && !refCache[to]?.[current]) api.get(`api/e/${to}/${current}`, { silent: true }).then((r) => { const ent = schemaOf(to); (refCache[to] ||= {})[current] = labelFor(ent, r.row); fill(items || [{ id: current, label: refCache[to][current] }]); }).catch(() => {});
  return { el: wrap, id, get: () => (sel.value ? Number(sel.value) : null), set: (v) => { current = v || null; fill(items || (current ? [{ id: current, label: refLabel(to, current) }] : [])); }, focus: () => sel.focus(), fd, reload: () => { items = null; return load(); } };
}
export function labelFor(ent, row) {
  if (!ent) return `#${row.id}`;
  const parts = ent.title.map((k) => row[k]).filter((v) => v !== null && v !== undefined && v !== "");
  return (ent.titlePrefix || "") + (parts.join(ent.titleSep || " · ") || `#${row.id}`);
}

// ---- form -----------------------------------------------------------------------------------------------------------------------------
/** Builds the field grid for an entity. opts: { values, defaults, lock: [fields shown read-only], hide: [fields], only: [fields], compact } */
export function formFields(entity, opts = {}) {
  const ent = schemaOf(entity); const values = { ...(opts.defaults || {}), ...(opts.values || {}) }; const widgets = {};
  const skip = new Set([...(opts.hide || [])]);
  const sections = ent.sections || [{ key: "main", fields: Object.keys(ent.fields) }];
  const used = new Set(sections.flatMap((s) => s.fields)); const extra = Object.keys(ent.fields).filter((f) => !used.has(f));
  const all = extra.length ? [...sections, { key: "more", fields: extra }] : sections;
  const root = h("div.formgrid");
  for (const sec of all) {
    const fds = sec.fields.map((f) => ent.fields[f]).filter((fd) => fd && !skip.has(fd.name) && (!opts.only || opts.only.includes(fd.name)) && !(fd.ro && !opts.values));
    if (!fds.length) continue;
    const box = h("fieldset.fs", all.length > 1 && sec.key !== "main" && h("legend", t(`sec_${sec.key}`)));
    for (const fd of fds) {
      const w = widget(entity, fd, values[fd.name], { readonly: opts.lock?.includes(fd.name), defaults: values }); widgets[fd.name] = w;
      const wide = ["long", "json", "tags"].includes(fd.type) || fd.name === "title" || fd.name === "name";
      box.append(h("div", { class: ["field", wide && "wide"], "data-field": fd.name }, labelEl(entity, fd, w.id), w.el, fd.help && h("div.nb-help", fd.help), h("div.field__err", { "aria-live": "polite" })));
    }
    root.append(box);
  }
  const collect = () => {
    const out = {};
    for (const [k, w] of Object.entries(widgets)) { if (!w.fd.writable) continue; if (opts.lock?.includes(k)) { if (values[k] !== undefined && values[k] !== null) out[k] = values[k]; continue; } out[k] = w.get(); }
    for (const k of opts.hide || []) if (values[k] !== undefined && values[k] !== null && ent.fields[k]?.writable) out[k] = values[k];   // hidden fields keep the value given as default (parent ids...)
    return out;
  };
  const showError = (code) => { const f = (code || "").split(":")[1]; const box = f && root.querySelector(`[data-field="${f}"] .field__err`); if (box) { box.replaceChildren(h("span.nb-error", errText({ code }))); box.closest(".field")?.querySelector("input,select,textarea")?.setAttribute("aria-invalid", "true"); box.closest(".field").scrollIntoView({ block: "center" }); return true; } return false; };
  return { el: root, widgets, collect, showError };
}

export async function saveForm(entity, form, row, extra = {}) {
  let body; try { body = { ...form.collect(), ...extra }; } catch (e) { form.showError(e.message); throw e; }
  if (!row?.id) for (const fd of Object.values(schemaOf(entity).fields)) if (fd.required && fd.writable && (body[fd.name] === null || body[fd.name] === "" || body[fd.name] === undefined)) { if (!form.showError(`required:${fd.name}`)) toast(new Error(`required:${fd.name}`)); throw new Error(`required:${fd.name}`); }
  try { return row?.id ? await entityApi.update(entity, row.id, { ...body, rev: row.rev }) : await entityApi.create(entity, body); }
  catch (e) { if (!form.showError(e.code || "")) { /* toast shown by api */ } throw e; }
}

/** Modal create/edit. Resolves with the saved row (or null when cancelled). */
export function openForm(entity, { row = null, defaults = {}, lock = [], hide = [], title, wide = true, afterSave } = {}) {
  return new Promise((resolve) => {
    const ent = schemaOf(entity); const form = formFields(entity, { values: row || undefined, defaults, lock, hide }); let saved = null;
    const submit = async () => { try { saved = await saveForm(entity, form, row, {}); toast(row ? "saved" : "created"); if (afterSave) await afterSave(saved); m.close(); } catch { /* shown in the form */ } };
    const m = modal({ title: title || `${row ? t("edit") : t("new")} · ${entName(entity)}`, wide, body: h("form", { onsubmit: (e) => { e.preventDefault(); submit(); } }, form.el, h("button", { type: "submit", hidden: true })), onclose: () => resolve(saved),
      actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }), btn(t("save"), { onclick: submit, ico: "save" })] });
  });
}
