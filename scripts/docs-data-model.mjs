// Writes docs/DATA-MODEL.md: every entity of the application (what becomes a table, an API resource, a form and a list) with its fields, generated from lib/schema/*.mjs so the
// reference cannot drift from the code. Run: node scripts/docs-data-model.mjs   (tests/docs-coverage.test.mjs checks the file is up to date)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.COLLADO_DESKTOP = "1";   // the desktop schema (it adds programs.folder); set before the schema is imported
const { ENTITIES, MODULES } = await import("../app-seed/app/lib/schema.mjs"), { DICTS } = await import("../app-seed/app/lib/i18n/index.mjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ES = DICTS.es, name = (e) => (ES.e[e] || e).split("|")[0], plural = (e) => { const [s, p] = (ES.e[e] || e).split("|"); return p || s; };
const label = (e, f) => (ES.fe?.[`${e}.${f}`] ?? ES.f[f] ?? (ENTITIES[e].fields[f].type === "ref" ? name(ENTITIES[e].fields[f].to) : f)), cell0 = 0;
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const TYPES = { text: "texto", long: "texto largo", int: "entero", num: "decimal", pct: "porcentaje", money: "importe (céntimos en BD, euros en API)", bool: "sí/no", date: "fecha", datetime: "fecha y hora", time: "hora", enum: "opción", ref: "referencia", json: "JSON", tags: "etiquetas", secret: "secreto (cifrado)" };
const detail = (fd) => [fd.to && `→ \`${fd.to}\`${fd.cascade ? " (borrado en cascada)" : ""}${fd.filter ? ` filtrado por ${JSON.stringify(fd.filter)}` : ""}`, fd.options && `opciones: ${fd.options.map((o) => `\`${o}\``).join(", ")}`, fd.min != null && `mín ${fd.min}`, fd.max != null && fd.type !== "text" && fd.type !== "long" && fd.type !== "json" && `máx ${fd.max}`,
  fd.format && `formato ${fd.format}`, fd.unique && "único", fd.default !== undefined && fd.default !== null && fd.default !== "" && fd.type !== "enum" && `por defecto ${JSON.stringify(fd.default)}`, fd.perm && `permiso: lee \`${fd.perm.read}\`, escribe \`${fd.perm.write}\``, fd.help].filter(Boolean).join(" · ");

/** The whole docs/DATA-MODEL.md as a string. */
export function build() {
  const byGroup = new Map(); for (const e of Object.values(ENTITIES)) { const g = e.group || (e.module === "own" ? "—" : "otros"); (byGroup.get(g) || byGroup.set(g, []).get(g)).push(e); }
  let md = `# Modelo de datos

_Generado por \`scripts/docs-data-model.mjs\` a partir de \`app-seed/app/lib/schema/*.mjs\`. No lo edites a mano: para añadir una entidad o un campo cambia el esquema y vuelve a generarlo._

Cada entidad declara sus campos una sola vez y de ahí salen **la tabla** SQLite (\`syncSchema()\` crea tablas y **solo añade** columnas), **la API** (\`/api/e/<entidad>\`), **el formulario y la lista** de la interfaz, **los permisos** y **las etiquetas** (es, ca, en: un test comprueba que ninguna falte).

El campo \`programs.folder\` (carpeta local del proyecto) solo existe en la app de escritorio.

Columnas que añade el motor a toda tabla: \`id\`, \`created\`, \`updated\`, \`created_by\`, \`updated_by\` y \`rev\` (revisión para el control de concurrencia optimista). Todo cambio queda en \`changes\` (con valores sensibles enmascarados).

## Módulos y permisos
| Módulo | Ver | Editar |
|---|---|---|
${Object.entries(MODULES).map(([k, v]) => `| \`${k}\` | \`${v.view}\` | \`${v.edit}\` |`).join("\n")}

Un campo puede exigir un permiso propio (columna *detalles*: \`permiso\`); los de tipo **secreto** se cifran con AES-256-GCM. Los importes se guardan en **céntimos** (enteros) y la API los entrega en **euros**.

## Entidades (${Object.keys(ENTITIES).length})
`;
  for (const [g, list] of byGroup) {
    md += `\n### Grupo: ${ES.g[g] || g}\n`;
    for (const e of list) {
      md += `\n#### \`${e.name}\` — ${name(e.name)} (${plural(e.name)})\n`;
      md += `Módulo \`${e.module}\`${e.program ? ` · ámbito de programa: \`${e.program}\`` : ""}${e.parent ? ` · padre: \`${e.parent}\`` : ""}${e.hidden ? " · oculta en el menú" : ""}${e.ext?.read ? " · visible para externos" + (typeof e.ext.where === "string" ? ` (donde ${e.ext.where})` : "") : ""}${e.noHistory ? " · sin historial" : ""}. Título: ${e.title.map((t) => `\`${t}\``).join(" + ")}. Orden: \`${e.sort}\`.\n\n`;
      md += `| Campo | Tipo | Obligatorio | Detalles |\n|---|---|---|---|\n`;
      for (const fd of Object.values(e.fields)) md += `| \`${fd.name}\`${fd.ro ? " (solo lectura)" : ""} — ${cell(label(e.name, fd.name))} | ${TYPES[fd.type] || fd.type} | ${fd.required ? "sí" : ""} | ${cell(detail(fd))} |\n`;
    }
  }
  return md;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const md = build(); fs.writeFileSync(path.join(ROOT, "docs/DATA-MODEL.md"), md); console.log(`docs/DATA-MODEL.md (${md.split("\n").length} lines)`); }
