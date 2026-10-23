// Claqueta app — TV / radio / podcast production management. Zero dependencies: node:http + node:sqlite, static frontend without a build step.
// This is the part the agent is meant to change. Layout: lib/schema/* (data model), lib/engine.mjs (generic CRUD), lib/logic.mjs (rules), lib/reports.mjs, lib/docs/* (documents), public/* (UI).
// Run by the supervisor (agentd) with PORT / HOST / DATA_DIR; it restarts this process whenever a file in this folder changes. See the managed agent instructions.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort } from "node:worker_threads";
import { openDb, syncSchema, inOrg, setOrgInit, closeAll, currentSlug, listOrgSlugs, LEGACY_ORG } from "./lib/db.mjs";
import { initKey, setOrgResolver } from "./lib/crypto.mjs";
import { initFiles, sweepFiles } from "./lib/files.mjs";
import { renameV1Tables, migrateV1 } from "./lib/migrate-v1.mjs";
import "./lib/logic.mjs";
import { seedAll } from "./lib/seeds.mjs";
import { getSetting, setSetting } from "./lib/db.mjs";
import { ctxFromReq, touchUser } from "./lib/access.mjs";
import { handle } from "./lib/routes.mjs";
import * as J from "./lib/jobs.mjs";
import { makeRunner } from "./lib/agent-client.mjs";
import { startMaintenance } from "./lib/maintenance.mjs";
import { HttpError, send, log } from "./lib/util.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000), HOST = process.env.HOST || "127.0.0.1";
const DATA = process.env.DATA_DIR || path.join(HERE, "data");
const PUBLIC = path.join(HERE, "public");
const DESKTOP_SKIN = process.env.COLLADO_DESKTOP === "1";

fs.mkdirSync(DATA, { recursive: true });
initKey(DATA); setOrgResolver(currentSlug); openDb(DATA);
// every organization is a separate database: this runs for each one the first time it is used (the others are created on demand, the legacy one right here)
setOrgInit(async (slug, name) => {
  syncSchema(); initFiles(); await seedAll();
  const c = getSetting("company", {}); if (name && !c.name) setSetting("company", { ...c, name }, "sistema");
});
renameV1Tables(); syncSchema(); initFiles();
await seedAll(); await migrateV1();
for (const slug of listOrgSlugs()) if (slug !== LEGACY_ORG) await inOrg(slug, () => {});   // existing organizations: bring their schema up to date at start-up
J.setRunner(makeRunner()); J.recoverJobs(); setTimeout(J.startJobs, 800);
startMaintenance();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname); if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: "not_found" });
  const ext = path.extname(file);
  const headers = { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": ext === ".woff2" ? "public, max-age=31536000, immutable" : "no-cache", "x-content-type-options": "nosniff" };
  if (DESKTOP_SKIN && ext === ".html") { res.writeHead(200, headers); return res.end(fs.readFileSync(file, "utf8").replace("<html ", '<html data-skin="neu" ').replace("</head>", '<link rel="stylesheet" href="neu.css">\n</head>').replaceAll("Collado", process.env.APP_DISPLAY_NAME || "Collado")); }   // desktop build: Neumorphism skin (public/neu.css)
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) {
      const ctx = ctxFromReq(req);
      return await inOrg(ctx.org, async () => { touchUser(ctx); return handle(ctx, req, res, url); }, ctx.orgName);
    }
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method_not_allowed");
    serveStatic(res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra ? { detail: e.extra } : {}) });
    console.error("error:", e); send(res, 500, { error: "internal_error" });
  }
});
server.listen(PORT, HOST, () => log(`collado app on http://${HOST}:${PORT}, data in ${DATA}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); closeAll(); process.exit(0); });
if (!isMainThread) parentPort.on("message", (m) => { if (m === "shutdown") { server.close(); closeAll(); process.exit(0); } });   // desktop: running as a worker of agentd, which asks for a clean stop
