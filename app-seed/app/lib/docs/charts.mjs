// Minimal SVG charts (bar, hbar, line, donut, gantt) drawn from dataset rows. Pure strings: they work in HTML, PDF (WeasyPrint) and, rasterised, in DOCX/PPTX.
import { esc, num as fnum, money as fmoney, date as fdate } from "./format.mjs";

export function palette(brand) {
  const base = [brand?.primary || "#1f3a5f", brand?.accent || "#e0a100", "#2f9e73", "#d1495b", "#6c5ce7", "#00a6c0", "#f28f3b", "#7a8793"];
  return base;
}
const nice = (max) => { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const fmt = (v, type, lang) => (type === "money" ? fmoney(v, lang).replace(/\s?€|,00/g, "") : type === "pct" ? fnum(v, lang, 1) + "%" : fnum(v, lang, Math.abs(v) < 10 && v % 1 ? 1 : 0));
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

export function chartSvg(spec, ds, brand, lang = "es") {
  const W = Number(spec.width) || 720, H = Number(spec.height) || 320, pal = palette(brand);
  const type = spec.type || "bar"; const xKey = spec.x || ds.columns[0]?.key; const ys = String(spec.y || ds.columns.slice(1).filter((c) => ["money", "num", "pct"].includes(c.type)).map((c) => c.key).join(",")).split(",").filter(Boolean);
  const cols = Object.fromEntries(ds.columns.map((c) => [c.key, c])); const rows = ds.rows.filter((r) => !r._bold || type !== "bar" || true);
  const ytype = cols[ys[0]]?.type || "num"; const title = spec.title === true ? ds.title : (typeof spec.title === "string" ? spec.title : "");
  const ink = brand?.text_color || "#1c1f24", muted = brand?.muted || "#6b7280", grid = "#d9dde3";
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" font-family="inherit" font-size="11">`;
  if (!rows.length) return head + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${muted}">—</text></svg>`;
  const top = title ? 34 : 14; const t = title ? `<text x="0" y="18" font-size="14" font-weight="700" fill="${ink}">${esc(title)}</text>` : "";
  const legend = (items, y) => { let x = 0; return items.map((n, i) => { const w = 18 + n.length * 6.2 + 14; const g = `<g transform="translate(${x},${y})"><rect width="11" height="11" fill="${pal[i % pal.length]}"/><text x="16" y="10" fill="${ink}">${esc(n)}</text></g>`; x += w; return g; }).join(""); };

  if (type === "donut" || type === "pie") {
    const vals = rows.map((r) => Math.max(0, Number(r[ys[0]]) || 0)), total = vals.reduce((a, b) => a + b, 0) || 1; const cx = 150, cy = (H + top) / 2, R = Math.min(110, (H - top) / 2 - 6), r0 = type === "donut" ? R * 0.58 : 0;
    let a0 = -Math.PI / 2; let paths = "";
    vals.forEach((v, i) => { const a1 = a0 + (v / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0; const p = (a, r) => `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
      if (v > 0) paths += `<path d="M${p(a0, R)} A${R},${R} 0 ${big} 1 ${p(a1 - 0.0001, R)} ${r0 ? `L${p(a1 - 0.0001, r0)} A${r0},${r0} 0 ${big} 0 ${p(a0, r0)}` : `L${cx},${cy}`} Z" fill="${pal[i % pal.length]}" stroke="#fff" stroke-width="1.5"/>`; a0 = a1; });
    const items = rows.map((r, i) => `<g transform="translate(300,${top + 10 + i * 20})"><rect width="11" height="11" fill="${pal[i % pal.length]}"/><text x="18" y="10" fill="${ink}">${esc(trunc(r[xKey], 34))} — ${fmt(vals[i], ytype, lang)} (${Math.round((vals[i] / total) * 100)}%)</text></g>`).join("");
    return head + t + paths + (r0 ? `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="18" font-weight="700" fill="${ink}">${fmt(total, ytype, lang)}</text>` : "") + items + "</svg>";
  }
  if (type === "gantt") {
    const tasks = rows.filter((r) => r.start); const min = tasks.reduce((a, r) => (r.start < a ? r.start : a), tasks[0].start), max = tasks.reduce((a, r) => ((r.end || r.start) > a ? (r.end || r.start) : a), tasks[0].end || tasks[0].start);
    const span = Math.max(1, (Date.parse(max) - Date.parse(min)) / 864e5 + 1), left = 190, rowH = Math.min(26, (H - top - 20) / tasks.length), sx = (d) => left + ((Date.parse(d) - Date.parse(min)) / 864e5 / span) * (W - left - 8);
    const bars = tasks.map((r, i) => { const y = top + 16 + i * rowH, x0 = sx(r.start), x1 = Math.max(x0 + 4, sx(r.end || r.start) + (W - left - 8) / span); return `<text x="0" y="${y + rowH * 0.62}" fill="${ink}">${esc(trunc(r[xKey || "title"], 30))}</text><rect x="${x0}" y="${y + 2}" width="${x1 - x0}" height="${rowH - 6}" fill="${r.critical ? pal[3] : pal[0]}"/>`; }).join("");
    return head + t + `<text x="${left}" y="${top + 8}" fill="${muted}">${esc(fdate(min, lang))}</text><text x="${W - 8}" y="${top + 8}" text-anchor="end" fill="${muted}">${esc(fdate(max, lang))}</text>` + bars + "</svg>";
  }
  const hbar = type === "hbar";
  const vals = rows.map((r) => ys.map((k) => Number(r[k]) || 0)); const stacked = spec.stacked === true || spec.stacked === "1";
  const max = nice(Math.max(...vals.map((v) => (stacked ? v.reduce((a, b) => a + b, 0) : Math.max(...v))), 0.0001)), min0 = Math.min(0, ...vals.flat()); const min = min0 < 0 ? -nice(-min0) : 0;
  if (hbar) {
    const left = 150, rowH = (H - top - 24) / rows.length, sx = (v) => left + ((v - min) / (max - min)) * (W - left - 60); const bh = Math.min(22, (rowH - 6) / ys.length);
    let g = ""; rows.forEach((r, i) => { const y = top + i * rowH; g += `<text x="${left - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" fill="${ink}">${esc(trunc(r[xKey], 24))}</text>`;
      ys.forEach((k, j) => { const v = vals[i][j], x0 = sx(Math.min(0, v)), x1 = sx(Math.max(0, v)); g += `<rect x="${x0}" y="${y + 3 + j * bh}" width="${Math.max(1, x1 - x0)}" height="${bh - 2}" fill="${pal[j % pal.length]}"/><text x="${x1 + 4}" y="${y + 3 + j * bh + bh * 0.7}" fill="${muted}">${fmt(v, ytype, lang)}</text>`; }); });
    return head + t + g + (ys.length > 1 ? legend(ys.map((k) => cols[k]?.label || k), H - 14) : "") + "</svg>";
  }
  const left = 56, bottom = ys.length > 1 || true ? 44 : 28, plotW = W - left - 10, plotH = H - top - bottom; const sy = (v) => top + plotH - ((v - min) / (max - min)) * plotH; const n = rows.length;
  let g = ""; for (let i = 0; i <= 4; i++) { const v = min + ((max - min) * i) / 4, y = sy(v); g += `<line x1="${left}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="${grid}"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" fill="${muted}">${fmt(v, ytype, lang)}</text>`; }
  const step = plotW / n;
  if (type === "line") {
    ys.forEach((k, j) => { const pts = rows.map((r, i) => [left + step * (i + 0.5), sy(Number(r[k]) || 0)]); g += `<polyline fill="none" stroke="${pal[j % pal.length]}" stroke-width="2.5" points="${pts.map((p) => p.join(",")).join(" ")}"/>` + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${pal[j % pal.length]}"/>`).join(""); });
  } else {
    const bw = Math.min(46, (step * 0.78) / (stacked ? 1 : ys.length));
    rows.forEach((r, i) => { let acc = 0; ys.forEach((k, j) => { const v = vals[i][j]; const x = stacked ? left + step * (i + 0.5) - bw / 2 : left + step * (i + 0.5) - (bw * ys.length) / 2 + j * bw; const y0 = sy(stacked ? acc + Math.max(0, v) : Math.max(0, v)), y1 = sy(stacked ? acc : Math.min(0, v)); if (stacked) acc += v;
      g += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw - 1}" height="${Math.max(1, Math.abs(y1 - y0))}" fill="${pal[j % pal.length]}"/>`; }); });
  }
  const every = Math.ceil(n / Math.floor(plotW / 70)); rows.forEach((r, i) => { if (i % every === 0) g += `<text x="${left + step * (i + 0.5)}" y="${top + plotH + 16}" text-anchor="middle" fill="${muted}">${esc(trunc(r[xKey], 12))}</text>`; });
  return head + t + g + (ys.length > 1 ? legend(ys.map((k) => cols[k]?.label || k), H - 14) : "") + "</svg>";
}
