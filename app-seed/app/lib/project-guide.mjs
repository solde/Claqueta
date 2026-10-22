// Desktop build: when a programme has a local folder, that folder gets its own CLAUDE.md (the rules for the agent in THAT project: where files go, what to check before making documents).
// Written once from PROJECT.template.md and never overwritten (it belongs to the person from then on). Failing to write it (read-only disk, a cloud folder not mounted…) is never an error.
import fs from "node:fs";
import path from "node:path";
import { optionLabel } from "./i18n/index.mjs";
import { q } from "./db.mjs";
import { bad } from "./util.mjs";

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

const norm = (p) => { const r = path.resolve(p).replace(/[\\/]+$/, ""); return process.platform === "darwin" || process.platform === "win32" ? r.toLowerCase() : r; };
const inside = (a, b) => { const r = path.relative(a, b); return r === "" || (!!r && !r.startsWith("..") && !path.isAbsolute(r)); };   // b is a or inside a
/** Desktop: every programme keeps its files in its OWN folder. Required when creating (and never emptied afterwards), an absolute path, usable (created if missing), and neither the same as
 *  nor inside/around another programme's folder. `data` is what is being saved, `ex` the existing row (update). Throws the API's usual 400s. */
export function validateProjectFolder(op, data, ex, { desktop = process.env.COLLADO_DESKTOP === "1" } = {}) {
  if (!desktop || op === "delete") return;
  const given = Object.prototype.hasOwnProperty.call(data, "folder");
  if (!given) { if (op === "create") throw bad("required:folder"); return; }
  const folder = String(data.folder ?? "").trim(); if (!folder) throw bad("required:folder");
  if (!path.isAbsolute(folder)) throw bad("folder_not_absolute");
  data.folder = path.resolve(folder);
  const me = norm(data.folder);
  for (const r of q.all("SELECT id, name, folder FROM programs WHERE folder IS NOT NULL AND folder != ''")) {
    if (ex && r.id === ex.id) continue; const o = norm(r.folder);
    if (o === me) throw bad(`folder_in_use:${String(r.name).replace(/:/g, " ")}`); if (inside(o, me) || inside(me, o)) throw bad(`folder_overlaps:${String(r.name).replace(/:/g, " ")}`);
  }
  try { fs.mkdirSync(data.folder, { recursive: true }); if (!fs.statSync(data.folder).isDirectory()) throw 0; fs.accessSync(data.folder, fs.constants.W_OK); } catch { throw bad("folder_unusable"); }
}
/** Desktop: an exported document is also written (plain) into Documentos/ of the programme's folder. Returns the path, or null. Never throws. */
export function copyExportToProject(programId, name, buffer, { desktop = process.env.COLLADO_DESKTOP === "1" } = {}) {
  try {
    if (!desktop || !programId) return null; const row = q.get("SELECT folder FROM programs WHERE id = ?", programId), folder = String(row?.folder || ""); if (!folder || !path.isAbsolute(folder) || !fs.statSync(folder).isDirectory()) return null;
    const dir = path.join(folder, "Documentos"); fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(name), base = path.basename(name, ext); let f = path.join(dir, name); for (let i = 2; fs.existsSync(f) && i < 1000; i++) f = path.join(dir, `${base} (${i})${ext}`);   // never overwrite
    fs.writeFileSync(f, buffer, { flag: "wx" }); return f;
  } catch { return null; }
}
