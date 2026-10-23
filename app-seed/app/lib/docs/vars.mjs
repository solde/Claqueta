// Template variables: {{path.to.value | filter:arg | filter}}, {{#if cond}}..{{else}}..{{/if}}, {{#each list}}..{{this.x}} {{@index}}..{{/each}}.
// Substituted text is Markdown-escaped unless the `md` filter is used (then it is inserted as Markdown on purpose).
import { money, num, pct, date, datetime, duration, mdEscape } from "./format.mjs";

const get = (obj, path) => { let v = obj; for (const k of String(path).trim().split(".")) { if (v == null) return undefined; v = v[k]; } return v; };
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v && v !== "0");
function splitTop(s, sep) { const out = []; let cur = "", q = null; for (const ch of s) { if (q) { cur += ch; if (ch === q) q = null; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === sep) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; }
const unq = (s) => { s = String(s ?? "").trim(); return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s; };

/** Applies the filters of a `{{value | filter:arg}}` expression (money, num, pct, date, duration, upper, lower, title, default, join, label, nl2br, md); `md` marks the result as intentional Markdown. */
export function applyFilters(val, filters, env) {
  let v = val, md = false;
  for (const f of filters) {
    const [name, ...rest] = splitTop(f.trim(), ":"); const arg = unq(rest.join(":"));
    switch (name.trim()) {
      case "money": v = money(v, env.lang, arg || env.currency || "EUR"); break;
      case "num": v = num(v, env.lang, arg === "" ? 0 : Number(arg)); break;
      case "pct": v = pct(v, env.lang, arg === "" ? 1 : Number(arg)); break;
      case "date": v = date(v, env.lang, arg || "medium"); break;
      case "datetime": v = datetime(v, env.lang); break;
      case "duration": v = duration(v); break;
      case "upper": v = String(v ?? "").toUpperCase(); break;
      case "lower": v = String(v ?? "").toLowerCase(); break;
      case "title": v = String(v ?? "").replace(/\b\p{L}/gu, (c) => c.toUpperCase()); break;
      case "default": if (v == null || v === "") v = arg; break;
      case "join": v = Array.isArray(v) ? v.join(arg || ", ") : v; break;
      case "label": v = env.label ? env.label(arg, v) : v; break;
      case "nl2br": v = String(v ?? "").replace(/\r?\n/g, "  \n"); md = true; break;
      case "md": md = true; break;
      default: break;
    }
  }
  return { v, md };
}

/** Returns { text, missing: [paths that resolved to undefined] }. */
export function expand(src, data, env = {}) {
  const missing = new Set();
  const render = (text, scope) => {
    let out = "", i = 0;
    while (i < text.length) {
      const a = text.indexOf("{{", i); if (a < 0) { out += text.slice(i); break; }
      out += text.slice(i, a);
      const b = text.indexOf("}}", a); if (b < 0) { out += text.slice(a); break; }
      const tag = text.slice(a + 2, b).trim(); i = b + 2;
      if (tag.startsWith("#if ") || tag.startsWith("#each ")) {
        const kind = tag.startsWith("#if ") ? "if" : "each"; const body = findClose(text, i, kind); if (!body) { out += `{{${tag}}}`; continue; }
        const inner = text.slice(i, body.start); i = body.end;
        if (kind === "if") { const [thenPart, elsePart = ""] = splitElse(inner); const cond = lookup(tag.slice(4), scope); out += render(truthy(cond) ? thenPart : elsePart, scope); }
        else { const list = lookup(tag.slice(6), scope); if (Array.isArray(list)) list.forEach((item, idx) => { out += render(inner, { ...scope, this: item, "@index": idx, "@number": idx + 1 }); }); }
        continue;
      }
      if (tag.startsWith("/") || tag === "else") { continue; }
      const parts = splitTop(tag, "|"); const path = parts[0].trim(); const val = lookup(path, scope);
      if (val === undefined && !path.startsWith("@")) missing.add(path);
      const { v, md } = applyFilters(val, parts.slice(1), env);
      out += v == null ? "" : md ? String(v) : mdEscape(typeof v === "object" ? JSON.stringify(v) : v);
    }
    return out;
  };
  const lookup = (path, scope) => { const p = path.trim(); if (p.startsWith("@")) return scope[p]; if (p === "this") return scope.this; const first = p.split(".")[0]; return get(first === "this" ? scope : scope, p); };
  return { text: render(String(src ?? ""), { ...data }), missing: [...missing] };
}
function findClose(text, from, kind) {
  const open = new RegExp(`\\{\\{#${kind}[ }]`, "g"), close = `{{/${kind}}}`; let depth = 1, pos = from;
  for (;;) {
    const c = text.indexOf(close, pos); if (c < 0) return null;
    open.lastIndex = pos; const o = open.exec(text);
    if (o && o.index < c) { depth++; pos = o.index + 2; continue; }
    depth--; if (depth === 0) return { start: c, end: c + close.length }; pos = c + close.length;
  }
}
function splitElse(inner) { let depth = 0; const re = /\{\{(#if |#each |\/if|\/each|else)/g; let m; while ((m = re.exec(inner))) { if (m[1] === "#if " || m[1] === "#each ") depth++; else if (m[1] === "/if" || m[1] === "/each") depth--; else if (m[1] === "else" && depth === 0) return [inner.slice(0, m.index), inner.slice(m.index + 8)]; } return [inner]; }
