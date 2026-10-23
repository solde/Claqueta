// Generic entity engine: validation, CRUD, filters, change log, field encryption, external scoping, hooks. Everything the UI and the agent do goes through here.
import { q, tx } from "./db.mjs";
import { ENTITIES, MODULES, PERMS, rowLabel, SYSTEM_COLS } from "./schema.mjs";
import { has, canRead, canWrite, canReadField, canWriteField, memberPrograms, memberInfo } from "./access.mjs";
import { encField, decField } from "./crypto.mjs";
import { bad, forbidden, notFound, conflict, HttpError, now, isDate, isTime, isDateTime, toCents, fromCents } from "./util.mjs";

const hooks = {};   // entity -> { before: [fn], after: [fn] }
/** Register logic: before(op, ctx, data, existing) may change `data` (DB-level values: money in cents); after(op, ctx, row, existing) runs in the same transaction. */
export function hook(entity, when, fn) { ((hooks[entity] ||= { before: [], after: [] })[when]).push(fn); }
const run = async (list, ...a) => { for (const fn of list || []) fn(...a); };

const ent = (name) => { const e = ENTITIES[name]; if (!e) throw notFound(`unknown_entity:${name}`); return e; };
/** Names of every entity of the schema. */
export const entityNames = () => Object.keys(ENTITIES);
const Q = (n) => `"${n}"`;
const SYS_NUM = new Set(["id", "rev"]);

// ---- conversion -----------------------------------------------------------------------------------------------------------------------
function parseJson(v) { if (v == null || v === "") return null; try { return JSON.parse(v); } catch { return null; } }
/** Database row to API row: money from cents to euros, JSON/tags parsed, secrets decrypted, bools as 0/1; fields the caller may not read are left out. */
export function fromDb(e, row, ctx) {
  if (!row) return row;
  const out = { id: row.id, created: row.created, updated: row.updated, created_by: row.created_by, updated_by: row.updated_by, rev: row.rev };
  for (const fd of Object.values(e.fields)) {
    if (ctx && !canReadField(ctx, fd)) continue;
    let v = row[fd.name];
    switch (fd.type) {
      case "money": v = fromCents(v); break;
      case "json": v = parseJson(v); break;
      case "tags": v = parseJson(v) || []; break;
      case "secret": try { v = decField(v); } catch { v = null; } break;
      case "bool": v = v ? 1 : 0; break;
      default: break;
    }
    out[fd.name] = v;
  }
  return out;
}

/** undefined, null and "" all count as "no value" when converting input. */
const emptyish = (v) => v === undefined || v === null || v === "";
/** Validates and converts one API value to its database representation by field type (ranges, formats, options, references that must exist); throws 400 with a stable code per field. */
function convert(e, fd, v) {
  if (emptyish(v)) return fd.type === "bool" ? 0 : (["text", "long", "enum"].includes(fd.type) ? (fd.type === "enum" ? null : "") : null);
  const name = `${e.name}.${fd.name}`;
  switch (fd.type) {
    case "text": case "long": {
      const s = String(v); if (fd.max && s.length > fd.max) throw bad(`too_long:${fd.name}`);
      if (fd.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(`invalid_email:${fd.name}`);
      if (fd.format === "url" && !/^(https?:\/\/|[a-z]+:\/\/|\/|\\\\)/i.test(s)) throw bad(`invalid_url:${fd.name}`);
      if (fd.format === "color" && !/^#[0-9a-f]{3,8}$/i.test(s)) throw bad(`invalid_color:${fd.name}`);
      return s;
    }
    case "secret": { const s = String(v); if (s.length > fd.max) throw bad(`too_long:${fd.name}`); return encField(s); }
    case "int": { const n = Number(v); if (!Number.isInteger(n)) throw bad(`invalid_int:${fd.name}`); if ((fd.min != null && n < fd.min) || (fd.max != null && n > fd.max)) throw bad(`out_of_range:${fd.name}`); return n; }
    case "num": case "pct": { const n = Number(v); if (!Number.isFinite(n)) throw bad(`invalid_number:${fd.name}`); if ((fd.min != null && n < fd.min) || (fd.max != null && n > fd.max)) throw bad(`out_of_range:${fd.name}`); return n; }
    case "money": { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > 1e11) throw bad(`invalid_money:${fd.name}`); return toCents(n); }
    case "bool": return v === true || v === 1 || v === "1" || v === "true" || v === "on" ? 1 : 0;
    case "date": { const s = String(v).slice(0, 10); if (!isDate(s)) throw bad(`invalid_date:${fd.name}`); return s; }
    case "datetime": { const s = String(v); if (!isDateTime(s)) throw bad(`invalid_datetime:${fd.name}`); return s.replace(" ", "T"); }
    case "time": { const s = String(v); if (!isTime(s)) throw bad(`invalid_time:${fd.name}`); return s.slice(0, 5); }
    case "enum": { const s = String(v); if (!fd.options.includes(s)) throw bad(`invalid_option:${fd.name}`, { options: fd.options }); return s; }
    case "ref": {
      const n = Number(v); if (!Number.isInteger(n) || n < 1) throw bad(`invalid_ref:${fd.name}`);
      if (!q.get(`SELECT 1 AS x FROM ${Q(fd.to)} WHERE id = ?`, n)) throw bad(`invalid_ref:${fd.name}`, { to: fd.to, id: n });
      return n;
    }
    case "json": { const o = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { throw bad(`invalid_json:${fd.name}`); } })() : v; const s = JSON.stringify(o); if (s.length > fd.max) throw bad(`too_long:${fd.name}`); return s; }
    case "tags": { const a = Array.isArray(v) ? v : String(v).split(",").map((x) => x.trim()).filter(Boolean); return JSON.stringify(a.map(String).slice(0, 100)); }
    default: throw new HttpError(500, `unsupported_type:${name}`);
  }
}

/** Body (API values) -> DB values. `partial`: only the provided fields. Read-only fields are ignored unless opts.internal. */
function toDb(ctx, e, body, { partial, internal } = {}) {
  const out = {};
  for (const fd of Object.values(e.fields)) {
    const provided = Object.prototype.hasOwnProperty.call(body, fd.name);
    if (fd.ro && !internal) continue;
    if (!provided) {
      if (!partial && fd.default !== undefined && !fd.ro) out[fd.name] = fd.type === "bool" || fd.type === "int" || fd.type === "num" || fd.type === "pct" ? fd.default : (fd.type === "money" ? toCents(fd.default) : fd.default);
      continue;
    }
    if (!internal && !canWriteField(ctx, fd)) throw forbidden(`field_forbidden:${fd.name}`);
    out[fd.name] = convert(e, fd, body[fd.name]);
  }
  if (!partial) for (const fd of Object.values(e.fields)) {
    if (fd.required && (out[fd.name] === undefined || out[fd.name] === null || out[fd.name] === "")) throw bad(`required:${fd.name}`);
  }
  return out;
}

/** Turns SQLite constraint failures into API errors: duplicates and in-use rows are 409, broken references 400. */
function mapDbError(err, op) {
  const m = String(err?.message || err);
  if (/UNIQUE constraint failed: ([\w]+)\.(\w+)/.test(m)) throw conflict(`duplicate:${m.match(/\.(\w+)/)[1]}`);
  if (/UNIQUE constraint failed/.test(m)) throw conflict("duplicate");
  if (/FOREIGN KEY constraint failed/.test(m)) throw op === "delete" ? conflict("in_use") : bad("invalid_ref");
  throw err;
}

// ---- scoping & filters ----------------------------------------------------------------------------------------------------------------
function scopeClause(ctx, e) {
  if (e.module === "own" && !ctx.local) return { sql: '"user" = ?', args: [ctx.user] };
  if (!ctx.external) return { sql: "", args: [] };
  if (!e.ext?.read) return { sql: "0", args: [] };
  const parts = [], args = [];
  const progs = memberPrograms(ctx);
  const pf = e.program === "id" ? "id" : e.program;
  if (pf) { if (!progs.length) return { sql: "0", args: [] }; parts.push(`${Q(pf)} IN (${progs.map(() => "?").join(",")})`); args.push(...progs); }
  if (typeof e.ext.where === "string") { parts.push(`(${e.ext.where.replace(/:user/g, "?")})`); for (const _ of e.ext.where.matchAll(/:user/g)) args.push(ctx.user); }
  return { sql: parts.join(" AND "), args };
}

const OPS = [[">=", ">="], ["<=", "<="], ["!=", "!="], [">", ">"], ["<", "<"]];
/** One `f.<field>=<value>` filter to SQL. Values: plain equality, `>=` `<=` `>` `<` `!=`, `in:a|b`, `~text` (contains), `null`, `notnull`. */
function filterClause(e, field, raw) {
  const fd = e.fields[field]; const col = fd ? Q(field) : (SYS_NUM.has(field) || ["created", "updated", "created_by", "updated_by"].includes(field) ? Q(field) : null);
  if (!col) throw bad(`unknown_field:${field}`);
  const val = (s) => (fd?.type === "money" ? toCents(s) : fd?.type === "bool" ? (["1", "true", "on"].includes(String(s)) ? 1 : 0) : (["int", "ref", "num", "pct"].includes(fd?.type) || SYS_NUM.has(field) ? Number(s) : String(s)));
  const s = String(raw);
  if (s === "null") return { sql: `(${col} IS NULL OR ${col} = '')`, args: [] };
  if (s === "notnull") return { sql: `(${col} IS NOT NULL AND ${col} != '')`, args: [] };
  if (s.startsWith("in:")) { const vs = s.slice(3).split(/[|,]/).filter((x) => x !== ""); if (!vs.length) return { sql: "0", args: [] }; return { sql: `${col} IN (${vs.map(() => "?").join(",")})`, args: vs.map(val) }; }
  if (s.startsWith("~")) return { sql: `${col} LIKE ? ESCAPE '\\'`, args: [`%${s.slice(1).replace(/[\\%_]/g, "\\$&")}%`] };
  for (const [p, op] of OPS) if (s.startsWith(p)) return { sql: `${col} ${op} ?`, args: [val(s.slice(p.length))] };
  return { sql: `${col} = ?`, args: [val(s)] };
}

/** ORDER BY from a `sort` string (`-field` descending, comma separated), validated against the schema; `id` is always the last tie-breaker. */
function orderBy(e, sort) {
  const parts = [];
  for (const s of String(sort || e.sort).split(",")) {
    const desc = s.startsWith("-"), f = desc ? s.slice(1) : s;
    if (!(e.fields[f] || SYSTEM_COLS.includes(f))) throw bad(`unknown_sort:${f}`);
    parts.push(`${Q(f)} ${desc ? "DESC" : "ASC"}`);
  }
  return parts.join(", ") + (parts.some((p) => p.startsWith('"id"')) ? "" : ', "id" ASC');
}

/** WHERE clause for list/count: external scoping, filters, explicit ids and free-text search over the entity's `search` fields. */
function buildList(ctx, e, params = {}) {
  const where = [], args = [];
  const sc = scopeClause(ctx, e); if (sc.sql) { where.push(sc.sql); args.push(...sc.args); }
  for (const [k, v] of Object.entries(params.filters || {})) { const c = filterClause(e, k, v); where.push(c.sql); args.push(...c.args); }
  if (params.ids) { const ids = String(params.ids).split(",").map(Number).filter(Number.isInteger).slice(0, 2000); if (!ids.length) where.push("0"); else { where.push(`id IN (${ids.map(() => "?").join(",")})`); args.push(...ids); } }
  const text = String(params.q || "").trim();
  if (text) {
    const cols = [...new Set([...e.search, ...e.title.filter((t) => e.fields[t] && ["text", "long"].includes(e.fields[t].type))])].filter((c) => e.fields[c] && e.fields[c].type !== "secret");
    if (cols.length) { where.push("(" + cols.map((c) => `${Q(c)} LIKE ? ESCAPE '\\'`).join(" OR ") + ")"); const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`; args.push(...cols.map(() => like)); }
  }
  return { sql: where.length ? " WHERE " + where.join(" AND ") : "", args };
}

// ---- reads ----------------------------------------------------------------------------------------------------------------------------
function assertRead(ctx, e) { if (!canRead(ctx, e)) throw forbidden("forbidden"); }

/** Lists rows of an entity with filters, search, sort and paging; returns { rows, total, refs } where refs maps referenced ids to labels (omit with refs=0). */
export function list(ctx, name, params = {}) {
  const e = ent(name); assertRead(ctx, e);
  const w = buildList(ctx, e, params);
  const limit = params.limit === "all" ? 5000 : Math.max(1, Math.min(2000, Number(params.limit) || 200)), offset = Math.max(0, Number(params.offset) || 0);
  const total = q.get(`SELECT COUNT(*) AS n FROM ${Q(e.table)}${w.sql}`, ...w.args).n;
  const rows = q.all(`SELECT * FROM ${Q(e.table)}${w.sql} ORDER BY ${orderBy(e, params.sort)} LIMIT ${limit} OFFSET ${offset}`, ...w.args).map((r) => fromDb(e, r, ctx));
  return { rows, total, refs: params.refs === "0" ? undefined : refLabels(ctx, e, rows) };
}

/** One row by id (404 when it does not exist or the caller may not see it); `raw` returns the database row without conversion. */
export function getRow(ctx, name, id, { raw } = {}) {
  const e = ent(name); if (ctx) assertRead(ctx, e);
  const sc = ctx ? scopeClause(ctx, e) : { sql: "", args: [] };
  const row = q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?${sc.sql ? " AND " + sc.sql : ""}`, Number(id), ...sc.args);
  if (!row) throw notFound();
  return raw ? row : fromDb(e, row, ctx);
}
/** A row plus the labels of the rows it references (what the detail view needs). */
export function get(ctx, name, id) {
  const e = ent(name); const row = getRow(ctx, name, id);
  return { row, refs: refLabels(ctx, e, [row]) };
}
/** Internal read without permission checks (hooks, reports). */
export const rawGet = (name, id) => (id == null ? undefined : q.get(`SELECT * FROM ${Q(ent(name).table)} WHERE id = ?`, Number(id)));
/** Display label of a row (its title fields joined), or "" when it does not exist. */
export const label = (name, id) => { const e = ent(name); const r = rawGet(name, id); return r ? rowLabel(e, r) : ""; };

/** { entity: { id: "label" } } for every ref field present in `rows`. */
export function refLabels(ctx, e, rows) {
  const need = {};
  for (const fd of Object.values(e.fields)) if (fd.type === "ref") for (const r of rows) if (r[fd.name]) (need[fd.to] ||= new Set()).add(r[fd.name]);
  const out = {};
  for (const [to, ids] of Object.entries(need)) {
    const te = ENTITIES[to]; if (!te || (ctx && !has(ctx, MODULES[te.module]?.view || "app.view") && te.module !== "own")) continue;
    const cols = [...new Set(["id", ...te.title])].filter((c) => c === "id" || te.fields[c]);
    const rs = q.all(`SELECT ${cols.map(Q).join(",")} FROM ${Q(te.table)} WHERE id IN (${[...ids].map(() => "?").join(",")})`, ...ids);
    out[to] = Object.fromEntries(rs.map((r) => [r.id, rowLabel(te, r)]));
  }
  return out;
}

// ---- writes ---------------------------------------------------------------------------------------------------------------------------
function programOf(e, row) { return e.program === "id" ? row.id : e.program ? row[e.program] ?? null : null; }
function logChange(ctx, e, id, action, diff, row) {
  if (e.noHistory) return;
  q.run("INSERT INTO changes(ts, user, entity, row_id, action, program_id, diff) VALUES (?, ?, ?, ?, ?, ?, ?)", now(), ctx.user, e.name, id, action, row ? programOf(e, row) : null, JSON.stringify(diff));
}

function assertWrite(ctx, e, existing, op) {
  if (!canWrite(ctx, e)) throw forbidden("forbidden");
  if (!ctx.external) return;
  const w = e.ext.write;
  if (typeof w === "string" && existing) {
    const sc = q.get(`SELECT 1 AS ok FROM ${Q(e.table)} WHERE id = ? AND (${w.replace(/:user/g, "?")})`, existing.id, ...[...w.matchAll(/:user/g)].map(() => ctx.user));
    if (!sc) throw forbidden("forbidden");
  }
  if (op === "create" && typeof w === "string") throw forbidden("forbidden");
  if (w === true && existing && existing.created_by !== ctx.user) throw forbidden("forbidden");
  const pf = e.program === "id" ? "id" : e.program;
  if (existing && pf && !memberPrograms(ctx).includes(existing[pf])) throw forbidden("forbidden");
}

/** Creates a row: permission and field checks, validation, `before` hooks (business rules), insert, change log, `after` hooks, all in one transaction. `opts.internal` allows read-only fields (system writes). */
export async function create(ctx, name, body, opts = {}) {
  const e = ent(name);
  if (ctx && e.module === "own" && !ctx.local) throw forbidden("forbidden");
  if (ctx) assertWrite(ctx, e, null, "create");
  const c = ctx || opts.system;
  return tx(() => {
    if (c.external) { // external users: only comments (member with can_comment on a visible row) are created
      const pid = body.program_id ?? null;
      if (e.name === "comments") { const m = pid && memberInfo(c, Number(pid)); if (!m || !m.can_comment) throw forbidden("forbidden"); }
      else throw forbidden("forbidden");
    }
    const data = toDb(c, e, body, { partial: false, internal: opts.internal });
    for (const fn of hooks[name]?.before || []) fn("create", c, data, null);
    const cols = Object.keys(data), ts = now();
    const all = [...cols, "created", "updated", "created_by", "updated_by", "rev"];
    const vals = [...cols.map((k) => data[k]), ts, ts, c.user, c.user, 1];
    let id;
    try { id = Number(q.run(`INSERT INTO ${Q(e.table)} (${all.map(Q).join(",")}) VALUES (${all.map(() => "?").join(",")})`, ...vals).lastInsertRowid); } catch (err) { mapDbError(err, "create"); }
    const row = q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?`, id);
    logChange(c, e, id, "create", row, row);
    for (const fn of hooks[name]?.after || []) fn("create", c, row, null);
    return fromDb(e, q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?`, id), c);
  });
}

/** Partial update with optimistic concurrency (`rev` must match when given), field-level permissions, hooks and a diff in the change log. No-op updates write nothing. */
export async function update(ctx, name, id, body, opts = {}) {
  const e = ent(name);
  return tx(() => {
    const existing = q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?`, Number(id));
    if (!existing) throw notFound();
    if (ctx) {
      if (!canRead(ctx, e) || (ctx.external && !q.get(`SELECT 1 AS x FROM ${Q(e.table)} WHERE id = ?${scopeClause(ctx, e).sql ? " AND " + scopeClause(ctx, e).sql : ""}`, existing.id, ...scopeClause(ctx, e).args))) throw notFound();
      if (e.module === "own" && !ctx.local && existing.user !== ctx.user) throw notFound();
      assertWrite(ctx, e, existing, "update");
      if (e.module === "own" && !ctx.local && Object.keys(body).some((k) => k !== "read" && k !== "rev")) throw forbidden("forbidden");
      if (ctx.external && Array.isArray(e.ext.writeFields)) for (const k of Object.keys(body)) if (k !== "rev" && !e.ext.writeFields.includes(k)) throw forbidden(`field_forbidden:${k}`);
    }
    const c = ctx || opts.system;
    if (body.rev !== undefined && Number(body.rev) !== existing.rev) throw conflict("stale", { current: fromDb(e, existing, c) });
    const data = toDb(c, e, body, { partial: true, internal: opts.internal });
    for (const fn of hooks[name]?.before || []) fn("update", c, data, existing);
    const diff = {};
    for (const [k, v] of Object.entries(data)) if ((existing[k] ?? null) !== (v ?? null)) diff[k] = [existing[k] ?? null, v ?? null];
    if (!Object.keys(diff).length && !opts.force) return fromDb(e, existing, c);
    const cols = Object.keys(data);
    if (cols.length) try {
      q.run(`UPDATE ${Q(e.table)} SET ${cols.map((k) => `${Q(k)} = ?`).join(", ")}, "updated" = ?, "updated_by" = ?, "rev" = "rev" + 1 WHERE id = ?`, ...cols.map((k) => data[k]), now(), c.user, existing.id);
    } catch (err) { mapDbError(err, "update"); }
    const row = q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?`, existing.id);
    logChange(c, e, existing.id, "update", diff, row);
    for (const fn of hooks[name]?.after || []) fn("update", c, row, existing);
    return fromDb(e, q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?`, existing.id), c);
  });
}

/** Deletes a row (blocked with 409 `in_use` when something references it), logs it, removes its attachments and runs hooks. */
export async function remove(ctx, name, id, opts = {}) {
  const e = ent(name);
  return tx(() => {
    const existing = q.get(`SELECT * FROM ${Q(e.table)} WHERE id = ?`, Number(id));
    if (!existing) throw notFound();
    const c = ctx || opts.system;
    if (ctx) { if (!canRead(ctx, e)) throw notFound(); if (e.module === "own" && !ctx.local && existing.user !== ctx.user) throw notFound(); assertWrite(ctx, e, existing, "delete"); }
    for (const fn of hooks[name]?.before || []) fn("delete", c, {}, existing);
    try { q.run(`DELETE FROM ${Q(e.table)} WHERE id = ?`, existing.id); } catch (err) { mapDbError(err, "delete"); }
    logChange(c, e, existing.id, "delete", existing, existing);
    q.run("DELETE FROM attachments WHERE entity = ? AND row_id = ?", e.name, existing.id);
    for (const fn of hooks[name]?.after || []) fn("delete", c, existing, existing);
    return { ok: true };
  });
}

/** Change history of a row (newest first) with secret values masked and fields the caller cannot read removed. */
export function history(ctx, name, id, limit = 100) {
  const e = ent(name); getRow(ctx, name, id).id;
  return q.all("SELECT id, ts, user, action, diff FROM changes WHERE entity = ? AND row_id = ? ORDER BY id DESC LIMIT ?", name, Number(id), limit).map((r) => ({ ...r, diff: maskDiff(e, ctx, JSON.parse(r.diff || "{}"), r.action) }));
}
/** Hides secrets and unreadable fields in a stored change diff, and converts money back to euros. */
function maskDiff(e, ctx, d, action) {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    const fd = e.fields[k];
    if (fd && !canReadField(ctx, fd)) continue;
    if (fd?.type === "secret") out[k] = action === "update" ? ["••••", "••••"] : "••••";
    else if (fd?.type === "money") out[k] = Array.isArray(v) ? v.map(fromCents) : fromCents(v);
    else out[k] = v;
  }
  return out;
}
/** Activity feed (all or one programme) restricted to what the caller may read. */
export function activity(ctx, { program, limit = 60 } = {}) {
  const rows = q.all(`SELECT id, ts, user, entity, row_id, action, program_id FROM changes ${program ? "WHERE program_id = ?" : ""} ORDER BY id DESC LIMIT ?`, ...(program ? [Number(program)] : []), limit * 3);
  const out = [];
  for (const r of rows) {
    const e = ENTITIES[r.entity]; if (!e || !canRead(ctx, e)) continue;
    if (ctx.external && !(memberPrograms(ctx) || []).includes(r.program_id)) continue;
    out.push({ ...r, label: r.action === "delete" ? "" : (() => { const row = rawGet(r.entity, r.row_id); return row ? rowLabel(e, row) : ""; })() });
    if (out.length >= limit) break;
  }
  return out;
}

/** Global search across every readable entity that declares search fields; at least two characters, a few hits per entity. */
export function search(ctx, text, limit = 6) {
  const t = String(text || "").trim(); if (t.length < 2) return [];
  const out = [];
  for (const e of Object.values(ENTITIES)) {
    if (e.hidden || e.module === "own" || !canRead(ctx, e) || !e.search.length) continue;
    try {
      const { rows } = list(ctx, e.name, { q: t, limit, refs: "0" });
      for (const r of rows) out.push({ entity: e.name, id: r.id, label: rowLabel(e, r) });
    } catch { /* an unreadable entity never breaks the search */ }
    if (out.length > 80) break;
  }
  return out;
}

// ---- notifications ----------------------------------------------------------------------------------------------------------------------
export function notify(user, title, body = "", link = "", key = null, kind = "info") {
  if (!user) return;
  try { q.run("INSERT INTO notifications(user, title, body, link, kind, key, read, created, updated, created_by, rev) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'system', 1)", user, title, body, link, kind, key, now(), now()); } catch { /* duplicate key = already notified */ }
}

// ---- schema for the client ----------------------------------------------------------------------------------------------------------------
export function schemaForClient(ctx) {
  const entities = {};
  for (const e of Object.values(ENTITIES)) {
    if (!canRead(ctx, e)) continue;
    const fields = {};
    for (const fd of Object.values(e.fields)) {
      if (!canReadField(ctx, fd)) continue;
      const { name, type, required, options, to, ro, max, min, default: dflt, filter, help, format, unique, cascade } = fd;
      fields[name] = { name, type, required, options, to, ro, max, min, default: dflt, filter, help, format, unique, cascade, writable: !ro && canWriteField(ctx, fd) };
    }
    entities[e.name] = { name: e.name, module: e.module, title: e.title, titlePrefix: e.titlePrefix, titleSep: e.titleSep, icon: e.icon, group: e.group, program: e.program, parent: e.parent, list: e.list,
      sort: e.sort, search: e.search, board: e.board, calendar: e.calendar, sections: e.sections, hidden: e.hidden, offline: e.offline, fields, canWrite: canWrite(ctx, e) };
  }
  return { entities, perms: ctx.local ? PERMS : [...ctx.perms], user: ctx.user, name: ctx.name, external: ctx.external };
}
