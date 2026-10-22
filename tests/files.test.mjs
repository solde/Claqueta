import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WORKER = path.resolve("gateway/lib/agentd/fsops.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "collado-files-"));
const run = (op, ...args) => { const r = spawnSync(process.execPath, [WORKER, op, home, ...args.filter((a) => !(a && a.input !== undefined))], { input: args.find((a) => a && a.input !== undefined)?.input }); const t = r.stdout.toString(); return { code: r.status, out: t, json: () => JSON.parse(t.trim().split("\n").pop()) }; };

test("files: create, list, rename, copy", () => {
  assert.equal(run("mkdir", "docs/2026").code, 0);
  assert.equal(run("write", "docs/a.txt", "--mkdirs", { input: "hola" }).code, 0);
  assert.equal(fs.readFileSync(path.join(home, "docs/a.txt"), "utf8"), "hola");
  const l = run("list", "docs").json(); assert.deepEqual(l.entries.map((e) => e.name).sort(), ["2026", "a.txt"]);
  assert.equal(run("rename", "docs/a.txt", "docs/b.txt").code, 0);
  assert.equal(run("copy", "docs/b.txt", "docs/b.txt").code, 0);   // copy onto itself -> unique name
  assert.equal(run("list", "docs").json().entries.length, 3);
  assert.equal(run("write", "docs/b.txt", { input: "x" }).json().error, "exists");
  assert.equal(run("write", "docs/b.txt", "--overwrite", { input: "nuevo" }).code, 0);
  assert.equal(run("read", "docs/b.txt").out, "nuevo");
});

test("files: paths cannot leave the home", () => {
  for (const bad of ["../x", "/etc/passwd", "docs/../../x"]) { const r = run("read", bad); assert.notEqual(r.code, 0, bad); }
  assert.equal(run("list", "../").json().error, "outside_home");
});

test("files: trash, restore, empty", () => {
  assert.equal(run("trash", "docs/b.txt").code, 0);
  assert.ok(!fs.existsSync(path.join(home, "docs/b.txt")));
  const t = run("list", ".Trash").json().entries.filter((e) => !e.name.startsWith(".")); assert.equal(t.length, 1);
  assert.equal(run("restore", t[0].name).code, 0);
  assert.ok(fs.existsSync(path.join(home, "docs/b.txt")));
  run("trash", "docs/b.txt"); assert.equal(run("emptytrash").code, 0);
  assert.equal(run("list", ".Trash").json().entries.filter((e) => !e.name.startsWith(".")).length, 0);
});

test("files: find, stat and zip", () => {
  run("write", "docs/2026/guion-final.md", { input: "# g" });
  assert.equal(run("find", "", "guion").json().entries.some((h) => h.path === "docs/2026/guion-final.md"), true);
  assert.equal(run("stat", "docs").json().type, "dir");
  const z = spawnSync(process.execPath, [WORKER, "zip", home, "docs"]); assert.equal(z.stdout.slice(0, 2).toString(), "PK");
});
