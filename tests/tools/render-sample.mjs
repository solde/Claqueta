// Renders every built-in template with the sample data into <outdir> (html, pdf when WeasyPrint is available, docx) for visual review.
//   node tests/tools/render-sample.mjs /tmp/out
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const APP = path.resolve(import.meta.dirname, "../../app-seed/app"); const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "collado-docs-")); fs.mkdirSync(out, { recursive: true });
const T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-sample-"));
const { openDb, syncSchema, q } = await import(`${APP}/lib/db.mjs`); const { initKey } = await import(`${APP}/lib/crypto.mjs`); const { initFiles } = await import(`${APP}/lib/files.mjs`);
const E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`); const { localCtx } = await import(`${APP}/lib/access.mjs`); const { seedAll } = await import(`${APP}/lib/seeds.mjs`);
const { renderDocument } = await import(`${APP}/lib/docs/render.mjs`); const { loadSample } = await import(`${import.meta.dirname}/../fixtures/sample-data.mjs`);
initKey(T); openDb(T); syncSchema(); initFiles(T); await seedAll();
const ctx = localCtx("david"); const s = await loadSample(E, ctx);
const lang = process.argv[3] || "es"; const formats = (process.argv[4] || "html,pdf,docx").split(",");
for (const t of E.list(ctx, "doc_templates", { limit: 100 }).rows) {
  const vars = { budget: s.bud.id, sponsor: "Marca Sol", fee: 25000, person: "Laura Gómez", id: "00000000X", city: "Barcelona", provider: "Carla Ferrer", provider_id: "11111111H", service: "Realización del programa", start: "2026-02-01", end: "2026-06-30", date: "2026-02-01", location: "Plató 1", highlights: "Líder de su franja en febrero.\n\n- Cuota creciente\n- Coste contenido", analysis: "La cuota **sube** semana a semana.", minor: "Nil", guardian: "Familiar", guardian_id: "2222222J", recording: "1 de febrero, Plató 1", start_: "09:00", director: "Carla Ferrer" };
  for (const f of formats) {
    try { const r = await renderDocument(ctx, { template_id: t.id, program_id: s.program.id, episode_id: s.eps[0].id, vars, lang }, f); fs.writeFileSync(path.join(out, `${t.key}.${r.ext}`), r.buffer); if (r.warnings.length) console.log(t.key, f, "warnings:", r.warnings.join(" | ")); }
    catch (e) { console.log("FAIL", t.key, f, e.message, JSON.stringify(e.extra || "").slice(0, 300)); }
  }
}
console.log("written to", out);
