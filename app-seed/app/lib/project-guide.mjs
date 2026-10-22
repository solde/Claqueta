// Desktop build: when a programme has a local folder, that folder gets its own CLAUDE.md (the rules for the agent in THAT project: where files go, what to check before making documents).
// Written once from PROJECT.template.md and never overwritten (it belongs to the person from then on). Failing to write it (read-only disk, a cloud folder not mounted…) is never an error.
import fs from "node:fs";
import path from "node:path";
import { optionLabel } from "./i18n/index.mjs";

const FALLBACK = `# Proyecto: {{NAME}}{{CODE_SUFFIX}}

Programa #{{ID}} de {{APP_NAME}} · carpeta: \`{{FOLDER}}\`.

Al empezar a trabajar en este proyecto: lee la ficha (\`collado-api get programs {{ID}}\`) y comprueba las herramientas para crear documentos con la máxima calidad: \`collado-doc check --program {{ID}}\`. Guarda aquí los archivos del proyecto.
`;
/** -> the path written, or null (not desktop, no usable folder, already there, or could not write). */
export function ensureProjectGuide(row, { desktop = process.env.COLLADO_DESKTOP === "1", sharedDir = process.env.WORKSPACE_DIR || "", appName = process.env.APP_DISPLAY_NAME || "Collado" } = {}) {
  try {
    if (!desktop) return null;
    const folder = String(row?.folder || "").trim(); if (!folder || !path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) return null;
    const file = path.join(folder, "CLAUDE.md"); if (fs.existsSync(file)) return null;
    let tpl = FALLBACK; try { tpl = fs.readFileSync(path.join(sharedDir, "agent", "PROJECT.template.md"), "utf8"); } catch { /* seed not installed yet */ }
    let kind = row.kind || ""; try { kind = optionLabel("es", "programs", "kind", row.kind) || kind; } catch { /* keep the code */ }
    const vars = { NAME: row.name, CODE_SUFFIX: row.code ? ` (${row.code})` : "", ID: row.id, KIND: kind, FOLDER: folder, APP_NAME: appName, AGENT_DIR: path.join(sharedDir || "", "agent") };
    fs.writeFileSync(file, tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m)), { flag: "wx", mode: 0o644 });
    return file;
  } catch { return null; }
}
