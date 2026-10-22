import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AuthStore, hashPassword, verifyPassword } from "../gateway/lib/auth.mjs";
import { Users } from "../gateway/lib/agentd/users.mjs";
import { PtyConsoles } from "../gateway/lib/agentd/ptyconsole.mjs";
import { Files } from "../gateway/lib/agentd/files.mjs";
import { installToolLaunchers, which, searchPath } from "../gateway/lib/agentd/platform.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "collado-desktop-"));
const req = { headers: { "user-agent": "t" }, socket: { remoteAddress: "127.0.0.1" } };
const mkUsers = (portable = true) => { const d = tmp(); return new Users({ root: false, homes: path.join(d, "homes"), shared: path.join(d, "shared"), state: path.join(d, "state"), apiUrl: "http://127.0.0.1:1", ctlUrl: "http://127.0.0.1:2", tokenKey: "k", portable }); };
const wait = async (cond, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test("portable users: no env/setpriv wrapper, clean environment with the person's PATH, private HOME", () => {
  const users = mkUsers(); const u = users.ensure("ana", ["agent.console"]);
  const [cmd, args] = users.wrap(u, ["claude", "-p"]); assert.equal(cmd, "claude"); assert.deepEqual(args, ["-p"]);
  const env = users.env(u); assert.equal(env.HOME, users.homeOf("ana")); assert.ok(env.PATH.split(path.delimiter)[0].endsWith(path.join("shared", "bin")));
  assert.ok(!("INTERNAL_KEY" in env) && !("ELECTRON_RUN_AS_NODE" in env)); assert.equal(env.COLLADO_USER, "ana");
  assert.deepEqual(users.spawnEnv(u, { A: "1" }).A, "1"); assert.equal(mkUsers(false).spawnEnv({ name: "x" }), undefined, "the server build keeps using wrap()");
  assert.equal(users.run(u, [process.execPath, "-e", "process.stdout.write(process.env.COLLADO_USER)"]).stdout, "ana");
});

test("tool launchers run the agent commands without a system Node", () => {
  const d = tmp(); installToolLaunchers(path.join(d, "bin"), path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools"));
  assert.ok(which("collado-api", [path.join(d, "bin")])); const r = spawnSync(path.join(d, "bin", process.platform === "win32" ? "collado-app.cmd" : "collado-app"), ["nope"], { encoding: "utf8" });
  assert.match(r.stderr, /uso: collado-app/);   // the script ran and printed its usage
  assert.ok(searchPath(["/x/y"])[0] === "/x/y");
});

test("pty consoles: sessions persist across viewers, replay their screen, and a missing Claude Code is a clear error", async (t) => {
  if (process.platform === "win32") return t.skip("posix shell commands");
  const users = mkUsers(); const u = users.ensure("ana", []);
  const c = new PtyConsoles({ users, agentCmd: "claude-does-not-exist", shellCmd: "/bin/sh" });
  assert.throws(() => c.attach(u, "claude", 80, 24), /Claude Code no está instalado/);
  let seen = ""; const v1 = c.attach(u, "shell", 80, 24); v1.onData((d) => { seen += d; }); assert.ok(c.hasSession(u, "shell"));
  await new Promise((r) => setTimeout(r, 300)); v1.write("echo persistent-$((6*7))\n");
  assert.ok(await wait(() => /persistent-42/.test(seen.replace("echo persistent-$((6*7))", ""))), "the shell answered");
  v1.kill(); assert.ok(c.hasSession(u, "shell"), "closing a viewer does not end the session");
  let again = ""; const v2 = c.attach(u, "shell", 80, 24); v2.onData((d) => { again += d; });
  assert.ok(await wait(() => /persistent-42/.test(again)), "a new viewer gets the previous screen back");
  assert.equal(c.active().length, 1); v2.kill(); c.killAll(); assert.equal(c.active().length, 0);
});

test("pty consoles: `send` pastes a prompt into the agent session (bracketed paste + Enter)", async (t) => {
  if (process.platform === "win32") return t.skip("posix tools");
  const users = mkUsers(); const u = users.ensure("ana", []); const c = new PtyConsoles({ users, agentCmd: "cat" });   // `cat` stands in for Claude: it echoes what it receives
  const v = c.attach(u, "claude", 80, 24); let seen = ""; v.onData((d) => { seen += d; });
  await new Promise((r) => setTimeout(r, 300)); c.send(u, "hola agente");
  assert.ok(await wait(() => /hola agente/.test(seen))); c.killAll();
});

test("file manager zip works without a `zip` binary (Windows, minimal systems)", () => {
  const home = tmp(); fs.mkdirSync(path.join(home, "work/sub"), { recursive: true }); fs.writeFileSync(path.join(home, "work/a.txt"), "uno"); fs.writeFileSync(path.join(home, "work/sub/b.txt"), "dos");
  const fsops = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gateway/lib/agentd/fsops.mjs");
  const r = spawnSync(process.execPath, [fsops, "zip", home, "work"], { env: { PATH: path.join(home, "nothing-here") }, maxBuffer: 1e7 });
  assert.equal(r.status, 0, r.stderr.toString()); const z = r.stdout; assert.equal(z.toString("latin1", 0, 2), "PK");
  for (const n of ["work/", "work/a.txt", "work/sub/b.txt"]) assert.ok(z.includes(Buffer.from(n)), n);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 4, "central directory lists 4 entries");
});

test("passwords: scrypt hashes verify, argon2 hashes still verify where supported, wrong or malformed ones never do", async () => {
  const h = await hashPassword("una-clave-larga-1"); assert.match(h, /^(argon2id|scrypt)\$/);
  assert.equal(await verifyPassword("una-clave-larga-1", h), true); assert.equal(await verifyPassword("otra", h), false); assert.equal(await verifyPassword("x", "nada"), false);
  const salt = crypto.randomBytes(16), k = crypto.scryptSync("pw", salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 });
  assert.equal(await verifyPassword("pw", `scrypt$32768,8,1$${salt.toString("base64")}$${k.toString("base64")}`), true);
});

test("desktop identity: the local person is created once as super-admin without a forced password change and gets a session", async () => {
  const a = new AuthStore(tmp(), { require2fa: false });
  const u = await a.ensureLocalUser("david", "David"); assert.equal(u.super, true); assert.equal(u.must_change, false);
  await a.ensureLocalUser("david"); assert.equal(a.listUsers().length, 1, "idempotent");
  const token = a.openLocalSession("david", req); const c = a.contextOf(token);
  assert.equal(c.user.username, "david"); assert.ok(c.perms.has("platform.admin") && c.perms.has("service.manage") && c.perms.has("agent.console"));
  assert.equal(a.publicUser(c.user).needs_enroll, false); assert.throws(() => a.openLocalSession("nadie", req), /Usuario no válido/);
});

test("desktop skin: the Neumorphism stylesheet is the same file for the shell and the app, and every rule is scoped to data-skin so the web build is unaffected", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), a = fs.readFileSync(path.join(root, "gateway/static/neu.css"), "utf8"), b = fs.readFileSync(path.join(root, "app-seed/app/public/neu.css"), "utf8");
  assert.equal(a, b, "gateway/static/neu.css and app-seed/app/public/neu.css must be identical");
  const outside = a.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => /^[^\s}@]/.test(l) && !l.startsWith('html[data-skin="neu"]') && !/^\s*$/.test(l));
  assert.deepEqual(outside, [], "top-level rules must all start with html[data-skin=\"neu\"]");
  assert.ok(!/https?:\/\//.test(a.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, "")), "no remote URLs (offline)");
});

test("project folders: linked into the home, idempotent, re-pointed, never over a real folder; the file manager works through the link", async () => {
  const users = mkUsers(); const u = users.ensure("ana", []); const files = new Files({ users }); const home = users.homeOf("ana");
  const proj = tmp(), other = tmp(); fs.writeFileSync(path.join(proj, "guion.txt"), "uno"); fs.mkdirSync(path.join(proj, "sub"));
  const a = files.link(u, "Mi proyecto-1", proj); assert.equal(a.status, 200); assert.equal(a.body.path, "Proyectos/Mi proyecto-1");
  assert.ok(fs.lstatSync(path.join(home, "Proyectos/Mi proyecto-1")).isSymbolicLink()); assert.equal(files.link(u, "Mi proyecto-1", proj).status, 200, "idempotent");
  assert.equal(files.link(u, "Mi proyecto-1", other).status, 200); assert.equal(fs.realpathSync(path.join(home, "Proyectos/Mi proyecto-1")), fs.realpathSync(other), "a changed folder re-points the link");
  fs.mkdirSync(path.join(home, "Proyectos/real")); assert.equal(files.link(u, "real", proj).status, 409, "a real folder is never replaced");
  for (const bad of ["../x", "a/b", ".oculto", "", "x".repeat(101), "con:dos", "a\0b"]) assert.equal(files.link(u, bad, proj).status, 400, `name ${JSON.stringify(bad)}`);
  assert.equal(files.link(u, "r", "relativa").status, 400); assert.equal(files.link(u, "r", path.join(proj, "no-existe")).status, 404); assert.equal(files.link(u, "r", path.join(proj, "guion.txt")).status, 400, "a file is not a folder");
  files.link(u, "Mi proyecto-1", proj);
  const l = await files.json(u, "list", ["Proyectos/Mi proyecto-1"]); assert.equal(l.status, 200); assert.deepEqual(l.body.entries.map((e) => e.name).sort(), ["guion.txt", "sub"]);
  assert.equal((await files.json(u, "mkdir", ["Proyectos/Mi proyecto-1/nueva"])).status, 200); assert.ok(fs.existsSync(path.join(proj, "nueva")), "writes land in the project folder");
  assert.equal((await files.json(u, "trash", ["Proyectos/Mi proyecto-1/guion.txt"])).status, 200); assert.ok(!fs.existsSync(path.join(proj, "guion.txt")) && fs.readdirSync(path.join(home, ".Trash")).includes("guion.txt"));
  const ap = files.abspath(u, "Proyectos/Mi proyecto-1/nueva"); assert.equal(ap.status, 200); assert.equal(ap.body.path, path.join(home, "Proyectos/Mi proyecto-1/nueva"));
  assert.equal(files.abspath(u, "../../etc/passwd").status, 403); assert.equal(files.abspath(u, "no/existe").status, 404);
});
