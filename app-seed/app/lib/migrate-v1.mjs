// One-time move from the first version of the app (projects/documents/tasks/personas/competitors/episodes/jobs) to the programme model.
// The old tables are renamed to v1_* BEFORE the new schema is created (they share names) and are kept forever as a backup.
import { q, db, getMeta, setMeta, tx } from "./db.mjs";
import { create } from "./engine.mjs";
import { localCtx } from "./access.mjs";
import { log, now } from "./util.mjs";

const OLD = ["projects", "documents", "document_versions", "tasks", "personas", "competitors", "episodes", "jobs"];
const has = (t) => !!q.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", t);

export function renameV1Tables() {
  if (getMeta("v1_renamed") || !has("projects") || has("programs")) return false;
  // the v1 `projects` table is the marker: the new schema has no such table
  db.exec("PRAGMA foreign_keys = OFF");
  try { for (const t of OLD) if (has(t)) db.exec(`ALTER TABLE "${t}" RENAME TO "v1_${t}"`); } finally { db.exec("PRAGMA foreign_keys = ON"); }
  setMeta("v1_renamed", now()); log("v1: old tables renamed to v1_*");
  return true;
}

const PSTATUS = { idea: "development", desarrollo: "development", preproduccion: "development", rodaje: "active", postproduccion: "active", emision: "active", archivado: "closed" };
const ESTATUS = { idea: "planned", escaleta: "script", guion: "script", rodado: "recorded", montado: "edited", entregado: "delivered" };
const DTYPE = { formato: "format", escaleta: "rundown", guion: "script", dossier: "dossier", audiencia: "audience", target: "target", competencia: "competitor", produccion: "production", marketing: "marketing", otro: "other" };
const PRIO = { baja: "low", media: "medium", alta: "high" };

export async function migrateV1() {
  if (getMeta("v1_migrated") || !has("v1_projects")) return;
  const ctx = localCtx("migracion"), map = new Map();
  for (const p of q.all("SELECT * FROM v1_projects ORDER BY id")) {
    let channel_id = null;
    if (p.channel) { const c = q.get("SELECT id FROM partners WHERE lower(name) = lower(?)", p.channel) || await create(ctx, "partners", { name: p.channel, kind: "channel" }); channel_id = c.id; }
    const row = await create(ctx, "programs", { name: p.name, logline: p.logline, genre: p.genre, format_desc: p.format, channel_id, status: PSTATUS[p.status] || "development", episodes_per_season: p.episodes || 0, duration_min: p.duration_min || 0, start_date: p.start_date || null, notes: p.notes });
    map.set(p.id, row.id);
  }
  const P = (id) => map.get(id);
  for (const e of q.all("SELECT * FROM v1_episodes ORDER BY id")) if (P(e.project_id)) await create(ctx, "episodes", { program_id: P(e.project_id), number: e.number || 1, title: e.title, synopsis: e.synopsis, status: ESTATUS[e.status] || "planned" });
  for (const t of q.all("SELECT * FROM v1_tasks ORDER BY id")) if (P(t.project_id)) await create(ctx, "tasks", { program_id: P(t.project_id), title: t.title, status: t.status, priority: PRIO[t.priority] || "medium", assignee: t.assignee, due: t.due || null, notes: t.notes });
  for (const p of q.all("SELECT * FROM v1_personas ORDER BY id")) if (P(p.project_id)) await create(ctx, "targets", { program_id: P(p.project_id), name: p.name, age_range: p.age_range, description: p.description, habits: p.habits, channels: p.channels, needs: p.needs, size_note: p.size_note });
  for (const c of q.all("SELECT * FROM v1_competitors ORDER BY id")) if (P(c.project_id)) await create(ctx, "competitors", { program_id: P(c.project_id), programme: c.programme, channel: c.channel, slot: c.slot, share: c.share, notes: c.notes });
  for (const d of q.all("SELECT * FROM v1_documents ORDER BY id")) if (P(d.project_id)) {
    const row = await create(ctx, "documents", { program_id: P(d.project_id), title: d.title, type: DTYPE[d.type] || "other", content: d.content, status: "draft", language: "es" });
    q.run("UPDATE documents SET created = ?, updated = ? WHERE id = ?", d.created || now(), d.updated || now(), row.id);
  }
  setMeta("v1_migrated", now()); log("v1: migrated", map.size, "programme(s)");
}
