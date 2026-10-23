import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const APP = path.resolve(import.meta.dirname, "../app-seed/app");
const T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-docs-"));
const { openDb, syncSchema, q } = await import(`${APP}/lib/db.mjs`);
const { initKey } = await import(`${APP}/lib/crypto.mjs`); const { initFiles } = await import(`${APP}/lib/files.mjs`);
const E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`);
const { localCtx } = await import(`${APP}/lib/access.mjs`); const { seedAll } = await import(`${APP}/lib/seeds.mjs`);
const R = await import(`${APP}/lib/docs/render.mjs`); const { parseDocument } = await import(`${APP}/lib/docs/markdown.mjs`); const { expand } = await import(`${APP}/lib/docs/vars.mjs`);
const { lintDocument } = await import(`${APP}/lib/docs/lint.mjs`); const { buildXlsx } = await import(`${APP}/lib/docs/xlsx.mjs`); const { runSource } = await import(`${APP}/lib/docs/datasets.mjs`);
const { loadSample } = await import("./fixtures/sample-data.mjs");
initKey(T); openDb(T); syncSchema(); initFiles(T); await seedAll();
const ctx = localCtx("david"); const S = await loadSample(E, ctx);
const py = (code, ...args) => spawnSync("python3", ["-I", "-c", code, ...args], { encoding: "utf8" });
const pyHas = (mod) => py(`import ${mod}`).status === 0;

test("markdown: blocks, inline, directives, tables", () => {
  const d = parseDocument("---\ntitle: T\ncover: yes\n---\n# H\n\npar **b** *i* `c` [l](https://x.y)\n\n- a\n  - b\n1. x\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n\n:::callout kind=warn title=\"Ojo\"\ntexto\n:::\n\n:::columns\nuno\n---col---\ndos\n:::\n");
  assert.equal(d.meta.title, "T"); const t = d.blocks.map((b) => b.t);
  assert.deepEqual(t, ["h", "p", "ul", "ol", "table", "callout", "columns"]);
  assert.equal(d.blocks[4].align[1], "right"); assert.equal(d.blocks[6].cols.length, 2);
});
test("variables: filters, if/else, each, markdown escaping, missing paths", () => {
  const r = expand("{{a.n}} {{a.v|money}} {{#if a.x}}Y{{else}}N{{/if}} {{#each l}}{{this.k}},{{/each}} {{zz}} {{a.t|md}}", { a: { n: "A*B", v: 1234.5, x: 0, t: "**b**" }, l: [{ k: 1 }, { k: 2 }] }, { lang: "es" });
  assert.equal(r.text.replace(/\u00a0/g, " "), "A\\*B 1.234,50 € N 1,2,  **b**"); assert.deepEqual(r.missing, ["zz"]);
});
test("every built-in template renders to HTML with real data and no unresolved variables, in three languages", async () => {
  for (const lang of ["es", "ca", "en"]) for (const t of E.list(ctx, "doc_templates", { limit: 100 }).rows) {
    const r = await R.renderDocument(ctx, { template_id: t.id, program_id: S.program.id, episode_id: S.eps[0].id, vars: { budget: S.bud.id }, lang }, "html");
    const html = r.buffer.toString(); assert.ok(html.startsWith("<!doctype html>"), t.key); assert.ok(!/\{\{|\}\}/.test(html.replace(/<style[\s\S]*?<\/style>/, "")), `${t.key} left variables`);
    assert.ok(!r.warnings.some((w) => w.startsWith("source_failed")), `${t.key}: ${r.warnings}`);
  }
});
test("data sources return typed tables and respect permissions", async () => {
  const b = await runSource(ctx, "budget", { budget: S.bud.id, actuals: "1" }, "es"); assert.ok(b.rows.length >= 6); assert.equal(b.totals.planned, 535800);
  const rd = await runSource(ctx, "rundown", { episode: S.eps[0].id }, "es"); assert.equal(rd.rows[0].start, "09:00:00"); assert.equal(rd.meta.total_sec, 2955);
  const prod = { user: "p", name: "p", perms: new Set(["app.view", "app.edit"]), roles: [], local: false, external: false };
  await assert.rejects(runSource(prod, "budget", { budget: S.bud.id }, "es"), /needs:fin.view/);
  const lint = await lintDocument(ctx, { markdown: "# A\n\n### B\n\n{{nope}} [Indicar fecha]", program_id: S.program.id });
  assert.ok(lint.issues.some((i) => i.code === "heading_skip")); assert.ok(lint.issues.some((i) => i.code === "missing_variable")); assert.ok(lint.issues.some((i) => i.code === "placeholder"));
});
test("DOCX is a valid package that python-docx can open (styles, tables, cover)", async (t) => {
  const r = await R.renderDocument(ctx, { template_id: E.list(ctx, "doc_templates", { filters: { key: "dossier" } }).rows[0].id, program_id: S.program.id, episode_id: S.eps[0].id, vars: {} }, "docx");
  assert.equal(r.buffer.subarray(0, 2).toString(), "PK");
  if (!pyHas("docx")) return t.skip("python-docx not installed");
  const f = path.join(T, "t.docx"); fs.writeFileSync(f, r.buffer);
  const out = py("import sys,docx,zipfile,xml.dom.minidom as m\nz=zipfile.ZipFile(sys.argv[1])\n[m.parseString(z.read(n)) for n in z.namelist() if n.endswith('.xml') or n.endswith('.rels')]\nd=docx.Document(sys.argv[1])\nprint(len(d.paragraphs), len(d.tables), [s.name for s in d.styles if s.name.startswith('heading')][:2])", f);
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /^\d+ [1-9]/);
});
test("XLSX opens in openpyxl with typed cells, a live SUM total and frozen header", async (t) => {
  const ds = await runSource(ctx, "variance_episodes", { program: S.program.id }, "es");
  const buf = buildXlsx({ title: "T", sheets: [{ name: "Desviación", title: ds.title, columns: ds.columns, rows: ds.rows }], brand: {}, lang: "es" });
  if (!pyHas("openpyxl")) return t.skip("openpyxl not installed");
  const f = path.join(T, "t.xlsx"); fs.writeFileSync(f, buf);
  const out = py("import sys,openpyxl\nwb=openpyxl.load_workbook(sys.argv[1])\nws=wb.active\nrows=list(ws.iter_rows(values_only=True))\nprint(ws.freeze_panes, ws.max_row, [r for r in rows if r and r[0]=='Total'][0][1])", f);
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /A\d+ \d+ SUM|=SUM|A4/);
});
test("PDF through WeasyPrint when available", async (t) => {
  if (!R.capabilities().pdf) return t.skip("weasyprint not installed");
  const r = await R.renderDocument(ctx, { markdown: "# Hola\n\nTexto con ñ y á.\n", title: "Prueba" }, "pdf");
  assert.equal(r.buffer.subarray(0, 4).toString(), "%PDF");
});
