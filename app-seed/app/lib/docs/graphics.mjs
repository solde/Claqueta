// Graphics for memoirs and documents, drawn as SVG from a small declarative spec in the colours and fonts of the brand kit. Pure strings (no I/O besides the data they ask for),
// so they work in the HTML/PDF export, rasterise for Word and can be stored in the gallery as images.
//   renderGraphic(ctx, spec, { brand, lang }) -> { svg, width, height, title }
// Types: stats, quote, timeline, orgchart, locations_map, kpi_bars, divider, cover_art, chart. `GRAPHIC_TYPES` documents each one (served to the agent by `collado-doc graphic types`).
import { esc, num as fnum, date as fdate } from "./format.mjs";
import { readable } from "./brand.mjs";
import { chartSvg } from "./charts.mjs";
import { runSource } from "./datasets.mjs";
import { SVG_ICONS } from "../../public/js/icons.js";
import * as E from "../engine.mjs";
import { q } from "../db.mjs";
import { facts } from "../memoir.mjs";
import { bad } from "../util.mjs";

const hex6 = (c, d = "#1f3a5f") => { const h = String(c || d).replace("#", ""); const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.padEnd(6, "0").slice(0, 6); return f; };
const rgb = (c) => [0, 2, 4].map((i) => parseInt(hex6(c).slice(i, i + 2), 16));
const tint = (c, f) => `#${rgb(c).map((v) => Math.round(v + (255 - v) * f).toString(16).padStart(2, "0")).join("")}`;
const shade = (c, f) => `#${rgb(c).map((v) => Math.round(v * (1 - f)).toString(16).padStart(2, "0")).join("")}`;
const wrap = (text, max, lines = 99) => { const out = []; let cur = ""; for (const w of String(text ?? "").split(/\s+/).filter(Boolean)) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); } if (cur) out.push(cur); if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/.{0,2}$/, "…"); } return out; };
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (seed) => { let a = seed; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const icon = (name, x, y, size, color) => (SVG_ICONS[name] ? `<g transform="translate(${x},${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SVG_ICONS[name]}</g>` : "");

function theme(brand, lang) {
  const primary = brand?.primary || "#1f3a5f", accent = brand?.accent || "#e0a100", ink = brand?.text_color || "#1c1f24", muted = brand?.muted || "#6b7280";
  const stack = (f) => [...new Set([String(f || "Inter").replace(/["<>&',]/g, "").trim() || "Inter", "Inter"])].map((x) => (/\s/.test(x) ? `'${x}'` : x)).concat(["'Helvetica Neue'", "Arial", "sans-serif"]).join(", ");
  const fam = stack(brand?.font_body), famH = stack(brand?.font_heading || brand?.font_body);
  return { primary, accent, ink, muted, fam, famH, panel: tint(primary, 0.93), line: tint(primary, 0.8), on: readable(primary), onAccent: readable(accent), lang, pal: [primary, accent, "#2f9e73", "#d1495b", "#6c5ce7", "#00a6c0", "#f28f3b", "#7a8793"] };
}
const open = (W, H, th, bg = "#ffffff") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" font-family="${th.fam}"><rect width="${W}" height="${H}" fill="${bg}"/>`;
const heading = (spec, th, W, y = 46) => (spec.title ? `<text x="40" y="${y}" font-family="${th.famH}" font-size="26" font-weight="700" fill="${th.ink}">${esc(trunc(spec.title, Math.floor(W / 14)))}</text>${spec.subtitle ? `<text x="40" y="${y + 24}" font-size="14" fill="${th.muted}">${esc(trunc(spec.subtitle, Math.floor(W / 7)))}</text>` : ""}` : "");

// ---- data helpers ---------------------------------------------------------------------------------------------------------------------------
const L = {
  es: { episodes: "episodios", minutes: "minutos", shoot: "días de rodaje", people: "personas en el equipo", audience: "audiencia media (miles)", share: "cuota media", budget: "presupuesto", aired: "emitidos", locations: "localizaciones", photos: "imágenes" },
  en: { episodes: "episodes", minutes: "minutes", shoot: "shoot days", people: "people on the team", audience: "average audience (thousands)", share: "average share", budget: "budget", aired: "aired", locations: "locations", photos: "images" },
  ca: { episodes: "episodis", minutes: "minuts", shoot: "dies de rodatge", people: "persones a l'equip", audience: "audiència mitjana (milers)", share: "quota mitjana", budget: "pressupost", aired: "emesos", locations: "localitzacions", photos: "imatges" },
};
const money0 = (v, lang) => fnum(v, lang, 0);

function autoStats(ctx, spec, lang) {
  const f = facts(ctx, Number(spec.program)), t = L[lang] || L.es, s = [];
  if (f.episodes.count) s.push({ value: fnum(f.episodes.count, lang), label: t.episodes, icon: "tv" });
  const min = f.runtime.actual_min || f.runtime.planned_min; if (min) s.push({ value: fnum(min, lang), label: t.minutes, icon: "clock" });
  if (f.shoot.days) s.push({ value: fnum(f.shoot.days, lang), label: t.shoot, icon: "camera" });
  if (f.crew.people) s.push({ value: fnum(f.crew.people, lang), label: t.people, icon: "users" });
  if (f.locations.length) s.push({ value: fnum(f.locations.length, lang), label: t.locations, icon: "pin" });
  if (f.audience?.avg_audience_k != null) s.push({ value: fnum(f.audience.avg_audience_k, lang), label: t.audience, icon: "chart" });
  if (f.audience?.avg_share != null) s.push({ value: `${fnum(f.audience.avg_share, lang, 1)} %`, label: t.share, icon: "target" });
  if (f.media.count) s.push({ value: fnum(f.media.count, lang), label: t.photos, icon: "image" });
  return s;
}

// ---- types ----------------------------------------------------------------------------------------------------------------------------------
function stats(ctx, spec, th) {
  let items = Array.isArray(spec.stats) ? spec.stats : spec.data && Array.isArray(spec.data) ? spec.data : [];
  if (spec.auto || (!items.length && spec.program)) items = [...autoStats(ctx, spec, th.lang), ...items];
  items = items.filter((s) => s && (s.value !== undefined && s.value !== "")).slice(0, 12); if (!items.length) throw bad("graphic_no_data");
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 4 : items.length <= 6 ? 3 : 4, rowsN = Math.ceil(items.length / cols), W = Number(spec.width) || 1200, top = spec.title ? 96 : 28, cw = (W - 80 - (cols - 1) * 20) / cols, ch = 150, H = Number(spec.height) || top + rowsN * (ch + 20) + 24;
  let g = open(W, H, th, spec.transparent ? "none" : "#ffffff") + heading(spec, th, W);
  items.forEach((s, i) => { const x = 40 + (i % cols) * (cw + 20), y = top + Math.floor(i / cols) * (ch + 20), dark = i % 4 === 0, bg = dark ? th.primary : th.panel, fg = dark ? th.on : th.ink, sub = dark ? tint(th.on, 0) : th.muted;
    g += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="18" fill="${bg}"${dark ? "" : ` stroke="${th.line}"`}/>${icon(s.icon, x + cw - 50, y + 18, 28, dark ? th.accent : th.primary)}`;
    const vs = String(s.value).length > 9 ? 34 : String(s.value).length > 6 ? 42 : 52;
    g += `<text x="${x + 22}" y="${y + 78}" font-family="${th.famH}" font-size="${vs}" font-weight="800" fill="${fg}">${esc(s.value)}</text>${wrap(s.label, Math.floor(cw / 10), 2).map((ln, j) => `<text x="${x + 22}" y="${y + 108 + j * 21}" font-size="17" fill="${sub}" opacity="${dark ? 0.85 : 1}">${esc(ln)}</text>`).join("")}`; });
  return { svg: g + "</svg>", width: W, height: H };
}

function quote(ctx, spec, th) {
  const W = Number(spec.width) || 1000, text = String(spec.text || spec.quote || ""); if (!text) throw bad("graphic_no_data");
  const size = text.length > 220 ? 24 : text.length > 120 ? 30 : 38, lines = wrap(text, Math.floor((W - 200) / (size * 0.52)), 9), H = Number(spec.height) || Math.round(Math.max(300, 150 + lines.length * (size * 1.35) + 90));
  let g = open(W, H, th, th.primary) + `<circle cx="${W - 40}" cy="40" r="150" fill="${th.accent}" opacity="0.16"/><circle cx="40" cy="${H}" r="110" fill="${th.on}" opacity="0.06"/><text x="64" y="130" font-family="Georgia, serif" font-size="150" fill="${th.accent}">“</text>`;
  lines.forEach((ln, i) => { g += `<text x="120" y="${Math.round(120 + i * size * 1.35)}" font-family="Georgia, serif" font-size="${size}" font-style="italic" fill="${th.on}">${esc(ln)}</text>`; });
  const y = Math.round(150 + lines.length * size * 1.35); g += `<rect x="120" y="${y - 28}" width="48" height="4" fill="${th.accent}"/>${spec.person ? `<text x="120" y="${y + 8}" font-size="20" font-weight="700" fill="${th.on}">${esc(spec.person)}</text>` : ""}${spec.role ? `<text x="120" y="${y + 34}" font-size="15" fill="${th.on}" opacity="0.8">${esc(spec.role)}</text>` : ""}`;
  return { svg: g + "</svg>", width: W, height: H };
}

function timelineItems(ctx, spec, lang) {
  if (Array.isArray(spec.items) && spec.items.length) return spec.items.map((i) => ({ date: i.date, label: i.label || i.title, detail: i.detail || "", end: i.end }));
  if (spec.source === "episodes") return E.list(ctx, "episodes", { filters: { program_id: Number(spec.program) }, limit: 200, refs: "0", sort: "number" }).rows.filter((e) => e.air_date).map((e) => ({ date: e.air_date, label: `E${e.number}${e.title ? " · " + e.title : ""}` }));
  if (spec.program) return E.list(ctx, "milestones", { filters: { program_id: Number(spec.program) }, limit: 200, refs: "0", sort: "start_date" }).rows.filter((m) => m.start_date).map((m) => ({ date: m.start_date, label: m.title, end: m.end_date }));
  return [];
}
function timeline(ctx, spec, th) {
  let items = timelineItems(ctx, spec, th.lang).filter((i) => i.date && i.label).sort((a, b) => String(a.date).localeCompare(String(b.date))); if (!items.length) throw bad("graphic_no_data");
  if (items.length > 14) { const step = items.length / 14; items = Array.from({ length: 14 }, (_, i) => items[Math.floor(i * step)]); }
  const W = Number(spec.width) || 1200, H = Number(spec.height) || 440, left = 70, right = 70, mid = spec.title ? 250 : 220, t0 = Date.parse(items[0].date), t1 = Date.parse(items[items.length - 1].date), span = Math.max(1, t1 - t0);
  const xs = items.map((it, i) => (items.length === 1 ? W / 2 : left + ((Date.parse(it.date) - t0) / span) * (W - left - right))); for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 70) xs[i] = xs[i - 1] + 70;   // keep dots readable when dates cluster
  const scale = xs[xs.length - 1] > W - right ? (W - right - left) / (xs[xs.length - 1] - left) : 1; if (scale < 1) for (let i = 0; i < xs.length; i++) xs[i] = left + (xs[i] - left) * scale;
  let g = open(W, H, th) + heading(spec, th, W) + `<line x1="${left - 20}" x2="${W - right + 20}" y1="${mid}" y2="${mid}" stroke="${th.line}" stroke-width="6" stroke-linecap="round"/>`;
  items.forEach((it, i) => { const up = i % 2 === 0, x = xs[i], y2 = up ? mid - 60 : mid + 60, tx = Math.min(W - 110, Math.max(110, x)); const lines = wrap(it.label, 22, 3);
    g += `<line x1="${x}" x2="${x}" y1="${mid}" y2="${y2}" stroke="${th.line}" stroke-width="2"/><circle cx="${x}" cy="${mid}" r="11" fill="${th.pal[i % 2 ? 1 : 0]}" stroke="#fff" stroke-width="3"/>`;
    g += `<text x="${tx}" y="${up ? y2 - 8 - (lines.length - 1) * 17 - 22 : y2 + 24}" text-anchor="middle" font-size="12" font-weight="700" fill="${th.primary}">${esc(fdate(it.date, th.lang, "medium"))}</text>`;
    g += lines.map((ln, j) => `<text x="${tx}" y="${up ? y2 - 8 - (lines.length - 1 - j) * 17 : y2 + 42 + j * 17}" text-anchor="middle" font-size="14" fill="${th.ink}">${esc(ln)}</text>`).join(""); });
  return { svg: g + "</svg>", width: W, height: H };
}

function orgTree(ctx, spec) {
  if (spec.root) return spec.root;
  if (spec.source === "crew" || spec.program) {
    const prog = E.getRow(ctx, "programs", Number(spec.program)), rowsC = q.all("SELECT c.role, p.name FROM crew_assignments c JOIN people p ON p.id = c.person_id WHERE c.program_id = ? ORDER BY c.role, p.name", Number(spec.program)), by = new Map();
    for (const r of rowsC) { if (!by.has(r.role || "—")) by.set(r.role || "—", new Set()); by.get(r.role || "—").add(r.name); }
    return { name: prog.name, role: prog.producer || "", children: [...by.entries()].slice(0, 8).map(([role, names]) => ({ name: role, children: [...names].slice(0, 6).map((n) => ({ name: n })) })) };
  }
  return null;
}
function orgchart(ctx, spec, th) {
  const root = orgTree(ctx, spec); if (!root || !(root.children || []).length) throw bad("graphic_no_data");
  const kids = root.children.slice(0, 8), colW = 190, gap = 18, W = Math.max(Number(spec.width) || 1000, 60 + kids.length * (colW + gap)), maxLeaves = Math.max(...kids.map((k) => (k.children || []).length), 0), H = Number(spec.height) || 220 + maxLeaves * 46 + (spec.title ? 50 : 0), y0 = spec.title ? 84 : 28;
  let g = open(W, H, th) + heading(spec, th, W); const rx = W / 2 - 150;
  g += `<rect x="${rx}" y="${y0}" width="300" height="64" rx="14" fill="${th.primary}"/><text x="${W / 2}" y="${y0 + 28}" text-anchor="middle" font-family="${th.famH}" font-size="17" font-weight="700" fill="${th.on}">${esc(trunc(root.name, 30))}</text>${root.role ? `<text x="${W / 2}" y="${y0 + 49}" text-anchor="middle" font-size="12" fill="${th.on}" opacity="0.8">${esc(trunc(root.role, 38))}</text>` : ""}`;
  const x0 = (W - (kids.length * colW + (kids.length - 1) * gap)) / 2, yb = y0 + 110; g += `<line x1="${W / 2}" x2="${W / 2}" y1="${y0 + 64}" y2="${yb - 18}" stroke="${th.line}" stroke-width="2"/><line x1="${x0 + colW / 2}" x2="${x0 + (kids.length - 1) * (colW + gap) + colW / 2}" y1="${yb - 18}" y2="${yb - 18}" stroke="${th.line}" stroke-width="2"/>`;
  kids.forEach((k, i) => { const x = x0 + i * (colW + gap), col = th.pal[1 + (i % 3)]; g += `<line x1="${x + colW / 2}" x2="${x + colW / 2}" y1="${yb - 18}" y2="${yb}" stroke="${th.line}" stroke-width="2"/><rect x="${x}" y="${yb}" width="${colW}" height="44" rx="10" fill="${col}"/><text x="${x + colW / 2}" y="${yb + 27}" text-anchor="middle" font-size="14" font-weight="700" fill="${readable(col)}">${esc(trunc(k.name, 24))}</text>`;
    (k.children || []).slice(0, 8).forEach((c, j) => { const y = yb + 56 + j * 46; g += `<rect x="${x}" y="${y}" width="${colW}" height="38" rx="8" fill="${th.panel}" stroke="${th.line}"/><text x="${x + 12}" y="${y + 24}" font-size="13" fill="${th.ink}">${esc(trunc(c.name, 26))}</text>`; }); });
  return { svg: g + "</svg>", width: W, height: H };
}

function locationsMap(ctx, spec, th) {
  let pts = Array.isArray(spec.points) ? spec.points : (spec.program ? E.list(ctx, "locations", { filters: { program_id: Number(spec.program) }, limit: 200, refs: "0", sort: "name" }).rows : []);
  pts = pts.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) })); if (!pts.length) throw bad("graphic_no_data");
  const W = Number(spec.width) || 1100, H = Number(spec.height) || 640, mapW = pts.length > 1 ? 700 : 760, x0 = 40, y0 = spec.title ? 90 : 36, mh = H - y0 - 36, lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length, k = Math.cos((lat0 * Math.PI) / 180) || 1;
  const xsU = pts.map((p) => p.lng * k), ys = pts.map((p) => p.lat), minX = Math.min(...xsU), maxX = Math.max(...xsU), minY = Math.min(...ys), maxY = Math.max(...ys), spanX = Math.max(maxX - minX, 0.02), spanY = Math.max(maxY - minY, 0.02), pad = 0.25;
  const sc = Math.min(mapW / (spanX * (1 + pad * 2)), mh / (spanY * (1 + pad * 2))), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, X = (lng) => x0 + mapW / 2 + (lng * k - cx) * sc, Y = (lat) => y0 + mh / 2 - (lat - cy) * sc;
  let g = open(W, H, th) + heading(spec, th, W) + `<rect x="${x0}" y="${y0}" width="${mapW}" height="${mh}" rx="16" fill="${th.panel}" stroke="${th.line}"/>`;
  const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find((s) => (spanX * (1 + pad * 2)) / s <= 7) || 20;   // graticule in degrees
  for (let lng = Math.ceil((cx - mapW / 2 / sc) / k / step) * step; lng * k < cx + mapW / 2 / sc; lng += step) { const x = X(lng); if (x > x0 && x < x0 + mapW) g += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + mh}" stroke="${th.line}" stroke-width="1"/>`; }
  for (let lat = Math.ceil((cy - mh / 2 / sc) / step) * step; lat < cy + mh / 2 / sc; lat += step) { const y = Y(lat); if (y > y0 && y < y0 + mh) g += `<line x1="${x0}" x2="${x0 + mapW}" y1="${y}" y2="${y}" stroke="${th.line}" stroke-width="1"/>`; }
  if (pts.length > 1) g += `<polyline fill="none" stroke="${th.accent}" stroke-width="2" stroke-dasharray="6 6" opacity="0.7" points="${pts.map((p) => `${X(p.lng)},${Y(p.lat)}`).join(" ")}"/>`;
  pts.forEach((p, i) => { const x = X(p.lng), y = Y(p.lat); g += `<circle cx="${x}" cy="${y}" r="20" fill="${th.primary}" opacity="0.14"/><path d="M${x} ${y + 4} C ${x - 22} ${y - 20}, ${x - 16} ${y - 44}, ${x} ${y - 44} C ${x + 16} ${y - 44}, ${x + 22} ${y - 20}, ${x} ${y + 4} Z" fill="${th.primary}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y - 24}" text-anchor="middle" font-size="14" font-weight="800" fill="${th.on}">${i + 1}</text>`; });
  if (pts.length > 1 || true) pts.slice(0, 12).forEach((p, i) => { const y = y0 + 8 + i * 44, lx = x0 + mapW + 24; g += `<circle cx="${lx + 14}" cy="${y + 18}" r="14" fill="${th.primary}"/><text x="${lx + 14}" y="${y + 23}" text-anchor="middle" font-size="13" font-weight="800" fill="${th.on}">${i + 1}</text><text x="${lx + 38}" y="${y + 15}" font-size="15" font-weight="700" fill="${th.ink}">${esc(trunc(p.name, 28))}</text><text x="${lx + 38}" y="${y + 33}" font-size="12" fill="${th.muted}">${esc(trunc([p.city, p.country].filter(Boolean).join(", ") + (p.shoot_days ? ` · ${p.shoot_days} d` : ""), 36))}</text>`; });
  return { svg: g + "</svg>", width: W, height: H };
}

function kpiItems(ctx, spec) {
  if (Array.isArray(spec.items) && spec.items.length) return spec.items;
  if (spec.source === "section" && spec.memoir) { const s = E.list(ctx, "memoir_sections", { filters: { memoir_id: Number(spec.memoir), key: spec.section || "objectives" }, limit: 1, refs: "0" }).rows[0]; const list = s?.fields?.[spec.field || "objectives"] || []; return list.map((r) => ({ label: r.objective || r.name || r.indicator, target: Number(r.target), achieved: Number(r.achieved), unit: r.unit })); }
  return [];
}
function kpiBars(ctx, spec, th) {
  const items = kpiItems(ctx, spec).filter((i) => i && i.label && Number.isFinite(Number(i.target)) && Number(i.target) > 0).slice(0, 12); if (!items.length) throw bad("graphic_no_data");
  const W = Number(spec.width) || 1000, rowH = 62, top = spec.title ? 96 : 30, H = Number(spec.height) || top + items.length * rowH + 26, barX = 340, barW = W - barX - 150;
  let g = open(W, H, th) + heading(spec, th, W);
  items.forEach((it, i) => { const y = top + i * rowH, tg = Number(it.target), ac = Number(it.achieved) || 0, pct = ac / tg, ok = pct >= 1, col = ok ? "#2f9e73" : pct >= 0.7 ? th.accent : "#d1495b";
    g += `<text x="40" y="${y + 22}" font-size="15" font-weight="600" fill="${th.ink}">${esc(trunc(it.label, 36))}</text><text x="40" y="${y + 42}" font-size="12" fill="${th.muted}">${esc(`${fnum(ac, th.lang, ac % 1 ? 1 : 0)} / ${fnum(tg, th.lang, tg % 1 ? 1 : 0)} ${it.unit || ""}`.trim())}</text>`;
    g += `<rect x="${barX}" y="${y + 12}" width="${barW}" height="22" rx="11" fill="${th.panel}" stroke="${th.line}"/><rect x="${barX}" y="${y + 12}" width="${Math.max(8, Math.min(1.25, pct) * barW * 0.8)}" height="22" rx="11" fill="${col}"/><line x1="${barX + barW * 0.8}" x2="${barX + barW * 0.8}" y1="${y + 6}" y2="${y + 40}" stroke="${th.ink}" stroke-width="2"/>`;
    g += `<text x="${barX + barW + 16}" y="${y + 30}" font-size="18" font-weight="800" fill="${col}">${Math.round(pct * 100)} %</text>`; });
  return { svg: g + "</svg>", width: W, height: H };
}

function divider(ctx, spec, th) {
  const W = Number(spec.width) || 1240, H = Number(spec.height) || 560, r = rnd(hash(spec.title || "divider"));
  let g = open(W, H, th, th.primary); for (let i = 0; i < 6; i++) g += `<circle cx="${W * (0.55 + r() * 0.5)}" cy="${H * r()}" r="${60 + r() * 220}" fill="${i % 2 ? th.accent : th.on}" opacity="${0.05 + r() * 0.1}"/>`;
  g += `<rect x="80" y="${H / 2 - 96}" width="90" height="8" fill="${th.accent}"/>${spec.number != null ? `<text x="76" y="${H / 2 + 40}" font-family="${th.famH}" font-size="150" font-weight="800" fill="${th.accent}" opacity="0.9">${esc(String(spec.number).padStart(2, "0"))}</text>` : ""}`;
  const lines = wrap(spec.title || "", 24, 3); lines.forEach((ln, i) => { g += `<text x="${spec.number != null ? 290 : 80}" y="${H / 2 - 30 + i * 62}" font-family="${th.famH}" font-size="54" font-weight="700" fill="${th.on}">${esc(ln)}</text>`; });
  if (spec.subtitle) g += `<text x="${spec.number != null ? 290 : 80}" y="${H / 2 + 30 + (lines.length - 1) * 62 + 40}" font-size="22" fill="${th.on}" opacity="0.8">${esc(trunc(spec.subtitle, 70))}</text>`;
  return { svg: g + "</svg>", width: W, height: H };
}

function coverArt(ctx, spec, th) {
  const W = Number(spec.width) || 1240, H = Number(spec.height) || 1754, r = rnd(hash(`${spec.title}${spec.program || ""}`));
  let g = open(W, H, th, th.primary);
  for (let i = 0; i < 9; i++) { const cx = W * r(), cy = H * (0.1 + r() * 0.55), rad = 90 + r() * 330, col = [th.accent, th.on, th.pal[2], th.pal[5]][i % 4]; g += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${col}" opacity="${0.05 + r() * 0.12}"/>`; }
  for (let i = 0; i < 5; i++) { const y = H * (0.18 + i * 0.09); g += `<rect x="${-40 + r() * 100}" y="${y}" width="${W * (0.3 + r() * 0.5)}" height="${6 + r() * 14}" fill="${th.accent}" opacity="${0.18 + r() * 0.3}"/>`; }
  g += `<rect x="80" y="${H * 0.68}" width="120" height="10" fill="${th.accent}"/>`;
  wrap(spec.title || "", 18, 4).forEach((ln, i) => { g += `<text x="80" y="${H * 0.68 + 100 + i * 92}" font-family="${th.famH}" font-size="82" font-weight="800" fill="${th.on}">${esc(ln)}</text>`; });
  if (spec.subtitle) wrap(spec.subtitle, 40, 2).forEach((ln, i) => { g += `<text x="80" y="${H * 0.68 + 140 + wrap(spec.title || "", 18, 4).length * 92 + i * 38}" font-size="30" fill="${th.on}" opacity="0.85">${esc(ln)}</text>`; });
  if (spec.footer) g += `<text x="80" y="${H - 80}" font-size="24" fill="${th.on}" opacity="0.7">${esc(trunc(spec.footer, 70))}</text>`;
  return { svg: g + "</svg>", width: W, height: H };
}

async function chart(ctx, spec, th, brand, lang) {
  let ds;
  if (spec.source) ds = await runSource(ctx, String(spec.source), spec.params || Object.fromEntries(Object.entries(spec).filter(([k]) => !["type", "chart_type", "source", "title", "subtitle", "width", "height", "x", "y", "stacked", "params"].includes(k))), lang);
  else {
    const data = spec.data; if (!data) throw bad("graphic_no_data");
    const rowsIn = Array.isArray(data) ? data : data.rows; if (!Array.isArray(rowsIn) || !rowsIn.length) throw bad("graphic_no_data");
    const keys = data.columns ? data.columns.map((c) => c.key) : Object.keys(rowsIn[0]);
    ds = { title: spec.title || "", columns: data.columns || keys.map((k, i) => ({ key: k, label: k, type: i === 0 ? "text" : "num" })), rows: rowsIn };
  }
  const svg = chartSvg({ type: spec.chart_type || "bar", x: spec.x, y: spec.y, title: spec.title || false, width: spec.width, height: spec.height, stacked: spec.stacked }, ds, brand, lang);
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  return { svg: svg.replace('font-family="inherit"', `font-family="${th.fam}"`).replace(/(<svg [^>]*>)/, `$1<rect width="${m[1]}" height="${m[2]}" fill="#ffffff"/>`), width: Number(m[1]), height: Number(m[2]) };
}

/** The graphic types (stats, quote, timeline, orgchart, locations_map, kpi_bars, divider, cover_art, chart): label, accepted spec and an example; served to the agent and the generator dialog. */
export const GRAPHIC_TYPES = {
  stats: { label: "The project in numbers (stat cards)", spec: { title: "text", auto: "1 = fill from the project (episodes, minutes, shoot days, team, audience…)", program: "id", stats: "[{value, label, icon}] extra or manual figures", width: "px (1200)" }, example: { type: "stats", auto: 1, program: 3, title: "El proyecto en cifras" } },
  quote: { label: "Quote card", spec: { text: "the quote", person: "text", role: "text" }, example: { type: "quote", text: "Un programa que conecta con la gente.", person: "Ana Ruiz", role: "Directora de contenidos" } },
  timeline: { label: "Timeline of milestones or airings", spec: { items: "[{date, label}]", source: "milestones | episodes (with program)", program: "id", title: "text" }, example: { type: "timeline", source: "milestones", program: 3, title: "Cronología" } },
  orgchart: { label: "Team organisation chart", spec: { source: "crew (with program)", program: "id", root: "{name, role, children:[{name, children:[{name}]}]}" }, example: { type: "orgchart", source: "crew", program: 3 } },
  locations_map: { label: "Map of shoot locations (schematic, offline)", spec: { source: "locations", program: "id", points: "[{name, lat, lng, city, shoot_days}]" }, example: { type: "locations_map", source: "locations", program: 3 } },
  kpi_bars: { label: "Target vs achieved bars", spec: { items: "[{label, target, achieved, unit}]", source: "section (memoir, section, field)" }, example: { type: "kpi_bars", items: [{ label: "Episodios", target: 10, achieved: 10, unit: "" }, { label: "Audiencia media", target: 300, achieved: 240, unit: "miles" }] } },
  divider: { label: "Section divider image", spec: { title: "text", subtitle: "text", number: "section number" }, example: { type: "divider", number: 3, title: "Resultados y audiencia" } },
  cover_art: { label: "Cover artwork (portrait)", spec: { title: "text", subtitle: "text", footer: "text" }, example: { type: "cover_art", title: "Memoria 2026", subtitle: "Mi programa", footer: "Productora" } },
  chart: { label: "Chart from inline data or a data source (bar, hbar, line, area, donut, waterfall, heatmap, gantt)", spec: { chart_type: "bar|hbar|line|area|donut|waterfall|heatmap|gantt", data: "{columns?, rows:[{label, value…}]} or [{label, value}]", source: "a `collado-doc sources` name (with its params)", x: "column", y: "col1,col2", stacked: "1" }, example: { type: "chart", chart_type: "waterfall", title: "Del presupuesto al real", data: { rows: [{ label: "Presupuesto", value: 100000, kind: "total" }, { label: "Cap. 1", value: -4000 }, { label: "Cap. 2", value: 2500 }, { label: "Real", value: 98500, kind: "total" }] } } },
};

/** Draws a graphic from a spec with the brand's colours and fonts and returns { svg, width, height, type, title }; throws `graphic_no_data` when there is nothing to draw. */
export async function renderGraphic(ctx, spec, { brand, lang = "es" } = {}) {
  if (!spec || typeof spec !== "object") throw bad("invalid_graphic");
  const type = String(spec.type || ""); if (!GRAPHIC_TYPES[type]) throw bad("unknown_graphic", { types: Object.keys(GRAPHIC_TYPES) });
  const th = theme(brand, lang);
  const r = type === "stats" ? stats(ctx, spec, th) : type === "quote" ? quote(ctx, spec, th) : type === "timeline" ? timeline(ctx, spec, th) : type === "orgchart" ? orgchart(ctx, spec, th) : type === "locations_map" ? locationsMap(ctx, spec, th)
    : type === "kpi_bars" ? kpiBars(ctx, spec, th) : type === "divider" ? divider(ctx, spec, th) : type === "cover_art" ? coverArt(ctx, spec, th) : await chart(ctx, spec, th, brand, lang);
  return { ...r, type, title: spec.title || GRAPHIC_TYPES[type].label };
}
void money0;
