// AST -> standalone, print-ready HTML (also the format the PDF renderer consumes). No scripts, no external requests: everything is inline.
import { esc, str, date as fdate } from "./format.mjs";
import { brandCss, readable } from "./brand.mjs";
import { inlineText } from "./markdown.mjs";

const URL_OK = /^(https?:|mailto:|tel:|#|\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i;
/** Inline nodes (bold, italic, code, links, images) to HTML; links and image sources are restricted to safe schemes. */
export function inl(nodes, env = {}) {
  return (nodes || []).map((n) => {
    switch (n.k) {
      case "text": return esc(n.v);
      case "b": return `<strong>${inl(n.c, env)}</strong>`;
      case "i": return `<em>${inl(n.c, env)}</em>`;
      case "s": return `<s>${inl(n.c, env)}</s>`;
      case "mark": return `<mark>${inl(n.c, env)}</mark>`;
      case "code": return `<code>${esc(n.v)}</code>`;
      case "br": return "<br>";
      case "a": return URL_OK.test(n.href) ? `<a href="${esc(n.href)}">${inl(n.c, env)}</a>` : inl(n.c, env);
      case "img": { const src = env.image ? env.image(n.src) : n.src; return src && URL_OK.test(src) ? `<img src="${esc(src)}" alt="${esc(n.alt)}"${n.attrs?.width ? ` style="width:${esc(n.attrs.width)}"` : ""}>` : esc(n.alt); }
      default: return "";
    }
  }).join("");
}
const cls = (...a) => a.filter(Boolean).join(" ");

/** Block nodes (headings, lists, tables, callouts, columns, charts, galleries, signatures...) to HTML. */
export function blocksHtml(blocks, env) {
  return (blocks || []).map((b) => {
    switch (b.t) {
      case "h": { const id = b.attrs?.id || (env.headings ? env.nextId(b) : ""); return `<h${b.level}${id ? ` id="${esc(id)}"` : ""}${b.attrs?.class ? ` class="${esc(b.attrs.class)}"` : ""}>${inl(b.inlines, env)}</h${b.level}>`; }
      case "p": return `<p>${inl(b.inlines, env)}</p>`;
      case "ul": case "ol": return `<${b.t}${b.t === "ol" && b.start !== 1 ? ` start="${b.start}"` : ""}>${b.items.map((it) => `<li${it.checked !== undefined ? ` class="${cls("task", it.checked && "done")}"` : ""}>${inl(it.inlines, env)}${blocksHtml(it.blocks, env)}</li>`).join("")}</${b.t}>`;
      case "quote": return `<blockquote>${blocksHtml(b.blocks, env)}</blockquote>`;
      case "code": return `<pre><code>${esc(b.text)}</code></pre>`;
      case "hr": return "<hr>";
      case "pagebreak": return '<div class="pagebreak"></div>';
      case "raw": return env.allowRaw ? b.html : "";
      case "table": return tableHtml(b, env);
      case "callout": return `<div class="callout ${esc(b.kind)}">${b.title ? `<div class="title">${esc(b.title)}</div>` : ""}${blocksHtml(b.blocks, env)}</div>`;
      case "box": return `<div class="box ${esc(b.color)}">${blocksHtml(b.blocks, env)}</div>`;
      case "columns": return `<div class="columns">${b.cols.map((c) => `<div class="col">${blocksHtml(c, env)}</div>`).join("")}</div>`;
      case "section": return `<div class="${b.orientation === "landscape" ? "landscape" : ""}">${blocksHtml(b.blocks, env)}</div>`;
      case "kv": return `<dl class="kv">${b.pairs.map(([k, v]) => `<div><dt>${inl(k, env)}</dt><dd>${inl(v, env)}</dd></div>`).join("")}</dl>`;
      case "signature": return `<div class="signature">${(b.names.length ? b.names : [""]).map((n) => `<div class="sig"><div class="line">${esc(n || str(env.lang, "signature"))}</div></div>`).join("")}</div>${b.place ? `<div class="place">${esc(str(env.lang, "date_place"))}: ${esc(b.place)}</div>` : ""}`;
      case "chart": return `<figure class="chart">${b.svg}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
      case "gallery": return galleryHtml(b);
      case "toc": return tocHtml(b, env);
      case "cover": return ""; // rendered once, at the top
      case "figure": return `<figure><img src="${esc(b.src)}" alt="${esc(b.alt)}">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
      default: return "";
    }
  }).join("\n");
}
const figHtml = (it, h, logos) => `<figure class="ph"><img src="${esc(it.src)}" alt="${esc(it.alt)}" style="${logos ? "height:" + h + "mm;width:auto;max-width:100%" : it.w && it.h && (it.w / it.h > 1.7 || it.w / it.h < 0.6) ? "width:100%;height:auto;max-height:" + h * 1.6 + "mm;object-fit:contain" : "height:" + h + "mm;width:100%;object-fit:cover"}">${!logos && (it.caption || it.credit) ? `<figcaption>${esc(it.caption)}${it.credit ? ` <span class="credit">© ${esc(it.credit)}</span>` : ""}</figcaption>` : ""}</figure>`;
function galleryHtml(b) {
  const n = b.items.length, intro = b.title ? `<p class="gallery-intro">${esc(b.title)}</p>` : "";
  if (b.layout === "logos") return `<div class="gallery logos">${b.items.map((it) => figHtml(it, 14, true)).join("")}</div>`;
  if (b.layout === "hero") return `${intro}<div class="gallery hero">${figHtml(b.items[0], 105)}</div>${b.items.length > 1 ? `<div class="gallery grid3">${b.items.slice(1).map((it) => figHtml(it, 45)).join("")}</div>` : ""}`;
  if (b.layout === "strip") return `${intro}<div class="gallery strip" style="grid-template-columns:repeat(${Math.min(4, n)},1fr)">${b.items.slice(0, 4).map((it) => figHtml(it, 45)).join("")}</div>`;
  if (b.layout === "grid") return `${intro}<div class="gallery grid3">${b.items.map((it) => figHtml(it, 50)).join("")}</div>`;
  const first = n % 2 === 1, rest = first ? b.items.slice(1) : b.items;   // mosaic: a wide lead picture when the count is odd, then pairs
  return `${intro}${first ? `<div class="gallery hero">${figHtml(b.items[0], 85)}</div>` : ""}<div class="gallery pairs">${rest.map((it) => figHtml(it, 58)).join("")}</div>`;
}
function tableHtml(b, env) {
  const th = b.head.map((c, i) => `<th class="${cls(c.cls, c.align)}"${c.colspan > 1 ? ` colspan="${c.colspan}"` : ""}${b.widths?.[i] ? ` style="width:${esc(b.widths[i])}"` : ""}>${inl(c.inlines, env)}</th>`).join("");
  const tr = b.rows.map((r) => `<tr${r._cls ? ` class="${esc(r._cls)}"` : ""}>${(r.cells || r).map((c) => `<td class="${cls(c.cls, c.align)}"${c.colspan > 1 ? ` colspan="${c.colspan}"` : ""}>${inl(c.inlines, env)}</td>`).join("")}</tr>`).join("");
  const foot = b.foot ? `<tfoot><tr>${b.foot.map((c) => `<td class="${cls(c.cls, c.align)}">${inl(c.inlines, env)}</td>`).join("")}</tr></tfoot>` : "";
  return `<table>${b.caption ? `<caption>${esc(b.caption)}</caption>` : ""}${b.head.every((c) => !inlineText(c.inlines).trim()) ? "" : `<thead><tr>${th}</tr></thead>`}<tbody>${tr}</tbody>${foot}</table>`;
}
function tocHtml(b, env) {
  const all = env.headings || []; const base = all.filter((h) => h.level === 1).length === 1 ? 2 : 1;
  const items = all.filter((h) => h.level >= base && h.level < base + b.depth);
  if (!items.length) return "";
  return `<nav class="toc"><h2 style="border:0">${esc(b.title || str(env.lang, "toc"))}</h2><ol>${items.map((h) => `<li class="l${h.level - base + 2}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join("")}</ol></nav>`;
}

/** Collects the headings (for the TOC) and gives each an id. Mutates blocks' attrs. */
export function collectHeadings(blocks, out = [], counter = { n: 0 }) {
  for (const b of blocks || []) {
    if (b.t === "h") { b.attrs ||= {}; if (!b.attrs.id) b.attrs.id = `h-${++counter.n}`; out.push({ level: b.level, id: b.attrs.id, text: inlineText(b.inlines) }); }
    for (const k of ["blocks", "extra"]) if (b[k]) collectHeadings(b[k], out, counter);
    if (b.cols) for (const c of b.cols) collectHeadings(c, out, counter);
  }
  return out;
}

/** The cover page markup for a document in the brand's cover style (band, full, minimal, split). */
export function coverHtml(meta, brand, lang, attrs = {}, extraHtml = "") {
  const variant = attrs.style || (brand.cover === "none" ? "minimal" : brand.cover || "band");
  const rows = [[str(lang, "prepared_for"), meta.client], [str(lang, "author"), meta.author], [str(lang, "date"), meta.date_text], [str(lang, "version"), meta.version]].filter((r) => r[1]);
  return `<section class="cover ${esc(variant)}">${brand.logo ? `<img class="logo" src="${esc(brand.logo)}" alt="">` : ""}<div class="bar"></div>
<h1 class="ctitle">${esc(attrs.title || meta.title || "")}</h1>${(attrs.subtitle || meta.subtitle) ? `<div class="csub">${esc(attrs.subtitle || meta.subtitle)}</div>` : ""}
<div class="cmeta">${rows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join("")}</div>${extraHtml}${meta.confidentiality ? `<div class="cconf">${esc(meta.confidentiality)}</div>` : ""}</section>`;
}
function titleBlock(meta, lang) {
  const bits = [meta.client && `${str(lang, "prepared_for")}: ${meta.client}`, meta.author, meta.date_text, meta.version && `${str(lang, "version")} ${meta.version}`].filter(Boolean);
  return `<div class="titleblock"><h1>${esc(meta.title)}</h1>${meta.subtitle ? `<div class="sub">${esc(meta.subtitle)}</div>` : ""}${bits.length ? `<div class="meta">${esc(bits.join(" · "))}</div>` : ""}</div>`;
}

/** doc: { meta, blocks } already resolved (data/chart blocks expanded). */
export function renderHtml(doc, brand, { lang = "es", forScreen = false, allowRaw = false } = {}) {
  const meta = { ...doc.meta, date_text: doc.meta.date_text || (doc.meta.date ? fdate(doc.meta.date, lang) : "") };
  const headings = collectHeadings(doc.blocks);
  const env = { lang, headings, nextId: () => "", allowRaw, image: doc.imageResolver };
  const coverBlock = doc.blocks.find((b) => b.t === "cover");
  const wantsCover = coverBlock || (meta.cover && !["no", "false", "none", "0"].includes(String(meta.cover).toLowerCase()));
  const body = blocksHtml(doc.blocks, env);
  const hasH1 = doc.blocks.some((b) => b.t === "h" && b.level === 1);
  const top = wantsCover ? coverHtml(meta, brand, lang, { ...(coverBlock?.attrs || {}), style: coverBlock?.attrs?.style || (meta.cover && !["yes", "true", "1"].includes(String(meta.cover)) ? meta.cover : undefined) }, blocksHtml(coverBlock?.extra, env))
    : (meta.title && !hasH1 ? titleBlock(meta, lang) : (hasH1 ? `<h1 style="display:none;string-set:doctitle content()">${esc(meta.title || "")}</h1>` : ""));
  const wm = brand.watermark ? `<div class="watermark">${esc(brand.watermark === "DRAFT" ? str(lang, "draft") : brand.watermark)}</div>` : "";
  const legal = brand.legal_footer ? `<div class="legal-footer">${esc(brand.legal_footer).replace(/\n/g, "<br>")}</div>` : "";
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(meta.title || "")}</title>
<meta name="author" content="${esc(meta.author || "")}"><meta name="generator" content="Claqueta"><meta name="description" content="${esc(meta.subtitle || "")}"><style>${brandCss(brand, { lang, meta, forScreen })}</style></head>
<body>${wm}${top}${body}${legal}</body></html>`;
}
export { readable };
