// Writes docs/MEMORIAS.md: the study of what a project memoir needs (sections, fields, data the app fills in, visuals), generated from the catalogue the app uses,
// so the document and the product cannot drift apart. Run: node scripts/memoir-study.mjs   (tests/memoir.test.mjs checks the file is up to date)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS, ORDER, KINDS, KIND_LABEL, defaultSections } from "../app-seed/app/lib/memoir-catalog.mjs";
import { GRAPHIC_TYPES } from "../app-seed/app/lib/docs/graphics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const es = (o) => (o && typeof o === "object" ? o.es : o);
const FACT_DOC = { program: "ficha del programa (nombre, género, logline, productora, fechas, canal, cliente)", period: "periodo de la memoria", episodes: "episodios: número, estado, emisión, duración", runtime: "minutos previstos y reales", shoot: "días de rodaje", crew: "personas y roles del equipo",
  budget: "presupuesto, real, comprometido y desviación (requiere permiso de finanzas)", chapters: "presupuesto por capítulos", billing: "facturado, cobrado, subvenciones, margen (finanzas)", audience: "audiencia y cuota media, mejor y peor emisión", forecast: "predicción de audiencia", milestones: "hitos del proyecto",
  locations: "localizaciones con coordenadas y días de rodaje", targets: "targets de público", editorial_lines: "líneas editoriales", risks: "riesgos principales y su mitigación", rights: "derechos por estado", qc: "incidencias de calidad", media: "imágenes de la galería" };

let md = `# Memorias de proyecto: estudio de secciones y campos

_Generado por \`scripts/memoir-study.mjs\` a partir del catálogo de la aplicación (\`app-seed/app/lib/memoir-catalog.mjs\`). No lo edites a mano._

## 1. Qué es y para qué sirve
Una **memoria de proyecto** resume lo que se hizo, con qué recursos y qué resultados dio. Se pide para **justificar subvenciones o ayudas**, rendir cuentas a una **cadena o cliente**, cerrar una **temporada**, presentar el proyecto a **festivales y premios** o hacer un **balance interno**. Lo que separa una memoria buena de una mediocre:

1. **Datos verificables**, no adjetivos: cada afirmación lleva una cifra, una fecha o una fuente.
2. **Estructura predecible**: quien la evalúa busca secciones concretas en un orden concreto.
3. **Material visual con propósito**: fotos con pie y autoría, y gráficos que se leen de un vistazo.
4. **Coherencia entre secciones**: las mismas cifras en el resumen, en la economía y en los resultados.
5. **Adaptada al lector**: una justificación de subvención no se escribe como un dosier de festivales.

## 2. Cómo lo resuelve la aplicación
- Cada memoria tiene un **tipo** (qué secciones incluye por defecto), un **destinatario** (financiador, cadena, cliente), un **periodo**, un **idioma**, un **tono** (institucional, narrativo o técnico) y un **encargo** libre para quien la escribe (persona o agente).
- Cada **sección** tiene: texto en Markdown, **campos estructurados** (los de este documento), **imágenes** de la galería y **gráficos**; estado (vacía, borrador, revisión, aprobada, omitida) y una **completitud** calculada.
- La aplicación **rellena sola** lo que ya sabe (tabla «Datos automáticos» de cada sección): nadie teclea dos veces una cifra.
- El agente trabaja con \`collado-doc memoir show/write/build\` y crea material con \`collado-doc media\` y \`collado-doc graphic\`.
- **Ensamblar** genera un documento editable (con índice, portada con la marca, tablas, galería y gráficos) que se exporta a PDF o Word.

## 3. Tipos de memoria y secciones que incluyen
| Tipo | Para quién | Secciones por defecto |
|---|---|---|
${KINDS.map((k) => `| \`${k}\` | ${es(KIND_LABEL[k])} | ${defaultSections(k).join(", ")} |`).join("\n")}

## 4. Secciones y campos
Tipos de campo: \`text\` (una línea), \`long\` (varios párrafos), \`num\`, \`date\`, \`enum\`, \`list\` (filas con las columnas indicadas), \`media\` (imágenes de la galería). Un asterisco marca lo **obligatorio** para considerar completa la sección.
`;
ORDER.forEach((key, i) => {
  const s = SECTIONS[key];
  md += `\n### 4.${i + 1} ${es(s.title)} (\`${key}\`)\n${es(s.purpose)}\n\n- **Extensión recomendada:** ${s.words[1] ? `${s.words[0]}–${s.words[1]} palabras` : "sin texto largo (sección visual o de listado)"}\n- **Aplica a:** ${s.kinds.join(", ")}${s.perm ? `\n- **Permiso necesario para sus datos:** \`${s.perm}\`` : ""}\n- **Datos automáticos:** ${s.facts.length ? s.facts.map((f) => FACT_DOC[f] || f).join("; ") : "ninguno"}\n- **Material visual sugerido:** ${s.visuals.length ? s.visuals.join(", ") : "—"}\n\n| Campo | Clave | Tipo | Contenido |\n|---|---|---|---|\n`;
  for (const f of s.fields) md += `| ${es(f.label)}${f.required ? " \\*" : ""} | \`${f.key}\` | ${f.type} | ${f.type === "list" ? "filas: " + f.cols.map((c) => `${es(c.label)} (\`${c.key}\`, ${c.type})`).join(", ") : f.options ? f.options.join(" / ") : ""} |\n`;
});
md += `
## 5. Galería de imágenes: campos de cada imagen
| Campo | Para qué |
|---|---|
| Título, **pie de foto**, **texto alternativo** | Lo que se imprime bajo la imagen y lo que oyen los lectores de pantalla |
| **Autoría** | Obligatoria en cualquier entrega externa |
| Tipo (fotografía, fotograma, detrás de las cámaras, captura, prensa, logo, documento, gráfico) y **fase** (desarrollo, preproducción, rodaje, postproducción, entrega, emisión, promoción) | Elegir la imagen adecuada para cada sección |
| Episodio, **localización**, fecha de la toma, personas que aparecen | Contexto y trazabilidad |
| **Derechos de uso** (propia, con licencia, autorización pendiente, restringida) y nota | Evitar publicar lo que no se puede |
| Destacada, orden | Selección automática de la galería |
| Ancho y alto, origen (subida, agente, generada), especificación | Maquetación y regeneración de gráficos |

## 6. Localizaciones
Nombre, tipo (exterior, plató, interior, remota), dirección, ciudad, país, **latitud y longitud**, fechas, **días de rodaje**, descripción, permiso y contacto. Alimentan la sección *Localizaciones y rodaje* y el mapa.

## 7. Gráficos que el agente y las personas pueden generar
Todos se dibujan con la **marca** del equipo (colores y tipografías), salen como imagen o como bloque vivo dentro del documento y se guardan en la galería.

| Tipo | Qué es | Datos que admite |
|---|---|---|
${Object.entries(GRAPHIC_TYPES).map(([t, g]) => `| \`${t}\` | ${g.label} | ${Object.keys(g.spec).join(", ")} |`).join("\n")}

Gráficos de datos (tipo \`chart\`): barras, barras horizontales, líneas, **área**, anillo, **cascada** (del presupuesto al gasto real), **mapa de calor** y gantt.
Dentro de cualquier documento: \`:::graphic type=…\`, \`:::gallery ids=… layout=mosaic|strip|hero|grid|logos\` y \`:::chart source=… type=…\`.

## 8. Comprobaciones de calidad
- Completitud por sección (campos obligatorios + extensión mínima) y global.
- \`collado-doc lint\`: variables sin resolver, bloques de datos que fallan, marcas \`[Indicar: …]\` que quedan, saltos de título.
- Vista previa de páginas en PNG para revisar tablas, portada e imágenes.
- Derechos de imagen y datos personales: las imágenes con autorización pendiente o restringidas no deberían salir del equipo.
`;
if (process.argv[1] === fileURLToPath(import.meta.url)) { fs.writeFileSync(path.join(ROOT, "docs/MEMORIAS.md"), md); console.log(`docs/MEMORIAS.md (${md.split("\n").length} lines)`); }
export { md };
