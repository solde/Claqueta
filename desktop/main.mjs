// Claqueta (Collado) desktop (macOS, Windows, Linux). Electron shell around the same three Node pieces that run in the pod, but on this computer and with no network:
//   gateway (shell UI + auth/RBAC) ─► app (SPA + SQLite engine)         agentd (consoles with node-pty, file manager, supervisor of the app)
// Each runs as a child process of this program (Electron's binary in "run as Node" mode), bound to 127.0.0.1 and protected by keys that exist only for this launch.
// The window can only talk to those local servers: any other request is cancelled, so the program is offline by construction.
import { app, BrowserWindow, Menu, shell, session, dialog, nativeTheme, ipcMain, safeStorage } from "electron";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { startRenderService } from "./render-service.mjs";
import { runChecks } from "./selftest.mjs";
import { CloudSync, PlainVault } from "./sync/controller.mjs";
import { APP_NAME } from "./brand.mjs";
import { checkForUpdate, releasesUrl } from "./update.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smoke = process.argv.find((a) => a.startsWith("--smoke-test="))?.split("=")[1];   // load the UI, save a screenshot, quit (used by the checks)
const smokeTheme = process.argv.find((a) => a.startsWith("--smoke-theme="))?.split("=")[1];   // light | dark: force the colour scheme for the screenshot
if (smokeTheme) nativeTheme.themeSource = smokeTheme;
const isMac = process.platform === "darwin";

app.setName(APP_NAME);
// The app used to be called "Collado": keep its data where it already is instead of starting an empty workspace under the new name.
const legacyData = path.join(app.getPath("appData"), "Collado");
if (process.env.COLLADO_DATA_DIR) app.setPath("userData", path.resolve(process.env.COLLADO_DATA_DIR));
else if (fs.existsSync(legacyData) && !fs.existsSync(path.join(app.getPath("appData"), APP_NAME))) app.setPath("userData", legacyData);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const rand = (n = 32) => crypto.randomBytes(n).toString("hex");
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (r.ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}
/** Account name of the person at this computer, in the shape agentd accepts for a system-style user. */
function localUser() {
  let n = ""; try { n = os.userInfo().username; } catch { /* no passwd entry */ }
  n = n.toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z]+/, "").slice(0, 31);
  return n.length >= 2 && !["root", "admin", "system", "app", "agent", "claude", "collado", "node", "gateway", "sistema", "agente", "git", "tmux", "nobody"].includes(n) ? n : "usuario";
}

const state = { cloud: null, busyWin: null, relaunched: false, homes: "", lastOpened: "", quitting: false, children: [], win: null, render: null, urls: null, logDir: "" };

function startChild(name, script, env) {
  const log = fs.createWriteStream(path.join(state.logDir, `${name}.log`), { flags: "a" });
  log.write(`\n==== ${new Date().toISOString()} start ${name}\n`);
  const child = spawn(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1", COLLADO_DESKTOP: "1" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once("exit", (code, sig) => { log.write(`==== exit code=${code} signal=${sig}\n`); log.end(); if (!state.quitting) fatal(`El componente «${name}» se ha detenido (código ${code ?? sig}).`); });
  state.children.push(child); return child;
}
function fatal(message) {
  if (state.quitting) return; state.quitting = true;
  dialog.showErrorBox(`${APP_NAME} se ha detenido`, `${message}\n\nRegistros: ${state.logDir}`);
  stopChildren().finally(() => app.exit(1));
}
async function stopChildren() {
  state.render?.close();
  await Promise.all(state.children.map((c) => new Promise((res) => {
    if (c.exitCode !== null || c.signalCode) return res();
    const t = setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* gone */ } }, 8000); c.once("exit", () => { clearTimeout(t); res(); });
    // Closing stdin is the portable "please stop": Windows has no SIGTERM, and the child must stop the app and the consoles it owns. The same happens if this process dies.
    try { c.stdin.end(); } catch { /* closed */ }
    setTimeout(() => { try { c.kill("SIGTERM"); } catch { /* gone */ } }, 3000);
  })));
}

/** Everything the window may load is on this computer. This is what makes the program offline no matter what a document, an image URL or a link inside the data says. */
function lockdown(ses, origins) {
  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (d, cb) => { let h = ""; try { h = new URL(d.url).hostname; } catch { /* malformed */ } cb({ cancel: !LOCAL_HOSTS.has(h) }); });
  ses.setPermissionRequestHandler((wc, perm, cb, details) => { let o = ""; try { o = new URL(details.requestingUrl).origin; } catch { /* none */ } cb(origins.has(o) && ["media", "clipboard-sanitized-write", "notifications", "fullscreen"].includes(perm)); });
  ses.setPermissionCheckHandler((wc, perm, origin) => origins.has(origin) && ["media", "clipboard-sanitized-write", "notifications", "fullscreen"].includes(perm));
}
app.on("web-contents-created", (_e, wc) => {
  const external = (u) => { try { const p = new URL(u); if (["http:", "https:", "mailto:"].includes(p.protocol) && !LOCAL_HOSTS.has(p.hostname)) shell.openExternal(u); } catch { /* ignore */ } };   // links go to the system browser; the app itself never loads them
  wc.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => { if (state.urls && new URL(url).origin !== state.urls.origin) { e.preventDefault(); external(url); } });
  wc.on("did-navigate", (_e, url) => { try { if (state.urls && new URL(url).pathname === "/login") wc.loadURL(state.urls.login); } catch { /* ignore */ } });   // there is no login screen here: a lost session is re-opened silently
});

// ---- the bridge used by the page (see preload.cjs). Every call is checked here: only our own window, only our own origin ----------------------------------------------
const trusted = (e) => !!state.urls && e.senderFrame === e.sender.mainFrame && e.sender === state.win?.webContents && (() => { try { return new URL(e.senderFrame.url).origin === state.urls.origin; } catch { return false; } })();
// Files that are programs, scripts or installers are shown in their folder instead of being run from a double click (a page must never be able to launch code).
const RUNNABLE = /\.(app|exe|bat|cmd|com|msi|msix|scr|pif|ps1|psm1|vbs|vbe|wsf|jar|sh|command|workflow|action|pkg|dmg|lnk|desktop|appimage|run|terminal|inetloc|webloc|url|reg|dll|scpt|scptd|applescript|js|jse|hta|cpl|gadget)$/i;
ipcMain.handle("collado:pick-folder", async (e, current) => {
  if (!trusted(e)) return null;
  let defaultPath; try { if (current && path.isAbsolute(current) && fs.statSync(current).isDirectory()) defaultPath = current; } catch { /* not there */ }
  const r = await dialog.showOpenDialog(state.win, { title: "Carpeta del proyecto", buttonLabel: "Elegir carpeta", defaultPath, properties: ["openDirectory", "createDirectory"] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle("collado:open-path", async (e, p) => {
  if (!trusted(e)) return { error: "forbidden" };
  if (typeof p !== "string" || !path.isAbsolute(p) || p.includes("\0")) return { error: "invalid_path" };
  const full = path.resolve(p);
  if (!state.homes || !full.startsWith(state.homes + path.sep)) return { error: "outside_workspace" };   // only the person's workspace (project folders are linked inside it)
  try { fs.lstatSync(full); } catch { return { error: "not_found" }; }
  if (smoke) { state.lastOpened = full; return { ok: true }; }   // the checks verify the whole chain without launching applications on the screen
  if (RUNNABLE.test(full)) { shell.showItemInFolder(full); return { revealed: true }; }
  const err = await shell.openPath(full); return err ? { error: err } : { ok: true };
});

// ---- cloud sync (see sync/controller.mjs). The only code in this program that talks to the internet, and only after the person connected an account ----------------------------
const cloudDefaults = () => {
  let f = {}; try { f = JSON.parse(fs.readFileSync(path.join(ROOT, "desktop", "cloud.config.json"), "utf8")); } catch { /* none */ }
  return { google: { clientId: process.env.COLLADO_GOOGLE_CLIENT_ID || f.google?.clientId || "", clientSecret: process.env.COLLADO_GOOGLE_CLIENT_SECRET || f.google?.clientSecret || "" }, microsoft: { clientId: process.env.COLLADO_MS_CLIENT_ID || f.microsoft?.clientId || "" } };
};
function setBusy(text) {   // a small window while the final upload runs and the main window is gone
  if (!text) { state.busyWin?.destroy(); state.busyWin = null; return; }
  const html = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;background:#1b1e25;color:#e8ebf1;font:14px system-ui,sans-serif}body{display:grid;place-items:center;text-align:center}</style><div><b>${APP_NAME}</b><p id=t></p></div>`)}`;
  if (!state.busyWin) { state.busyWin = new BrowserWindow({ width: 340, height: 130, resizable: false, minimizable: false, maximizable: false, closable: false, title: APP_NAME, show: true, webPreferences: { sandbox: true } }); state.busyWin.loadURL(html); }
  const set = () => state.busyWin?.webContents.executeJavaScript(`document.getElementById("t").textContent=${JSON.stringify(text)}`).catch(() => {});
  if (state.busyWin.webContents.isLoading()) state.busyWin.webContents.once("did-finish-load", set); else set();
}
const splash = (text) => state.win?.webContents.executeJavaScript(`(document.querySelector("p")||{}).textContent=${JSON.stringify(text)}`).catch(() => {});
function makeCloud(userData, dataDir, gwDir) {
  const vault = smoke || process.env.COLLADO_PLAIN_VAULT || !safeStorage.isEncryptionAvailable() ? new PlainVault() : { seal: (s) => safeStorage.encryptString(s), open: (b) => safeStorage.decryptString(b), strong: true };
  return new CloudSync({ appName: APP_NAME, paths: { userData, dataDir, gwDir, localUser: localUser() }, defaults: cloudDefaults(), log: (...a) => console.log("[cloud]", ...a),
    io: { vault, busy: (t) => { if (!state.win || state.win.isDestroyed() || state.quitting) setBusy(t); else splash(t); },
      openUrl: (u) => { if (!/^https:\/\//.test(u)) throw new Error("bad_url"); return shell.openExternal(u); },
      confirm: async (message, buttons, detail) => smoke ? 0 : (await dialog.showMessageBox(state.win && !state.win.isDestroyed() ? state.win : undefined, { type: "question", message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true })).response,
      relaunch: () => { state.relaunched = true; if (!smoke) { app.relaunch(); app.quit(); } } } });
}
const cloudErr = (e) => ({ error: e?.code || "failed", message: e?.message && e.message !== e.code ? e.message : "" });
ipcMain.handle("collado:cloud-status", (e) => (trusted(e) && state.cloud ? state.cloud.status() : null));
ipcMain.handle("collado:cloud-connect", async (e, o) => {
  if (!trusted(e) || !state.cloud) return { error: "forbidden" };
  const names = { google: "Google Drive", microsoft: "OneDrive", folder: "una carpeta sincronizada" };
  if (!smoke) { const r = await dialog.showMessageBox(state.win, { type: "question", message: `¿Conectar ${APP_NAME} con ${names[o.provider] || "la nube"}?`, detail: o.provider === "folder" ? `Los datos de ${APP_NAME} (cifrados con tu contraseña) se copiarán en:\n${o.folder}` : `Se abrirá tu navegador para iniciar sesión. Los datos de ${APP_NAME} se subirán cifrados con tu contraseña.`, buttons: ["Conectar", "Cancelar"], defaultId: 0, cancelId: 1, noLink: true }); if (r.response !== 0) return { error: "cancelled" }; }
  try { return { ok: true, status: await state.cloud.connect(o) }; } catch (err) { return cloudErr(err); }
});
ipcMain.handle("collado:cloud-disconnect", async (e) => { if (!trusted(e) || !state.cloud) return { error: "forbidden" }; try { return { ok: true, status: await state.cloud.disconnect() }; } catch (err) { return cloudErr(err); } });
ipcMain.handle("collado:cloud-sync", async (e) => { if (!trusted(e) || !state.cloud) return { error: "forbidden" }; try { return { ok: true, status: await state.cloud.syncNow() }; } catch (err) { return { ...cloudErr(err), status: state.cloud.status() }; } });

// ---- updates: only when the person asks (menu Ayuda). Looks at the release page of the repository and opens the download in the browser ------------------------------------------------
const updateConfig = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "desktop", "update.config.json"), "utf8")); } catch { return { host: "https://gitea.solde.cat", repo: "dsoldevila/claqueta-desktop" }; } };
async function updateCheck() {
  const cfg = updateConfig(), r = await checkForUpdate({ ...cfg, current: app.getVersion(), platform: process.platform, arch: process.arch }), parent = state.win && !state.win.isDestroyed() ? state.win : undefined;
  const box = (o) => dialog.showMessageBox(parent, { noLink: true, ...o });
  if (r.status === "current") return void box({ type: "info", message: `${APP_NAME} está al día`, detail: `Tienes la versión ${r.current}, la más reciente publicada.`, buttons: ["Aceptar"] });
  if (r.status === "unreachable") { const x = await box({ type: "warning", message: "No se pudo comprobar si hay actualizaciones", detail: r.error, buttons: ["Abrir página de descargas", "Cerrar"], defaultId: 0, cancelId: 1 }); if (x.response === 0) shell.openExternal(releasesUrl(cfg)); return; }
  const l = r.latest, x = await box({ type: "info", message: `Hay una versión nueva: ${l.version}`, detail: `Tienes la ${r.current}.\n\n${l.notes || l.name}${l.asset ? `\n\nInstalador para este equipo: ${l.asset.name}` : "\n\nNo hay un instalador para este sistema en esa versión: abre la página de descargas."}`, buttons: [l.asset ? "Descargar" : "Abrir página de descargas", "Ver novedades", "Más tarde"], defaultId: 0, cancelId: 2 });
  if (x.response === 0) shell.openExternal(l.asset ? l.asset.url : l.page); else if (x.response === 1) shell.openExternal(l.page);
}

const BOUNDS = () => path.join(app.getPath("userData"), "window.json");
function createWindow() {
  let b = {}; try { b = JSON.parse(fs.readFileSync(BOUNDS(), "utf8")); } catch { /* first run */ }
  const win = new BrowserWindow({ width: b.width || 1360, height: b.height || 880, x: b.x, y: b.y, minWidth: 420, minHeight: 520, show: false, title: APP_NAME, backgroundColor: "#14161a",
    icon: fs.existsSync(path.join(ROOT, "build", "icon.png")) ? path.join(ROOT, "build", "icon.png") : undefined,
    webPreferences: { preload: path.join(ROOT, "desktop", "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true } });
  if (b.maximized) win.maximize();
  win.once("ready-to-show", () => { if (!smoke) win.show(); });
  win.on("close", () => { try { const m = win.isMaximized(); fs.writeFileSync(BOUNDS(), JSON.stringify({ ...(m ? {} : win.getBounds()), maximized: m })); } catch { /* best effort */ } });
  win.on("closed", () => { state.win = null; });
  state.win = win; return win;
}

function buildMenu() {
  const dev = !app.isPackaged;
  const t = [
    ...(isMac ? [{ label: APP_NAME, submenu: [{ role: "about", label: `Acerca de ${APP_NAME}` }, { type: "separator" }, { role: "services", label: "Servicios" }, { type: "separator" }, { role: "hide", label: `Ocultar ${APP_NAME}` }, { role: "hideOthers", label: "Ocultar otros" }, { role: "unhide", label: "Mostrar todo" }, { type: "separator" }, { role: "quit", label: `Salir de ${APP_NAME}` }] }] : []),
    { label: "Archivo", submenu: [{ label: "Abrir carpeta de datos", click: () => shell.openPath(app.getPath("userData")) }, { label: "Abrir registros", click: () => shell.openPath(state.logDir) }, { type: "separator" }, isMac ? { role: "close", label: "Cerrar ventana" } : { role: "quit", label: "Salir" }] },
    { label: "Edición", submenu: [{ role: "undo", label: "Deshacer" }, { role: "redo", label: "Rehacer" }, { type: "separator" }, { role: "cut", label: "Cortar" }, { role: "copy", label: "Copiar" }, { role: "paste", label: "Pegar" }, { role: "selectAll", label: "Seleccionar todo" }] },
    { label: "Ver", submenu: [{ role: "reload", label: "Recargar" }, { role: "forceReload", label: "Recargar sin caché" }, { type: "separator" }, { role: "resetZoom", label: "Tamaño real" }, { role: "zoomIn", label: "Acercar" }, { role: "zoomOut", label: "Alejar" }, { type: "separator" }, { role: "togglefullscreen", label: "Pantalla completa" }, ...(dev ? [{ role: "toggleDevTools" }] : [])] },
    { label: "Ayuda", submenu: [{ label: "Buscar actualizaciones…", click: () => updateCheck() }, { label: "Página de descargas", click: () => shell.openExternal(releasesUrl(updateConfig())) }, { type: "separator" }, { label: `Versión ${app.getVersion()}`, enabled: false }] },
    { label: "Ventana", submenu: [{ role: "minimize", label: "Minimizar" }, { role: "zoom", label: "Zoom" }, ...(isMac ? [{ type: "separator" }, { role: "front", label: "Traer todo al frente" }] : [{ role: "close", label: "Cerrar" }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

async function boot() {
  const userData = app.getPath("userData"), dataDir = path.join(userData, "data"), gwDir = path.join(userData, "gateway");
  state.homes = path.join(dataDir, "homes"); state.logDir = path.join(userData, "logs"); for (const d of [dataDir, gwDir, state.logDir]) fs.mkdirSync(d, { recursive: true });
  buildMenu();
  const win = createWindow();
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${APP_NAME}</title><style>html,body{height:100%;margin:0;background:#14161a;color:#e8e6e1;font:15px system-ui,sans-serif}body{display:grid;place-items:center}div{text-align:center;opacity:.85}</style><div><h2 style="font-weight:600">${APP_NAME}</h2><p>Arrancando…</p></div>`));
  win.show();

  state.cloud = makeCloud(userData, dataDir, gwDir);
  if ((await state.cloud.bootSync(splash)) === "quit") { state.quitting = true; return app.exit(0); }   // pulls what another computer pushed BEFORE any process opens the databases
  const [gwPort, agentdPort, appPort] = [await freePort(), await freePort(), await freePort()];
  const internal = rand(), nonce = rand(16), renderKey = rand();
  state.render = await startRenderService(renderKey);
  const common = { APP_DISPLAY_NAME: APP_NAME, INTERNAL_KEY: internal, DATA_DIR: dataDir, SEED_DIR: path.join(ROOT, "app-seed"), TOOLS_DIR: path.join(ROOT, "tools") };
  startChild("agentd", "gateway/agentd.mjs", { ...common, AGENTD_PORT: String(agentdPort), APP_PORT: String(appPort), RENDER_URL: state.render.url, RENDER_KEY: renderKey, MAX_CONSOLE_USERS: "2" });
  startChild("gateway", "gateway/gateway.mjs", { ...common, PORT: String(gwPort), HOST: "127.0.0.1", GW_DIR: gwDir, AGENTD_URL: `http://127.0.0.1:${agentdPort}`, APP_URL: `http://127.0.0.1:${appPort}`,
    DESKTOP_NONCE: nonce, DESKTOP_USER: localUser(), DESKTOP_NAME: (() => { try { return os.userInfo().username; } catch { return ""; } })(), COOKIE_SECURE: "0", ALLOWED_HOSTS: "127.0.0.1,localhost",
    SESSION_IDLE_H: "87600", SESSION_MAX_H: "87600", REQUIRE_2FA: "0" });
  const origin = `http://127.0.0.1:${gwPort}`;
  state.urls = { origin, login: `${origin}/_gw/desktop-login?nonce=${nonce}` };
  lockdown(session.defaultSession, new Set([origin, `http://localhost:${gwPort}`]));

  const ok = (await waitFor(`${origin}/healthz`)) && (await waitFor(`http://127.0.0.1:${appPort}/healthz`));
  if (!ok) return fatal("Los servicios locales no han arrancado a tiempo.");
  await win.loadURL(state.urls.login);
  if (smoke) {
    await sleep(3500); const here = new URL(win.webContents.getURL());
    const checks = await runChecks(win, { renderUrl: state.render.url, renderKey, outDir: path.dirname(smoke), lastOpened: () => state.lastOpened, appUrl: `http://127.0.0.1:${appPort}`, dataDir, user: localUser(), tools: path.join(ROOT, "tools") });
    await win.webContents.executeJavaScript(`location.hash = "#/app"; document.getElementById("appframe").contentWindow.location.hash = "#/"; 0`); await sleep(2000);
    fs.writeFileSync(smoke, (await win.webContents.capturePage()).toPNG());   // the dashboard
    const good = here.origin === origin && here.pathname === "/" && checks.every((c) => c.ok);
    for (const c of checks) console.log(c.ok ? "  ok  " : "  FAIL", c.name, c.ok ? "" : JSON.stringify(c));
    console.log(good ? "smoke ok" : "smoke FAILED", here.href); state.quitting = true; await stopChildren(); app.exit(good ? 0 : 1);
  }
}

app.on("second-instance", () => { const w = state.win; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });
app.on("activate", () => { if (!state.win && state.urls) { createWindow().loadURL(state.urls.login); state.win.show(); } });
app.on("window-all-closed", () => { if (!isMac) app.quit(); });
app.on("before-quit", (e) => { if (state.quitting) return; e.preventDefault(); state.quitting = true; stopChildren().then(() => state.cloud?.shutdownSync()).finally(() => { setBusy(""); app.exit(0); }); });
app.whenReady().then(boot).catch((e) => fatal(String(e?.stack || e)));
