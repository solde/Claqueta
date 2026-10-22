// Copies the front-end libraries from node_modules into gateway/static/vendor (the same files the Dockerfile copies), so the program never needs a CDN or the network at run time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "gateway", "static", "vendor");
const FILES = ["@xterm/xterm/lib/xterm.js", "@xterm/xterm/css/xterm.css", "@xterm/addon-fit/lib/addon-fit.js", "@xterm/addon-web-links/lib/addon-web-links.js", "qrcode-generator/qrcode.js"];
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const src = path.join(ROOT, "node_modules", f);
  if (!fs.existsSync(src)) { console.error(`missing ${f}: run npm ci first`); process.exit(1); }
  fs.copyFileSync(src, path.join(OUT, path.basename(f)));
}
console.log(`vendor: ${FILES.length} files -> ${path.relative(ROOT, OUT)}`);
