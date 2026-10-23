// Writes docs/CODE-MAP.md: the index of every source file with the first sentence of its header comment (the "what is this file for" that every file must start with).
// Generated, so it cannot drift: when a file is added or its header changes, run `npm run docs`. tests/docs-coverage.test.mjs fails when the file is out of date.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AREAS = [
  ["desktop", "Aplicación de escritorio (Electron): ventana, procesos hijos, bloqueo de red, render de documentos, sincronización en la nube, actualizaciones."],
  ["gateway", "Gateway (login, roles, 2FA, shell web, proxy) y agentd (usuarios, consolas, supervisor de la app, archivos, trabajos del agente)."],
  ["app-seed/app/lib", "Servidor de la app: motor de datos, reglas de negocio, informes, API, motor de documentos, memorias, gráficos, predicción de audiencias."],
  ["app-seed/app/public", "Interfaz de la app (SPA sin compilación): módulos JS, vistas, estilos y service worker."],
  ["tools", "Herramientas de línea de comandos del agente (`collado-api`, `collado-doc`, `collado-app`) y sus ayudantes."],
  ["scripts", "Scripts de desarrollo, generación de documentación y publicación."],
  ["tests", "Pruebas unitarias y de integración."],
];
const SRC = /\.(mjs|js|cjs|py|sh|html|css)$/, SKIP = /(^|\/)(node_modules|vendor|fonts|dist|\.scratch)(\/|$)/;

/** First sentence of the header comment of a file ("" when it has none). */
export function headerOf(file) {
  const src = fs.readFileSync(file, "utf8"), doc = /^(?:#!.*\n)?\s*"""([\s\S]*?)"""/.exec(src);   // Python module docstring
  const L = doc ? doc[1].split("\n").map((x) => `# ${x.trim()}`) : src.split("\n").slice(0, 12); let out = [];
  for (const raw of L) {
    const l = raw.trim(); if (l.startsWith("#!") || /^<!doctype/i.test(l) || l === '"use strict";') continue;
    const m = /^(?:\/\/|\/\*+|<!--|#|\*)\s?(.*?)\s*(?:\*\/|-->)?$/.exec(l); if (!m || !(l.startsWith("//") || l.startsWith("/*") || l.startsWith("<!--") || l.startsWith("#") || l.startsWith("*"))) { if (out.length) break; continue; }
    if (m[1]) out.push(m[1]); else if (out.length) break;
    if (/\.$/.test(m[1]) && out.join(" ").length > 40) break;
  }
  const text = out.join(" ").replace(/\s+/g, " ");
  for (const m of text.matchAll(/[.!?](?=\s|$)/g)) {   // the first sentence whose backticks and parentheses are balanced (so "(macOS, Windows, Linux)." or "`node x.js`" do not cut it)
    const s = text.slice(0, m.index + 1), odd = (c) => (s.split(c).length - 1) % 2;
    if (s.length >= 30 && !odd("`") && (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length && (s.match(/\{/g) || []).length === (s.match(/\}/g) || []).length) return s.slice(0, 300);
  }
  return text.slice(0, 300);
}
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = path.posix.join(dir, e.name); if (SKIP.test(rel)) continue;
    if (e.isDirectory()) walk(rel, acc); else if (SRC.test(e.name)) acc.push(rel);
  }
  return acc;
}
/** Every source file the code map covers, as repository-relative paths. */
export function sourceFiles() { return AREAS.flatMap(([dir]) => walk(dir)); }

/** The whole docs/CODE-MAP.md as a string. */
export function build() {
  let md = `# Mapa del código

_Generado por \`scripts/docs-code-map.mjs\` a partir de la primera frase del comentario de cabecera de cada fichero (todo fichero fuente debe empezar con uno). No lo edites a mano: cambia la cabecera del fichero y ejecuta \`npm run docs\`._

Para entender cómo encajan las piezas, lee antes [SOFTWARE.md](SOFTWARE.md). Las reglas para escribir y mantener esta documentación están en [DOCUMENTATION.md](DOCUMENTATION.md).
`;
  for (const [dir, desc] of AREAS) {
    md += `\n## \`${dir}/\`\n${desc}\n\n| Fichero | Para qué sirve |\n|---|---|\n`;
    for (const f of walk(dir)) md += `| \`${f.slice(dir.length + 1)}\` | ${headerOf(path.join(ROOT, f)).replace(/\|/g, "\\|") || "**(sin cabecera)**"} |\n`;
  }
  return md;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const md = build(); fs.writeFileSync(path.join(ROOT, "docs/CODE-MAP.md"), md); console.log(`docs/CODE-MAP.md (${md.split("\n").length} lines)`); }
