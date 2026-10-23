// Graphic generator: pick a type, fill in its few fields (or the full JSON), preview it with the brand kit and either store it in the gallery or use it live in a section.
import { h } from "../dom.js";
import { api } from "../api.js";
import { t } from "../i18n.js";
import { btn, modal, toast, selectWrap } from "../ui.js";

const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("|").map((x) => x.trim()));
const numv = (v) => (v === "" || v === undefined ? undefined : Number(String(v).replace(",", ".")));
const FORMS = {
  stats: { fields: [["title", "text"], ["auto", "check", true], ["extra", "long", "gr_ph_stats"]], build: (v, pid) => ({ type: "stats", title: v.title, auto: v.auto ? 1 : 0, program: pid, stats: lines(v.extra).map(([value, label]) => ({ value, label })) }) },
  kpi_bars: { fields: [["title", "text"], ["items", "long", "gr_ph_kpi"]], build: (v) => ({ type: "kpi_bars", title: v.title, items: lines(v.items).map(([label, target, achieved, unit]) => ({ label, target: numv(target), achieved: numv(achieved), unit })) }) },
  timeline: { fields: [["title", "text"], ["source", "select", ["milestones", "episodes", "manual"]], ["items", "long", "gr_ph_timeline"]], build: (v, pid) => (v.source === "manual" ? { type: "timeline", title: v.title, items: lines(v.items).map(([date, label]) => ({ date, label })) } : { type: "timeline", title: v.title, source: v.source, program: pid }) },
  orgchart: { fields: [["title", "text"]], build: (v, pid) => ({ type: "orgchart", title: v.title, source: "crew", program: pid }) },
  locations_map: { fields: [["title", "text"]], build: (v, pid) => ({ type: "locations_map", title: v.title, source: "locations", program: pid }) },
  quote: { fields: [["text", "long"], ["person", "text"], ["role", "text"]], build: (v) => ({ type: "quote", text: v.text, person: v.person, role: v.role }) },
  divider: { fields: [["title", "text"], ["subtitle", "text"], ["number", "text"]], build: (v) => ({ type: "divider", title: v.title, subtitle: v.subtitle, number: v.number === "" ? undefined : Number(v.number) }) },
  cover_art: { fields: [["title", "text"], ["subtitle", "text"], ["footer", "text"]], build: (v) => ({ type: "cover_art", title: v.title, subtitle: v.subtitle, footer: v.footer }) },
  chart: { fields: [["title", "text"], ["chart_type", "select", ["bar", "hbar", "line", "area", "donut", "waterfall", "heatmap"]], ["data", "long", "gr_ph_chart"]], build: (v) => ({ type: "chart", chart_type: v.chart_type, title: v.title, data: { rows: lines(v.data).map(([label, value, kind]) => ({ label, value: numv(value), ...(kind === "total" ? { kind: "total" } : {}) })) } }) },
};
const LABEL = { title: "gr_title", subtitle: "gr_subtitle", auto: "gr_auto", extra: "gr_extra", items: "gr_items", source: "gr_source", text: "gr_text", person: "gr_person", role: "gr_role", number: "gr_number", footer: "gr_footer", chart_type: "gr_chart_type", data: "gr_data" };

/** opts: { program_id (data of the project), onSaved(row) (offers to store it in the gallery), onUse(spec) (offers to add it live to a section), type } */
export async function openGraphicDialog({ program_id, onSaved, onUse, type = "stats" } = {}) {
  const { types } = await api.get("api/graphics/types"); const byType = Object.fromEntries(types.map((x) => [x.type, x]));
  let cur = FORMS[type] ? type : "stats"; const vals = {}, preview = h("div.gr__preview", h("p.nb-help", t("gr_preview_help"))), formBox = h("div.nb-stack"), json = h("textarea.nb-textarea.nb-mono", { rows: 8, spellcheck: "false", "aria-label": "JSON" }), titleIn = h("input.nb-input", { placeholder: t("gr_gallery_title") }), capIn = h("input.nb-input", { placeholder: t("gr_gallery_caption") });
  const typeSel = h("select.nb-select", { "aria-label": t("gr_type"), onchange: () => { cur = typeSel.value; draw(); } }, Object.keys(FORMS).filter((k) => byType[k]).map((k) => h("option", { value: k, selected: k === cur }, t(`gr_type_${k}`))));
  const specOf = () => { if (json.dataset.edited === "1") { try { return JSON.parse(json.value); } catch { toast(t("gr_bad_json"), "error"); return null; } } return FORMS[cur].build(vals[cur] || {}, program_id); };
  function draw() {
    vals[cur] ||= Object.fromEntries(FORMS[cur].fields.filter(([, k, d]) => k === "check").map(([n, , d]) => [n, d]));
    formBox.replaceChildren(h("p.nb-help", t(`gr_type_${cur}_help`)), ...FORMS[cur].fields.map(([name, kind, extra]) => {
      const v = vals[cur];
      const input = kind === "long" ? h("textarea.nb-textarea", { rows: 5, placeholder: typeof extra === "string" ? t(extra) : "", oninput: (e) => { v[name] = e.target.value; refreshJson(); } }, v[name] ?? "")
        : kind === "check" ? h("label.nb-check", h("input", { type: "checkbox", checked: !!v[name], onchange: (e) => { v[name] = e.target.checked; refreshJson(); } }), t(LABEL[name]))
        : kind === "select" ? selectWrap(h("select.nb-select", { onchange: (e) => { v[name] = e.target.value; refreshJson(); } }, extra.map((o) => h("option", { value: o, selected: (v[name] ?? extra[0]) === o }, o))))
        : h("input.nb-input", { value: v[name] ?? "", oninput: (e) => { v[name] = e.target.value; refreshJson(); } });
      if (kind === "select" && v[name] === undefined) v[name] = extra[0];
      return kind === "check" ? input : h("label", h("span.nb-caption", t(LABEL[name] || name)), input);
    }));
    json.dataset.edited = "0"; refreshJson();
  }
  function refreshJson() { if (json.dataset.edited !== "1") json.value = JSON.stringify(FORMS[cur].build(vals[cur] || {}, program_id), null, 1); }
  json.addEventListener("input", () => { json.dataset.edited = "1"; });
  async function render() {
    const spec = specOf(); if (!spec) return null;
    try { const g = await api.post("api/graphics/render", { spec }); preview.replaceChildren(h("img", { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(g.svg)}`, alt: g.title || "", style: { maxWidth: "100%", border: "1px solid var(--nb-line, #ccc)", borderRadius: "10px" } })); return spec; }
    catch (e) { preview.replaceChildren(h("p.nb-error", e.code === "graphic_no_data" ? t("gr_no_data") : t(e.code || "internal_error"))); return null; }
  }
  const adv = h("details", h("summary", t("gr_advanced")), json);
  const m = modal({ title: t("gr_title_dialog"), wide: true, body: h("div.gr", h("div.gr__form", h("label", h("span.nb-caption", t("gr_type")), selectWrap(typeSel)), formBox, adv, onSaved && h("div.nb-stack", { style: { marginTop: "10px" } }, titleIn, capIn)), preview),
    actions: [btn(t("close"), { kind: "secondary", onclick: () => m.close() }), btn(t("gr_preview"), { ico: "eye", kind: "secondary", onclick: render }),
      onUse && btn(t("gr_use_in_section"), { ico: "plus", kind: "secondary", onclick: async () => { const spec = specOf(); if (!spec) return; if (await render()) { onUse(spec); m.close(); } } }),
      onSaved && btn(t("gr_save_gallery"), { ico: "image", onclick: async () => { const spec = specOf(); if (!spec) return; try { const row = await api.post("api/graphics/save", { program_id, spec, title: titleIn.value || spec.title || byType[cur].label, caption: capIn.value }); toast(t("gr_saved")); onSaved?.(row); m.close(); } catch (e) { if (e.code === "graphic_no_data") toast(t("gr_no_data"), "warn"); } } })] });
  draw(); render();
  return m;
}
