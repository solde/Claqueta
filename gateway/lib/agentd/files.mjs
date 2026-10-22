// File manager backend: every operation runs fsops.mjs as the person (see there), agentd only authenticates, routes and streams.
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { NODE_ENV, linkDir } from "./platform.mjs";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "fsops.mjs");
export class Files {
  constructor({ users, maxUploadMb = 200 }) { this.users = users; this.maxUpload = maxUploadMb * 1048576; }
  #spawn(u, op, args) {
    const [cmd, argv] = this.users.wrap(u, [process.execPath, WORKER, op, this.users.homeOf(u.name), ...args], this.users.env(u, NODE_ENV));
    return spawn(cmd, argv, { cwd: this.users.homeOf(u.name), stdio: ["pipe", "pipe", "pipe"], env: this.users.spawnEnv(u, NODE_ENV) });
  }
  /** JSON operations */
  json(u, op, args = []) {
    return new Promise((resolve) => {
      const c = this.#spawn(u, op, args); let out = "", err = ""; c.stdin.end();
      const t = setTimeout(() => c.kill("SIGKILL"), 60000);
      c.stdout.on("data", (d) => { out += d; if (out.length > 8e6) c.kill("SIGKILL"); }); c.stderr.on("data", (d) => { err += d; });
      c.on("error", () => resolve({ status: 500, body: { error: "worker_failed" } }));
      c.on("close", (code) => { clearTimeout(t); let body; try { body = JSON.parse(out.trim().split("\n").pop() || "{}"); } catch { body = { error: "worker_failed", detail: err.slice(-200) }; } resolve({ status: code === 0 ? 200 : body.error === "not_found" ? 404 : body.error === "forbidden" || body.error === "outside_home" ? 403 : body.error === "exists" ? 409 : 400, body }); });
    });
  }
  /** Streams stdout of read/zip into `res`; errors before the first byte become JSON. */
  stream(u, op, args, res, headers) {
    const c = this.#spawn(u, op, args); c.stdin.end(); let started = false, err = "";
    c.stderr.on("data", (d) => { err += d; });
    c.stdout.once("data", (first) => { if (/^\{"error"/.test(first.toString("utf8", 0, 10))) { let body = {}; try { body = JSON.parse(first.toString().split("\n")[0]); } catch { /* ignore */ } res.writeHead(body.error === "not_found" ? 404 : body.error === "too_large" ? 413 : 400, { "content-type": "application/json" }); res.end(JSON.stringify(body)); c.kill(); return; }
      started = true; res.writeHead(200, headers); res.write(first); c.stdout.pipe(res); });
    c.on("close", (code) => { if (!started && !res.writableEnded) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "worker_failed", detail: err.slice(-200) })); } });
    res.on("close", () => { try { c.kill(); } catch { /* gone */ } });
  }
  /** Upload: request body -> worker stdin, with a size cap. */
  write(u, req, rel, flags) {
    return new Promise((resolve) => {
      const c = this.#spawn(u, "write", [rel, ...flags]); let out = "", n = 0, over = false;
      c.stdout.on("data", (d) => { out += d; });
      req.on("data", (d) => { n += d.length; if (n > this.maxUpload && !over) { over = true; c.kill("SIGKILL"); } });
      req.on("error", () => c.kill("SIGKILL")); req.pipe(c.stdin); c.stdin.on("error", () => {});
      c.on("close", (code) => { if (over) return resolve({ status: 413, body: { error: "too_large", max_mb: this.maxUpload / 1048576 } }); let body; try { body = JSON.parse(out.trim().split("\n").pop() || "{}"); } catch { body = { error: "worker_failed" }; } resolve({ status: code === 0 ? 200 : body.error === "exists" ? 409 : 400, body }); });
    });
  }
  /** Desktop build: a project's folder lives anywhere on the computer. It is exposed inside the person's home as a link (junction on Windows) at Projects/<name>, so the file manager,
   *  the console and the agent all reach it with the paths they already use. Only a link created here is ever replaced; a real folder with that name is never touched. */
  link(u, name, target) {
    if (typeof name !== "string" || !/^[^/\\\0:*?"<>|]{1,100}$/.test(name) || name.startsWith(".")) return { status: 400, body: { error: "invalid_path" } };
    if (typeof target !== "string" || !path.isAbsolute(target)) return { status: 400, body: { error: "invalid_target" } };
    let st; try { st = fs.statSync(target); } catch { return { status: 404, body: { error: "target_not_found" } }; }
    if (!st.isDirectory()) return { status: 400, body: { error: "target_not_a_directory" } };
    const dir = path.join(this.users.homeOf(u.name), "Proyectos"), link = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    let cur = null; try { cur = fs.lstatSync(link); } catch { /* new */ }
    if (cur) {
      if (!cur.isSymbolicLink()) return { status: 409, body: { error: "exists" } };
      let same = false; try { same = fs.realpathSync(link) === fs.realpathSync(target); } catch { /* dangling link */ }
      if (same) return { status: 200, body: { path: `Proyectos/${name}` } };
      fs.unlinkSync(link);
    }
    try { linkDir(path.resolve(target), link); } catch (e) { return { status: 500, body: { error: "link_failed", detail: String(e.message).slice(0, 200) } }; }
    return { status: 200, body: { path: `Proyectos/${name}` } };
  }
  /** Absolute path of an entry of the person's home (lexical containment, like the worker's): what the OS needs to open a file with its default application. */
  abspath(u, rel) {
    const home = this.users.homeOf(u.name), full = path.resolve(home, String(rel ?? "").replace(/^\/+/, ""));
    if (String(rel ?? "").includes("\0") || (full !== home && !full.startsWith(home + path.sep))) return { status: 403, body: { error: "outside_home" } };
    if (!fs.existsSync(full)) return { status: 404, body: { error: "not_found" } };
    return { status: 200, body: { path: full } };
  }
}
