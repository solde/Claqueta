import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ICONS } from "../scripts/build-icons.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "vendor" || e.name === "fonts" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
// pictographs and dingbats used as icons (plain typographic arrows and ticks in text are not)
const EMOJI = /[\u{1F000}-\u{1FAFF}☀-⛿✀-➿️⏩-⏿⬀-⯿＋]/u;

test("the generated icon files are up to date", () => {
  const before = ["gateway/static/icons.js", "app-seed/app/public/js/icons.js"].map(read);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build-icons.mjs")]);
  assert.deepEqual(["gateway/static/icons.js", "app-seed/app/public/js/icons.js"].map(read), before, "run node scripts/build-icons.mjs");
});

test("every icon is a non-empty drawing", () => { for (const [k, v] of Object.entries(ICONS)) assert.match(v || "", /<(path|circle|rect)/, k); });

test("every icon name used by the code exists", () => {
  const used = new Set();
  for (const f of [...walk("app-seed/app"), ...walk("gateway/static"), "desktop/main.mjs"].filter((f) => /\.(m?js|html)$/.test(f))) {
    const s = read(f);
    for (const m of s.matchAll(/\b(?:icon|ico|ch|svgIcon)\(\s*"([a-z-]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/\bicon: "([a-z-]+)"/g)) used.add(m[1]);
  }
  assert.deepEqual([...used].filter((n) => !ICONS[n]), []);
  const files = read("gateway/static/files.js").match(/const ICONS = \{([^}]*)\}/)[1];
  for (const m of files.matchAll(/"([a-z-]+)"/g)) assert.ok(ICONS[m[1]], `files.js icon "${m[1]}" is missing`);
});

test("no emoji in the interface", () => {
  const bad = [];
  for (const f of [...walk("app-seed/app/public"), ...walk("gateway/static"), "desktop/selftest.mjs"].filter((f) => /\.(m?js|html|css)$/.test(f) && !/icons\.js$/.test(f)))
    read(f).split("\n").forEach((l, i) => { if (EMOJI.test(l)) bad.push(`${f}:${i + 1}`); });
  assert.deepEqual(bad, []);
});
