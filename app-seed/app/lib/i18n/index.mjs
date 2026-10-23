// Label resolution shared by the server (documents, exports) and the client (served as JSON by /api/i18n/:lang).
import es from "./es.mjs";
import ca from "./ca.mjs";
import en from "./en.mjs";
import uiEs from "./ui.es.mjs";
import uiCa from "./ui.ca.mjs";
import uiEn from "./ui.en.mjs";
import { ENTITIES } from "../schema.mjs";

/** Dictionaries by language: entity, group, field, option and UI labels merged from es/ca/en and ui.*.mjs. */
export const DICTS = { es: { ...es, ...uiEs }, ca: { ...ca, ...uiCa }, en: { ...en, ...uiEn } };
/** Supported languages. */
export const LANGS = Object.keys(DICTS);
const ES = DICTS.es;
/** Language code to a supported one (default es). */
export const normLang = (l) => (DICTS[String(l || "").slice(0, 2)] ? String(l).slice(0, 2) : "es");

/** Singular or plural name of an entity in a language. */
export function entityName(lang, entity, plural = false) {
  const d = DICTS[normLang(lang)]; const v = d.e[entity] || ES.e[entity] || entity; const [s, p] = v.split("|"); return plural ? (p || s) : s;
}
/** Label of a field (entity-specific, then generic, then the referenced entity's name). */
export function fieldLabel(lang, entity, field) {
  const d = DICTS[normLang(lang)];
  const direct = d.fe?.[`${entity}.${field}`] ?? d.f[field] ?? ES.fe?.[`${entity}.${field}`] ?? ES.f[field];
  if (direct) return direct;
  const fd = ENTITIES[entity]?.fields[field];
  if (fd?.type === "ref") return entityName(lang, fd.to);
  return field;
}
/** Label of an enum option, from the most specific override down to the generic one. */
export function optionLabel(lang, entity, field, value) {
  if (value === null || value === undefined || value === "") return "";
  const d = DICTS[normLang(lang)], v = String(value);
  return d.oe?.[`${entity}.${field}.${v}`] ?? d.oe?.[`${field}.${v}`] ?? d.o[v] ?? ES.oe?.[`${entity}.${field}.${v}`] ?? ES.oe?.[`${field}.${v}`] ?? ES.o[v] ?? v;
}
/** Label of a compliance checklist item. */
export const ciLabel = (lang, key) => DICTS[normLang(lang)].ci?.[key] ?? ES.ci?.[key] ?? key;
/** Plain-object dictionary for the client with the fallback to Spanish already applied. */
export function clientDict(lang) {
  const l = normLang(lang), d = DICTS[l];
  return { lang: l, e: { ...ES.e, ...d.e }, g: { ...ES.g, ...d.g }, f: { ...ES.f, ...d.f }, fe: { ...ES.fe, ...d.fe }, o: { ...ES.o, ...d.o }, oe: { ...ES.oe, ...d.oe }, ui: { ...ES.ui, ...d.ui }, msg: { ...ES.msg, ...d.msg }, ci: { ...ES.ci, ...d.ci } };
}
