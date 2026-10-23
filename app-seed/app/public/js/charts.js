// Small SVG charts in the neobrutalism palette (CSS variables, thick strokes, no gradients). Return DOM nodes.
import { h } from "./dom.js";
import { fmt } from "./i18n.js";

const PAL = ["var(--nb-accent)", "var(--nb-blue)", "var(--nb-yellow)", "var(--nb-green)", "var(--nb-pink)", "var(--nb-orange)", "var(--nb-purple)"];
const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v); for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(k)); return el; };
const nice = (max) => { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const short = (v, money) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + "k" : String(Math.round(v)));

/** rows: [{label, values: [n,...]}], series: [name,...] -> grouped bars (or lines when type="line"). */
export function barChart({ rows, series = [""], type = "bar", height = 240, width = 640, money = false, colors = PAL }) {
  const W = width, H = height, L = 52, B = 34, T = 12, R = 8; const vals = rows.flatMap((r) => r.values); const max = nice(Math.max(...vals, 1)), min = Math.min(0, ...vals) < 0 ? -nice(-Math.min(...vals)) : 0;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", preserveAspectRatio: "xMidYMid meet" }); const sy = (v) => T + (H - T - B) * (1 - (v - min) / (max - min)); const step = (W - L - R) / Math.max(1, rows.length);
  for (let i = 0; i <= 4; i++) { const v = min + ((max - min) * i) / 4, y = sy(v); svg.append(s("line", { x1: L, x2: W - R, y1: y, y2: y, style: "stroke:var(--nb-ink);stroke-width:1;opacity:.25" }), s("text", { x: L - 6, y: y + 4, "text-anchor": "end", "font-size": 10 }, short(v, money))); }
  svg.append(s("line", { x1: L, x2: W - R, y1: sy(0), y2: sy(0), style: "stroke:var(--nb-ink);stroke-width:3" }));
  const n = series.length, bw = Math.min(40, (step * 0.8) / n);
  rows.forEach((r, i) => {
    if (type === "line") return; r.values.forEach((v, j) => { const x = L + step * i + (step - bw * n) / 2 + bw * j, y0 = sy(Math.max(0, v)), y1 = sy(Math.min(0, v)); svg.append(s("rect", { x, y: Math.min(y0, y1), width: bw - 2, height: Math.max(2, Math.abs(y1 - y0)), style: `fill:${colors[j % colors.length]};stroke:var(--nb-ink);stroke-width:2` }, s("title", {}, `${r.label}${series[j] ? " · " + series[j] : ""}: ${money ? fmt.money(v) : fmt.num(v, 1)}`))); });
  });
  if (type === "line") series.forEach((nm, j) => { const pts = rows.map((r, i) => [L + step * (i + 0.5), sy(r.values[j])]); svg.append(s("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", style: `stroke:var(--nb-ink);stroke-width:5` }), s("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", style: `stroke:${colors[j % colors.length]};stroke-width:3` }), ...pts.map((p, i) => s("circle", { cx: p[0], cy: p[1], r: 5, style: `fill:${colors[j % colors.length]};stroke:var(--nb-ink);stroke-width:2` }, s("title", {}, `${rows[i].label}: ${money ? fmt.money(rows[i].values[j]) : fmt.num(rows[i].values[j], 1)}`)))); });
  const every = Math.ceil(rows.length / Math.max(1, Math.floor((W - L) / 60))); rows.forEach((r, i) => { if (i % every === 0) svg.append(s("text", { x: L + step * (i + 0.5), y: H - 12, "text-anchor": "middle", "font-size": 10 }, r.label)); });
  const legend = series.length > 1 || series[0] ? h("div.legend", series.map((nm, j) => h("span", h("i", { style: { background: colors[j % colors.length] } }), nm))) : null;
  return h("div", svg, legend);
}
/** Donut chart (SVG) with a legend: items [{ label, value, color? }] and an optional centre text. */
export function donut({ items, size = 180, center }) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1; const R = size / 2 - 6, r0 = R * 0.55, c = size / 2; let a0 = -Math.PI / 2; const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "chart", role: "img" });
  items.forEach((it, i) => { if (!it.value) return; const a1 = a0 + (it.value / total) * Math.PI * 2 - 0.0001; const big = a1 - a0 > Math.PI ? 1 : 0; const p = (a, r) => `${c + Math.cos(a) * r},${c + Math.sin(a) * r}`;
    svg.append(s("path", { d: `M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r0)} A${r0},${r0} 0 ${big} 0 ${p(a0, r0)} Z`, style: `fill:${it.color || PAL[i % PAL.length]};stroke:var(--nb-ink);stroke-width:3` }, s("title", {}, `${it.label}: ${it.value}`))); a0 += (it.value / total) * Math.PI * 2; });
  if (center !== undefined) svg.append(s("text", { x: c, y: c + 7, "text-anchor": "middle", "font-size": 22, "font-weight": 700 }, center));
  return h("div.nb-row", { style: { flexWrap: "nowrap" } }, svg, h("div.legend", { style: { flexDirection: "column" } }, items.map((it, i) => h("span", h("i", { style: { background: it.color || PAL[i % PAL.length] } }), `${it.label} · ${it.value}`))));
}
/** Horizontal progress-style bars: items [{ label, value, color? }] scaled to the largest (or `max`). */
export function hbars({ items, money = false, max }) {
  const m = max || Math.max(...items.map((i) => i.value), 1);
  return h("div", items.map((it) => h("div.bar-row", h("span", { title: it.label }, it.label), h("div.nb-progress", h("i", { style: { width: Math.max(2, (it.value / m) * 100) + "%", background: it.color || "var(--nb-blue)" } })), h("b.nb-mono", money ? fmt.money(it.value) : fmt.num(it.value, 1)))));
}
export { PAL };
