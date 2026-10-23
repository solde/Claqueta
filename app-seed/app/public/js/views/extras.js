// Specialised sections of record pages: episode readiness, QC checklist, delivery package, cue sheet export, job output...
import { h } from "../dom.js";
import { api, entityApi, qs } from "../api.js";
import { S, t, entName, fieldLabel, optLabel, fmt } from "../i18n.js";
import { btn, badge, statusBadge, icon, card, toast, ch, emptyState, dropdown, confirmDialog } from "../ui.js";
import { registerDetail } from "../detail.js";
import { openForm, remember } from "../forms.js";
import { go } from "../lists.js";
import { md } from "../md.js";
import { downloadXlsx } from "./finance.js";

const sch = (e) => S.schema.entities[e];

registerDetail("episodes", async (row, refs, { reload }) => {
  const [r, rc] = await Promise.all([api.get(`api/reports/delivery-readiness?episode=${row.id}`, { silent: true }).catch(() => null), api.get(`api/reports/rights-check?episode=${row.id}`, { silent: true }).catch(() => null)]);
  const acts = h("div.nb-row", btn(t("open_rundown"), { ico: "list", onclick: () => go(`#/rundown/${row.id}`) }),
    sch("episodes").canWrite && row.air_date && btn(t("plan_dates"), { ico: "calendar", kind: "secondary", onclick: async () => { await api.post("api/actions/plan-episode", { episode_id: row.id }); toast("saved"); reload(); } }),
    sch("compliance_checks")?.canWrite && btn(t("init_compliance"), { ico: "shield", kind: "secondary", onclick: async () => { const r2 = await api.post("api/actions/init-compliance", { episode_id: row.id }); toast(t("created_n", { n: r2.created })); reload(); } }),
    S.schema.entities.documents && btn(t("generate_doc"), { ico: "doc", kind: "secondary", onclick: async () => (await import("./docs.js")).generateDialog({ program_id: row.program_id, episode_id: row.id }) }));
  const out = [acts];
  if (r) out.push(card([h("div.nb-alert", { class: r.ready ? "nb-alert--ok" : "nb-alert--warn" }, icon(r.ready ? "ok" : "warn"), r.ready ? t("ready_to_deliver") : t("not_ready")), h("ul.alertlist", { style: { marginTop: "12px" } }, r.steps.map((s) => h("li", badge(icon(s.ok ? "ok" : "err"), s.ok ? "green" : "red", "nb-badge--sq"), h("span", t(`ready.${s.key}`)), s.detail !== null && s.detail !== undefined && s.detail !== "" && h("span.nb-caption", Array.isArray(s.detail) ? s.detail.join(", ") : String(s.detail)))))], { head: ch("truck", t("readiness")) }));
  if (rc && (rc.rights.length || rc.music_without_right.length)) out.push(card([h("ul.alertlist", rc.rights.map((x) => h("li", badge(icon(x.state === "ok" ? "ok" : x.state === "warn" ? "warn" : "err"), x.state === "ok" ? "green" : x.state === "warn" ? "orange" : "red", "nb-badge--sq"), h("a", { href: `#/e/rights/${x.id}` }, x.title), h("span.nb-caption", `${x.media} · ${x.territory} · ${x.perpetual ? t("perpetual") : fmt.date(x.window_end)}`), x.why && h("span.nb-caption", t(`why.${x.why}`))))), rc.music_without_right.length ? h("div.nb-alert.nb-alert--warn", { style: { marginTop: "8px" } }, icon("warn"), t("music_without_right", { n: rc.music_without_right.length })) : null], { head: ch("key", entName("rights", true)) }));
  return out;
});

// QC: checklist from the delivery spec, toggled item by item
registerDetail("qc_reports", async (row, refs, { reload }) => {
  if (!row.spec_id) return [];
  const spec = (await entityApi.get("delivery_specs", row.spec_id).catch(() => null))?.row; if (!spec?.checklist?.length) return [];
  const checks = { ...(row.checks || {}) }; const canEdit = sch("qc_reports").canWrite;
  const save = async () => { try { const u = await entityApi.update("qc_reports", row.id, { checks, rev: row.rev }, "qc"); row.rev = u.rev; } catch { reload(); } };
  const cats = [...new Set(spec.checklist.map((c) => c.category))];
  return [card(cats.map((cat) => h("div", h("h4", cat || "—"), spec.checklist.filter((c) => c.category === cat).map((c) => { const cur = checks[c.id] || {}; const sel = h("div.nb-selectwrap", { style: { maxWidth: "110px" } }, h("select.nb-select", { disabled: !canEdit, "aria-label": c.label, onchange: (e) => { checks[c.id] = { ...checks[c.id], ok: e.target.value === "ok" ? true : e.target.value === "fail" ? false : null }; save(); } }, [["", "—"], ["ok", "OK"], ["fail", "KO"], ["na", "N/A"]].map(([v, l]) => h("option", { value: v, selected: (cur.ok === true && v === "ok") || (cur.ok === false && v === "fail") || (cur.ok === null && cur.note === undefined && v === "na" && "ok" in cur) }, l))));
    return h("div.nb-row", { style: { padding: "4px 0", borderBottom: "2px solid var(--nb-ink)" } }, sel, h("span.nb-grow", c.label, c.required && " *"), h("input.nb-input", { style: { maxWidth: "240px", minHeight: "36px", padding: "2px 8px" }, placeholder: t("note"), value: cur.note || "", disabled: !canEdit, onchange: (e) => { checks[c.id] = { ...checks[c.id], note: e.target.value }; save(); } })); }))), { head: ch("check", t("checklist")) })];
});
registerDetail("deliveries", async (row, refs, { reload }) => {
  const out = []; const acts = [];
  if (row.status === "preparing" && sch("deliveries").canWrite) acts.push(btn(t("mark_sent"), { ico: "send", onclick: async () => { await entityApi.update("deliveries", row.id, { status: "sent", rev: row.rev }); toast("saved"); reload(); } }));
  if (row.status === "sent" && sch("deliveries").canWrite) acts.push(btn(t("mark_accepted"), { kind: "green", ico: "ok", onclick: async () => { await entityApi.update("deliveries", row.id, { status: "accepted", rev: row.rev }); reload(); } }), btn(t("mark_rejected"), { kind: "danger", onclick: async () => { await entityApi.update("deliveries", row.id, { status: "rejected", rev: row.rev }); reload(); } }));
  if (acts.length) out.push(h("div.nb-row", acts));
  if (row.manifest_hash) out.push(card([h("div.nb-caption", t("manifest_hash")), h("code", row.manifest_hash), h("ul.alertlist", { style: { marginTop: "8px" } }, (row.items || []).map((i) => h("li", h("span", i.name), h("span.nb-caption", `${i.version || ""} ${i.size_mb ? i.size_mb + " MB" : ""}`), h("code", (i.checksum || "").slice(0, 12)))))], { head: ch("truck", t("package")) }));
  return out;
});
registerDetail("cue_sheets", async (row) => [h("div.nb-row", btn("Excel", { ico: "download", kind: "secondary", onclick: () => downloadXlsx("cue_sheet", { episode: row.episode_id }, `cue-sheet-${row.id}`) }), btn(t("generate_doc"), { ico: "doc", kind: "secondary", onclick: async () => (await import("./docs.js")).generateDialog({ program_id: row.program_id, episode_id: row.episode_id, only: ["cue-sheet"] }) }))]);
registerDetail("jobs", async (row) => (row.output ? [card(h("div.md", { html: md(row.output) }), { head: ch("robot", t("output")) })] : []));
registerDetail("contracts", async (row) => (row.end_date && row.status === "active" ? [] : []));

// ---- brands: logo, fonts and a live sample page ------------------------------------------------------------------------------------------------
registerDetail("brands", async (row, refs, { reload }) => {
  const canEdit = sch("brands").canWrite; const out = [];
  const pick = (accept, onfile) => { const i = h("input", { type: "file", accept, hidden: true, onchange: async () => { const f = i.files[0]; if (f) await onfile(f); } }); return [i, btn(t("upload"), { ico: "upload", sm: true, kind: "secondary", onclick: () => i.click() })]; };
  const upload = async (f) => api.post(`api/files${qs({ entity: "brands", id: row.id, name: f.name })}`, f);
  const logo = row.logo_attachment_id ? h("img.nb-img", { src: `api/files/${row.logo_attachment_id}?inline=1`, alt: "logo", style: { maxHeight: "72px", background: "#fff", padding: "8px" } }) : h("p.nb-help", t("no_logo"));
  const fonts = Array.isArray(row.font_files) ? row.font_files : [];
  out.push(card([h("div.nb-row", logo, canEdit && pick("image/png,image/jpeg,image/svg+xml", async (f) => { const a = await upload(f); await entityApi.update("brands", row.id, { logo_attachment_id: a.id, rev: row.rev }); toast("saved"); reload(); })),
    h("h4", { style: { marginTop: "16px" } }, fieldLabel("brands", "font_files")), fonts.length ? h("ul.alertlist", fonts.map((f, i) => h("li", h("b", f.family), h("span.nb-caption", `${f.weight} ${f.style}`), canEdit && btn("", { ico: "trash", sm: true, kind: "danger", onclick: async () => { await entityApi.update("brands", row.id, { font_files: fonts.filter((_, j) => j !== i), rev: row.rev }); reload(); } })))) : h("p.nb-help", t("no_fonts")),
    canEdit && h("div.nb-row", ...pick(".ttf,.otf,.woff,.woff2", async (f) => { const family = prompt(t("font_family"), f.name.replace(/\.\w+$/, "")); if (!family) return; const weight = Number(prompt(t("font_weight"), "400")) || 400; const a = await upload(f); await entityApi.update("brands", row.id, { font_files: [...fonts, { family, weight, style: "normal", attachment_id: a.id }], rev: row.rev }); toast("saved"); reload(); }), h("span.nb-help", t("fonts_help")))], { head: ch("palette", t("brand_assets")) }));
  const frame = h("iframe", { title: t("preview"), sandbox: "", style: { width: "100%", height: "520px", border: "3px solid var(--nb-ink)", background: "#d9dde3" } });
  const sample = "---\ntitle: Título del documento\nsubtitle: Subtítulo de ejemplo\ncover: yes\n---\n:::toc depth=2:::\n\n## Sección uno\nTexto de ejemplo con **negrita**, *cursiva* y un [enlace](https://example.org).\n\n- Punto uno\n- Punto dos\n\n| Concepto | Importe |\n|:--|--:|\n| Cámara | 1.200,00 € |\n| Sonido | 800,00 € |\n\n:::callout kind=warn title=\"Aviso\"\nTexto destacado.\n:::\n\n## Sección dos\nMás texto para ver el ritmo de la página.\n";
  api.raw("POST", "api/docs/preview", { markdown: sample, brand_id: row.id, lang: S.lang }).then((r) => r.text()).then((html) => { frame.srcdoc = html; }).catch(() => {});
  out.push(card(frame, { head: ch("eye", t("preview")) }));
  return out;
});
registerDetail("doc_templates", async (row) => (sch("documents")?.canWrite ? [h("div.nb-row", btn(t("generate_doc"), { ico: "doc", onclick: async () => (await import("./docs.js")).generateDialog({ only: [row.id] }) }))] : []));
