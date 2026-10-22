#!/usr/bin/env node
// Document toolbox for agents and people: render Collado Markdown (see the collado-documentos skill) to PDF / Word / HTML with a brand kit, preview pages as PNG to
// check the layout, lint, create editable documents in the app, export tables to Excel, build slide decks.
//   collado-doc caps | sources | templates | brands
//   collado-doc check [--program ID] [--json]                                             -> toolbox check: what is missing to make documents at the best quality, and how to install it (run it when you start a project)
//   collado-doc render [file.md|-] --format pdf|docx|html|md [-o out] [--doc ID | --template KEY] [--brand NAME] [--program ID] [--episode ID] [--season ID]
//                      [--lang es|ca|en] [--var key=value ...] [--title T] [--cover | --cover=band|full|minimal|split] [--landscape] [--watermark TEXT] [--pdfa]
//   collado-doc preview [same options as render] [--pages 1-3] [--dpi 70] [-o prefix]    -> prefix-1.png ... (open them with the Read tool to LOOK at the result)
//   collado-doc lint [file.md] [--program ID ...]                                         -> unresolved variables, failed data blocks, placeholders, structure
//   collado-doc new --template KEY --program ID [--episode ID] [--title T] [--var k=v]    -> creates an editable document in the app
//   collado-doc save file.md --program ID [--type report] [--title T] [--shared]          -> stores a Markdown file as a document
//   collado-doc xlsx --source NAME [--param k=v ...] [-o out.xlsx] | --spec spec.json     -> Excel with typed columns, SUM totals, brand header
//   collado-doc deck spec.json [-o out.pptx] [--brand NAME]                               -> PowerPoint (python-pptx), spec format in the skill
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app, fail, parseArgs } from "./client.mjs";
import { runChecks, summarize, formatReport, pythonBin } from "./doccheck.mjs";

const { pos, flags, multi } = parseArgs(process.argv.slice(2), ["format", "doc", "template", "brand", "program", "episode", "season", "lang", "var", "title", "pages", "dpi", "source", "param", "spec", "type", "watermark"]);
const [cmd, file] = pos;
const kv = (arr = []) => Object.fromEntries(arr.map((s) => { const i = s.indexOf("="); if (i < 0) fail(`argumento no válido: ${s} (usa clave=valor)`); return [s.slice(0, i), s.slice(i + 1)]; }));
const num = (v) => (v === undefined ? undefined : Number(v));
async function resolve(entity, ref, keyField) { if (ref === undefined) return undefined; if (/^\d+$/.test(ref)) return Number(ref); const r = await app("GET", `/api/e/${entity}?limit=200`); const f = r.rows.find((x) => x[keyField] === ref || x.name === ref); if (!f) fail(`${entity}: «${ref}» no existe (disponibles: ${r.rows.map((x) => x[keyField] || x.name).join(", ")})`); return f.id; }
async function payload() {
  const p = { program_id: num(flags.program), episode_id: num(flags.episode), season_id: num(flags.season), lang: flags.lang, title: flags.title, vars: kv(multi.var), options: {} };
  if (file && file !== "-") p.markdown = fs.readFileSync(file, "utf8"); else if (file === "-") p.markdown = fs.readFileSync(0, "utf8");
  if (flags.doc) p.document_id = Number(flags.doc);
  if (flags.template) p.template_id = await resolve("doc_templates", flags.template, "key");
  if (flags.brand) p.brand_id = await resolve("brands", flags.brand, "name");
  if (flags.cover) p.options.cover = flags.cover === true ? "yes" : flags.cover;
  if (flags.landscape) p.options.orientation = "landscape";
  if (flags.watermark) p.options.watermark = flags.watermark;
  if (flags.pdfa) p.pdfa = true;
  if (p.markdown === undefined && !p.document_id && !p.template_id) fail("indica un fichero .md (o - para stdin), --doc ID o --template KEY", 2);
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  return p;
}
const base = (p) => flags.o || (file && file !== "-" ? file.replace(/\.[^.]+$/, "") : (flags.template || "documento"));
async function render(format, extra = {}) {
  const res = await app("POST", "/api/docs/render", { ...(await payload()), format, ...extra }, { raw: true });
  const warn = (() => { try { return JSON.parse(decodeURIComponent(res.headers.get("x-collado-warnings") || "[]")); } catch { return []; } })();
  return { res, warn };
}
const pdfNote = (w) => { if (w.length) console.error("avisos:\n  - " + w.join("\n  - ")); };

switch (cmd) {
  case "check": {
    const caps = await app("GET", "/api/docs/capabilities").catch(() => ({ tools: {} })), brands = (await app("GET", "/api/e/brands?limit=100").catch(() => ({ rows: [] }))).rows || [];
    const program = flags.program ? (await app("GET", `/api/e/programs/${num(flags.program)}`).catch(() => null))?.row || null : null;
    const results = runChecks({ caps, brands, program }), sum = summarize(results);
    if (flags.json) console.log(JSON.stringify({ platform: process.platform, ...sum, results }, null, 2)); else console.log(formatReport(results, { app: process.env.APP_DISPLAY_NAME || "" }));
    process.exit(sum.ok ? 0 : 1);
  }
  case "caps": console.log(JSON.stringify(await app("GET", "/api/docs/capabilities"), null, 2)); break;
  case "sources": for (const s of (await app("GET", "/api/docs/sources")).sources) console.log(`${s.name.padEnd(18)} ${s.label}\n${" ".repeat(19)}parámetros: ${s.params.join(", ")}`); break;
  case "templates": for (const t of (await app("GET", "/api/e/doc_templates?limit=200&sort=name")).rows) console.log(`${(t.key || String(t.id)).padEnd(18)} ${t.name} [${t.type}/${t.language}]${t.variables?.length ? "  vars: " + t.variables.map((v) => v.key).join(", ") : ""}`); break;
  case "brands": for (const b of (await app("GET", "/api/e/brands?limit=100&sort=name")).rows) console.log(`${String(b.id).padEnd(4)} ${b.name.padEnd(16)} ${b.primary} / ${b.accent}  ${b.font_heading}/${b.font_body}  cover=${b.cover}${b.is_default ? "  (por defecto)" : ""}`); break;
  case "render": {
    const format = flags.format || "pdf"; if (!["pdf", "docx", "html", "md"].includes(format)) fail("--format debe ser pdf, docx, html o md", 2);
    const { res, warn } = await render(format); const out = (flags.o && /\.\w+$/.test(flags.o) ? flags.o : `${base()}.${format}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer())); console.log(`${out} (${fs.statSync(out).size} bytes)`); pdfNote(warn); break;
  }
  case "preview": {
    const [first, last] = String(flags.pages || "1-3").split("-").map(Number); const { res, warn } = await render("png", { first, last: last || first, dpi: num(flags.dpi) || 70 }); const j = await res.json();
    const prefix = flags.o || `${base()}-preview`; j.pages.forEach((b64, i) => { const f = `${prefix}-${first + i}.png`; fs.writeFileSync(f, Buffer.from(b64, "base64")); console.log(f); }); pdfNote(j.warnings || warn); break;
  }
  case "lint": {
    const r = await app("POST", "/api/docs/lint", await payload());
    console.log(`${r.ok ? "OK" : "CON ERRORES"} · ${r.stats.words} palabras · ~${r.stats.pages_estimate} págs · ${r.stats.headings} títulos · ${r.stats.tables} tablas`);
    for (const i of r.issues) console.log(`  ${i.level.padEnd(5)} ${i.code}${i.message ? ": " + i.message : ""}`); process.exit(r.ok ? 0 : 1);
  }
  case "new": {
    if (!flags.template) fail("--template es obligatorio", 2);
    const d = await app("POST", "/api/docs/from-template", { template_id: await resolve("doc_templates", flags.template, "key"), program_id: num(flags.program), episode_id: num(flags.episode), season_id: num(flags.season), title: flags.title, vars: kv(multi.var), lang: flags.lang, brand_id: flags.brand ? await resolve("brands", flags.brand, "name") : undefined });
    console.log(JSON.stringify({ id: d.id, title: d.title, open: `#/doc/${d.id}` })); break;
  }
  case "save": {
    if (!file || !fs.existsSync(file)) fail("indica el fichero .md", 2); const md = fs.readFileSync(file, "utf8"); const title = flags.title || (/^#\s+(.+)$/m.exec(md)?.[1] ?? path.basename(file, ".md"));
    const d = await app("POST", "/api/e/documents", { title, content: md, type: flags.type || "other", program_id: num(flags.program), episode_id: num(flags.episode), language: flags.lang || "es", status: "draft", shared: flags.shared ? 1 : 0, brand_id: flags.brand ? await resolve("brands", flags.brand, "name") : undefined });
    console.log(JSON.stringify({ id: d.id, title: d.title, open: `#/doc/${d.id}` })); break;
  }
  case "xlsx": {
    const body = flags.spec ? JSON.parse(fs.readFileSync(flags.spec, "utf8")) : { source: flags.source, params: kv(multi.param) }; if (!body.source && !body.sheets) fail("indica --source NAME o --spec fichero.json", 2);
    if (flags.brand) body.brand_id = await resolve("brands", flags.brand, "name"); if (flags.lang) body.lang = flags.lang;
    const res = await app("POST", "/api/docs/xlsx", body, { raw: true }); const out = flags.o || `${body.source || "datos"}.xlsx`; fs.writeFileSync(out, Buffer.from(await res.arrayBuffer())); console.log(`${out} (${fs.statSync(out).size} bytes)`); break;
  }
  case "deck": {
    if (!file) fail("indica spec.json", 2); const out = flags.o || file.replace(/\.json$/, "") + ".pptx";
    let brand = {}; try { const bid = flags.brand ? await resolve("brands", flags.brand, "name") : (await app("GET", "/api/e/brands?limit=100")).rows.find((b) => b.is_default)?.id; if (bid) brand = (await app("GET", `/api/e/brands/${bid}`)).row; } catch { /* default look */ }
    const tmp = path.join(process.env.TMPDIR || "/tmp", `deck-brand-${process.pid}.json`); fs.writeFileSync(tmp, JSON.stringify(brand));
    const py = path.join(path.dirname(new URL(import.meta.url).pathname), "colladodeck.py");
    const r = spawnSync(pythonBin(), ["-I", py, file, out, tmp], { stdio: "inherit" }); fs.rmSync(tmp, { force: true }); process.exit(r.status ?? 1);
  }
  default: fail(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"), 2);
}
