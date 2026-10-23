// Documents: generation dialog (templates -> editable document or direct PDF/DOCX/HTML), editor with live preview and lint, agent generations page.
import { h, debounce, download } from "../dom.js";
import { api, entityApi, qs } from "../api.js";
import { S, t, entName, fieldLabel, optLabel, fmt, LANGS } from "../i18n.js";
import { btn, badge, statusBadge, icon, card, pageHead, emptyState, spinner, toast, modal, ch, confirmDialog, dropdown, tabs } from "../ui.js";
import { formFields, widget, openForm, remember, refLabel } from "../forms.js";
import { entityList, go } from "../lists.js";
import { md } from "../md.js";
import { requestApproval } from "../detail.js";

const sch = (e) => S.schema.entities[e]; const has = (p) => S.me.perms.includes("*") || S.me.perms.includes(p);

/** Calls a document endpoint and returns the file with its warnings. */
async function fetchBlob(path, body, name) { const res = await api.raw("POST", path, body); const blob = await res.blob(); const warn = res.headers.get("x-collado-warnings"); download(name, blob); try { const w = JSON.parse(decodeURIComponent(warn || "[]")); if (w.length) toast(t("doc_warnings", { n: w.length }), "warn"); } catch { /* ignore */ } }

/** Template picker -> variables -> create editable document, or render straight to a file. */
export async function generateDialog({ program_id, episode_id, season_id, vars = {}, only }) {
  const [tpls, brands] = await Promise.all([api.get("api/e/doc_templates?limit=200&sort=name&refs=0"), api.get("api/e/brands?limit=100&sort=name&refs=0")]);
  const list = tpls.rows.filter((x) => !only || only.includes(x.key) || only.includes(x.id)); if (!list.length) { toast(t("no_templates"), "warn"); return; }
  let cur = list[0]; let varWidgets = {};
  const tplSel = h("select.nb-select", { "aria-label": t("template"), onchange: () => { cur = list.find((x) => String(x.id) === tplSel.value); drawVars(); } }, list.map((x) => h("option", { value: x.id }, x.name)));
  const brandSel = h("select.nb-select", { "aria-label": entName("brands") }, h("option", { value: "" }, `${t("default")}`), brands.rows.map((b) => h("option", { value: b.id }, b.name)));
  const langSel = h("select.nb-select", { "aria-label": t("language") }, Object.entries(LANGS).map(([k, v]) => h("option", { value: k, selected: k === S.lang }, v)));
  const varBox = h("div.formgrid"); const desc = h("p.nb-help");
  function drawVars() { desc.textContent = cur.description || ""; varWidgets = {}; varBox.replaceChildren(...(cur.variables || []).map((v) => { const fd = { name: v.key, type: ({ long: "long", date: "date", num: "num", int: "int", time: "time" })[v.type] || "text", writable: true, max: 20000 }; const w = widget("documents", fd, vars[v.key] ?? v.default ?? ""); varWidgets[v.key] = w; return h("div.field", { class: v.type === "long" ? "wide" : "" }, h("label.nb-label", { for: w.id }, v.label || v.key), w.el); })); }
  drawVars();
  const collect = () => ({ ...vars, ...Object.fromEntries(Object.entries(varWidgets).map(([k, w]) => [k, w.get()])) });
  const base = () => ({ template_id: cur.id, program_id, episode_id, season_id, vars: collect(), brand_id: brandSel.value ? Number(brandSel.value) : undefined, lang: langSel.value });
  const m = modal({ title: t("generate_doc"), wide: true, body: h("div", h("div.nb-row", h("div.nb-grow", h("label.nb-label", t("template")), h("div.nb-selectwrap", tplSel)), h("div", h("label.nb-label", entName("brands")), h("div.nb-selectwrap", brandSel)), h("div", h("label.nb-label", t("language")), h("div.nb-selectwrap", langSel))), desc, varBox),
    actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }),
      dropdown(t("download"), [{ label: "PDF", icon: "doc", onclick: () => fetchBlob("api/docs/render", { ...base(), format: "pdf" }, `${cur.key || "doc"}.pdf`) }, { label: "Word (.docx)", icon: "doc", onclick: () => fetchBlob("api/docs/render", { ...base(), format: "docx" }, `${cur.key || "doc"}.docx`) }, { label: "HTML", icon: "globe", onclick: () => fetchBlob("api/docs/render", { ...base(), format: "html" }, `${cur.key || "doc"}.html`) }], { ico: "download" }),
      sch("documents").canWrite && btn(t("create_editable"), { ico: "edit", onclick: async () => { const b = base(); try { const d = await api.post("api/docs/from-template", { ...b, title: undefined }); m.close(); go(`#/doc/${d.id}`); } catch { /* toast */ } } })] });
}

// ---- editor ---------------------------------------------------------------------------------------------------------------------------------------
export async function docEditor(root, m) {
  const id = Number(m[1]); const { row, refs } = await entityApi.get("documents", id); remember(refs); let doc = row; const canEdit = sch("documents").canWrite && !["final"].includes(doc.status);
  const ta = h("textarea.nb-textarea", { id: "docbody", spellcheck: "true", "aria-label": t("content"), disabled: !sch("documents").canWrite }, doc.content || ""); const frame = h("iframe", { title: t("preview"), sandbox: "" }); let dirty = false, saving = false;
  const title = h("input.nb-input", { value: doc.title, "aria-label": fieldLabel("documents", "title"), style: { fontWeight: 700, fontSize: "1.2rem" }, oninput: () => mark() });
  const status = h("div.nb-selectwrap", h("select.nb-select", { "aria-label": fieldLabel("documents", "status"), onchange: () => mark() }, sch("documents").fields.status.options.map((o) => h("option", { value: o, selected: o === doc.status }, optLabel("documents", "status", o)))));
  const lang = h("div.nb-selectwrap", h("select.nb-select", { "aria-label": fieldLabel("documents", "language"), onchange: () => { mark(); preview(); } }, Object.entries(LANGS).map(([k, v]) => h("option", { value: k, selected: k === doc.language }, v))));
  const brandSel = h("select.nb-select", { "aria-label": entName("brands"), onchange: () => { mark(); preview(); } }, h("option", { value: "" }, t("default")));
  api.get("api/e/brands?limit=100&sort=name&refs=0").then((r) => { for (const b of r.rows) brandSel.append(h("option", { value: b.id, selected: b.id === doc.brand_id }, b.name)); });
  const shared = sch("documents").fields.shared && h("label.nb-check", h("input", { type: "checkbox", checked: !!doc.shared, onchange: () => mark() }), t("shared"));
  const state = h("span.nb-caption", t("saved"));
  const mark = () => { dirty = true; state.textContent = t("unsaved"); autosave(); };
  const brandVal = () => (brandSel.value ? Number(brandSel.value) : null);
  const payload = () => ({ markdown: ta.value, title: title.value, program_id: doc.program_id, episode_id: doc.episode_id, vars: doc.vars || {}, template_id: doc.template_id, brand_id: brandVal(), lang: lang.querySelector("select").value, options: doc.options || {}, document_id: undefined });
  const preview = debounce(async () => { try { const res = await api.raw("POST", "api/docs/preview", payload()); frame.srcdoc = await res.text(); } catch { /* error toast shown by api for non-ok */ } }, 600);
  async function save(manual) { if (saving) return; saving = true; try { const u = await entityApi.update("documents", id, { title: title.value, content: ta.value, status: status.querySelector("select").value, language: lang.querySelector("select").value, brand_id: brandVal(), shared: shared ? (shared.querySelector("input").checked ? 1 : 0) : undefined, vars: doc.vars, rev: doc.rev }); doc = u; dirty = false; state.textContent = t("saved") + " · v" + u.version; if (manual) toast("saved"); } catch (e) { state.textContent = t("save_failed"); } finally { saving = false; } }
  const autosave = debounce(() => { if (dirty && canEdit) save(false); }, 4000);
  ta.addEventListener("input", () => { mark(); preview(); }); document.addEventListener("keydown", function onKey(e) { if (!document.body.contains(ta)) { document.removeEventListener("keydown", onKey); return; } if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(true); } });
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  const insert = (text) => { const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(text, s, e, "end"); ta.focus(); mark(); preview(); };
  const snippets = [["H2", "\n## "], ["B", "**negrita**"], [t("snip_table"), "\n| A | B |\n|:--|--:|\n|  |  |\n"], [t("snip_callout"), "\n:::callout kind=info title=\"Nota\"\nTexto\n:::\n"], [t("snip_cols"), "\n:::columns\nIzquierda\n---col---\nDerecha\n:::\n"], [t("snip_toc"), "\n:::toc depth=2:::\n"], [t("snip_pagebreak"), "\n\\pagebreak\n"], [t("snip_sign"), "\n:::signature names=\"Parte A|Parte B\"\n:::\n"]];
  const sources = await api.get("api/docs/sources", { silent: true }).catch(() => ({ sources: [] }));
  const dataMenu = dropdown(t("insert_data"), sources.sources.map((s) => ({ label: `${s.name} — ${s.label}`, icon: "chart", onclick: () => insert(`\n:::data source=${s.name}${doc.program_id ? ` program=${doc.program_id}` : ""}${doc.episode_id && s.params.includes("episode") ? ` episode=${doc.episode_id}` : ""}\n:::\n`) })), { ico: "chart" });
  const lint = btn(t("check_doc"), { ico: "check", kind: "secondary", sm: true, onclick: async () => { await save(false); const r = await api.post("api/docs/lint", { ...payload(), document_id: id, markdown: ta.value }); modal({ title: t("check_doc"), wide: true, body: h("div", h("p", `${r.stats.words} ${t("words")} · ~${r.stats.pages_estimate} ${t("pages")}`), r.issues.length ? h("ul.issues", r.issues.map((i) => h("li", badge(i.level, i.level === "error" ? "red" : i.level === "warn" ? "orange" : "blue"), h("code", i.code), " ", i.message))) : h("div.nb-alert.nb-alert--ok", icon("ok"), t("doc_ok"))) }); } });
  const hist = btn(t("history"), { ico: "history", kind: "secondary", sm: true, onclick: async () => { const r = await api.get(`api/e/doc_versions?f.document_id=${id}&sort=-version&limit=50&refs=0`); const mm = modal({ title: t("history"), wide: true, body: h("ul.issues", r.rows.map((v) => h("li", badge(`v${v.version}`, "white"), h("span", `${fmt.datetime(v.created)} · ${v.created_by}`), canEdit && btn(t("restore"), { sm: true, kind: "secondary", onclick: async () => { ta.value = v.content; title.value = v.title || title.value; mm.close(); mark(); preview(); } })))) }); } });
  const exp = dropdown(t("export"), [{ label: "PDF", icon: "doc", onclick: () => fetchBlob("api/docs/render", { ...payload(), format: "pdf" }, `${title.value || "doc"}.pdf`) }, { label: "Word (.docx)", icon: "doc", onclick: () => fetchBlob("api/docs/render", { ...payload(), format: "docx" }, `${title.value || "doc"}.docx`) }, { label: "HTML", icon: "globe", onclick: () => fetchBlob("api/docs/render", { ...payload(), format: "html" }, `${title.value || "doc"}.html`) }, { label: "Markdown", icon: "copy", onclick: () => fetchBlob("api/docs/render", { ...payload(), format: "md" }, `${title.value || "doc"}.md`) }, { label: t("save_export"), icon: "save", onclick: async () => { const r = await api.post("api/docs/render", { ...payload(), format: "pdf", save: true, document_id: id }); toast(t("saved_export", { name: r.name })); } }], { ico: "download" });
  const approval = sch("approvals")?.canWrite && btn(t("request_approval"), { ico: "stamp", kind: "secondary", sm: true, onclick: () => requestApproval("documents", doc, doc.program_id) });
  root.append(h("header.pagehead", h("div", h("div.nb-caption", doc.program_id ? h("a", { href: `#/p/${doc.program_id}/docs` }, refLabel("programs", doc.program_id)) : entName("documents", true), " · ", badge(optLabel("documents", "type", doc.type), "white"), " v", String(doc.version)), title), h("div.nb-row", state, canEdit && btn(t("save"), { ico: "save", onclick: () => save(true) }))),
    h("div.nb-row", { style: { marginBottom: "12px" } }, status, lang, h("div.nb-selectwrap", brandSel), shared, dataMenu, lint, hist, exp, approval, btn(t("details"), { kind: "secondary", sm: true, onclick: () => { location.hash = `#/e/documents/${id}?raw=1`; } })),
    h("div.snippets", snippets.map(([l, s]) => btn(l, { sm: true, kind: "secondary", onclick: () => insert(s) }))),
    h("div.docedit", ta, h("div.docedit__prev", frame)));
  preview();
}

// ---- agent generations ----------------------------------------------------------------------------------------------------------------------------
export async function agentPage(root) {
  const [kinds, progs] = await Promise.all([api.get("api/jobs/kinds"), api.get("api/e/programs?limit=200&sort=name&refs=0")]);
  const progSel = h("select.nb-select", { "aria-label": entName("programs") }, progs.rows.map((p) => h("option", { value: p.id }, p.name)));
  const kindSel = h("select.nb-select", { "aria-label": t("job_kind"), onchange: () => { hint.textContent = kinds.kinds[kindSel.value].hint; } }, Object.entries(kinds.kinds).map(([k, v]) => h("option", { value: k }, v.label)));
  const hint = h("p.nb-help", Object.values(kinds.kinds)[0].hint); const ins = h("textarea.nb-textarea", { rows: 4, placeholder: t("job_instructions"), "aria-label": t("job_instructions") }); const list = h("div");
  const run = btn(t("launch"), { ico: "robot", onclick: async () => { if (!progSel.value) return toast(t("no_programs"), "warn"); try { await api.post("api/actions/queue-job", { program_id: Number(progSel.value), kind: kindSel.value, instructions: ins.value }); toast(t("job_queued")); ins.value = ""; draw(); } catch { /* toast */ } } });
  const consoleBtn = btn(t("open_console"), { ico: "send", kind: "secondary", onclick: () => window.parent.postMessage({ type: "collado:open-console" }, location.origin) });
  root.append(pageHead(t("nav_agent"), t("agent_help"), consoleBtn), card(h("div.nb-stack", h("div.nb-row", h("div.nb-grow", h("label.nb-label", entName("programs")), h("div.nb-selectwrap", progSel)), h("div.nb-grow", h("label.nb-label", t("job_kind")), h("div.nb-selectwrap", kindSel))), hint, ins, h("div.nb-row.end", run)), { head: ch("robot", t("new_job")) }), h("div", { style: { marginTop: "24px" } }, list));
  async function draw() { const r = await api.get("api/e/jobs?limit=30&sort=-created"); remember(r.refs); list.replaceChildren(r.rows.length ? h("div.stack", r.rows.map((j) => card(h("div", h("div.nb-row.between", h("b", kinds.kinds[j.kind]?.label || j.kind), statusBadge("jobs", "status", j.status)), h("div.nb-caption", `${refLabel("programs", j.program_id)} · ${j.by} · ${fmt.datetime(j.created)}`), j.error && h("div.nb-alert.nb-alert--error", { style: { marginTop: "8px" } }, j.error), j.document_id && h("div.nb-row", { style: { marginTop: "8px" } }, btn(t("open_document"), { sm: true, onclick: () => go(`#/doc/${j.document_id}`) })), ["queued", "running"].includes(j.status) && btn(t("cancel"), { sm: true, kind: "danger", onclick: async () => { await api.post("api/actions/cancel-job", { id: j.id }); draw(); } }))))) : emptyState(t("empty_list"))); if (r.rows.some((j) => ["queued", "running"].includes(j.status))) setTimeout(() => { if (document.body.contains(list)) draw(); }, 4000); }
  draw();
}
