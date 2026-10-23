// How the app asks for an agent run. In the pod it calls agentd (which runs `claude -p` as the person who asked); in development AGENT_JOB_CMD is a local command.
import { spawn } from "node:child_process";
/** The function that runs an agent generation: through agentd in production, or the local command AGENT_JOB_CMD in development; null when neither exists. */
export function makeRunner() {
  const url = process.env.AGENTD_URL, key = process.env.APP_KEY || process.env.AGENTD_KEY;
  if (url) return async (job) => {
    const r = await fetch(`${url}/job`, { method: "POST", headers: { "content-type": "application/json", "x-collado-key": key || "" }, body: JSON.stringify({ id: job.id, user: job.user, perms: job.extra?.perms || [], prompt: job.prompt, web: job.web }), signal: job.signal });
    const j = await r.json().catch(() => ({})); if (!r.ok) return { error: j.error || `agentd ${r.status}` }; return { output: j.output || "", error: j.error || "" };
  };
  const cmd = process.env.AGENT_JOB_CMD; if (!cmd) return null;
  return (job) => new Promise((resolve) => {
    const c = spawn(cmd, [], { stdio: ["pipe", "pipe", "pipe"], signal: job.signal }); let out = "", err = "";
    c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { err += d; }); c.on("error", (e) => resolve({ error: e.message })); c.on("close", (code) => resolve(code === 0 ? { output: out.trim() } : { error: err.slice(-500) || `exit ${code}` }));
    c.stdin.end(job.prompt);
  });
}
