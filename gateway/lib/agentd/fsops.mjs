#!/usr/bin/env node
// File operations on one person's home, executed AS that person (setpriv in the pod): it can only do what their uid can do, so a symlink or a ".." cannot reach anything else.
// Usage: node fsops.mjs <op> <home> [args...]   Results are JSON on stdout ({error} + exit code 1 on failure); read/zip stream bytes, write reads stdin.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const [, , op, HOME, ...args] = process.argv;
const out = (v) => { process.stdout.write(JSON.stringify(v) + "\n"); };
const die = (code, extra = {}) => { process.stdout.write(JSON.stringify({ error: code, ...extra }) + "\n"); process.exit(1); };
const TRASH = ".Trash", ORIGINS = path.join(TRASH, ".origins.json");

/** rel (posix, relative to HOME, "" = HOME) -> absolute path inside HOME, or die. */
function abs(rel) {
  rel = String(rel ?? "").replace(/^\/+/, ""); if (rel.includes("\0")) die("invalid_path");
  const full = path.resolve(HOME, rel); if (full !== HOME && !full.startsWith(HOME + path.sep)) die("outside_home");
  return full;
}
const relOf = (full) => path.relative(HOME, full).split(path.sep).join("/");
const KIND = (st, lst) => (lst.isSymbolicLink() ? (st?.isDirectory() ? "dir" : "file") : lst.isDirectory() ? "dir" : lst.isFile() ? "file" : "other");
function entry(dir, name) {
  const p = path.join(dir, name); let lst; try { lst = fs.lstatSync(p); } catch { return null; }
  let st = lst; if (lst.isSymbolicLink()) { try { st = fs.statSync(p); } catch { st = null; } }
  return { name, type: KIND(st, lst), size: st?.isFile() ? st.size : 0, mtime: (st || lst).mtimeMs, mode: (lst.mode & 0o777).toString(8), link: lst.isSymbolicLink() ? 1 : 0, ...(st === null ? { broken: 1 } : {}) };
}
function uniqueIn(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length); for (let i = 2; i < 1000; i++) { const n = `${base} ${i}${ext}`; if (!fs.existsSync(path.join(dir, n))) return n; }
  die("exists");
}
function size(p, budget = { n: 200000 }) {
  let total = 0; const lst = fs.lstatSync(p); if (!lst.isDirectory()) return lst.size;
  for (const f of fs.readdirSync(p)) { if (budget.n-- <= 0) break; try { total += size(path.join(p, f), budget); } catch { /* unreadable */ } } return total;
}
/** rename that also works across volumes (EXDEV): the trash is in the home, a project folder can be on another disk. */
function mv(from, to) { try { fs.renameSync(from, to); } catch (e) { if (e.code !== "EXDEV") throw e; fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true }); fs.rmSync(from, { recursive: true, force: true }); } }
const notInside = (from, to) => { if (to === from || to.startsWith(from + path.sep)) die("into_itself"); };
const readOrigins = () => { try { return JSON.parse(fs.readFileSync(abs(ORIGINS), "utf8")); } catch { return {}; } };
const writeOrigins = (o) => { fs.mkdirSync(abs(TRASH), { recursive: true }); fs.writeFileSync(abs(ORIGINS), JSON.stringify(o)); };

try {
  switch (op) {
    case "list": { const dir = abs(args[0]); if (!fs.statSync(dir).isDirectory()) die("not_a_directory"); const entries = fs.readdirSync(dir).map((n) => entry(dir, n)).filter(Boolean); out({ path: relOf(dir), entries }); break; }
    case "stat": { const p = abs(args[0]); const e = entry(path.dirname(p), path.basename(p)); if (!e) die("not_found"); out({ ...e, path: relOf(p), deep: e.type === "dir" ? size(p) : e.size }); break; }
    case "mkdir": { const p = abs(args[0]); if (fs.existsSync(p)) die("exists"); fs.mkdirSync(p, { recursive: true, mode: 0o755 }); out({ ok: true }); break; }
    case "touch": { const p = abs(args[0]); if (fs.existsSync(p)) die("exists"); fs.writeFileSync(p, "", { mode: 0o644, flag: "wx" }); out({ ok: true }); break; }
    case "rename": { const a = abs(args[0]), b = abs(args[1]); if (a === HOME) die("forbidden"); if (!fs.existsSync(a)) die("not_found"); notInside(a, b); fs.mkdirSync(path.dirname(b), { recursive: true }); if (fs.existsSync(b) && !args.includes("--overwrite")) die("exists"); mv(a, b); out({ ok: true, to: relOf(b) }); break; }
    case "copy": { const a = abs(args[0]); let b = abs(args[1]); if (!fs.existsSync(a)) die("not_found"); if (b.startsWith(a + path.sep)) die("into_itself"); fs.mkdirSync(path.dirname(b), { recursive: true }); if (fs.existsSync(b)) b = path.join(path.dirname(b), uniqueIn(path.dirname(b), path.basename(b))); fs.cpSync(a, b, { recursive: true, errorOnExist: true, force: false }); out({ ok: true, to: relOf(b) }); break; }
    case "trash": {
      const o = readOrigins(); fs.mkdirSync(abs(TRASH), { recursive: true }); const moved = [];
      for (const rel of args) { const p = abs(rel); if (p === HOME || p === abs(TRASH)) die("forbidden"); if (!fs.existsSync(p) && !fs.lstatSync(p, { throwIfNoEntry: false })) continue; if (p.startsWith(abs(TRASH) + path.sep)) die("already_in_trash");
        const name = uniqueIn(abs(TRASH), path.basename(p)); mv(p, path.join(abs(TRASH), name)); o[name] = relOf(p); moved.push(name); }
      writeOrigins(o); out({ ok: true, moved }); break;
    }
    case "restore": { const o = readOrigins(); const done = []; for (const name of args) { const from = path.join(abs(TRASH), name); if (!fs.existsSync(from)) continue; let to = abs(o[name] || name); fs.mkdirSync(path.dirname(to), { recursive: true }); if (fs.existsSync(to)) to = path.join(path.dirname(to), uniqueIn(path.dirname(to), path.basename(to))); mv(from, to); delete o[name]; done.push(relOf(to)); } writeOrigins(o); out({ ok: true, restored: done }); break; }
    case "rm": { const t = abs(TRASH); for (const rel of args) { const p = abs(rel); if (!p.startsWith(t + path.sep)) die("only_in_trash"); fs.rmSync(p, { recursive: true, force: true }); const o = readOrigins(); delete o[path.basename(p)]; writeOrigins(o); } out({ ok: true }); break; }
    case "emptytrash": { const t = abs(TRASH); if (fs.existsSync(t)) for (const f of fs.readdirSync(t)) fs.rmSync(path.join(t, f), { recursive: true, force: true }); out({ ok: true }); break; }
    case "find": { const base = abs(args[0]), q = String(args[1] || "").toLowerCase(); const hits = []; const SKIP = new Set(["node_modules", ".git", ".npm-cache", ".npm-global", ".cache"]);
      (function walk(d, depth) { if (hits.length >= 300 || depth > 8) return; let names; try { names = fs.readdirSync(d); } catch { return; } for (const n of names) { if (hits.length >= 300) return; const p = path.join(d, n); if (n.toLowerCase().includes(q)) { const e = entry(d, n); if (e) hits.push({ ...e, path: relOf(p) }); } if (!SKIP.has(n)) { let l; try { l = fs.lstatSync(p); } catch { continue; } if (l.isDirectory()) walk(p, depth + 1); } } })(base, 0);
      out({ entries: hits }); break; }
    case "read": { const p = abs(args[0]); const st = fs.statSync(p); if (!st.isFile()) die("not_a_file"); const max = Number(args[1]) || Infinity; if (st.size > max) die("too_large", { size: st.size });
      await pipeline(fs.createReadStream(p), process.stdout); break; }
    case "write": { const p = abs(args[0]); if (args.includes("--mkdirs")) fs.mkdirSync(path.dirname(p), { recursive: true }); if (fs.existsSync(p) && !args.includes("--overwrite")) die("exists"); if (!fs.existsSync(path.dirname(p))) die("no_directory");
      const tmp = path.join(path.dirname(p), `.upload-${process.pid}-${path.basename(p)}`); try { await pipeline(process.stdin, fs.createWriteStream(tmp, { mode: 0o644 })); fs.renameSync(tmp, p); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; } out({ ok: true, size: fs.statSync(p).size, path: relOf(p) }); break; }
    case "zip": {
      const rels = args.map((r) => relOf(abs(r)) || ".");
      if (spawnSync("zip", ["-v"], { stdio: "ignore" }).error) {   // no `zip` binary (Windows, minimal systems): pure-JS writer, in memory, symlinks are skipped
        const { zip } = await import("../../../app-seed/app/lib/docs/zip.mjs"); const entries = []; let total = 0; const LIMIT = 512 * 1048576;
        const add = (full, name) => { const l = fs.lstatSync(full); if (l.isSymbolicLink()) return;
          if (l.isDirectory()) { entries.push({ name: name + "/", data: Buffer.alloc(0), store: true }); for (const f of fs.readdirSync(full)) add(path.join(full, f), `${name}/${f}`); }
          else if (l.isFile()) { total += l.size; if (total > LIMIT) die("too_large", { max_mb: 512 }); entries.push({ name, data: fs.readFileSync(full) }); } };
        for (const r of rels) { const full = r === "." ? HOME : abs(r); if (r === ".") for (const f of fs.readdirSync(full)) add(path.join(full, f), f); else add(full, r); }
        process.stdout.write(zip(entries)); break;
      }
      const z = spawn("zip", ["-r", "-q", "-y", "-", ...rels], { cwd: HOME, stdio: ["ignore", "pipe", "inherit"] }); await pipeline(z.stdout, process.stdout); break;
    }
    default: die("unknown_op");
  }
} catch (e) { if (e.code === "ENOENT") die("not_found"); if (e.code === "EACCES" || e.code === "EPERM") die("forbidden"); if (e.code === "EEXIST") die("exists"); if (e.code === "ENOTEMPTY") die("not_empty"); die("failed", { detail: String(e.message).slice(0, 200) }); }
