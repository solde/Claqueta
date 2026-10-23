// Orchestrator of the document engine: gathers context (programme, episode, company, variables), expands the template, parses Collado Markdown,
// resolves data/chart blocks with the caller's permissions, and renders to HTML / PDF / DOCX / XLSX / Markdown.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { q, getSetting } from "../db.mjs";
import * as E from "../engine.mjs";
import { readFileRaw } from "../files.mjs";
import { bad, today, log } from "../util.mjs";
import { optionLabel } from "../i18n/index.mjs";
import { norm as normLang, str, money, num, pct, date, datetime, duration, esc } from "./format.mjs";
import { expand } from "./vars.mjs";
import { parseDocument, parseBlocks, inlineText, parseInline } from "./markdown.mjs";
import { runSource } from "./datasets.mjs";
import { chartSvg } from "./charts.mjs";
import { resolveBrand, DEFAULT_BRAND } from "./brand.mjs";
import { renderHtml } from "./html.mjs";
import { renderGraphic } from "./graphics.mjs";
import { createHash } from "node:crypto";

export const FORMATS = { html: ["text/html; charset=utf-8", "html"], pdf: ["application/pdf", "pdf"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"], md: ["text/markdown; charset=utf-8", "md"], png: ["application/json", "json"] };

// ---- external tools ------------------------------------------------------------------------------------------------------------------
const cache = {};
export function hasTool(cmd) {
  if (cache[cmd] !== undefined) return cache[cmd];
  const dirs = String(process.env.PATH || "").split(path.delimiter); cache[cmd] = dirs.some((d) => { try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch { return false; } });
  return cache[cmd];
}
// Desktop build: the program that hosts us (Electron) offers PDF and SVG->PNG through its own Chromium over a local, key-protected endpoint: no WeasyPrint or librsvg to install.
const RENDER_URL = process.env.RENDER_URL || "", RENDER_KEY = process.env.RENDER_KEY || "";
async function renderService(route, body, contentType, timeoutMs = 90000) {
  const r = await fetch(`${RENDER_URL}${route}`, { method: "POST", headers: { "x-render-key": RENDER_KEY, "content-type": contentType }, body, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw bad(`render_failed:${route}`, { stderr: (await r.text().catch(() => "")).slice(0, 500) });
  return Buffer.from(await r.arrayBuffer());
}
/** Chromium has no `string-set`: the running title in the page margins is written literally (the document title is known at this point). */
function forChromium(html) {
  const title = (/<title>([^<]*)<\/title>/.exec(html)?.[1] || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const lit = JSON.stringify(title.slice(0, 120)).replace(/\u2028|\u2029/g, " ");
  return html.replaceAll("string(doctitle)", lit).replaceAll("string-set:doctitle content();", "").replaceAll("string-set:doctitle content()", "");
}
export const capabilities = () => ({ pdf: !!RENDER_URL || hasTool("weasyprint"), pdf_engine: RENDER_URL ? "Chromium" : "WeasyPrint", png: hasTool("pdftoppm"), svg_png: !!RENDER_URL || hasTool("rsvg-convert"), docx: true, xlsx: true, pptx: hasTool("python3") });
function run(cmd, args, input, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, HOME: os.tmpdir(), LANG: "C.UTF-8", ...(process.env.FONTCONFIG_PATH ? { FONTCONFIG_PATH: process.env.FONTCONFIG_PATH } : {}), ...(process.env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH } : {}) } });
    const out = [], err = []; let done = false;
    const t = setTimeout(() => { p.kill("SIGKILL"); if (!done) reject(bad("render_timeout")); }, timeoutMs);
    p.stdout.on("data", (c) => out.push(c)); p.stderr.on("data", (c) => err.push(c));
    p.on("error", (e) => { clearTimeout(t); done = true; reject(e.code === "ENOENT" ? bad(`tool_missing:${cmd}`) : e); });
    p.on("close", (code) => { clearTimeout(t); done = true; code === 0 ? resolve(Buffer.concat(out)) : reject(bad(`render_failed:${cmd}`, { stderr: Buffer.concat(err).toString().slice(0, 1500) })); });
    p.stdin.on("error", () => {}); p.stdin.end(input);
  });
}
let active = 0; const waiting = [];
async function limited(fn) { if (active >= 2) await new Promise((r) => waiting.push(r)); active++; try { return await fn(); } finally { active--; waiting.shift()?.(); } }
export async function htmlToPdf(html, { pdfa = false } = {}) {
  if (RENDER_URL) return limited(() => renderService("/pdf", forChromium(html), "text/html; charset=utf-8"));
  if (!hasTool("weasyprint")) throw bad("pdf_unavailable", { hint: "WeasyPrint is not installed; use the HTML export and print to PDF from the browser" });
  return limited(() => run("weasyprint", ["--quiet", "--media-type", "print", ...(pdfa ? ["--pdf-variant", "pdf/a-3b"] : []), "--optimize-images", "-", "-"], html));
}
export async function pdfToPng(pdf, { first = 1, last = 3, dpi = 70 } = {}) {
  if (!hasTool("pdftoppm")) throw bad("tool_missing:pdftoppm");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cld-png-"));
  try { fs.writeFileSync(path.join(dir, "in.pdf"), pdf); await run("pdftoppm", ["-png", "-r", String(dpi), "-f", String(first), "-l", String(last), path.join(dir, "in.pdf"), path.join(dir, "p")], "");
    return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => fs.readFileSync(path.join(dir, f)).toString("base64")); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
export async function svgToPng(svg, width = 1440, { debug } = {}) {
  if (RENDER_URL) { try { return await renderService(`/svg-png?width=${width}`, svg, "image/svg+xml", 20000); } catch (e) { if (debug) debug.error = String(e.message || e) + " " + (e.detail?.stderr || ""); return null; } }
  if (debug && !RENDER_URL) debug.error = "no RENDER_URL";
  if (!hasTool("rsvg-convert")) return null;
  try { return await run("rsvg-convert", ["-w", String(width), "-f", "png", "-b", "white"], svg, 20000); } catch { return null; }
}

/** Reduces a raster image to `max` pixels on its longest side (the desktop build does it with Electron; elsewhere the original is used). null = keep the original. */
export async function resizeImage(buffer, mime, max = 1800) {
  if (!RENDER_URL || !/^image\/(png|jpeg|gif|webp)$/.test(mime)) return null;
  try { const out = await renderService(`/image?max=${max}`, buffer, mime, 30000); return out.length && out.length < buffer.length ? { buffer: out, mime: out[0] === 0x89 ? "image/png" : "image/jpeg" } : null; } catch { return null; }
}
const imgCache = new Map();
/** { buffer, mime } of an image attachment, reduced to `max` pixels (cached): gallery thumbnails and pictures embedded in documents. */
export async function imageFor(attachmentId, max = 480) {
  const f = readFileRaw(attachmentId); if (!f || !/^image\//.test(f.mime)) return null;
  const key = `${attachmentId}:${max}:${createHash("sha1").update(f.buffer.subarray(0, 4096)).update(String(f.buffer.length)).digest("hex")}`, hit = imgCache.get(key); if (hit) return hit;
  const out = (await resizeImage(f.buffer, f.mime, max)) || { buffer: f.buffer, mime: f.mime };
  imgCache.set(key, out); if (imgCache.size > 120) imgCache.delete(imgCache.keys().next().value); return out;
}

// ---- context -------------------------------------------------------------------------------------------------------------------------
import { ENTITIES } from "../schema.mjs";
function safeRow(ctx, entity, id) {
  if (!id) return null;
  try { const r = E.getRow(ctx, entity, id); for (const fd of Object.values(ENTITIES[entity].fields)) if (fd.type === "ref" && r[fd.name]) r[`${fd.name}_label`] = E.label(fd.to, r[fd.name]); return r; } catch { return null; }
}
export function brandRowFor(ctx, brandId) {
  if (brandId) { const r = safeRow(ctx, "brands", brandId); if (r) return r; }
  const d = q.get("SELECT id FROM brands WHERE is_default = 1 ORDER BY id LIMIT 1"); return d ? safeRow(ctx, "brands", d.id) || {} : {};
}
const ENUM_LABEL = (lang) => (arg, v) => { const [entity, field] = String(arg).split("."); return optionLabel(lang, entity, field, v); };

export function buildContext(ctx, input, lang) {
  const program = safeRow(ctx, "programs", input.program_id), season = safeRow(ctx, "seasons", input.season_id), episode = safeRow(ctx, "episodes", input.episode_id);
  const prog = program || (episode && safeRow(ctx, "programs", episode.program_id)) || null;
  const company = getSetting("company", {});
  return { program: prog, season, episode, company, user: { name: ctx.name, username: ctx.user }, today: today(), date: today(), now: new Date().toISOString(), vars: input.vars || {}, brand: null, doc: { title: input.title || "" }, lang,
    currency: prog?.currency || "EUR" };
}

// ---- data blocks -> AST ---------------------------------------------------------------------------------------------------------------
const cellFor = (v, c, lang, cur) => {
  let text;
  switch (c.type) {
    case "money": text = money(v, lang, cur); break; case "num": text = num(v, lang, Number.isInteger(Number(v)) ? 0 : 2); break; case "pct": text = pct(v, lang); break;
    case "date": text = date(v, lang, "medium"); break; case "datetime": text = datetime(v, lang); break; case "duration": text = duration(v); break;
    case "bool": text = v ? "✓" : ""; break; case "tags": text = Array.isArray(v) ? v.join(", ") : ""; break;
    case "enum": text = c.enum ? optionLabel(lang, c.enum[0], c.enum[1], v) : String(v ?? ""); break;
    default: text = v == null ? "" : String(v);
  }
  return { inlines: parseInline(text.replace(/[\\`*_[\]]/g, "\\$&")), colspan: 1, align: c.align || "", cls: ["money", "num", "pct", "duration"].includes(c.type) ? "num" : "" };
};
export async function resolveBlocks(ctx, blocks, env) {
  const out = [];
  for (const b of blocks) {
    if (b.t === "data" || b.t === "chart") {
      const { source, title, caption, show, widths, total, type, x, y, width, height, stacked, ...params } = b.attrs;
      if (!source) { out.push({ t: "callout", kind: "danger", title: "", blocks: parseBlocks("**data/chart block without `source`**") }); env.warnings.push("block_without_source"); continue; }
      let ds; try { ds = await runSource(ctx, String(source), params, env.lang); } catch (e) { env.warnings.push(`source_failed:${source}:${e.message}`); out.push({ t: "callout", kind: "danger", title: "", blocks: parseBlocks(`**${esc(String(source))}**: ${esc(e.message)}`) }); continue; }
      if (b.t === "chart") {
        const svg = chartSvg({ type, x, y, title, width, height, stacked }, ds, env.brand, env.lang); out.push({ t: "chart", svg, ds, spec: { type, x, y, title }, caption: typeof caption === "string" ? caption : "" }); continue;
      }
      let cols = ds.columns; if (typeof show === "string") cols = show.split(",").map((k) => ds.columns.find((c) => c.key === k)).filter(Boolean);
      if (!ds.rows.length) { out.push({ t: "p", inlines: [{ k: "i", c: [{ k: "text", v: str(env.lang, "no_data") }] }] }); continue; }
      const cur = env.currency; const rows = ds.rows.map((r) => ({ cells: cols.map((c) => cellFor(r[c.key], c, env.lang, cur)), _cls: r._bold ? "group" : r._indent ? "indent" : "" }));
      let foot = null; if (ds.totals && total !== "0" && total !== false) foot = cols.map((c, i) => (ds.totals[c.key] !== undefined ? cellFor(ds.totals[c.key], c, env.lang, cur) : { inlines: i === 0 ? [{ k: "b", c: [{ k: "text", v: str(env.lang, "total") }] }] : [], colspan: 1 }));
      else if (total === "1" || total === true) { const sums = cols.map((c) => (c.total === "sum" ? ds.rows.filter((r) => !r._bold || !ds.rows.some((x) => x._indent)).reduce((a, r) => a + (Number(r[c.key]) || 0), 0) : undefined)); if (sums.some((x) => x !== undefined)) foot = cols.map((c, i) => (sums[i] !== undefined ? cellFor(sums[i], c, env.lang, cur) : { inlines: i === 0 ? [{ k: "b", c: [{ k: "text", v: str(env.lang, "total") }] }] : [], colspan: 1 })); }
      out.push({ t: "table", head: cols.map((c) => ({ inlines: [{ k: "text", v: c.label }], colspan: 1, align: c.align || "", cls: ["money", "num", "pct", "duration"].includes(c.type) ? "num" : "" })), rows, foot, caption: typeof title === "string" ? title : "", widths: typeof widths === "string" ? widths.split(",") : null, align: [] });
      continue;
    }
    if (b.t === "graphic") {
      let spec = { ...b.attrs }; if (b.body) { try { spec = { ...spec, ...JSON.parse(b.body) }; } catch { env.warnings.push("graphic_bad_json"); } }
      try { const g = await renderGraphic(ctx, spec, { brand: env.brand, lang: env.lang }); out.push({ t: "chart", svg: g.svg, caption: typeof spec.caption === "string" ? spec.caption : "" }); }
      catch (e) { env.warnings.push(`source_failed:graphic ${spec.type || ""}:${e.message}`); out.push({ t: "callout", kind: "warn", title: "", blocks: parseBlocks(`**graphic ${spec.type || ""}:** ${String(e.message).replace(/[*_`]/g, "")}`) }); }
      continue;
    }
    if (b.t === "gallery") {
      const items = []; const ids = String(b.attrs.ids || "").split(",").map((x) => Number(x.trim())).filter(Boolean);
      for (const id of ids) { try { const mi = E.getRow(ctx, "media_items", id); if (!mi.attachment_id) continue; const im = await imageFor(mi.attachment_id, b.attrs.layout === "logos" ? 500 : 1600); if (im) items.push({ src: `data:${im.mime};base64,${im.buffer.toString("base64")}`, caption: mi.caption || mi.title || "", credit: mi.credit || "", alt: mi.alt_text || mi.title || "", w: mi.width || 0, h: mi.height || 0, id }); } catch { /* not visible to this person */ } }
      for (const line of String(b.body || "").split("\n").map((l) => l.trim()).filter(Boolean)) { const m = /^att:(\d+)\s*(?:\|\s*(.*))?$/.exec(line); if (!m) continue; const im = await imageFor(m[1], 1600); if (im) items.push({ src: `data:${im.mime};base64,${im.buffer.toString("base64")}`, caption: m[2] || "", credit: "", alt: m[2] || "", w: 0, h: 0 }); }
      if (!items.length) { env.warnings.push("gallery_empty"); continue; }
      out.push({ t: "gallery", layout: ["mosaic", "strip", "hero", "grid", "logos"].includes(b.attrs.layout) ? b.attrs.layout : items.length === 1 ? "hero" : "mosaic", items, title: typeof b.attrs.title === "string" ? b.attrs.title : "" }); continue;
    }
    const nb = { ...b };
    if (b.blocks) nb.blocks = await resolveBlocks(ctx, b.blocks, env);
    if (b.cols) nb.cols = await Promise.all(b.cols.map((c) => resolveBlocks(ctx, c, env)));
    if (b.extra) nb.extra = await resolveBlocks(ctx, b.extra, env);
    out.push(nb);
  }
  return out;
}

/** Everything needed to render: { doc: {meta, blocks}, brand, lang, warnings, source }. */
export async function buildDocument(ctx, input) {
  let md = input.markdown, row = null;
  if (input.document_id) { row = E.getRow(ctx, "documents", input.document_id); md ??= row.content; }
  const template = input.template_id ? E.getRow(ctx, "doc_templates", input.template_id) : null;
  if (md === undefined || md === null) { if (!template) throw bad("nothing_to_render"); md = template.body; }
  const lang = normLang(input.lang || row?.language || template?.language || ctx.lang);
  const merged = { ...input, program_id: input.program_id ?? row?.program_id, episode_id: input.episode_id ?? row?.episode_id, vars: { ...(template?.variables ? Object.fromEntries((Array.isArray(template.variables) ? template.variables : []).map((v) => [v.key, v.default !== undefined ? v.default : ""])) : {}), ...(row?.vars || {}), ...(input.vars || {}) }, title: input.title || row?.title || template?.name || "" };
  const data = buildContext(ctx, merged, lang);
  const brandRow = brandRowFor(ctx, input.brand_id || row?.brand_id || template?.brand_id);
  const options = { ...(template?.options || {}), ...(row?.options || {}), ...(input.options || {}) };
  const brand = resolveBrand(brandRow, { ...(input.brand || {}), ...(options.brand || {}), ...(options.page_size ? { page_size: options.page_size } : {}), ...(options.orientation ? { orientation: options.orientation } : {}), ...(options.watermark !== undefined ? { watermark: options.watermark } : {}) });
  data.brand = { name: brand.name }; data.doc.title = merged.title;
  const exp = expand(md, data, { lang, currency: data.currency, label: ENUM_LABEL(lang) });
  const parsed = parseDocument(exp.text);
  const meta = { title: merged.title, subtitle: "", author: ctx.name, date: today(), version: row?.version ? `v${row.version}` : "", confidentiality: brand.confidentiality, client: data.program?.client_id ? (E.label("partners", data.program.client_id)) : "", ...options, ...parsed.meta };
  if (options.cover !== undefined && parsed.meta.cover === undefined) meta.cover = options.cover === true ? "yes" : options.cover;
  if (meta.title !== undefined && !meta.title) meta.title = merged.title;
  const env = { lang, brand, warnings: [], currency: data.currency };
  const blocks = await resolveBlocks(ctx, parsed.blocks, env);
  const reduced = new Map(); for (const id of new Set([...exp.text.matchAll(/att:(\d+)/g)].map((x) => x[1]))) { const im = await imageFor(id, 1800); if (im) reduced.set(id, `data:${im.mime};base64,${im.buffer.toString("base64")}`); }
  const attMap = (src) => { const m = /^att:(\d+)$/.exec(src); if (m) return reduced.get(m[1]) || ""; if (src === "logo") return brand.logo || ""; return /^data:image\//.test(src) ? src : ""; };
  const unresolved = exp.missing.filter((m) => !m.startsWith("@"));
  return { doc: { meta, blocks, imageResolver: attMap }, brand, lang, warnings: [...env.warnings, ...unresolved.map((m) => `missing_variable:${m}`)], source: exp.text, rowId: row?.id, programId: merged.program_id };
}

export async function renderDocument(ctx, input, format = "html") {
  if (!FORMATS[format]) throw bad("unknown_format");
  const b = await buildDocument(ctx, input);
  if (format === "md") return { buffer: Buffer.from(b.source, "utf8"), mime: FORMATS.md[0], ext: "md", warnings: b.warnings, title: b.doc.meta.title };
  const html = renderHtml(b.doc, b.brand, { lang: b.lang, forScreen: input.screen === true });
  if (format === "html") return { buffer: Buffer.from(html, "utf8"), mime: FORMATS.html[0], ext: "html", warnings: b.warnings, title: b.doc.meta.title };
  if (format === "pdf" || format === "png") {
    const printHtml = renderHtml(b.doc, b.brand, { lang: b.lang, forScreen: false });
    const pdf = await htmlToPdf(printHtml, { pdfa: input.pdfa === true });
    if (format === "pdf") return { buffer: pdf, mime: FORMATS.pdf[0], ext: "pdf", warnings: b.warnings, title: b.doc.meta.title };
    const pages = await pdfToPng(pdf, { first: Number(input.first) || 1, last: Number(input.last) || 3, dpi: Number(input.dpi) || 70 });
    return { buffer: Buffer.from(JSON.stringify({ pages }), "utf8"), mime: "application/json", ext: "json", warnings: b.warnings, title: b.doc.meta.title };
  }
  if (format === "docx") { const { buildDocx } = await import("./docx.mjs"); const buffer = await buildDocx(b, { svgToPng }); return { buffer, mime: FORMATS.docx[0], ext: "docx", warnings: b.warnings, title: b.doc.meta.title }; }
  throw bad("unknown_format");
}
export { DEFAULT_BRAND, inlineText };
