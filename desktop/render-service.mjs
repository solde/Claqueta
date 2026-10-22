// Document rendering for the desktop build, done by Electron's own Chromium (so there is nothing to install: no WeasyPrint, no librsvg, no Python).
// The app runs in another process and calls this over 127.0.0.1 with a per-launch key:
//   POST /pdf            body = print-ready HTML (self-contained)          -> application/pdf
//   POST /svg-png?width  body = SVG                                        -> image/png (white background, used for charts inside Word files)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { BrowserWindow } from "electron";

const MAX_BODY = 60 * 1024 * 1024;
const safeEqual = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

let busy = 0; const queue = [];
async function limited(fn, max = 2) { if (busy >= max) await new Promise((r) => queue.push(r)); busy++; try { return await fn(); } finally { busy--; queue.shift()?.(); } }

const hidden = (js) => new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: js, backgroundThrottling: false, spellcheck: false } });

async function htmlToPdf(html) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collado-pdf-")), "doc.html"); fs.writeFileSync(file, html);
  const win = hidden(false);
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, generateTaggedPDF: true });
  } finally { win.destroy(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

async function svgToPng(svg, width) {
  const win = hidden(true);
  try {
    await win.loadURL("data:text/html;charset=utf-8,<!doctype html><canvas id=c></canvas>");
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
    const png = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
      const w = ${Math.max(16, Math.min(4000, width | 0))}, nw = img.naturalWidth || 800, nh = img.naturalHeight || 450, h = Math.max(1, Math.round(w * nh / nw));
      const c = document.getElementById("c"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/png").split(",")[1]; })()`);
    return Buffer.from(png, "base64");
  } finally { win.destroy(); }
}

/** Starts the local service. Returns { url, close }. */
export function startRenderService(key) {
  const server = http.createServer(async (req, res) => {
    const fail = (code, msg) => { res.writeHead(code, { "content-type": "text/plain" }); res.end(msg); };
    try {
      const url = new URL(req.url, "http://x");
      if (req.method !== "POST" || !safeEqual(req.headers["x-render-key"], key)) return fail(403, "forbidden");
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > MAX_BODY) return fail(413, "too large"); chunks.push(c); }
      const body = Buffer.concat(chunks);
      let out, type;
      if (url.pathname === "/pdf") { out = await limited(() => htmlToPdf(body.toString("utf8"))); type = "application/pdf"; }
      else if (url.pathname === "/svg-png") { out = await limited(() => svgToPng(body.toString("utf8"), Number(url.searchParams.get("width")) || 1440), 3); type = "image/png"; }
      else return fail(404, "not found");
      res.writeHead(200, { "content-type": type, "content-length": out.length }); res.end(out);
    } catch (e) { console.error("render service:", e); fail(500, String(e.message || e)); }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}
