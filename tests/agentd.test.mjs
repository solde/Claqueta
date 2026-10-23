import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { internalKeys, signToken, verifyToken } from "../gateway/lib/agentd/keys.mjs";
import { Users } from "../gateway/lib/agentd/users.mjs";
import { Supervisor } from "../gateway/lib/agentd/supervisor.mjs";
import { installOrUpgradeApp, seedHash } from "../gateway/lib/agentd/upgrade.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "collado-agentd-"));
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

test("keys: the app only gets derived keys; tokens are signed, expire and carry permissions", () => {
  const k = internalKeys("master-secret"); assert.notEqual(k.app, k.gateway); assert.notEqual(k.token, k.app);
  const t = signToken(k.token, { user: "ana", perms: ["app.view", "fin.view"] });
  assert.deepEqual(verifyToken(k.token, t), { user: "ana", perms: ["app.view", "fin.view"], org: "principal", exp: verifyToken(k.token, t).exp });
  assert.equal(verifyToken(k.token, signToken(k.token, { user: "ana", perms: [], org: "acme" })).org, "acme", "the organization travels inside the signed token");
  assert.equal(verifyToken(k.app, t), null); assert.equal(verifyToken(k.token, t.slice(0, -2) + "xx"), null);
  assert.equal(verifyToken(k.token, signToken(k.token, { user: "ana", perms: [], ttlS: -5 })), null);
});

test("users: names are validated, homes seeded with managed skills and settings, tokens written, commands wrapped", () => {
  const d = tmp(), shared = path.join(d, "shared"); fs.mkdirSync(path.join(shared, "agent/skills/produccion"), { recursive: true });
  fs.writeFileSync(path.join(shared, "agent/skills/produccion/SKILL.md"), "---\nname: produccion\n---\nx"); fs.writeFileSync(path.join(shared, "agent/AGENT.md"), "guidelines"); fs.writeFileSync(path.join(shared, "TEAM.md"), "team");
  const k = internalKeys("m"); const u = new Users({ root: false, homes: path.join(d, "homes"), shared, state: path.join(d, "state"), apiUrl: "http://a", ctlUrl: "http://c", tokenKey: k.token });
  assert.throws(() => u.ensure("root", []), /invalid_user/); assert.throws(() => u.ensure("Bad Name", []), /invalid_user/);
  const ana = u.ensure("ana", ["agent.console"]); const home = u.homeOf("ana");
  assert.ok(fs.readFileSync(path.join(home, "CLAUDE.md"), "utf8").includes("AGENT.md")); assert.ok(fs.existsSync(path.join(home, ".claude/skills/collado-produccion/SKILL.md")));
  const s = JSON.parse(fs.readFileSync(path.join(home, ".claude/settings.json"), "utf8")); assert.ok(s.permissions.allow.includes("Bash(collado-api:*)"));
  u.refreshToken(ana); assert.equal(verifyToken(k.token, fs.readFileSync(path.join(home, ".collado/token"), "utf8").trim()).user, "ana");
  assert.equal(u.ensure("ana", ["agent.console", "service.manage"]).dev, true);
  assert.deepEqual(u.wrap(ana, ["echo", "hi"], { HOME: home })[1].slice(-2), ["echo", "hi"]);
  const root = new Users({ root: true, homes: path.join(d, "h2"), shared, state: path.join(d, "s2"), apiUrl: "", ctlUrl: "", tokenKey: "k" }); const x = { name: "bob", uid: 20001, gid: 20001, dev: true };
  const [cmd, args] = root.wrap(x, ["tmux", "ls"]); assert.equal(cmd, "setpriv"); assert.ok(args.includes("--reuid=20001") && args.includes("--no-new-privs") && args.some((a) => a.startsWith("--groups=20001,10010,10011")));
  assert.ok(args.includes("-i"), "clean environment"); assert.ok(!args.some((a) => a.startsWith("INTERNAL_KEY")));
});

test("seed install and upgrade: the agent's changes survive a merge, conflicts take the new seed and keep the old code in a tag", () => {
  const d = tmp(), seed = path.join(d, "seed"), app = path.join(d, "app"); fs.mkdirSync(path.join(seed, "lib"), { recursive: true });
  fs.writeFileSync(path.join(seed, "server.mjs"), "// v1\n"); fs.writeFileSync(path.join(seed, "lib/a.mjs"), "export const a = 1;\n"); fs.writeFileSync(path.join(seed, "lib/b.mjs"), "export const b = 1;\n");
  const sup = new Supervisor({ root: false, dirs: { app, appdata: path.join(d, "appdata"), shared: path.join(d, "shared"), backups: path.join(d, "bk") }, appPort: 0, log: () => {} });
  assert.equal(installOrUpgradeApp({ sup, seedAppDir: seed, appDir: app, log: () => {} }), "installed"); assert.equal(installOrUpgradeApp({ sup, seedAppDir: seed, appDir: app, log: () => {} }), "current");
  // the agent customises a.mjs (will not conflict) and b.mjs (will conflict)
  fs.writeFileSync(path.join(app, "lib/a.mjs"), "export const a = 1;\nexport const custom = 'mine';\n"); fs.writeFileSync(path.join(app, "lib/b.mjs"), "export const b = 'agent';\n"); git(app, "add", "-A"); git(app, "commit", "-q", "-m", "agent change");
  // the new image changes b.mjs and adds c.mjs, and edits a.mjs elsewhere
  fs.writeFileSync(path.join(seed, "lib/b.mjs"), "export const b = 'seed2';\n"); fs.writeFileSync(path.join(seed, "lib/c.mjs"), "export const c = 1;\n"); fs.writeFileSync(path.join(seed, "lib/a.mjs"), "// header\nexport const a = 1;\n");
  const r = installOrUpgradeApp({ sup, seedAppDir: seed, appDir: app, log: () => {} }); assert.equal(r, "merged");
  const a = fs.readFileSync(path.join(app, "lib/a.mjs"), "utf8"); assert.ok(a.includes("custom") && a.includes("// header"), "non-conflicting customisation kept and seed change applied");
  assert.equal(fs.readFileSync(path.join(app, "lib/b.mjs"), "utf8"), "export const b = 'seed2';\n", "conflict takes the new seed"); assert.ok(fs.existsSync(path.join(app, "lib/c.mjs")));
  assert.ok(git(app, "tag", "-l").stdout.includes("pre-upgrade"), "previous code kept in a tag"); assert.equal(installOrUpgradeApp({ sup, seedAppDir: seed, appDir: app, log: () => {} }), "current");
  assert.notEqual(seedHash(seed), "");
});
