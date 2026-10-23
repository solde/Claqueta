// Persistent consoles WITHOUT tmux (it does not exist on Windows): the Claude and shell sessions of each person are node-pty processes owned by agentd, with a scrollback
// buffer that is replayed to every new WebSocket. Closing the window (or reloading the page) only detaches a viewer; the process keeps running until it exits or goes idle.
// Same interface as Consoles (tmux): hasSession / active / attach / send / reap / killAll.
import fs from "node:fs";
import path from "node:path";
import pty from "@lydell/node-pty";
import { IS_WIN, which } from "./platform.mjs";

const SCROLLBACK = 400_000;   // bytes kept per session (xterm.js re-renders them on attach)
const NOT_INSTALLED = `Claude Code no está instalado en este equipo. Instálalo una vez (${IS_WIN ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash"}) y vuelve a abrir la consola. Hace falta internet solo para instalarlo y para conversar con Claude; el resto de Collado funciona sin conexión.`;

/** Consoles without tmux (desktop, Windows included): each session is a node-pty process owned by agentd with a scrollback buffer replayed to every new viewer; closing the window only detaches a viewer. Same interface as Consoles. */
export class PtyConsoles {
  constructor({ users, agentCmd = "claude", shellCmd = "", maxUsers = 6, idleHours = 12, log = () => {} }) {
    Object.assign(this, { users, agentCmd, shellCmd, maxUsers, idleMs: idleHours * 3600e3, log }); this.sessions = new Map(); this.seen = new Map();
  }
  /** Session key `<user>/<name>`. */
  key(u, name) { return `${u.name}/${name}`; }
  /** Whether the session's process is alive. */
  hasSession(u, name) { const s = this.sessions.get(this.key(u, name)); return !!s && s.alive; }
  /** Users with a live session. */
  active() { return this.users.list().filter((u) => ["claude", "shell"].some((n) => this.hasSession(u, n))); }
  #resolve(u, cmd) { return which(cmd, this.users.env(u).PATH.split(path.delimiter)); }
  #shell(u) {
    if (this.shellCmd) return { file: this.shellCmd, args: [] };
    if (IS_WIN) return { file: this.#resolve(u, "powershell") || process.env.ComSpec || "cmd.exe", args: [] };
    const sh = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].find((x) => x && fs.existsSync(x)); return { file: sh, args: /(zsh|bash)$/.test(sh) ? ["-l"] : [] };
  }
  #spawn(u, name, cols, rows, args) {
    const spec = name === "shell" ? this.#shell(u) : { file: this.#resolve(u, this.agentCmd), args };
    if (!spec.file) return null;
    return pty.spawn(spec.file, spec.args, { name: "xterm-256color", cwd: path.join(this.users.homeOf(u.name), "work"), env: this.users.env(u), cols, rows, ...(IS_WIN ? { useConpty: true } : {}) });
  }
  /** Starts the session if it is not alive (Claude resumes with --continue, falling back to a new conversation), refused beyond the user cap; returns the session. */
  ensure(u, name, cols = 120, rows = 32) {
    let s = this.sessions.get(this.key(u, name));
    if (s?.alive) return s;
    if (name === "claude" && !this.#resolve(u, this.agentCmd)) throw new Error(NOT_INSTALLED);
    if (!this.active().some((x) => x.name === u.name) && this.active().length >= this.maxUsers) throw new Error("max_console_users");
    const old = s; s = { alive: false, proc: null, buf: Buffer.alloc(0), views: new Set(), lastOut: Date.now() };
    this.sessions.set(this.key(u, name), s); if (old) old.views.forEach((v) => s.views.add(v));
    const emit = (d) => { const b = Buffer.from(d, "utf8"); s.buf = s.buf.length + b.length > SCROLLBACK ? Buffer.concat([s.buf, b]).subarray(-SCROLLBACK) : Buffer.concat([s.buf, b]); s.lastOut = Date.now(); for (const v of s.views) v.data(d); };
    const launch = (args) => {
      let p; try { p = this.#spawn(u, name, cols, rows, args); } catch (e) { emit(`\r\n\x1b[31mNo se pudo iniciar la consola: ${e.message}\x1b[0m\r\n`); p = null; }
      if (!p) { s.alive = false; return false; }
      s.proc = p; s.alive = true; const t0 = Date.now();
      p.onData(emit);
      p.onExit(({ exitCode }) => {
        // `claude --continue` fails right away when there is no earlier conversation: start a fresh one instead
        if (name === "claude" && args.includes("--continue") && Date.now() - t0 < 10_000 && exitCode !== 0 && s.proc === p) { launch([]); return; }
        if (s.proc === p) { s.alive = false; emit(`\r\n\x1b[2m[la consola ha terminado${exitCode ? ` (código ${exitCode})` : ""}]\x1b[0m\r\n`); for (const v of s.views) v.exit(); s.views.clear(); }
      });
      return true;
    };
    launch(name === "claude" ? ["--continue"] : []);
    this.log(`console ${u.name}/${name} ${s.alive ? "started" : "unavailable"}`);
    return s;
  }
  /** A viewer on the session, shaped like a node-pty process so agentd's WebSocket code is the same for both backends. */
  attach(u, name, cols, rows) {
    const s = this.ensure(u, name, cols, rows); this.seen.set(u.name, Date.now());
    const dataCbs = [], exitCbs = []; const view = { data: (d) => dataCbs.forEach((f) => f(d)), exit: () => exitCbs.forEach((f) => f()) };
    queueMicrotask(() => { if (s.buf.length) view.data(s.buf.toString("utf8")); if (!s.alive) view.exit(); });   // replay what was on screen; a session that could not start only shows its message
    s.views.add(view); try { s.proc?.resize(cols, rows); } catch { /* resize races with exit */ }
    return {
      onData: (f) => { dataCbs.push(f); }, onExit: (f) => { exitCbs.push(f); },
      write: (d) => { try { if (s.alive) s.proc.write(d); } catch { /* exited */ } },
      resize: (c, r) => { try { if (s.alive) s.proc.resize(c, r); } catch { /* exited */ } },
      kill: () => { s.views.delete(view); this.seen.set(u.name, Date.now()); },
    };
  }
  /** Types a message into the person's Claude console (bracketed paste, then Enter). */
  send(u, text) {
    const s = this.ensure(u, "claude"); if (!s.alive) throw new Error("claude_unavailable");
    s.proc.write(`\x1b[200~${text}\x1b[201~`); setTimeout(() => { try { if (s.alive) s.proc.write("\r"); } catch { /* exited */ } }, 250);
  }
  /** Claude Code with nobody looking at it for a while is stopped to give its memory back; the conversation resumes with --continue the next time. */
  reap() {
    for (const [k, s] of this.sessions) if (s.alive && !s.views.size && k.endsWith("/claude") && Date.now() - Math.max(s.lastOut, this.seen.get(k.split("/")[0]) || 0) > this.idleMs) { try { s.proc.kill(); } catch { /* gone */ } this.log(`console ${k} reaped after inactivity`); }
  }
  /** Ends a session (and forgets its screen) so the next attach starts a fresh one. */
  reset(u, name) { const k = this.key(u, name), s = this.sessions.get(k); if (!s) return; s.alive = false; try { s.proc?.kill(); } catch { /* gone */ } for (const v of s.views) { try { v.exit(); } catch { /* closed */ } } this.sessions.delete(k); }
  /** Ends every session (shutdown). */
  killAll() { for (const s of this.sessions.values()) { s.alive = false; try { s.proc?.kill(); } catch { /* gone */ } } this.sessions.clear(); }
}
