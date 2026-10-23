#!/usr/bin/env node
// Document toolbox for agents and people: render Claqueta Markdown (see the collado-documentos skill) to PDF / Word / HTML with a brand kit, preview pages as PNG to
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
//
// Project memoirs, gallery and graphics (see the collado-memorias skill):
//   collado-doc memoir catalog | list --program ID | new --program ID --kind subsidy|annual|client|season_close|festival|internal [--title T] [--funder F] [--ref R] [--lang es|ca|en]
//   collado-doc memoir show ID [--json]                          -> the brief: sections, what is missing per section, real figures of the project, gallery
//   collado-doc memoir write ID SECTION [file.md|-] [--status draft|review|approved|skipped] [--field key=value ...] [--fields file.json] [--media 1,2] [--visuals file.json] [--author NAME]
//   collado-doc memoir build ID                                  -> assembles the whole memoir into an editable document (#/doc/ID); then render/preview it as any document
//   collado-doc graphic types | render [spec.json] [--type T --title X --program N --data data.json] [-o out.svg|out.png] | save [spec.json] --program ID [--title X --caption Y --kind graphic] | svg file.svg --program ID [--title X]
//   collado-doc media frames VIDEO --program ID [--count 6] [--caption "..."]  -> stills from a video (needs ffmpeg) added to the gallery
//   collado-doc media list --program ID | add FILE... --program ID [--title --caption --credit --kind --phase --episode --rights --featured] | set ID --caption "..." [--credit .. --featured 1]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app, fail, parseArgs } from "./client.mjs";
import { runChecks, summarize, formatReport, pythonBin } from "./doccheck.mjs";

const { pos, flags, multi } = parseArgs(process.argv.slice(2), ["format", "doc", "template", "brand", "program", "episode", "season", "lang", "var", "title", "pages", "dpi", "source", "param", "spec", "type", "watermark", "kind", "funder", "ref", "status", "field", "fields", "media", "visuals", "author", "data", "caption", "credit", "phase", "rights", "featured", "alt", "people", "limit"]);
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
  case "memoir": {
    const [, sub, a1, a2] = pos; const ids = (v) => String(v ?? "").split(",").map(Number).filter(Boolean);
    switch (sub) {
      case "catalog": { const c = await app("GET", `/api/reports/memoir-catalog${flags.lang ? `?lang=${flags.lang}` : ""}`); for (const k of c.kinds) console.log(`${k.key.padEnd(13)} ${k.label}\n${" ".repeat(14)}${k.sections.join(", ")}`); console.log(""); for (const s of c.sections) { console.log(`${s.key.padEnd(14)} ${s.title}  [${s.words[1] ? s.words.join("-") + " palabras" : "visual"}]${s.perm ? "  (requiere " + s.perm + ")" : ""}\n${" ".repeat(15)}${s.purpose}`); for (const f of s.fields) console.log(`${" ".repeat(17)}- ${f.key} (${f.type}${f.cols ? ": " + f.cols.map((c) => c.key).join(", ") : ""})${f.required ? " *" : ""} ${f.label}`); } break; }
      case "list": { const r = await app("GET", `/api/e/memoirs?limit=100&sort=-updated${flags.program ? `&f.program_id=${num(flags.program)}` : ""}`); for (const m of r.rows) console.log(`${String(m.id).padEnd(4)} ${m.title}  [${m.kind}/${m.status}/${m.language}]${m.document_id ? "  doc #/doc/" + m.document_id : ""}`); break; }
      case "new": { if (!flags.program) fail("--program es obligatorio", 2); const m = await app("POST", "/api/actions/memoir-create", { program_id: num(flags.program), kind: flags.kind, title: flags.title, funder: flags.funder, funder_ref: flags.ref, language: flags.lang, brand_id: await resolve("brands", flags.brand, "name") }); console.log(JSON.stringify({ id: m.id, title: m.title, open: `#/memoir/${m.id}` })); break; }
      case "show": { const b = await app("GET", `/api/reports/memoir-brief?memoir=${num(a1)}`); if (flags.json) { console.log(JSON.stringify(b, null, 2)); break; }
        const m = b.memoir; console.log(`${m.title} [${m.kind}/${m.status}/${m.language}] · tono ${m.tone} · ${m.funder ? "para " + m.funder : "sin destinatario"}${m.funder_ref ? " (" + m.funder_ref + ")" : ""} · completitud ${b.overall} %\n${m.brief ? "ENCARGO: " + m.brief + "\n" : ""}`);
        for (const s of b.sections) { console.log(`${s.key.padEnd(14)} ${s.status.padEnd(8)} ${String(s.completeness).padStart(3)} %  ${s.words} palabras${s.guide ? ` (objetivo ${s.guide.words.join("-")})` : ""}${s.missing.length ? "  falta: " + s.missing.map((x) => (x.kind === "field" ? x.key : `texto ${x.have}/${x.need}`)).join(", ") : ""}${s.agent_brief ? "\n" + " ".repeat(15) + "ENCARGO: " + s.agent_brief : ""}`); }
        console.log("\nDATOS REALES DEL PROYECTO (úsalos; no inventes cifras):\n" + JSON.stringify(b.facts, null, 1).replace(/\n\s*/g, " ").slice(0, 3500)); console.log("\nGALERÍA (" + b.gallery.length + "): " + b.gallery.slice(0, 40).map((g) => `#${g.id} ${g.title}${g.caption ? " «" + g.caption.slice(0, 40) + "»" : " (sin pie)"}`).join(" · ")); break; }
      case "write": { if (!a2) fail("memoir write ID SECTION [file.md|-]", 2); const body = { memoir_id: num(a1), key: a2, author: flags.author || "Claude", origin: "agent" }; const f = pos[4];
        if (f === "-") body.body = fs.readFileSync(0, "utf8"); else if (f) body.body = fs.readFileSync(f, "utf8");
        if (flags.status) body.status = flags.status; if (flags.media) body.media_ids = ids(flags.media); if (flags.visuals) body.visuals = JSON.parse(fs.readFileSync(flags.visuals, "utf8"));
        const fields = flags.fields ? JSON.parse(fs.readFileSync(flags.fields, "utf8")) : {}; for (const [k, v] of Object.entries(kv(multi.field))) fields[k] = v; if (Object.keys(fields).length) body.fields = fields;
        const r = await app("POST", "/api/actions/memoir-section", body); console.log(JSON.stringify({ section: r.key, status: r.status, words: String(r.body || "").split(/\s+/).filter(Boolean).length })); break; }
      case "build": { const r = await app("POST", "/api/actions/memoir-build", { memoir_id: num(a1) }); console.log(JSON.stringify(r)); if (r.placeholders) console.error(`Quedan ${r.placeholders} secciones sin contenido ([Indicar: …]). Mira "memoir show ${a1}".`); break; }
      default: fail("memoir catalog | list | new | show | write | build", 2);
    }
    break;
  }
  case "graphic": {
    const [, sub, a1] = pos; const specFrom = () => { const sp = a1 ? JSON.parse(fs.readFileSync(a1, "utf8")) : {}; if (flags.type) sp.type = flags.type; if (flags.title) sp.title = flags.title; if (flags.program) sp.program = num(flags.program); if (flags.data) sp.data = JSON.parse(fs.readFileSync(flags.data, "utf8")); if (flags.source) sp.source = flags.source; Object.assign(sp, kv(multi.param)); if (!sp.type) fail("indica el tipo (--type o \"type\" en el JSON); mira: collado-doc graphic types", 2); return sp; };
    switch (sub) {
      case "types": for (const t of (await app("GET", "/api/graphics/types")).types) console.log(`${t.type.padEnd(14)} ${t.label}\n${" ".repeat(15)}spec: ${Object.entries(t.spec).map(([k, v]) => `${k} (${v})`).join("; ")}\n${" ".repeat(15)}ejemplo: ${JSON.stringify(t.example)}`); break;
      case "render": { const png = /\.png$/i.test(flags.o || ""); const g = await app("POST", "/api/graphics/render", { spec: specFrom(), lang: flags.lang, brand_id: await resolve("brands", flags.brand, "name"), png }); const out = flags.o || `grafico.svg`; fs.writeFileSync(out, png ? Buffer.from(g.png_base64 || "", "base64") : g.svg); console.log(`${out} (${g.width}x${g.height})${png && !g.png_base64 ? " — sin rasterizador (" + (g.png_error || "?") + "): se ha guardado vacío, usa .svg" : ""}`); break; }
      case "save": { if (!flags.program) fail("--program es obligatorio", 2); const r = await app("POST", "/api/graphics/save", { program_id: num(flags.program), spec: specFrom(), title: flags.title, caption: flags.caption, kind: flags.kind, phase: flags.phase, episode_id: num(flags.episode), lang: flags.lang, brand_id: await resolve("brands", flags.brand, "name"), origin: "agent" }); console.log(JSON.stringify({ media_id: r.id, title: r.title, size: `${r.width}x${r.height}` })); break; }
      case "svg": { if (!a1 || !flags.program) fail("graphic svg FILE.svg --program ID", 2); const r = await app("POST", "/api/graphics/save", { program_id: num(flags.program), svg: fs.readFileSync(a1, "utf8"), title: flags.title || path.basename(a1, ".svg"), caption: flags.caption, kind: flags.kind, origin: "agent" }); console.log(JSON.stringify({ media_id: r.id, title: r.title })); break; }
      default: fail("graphic types | render | save | svg", 2);
    }
    break;
  }
  case "media": {
    const [, sub, a1] = pos;
    switch (sub) {
      case "list": { if (!flags.program) fail("--program es obligatorio", 2); const r = await app("GET", `/api/e/media_items?limit=${flags.limit || 200}&f.program_id=${num(flags.program)}&sort=position,-id&refs=0`); for (const x of r.rows) console.log(`${String(x.id).padEnd(5)} ${x.title.slice(0, 38).padEnd(38)} ${(x.kind || "").padEnd(13)} ${(x.phase || "").padEnd(12)} ${x.width && x.height ? x.width + "x" + x.height : ""}${x.featured ? " ★" : ""}${x.caption ? "  «" + x.caption.slice(0, 50) + "»" : "  (sin pie de foto)"}`); break; }
      case "add": { if (!flags.program) fail("--program es obligatorio", 2); const files = pos.slice(2); if (!files.length) fail("indica uno o más ficheros de imagen", 2);
        for (const f of files) { const qs = new URLSearchParams({ program: String(num(flags.program)), name: path.basename(f), origin: "agent" }); for (const [k, v] of Object.entries({ title: files.length === 1 ? flags.title : undefined, caption: flags.caption, credit: flags.credit, kind: flags.kind, phase: flags.phase, episode_id: flags.episode, rights: flags.rights, featured: flags.featured === true ? 1 : flags.featured, alt_text: flags.alt, people: flags.people })) if (v !== undefined) qs.set(k, String(v)); const r = await app("POST", `/api/media?${qs}`, fs.readFileSync(f)); console.log(JSON.stringify({ media_id: r.id, title: r.title, size: `${r.width}x${r.height}` })); } break; }
      case "frames": { if (!flags.program || !a1 || !fs.existsSync(a1)) fail("media frames VIDEO.mp4 --program ID [--count 6]", 2);
        const bin = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg", probe = spawnSync(bin.replace("ffmpeg", "ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a1], { encoding: "utf8" });
        if (probe.error) fail("No hay ffmpeg/ffprobe instalado (mira `collado-doc check`). Instálalo con permiso de la persona o súbele imágenes ya extraídas.", 1);
        const dur = Number(String(probe.stdout).trim()), n = Math.max(1, Math.min(24, Number(flags.count) || 6)); if (!(dur > 0)) fail("No se pudo leer la duración del vídeo", 1);
        const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "frames-")); try { for (let i = 0; i < n; i++) { const t = (dur * (i + 0.5)) / n, out = path.join(dir, `fotograma-${String(i + 1).padStart(2, "0")}.jpg`);
          const r = spawnSync(bin, ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", a1, "-frames:v", "1", "-vf", "scale='min(1920,iw)':-2", "-q:v", "3", out]); if (r.status !== 0 || !fs.existsSync(out)) continue;
          const qs = new URLSearchParams({ program: String(num(flags.program)), name: path.basename(out), origin: "agent", kind: "still", title: `${path.basename(a1, path.extname(a1))} · ${Math.round(t)} s` }); if (flags.caption) qs.set("caption", flags.caption); if (flags.episode) qs.set("episode_id", flags.episode);
          const row = await app("POST", `/api/media?${qs}`, fs.readFileSync(out)); console.log(JSON.stringify({ media_id: row.id, title: row.title, at: `${Math.round(t)} s` })); } } finally { fs.rmSync(dir, { recursive: true, force: true }); } break; }
      case "set": { const patch = {}; for (const [k, fl] of [["caption", "caption"], ["credit", "credit"], ["title", "title"], ["kind", "kind"], ["phase", "phase"], ["rights", "rights"], ["alt_text", "alt"], ["people", "people"], ["featured", "featured"]]) if (flags[fl] !== undefined) patch[k] = flags[fl] === true ? 1 : flags[fl]; if (flags.episode) patch.episode_id = num(flags.episode); const r = await app("PATCH", `/api/e/media_items/${num(a1)}`, patch); console.log(JSON.stringify({ media_id: r.id, title: r.title })); break; }
      default: fail("media list | add | set", 2);
    }
    break;
  }
  default: fail(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"), 2);
}
