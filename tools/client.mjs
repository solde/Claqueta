// Shared by the agent tools: where the app and agentd are, and the person's API token (written by agentd on every console attach).
import fs from "node:fs";
/** Base URL of the app's API and of agentd's control API, from the environment. */
export const API = process.env.COLLADO_API || "http://127.0.0.1:3000";
/** Base URL of agentd's control API (COLLADO_CTL). */
export const CTL = process.env.COLLADO_CTL || "http://127.0.0.1:8081";
/** The person's API token (from the file agentd writes, or COLLADO_TOKEN). */
export function token() {
  try { return fs.readFileSync(process.env.COLLADO_TOKEN_FILE || `${process.env.HOME}/.collado/token`, "utf8").trim(); } catch { return process.env.COLLADO_TOKEN || ""; }
}
/** Calls an API with the person's token: JSON in and out, errors turned into readable messages and exit code 1. */
export async function call(base, method, path, body, { raw = false } = {}) {
  const headers = { "x-requested-with": "collado" }; const t = token(); if (t) headers.authorization = `Bearer ${t}`;
  let payload; if (body !== undefined && !(body instanceof Uint8Array)) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); } else payload = body;
  let res; try { res = await fetch(base + path, { method, headers, body: payload, signal: AbortSignal.timeout(120000) }); } catch (e) { fail(`no se pudo conectar con ${base}: ${e.message}`); }
  if (raw) { if (!res.ok) fail(await errText(res)); return res; }
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) fail(`${res.status} ${data?.error || text.slice(0, 300)}${data?.detail ? " " + JSON.stringify(data.detail).slice(0, 400) : ""}${res.status === 401 ? " (el token caduca a las 24 h: reabre la consola)" : ""}`);
  return data;
}
/** Readable text of an API error response. */
async function errText(res) { const t = await res.text(); try { const j = JSON.parse(t); return `${res.status} ${j.error}${j.detail ? " " + JSON.stringify(j.detail).slice(0, 400) : ""}`; } catch { return `${res.status} ${t.slice(0, 300)}`; } }
/** Prints a message to stderr and exits. */
export function fail(msg, code = 1) { console.error(msg); process.exit(code); }
/** Calls the app's API. */
export const app = (m, p, b, o) => call(API, m, p, b, o);
/** Calls agentd's control API. */
export const ctl = (m, p, b, o) => call(CTL, m, p, b, o);
/** Splits argv into positionals and flags (`--flag value`, `--flag=value`, repeated flags collected in `multi`, `-o file`). */
export function parseArgs(argv, valueFlags = []) {
  const pos = [], flags = {}, multi = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i];
    if (a.startsWith("--")) { const [k, v] = a.slice(2).split(/=(.*)/s); if (v !== undefined) (multi[k] ||= []).push(v), (flags[k] = v); else if (valueFlags.includes(k)) { const val = argv[++i]; (multi[k] ||= []).push(val); flags[k] = val; } else flags[k] = true; }
    else if (a === "-o") { flags.o = argv[++i]; } else pos.push(a); }
  return { pos, flags, multi };
}
