// SQLite (node:sqlite) setup: pragmas, tiny query helpers, transactions, and additive table/column creation from the schema.
import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { ENTITIES, colType } from "./schema.mjs";
import { log } from "./util.mjs";

// MULTI-COMPANY: every organization has its own SQLite file and its own attachments folder. Everything below (`q`, `tx`, settings, sequences...) works on the
// organization of the request in progress, kept in an AsyncLocalStorage (so a handler that awaits can never touch another company's data). Outside a request
// (start-up, tests) the legacy organization is used. The legacy one keeps living at DATA/collado.db and DATA/files, so existing installs need no data move;
// the others live in DATA/orgs/<slug>/.
export const LEGACY_ORG = "principal", ORG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const als = new AsyncLocalStorage();
const orgs = new Map();   // slug -> { slug, db, cache, depth, dir, files }
let DATA_DIR = null;
export const orgDir = (slug) => (slug === LEGACY_ORG ? DATA_DIR : path.join(DATA_DIR, "orgs", slug));
export const orgFilesDir = (slug) => path.join(orgDir(slug), "files");
export const currentSlug = () => als.getStore()?.slug || LEGACY_ORG;
const cur = () => als.getStore() || (orgs.get(LEGACY_ORG) ?? (() => { throw new Error("database not open"); })());
/** Every organization that has data on disk (what background work iterates over). */
export function listOrgSlugs() {
  const out = [LEGACY_ORG]; try { for (const d of fs.readdirSync(path.join(DATA_DIR, "orgs"))) if (ORG_RE.test(d) && fs.existsSync(path.join(DATA_DIR, "orgs", d, "collado.db"))) out.push(d); } catch { /* no other organization yet */ }
  return out;
}
/** Opens (creating, syncing the schema and seeding on first use) an organization and runs fn with it as the current one. Concurrent first requests share the same set-up. */
export async function inOrg(slug, fn, name) { const o = openOrg(slug, name); await o.ready; return als.run(o, fn); }
/** Hooks run once per organization right after its database is created/opened (schema sync + seeds are registered by the server). */
let onOpen = () => {}; export const setOrgInit = (fn) => { onOpen = fn; };
export const db = new Proxy({}, { get: (_, k) => { const d = cur().db, v = d[k]; return typeof v === "function" ? v.bind(d) : v; } });
const prep = (sql) => { const o = cur(); let s = o.cache.get(sql); if (!s) { s = o.db.prepare(sql); if (o.cache.size > 800) o.cache.clear(); o.cache.set(sql, s); } return s; };
export const q = {
  all: (sql, ...p) => prep(sql).all(...p),
  get: (sql, ...p) => prep(sql).get(...p),
  run: (sql, ...p) => prep(sql).run(...p),
  exec: (sql) => cur().db.exec(sql),
};
/** Runs fn inside a transaction (nested calls join the outer one). */
export function tx(fn) {
  const o = cur();
  if (o.depth > 0) return fn();
  o.db.exec("BEGIN IMMEDIATE"); o.depth++;
  try { const r = fn(); o.db.exec("COMMIT"); return r; } catch (e) { try { o.db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; } finally { o.depth--; }
}

const INTERNAL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT, updated_by TEXT);
CREATE TABLE IF NOT EXISTS sequences (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user TEXT, entity TEXT NOT NULL, row_id INTEGER, action TEXT NOT NULL, program_id INTEGER, diff TEXT);
CREATE INDEX IF NOT EXISTS ix_changes_row ON changes(entity, row_id);
CREATE INDEX IF NOT EXISTS ix_changes_ts ON changes(ts);
CREATE INDEX IF NOT EXISTS ix_changes_program ON changes(program_id);
CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY, entity TEXT NOT NULL, row_id INTEGER NOT NULL, program_id INTEGER, name TEXT NOT NULL, mime TEXT, size INTEGER DEFAULT 0,
  sha256 TEXT, kind TEXT NOT NULL DEFAULT 'file', url TEXT, path TEXT, encrypted INTEGER DEFAULT 1, shared INTEGER DEFAULT 0, label TEXT, created TEXT, created_by TEXT);
CREATE INDEX IF NOT EXISTS ix_att_row ON attachments(entity, row_id);
CREATE TABLE IF NOT EXISTS app_users (username TEXT PRIMARY KEY, name TEXT, roles TEXT, perms TEXT, last_seen TEXT);
`;

/** Opens the legacy organization (the server then opens the others on demand). */
export function openDb(dataDir) { DATA_DIR = dataDir; return openOrg(LEGACY_ORG).db; }
function openOrg(slug, name) {
  let o = orgs.get(slug); if (o) return o;
  if (!ORG_RE.test(slug) || !DATA_DIR) throw new Error("invalid_org");
  const dir = orgDir(slug); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const d = new DatabaseSync(path.join(dir, "collado.db"));
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;"); d.exec(INTERNAL);
  o = { slug, db: d, cache: new Map(), depth: 0 }; orgs.set(slug, o);
  o.ready = slug === LEGACY_ORG ? Promise.resolve() : als.run(o, async () => { try { await onOpen(slug, name); } catch (e) { orgs.delete(slug); try { d.close(); } catch { /* ignore */ } throw e; } });   // the legacy one is initialised by the server's start-up sequence
  return o;
}
export function closeAll() { for (const o of orgs.values()) try { o.db.close(); } catch { /* already closed */ } }

const quote = (n) => `"${n}"`;
function colDef(fd) {
  let d = `${quote(fd.name)} ${colType(fd)}`;
  if (fd.type === "ref") d += ` REFERENCES ${quote(fd.to)}(id) ON DELETE ${fd.cascade ? "CASCADE" : "RESTRICT"}`;
  else if (fd.default !== undefined && fd.default !== null && fd.default !== "" && !["json", "tags", "secret"].includes(fd.type)) d += ` DEFAULT ${typeof fd.default === "number" ? fd.default : `'${String(fd.default).replace(/'/g, "''")}'`}`;
  return d;
}

/** Creates missing tables and adds missing columns/indexes. Never drops or alters anything existing. */
export function syncSchema() {
  const existing = (t) => new Set(q.all(`PRAGMA table_info(${quote(t)})`).map((c) => c.name));
  for (const e of Object.values(ENTITIES)) {
    const have = existing(e.table);
    if (!have.size) {
      const cols = ['"id" INTEGER PRIMARY KEY', '"created" TEXT', '"updated" TEXT', '"created_by" TEXT', '"updated_by" TEXT', '"rev" INTEGER DEFAULT 1', ...Object.values(e.fields).map(colDef)];
      q.exec(`CREATE TABLE ${quote(e.table)} (${cols.join(", ")})`);
      log("schema: created table", e.table);
    } else {
      for (const fd of Object.values(e.fields)) if (!have.has(fd.name)) { q.exec(`ALTER TABLE ${quote(e.table)} ADD COLUMN ${colDef(fd).replace(/ NOT NULL/g, "")}`); log("schema: added column", `${e.table}.${fd.name}`); }
      for (const c of [["created", "TEXT"], ["updated", "TEXT"], ["created_by", "TEXT"], ["updated_by", "TEXT"], ["rev", "INTEGER DEFAULT 1"]]) if (!have.has(c[0])) q.exec(`ALTER TABLE ${quote(e.table)} ADD COLUMN ${c[0]} ${c[1]}`);
    }
    for (const fd of Object.values(e.fields)) {
      if (fd.unique) q.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${e.table}_${fd.name} ON ${quote(e.table)}(${quote(fd.name)}) WHERE ${quote(fd.name)} IS NOT NULL AND ${quote(fd.name)} != ''`);
      else if (["ref", "date", "datetime"].includes(fd.type) || fd.name === "status") q.exec(`CREATE INDEX IF NOT EXISTS ix_${e.table}_${fd.name} ON ${quote(e.table)}(${quote(fd.name)})`);
    }
  }
}

export const getMeta = (k) => q.get("SELECT value FROM meta WHERE key = ?", k)?.value;
export const setMeta = (k, v) => q.run("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, String(v));
export function nextSeq(name) {
  return tx(() => {
    const r = q.get("SELECT value FROM sequences WHERE name = ?", name);
    const v = (r?.value || 0) + 1;
    q.run("INSERT INTO sequences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", name, v);
    return v;
  });
}
export const getSetting = (key, dflt = null) => { const r = q.get("SELECT value FROM settings WHERE key = ?", key); if (!r) return dflt; try { return JSON.parse(r.value); } catch { return dflt; } };
export function setSetting(key, value, user = "system") {
  q.run("INSERT INTO settings(key, value, updated, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated, updated_by = excluded.updated_by",
    key, JSON.stringify(value), new Date().toISOString(), user);
}
