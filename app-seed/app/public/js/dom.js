// Hyperscript helper: h("div.class#id", { onclick, style: {...}, dataset: {...} }, child, [children], "text").
const SVG_NS = "http://www.w3.org/2000/svg";
export function h(tag, props, ...kids) {
  if (props instanceof Node || typeof props === "string" || Array.isArray(props) || typeof props === "number") { kids.unshift(props); props = null; }
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag) || [null, tag, ""];
  const svg = ["svg", "path", "g", "circle", "rect", "line", "polyline", "text", "polygon"].includes(m[1]);
  const el = svg ? document.createElementNS(SVG_NS, m[1]) : document.createElement(m[1]);
  for (const part of m[2].match(/[.#][\w-]+/g) || []) { if (part[0] === "#") el.id = part.slice(1); else el.classList.add(part.slice(1)); }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") { for (const c of [].concat(v).flat().filter(Boolean)) for (const x of String(c).split(/\s+/).filter(Boolean)) el.classList.add(x); }
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (["value", "checked", "disabled", "hidden", "selected", "readOnly", "required", "multiple"].includes(k) && !svg) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids); return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) { if (k === null || k === undefined || k === false || k === true) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function download(name, blob) { const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
