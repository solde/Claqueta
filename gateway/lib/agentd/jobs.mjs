// Headless agent runs (`claude -p`) on behalf of a person: same system user, same Claude login and settings as their console.
import path from "node:path";
import { spawn } from "node:child_process";

export class Jobs {
  constructor({ users, claudeBin = "claude", jobCmd, max = 3, timeoutMs = 15 * 60e3, log = () => {} }) { Object.assign(this, { users, claudeBin, jobCmd, max, timeoutMs, log }); this.running = new Map(); }
  async run({ id, user, perms, prompt, web = true }) {
    if (this.running.size >= this.max) return { error: "busy" };
    if ([...this.running.values()].some((j) => j.user === user)) return { error: "one_job_per_user" };
    const u = this.users.get(user) || this.users.ensure(user, perms || []);   // never touches the person's API token: it belongs to the organization they have open
    const argv = this.jobCmd ? this.jobCmd.split(" ") : [this.claudeBin, "-p", "--output-format", "text", "--allowedTools", web ? "WebSearch,WebFetch" : "Read", "--permission-mode", "default"];
    const [cmd, args] = this.users.wrap(u, argv);
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: path.join(this.users.homeOf(u.name), "work"), stdio: ["pipe", "pipe", "pipe"], env: this.users.spawnEnv(u) });
      const rec = { user, child }; this.running.set(id, rec); let out = "", err = "";
      const t = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
      child.stdout.on("data", (d) => { out += d; if (out.length > 600000) child.kill("SIGKILL"); }); child.stderr.on("data", (d) => { err += d; });
      child.on("error", (e) => { clearTimeout(t); this.running.delete(id); resolve({ error: `No se pudo ejecutar el agente: ${e.message}` }); });
      child.on("close", (code) => { clearTimeout(t); this.running.delete(id); const e = err.trim(); resolve(code === 0 ? { output: out.trim() } : { error: /log ?in|auth|credential|api key/i.test(e + out) ? "login_required" : (e.slice(-600) || `exit ${code}`) }); });
      child.stdin.on("error", () => {}); child.stdin.end(prompt);
    });
  }
  cancel(id) { this.running.get(id)?.child.kill("SIGKILL"); }
}
