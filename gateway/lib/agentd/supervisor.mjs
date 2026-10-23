// Supervisor of the editable app: runs it as the `app` user, restarts it when its files change or it crashes, keeps its log, takes git snapshots when it is healthy,
// offers rollback / reset to the image seed. The app's code and data are owned by `app`; only people with service.manage can write the code (group collado-dev).
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { EventEmitter } from "node:events";
import { UID_APP, GID_DEV } from "./users.mjs";
import { NODE_ENV, baseEnv } from "./platform.mjs";

const GIT_ENV = { GIT_AUTHOR_NAME: "collado", GIT_AUTHOR_EMAIL: "collado@localhost", GIT_COMMITTER_NAME: "collado", GIT_COMMITTER_EMAIL: "collado@localhost", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };

/** Runs the app as a child process (the pod), or as a worker thread of the hub (desktop): starts it, probes /healthz, restarts it with back-off when it crashes or its files change, keeps a log, takes git snapshots while healthy and offers rollback/reset. */
export class Supervisor {
  constructor({ root, dirs, appPort, nodeBin = process.execPath, env = {}, log = () => {}, keys, ctlUrl, managed = true, inProcess = false }) {
    // managed = false (desktop): the app is the read-only copy bundled with the program: no git snapshots, no file watching, no rollback
    Object.assign(this, { root, dirs, appPort, nodeBin, baseEnv: env, log, keys, ctlUrl, managed, inProcess: inProcess && !root });   // inProcess (desktop): the app runs in a worker thread of this process instead of its own process (saves a whole Node runtime, ~60 MB)
    this.lines = []; this.s = { child: null, state: "stopped", pid: null, started: 0, restarts: 0, lastExit: null, healthy: false, want: true, timer: null, backoff: 1000, lastSnapshot: null };
    this.tick = 0; setInterval(() => { if (!this.s.healthy || ++this.tick % 5 === 0) this.probe(); }, 2000).unref();   // every 2 s while starting or unhealthy, every 10 s once healthy
  }
  /** Appends lines of a source (sup, out, err) to the bounded in-memory log. */
  push(src, chunk) { for (const l of String(chunk).split("\n")) if (l.trim()) { this.lines.push(`${new Date().toISOString().slice(11, 19)} ${src} ${l}`); if (this.lines.length > 1500) this.lines.shift(); } }
  /** run a command as the app user (or as ourselves without root) */
  #cmd(argv) { return this.root ? ["setpriv", [`--reuid=${UID_APP}`, `--regid=${UID_APP}`, `--groups=${UID_APP},${GID_DEV}`, "--no-new-privs", ...argv]] : [argv[0], argv.slice(1)]; }
  /** Runs a command as the app user (or as ourselves without root). */
  sh(argv, opts = {}) { const [c, a] = this.#cmd(argv); return spawnSync(c, a, { encoding: "utf8", env: { ...process.env, ...GIT_ENV, HOME: this.dirs.appdata }, ...opts }); }
  /** Runs git inside the app directory. */
  git(...args) { return this.sh(["git", ...args], { cwd: this.dirs.app }); }

  /** Creates the data and app directories with the right owners and modes. */
  prepareDirs() {
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    if (!this.root) return;
    const own = (p, uid, gid, mode) => { try { fs.chownSync(p, uid, gid); fs.chmodSync(p, mode); } catch { /* best effort */ } };
    const chownTree = (p, uid, gid) => { try { fs.chownSync(p, uid, gid); if (fs.lstatSync(p).isDirectory()) for (const f of fs.readdirSync(p)) if (f !== ".git" || true) chownTree(path.join(p, f), uid, gid); } catch { /* ignore */ } };
    chownTree(this.dirs.appdata, UID_APP, UID_APP); own(this.dirs.appdata, UID_APP, UID_APP, 0o700);
    chownTree(this.dirs.app, UID_APP, GID_DEV);
    const setgid = (p) => { try { fs.chmodSync(p, 0o2770); for (const f of fs.readdirSync(p)) { const q = path.join(p, f); if (f === "node_modules") continue; const st = fs.lstatSync(q); if (st.isDirectory()) setgid(q); else fs.chmodSync(q, 0o660 | (st.mode & 0o100 ? 0o110 : 0)); } } catch { /* ignore */ } };
    setgid(this.dirs.app);
  }
  /** Starts the app (child process or worker thread) and arranges the restart-on-exit policy. */
  start() {
    const s = this.s; if (s.child || !s.want) return;
    if (!fs.existsSync(path.join(this.dirs.app, "server.mjs"))) { s.state = "missing"; this.push("sup", "app/server.mjs does not exist"); return; }
    s.state = "starting"; s.healthy = false; s.started = Date.now();
    const env = { PATH: process.env.PATH, HOME: this.dirs.appdata, LANG: "C.UTF-8", NODE_ENV: "production", PORT: String(this.appPort), HOST: "127.0.0.1", DATA_DIR: this.dirs.appdata, WORKSPACE_DIR: this.dirs.shared,
      APP_KEY: this.keys?.app || "", COLLADO_TOKEN_KEY: this.keys?.token || "", AGENTD_URL: this.ctlUrl, ...this.baseEnv };
    const flags = this.baseEnv.APP_FLAGS || "--max-old-space-size=320";
    let child;
    if (this.inProcess) {
      const w = new Worker(path.join(this.dirs.app, "server.mjs"), { env: { ...baseEnv(), ...NODE_ENV, ...env }, resourceLimits: { maxOldGenerationSizeMb: 320 }, stdout: true, stderr: true });
      child = Object.assign(new EventEmitter(), { stdout: w.stdout, stderr: w.stderr, pid: w.threadId, kill: (sig) => { if (sig === "SIGKILL") w.terminate(); else { w.postMessage("shutdown"); setTimeout(() => w.terminate(), 2500).unref(); } } });   // same surface as a ChildProcess
      w.on("exit", (code) => child.emit("exit", code, null)); w.on("error", (e) => this.push("err", `worker error: ${e.stack || e.message}`));
    } else if (this.root) { const [c, a] = this.#cmd(["env", "-i", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), this.nodeBin, flags, "server.mjs"]); child = spawn(c, a, { cwd: this.dirs.app, stdio: ["ignore", "pipe", "pipe"] }); }
    else child = spawn(this.nodeBin, [flags, "server.mjs"], { cwd: this.dirs.app, stdio: ["ignore", "pipe", "pipe"], env: { ...baseEnv(), ...NODE_ENV, ...env } });   // same as `env -i`, but portable (Windows has no `env`)
    child.on("error", (e) => this.push("sup", `spawn error: ${e.message}`));
    s.child = child; s.pid = child.pid; this.push("sup", `start pid ${child.pid}`);
    child.stdout.on("data", (d) => this.push("out", d)); child.stderr.on("data", (d) => this.push("err", d));
    child.on("exit", (code, sig) => {
      this.push("sup", `exit code=${code} signal=${sig}`); s.child = null; s.pid = null; s.healthy = false; s.lastExit = { code, sig, at: Date.now() };
      if (!s.want) { s.state = "stopped"; return; }
      s.state = "crashed"; s.restarts++; s.backoff = Date.now() - s.started > 30000 ? 1000 : Math.min(s.backoff * 2, 30000); clearTimeout(s.timer); s.timer = setTimeout(() => this.start(), s.backoff);
    });
  }
  /** Stops the app, forcing it after a grace period. */
  async stop() { const s = this.s; if (!s.child) return; const c = s.child; s.want = false; await new Promise((res) => { const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* gone */ } }, 4000); c.once("exit", () => { clearTimeout(t); res(); }); try { c.kill("SIGTERM"); } catch { res(); } }); }
  /** Stops and starts the app again. */
  async restart(reason) { this.push("sup", `restart (${reason})`); clearTimeout(this.s.timer); await this.stop(); this.s.want = true; this.s.backoff = 1000; this.start(); }
  /** Checks /healthz and updates the state (starting, running, unhealthy). */
  async probe() {
    const s = this.s; if (!s.child) return;
    try { const r = await fetch(`http://127.0.0.1:${this.appPort}/healthz`, { signal: AbortSignal.timeout(2000) }); const was = s.healthy; s.healthy = r.ok; if (r.ok) s.state = "running"; if (r.ok && !was) this.snapshot("healthy start"); }
    catch { s.healthy = false; if (s.state === "running") s.state = "unhealthy"; }
  }
  /** Commits the app directory to git when it changed (managed installs only). */
  snapshot(msg) {
    if (!this.managed) return;
    this.git("add", "-A"); if (this.git("diff", "--cached", "--quiet").status === 0) return;
    if (this.git("commit", "-q", "-m", `snapshot: ${msg}`).status === 0) { this.s.lastSnapshot = Date.now(); this.push("sup", `git snapshot (${msg})`); }
  }
  /** Restarts the app when its source files change. */
  watch() {
    let t; try { fs.watch(this.dirs.app, { recursive: true }, (_e, file) => { if (!file || /(^|\/)(node_modules|\.git)(\/|$)/.test(file) || /\.(log|db|db-wal|db-shm|tmp)$/.test(file)) return; clearTimeout(t); t = setTimeout(() => this.restart(`file changed: ${file}`), 900); }); } catch (e) { this.log("fs.watch failed:", e.message); }
  }
  /** Returns the app to its last snapshot and restarts it. */
  async rollback() { if (!this.managed) return this.restart("rollback requested (nothing to roll back in the desktop build)"); await this.stop(); this.git("reset", "-q", "--hard", "HEAD"); this.git("clean", "-fdq"); this.push("sup", "rollback to the last healthy snapshot"); this.s.want = true; this.s.backoff = 1000; this.start(); }
  /** State, health, pid, restarts, uptime and last exit, for the service view. */
  status() { const s = this.s; return { state: s.state, healthy: s.healthy, pid: s.pid, restarts: s.restarts, uptime_s: s.child ? Math.round((Date.now() - s.started) / 1000) : 0, last_exit: s.lastExit, last_snapshot: s.lastSnapshot, port: this.appPort }; }
}
