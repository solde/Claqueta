import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Users } from "../gateway/lib/agentd/users.mjs";
import { installShared } from "../gateway/lib/agentd/upgrade.mjs";
import { runChecks, summarize, formatReport } from "../tools/doccheck.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "collado-guides-"));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

/** Imports as Claude Code resolves them: `@path` on its own line, relative to the file; a path with spaces cannot be written in an import. */
function resolveImports(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("@")).map((l) => { assert.ok(!/\s/.test(l.trim()), `an @import cannot contain spaces: ${l}`); const p = l.slice(1).trim(); return { line: l, file: path.resolve(path.dirname(file), p) }; });
}
function setup({ spaced }) {
  const base = path.join(tmp(), spaced ? "Application Support" : "plain"), shared = path.join(base, "data/shared"); fs.mkdirSync(shared, { recursive: true }); installShared({ seedWorkspace: path.join(ROOT, "app-seed/workspace"), shared, log() {} });
  const mk = (portable) => new Users({ root: false, homes: path.join(base, "data/homes"), shared, state: path.join(base, "data/state"), apiUrl: "http://127.0.0.1:1", ctlUrl: "http://127.0.0.1:2", tokenKey: "k", portable, toolsDir: path.join(ROOT, "tools"), appName: "Claqueta" });
  return { base, shared, mk };
}

test("desktop CLAUDE.md: created from the desktop template, imports the shared guidelines AND the desktop notes, and every import resolves even when the data path has spaces (macOS)", () => {
  for (const spaced of [true, false]) {
    const { shared, mk } = setup({ spaced }), users = mk(true), u = users.ensure("ana", []), file = path.join(users.homeOf("ana"), "CLAUDE.md"), body = fs.readFileSync(file, "utf8");
    assert.match(body, /Claqueta · agente de producción de ana/); assert.match(body, /collado-doc check --program ID/); assert.ok(!body.includes("{{"), "no unreplaced placeholders");
    const imps = resolveImports(file); assert.deepEqual(imps.map((i) => path.basename(i.file)), ["AGENT.md", "AGENT.desktop.md", "TEAM.md"]);
    for (const i of imps) assert.ok(fs.existsSync(i.file), `${i.line} -> ${i.file}`);
    if (spaced) assert.ok(imps.every((i) => i.line.startsWith("@../")), "relative imports when the absolute path has spaces"); else assert.ok(imps[0].line.startsWith("@" + shared), "absolute imports otherwise");
    const env = users.env(u); assert.equal(env.COLLADO_WORK, path.join(users.homeOf("ana"), "work")); assert.equal(env.COLLADO_WORKSPACE, users.homeOf("ana")); assert.equal(env.COLLADO_TOOLS, path.join(ROOT, "tools"));
  }
});
test("the server keeps its own template (no desktop notes), and an old desktop CLAUDE.md is repaired in place without losing the person's text", () => {
  const { shared, mk } = setup({ spaced: true }), pod = mk(false), a = pod.ensure("bob", []); assert.ok(!fs.readFileSync(path.join(pod.homeOf("bob"), "CLAUDE.md"), "utf8").includes("AGENT.desktop.md"), "the pod does not load the desktop notes");
  const users = mk(true), home = users.homeOf("ana"); fs.mkdirSync(home, { recursive: true });
  const old = `# Mis cosas\nSiempre en catalán.\n\n@${shared}/agent/AGENT.md\n@${shared}/TEAM.md\n\n## Mis preferencias\n- Detalle: máximo\n`;   // what an earlier version wrote: absolute path with a space
  fs.writeFileSync(path.join(home, "CLAUDE.md"), old); users.ensure("ana", []); const fixed = fs.readFileSync(path.join(home, "CLAUDE.md"), "utf8");
  assert.ok(fixed.includes("Siempre en catalán.") && fixed.includes("- Detalle: máximo"), "the person's own text is untouched"); const imps = resolveImports(path.join(home, "CLAUDE.md")); assert.equal(imps.length, 3); for (const i of imps) assert.ok(fs.existsSync(i.file), i.line);
  users.ensure("ana", []); assert.equal(fs.readFileSync(path.join(home, "CLAUDE.md"), "utf8"), fixed, "idempotent");
});
test("the guidelines ship what the desktop needs: the environment notes, the tool check in every place it must be, the project template with only known placeholders, and the service skill is switched off", () => {
  const desk = read("app-seed/workspace/agent/AGENT.desktop.md"), agent = read("app-seed/workspace/agent/AGENT.md"), docs = read("app-seed/workspace/agent/skills/documentos/SKILL.md"), proj = read("app-seed/workspace/agent/PROJECT.template.md"), tmpl = read("app-seed/workspace/agent/CLAUDE.template.desktop.md");
  for (const [name, text] of [["AGENT.desktop.md", desk], ["AGENT.md", agent], ["documentos skill", docs], ["PROJECT.template.md", proj], ["CLAUDE.template.desktop.md", tmpl]]) assert.match(text, /collado-doc check/, `${name} tells the agent to run the toolbox check`);
  assert.match(desk, /no instales software del sistema/i); assert.match(desk, /COLLADO_WORK/); assert.match(desk, /Carpeta local/); assert.match(desk, /solo lectura/); assert.match(read("app-seed/workspace/agent/skills/servicio/SKILL.md"), /NO se aplica/);
  assert.ok(!desk.includes("{{"), "the static notes carry no placeholders (nobody substitutes them)"); assert.ok(!/\/opt\/collado-tools|\/data\/app|~\/work/.test(desk.replace(/^- No uses rutas de servidor.*$/m, "") + docs.replace(/os\.environ\.get\("COLLADO_TOOLS", "\/opt\/collado-tools"\)/g, "")), "no server paths in the desktop notes (except the sentence that forbids them) or the documents skill (except the default of COLLADO_TOOLS)");
  const known = new Set(["NAME", "CODE_SUFFIX", "ID", "KIND", "FOLDER", "APP_NAME", "AGENT_DIR"]); for (const m of proj.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(known.has(m[1]), `unknown placeholder ${m[0]}`);
  assert.match(tmpl, /@\{\{SHARED\}\}\/agent\/AGENT\.desktop\.md/);
});

test("project CLAUDE.md: written in the project's own folder once, from the template, with the programme's data and the toolbox check; never overwritten; silent when it cannot be written", async () => {
  const T = tmp(), shared = path.join(T, "shared"), proj = path.join(T, "Mi Proyecto"); fs.mkdirSync(path.join(shared, "agent"), { recursive: true }); fs.mkdirSync(proj); fs.copyFileSync(path.join(ROOT, "app-seed/workspace/agent/PROJECT.template.md"), path.join(shared, "agent/PROJECT.template.md"));
  Object.assign(process.env, { COLLADO_DESKTOP: "1", WORKSPACE_DIR: shared, APP_DISPLAY_NAME: "Claqueta" });
  const APP = path.join(ROOT, "app-seed/app"); const { openDb, syncSchema } = await import(`${APP}/lib/db.mjs`), { initKey } = await import(`${APP}/lib/crypto.mjs`), E = await import(`${APP}/lib/engine.mjs`); await import(`${APP}/lib/logic.mjs`); const { localCtx } = await import(`${APP}/lib/access.mjs`);
  initKey(T); openDb(T); syncSchema(); const ctx = localCtx("david");
  const p = await E.create(ctx, "programs", { name: "La Mañana en Directo", code: "LMD", kind: "magazine", folder: proj }), file = path.join(proj, "CLAUDE.md");
  const body = fs.readFileSync(file, "utf8"); assert.match(body, /# Proyecto: La Mañana en Directo \(LMD\)/); assert.match(body, new RegExp(`#${p.id}`)); assert.match(body, new RegExp(`collado-doc check --program ${p.id}`)); assert.ok(body.includes(proj) && body.includes("Claqueta") && !body.includes("{{"));
  assert.ok(body.includes(path.join(shared, "agent")), "points at the shared guidelines (plain text, not an @import)"); assert.ok(!/^@/m.test(body), "no @imports: a path with spaces would break them");
  fs.writeFileSync(file, "# Mis reglas\n"); await E.update(ctx, "programs", p.id, { name: "Otra" }); assert.equal(fs.readFileSync(file, "utf8"), "# Mis reglas\n", "never overwritten");
  await assert.rejects(E.create(ctx, "programs", { name: "Rel", folder: "relativa/ruta" }), /folder_not_absolute/); const fresh = path.join(T, "otro-nuevo"); await E.create(ctx, "programs", { name: "Nuevo", folder: fresh }); assert.ok(fs.existsSync(path.join(fresh, "CLAUDE.md")), "a folder that did not exist is created");
  const q2 = path.join(T, "otro"); fs.mkdirSync(q2); process.env.COLLADO_DESKTOP = "0"; await E.create(ctx, "programs", { name: "Web", folder: q2 }); assert.ok(!fs.existsSync(path.join(q2, "CLAUDE.md")), "only the desktop build writes into folders");
});

// ---- collado-doc check -----------------------------------------------------------------------------------------------------------------------------------------------------
const probes = (platform, have = {}, mods = ["pptx", "docx", "openpyxl", "PIL", "lxml"], fonts = ["inter"]) => ({ platform, which: (c) => (have[c] ? `/x/${c}` : null), run: (cmd, args) => (args[0] === "--version" ? { ok: !!have.python3 || !!have.python, out: "Python 3.12.1" } : { ok: mods.includes(args[2]?.replace("import ", "")), out: "" }),
  fontFiles: () => fonts, canWrite: (d) => !/readonly/.test(d), exists: (p) => !/missing/.test(p) });
const ALL = { pdftoppm: 1, soffice: 1, python3: 1, python: 1, pandoc: 1 }, caps = { tools: { pdf: true, pdf_engine: "Chromium", svg_png: true, png: false } };
const by = (r) => Object.fromEntries(r.map((x) => [x.id, x]));

test("collado-doc check: everything present = maximum quality; each missing piece says what it costs and the exact install command for THIS system", () => {
  const good = runChecks({ caps, brands: [{ name: "Marca", font_heading: "Inter", font_body: "Inter" }], probes: probes("darwin", ALL) }), s = summarize(good); assert.equal(s.ok, true); assert.equal(s.max_quality, true); assert.match(formatReport(good, { platform: "darwin", app: "Claqueta" }), /Calidad máxima posible/);
  for (const [platform, cmd, office, py] of [["darwin", "brew install poppler", "brew install --cask libreoffice", "brew install python"], ["win32", "scoop install poppler", "winget install TheDocumentFoundation.LibreOffice", "winget install Python.Python.3.12"], ["linux", "sudo apt install poppler-utils", "sudo apt install libreoffice-writer", "sudo apt install python3"]]) {
    const r = by(runChecks({ caps, brands: [], probes: probes(platform, {}, []) })); assert.equal(r.preview.ok, false); assert.ok(r.preview.install.includes(cmd), `${platform} poppler`); assert.ok(r.office.install.includes(office)); assert.ok(r.python.install.includes(py)); assert.match(r.preview.impact, /ver\*\* las páginas/); assert.equal(r.pymods.ok, false);
  }
  const part = runChecks({ caps, brands: [], probes: probes("linux", { python3: 1, python: 1 }, ["pptx", "openpyxl"]) }), pm = by(part).pymods; assert.match(pm.detail, /faltan: python-docx, pillow, lxml/); assert.match(pm.install, /pip install --user python-docx pillow lxml/);
  const sum = summarize(part); assert.equal(sum.ok, true, "missing recommended tools do not block"); assert.equal(sum.max_quality, false); assert.ok(sum.missing_recommended.includes("preview")); assert.match(formatReport(part, { platform: "linux" }), /NO a la máxima calidad/);
});
test("collado-doc check: a missing PDF engine is blocking; brand fonts and the project folder are checked", () => {
  const r = runChecks({ caps: { tools: { pdf: false } }, brands: [], probes: probes("darwin", ALL) }); assert.equal(summarize(r).ok, false); assert.deepEqual(summarize(r).missing_required, ["pdf"]); assert.match(formatReport(r, { platform: "darwin" }), /imprescindibles/);
  const f = by(runChecks({ caps, brands: [{ name: "Cliente X", font_heading: "\"Gotham Bold\", sans-serif", font_body: "serif" }], probes: probes("darwin", ALL, undefined, ["inter"]) })).fonts; assert.equal(f.ok, false); assert.match(f.detail, /Gotham Bold \(Cliente X\)/); assert.ok(!/serif/.test(f.detail), "generic families are not fonts to install");
  const ok = (folder) => by(runChecks({ caps, brands: [], program: { name: "P", folder }, probes: probes("linux", ALL) })).folder;
  assert.equal(ok("/ok/proyecto").ok, true); assert.equal(ok("").ok, true); assert.match(ok("/missing/x").detail, /no existe/); assert.match(ok("/readonly/x").detail, /sin permiso/); assert.equal(ok("/missing/x").level, "required");
});
test("collado-doc check: the real probes run on this machine without throwing", () => { const r = runChecks({ caps: { tools: { pdf: true } }, brands: [{ name: "M", font_heading: "Helvetica", font_body: "Inter" }] }); assert.ok(r.length >= 6); assert.ok(r.every((x) => typeof x.ok === "boolean" && x.label)); });
