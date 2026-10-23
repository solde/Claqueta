// Attachments: encrypted files (contracts, invoices, call sheets, logos, fonts...) stored under DATA/files, or plain links to external storage (NAS, cloud).
// A file inherits the access rules of the row it hangs from; externals only see attachments flagged `shared`.
import fs from "node:fs";
import path from "node:path";
import { q, orgFilesDir, currentSlug } from "./db.mjs";
import { ENTITIES } from "./schema.mjs";
import { getRow } from "./engine.mjs";
import { canWrite, canRead, has } from "./access.mjs";
import { encBuffer, decBuffer, sha256, randomId } from "./crypto.mjs";
import { bad, forbidden, notFound, now, log } from "./util.mjs";

// attachments live in the current organization's own folder (DATA/files for the legacy one, DATA/orgs/<slug>/files for the others)
const filesDir = () => { const d = orgFilesDir(currentSlug()); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
export const MAX_FILE = 40 * 1024 * 1024;
export function initFiles() { filesDir(); }
const safeName = (n) => String(n || "file").replace(/[\\/\0]/g, "_").replace(/[^\p{L}\p{N}._ ()+-]/gu, "_").slice(0, 160) || "file";
const MIME_OK = /^[\w.+-]+\/[\w.+-]+$/;

function parentRow(ctx, entity, id) {
  const e = ENTITIES[entity]; if (!e) throw bad("unknown_entity");
  const row = getRow(ctx, entity, id, { raw: true });   // read access + external scoping
  return { e, row };
}
export function addFile(ctx, { entity, id, name, mime, buffer, shared = 0, label = "" }) {
  const { e, row } = parentRow(ctx, entity, id);
  if (!canWrite(ctx, e)) throw forbidden("forbidden");
  if (ctx.external) throw forbidden("forbidden");
  if (!buffer.length) throw bad("empty_file");
  if (buffer.length > MAX_FILE) throw bad("file_too_large");
  const file = path.join(randomId(18) + ".bin"), full = path.join(filesDir(), file);
  fs.writeFileSync(full, encBuffer(buffer), { mode: 0o600 });
  const m = MIME_OK.test(mime || "") ? mime : "application/octet-stream";
  const r = q.run("INSERT INTO attachments(entity, row_id, program_id, name, mime, size, sha256, kind, path, encrypted, shared, label, created, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'file', ?, 1, ?, ?, ?, ?)",
    entity, row.id, e.program === "id" ? row.id : (e.program ? row[e.program] : null), safeName(name), m, buffer.length, sha256(buffer), file, shared ? 1 : 0, label, now(), ctx.user);
  q.run("INSERT INTO changes(ts, user, entity, row_id, action, program_id, diff) VALUES (?, ?, ?, ?, 'attach', ?, ?)", now(), ctx.user, entity, row.id, e.program === "id" ? row.id : (e.program ? row[e.program] : null), JSON.stringify({ file: [null, safeName(name)] }));
  return getAttachment(Number(r.lastInsertRowid));
}
export function addLink(ctx, { entity, id, url, label, shared = 0 }) {
  const { e, row } = parentRow(ctx, entity, id);
  if (!canWrite(ctx, e) || ctx.external) throw forbidden("forbidden");
  if (!/^(https?:\/\/|smb:\/\/|\\\\|\/)/i.test(String(url || ""))) throw bad("invalid_url");
  const r = q.run("INSERT INTO attachments(entity, row_id, program_id, name, kind, url, shared, label, created, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, ?, ?, ?)",
    entity, row.id, e.program === "id" ? row.id : (e.program ? row[e.program] : null), safeName(label || url), String(url).slice(0, 1000), shared ? 1 : 0, label || "", now(), ctx.user);
  return getAttachment(Number(r.lastInsertRowid));
}
export const getAttachment = (id) => q.get("SELECT id, entity, row_id, program_id, name, mime, size, sha256, kind, url, shared, label, created, created_by FROM attachments WHERE id = ?", Number(id));
export function listFiles(ctx, entity, id) {
  const { row } = parentRow(ctx, entity, id);
  return q.all("SELECT id, name, mime, size, sha256, kind, url, shared, label, created, created_by FROM attachments WHERE entity = ? AND row_id = ?" + (ctx.external ? " AND shared = 1" : "") + " ORDER BY id DESC", entity, row.id);
}
/** Throws unless the caller may read this attachment (same rules as readFile, without decrypting it). */
export function assertCanRead(ctx, id) {
  const a = q.get("SELECT entity, row_id, shared, kind FROM attachments WHERE id = ?", Number(id)); if (!a) throw notFound();
  parentRow(ctx, a.entity, a.row_id); if (ctx.external && !a.shared) throw notFound(); if (a.kind !== "file") throw bad("not_a_file");
}
export function readFile(ctx, id) {
  const a = q.get("SELECT * FROM attachments WHERE id = ?", Number(id)); if (!a) throw notFound();
  parentRow(ctx, a.entity, a.row_id);
  if (ctx.external && !a.shared) throw notFound();
  if (a.kind !== "file") throw bad("not_a_file");
  const buf = decBuffer(fs.readFileSync(path.join(filesDir(), a.path)));
  return { name: a.name, mime: a.mime, buffer: buf };
}
/** Internal read (renderers: logos, fonts) without row-level checks. */
export function readFileRaw(id) {
  const a = q.get("SELECT * FROM attachments WHERE id = ? AND kind = 'file'", Number(id)); if (!a) return null;
  try { return { name: a.name, mime: a.mime, buffer: decBuffer(fs.readFileSync(path.join(filesDir(), a.path))) }; } catch { return null; }
}
export function removeFile(ctx, id) {
  const a = q.get("SELECT * FROM attachments WHERE id = ?", Number(id)); if (!a) throw notFound();
  const { e } = parentRow(ctx, a.entity, a.row_id);
  if (!canWrite(ctx, e) || ctx.external) throw forbidden("forbidden");
  q.run("DELETE FROM attachments WHERE id = ?", a.id);
  if (a.path) try { fs.rmSync(path.join(filesDir(), a.path), { force: true }); } catch { /* sweep removes it later */ }
  q.run("INSERT INTO changes(ts, user, entity, row_id, action, program_id, diff) VALUES (?, ?, ?, ?, 'detach', ?, ?)", now(), ctx.user, a.entity, a.row_id, a.program_id, JSON.stringify({ file: [a.name, null] }));
  return { ok: true };
}
export function sweepFiles() {
  const used = new Set(q.all("SELECT path FROM attachments WHERE path IS NOT NULL").map((r) => r.path));
  let n = 0; for (const f of fs.readdirSync(filesDir())) if (f.endsWith(".bin") && !used.has(f)) { fs.rmSync(path.join(filesDir(), f), { force: true }); n++; }
  if (n) log("files: removed", n, "orphan file(s)");
}
