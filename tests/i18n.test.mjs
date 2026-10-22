import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const APP = path.resolve(import.meta.dirname, "../app-seed/app");
const { ENTITIES } = await import(`${APP}/lib/schema.mjs`); const { DICTS, fieldLabel, optionLabel, entityName } = await import(`${APP}/lib/i18n/index.mjs`);
const LANGS = ["es", "ca", "en"];

test("every entity, field and enum option has a label in es, ca and en", () => {
  const miss = [];
  for (const l of LANGS) for (const e of Object.values(ENTITIES)) {
    if (!DICTS[l].e[e.name]) miss.push(`${l} entity ${e.name}`);
    for (const f of Object.values(e.fields)) {
      if (fieldLabel(l, e.name, f.name) === f.name && !(f.type === "ref")) miss.push(`${l} field ${e.name}.${f.name}`);
      for (const o of f.options || []) if (optionLabel(l, e.name, f.name, o) === o && !["A3", "A4"].includes(o) && !DICTS[l].o[o]) miss.push(`${l} option ${f.name}.${o}`);
    }
  }
  assert.deepEqual(miss, []);
});
test("ui, msg and compliance dictionaries have the same keys in the three languages; every t('key') used by the frontend exists", () => {
  for (const part of ["ui", "msg", "ci"]) for (const l of ["ca", "en"]) assert.deepEqual(Object.keys(DICTS.es[part]).filter((k) => DICTS[l][part][k] === undefined), [], `${l}.${part}`);
  const used = new Set(); const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith(".js")) { const s = fs.readFileSync(p, "utf8"); for (const m of s.matchAll(/(?<![\w$.])t\("([\w.]+)"/g)) used.add(m[1]); for (const m of s.matchAll(/toast\("([\w.]+)"/g)) used.add(m[1]); } } };
  walk(path.join(APP, "public/js")); const miss = [...used].filter((k) => !k.endsWith(".") && DICTS.es.ui[k] === undefined); assert.deepEqual(miss, []);
});
test("the neobrutalism kit of the shell and of the app are identical", () => {
  const root = path.resolve(import.meta.dirname, ".."); assert.equal(fs.readFileSync(path.join(root, "gateway/static/nb.css"), "utf8"), fs.readFileSync(path.join(APP, "public/nb.css"), "utf8"));
  for (const f of fs.readdirSync(path.join(root, "gateway/static/fonts"))) assert.ok(fs.existsSync(path.join(APP, "public/fonts", f)), f);
  const css = fs.readFileSync(path.join(root, "gateway/static/nb.css"), "utf8") + fs.readFileSync(path.join(APP, "public/app.css"), "utf8") + fs.readFileSync(path.join(root, "gateway/static/shell.css"), "utf8");
  assert.ok(!/blur\(|linear-gradient|radial-gradient|backdrop-filter/.test(css), "design guide: no blur, gradients or backdrop-filter");
});
