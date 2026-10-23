// Aggregates the entity definitions and derives what the engine and the UI need. Edit lib/schema/*.mjs to add entities or fields:
// the tables/columns are created on the next start (additive only; nothing is ever dropped).
import core from "./schema/core.mjs";
import people from "./schema/people.mjs";
import finance from "./schema/finance.mjs";
import legal from "./schema/legal.mjs";
import media from "./schema/media.mjs";
import broadcast from "./schema/broadcast.mjs";
import docs from "./schema/docs.mjs";
import memoir from "./schema/memoir.mjs";

/** Every entity of the application, merged from lib/schema/*.mjs (the single declaration the database, API, forms, i18n checks and documents are built from). */
export const ENTITIES = { ...core, ...people, ...finance, ...legal, ...media, ...broadcast, ...docs, ...memoir };

/** module -> permission needed to read / write. `own` = rows of the current user only (notifications). */
export const MODULES = {
  prod: { view: "app.view", edit: "app.edit" },
  fin: { view: "fin.view", edit: "fin.edit" },
  legal: { view: "legal.view", edit: "legal.edit" },
  people: { view: "people.view", edit: "people.edit" },
  own: { view: "app.view", edit: "app.view" },
};

/** The closed list of permissions; roles are sets of these. */
export const PERMS = ["app.view", "app.edit", "fin.view", "fin.edit", "fin.approve", "legal.view", "legal.edit", "people.view", "people.edit", "external", "agent.jobs", "agent.console", "agent.shell", "service.manage", "users.manage"];

for (const [name, e] of Object.entries(ENTITIES)) {
  e.name = name; e.table = name;
  e.fields ||= {};
  e.sort ||= "-id"; e.search ||= []; e.list ||= Object.keys(e.fields).slice(0, 6);
  for (const [fn, fd] of Object.entries(e.fields)) {
    fd.name = fn;
    if (fd.type === "ref" && !ENTITIES[fd.to] && !["budgets"].includes(fd.to)) { /* validated below, after all entities are known */ }
  }
}
for (const e of Object.values(ENTITIES)) {
  for (const fd of Object.values(e.fields)) if (fd.type === "ref" && !ENTITIES[fd.to]) throw new Error(`schema: ${e.name}.${fd.name} references unknown entity ${fd.to}`);
  for (const t of e.title) if (!e.fields[t] && !["id"].includes(t)) throw new Error(`schema: ${e.name} title field ${t} does not exist`);
  for (const c of e.list) if (!e.fields[c] && !["id", "created", "updated", "created_by", "updated_by"].includes(c)) throw new Error(`schema: ${e.name} list column ${c} does not exist`);
  if (e.program && e.program !== "id" && !e.fields[e.program]) throw new Error(`schema: ${e.name} program field ${e.program} does not exist`);
}

/** Columns added to every table by the engine. */
export const SYSTEM_COLS = ["id", "created", "updated", "created_by", "updated_by", "rev"];

/** Whether a field is stored encrypted (type `secret`). */
export const isSecretField = (fd) => fd.type === "secret";
/** SQLite column type of a field type (money and ints are INTEGER, num/pct REAL, everything else TEXT). */
export const colType = (fd) => ({ int: "INTEGER", ref: "INTEGER", bool: "INTEGER", money: "INTEGER", num: "REAL", pct: "REAL" })[fd.type] || "TEXT";

/** Human label of a row, built from the entity's `title` fields. */
export function rowLabel(e, row) {
  if (!row) return "";
  const parts = e.title.map((t) => row[t]).filter((v) => v !== null && v !== undefined && v !== "");
  const s = parts.join(e.titleSep || " · ");
  return (e.titlePrefix || "") + (s || `#${row.id}`);
}
