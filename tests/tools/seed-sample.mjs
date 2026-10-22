// Fills a data directory with the sample programme (used by the UI smoke test): node tests/tools/seed-sample.mjs <datadir>
import path from "node:path";
const APP = path.resolve(import.meta.dirname, "../../app-seed/app"); const dir = process.argv[2];
const { openDb, syncSchema } = await import(`${APP}/lib/db.mjs`); const { initKey } = await import(`${APP}/lib/crypto.mjs`); const { initFiles } = await import(`${APP}/lib/files.mjs`);
const E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`); const { localCtx } = await import(`${APP}/lib/access.mjs`); const { seedAll } = await import(`${APP}/lib/seeds.mjs`);
const { loadSample } = await import("../fixtures/sample-data.mjs");
initKey(dir); openDb(dir); syncSchema(); initFiles(dir); await seedAll(); const s = await loadSample(E, localCtx("david")); console.log(JSON.stringify({ program: s.program.id, episode: s.eps[0].id, budget: s.bud.id }));
