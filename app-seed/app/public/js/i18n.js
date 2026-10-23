// Client i18n: dictionary comes from the server (api/i18n/<lang>), so the UI, the documents and the exports speak with the same labels.
import { api } from "./api.js";
/** Client state: language, the dictionaries served by the server, the schema and the current user. */
export const S = { lang: "es", d: { e: {}, g: {}, f: {}, fe: {}, o: {}, oe: {}, ui: {}, msg: {} }, schema: null, me: null };
/** Supported languages by name. */
export const LANGS = { es: "Castellano", ca: "Català", en: "English" };
const pickLang = () => { try { const s = localStorage.getItem("collado.lang"); if (s && LANGS[s]) return s; } catch { /* storage blocked */ } const n = (navigator.language || "es").slice(0, 2); return LANGS[n] ? n : "es"; };
/** Loads the dictionary of a language (the saved or browser one) from the server. */
export async function loadI18n(lang = pickLang()) { S.d = await api.get(`api/i18n/${lang}`, { silent: true }); S.lang = S.d.lang; document.documentElement.lang = S.lang; return S.lang; }
/** Saves the language and reloads. */
export function setLang(lang) { try { localStorage.setItem("collado.lang", lang); } catch { /* ignore */ } location.reload(); }

/** UI text by key with {params}; the key itself when it is missing. */
export const t = (key, params) => { let v = S.d.ui[key]; if (v === undefined) v = key; if (params) for (const [k, x] of Object.entries(params)) v = v.replace(new RegExp(`\\{${k}\\}`, "g"), x); return v; };
/** Name of an entity (singular or plural). */
export const entName = (e, plural = false) => { const v = S.d.e[e] || e; const [s, p] = v.split("|"); return plural ? (p || s) : s; };
/** Label of a field of an entity. */
export const fieldLabel = (entity, field) => {
  const d = S.d; const v = d.fe[`${entity}.${field}`] ?? d.f[field]; if (v) return v;
  const fd = S.schema?.entities?.[entity]?.fields?.[field]; if (fd?.type === "ref") return entName(fd.to); return field;
};
/** Label of an enum option. */
export const optLabel = (entity, field, value) => { if (value === null || value === undefined || value === "") return ""; const d = S.d, v = String(value); return d.oe[`${entity}.${field}.${v}`] ?? d.oe[`${field}.${v}`] ?? d.o[v] ?? v; };
/** Label of a menu group. */
export const groupLabel = (g) => S.d.g[g] || g;
/** Readable message for an API error (its code translated, with the field). */
export function errText(err) {
  const code = err?.code || String(err?.message || err); const [base, arg] = code.split(":");
  const m = S.d.msg[base]; if (!m) return code;
  const field = arg ? (arg.includes(".") ? arg : fieldLabel("", arg)) : "";
  return m.replace("{field}", field).replace("{arg}", arg || "");
}

const LOC = { es: "es-ES", ca: "ca-ES", en: "en-GB" };
const nf = (o) => new Intl.NumberFormat(LOC[S.lang], { useGrouping: "always", ...o });
/** Locale-aware formatters: money, num, pct, date, datetime, month, duration, weekday. */
export const fmt = {
  money: (v, cur = "EUR") => (v === null || v === undefined || v === "" ? "" : nf({ style: "currency", currency: cur }).format(Number(v))),
  num: (v, d = 0) => (v === null || v === undefined || v === "" ? "" : nf({ maximumFractionDigits: d, minimumFractionDigits: d }).format(Number(v))),
  pct: (v, d = 1) => (v === null || v === undefined || v === "" ? "" : nf({ maximumFractionDigits: d, minimumFractionDigits: d }).format(Number(v)) + " %"),
  date: (v) => { if (!v) return ""; const s = String(v); const d = new Date(s.length === 10 ? s + "T00:00:00Z" : s); return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat(LOC[S.lang], { dateStyle: "medium", timeZone: s.length === 10 ? "UTC" : undefined }).format(d); },
  datetime: (v) => { if (!v) return ""; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat(LOC[S.lang], { dateStyle: "medium", timeStyle: "short" }).format(d); },
  dateShort: (v) => { if (!v) return ""; const d = new Date(String(v).slice(0, 10) + "T00:00:00Z"); return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat(LOC[S.lang], { day: "numeric", month: "short", timeZone: "UTC" }).format(d); },
  month: (v) => new Intl.DateTimeFormat(LOC[S.lang], { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(v + "-01T00:00:00Z")),
  duration: (sec) => { sec = Math.round(Number(sec) || 0); const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (hh ? hh + ":" : "") + String(m).padStart(hh ? 2 : 1, "0") + ":" + String(s).padStart(2, "0"); },
  weekday: (v) => new Intl.DateTimeFormat(LOC[S.lang], { weekday: "short", timeZone: "UTC" }).format(new Date(String(v).slice(0, 10) + "T00:00:00Z")),
};
/** "1:30" / "90" / "01:30:00" -> seconds (inputs for durations). */
export function parseDuration(s) { s = String(s ?? "").trim(); if (!s) return 0; if (/^\d+$/.test(s)) return Number(s); const p = s.split(":").map(Number); if (p.some(Number.isNaN)) return 0; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0); }
