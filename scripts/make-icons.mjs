// Renders app-seed/app/public/icon.svg into build/icon.png (1024x1024, rounded square with the usual margin). electron-builder derives .icns / .ico from it.
// Run with:  npm run icons   (uses Electron's Chromium, so no extra tools are needed)
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Renders the app icon at every size with Electron's Chromium and writes build/icon.png. */
async function main() {
const svg = fs.readFileSync(path.join(ROOT, "app-seed/app/public/icon.svg"));
const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
await win.loadURL("data:text/html,<canvas id=c></canvas>");
const b64 = await win.webContents.executeJavaScript(`(async () => {
  const img = new Image(); img.src = "data:image/svg+xml;base64,${svg.toString("base64")}"; await img.decode();
  const S = 1024, m = 80, r = 190, c = document.getElementById("c"); c.width = c.height = S; const g = c.getContext("2d");
  g.beginPath(); g.roundRect(m, m, S - 2 * m, S - 2 * m, r); g.clip(); g.drawImage(img, m, m, S - 2 * m, S - 2 * m);
  return c.toDataURL("image/png").split(",")[1]; })()`);
fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "build", "icon.png"), Buffer.from(b64, "base64"));
console.log("build/icon.png written");
}
// no top-level await on app.whenReady(): in an ESM main script Electron would wait for the module to finish before emitting "ready"
app.whenReady().then(main).then(() => app.quit(), (e) => { console.error(e); app.exit(1); });
