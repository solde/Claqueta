// Persistent consoles: one tmux server per user (socket `collado-<user>`), sessions `claude` and `shell`. A WebSocket only attaches a client (node-pty), so the console
// survives reloads and network drops. Idle servers are reaped, and the number of simultaneous users is capped (each Claude Code process uses several hundred MB).
import path from "node:path";
import pty from "@lydell/node-pty";

/** tmux-backed consoles (pod): one tmux server per user with a `claude` and a `shell` session that survive reloads and disconnects; idle servers are reaped and the number of simultaneous users is capped. */
export class Consoles {
  constructor({ users, tmuxBin, tmuxConf, agentCmd, shellCmd, maxUsers = 6, idleHours = 12, log = () => {} }) { Object.assign(this, { users, tmuxBin, tmuxConf, agentCmd, shellCmd, maxUsers, idleMs: idleHours * 3600e3, log }); this.attached = new Map(); this.seen = new Map(); }
  /** Name of the user's tmux socket. */
  sock(u) { return `collado-${u.name}`; }
  #tmuxArgv(u, ...args) { return [this.tmuxBin, "-f", this.tmuxConf, "-L", this.sock(u), ...args]; }
  /** Runs a tmux command against the user's server (as that user). */
  tmux(u, ...args) { return this.users.run(u, this.#tmuxArgv(u, ...args)); }
  /** Whether the user's tmux server has a session of that name. */
  hasSession(u, name) { return this.tmux(u, "has-session", "-t", name).status === 0; }
  /** Users that currently have a tmux server. */
  active() { return this.users.list().filter((u) => this.tmux(u, "list-sessions").status === 0); }
  #cmd(u, name) {
    const base = name === "shell" ? this.shellCmd : this.agentCmd; const home = this.users.homeOf(u.name);
    return `umask ${u.dev ? "002" : "077"}; cd ${JSON.stringify(path.join(home, "work"))} 2>/dev/null; ${base}`;
  }
  /** Starts the session if it does not exist (refused when the user cap is reached). */
  ensure(u, name) {
    if (this.hasSession(u, name)) return;
    if (this.tmux(u, "list-sessions").status !== 0 && this.active().length >= this.maxUsers) throw new Error("max_console_users");
    const home = this.users.homeOf(u.name);
    const r = this.tmux(u, "new-session", "-d", "-s", name, "-c", path.join(home, "work"), "-x", "120", "-y", "32", "sh", "-c", this.#cmd(u, name));
    if (r.status !== 0) throw new Error(`tmux new-session failed: ${r.stderr}`);
    this.log(`console ${u.name}/${name} started`);
  }
  /** Attaches a node-pty client to the session and tracks viewers so idle reaping knows when nobody is looking. */
  attach(u, name, cols, rows) {
    this.ensure(u, name); this.seen.set(u.name, Date.now());
    const [cmd, args] = this.users.wrap(u, this.#tmuxArgv(u, "attach-session", "-t", name));
    const term = pty.spawn(cmd, args, { name: "xterm-256color", cwd: this.users.homeOf(u.name), env: { PATH: process.env.PATH, TERM: "xterm-256color" }, cols, rows });
    this.attached.set(u.name, (this.attached.get(u.name) || 0) + 1);
    term.onExit(() => { this.attached.set(u.name, Math.max(0, (this.attached.get(u.name) || 1) - 1)); this.seen.set(u.name, Date.now()); });
    return term;
  }
  /** Types a message into the person's Claude console (bracketed paste, then Enter). */
  send(u, text) {
    this.ensure(u, "claude");
    const buf = "collado-send";
    const [cmd, args] = this.users.wrap(u, this.#tmuxArgv(u, "load-buffer", "-b", buf, "-"));
    const r1 = this.users.run(u, this.#tmuxArgv(u, "load-buffer", "-b", buf, "-"), { input: text }); if (r1.status !== 0) throw new Error(r1.stderr);
    const r2 = this.tmux(u, "paste-buffer", "-p", "-d", "-b", buf, "-t", "claude"); if (r2.status !== 0) throw new Error(r2.stderr);
    setTimeout(() => this.tmux(u, "send-keys", "-t", "claude", "Enter"), 250);
  }
  /** Stops tmux servers of people who have been away for longer than the idle limit (their Claude conversation resumes with --continue). */
  reap() {
    for (const u of this.active()) { if ((this.attached.get(u.name) || 0) > 0) continue; const last = this.seen.get(u.name) || 0; if (Date.now() - last > this.idleMs) { this.tmux(u, "kill-server"); this.log(`console ${u.name} reaped after inactivity`); } }
  }
  /** Stops every user's tmux server (shutdown). */
  killAll() { for (const u of this.users.list()) this.tmux(u, "kill-server"); }
}
