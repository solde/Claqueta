import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeLogin } from "../gateway/lib/agentd/claudelogin.mjs";
import { Users } from "../gateway/lib/agentd/users.mjs";

const ROOT = path.resolve(import.meta.dirname, ".."), T = fs.mkdtempSync(path.join(os.tmpdir(), "collado-pf-"));
process.env.COLLADO_DESKTOP = "1"; process.env.WORKSPACE_DIR = path.join(T, "shared");
const APP = path.join(ROOT, "app-seed/app");
const { openDb, syncSchema } = await import(`${APP}/lib/db.mjs`), { initKey } = await import(`${APP}/lib/crypto.mjs`), E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`);
const { localCtx } = await import(`${APP}/lib/access.mjs`), { copyExportToProject, validateProjectFolder } = await import(`${APP}/lib/project-guide.mjs`);
initKey(T); openDb(T); syncSchema(); const ctx = localCtx("david"), d = (n) => path.join(T, n);

test("each project has its OWN folder: required at creation, absolute, created if missing, never shared or nested, and it can be changed (but not emptied)", async () => {
  await assert.rejects(E.create(ctx, "programs", { name: "Sin carpeta" }), /required/); await assert.rejects(E.create(ctx, "programs", { name: "Vacía", folder: "  " }), /required/);
  await assert.rejects(E.create(ctx, "programs", { name: "Rel", folder: "a/b" }), /folder_not_absolute/);
  const a = await E.create(ctx, "programs", { name: "Uno", folder: d("uno") }); assert.ok(fs.statSync(d("uno")).isDirectory(), "created when missing"); assert.equal(a.folder, d("uno"));
  await assert.rejects(E.create(ctx, "programs", { name: "Dos", folder: d("uno") }), /folder_in_use:Uno/); await assert.rejects(E.create(ctx, "programs", { name: "Dos", folder: d("uno") + "/" }), /folder_in_use/, "same folder with a trailing slash");
  await assert.rejects(E.create(ctx, "programs", { name: "Dentro", folder: d("uno/sub") }), /folder_overlaps:Uno/); await assert.rejects(E.create(ctx, "programs", { name: "Fuera", folder: T }), /folder_overlaps:Uno/);
  const b = await E.create(ctx, "programs", { name: "Dos", folder: d("dos") }); assert.notEqual(a.folder, b.folder);
  await assert.rejects(E.update(ctx, "programs", b.id, { folder: d("uno") }), /folder_in_use/); await assert.rejects(E.update(ctx, "programs", b.id, { folder: "" }), /required/);
  const moved = await E.update(ctx, "programs", b.id, { folder: d("dos-nueva") }); assert.equal(moved.folder, d("dos-nueva")); assert.equal((await E.update(ctx, "programs", b.id, { name: "Dos bis" })).folder, d("dos-nueva"), "editing other fields keeps it");
  await E.update(ctx, "programs", b.id, { folder: d("dos-nueva") }); await E.update(ctx, "programs", a.id, { folder: d("uno") });   // saving the same value is fine
  fs.writeFileSync(d("fichero"), "x"); await assert.rejects(E.create(ctx, "programs", { name: "Fich", folder: d("fichero") }), /folder_unusable|folder_overlaps/);
  assert.doesNotThrow(() => validateProjectFolder("create", {}, null, { desktop: false }), "the web build has no such rule");
});
test("exported documents are also written, plain, into Documentos/ of the programme's folder (never overwriting)", async () => {
  const p = await E.create(ctx, "programs", { name: "Export", folder: d("export") }), f1 = copyExportToProject(p.id, "informe.pdf", Buffer.from("PDF1")), f2 = copyExportToProject(p.id, "informe.pdf", Buffer.from("PDF2"));
  assert.equal(f1, path.join(d("export"), "Documentos", "informe.pdf")); assert.equal(f2, path.join(d("export"), "Documentos", "informe (2).pdf")); assert.equal(fs.readFileSync(f1, "utf8"), "PDF1");
  assert.equal(copyExportToProject(p.id, "x.pdf", Buffer.from("x"), { desktop: false }), null); assert.equal(copyExportToProject(99999, "x.pdf", Buffer.from("x")), null);
});

// ---- automatic Claude login ---------------------------------------------------------------------------------------------------------------------------------------------------
function loginRig(script, { loggedIn = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "collado-login-")), shared = path.join(base, "shared"); fs.mkdirSync(path.join(shared, "bin"), { recursive: true });
  if (script) { fs.writeFileSync(path.join(shared, "bin", "claude"), `#!/bin/sh\n${script}\n`, { mode: 0o755 }); }
  const users = new Users({ root: false, homes: path.join(base, "homes"), shared, state: path.join(base, "state"), apiUrl: "", ctlUrl: "", tokenKey: "k", portable: true }), u = users.ensure("ana", []), done = [];
  return { base, u, done, cl: new ClaudeLogin({ users, isLoggedIn: async () => loggedIn, onDone: (x) => done.push(x.name) }) };
}
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };

test("automatic Claude login: runs `claude auth login`, exposes the link, finishes by itself and restarts the console; failures and a missing install are reported", async (t) => {
  if (process.platform === "win32") return t.skip("posix shell script as fake claude");
  const ok = loginRig(`[ "$1 $2" = "auth login" ] || exit 9\necho "Opening browser to sign in…"\necho "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc"\nread code\n[ "$code" = "CODE-12345" ] && exit 0 || exit 1`);
  const s0 = await ok.cl.start(ok.u); assert.ok(["starting", "waiting"].includes(s0.state)); assert.ok(await until(() => ok.cl.state("ana").url), "the link is detected"); assert.match(ok.cl.state("ana").url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&state=abc$/);
  assert.equal((await ok.cl.start(ok.u)).state, "waiting", "starting twice reuses the run"); assert.equal(ok.cl.code(ok.u, "no válido con espacios"), false); assert.equal(ok.cl.code(ok.u, "CODE-12345"), true);
  assert.ok(await until(() => ok.cl.state("ana").state === "done")); assert.deepEqual(ok.done, ["ana"], "the open console is restarted");
  const bad = loginRig(`echo "visit: https://claude.com/x"\nexit 1`); await bad.cl.start(bad.u); assert.ok(await until(() => bad.cl.state("ana").state === "error")); assert.equal(bad.cl.state("ana").error, "login_failed"); assert.deepEqual(bad.done, []);
  const cancel = loginRig(`echo "visit: https://claude.com/x"\nsleep 30`); await cancel.cl.start(cancel.u); await until(() => cancel.cl.state("ana").url); cancel.cl.cancel(cancel.u); assert.ok(await until(() => cancel.cl.state("ana").state === "error")); assert.equal(cancel.cl.state("ana").error, "cancelled");
  const none = loginRig(null); none.cl.bin = "claude-no-existe-xyz"; assert.equal((await none.cl.start(none.u)).error, "not_installed"); assert.equal(new ClaudeLogin({ users: none.cl.users, isLoggedIn: async () => false }).state("zz").state, "idle");
});
