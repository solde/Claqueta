// Cloud sync of the whole Collado workspace, provider-agnostic (a folder, Google Drive, OneDrive: see ./providers). Content-addressed and encrypted:
//   remote layout (flat):  config.json (plain: salt + KDF + key check) · manifest.bin (encrypted: generation, lease, file table) · o-<name> (one encrypted object per distinct file content)
// One computer works at a time: the manifest carries a lease (device + expiry). Starting a session pulls what another computer pushed (the files that would be overwritten are moved to a
// backup folder first), ending it pushes only the objects the cloud does not have yet. SQLite databases are copied with VACUUM INTO, never while half-written.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { seal, open, subkeys, objectName, masterFrom, newSalt, KDF } from "./crypto.mjs";

/** A sync failure with a stable code (weak_passphrase, bad_passphrase, lease_held, remote_newer, object_corrupt...) and extra detail for the UI. */
export class SyncError extends Error { constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); } }

/** Lease length (20 min), largest file synced (256 MB) and number of backup folders kept (5). */
export const LEASE_MS = 20 * 60e3, MAX_FILE = 256 * 1048576, KEEP_BACKUPS = 5;
const SKIP_DIRS = new Set(["node_modules", ".npm-cache", ".npm-global", ".cache", ".Trash", "Proyectos", ".sync-staging"]);   // Proyectos/ holds links to folders of THIS computer
const SKIP_FILES = /(-wal|-shm|\.tmp|\.lock)$|^\.DS_Store$|^Thumbs\.db$|^\.credentials\.json$|^token$/;   // credentials and API tokens never leave the computer
const posix = (p) => p.split(path.sep).join("/");

// ---- remote bootstrap: the first computer creates config.json, the others unlock it with the same passphrase -------------------------------------------
export async function initRemote(provider, passphrase) {
  if (String(passphrase || "").length < 8) throw new SyncError("weak_passphrase");
  if (await provider.read("config.json")) throw new SyncError("remote_exists");
  const salt = newSalt(), master = masterFrom(passphrase, salt), k = subkeys(master);
  await provider.write("config.json", Buffer.from(JSON.stringify({ v: 1, kdf: KDF, salt: salt.toString("base64"), check: seal(k.enc, Buffer.from("collado")).toString("base64") })));
  return master;
}
/** Opens an existing cloud side with the passphrase (verifying the key check); throws bad_passphrase when it is wrong. */
export async function unlockRemote(provider, passphrase) {
  const raw = await provider.read("config.json"); if (!raw) throw new SyncError("no_remote");
  let cfg; try { cfg = JSON.parse(raw.toString("utf8")); } catch { throw new SyncError("remote_corrupt"); }
  const master = masterFrom(passphrase, Buffer.from(cfg.salt, "base64"), cfg.kdf);
  try { if (open(subkeys(master).enc, Buffer.from(cfg.check, "base64")).toString() !== "collado") throw 0; } catch { throw new SyncError("bad_passphrase"); }
  return master;
}
/** Whether the cloud already has a Collado workspace (config.json present). */
export const remoteExists = async (provider) => !!(await provider.read("config.json"));

/** SHA-256 of a file, streamed. */
function hashFile(abs) {
  return new Promise((res, rej) => { const h = crypto.createHash("sha256"); fs.createReadStream(abs).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });
}
/** Consistent copy of a live SQLite database with VACUUM INTO (never a half-written file); a plain copy when it is not a database. */
function snapshotDb(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { const db = new DatabaseSync(src, { readOnly: true }); try { db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); } finally { db.close(); } }
  catch { fs.copyFileSync(src, dest); }   // not a database after all (or a read-only quirk): a plain copy
}
/** Moves a file, falling back to copy-and-delete across devices. */
async function mv(from, to) { await fsp.mkdir(path.dirname(to), { recursive: true }); try { await fsp.rename(from, to); } catch (e) { if (e.code !== "EXDEV") throw e; await fsp.cp(from, to, { recursive: true }); await fsp.rm(from, { recursive: true, force: true }); } }
/** Runs `fn` over `items` with at most `n` in parallel. */
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

/** Content-addressed, encrypted two-way sync of the workspace with any provider: scan (with databases snapshotted), push (upload only the objects the cloud lacks, new manifest generation) and pull (download and verify into staging, back up what is replaced, then swap in), under a one-computer-at-a-time lease. */
export class SyncEngine {
  /** roots: [{ ns, dir, sqlite?: true }]  ·  device: { id, name }  ·  statePath: JSON file with what was synced last time  ·  backupsDir: where overwritten files go */
  constructor({ provider, master, device, roots, statePath, backupsDir, log = () => {}, onProgress = () => {}, now = () => Date.now(), concurrency = 3, maxFile = MAX_FILE }) {
    Object.assign(this, { provider, device, roots, statePath, backupsDir, log, onProgress, now, concurrency, maxFile }); this.keys = subkeys(master);
    this.state = { baseGeneration: 0, files: {}, lastSyncAt: 0 }; try { Object.assign(this.state, JSON.parse(fs.readFileSync(statePath, "utf8"))); } catch { /* first run */ }
    this.tmp = null;
  }
  #save() { fs.mkdirSync(path.dirname(this.statePath), { recursive: true }); const t = this.statePath + ".tmp"; fs.writeFileSync(t, JSON.stringify(this.state)); fs.renameSync(t, this.statePath); }
  #root(ns) { return this.roots.find((r) => r.ns === ns); }
  /** logical path ("ns/rel") -> absolute path, refusing anything that would leave the root */
  abs(logical) {
    const i = logical.indexOf("/"), root = this.#root(logical.slice(0, i)); if (!root) throw new SyncError("unknown_namespace");
    const rel = logical.slice(i + 1), full = path.resolve(root.dir, ...rel.split("/"));
    if (rel.split("/").some((s) => s === ".." || s === "") || (full !== root.dir && !full.startsWith(root.dir + path.sep))) throw new SyncError("bad_path");
    return full;
  }
  /** Deletes the temporary database snapshots. */
  cleanup() { if (this.tmp) { fs.rmSync(this.tmp, { recursive: true, force: true }); this.tmp = null; } }

  // ---- what is on this computer ------------------------------------------------------------------------------------------------------------------------
  /** Map logical -> { abs, size, mtimeMs, sha } for everything that would be synced. Databases are snapshotted first. */
  async scan({ hash = true } = {}) {
    const out = new Map(), skipped = [];
    for (const root of this.roots) {
      if (!fs.existsSync(root.dir)) continue;
      const walk = (dir, rel) => {
        let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (e.isSymbolicLink()) continue;
          const r = rel ? `${rel}/${e.name}` : e.name, abs = path.join(dir, e.name);
          if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, r); continue; }
          if (!e.isFile() || SKIP_FILES.test(e.name) || (root.exclude && root.exclude(r))) continue;
          const st = fs.statSync(abs); if (st.size > this.maxFile) { skipped.push({ path: `${root.ns}/${r}`, size: st.size }); continue; }
          if (root.sqlite && /\.db$/.test(e.name)) {   // a live database: fingerprint of the file and its journal; only a changed one is snapshotted (VACUUM INTO is not byte-for-byte repeatable)
            const wal = (() => { try { const w = fs.statSync(abs + "-wal"); return `${w.size}:${w.mtimeMs}`; } catch { return "-"; } })(), fp = `${st.size}:${st.mtimeMs}:${wal}`, c = this.state.files[`${root.ns}/${r}`];
            out.set(`${root.ns}/${r}`, { src: abs, db: true, fp, size: c?.fp === fp ? c.size : st.size, mtimeMs: st.mtimeMs, sha: c?.fp === fp ? c.sha : undefined }); continue;
          }
          out.set(`${root.ns}/${r}`, { abs, size: st.size, mtimeMs: st.mtimeMs });
        }
      };
      walk(root.dir, "");
    }
    if (hash) for (const [k, e] of out) {
      if (e.db) { if (!e.sha) { this.snapshot(k, e); e.sha = await hashFile(e.abs); } continue; }
      const c = this.state.files[k]; e.sha = c && c.size === e.size && c.mtimeMs === e.mtimeMs ? c.sha : await hashFile(e.abs);
    }
    for (const [k, e] of out) e.k = k;
    this.skipped = skipped; return out;
  }
  /** Replaces a live database entry by a consistent snapshot in a temporary folder. */
  snapshot(k, e) {   // k = logical path
    this.tmp ||= fs.mkdtempSync(path.join(os.tmpdir(), "collado-sync-")); const dest = path.join(this.tmp, ...k.split("/")); snapshotDb(e.src, dest); e.abs = dest; e.size = fs.statSync(dest).size; return dest;
  }
  /** How the workspace differs from what was last synced: { added, changed, removed } (counts and paths). */
  async localChanges() {
    const cur = await this.scan({ hash: false }), prev = this.state.files, added = [], changed = [], removed = [];
    for (const [k, e] of cur) {
      if (!prev[k]) { added.push(k); continue; }
      if (e.db) { if (prev[k].fp !== e.fp) changed.push(k); continue; }
      const sha = prev[k].size === e.size && prev[k].mtimeMs === e.mtimeMs ? prev[k].sha : await hashFile(e.abs); if (prev[k].sha !== sha) changed.push(k);
    }
    for (const k of Object.keys(prev)) if (!cur.has(k)) removed.push(k);
    this.cleanup(); return { added, changed, removed, dirty: added.length + changed.length + removed.length > 0 };
  }

  // ---- manifest and lease --------------------------------------------------------------------------------------------------------------------------------
  async readManifest() { const b = await this.provider.read("manifest.bin"); if (!b) return null; try { return JSON.parse(open(this.keys.enc, b).toString("utf8")); } catch (e) { throw new SyncError(e.message === "bad_key" ? "bad_passphrase" : "remote_corrupt"); } }
  async #writeManifest(m) { await this.provider.write("manifest.bin", seal(this.keys.enc, Buffer.from(JSON.stringify(m)))); }
  #leaseOf(m) { return m?.lease && m.lease.device !== this.device.id && m.lease.until > this.now() ? m.lease : null; }
  /** What the cloud has, for the UI and the start-up decision. */
  async checkRemote() {
    const m = await this.readManifest(); if (!m) return { exists: false, generation: 0, newer: false };
    const other = this.#leaseOf(m);
    return { exists: true, generation: m.generation, newer: m.generation > this.state.baseGeneration, savedAt: m.savedAt, device: m.device, lease: other ? { name: other.name, until: other.until } : null };
  }
  /** Takes the lease for this computer for 20 minutes; throws lease_held when another computer has it (unless forced). */
  async acquireLease({ force = false } = {}) {
    const m = (await this.readManifest()) || { v: 1, generation: 0, files: {} }, other = this.#leaseOf(m);
    if (other && !force) throw new SyncError("lease_held", { by: other.name, until: other.until });
    m.lease = { device: this.device.id, name: this.device.name, until: this.now() + LEASE_MS }; await this.#writeManifest(m); return m;
  }
  /** Extends this computer's lease. */
  async renewLease() { return this.acquireLease(); }
  /** Gives the lease up (end of session). */
  async releaseLease() { const m = await this.readManifest(); if (m?.lease?.device === this.device.id) { delete m.lease; await this.#writeManifest(m); } }

  // ---- push: this computer -> cloud ---------------------------------------------------------------------------------------------------------------------
  async push({ force = false, gc = true } = {}) {
    const m = await this.acquireLease({ force });
    if (m.generation > this.state.baseGeneration && !force) throw new SyncError("remote_newer", { generation: m.generation });
    try {
      this.onProgress({ phase: "scan" });
      const entries = await this.scan(), remote = await this.provider.list(), have = new Set(remote.keys());
      for (const e of entries.values()) if (e.db && !e.abs && !have.has(objectName(this.keys.name, e.sha))) { this.snapshot(e.k, e); e.sha = await hashFile(e.abs); }   // unchanged since the last sync but the cloud lost the object: snapshot again
      const todo = new Map(); for (const [k, e] of entries) { const name = objectName(this.keys.name, e.sha); if (!have.has(name) && !todo.has(name)) todo.set(name, e); }
      const items = [...todo.entries()]; let done = 0, bytes = 0;
      await pool(items, this.concurrency, async ([name, e]) => {
        const blob = seal(this.keys.enc, await fsp.readFile(e.abs)); await this.provider.write(name, blob); bytes += blob.length; this.onProgress({ phase: "upload", done: ++done, total: items.length, bytes });
      });
      const files = {}; for (const [k, e] of entries) files[k] = { size: e.size, mtimeMs: e.mtimeMs, sha: e.sha };
      const same = Object.keys(files).length === Object.keys(m.files || {}).length && Object.keys(files).every((k) => m.files?.[k]?.sha === files[k].sha);
      const next = { v: 1, generation: m.generation + (same && !force ? 0 : 1), device: this.device, savedAt: this.now(), files, lease: { device: this.device.id, name: this.device.name, until: this.now() + LEASE_MS } };
      await this.#writeManifest(next);
      let removed = 0;
      if (gc) { const live = new Set(Object.values(files).map((f) => objectName(this.keys.name, f.sha))); for (const name of have) if (name.startsWith("o-") && !live.has(name)) { await this.provider.remove(name); removed++; } }
      for (const [k, e] of entries) this.state.files[k] = e.db ? { size: e.size, mtimeMs: 0, sha: e.sha, fp: e.fp } : { size: e.size, mtimeMs: e.mtimeMs, sha: e.sha };
      for (const k of Object.keys(this.state.files)) if (!(k in files)) delete this.state.files[k];
      this.state.baseGeneration = next.generation; this.state.lastSyncAt = this.now(); this.#save();
      return { generation: next.generation, uploaded: items.length, bytes, files: Object.keys(files).length, removed, skipped: this.skipped };
    } finally { this.cleanup(); }
  }

  // ---- pull: cloud -> this computer ---------------------------------------------------------------------------------------------------------------------
  /** Brings the workspace to what the cloud has. Everything is downloaded and verified into a staging folder first; only then files are swapped in (the replaced ones go to the backup folder). */
  async pull() {
    const m = await this.readManifest(); if (!m) return { empty: true };
    if (m.generation === this.state.baseGeneration && Object.keys(this.state.files).length) return { upToDate: true, generation: m.generation };
    const local = await this.scan(); const staging = path.join(path.dirname(this.statePath), "sync-staging"); await fsp.rm(staging, { recursive: true, force: true }); await fsp.mkdir(staging, { recursive: true });
    try {
      const need = Object.entries(m.files).filter(([k, f]) => local.get(k)?.sha !== f.sha); let done = 0, bytes = 0;
      await pool(need, this.concurrency, async ([k, f], idx) => {
        const blob = await this.provider.read(objectName(this.keys.name, f.sha)); if (!blob) throw new SyncError("object_missing", { path: k });
        const plain = open(this.keys.enc, blob); if (crypto.createHash("sha256").update(plain).digest("hex") !== f.sha) throw new SyncError("object_corrupt", { path: k });
        this.abs(k); await fsp.writeFile(path.join(staging, String(idx)), plain); bytes += plain.length; this.onProgress({ phase: "download", done: ++done, total: need.length, bytes });
      });
      const backup = path.join(this.backupsDir, new Date(this.now()).toISOString().replace(/[:.]/g, "-")); let backedUp = 0;
      const toBackup = async (logical, abs) => { await mv(abs, path.join(backup, ...logical.split("/"))); backedUp++; };
      const files = {};
      for (const [i, [k, f]] of need.entries()) {
        const target = this.abs(k); if (fs.existsSync(target)) await toBackup(k, target);
        if (/\.db$/.test(target)) for (const suf of ["-wal", "-shm"]) if (fs.existsSync(target + suf)) await toBackup(k + suf, target + suf);   // a stale journal must never be replayed onto a different database
        await mv(path.join(staging, String(i)), target); const st = fs.statSync(target); try { fs.utimesSync(target, new Date(), new Date(f.mtimeMs)); } catch { /* best effort */ }
      }
      for (const [k, f] of Object.entries(m.files)) { const target = this.abs(k); let st; try { st = fs.statSync(target); } catch { continue; } files[k] = { size: st.size, mtimeMs: st.mtimeMs, sha: f.sha }; }
      for (const k of Object.keys(this.state.files)) if (!(k in m.files)) { const target = this.abs(k); if (fs.existsSync(target)) await toBackup(k, target); }   // deleted on the other computer
      this.state.files = files; this.state.baseGeneration = m.generation; this.state.lastSyncAt = this.now(); this.#save();
      await this.#prune();
      return { generation: m.generation, downloaded: need.length, bytes, backedUp, backup: backedUp ? backup : null };
    } finally { await fsp.rm(staging, { recursive: true, force: true }); this.cleanup(); }
  }
  async #prune() { try { const dirs = fs.readdirSync(this.backupsDir).sort(); for (const d of dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS))) fs.rmSync(path.join(this.backupsDir, d), { recursive: true, force: true }); } catch { /* no backups yet */ } }
  /** Forget the local sync state (disconnect). The cloud copy is left as it is. */
  forget() { this.state = { baseGeneration: 0, files: {}, lastSyncAt: 0 }; try { fs.rmSync(this.statePath, { force: true }); } catch { /* none */ } }
}
