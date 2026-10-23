import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, ".."), T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-mem-")), APP = path.join(ROOT, "app-seed/app");
process.env.COLLADO_DESKTOP = "1"; process.env.WORKSPACE_DIR = path.join(T, "shared");
const { openDb, syncSchema } = await import(`${APP}/lib/db.mjs`), { initKey } = await import(`${APP}/lib/crypto.mjs`), E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`);
const { localCtx } = await import(`${APP}/lib/access.mjs`), M = await import(`${APP}/lib/memoir.mjs`), MEDIA = await import(`${APP}/lib/media.mjs`), { renderGraphic, GRAPHIC_TYPES } = await import(`${APP}/lib/docs/graphics.mjs`);
const { renderDocument } = await import(`${APP}/lib/docs/render.mjs`), { imageInfo } = await import(`${APP}/lib/docs/imageinfo.mjs`), { chartSvg } = await import(`${APP}/lib/docs/charts.mjs`), { SECTIONS, catalog, completeness, defaultSections, KINDS } = await import(`${APP}/lib/memoir-catalog.mjs`);
const { resolveBrand } = await import(`${APP}/lib/docs/brand.mjs`);
initKey(T); openDb(T); syncSchema(); const ctx = localCtx("david");

// a real 2x1 PNG, built here so the test needs no fixtures
function png(w, h, rgb = [200, 60, 60]) {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), c = Buffer.alloc(4); len.writeUInt32BE(data.length); c.writeUInt32BE(crc(b)); return Buffer.concat([len, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const brand = resolveBrand({ primary: "#1f3a5f", accent: "#e0a100" });

test("catalogue: every section has purpose, sensible fields and belongs to at least one kind; every kind gets an ordered, non-empty set", () => {
  for (const [k, s] of Object.entries(SECTIONS)) { assert.ok(s.title.es && s.title.en && s.title.ca, k); assert.ok(s.purpose.es && s.purpose.en, k); assert.ok(s.kinds.length, k); for (const f of s.fields) { assert.ok(f.label.es && f.label.en && f.label.ca, `${k}.${f.key}`); if (f.type === "list") assert.ok(f.cols?.length, `${k}.${f.key} cols`); } }
  for (const kind of KINDS) { const d = defaultSections(kind); assert.ok(d.includes("exec_summary") && d.length >= 8, kind); }
  assert.equal(catalog("en").sections.find((s) => s.key === "economic").title, "Financial report");
});

test("completeness counts required fields and text length", () => {
  assert.equal(completeness("objectives", { body: "", fields: {} }).pct, 0);
  const c = completeness("objectives", { body: "x ".repeat(120), fields: { objectives: [{ objective: "a", target: 1 }] } }); assert.equal(c.pct, 100);
  assert.deepEqual(completeness("exec_summary", { body: "corto", fields: { one_liner: "x" } }).missing.map((m) => m.kind), ["text"]);
});

test("image info reads png size and rejects non-images", () => { assert.deepEqual(imageInfo(png(30, 20)), { w: 30, h: 20, mime: "image/png" }); assert.equal(imageInfo(Buffer.from("hola mundo, esto no es una imagen")), null); assert.equal(imageInfo(Buffer.from('<svg xmlns="x" viewBox="0 0 300 200"></svg>       ')).w, 300); });

test("new chart types draw: waterfall (totals and deltas), heatmap and area", () => {
  const ds = { columns: [{ key: "n", label: "n" }, { key: "v", label: "v", type: "money" }], rows: [{ n: "Presupuesto", v: 100, kind: "total" }, { n: "A", v: -10 }, { n: "B", v: 5 }, { n: "Real", v: 95, kind: "total" }] };
  const wf = chartSvg({ type: "waterfall", x: "n", y: "v" }, ds, brand, "es"); assert.match(wf, /<svg/); assert.equal((wf.match(/<rect /g) || []).length, 4, "one bar per row (+0 background)");
  const hm = chartSvg({ type: "heatmap", x: "n", y: "v" }, ds, brand, "es"); assert.match(hm, /rx="3"/);
  const ar = chartSvg({ type: "area", x: "n", y: "v" }, ds, brand, "es"); assert.match(ar, /<polygon/);
});

test("every graphic type renders valid SVG from inline data", async () => {
  const prog = await E.create(ctx, "programs", { name: "Gráficos", folder: path.join(T, "g"), genre: "Magazine" });
  await E.create(ctx, "milestones", { program_id: prog.id, title: "Rodaje", start_date: "2026-02-01", end_date: "2026-02-10" }); await E.create(ctx, "milestones", { program_id: prog.id, title: "Emisión", start_date: "2026-04-01" });
  await E.create(ctx, "locations", { program_id: prog.id, name: "Plató", city: "Barcelona", lat: 41.39, lng: 2.17, shoot_days: 6 }); await E.create(ctx, "locations", { program_id: prog.id, name: "Playa", city: "Sitges", lat: 41.23, lng: 1.81, shoot_days: 2 });
  await E.create(ctx, "episodes", { program_id: prog.id, number: 1, title: "Uno", duration_target: 3000, shoot_date: "2026-02-02" });
  const specs = { stats: { type: "stats", auto: 1, program: prog.id, title: "En cifras", stats: [{ value: "99", label: "extra", icon: "star" }] }, quote: { type: "quote", text: "Una frase larga que debe partirse en varias líneas para que quepa bien en la tarjeta de cita.", person: "Ana", role: "Directora" },
    timeline: { type: "timeline", source: "milestones", program: prog.id, title: "Cronología" }, orgchart: { type: "orgchart", root: { name: "Programa", children: [{ name: "Dirección", children: [{ name: "Ana" }, { name: "Luis" }] }, { name: "Realización", children: [{ name: "Marta" }] }] } },
    locations_map: { type: "locations_map", source: "locations", program: prog.id, title: "Rodaje" }, kpi_bars: { type: "kpi_bars", items: [{ label: "Episodios", target: 10, achieved: 10 }, { label: "Audiencia", target: 300, achieved: 200, unit: "miles" }] },
    divider: { type: "divider", number: 3, title: "Resultados y audiencia", subtitle: "Memoria 2026" }, cover_art: { type: "cover_art", title: "Memoria anual 2026", subtitle: "Gráficos", footer: "Productora" },
    chart: { type: "chart", chart_type: "waterfall", title: "Cascada", data: { rows: [{ label: "Presupuesto", value: 100, kind: "total" }, { label: "A", value: -10 }, { label: "Real", value: 90, kind: "total" }] } } };
  assert.deepEqual(Object.keys(specs).sort(), Object.keys(GRAPHIC_TYPES).sort(), "a spec per type");
  for (const [type, spec] of Object.entries(specs)) { const g = await renderGraphic(ctx, spec, { brand, lang: "es" }); assert.match(g.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+"/, type); assert.ok(g.svg.endsWith("</svg>") && g.width > 300 && g.height > 120, type); assert.ok(!/NaN|undefined/.test(g.svg), `${type}: ${g.svg.match(/.{20}(NaN|undefined).{20}/)?.[0]}`); }
  const st = await renderGraphic(ctx, specs.stats, { brand, lang: "es" }); assert.match(st.svg, /En cifras/); assert.match(st.svg, />99</); assert.match(st.svg, /días de rodaje/);
  await assert.rejects(renderGraphic(ctx, { type: "nope" }, { brand }), /unknown_graphic/); await assert.rejects(renderGraphic(ctx, { type: "kpi_bars", items: [] }, { brand }), /graphic_no_data/);
  const evil = await renderGraphic(ctx, { type: "quote", text: '<script>alert(1)</script> & "x"', person: "<b>" }, { brand }); assert.ok(!/<script|<b>/.test(evil.svg), "text is escaped");
});

test("gallery: upload an image (size read, file attached), generate a graphic into the gallery, thumbnails and access", async () => {
  const prog = await E.create(ctx, "programs", { name: "Galería", folder: path.join(T, "gal") });
  const a = await MEDIA.addMedia(ctx, { program_id: prog.id, name: "set-grabacion.png", buffer: png(40, 20), caption: "Día de rodaje", credit: "Ana Ruiz", kind: "behind_scenes", featured: 1 });
  assert.equal(a.title, "set grabacion"); assert.equal(a.width, 40); assert.equal(a.height, 20); assert.equal(a.origin, "upload"); assert.ok(a.attachment_id); assert.equal(a.kind, "behind_scenes");
  await assert.rejects(MEDIA.addMedia(ctx, { program_id: prog.id, name: "x.txt", buffer: Buffer.from("no soy una imagen de verdad") }), /not_an_image/);
  const g = await MEDIA.saveGraphic(ctx, { program_id: prog.id, spec: { type: "quote", text: "Hola", person: "Yo" }, title: "Cita", caption: "Una cita" });
  assert.equal(g.kind, "graphic"); assert.equal(g.origin, "generated"); assert.ok(g.attachment_id); assert.deepEqual(g.spec.type, "quote");
  const im = await MEDIA.imageFor(a.attachment_id, 480); assert.ok(im.buffer.length > 30 && /^image\//.test(im.mime)); assert.equal(await MEDIA.imageFor(999999, 480), null);
  assert.equal(E.list(ctx, "media_items", { filters: { program_id: prog.id }, limit: 10, refs: "0" }).rows.length, 2);
});

test("memoir: created with the sections of its kind, sections are written by key (merged fields), facts are real, the brief says what is missing", async () => {
  const prog = await E.create(ctx, "programs", { name: "La memoria", folder: path.join(T, "mem"), logline: "Un programa", genre: "Divulgación", language: "es" });
  for (let i = 1; i <= 3; i++) await E.create(ctx, "episodes", { program_id: prog.id, number: i, title: `Ep ${i}`, duration_target: 1800, shoot_date: `2026-03-0${i}`, air_date: `2026-04-0${i}`, status: "delivered" });
  await E.create(ctx, "ratings", { program_id: prog.id, date: "2026-04-01", audience_avg: 250, share_pct: 7.5, target_label: "Total" });
  const m = await M.createMemoir(ctx, { program_id: prog.id, kind: "subsidy", funder: "ICAA", funder_ref: "EXP-12" });
  assert.equal(m.kind, "subsidy"); assert.match(m.title, /Justificación de subvención o ayuda · La memoria/);
  const secs = E.list(ctx, "memoir_sections", { filters: { memoir_id: m.id }, limit: 100, refs: "0", sort: "position" }).rows; assert.deepEqual(secs.map((s) => s.key), defaultSections("subsidy")); assert.ok(secs.every((s) => s.status === "empty"));
  const f = M.facts(ctx, prog.id); assert.equal(f.episodes.count, 3); assert.equal(f.runtime.planned_min, 90); assert.equal(f.shoot.days, 3); assert.equal(f.audience.avg_share, 7.5); assert.equal(f.program.name, "La memoria");
  await M.saveSection(ctx, { memoir_id: m.id, key: "exec_summary", body: "Un resumen. ".repeat(60), fields: { one_liner: "Tres episodios en abril" }, author: "Claude", origin: "agent" });
  await M.saveSection(ctx, { memoir_id: m.id, key: "exec_summary", fields: { conclusion: "Todo bien" } });
  let s = E.list(ctx, "memoir_sections", { filters: { memoir_id: m.id, key: "exec_summary" }, limit: 1, refs: "0" }).rows[0]; assert.equal(s.status, "draft"); assert.deepEqual(s.fields, { one_liner: "Tres episodios en abril", conclusion: "Todo bien" }, "fields merge"); assert.equal(s.origin, "agent");
  await assert.rejects(M.saveSection(ctx, { memoir_id: m.id, key: "inventada", body: "x" }), /unknown_section/);
  const b = M.brief(ctx, m.id); assert.equal(b.sections.find((x) => x.key === "exec_summary").completeness, 100); assert.equal(b.sections.find((x) => x.key === "objectives").completeness, 0); assert.ok(b.sections.find((x) => x.key === "objectives").missing.length); assert.equal(b.facts.episodes.count, 3); assert.ok(b.overall > 0 && b.overall < 100);
  return { prog, m };
});

test("memoir: assembly into one document with text, structured tables, gallery, auto graphics and placeholders; renders to HTML and Word", async () => {
  const prog = await E.create(ctx, "programs", { name: "Memoria completa", folder: path.join(T, "full"), genre: "Magazine" });
  for (let i = 1; i <= 2; i++) await E.create(ctx, "episodes", { program_id: prog.id, number: i, title: `Capítulo ${i}`, duration_target: 3000, shoot_date: `2026-05-0${i}` });
  await E.create(ctx, "locations", { program_id: prog.id, name: "Plató 1", lat: 41.4, lng: 2.17, shoot_days: 4 });
  const a = await MEDIA.addMedia(ctx, { program_id: prog.id, name: "a.png", buffer: png(60, 40), caption: "Equipo en el plató", credit: "Luis", featured: 1 }), b = await MEDIA.addMedia(ctx, { program_id: prog.id, name: "b.png", buffer: png(40, 40, [20, 120, 200]), caption: "Detrás de cámaras" });
  const m = await M.createMemoir(ctx, { program_id: prog.id, kind: "annual", title: "Memoria 2026", funder: "Canal Demo" });
  await M.saveSection(ctx, { memoir_id: m.id, key: "exec_summary", body: "## Lo esencial\n\nSe produjeron **dos** capítulos.", fields: { highlights: [{ text: "Dos capítulos entregados" }, { text: "Rodaje en plató propio" }] } });
  await M.saveSection(ctx, { memoir_id: m.id, key: "objectives", fields: { objectives: [{ objective: "Entregar 2 capítulos", indicator: "capítulos", target: 2, achieved: 2, unit: "ud" }] }, body: "Se cumplió." });
  await M.saveSection(ctx, { memoir_id: m.id, key: "gallery", media_ids: [a.id, b.id], fields: { layout: "mosaic", intro: "Algunos momentos" } });
  await M.saveSection(ctx, { memoir_id: m.id, key: "impact", visuals: [{ type: "quote", text: "Muy buen programa", person: "Marta", role: "Espectadora" }], fields: { quotes: [{ text: "Muy buen programa", person: "Marta", role: "Espectadora" }] } });
  await M.saveSection(ctx, { memoir_id: m.id, key: "risks_lessons", status: "skipped" });
  const built = await M.buildMemoir(ctx, m.id); assert.ok(built.document_id); assert.ok(built.placeholders > 0, "empty sections leave [Indicar: …] for the lint");
  const doc = E.getRow(ctx, "documents", built.document_id); assert.equal(doc.type, "report"); assert.match(doc.content, /^---\ntitle: "Memoria 2026"/); assert.match(doc.content, /client: "Canal Demo"/);
  assert.match(doc.content, /# Resumen ejecutivo\n\n## Lo esencial/); assert.match(doc.content, /\| Objetivo \| Indicador \|/); assert.match(doc.content, /:::gallery ids=\d+,\d+ layout=mosaic/); assert.match(doc.content, /:::graphic type=stats auto=1/); assert.match(doc.content, /:::graphic type=quote/); assert.ok(!/# Riesgos y lecciones/.test(doc.content), "skipped sections are left out");
  assert.match(doc.content, /^- Dos capítulos entregados$/m); assert.match(doc.content, /> Muy buen programa\n> — Marta, Espectadora/);
  const again = await M.buildMemoir(ctx, m.id); assert.equal(again.document_id, built.document_id, "rebuilding updates the same document");
  const html = (await renderDocument(ctx, { document_id: built.document_id }, "html")); const h = html.buffer.toString("utf8");
  assert.match(h, /Equipo en el plató/); assert.match(h, /class="gallery/); assert.match(h, /<figure class="chart"><svg/); assert.match(h, /días de rodaje|shoot days/); assert.ok(!/\[object|NaN/.test(h), "no leftovers"); assert.ok(!html.warnings.some((w) => /source_failed|gallery_empty/.test(w)), html.warnings.join(";"));
  const docx = await renderDocument(ctx, { document_id: built.document_id }, "docx"); assert.equal(docx.buffer.subarray(0, 2).toString(), "PK"); assert.ok(docx.buffer.length > 8000);
});

test("documents can embed graphics and galleries directly (what an agent writes) and a failing graphic reports instead of breaking the document", async () => {
  const prog = await E.create(ctx, "programs", { name: "Directivas", folder: path.join(T, "dir") }), a = await MEDIA.addMedia(ctx, { program_id: prog.id, name: "a.png", buffer: png(20, 20), caption: "Pie" });
  const md = `# Prueba\n\n:::graphic type=kpi_bars\n{"items":[{"label":"X","target":4,"achieved":3}]}\n:::\n\n:::gallery ids=${a.id} layout=hero\n:::\n\n:::graphic type=kpi_bars\n{"items":[]}\n:::\n\n:::gallery layout=grid\natt:${a.attachment_id} | Desde un adjunto\n:::\n`;
  const r = await renderDocument(ctx, { markdown: md, program_id: prog.id }, "html"), h = r.buffer.toString("utf8");
  assert.match(h, /75 %/); assert.match(h, /gallery hero/); assert.match(h, /Desde un adjunto/); assert.ok(r.warnings.some((w) => /source_failed:graphic kpi_bars/.test(w)));
});

test("the study in docs/MEMORIAS.md is generated from the catalogue and up to date", async () => {
  const { md } = await import(`${ROOT}/scripts/memoir-study.mjs`); assert.equal(fs.readFileSync(path.join(ROOT, "docs/MEMORIAS.md"), "utf8"), md, "run node scripts/memoir-study.mjs");
});
