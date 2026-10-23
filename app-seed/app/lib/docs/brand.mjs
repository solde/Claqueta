// Brand kits -> render brand (logo/fonts resolved) -> stylesheet for HTML/PDF. A brand is plain data (entity `brands`), so teams and agents can create their own.
import { readFileRaw } from "../files.mjs";
import { esc, str } from "./format.mjs";

/** Page sizes in millimetres (portrait). */
export const PAGE_MM = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
/** The default brand kit (colours, fonts, page layout, cover, header/footer texts) every missing value of a brand falls back to. */
export const DEFAULT_BRAND = {
  name: "Claqueta", primary: "#C8102E", accent: "#1C1F24", text_color: "#1c1f24", muted: "#5b6472", bg: "#ffffff", table_head_bg: "", table_stripe: "#f4f6f8",
  font_heading: "Inter", font_body: "Inter", font_mono: "DejaVu Sans Mono", base_size: 10.5, line_height: 1.45, logo_height_mm: 14, page_size: "A4", orientation: "portrait", margin_mm: { top: 27, right: 20, bottom: 22, left: 20 },
  cover: "band", header_text: "{{brand}} · {{title}}", footer_text: "{{confidentiality}} · {{date}}", page_numbers: 1, heading_numbering: 0, watermark: "", confidentiality: "Confidencial", legal_footer: "", custom_css: "",
};
const FALLBACK_SANS = `"Inter", "Liberation Sans", "DejaVu Sans", Arial, sans-serif`;

/** Merge a DB row (API form) with defaults and resolve binary assets (logo, custom fonts) into data URIs. */
export function resolveBrand(row = {}, overrides = {}) {
  const b = { ...DEFAULT_BRAND, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined && v !== "")), ...overrides };
  if (typeof b.margin_mm === "string") { try { b.margin_mm = JSON.parse(b.margin_mm); } catch { b.margin_mm = DEFAULT_BRAND.margin_mm; } }
  b.margin_mm = { ...DEFAULT_BRAND.margin_mm, ...(b.margin_mm || {}) };
  b.base_size = Number(b.base_size) || 10.5; b.line_height = Number(b.line_height) || 1.45;
  if (b.logo_attachment_id && !b.logo) { const f = readFileRaw(b.logo_attachment_id); if (f) { b.logo = `data:${f.mime};base64,${f.buffer.toString("base64")}`; b.logo_buffer = f.buffer; b.logo_mime = f.mime; } }
  b.faces = [];
  for (const ff of Array.isArray(b.font_files) ? b.font_files : []) { const f = ff.attachment_id && readFileRaw(ff.attachment_id); if (f) b.faces.push({ family: ff.family, weight: ff.weight || 400, style: ff.style || "normal", mime: f.mime, data: f.buffer.toString("base64"), buffer: f.buffer }); }
  return b;
}
const fontStack = (name, mono) => (name ? `"${String(name).replace(/["';{}<>\\]/g, "")}", ` : "") + (mono ? `"DejaVu Sans Mono", "Liberation Mono", monospace` : FALLBACK_SANS);
const fmtForFace = (mime) => (/woff2/.test(mime) ? "woff2" : /woff/.test(mime) ? "woff" : /otf|opentype/.test(mime) ? "opentype" : "truetype");

function pageDims(b, orient) { const [w, h] = PAGE_MM[b.page_size] || PAGE_MM.A4; return (orient || b.orientation) === "landscape" ? [h, w] : [w, h]; }

/** Header/footer template ("{{brand}} · {{title}}") -> CSS `content` value using string(doctitle) and page counters. */
function marginContent(tpl, b, lang, meta) {
  const parts = []; const re = /\{\{\s*(\w+)\s*\}\}/g; let last = 0, m; const lit = (s) => s && parts.push(`"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`);
  while ((m = re.exec(tpl))) { lit(tpl.slice(last, m.index)); last = m.index + m[0].length;
    switch (m[1]) { case "title": parts.push("string(doctitle)"); break; case "page": parts.push("counter(page)"); break; case "pages": parts.push("counter(pages)"); break; case "brand": lit(b.name); break;
      case "date": lit(meta.date_text || ""); break; case "confidentiality": lit(b.confidentiality); break; case "version": lit(meta.version || ""); break; case "author": lit(meta.author || ""); break; default: lit(meta[m[1]] || ""); } }
  lit(tpl.slice(last)); return parts.length ? parts.join(" ") : '""';
}

/** The complete stylesheet of a document for a brand: fonts, colours, tables, callouts, columns, galleries, cover variants and paged-media rules (@page, running headers) for PDF, or screen styles for the preview. */
export function brandCss(b, { lang = "es", meta = {}, forScreen = true } = {}) {
  const [pw, ph] = pageDims(b), m = b.margin_mm, prim = b.primary, acc = b.accent, ink = b.text_color, muted = b.muted;
  const thead = b.table_head_bg || prim, theadInk = readable(thead);
  const hdr = marginContent(b.header_text || "", b, lang, meta), ftr = marginContent(b.footer_text || "", b, lang, meta);
  const faces = b.faces.map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};src:url(data:${f.mime};base64,${f.data}) format("${fmtForFace(f.mime)}")}`).join("\n");
  const pn = b.page_numbers ? `counter(page) " / " counter(pages)` : '""';
  const wm = b.watermark ? `.watermark{position:fixed;top:42%;left:0;right:0;text-align:center;font-size:92pt;font-weight:700;letter-spacing:.08em;color:rgba(120,120,120,.13);transform:rotate(-28deg);z-index:0}` : "";
  const num = b.heading_numbering ? `body{counter-reset:h2n h3n h4n}h2{counter-increment:h2n;counter-reset:h3n}h3{counter-increment:h3n;counter-reset:h4n}h4{counter-increment:h4n}h2::before{content:counter(h2n) ". "}h3::before{content:counter(h2n) "." counter(h3n) " "}h4::before{content:counter(h2n) "." counter(h3n) "." counter(h4n) " "}` : "";
  const logoBox = b.logo ? `@top-right{content:"";background:url(${b.logo}) no-repeat right bottom;background-size:contain;margin-bottom:2mm}` : `@top-right{content:string(doctitle);font:8pt ${fontStack(b.font_body)};color:${muted};vertical-align:bottom;padding-bottom:2mm;text-align:right}`;
  return `${faces}
@page{size:${pw}mm ${ph}mm;margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  @top-left{content:${hdr};font:${Math.max(7, b.base_size - 2.5)}pt ${fontStack(b.font_body)};color:${muted};vertical-align:bottom;border-bottom:.6pt solid ${prim};width:62%;padding-bottom:2mm}
  ${logoBox}
  @bottom-left{content:${ftr};font:${Math.max(7, b.base_size - 2.5)}pt ${fontStack(b.font_body)};color:${muted};vertical-align:top;padding-top:2mm}
  @bottom-right{content:${pn};font:${Math.max(7, b.base_size - 2.5)}pt ${fontStack(b.font_body)};color:${muted};vertical-align:top;padding-top:2mm}}
@page:first{@top-left{content:none;border:0}@top-right{content:none;background:none}}
@page cover{margin:0;@top-left{content:none;border:0}@top-right{content:none;background:none}@bottom-left{content:none}@bottom-right{content:none}}
@page landscape{size:${ph}mm ${pw}mm}
*{box-sizing:border-box}
html{font-size:${b.base_size}pt}
body{margin:0;font-family:${fontStack(b.font_body)};font-size:1rem;line-height:${b.line_height};color:${ink};background:${b.bg};-weasy-hyphens:auto;hyphens:auto;orphans:3;widows:3}
h1,h2,h3,h4{font-family:${fontStack(b.font_heading)};color:${prim};line-height:1.2;break-after:avoid;margin:1.4em 0 .45em}
h1{font-size:2rem;margin-top:0;string-set:doctitle content();} h2{font-size:1.5rem;border-bottom:1.2pt solid ${acc};padding-bottom:.15em} h3{font-size:1.2rem} h4{font-size:1.02rem;text-transform:uppercase;letter-spacing:.04em;color:${muted}}
p{margin:0 0 .65em;text-align:left} a{color:${prim};text-decoration:underline} strong{font-weight:700} mark{background:${acc}55;padding:0 .15em}
ul,ol{margin:0 0 .7em;padding-left:1.4em} li{margin:.12em 0} li>p{margin:0} li.task{list-style:none;margin-left:-1.2em} li.task::before{content:"☐ "} li.task.done::before{content:"☑ "}
blockquote{margin:.8em 0;padding:.4em 1em;border-left:3pt solid ${acc};color:${muted};background:${b.table_stripe}}
code{font-family:${fontStack(b.font_mono, true)};font-size:.88em;background:${b.table_stripe};padding:.05em .3em} pre{font-family:${fontStack(b.font_mono, true)};font-size:.82rem;background:${b.table_stripe};padding:.6em .8em;white-space:pre-wrap;border-left:3pt solid ${prim};break-inside:avoid} pre code{background:none;padding:0}
hr{border:0;border-top:.8pt solid ${muted};margin:1.2em 0}
img{max-width:100%} figure{margin:.9em 0;break-inside:avoid;text-align:center} figcaption{font-size:.82rem;color:${muted};margin-top:.3em}
table{width:100%;border-collapse:collapse;margin:.8em 0 1em;font-size:.92rem;break-inside:auto} thead{display:table-header-group} tr{break-inside:avoid}
th{background:${thead};color:${theadInk};text-align:left;padding:.4em .6em;font-weight:700;font-family:${fontStack(b.font_heading)}}
td{padding:.35em .6em;border-bottom:.5pt solid #cfd4db;vertical-align:top} tbody tr:nth-child(even) td{background:${b.table_stripe}}
td.num,th.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} td.center,th.center{text-align:center} td.right,th.right{text-align:right}
tr.group td{font-weight:700;background:${prim}14} tr.indent td:first-child{padding-left:1.6em;color:${muted}} tfoot td{font-weight:700;border-top:1.5pt solid ${prim};border-bottom:0;background:transparent}
table caption{caption-side:top;text-align:left;font-weight:700;color:${prim};padding-bottom:.3em}
.callout{margin:.9em 0;padding:.7em 1em;border-left:4pt solid ${prim};background:${prim}12;break-inside:avoid} .callout>*:last-child{margin-bottom:0} .callout .title{font-weight:700;margin-bottom:.25em;color:${prim}}
.callout.warn{border-color:${acc};background:${acc}22} .callout.warn .title{color:#7a5700} .callout.danger{border-color:#d1495b;background:#d1495b18} .callout.danger .title{color:#a1303f} .callout.ok{border-color:#2f9e73;background:#2f9e7318} .callout.ok .title{color:#1f7a57}
.box{margin:.9em 0;padding:.8em 1em;background:${b.table_stripe};border:.8pt solid #cfd4db;break-inside:avoid} .box.accent{background:${acc}26;border-color:${acc}} .box.primary{background:${prim};color:${readable(prim)};border-color:${prim}} .box.primary h1,.box.primary h2,.box.primary h3{color:inherit;border:0}
.columns{display:table;width:100%;table-layout:fixed;border-spacing:0 0;margin:.6em 0} .columns>.col{display:table-cell;vertical-align:top;padding-right:1.2em} .columns>.col:last-child{padding-right:0}
dl.kv{display:table;width:100%;margin:.6em 0} dl.kv>div{display:table-row} dl.kv dt,dl.kv dd{display:table-cell;padding:.25em .6em;border-bottom:.5pt solid #cfd4db} dl.kv dt{width:32%;font-weight:700;color:${prim}}
.signature{display:table;width:100%;margin-top:2.2em;break-inside:avoid;table-layout:fixed} .signature .sig{display:table-cell;padding-right:2em;vertical-align:bottom} .signature .line{border-top:.8pt solid ${ink};margin-top:2.6em;padding-top:.25em;font-size:.88rem} .signature .place{font-size:.85rem;color:${muted};margin-top:.4em}
.pagebreak{break-after:page;height:0} .landscape{page:landscape}
.toc{margin:1em 0 1.4em} .toc h2{border:0} .toc ol{list-style:none;padding:0;margin:0} .toc li{margin:.25em 0} .toc li.l3{margin-left:1.2em} .toc li.l4{margin-left:2.4em}
.toc a{text-decoration:none;color:${ink}} .toc a::after{content:leader('.') target-counter(attr(href), page);color:${muted}}
.gallery{display:grid;gap:3mm;margin:.9em 0} .gallery.pairs{grid-template-columns:1fr 1fr} .gallery.grid3{grid-template-columns:repeat(3,1fr)} .gallery.hero{grid-template-columns:1fr} .gallery figure.ph{margin:0;break-inside:avoid;text-align:left} .gallery.logos{display:flex;flex-wrap:wrap;gap:8mm;align-items:center} .gallery.logos figure.ph{text-align:center} .gallery img{display:block;border-radius:1.2mm} .gallery figcaption{margin-top:1.2mm} .gallery .credit{opacity:.75;font-size:.9em} .gallery-intro{color:${muted};margin:.4em 0}
.chart{margin:.9em 0;break-inside:avoid;text-align:center} .chart svg{max-width:100%;height:auto}
.legal-footer{margin-top:2em;font-size:.78rem;color:${muted};border-top:.6pt solid ${muted};padding-top:.5em}
.cover{page:cover;break-after:page;width:${pw}mm;height:${ph}mm;position:relative;overflow:hidden;padding:${m.top + 6}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;margin:0}
.cover .logo{height:${b.logo_height_mm}mm;margin-bottom:8mm;display:block} .cover .ctitle{font-family:${fontStack(b.font_heading)};font-weight:700;font-size:34pt;line-height:1.08;color:${prim};margin:0 0 4mm;border:0;string-set:doctitle content()}
.cover .csub{font-size:15pt;color:${muted};margin:0 0 10mm} .cover .cmeta{font-size:10pt;color:${muted};line-height:1.7} .cover .cmeta b{color:${ink}} .cover .cconf{position:absolute;left:${m.left}mm;bottom:${m.bottom}mm;font-size:9pt;letter-spacing:.12em;text-transform:uppercase;color:${muted}}
.cover.band::before{content:"";position:absolute;left:0;top:0;right:0;height:62mm;background:${prim}} .cover.band .logo{position:relative;z-index:1;filter:none} .cover.band .ctitle{margin-top:60mm} .cover.band .bar{position:absolute;left:0;top:62mm;right:0;height:3mm;background:${acc}}
.cover.full{background:${prim};color:${readable(prim)}} .cover.full .ctitle{color:${readable(prim)};margin-top:60mm;font-size:40pt} .cover.full .csub,.cover.full .cmeta,.cover.full .cmeta b,.cover.full .cconf{color:${readable(prim)}} .cover.full .bar{width:40mm;height:3mm;background:${acc};margin:8mm 0}
.cover.minimal .ctitle{margin-top:70mm;font-size:38pt} .cover.minimal .bar{width:30mm;height:2.2mm;background:${acc};margin:6mm 0 10mm}
.cover.split{padding-left:${pw * 0.36}mm} .cover.split::before{content:"";position:absolute;left:0;top:0;bottom:0;width:${pw * 0.3}mm;background:${prim}} .cover.split .logo{position:absolute;left:${m.left}mm;top:${m.top + 6}mm;z-index:1} .cover.split .ctitle{margin-top:60mm} .cover.split .bar{width:30mm;height:2.2mm;background:${acc};margin:6mm 0 10mm}
.titleblock{margin:0 0 1.2em} .titleblock .sub{color:${muted};font-size:1.1rem} .titleblock .meta{color:${muted};font-size:.85rem}
${wm}
${num}
${forScreen ? `@media screen{html{background:#d9dde3} body{max-width:${pw}mm;margin:12mm auto;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;box-shadow:0 0 0 1px #b8bec8;min-height:${ph - 20}mm} .cover{margin:-${m.top}mm -${m.right}mm 12mm -${m.left}mm;width:auto;height:${ph * 0.6}mm} .pagebreak{border-top:1px dashed #b8bec8;margin:10mm 0}}` : ""}
${String(b.custom_css || "").replace(/<\/?style/gi, "")}`;
}
/** Black or white, whichever reads better on `hex`. */
export function readable(hex) { const h = String(hex || "#000").replace("#", ""); const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0"); const [r, g, bl] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * bl > 150 ? "#111111" : "#ffffff"; }
/** Six-digit upper-case hex of a colour without the leading # (the form Word and Excel files need). */
export const hexNoHash = (c) => String(c || "000000").replace("#", "").slice(0, 6).toUpperCase().padEnd(6, "0");
