// Settings: company, finance, alerts, compliance checklists, capabilities, language.
import { h } from "../dom.js";
import { api } from "../api.js";
import { S, t, entName, optLabel, LANGS, setLang } from "../i18n.js";
import { btn, badge, icon, card, pageHead, tabs, toast, ch, kv } from "../ui.js";

const has = (p) => S.me.perms.includes("*") || S.me.perms.includes(p);
const FIELDS = {
  company: [["name", "text"], ["legal_name", "text"], ["vat_id", "text"], ["address", "long"], ["email", "text"], ["phone", "text"], ["web", "text"]],
  finance: [["opening_balance", "num"], ["default_vat", "num"], ["vat_rates", "list"], ["irpf_rates", "list"], ["odoo", "json"]],
  alerts: [["contract_days", "num"], ["right_days", "num"], ["grant_days", "num"], ["overrun_warn", "num"], ["delivery_days", "num"]],
  compliance_checklists: [["*", "json"]],
};
export async function settingsPage(root, m) {
  let tab = m[1] || "company"; const body = h("div");
  const items = [{ id: "company", label: t("set_company"), icon: "building" }, has("fin.view") && { id: "finance", label: t("set_finance"), icon: "euro" }, { id: "alerts", label: t("set_alerts"), icon: "alert" }, { id: "compliance_checklists", label: t("set_compliance"), icon: "shield" }, { id: "prefs", label: t("set_prefs"), icon: "settings" }, { id: "system", label: t("set_system"), icon: "robot" }].filter(Boolean);
  const bar = tabs(items, tab, (x) => { tab = x; history.replaceState(null, "", `#/settings/${x}`); draw(); });
  root.append(pageHead(t("nav_settings")), bar, body);
  async function draw() {
    for (const b of bar.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    if (tab === "prefs") return body.replaceChildren(card([h("label.nb-label", t("language")), h("div.nb-selectwrap", { style: { maxWidth: "260px" } }, h("select.nb-select", { onchange: (e) => setLang(e.target.value) }, Object.entries(LANGS).map(([k, v]) => h("option", { value: k, selected: k === S.lang }, v)))), h("p.nb-help", t("offline_help")), h("p.nb-help", `${S.me.name} · ${S.me.user} · ${S.me.roles.join(", ")}`)]));
    if (tab === "system") { const caps = await api.get("api/docs/capabilities"); return body.replaceChildren(card(kv([[`PDF (${caps.tools.pdf_engine || "WeasyPrint"})`, caps.tools.pdf ? badge("OK", "green") : badge(t("missing"), "red")], ["PNG preview (pdftoppm)", caps.tools.png ? badge("OK", "green") : badge(t("missing"), "orange")], ["SVG → PNG (rsvg-convert)", caps.tools.svg_png ? badge("OK", "green") : badge(t("missing"), "orange")], ["DOCX", badge("OK", "green")], ["XLSX", badge("OK", "green")], ["PPTX (python)", caps.tools.pptx ? badge("OK", "green") : badge(t("missing"), "orange")], [t("formats"), caps.formats.join(", ")]]), { head: ch("robot", t("set_system")) })); }
    const r = await api.get(`api/settings/${tab}`).catch(() => null); if (!r) return body.replaceChildren(h("p", t("forbidden"))); const val = r.value || {}; const inputs = {};
    const fields = FIELDS[tab].map(([k, type]) => { let el, get;
      if (tab === "compliance_checklists") { el = h("textarea.nb-textarea.nb-mono", { rows: 18, spellcheck: "false" }, JSON.stringify(val, null, 2)); get = () => JSON.parse(el.value); inputs["*"] = get; return h("div", h("p.nb-help", t("compliance_help")), el); }
      const v = val[k]; if (type === "num") { el = h("input.nb-input", { type: "number", step: "any", value: v ?? "" }); get = () => (el.value === "" ? 0 : Number(el.value)); }
      else if (type === "long") { el = h("textarea.nb-textarea", {}, v ?? ""); get = () => el.value; } else if (type === "list") { el = h("input.nb-input", { value: (v || []).join(", ") }); get = () => el.value.split(",").map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)); }
      else if (type === "json") { el = h("textarea.nb-textarea.nb-mono", { rows: 6, spellcheck: "false" }, JSON.stringify(v ?? {}, null, 2)); get = () => JSON.parse(el.value || "{}"); } else { el = h("input.nb-input", { value: v ?? "" }); get = () => el.value; }
      inputs[k] = get; return h("div.field", h("label.nb-label", t(`set.${tab}.${k}`)), el, type === "json" && k === "odoo" && h("div.nb-help", t("odoo_help"))); });
    body.replaceChildren(card([h("div.formgrid", h("div.fs", fields)), h("div.nb-row.end", btn(t("save"), { ico: "save", onclick: async () => { try { const out = tab === "compliance_checklists" ? inputs["*"]() : Object.fromEntries(Object.entries(inputs).map(([k, g]) => [k, g()])); await api.put(`api/settings/${tab}`, { value: out }); toast("saved"); } catch (e) { toast(e.message?.includes("JSON") ? t("invalid_json") : e, "error"); } } }))]));
  }
  draw();
}
