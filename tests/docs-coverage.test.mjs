// Enforces the documentation guidelines of docs/DOCUMENTATION.md: every source file has a header comment, every export and public class method has a doc comment,
// the generated documents (API, data model, code map, memoir study) match what the code would generate now, and every route, report and action has a description.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.COLLADO_DESKTOP = "1";
const ROOT = path.resolve(import.meta.dirname, ".."), read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const { sourceFiles, headerOf, build: buildMap } = await import("../scripts/docs-code-map.mjs");
const { build: buildApi } = await import("../scripts/docs-api.mjs"), { build: buildModel } = await import("../scripts/docs-data-model.mjs"), { md: studyMd } = await import("../scripts/memoir-study.mjs");

// the standalone desktop repository ships the generated documents but not every file they describe, so it only checks the rules that do not depend on the full tree
const FULL = fs.existsSync(path.join(ROOT, "desktop/export"));
const commented = (lines, i) => { const p = (lines[i - 1] || "").trim(); return p.startsWith("//") || p.startsWith("/*") || p.startsWith("*") || p.endsWith("*/"); };
// code whose exports and public methods must be documented (the shipped code; tests and one-off scripts only need their header)
const CODE = /^(desktop|gateway|app-seed\/app\/(lib|public\/js)|tools|scripts)\//;
// classes: public methods must have a comment too
const CLASS_FILES = /^(gateway\/lib\/(auth|agentd\/[\w]+)\.mjs|desktop\/sync\/.*\.mjs|app-seed\/app\/lib\/.*\.mjs)$/;

test("every source file starts with a header comment that says what it is", () => {
  const missing = sourceFiles().filter((f) => headerOf(path.join(ROOT, f)).length < 20);
  assert.deepEqual(missing, [], "add a header comment (docs/DOCUMENTATION.md §4)");
});

test("every export of the shipped code has a doc comment", () => {
  const bad = [];
  for (const f of sourceFiles().filter((f) => CODE.test(f) && /\.(m?js|cjs)$/.test(f))) {
    const lines = read(f).split("\n");
    lines.forEach((l, i) => { if (/^export (async )?(function\*?|const|class|let) \w+/.test(l) && !commented(lines, i)) bad.push(`${f}:${i + 1} ${l.slice(0, 70)}`); });
  }
  assert.deepEqual(bad, [], "put a /** … */ comment above each (docs/DOCUMENTATION.md §5)");
});

test("every public method of the classes has a doc comment", () => {
  const bad = [];
  for (const f of sourceFiles().filter((f) => CLASS_FILES.test(f))) {
    const lines = read(f).split("\n"); if (!lines.some((l) => /^(export )?class /.test(l))) continue;
    let inClass = false;
    lines.forEach((l, i) => {
      if (/^(export )?class /.test(l)) inClass = true; else if (/^\}/.test(l)) inClass = false;
      const m = inClass && /^  (?:async |static |get |set )?([a-zA-Z]\w*)\(.*\)\s*\{/.exec(l);
      if (m && m[1] !== "constructor" && !commented(lines, i)) bad.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepEqual(bad, [], "document each public method (docs/DOCUMENTATION.md §5)");
});

test("the generated documents are up to date (run `npm run docs`)", { skip: !FULL && "only in the full repository" }, () => {
  assert.equal(read("docs/API.md"), buildApi(), "docs/API.md");
  assert.equal(read("docs/DATA-MODEL.md"), buildModel(), "docs/DATA-MODEL.md");
  assert.equal(read("docs/CODE-MAP.md"), buildMap(), "docs/CODE-MAP.md");
  assert.equal(read("docs/MEMORIAS.md"), studyMd, "docs/MEMORIAS.md");
});

test("every route, report and action has a description in the API reference", () => {
  assert.ok(!buildApi().includes("sin descripción"), "add the description to scripts/docs-api.mjs");
});

test("the documentation index links the documents that exist", () => {
  const docs = ["SOFTWARE.md", "DOCUMENTATION.md", "CODE-MAP.md", "API.md", "DATA-MODEL.md", "MEMORIAS.md", "DESKTOP.md", "ARCHITECTURE.md", "OPERATIONS.md"];
  for (const f of docs) assert.ok(fs.existsSync(path.join(ROOT, "docs", f)), f);
  for (const f of ["README.md", ...(FULL ? ["desktop/export/README.md"] : [])]) { const t = read(f); for (const d of ["SOFTWARE.md", "DOCUMENTATION.md", "CODE-MAP.md"]) assert.ok(t.includes(d), `${f} must link ${d}`); }
});
