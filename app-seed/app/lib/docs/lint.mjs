// Quality checks for a document before it is sent out: unresolved variables, failed data blocks, leftover placeholders, structure problems, length.
import { buildDocument } from "./render.mjs";
import { inlineText } from "./markdown.mjs";

export async function lintDocument(ctx, input) {
  const b = await buildDocument(ctx, input); const issues = [];
  for (const w of b.warnings) { const [code, ...rest] = w.split(":"); issues.push({ level: code === "missing_variable" || code === "source_failed" ? "error" : "warn", code, message: rest.join(":") }); }
  const text = []; let lastLevel = 0, headings = 0, words = 0, hasToc = false, tables = 0, h1 = 0;
  const walk = (blocks) => { for (const bl of blocks || []) {
    if (bl.t === "h") { headings++; if (bl.level === 1) h1++; if (lastLevel && bl.level > lastLevel + 1) issues.push({ level: "warn", code: "heading_skip", message: `H${lastLevel} → H${bl.level}: ${inlineText(bl.inlines).slice(0, 60)}` }); lastLevel = bl.level; if (!inlineText(bl.inlines).trim()) issues.push({ level: "warn", code: "empty_heading", message: "" }); }
    if (bl.t === "p") { const t = inlineText(bl.inlines); text.push(t); words += t.split(/\s+/).filter(Boolean).length; if (t.length > 1400) issues.push({ level: "info", code: "long_paragraph", message: t.slice(0, 60) + "…" }); }
    if (bl.t === "toc") hasToc = true; if (bl.t === "table") { tables++; if (!bl.rows.length) issues.push({ level: "warn", code: "empty_table", message: "" }); }
    for (const k of ["blocks", "extra"]) walk(bl[k]); if (bl.cols) bl.cols.forEach(walk); } };
  walk(b.doc.blocks);
  const all = text.join("\n");
  for (const m of all.matchAll(/\[(Indicar|Completar|TODO|Definir|Rellenar)[^\]]*\]/gi)) issues.push({ level: "warn", code: "placeholder", message: m[0].slice(0, 80) });
  if (/\{\{|\}\}/.test(all)) issues.push({ level: "error", code: "unexpanded_variable", message: "Hay llaves {{ }} sin resolver" });
  if (h1 > 1) issues.push({ level: "info", code: "several_h1", message: `${h1} títulos de nivel 1` });
  if (words > 1500 && !hasToc) issues.push({ level: "info", code: "no_toc", message: "Documento largo sin índice" });
  const order = { error: 0, warn: 1, info: 2 };
  return { ok: !issues.some((i) => i.level === "error"), issues: issues.sort((a, b) => order[a.level] - order[b.level]), stats: { words, headings, tables, pages_estimate: Math.max(1, Math.round(words / 450)) } };
}
