// Regenerates every generated document in one go: icons, the memoir study, the HTTP reference, the data model and the code map. Run with `npm run docs`.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const s of ["build-icons.mjs", "memoir-study.mjs", "docs-api.mjs", "docs-data-model.mjs", "docs-code-map.mjs"]) {
  const r = spawnSync(process.execPath, [path.join(dir, s)], { stdio: "inherit" }); if (r.status !== 0) process.exit(r.status ?? 1);
}
