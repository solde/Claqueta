// Automatic Claude Code login (desktop): agentd runs `claude auth login` for the person in the background. Claude opens the system browser by itself and finishes when the person authorises;
// we only watch the process (and offer the link / a code box as a fallback if the browser did not open). No manual steps in the console.
import path from "node:path";
import pty from "@lydell/node-pty";
import { which } from "./platform.mjs";

const strip = (s) => s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "");
export class ClaudeLogin {
  constructor({ users, isLoggedIn, onDone = () => {}, log = () => {}, bin = "claude" }) { Object.assign(this, { users, isLoggedIn, onDone, log, bin }); this.runs = new Map(); }
  state(name) { const r = this.runs.get(name); return r ? { state: r.state, url: r.url, error: r.error } : { state: "idle" }; }
  async start(u) {
    const cur = this.runs.get(u.name); if (cur && (cur.state === "starting" || cur.state === "waiting")) return this.state(u.name);
    const env = this.users.env(u), file = which(this.bin, env.PATH.split(path.delimiter));
    const r = { state: "starting", url: "", error: "", out: "", proc: null }; this.runs.set(u.name, r);
    if (!file) { r.state = "error"; r.error = "not_installed"; return this.state(u.name); }
    try {
      r.proc = pty.spawn(file, ["auth", "login", "--claudeai"], { name: "xterm-256color", cwd: path.join(this.users.homeOf(u.name), "work"), env, cols: 2000, rows: 30 });
      r.proc.onData((d) => { r.out += d; if (r.out.length > 60000) r.out = r.out.slice(-30000); const m = /https:\/\/claude\.(?:com|ai)\/[^\s\x1b\x07]+/.exec(strip(r.out)); if (m) { r.url = m[0]; if (r.state === "starting") r.state = "waiting"; } });
      r.proc.onExit(async ({ exitCode }) => {
        if (r.state === "error") return;
        const ok = !r.cancelled && exitCode === 0 && (await this.isLoggedIn(u.name, true)); r.proc = null;
        if (ok) { r.state = "done"; try { this.onDone(u); } catch { /* best effort */ } } else { r.state = "error"; r.error = r.cancelled ? "cancelled" : "login_failed"; this.log(`claude login failed (exit ${exitCode}): ${strip(r.out).slice(-300)}`); }
      });
      setTimeout(() => { if (r.state === "starting") r.state = "waiting"; }, 2500); setTimeout(() => { if (r.proc && (r.state === "waiting" || r.state === "starting")) { r.state = "error"; r.error = "timeout"; try { r.proc.kill(); } catch { /* gone */ } } }, 10 * 60e3).unref?.();
    } catch (e) { r.state = "error"; r.error = String(e.message || e); }
    return this.state(u.name);
  }
  /** Fallback: the person pasted the code shown by the browser. */
  code(u, text) { const r = this.runs.get(u.name); if (!r?.proc || !/^[\w#.\-_\/+=]{6,400}$/.test(String(text).trim())) return false; r.proc.write(String(text).trim() + "\r"); return true; }
  cancel(u) { const r = this.runs.get(u.name); if (r?.proc) { r.cancelled = true; const p = r.proc; try { p.kill(); } catch { /* gone */ } setTimeout(() => { if (r.proc === p) { try { p.kill("SIGKILL"); } catch { /* gone */ } } }, 1500).unref?.(); } }
}
