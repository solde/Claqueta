// End-to-end checks that run inside the real window (`electron . --smoke-test=out.png`): the same requests the UI makes, against the real servers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export async function runChecks(win, { renderUrl, renderKey, outDir, lastOpened, appUrl, dataDir, user, tools }) {
  const page = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const results = [];
  const check = async (name, fn) => { try { const r = await fn(); results.push({ name, ok: r === true || (r && r.ok !== false), ...(typeof r === "object" ? r : {}) }); } catch (e) { results.push({ name, ok: false, error: String(e?.message || e) }); } };
  const md = "---\ntitle: Informe de prueba\n---\n\n[[toc]]\n\n# Informe de prueba\n\n## Resumen\n\nTexto con **negrita**, acentos áéíóú ñ y euros 1.234,50 €.\n\n| Partida | Importe |\n|---|---:|\n| Guion | 1.000 € |\n| Rodaje | 2.500 € |\n\n## Detalle\n\nOtro párrafo.\n";
  const render = (format) => page(`const r = await fetch("/app/api/docs/render", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "collado" }, body: JSON.stringify({ format: ${JSON.stringify(format)}, markdown: ${JSON.stringify(md)}, title: "Informe de prueba" }) });
    const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, size: b.length, head: Array.from(b.slice(0, 5)), b64: btoa(String.fromCharCode(...b.slice(0, 4000000))) };`);
  await check("capabilities", async () => { const c = await page(`return (await (await fetch("/app/api/docs/capabilities")).json()).tools;`); return { ok: c.pdf && c.svg_png && c.pdf_engine === "Chromium", caps: c }; });
  for (const [fmt, magic] of [["pdf", "%PDF"], ["docx", "PK"], ["html", "<!do"]]) await check(`render ${fmt}`, async () => { const r = await render(fmt); const buf = Buffer.from(r.b64, "base64"); fs.writeFileSync(path.join(outDir, `selftest.${fmt}`), buf); return { ok: r.status === 200 && buf.toString("latin1", 0, magic.length) === magic, status: r.status, size: r.size }; });
  await check("svg -> png (render service)", async () => { const r = await fetch(`${renderUrl}/svg-png?width=600`, { method: "POST", headers: { "x-render-key": renderKey }, body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="#f01e2c"/><circle cx="100" cy="50" r="30" fill="white"/></svg>' }); const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(path.join(outDir, "selftest.png"), b); return { ok: r.status === 200 && b.toString("latin1", 1, 4) === "PNG", size: b.length, w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; });
  await check("render service rejects a wrong key", async () => (await fetch(`${renderUrl}/pdf`, { method: "POST", headers: { "x-render-key": "nope" }, body: "<p>x</p>" })).status === 403);
  await check("terminal (bash/zsh) echo", () => page(`return await new Promise((res) => { const ws = new WebSocket("ws://" + location.host + "/_gw/ws/term?session=shell&cols=100&rows=30"); ws.binaryType = "arraybuffer"; let out = ""; const dec = new TextDecoder();
    const t = setTimeout(() => res({ ok: false, out: out.slice(-300) }), 12000);
    ws.onopen = () => setTimeout(() => ws.send(new TextEncoder().encode("echo collado-$((20+22))\\n")), 1500);
    ws.onmessage = (e) => { if (typeof e.data !== "string") { out += dec.decode(e.data); if (/collado-42/.test(out.replace(/echo collado-\\$\\(\\(20\\+22\\)\\)/g, ""))) { clearTimeout(t); ws.close(); res({ ok: true }); } } }; })`));
  await check("files: write, list, read, zip, trash", async () => page(`
    const H = { "x-requested-with": "collado", "content-type": "application/json" };
    let r = await fetch("/_gw/api/files/upload?path=work/prueba.txt&overwrite=1&mkdirs=1", { method: "PUT", headers: { "x-requested-with": "collado" }, body: "hola archivo" }); if (!r.ok) return { ok: false, step: "upload", status: r.status };
    r = await fetch("/_gw/api/files/list?path=work"); const l = await r.json(); if (!l.entries.some((e) => e.name === "prueba.txt")) return { ok: false, step: "list", l };
    r = await fetch("/_gw/api/files/download?path=work/prueba.txt"); if ((await r.text()) !== "hola archivo") return { ok: false, step: "read" };
    r = await fetch("/_gw/api/files/download?path=work"); const z = new Uint8Array(await r.arrayBuffer()); if (!(z[0] === 0x50 && z[1] === 0x4b)) return { ok: false, step: "zip", status: r.status, head: Array.from(z.slice(0, 4)) };
    r = await fetch("/_gw/api/files/trash", { method: "POST", headers: H, body: JSON.stringify({ paths: ["work/prueba.txt"] }) }); return { ok: r.ok, step: "trash" };`));
  await check("offline: external request is blocked", () => page(`try { await fetch("https://example.com/", { mode: "no-cors" }); return { ok: false, note: "reached the network" }; } catch { return { ok: true }; }`));
  await check("service status reports the app healthy", async () => page(`return { ok: (await (await fetch("/_gw/api/service/status")).json()).app.healthy === true };`));
  const projectDir = fs.mkdtempSync(path.join(outDir, "project-")); fs.writeFileSync(path.join(projectDir, "informe.txt"), "contenido del proyecto"); fs.mkdirSync(path.join(projectDir, "guiones"));
  let linkPath = "";
  await check("project folder: saved on the programme, linked into the workspace, listed and readable by the file manager", () => page(`
    const H = { "content-type": "application/json", "x-requested-with": "collado" };
    let r = await fetch("/app/api/e/programs", { method: "POST", headers: H, body: JSON.stringify({ name: "Proyecto con carpeta", folder: ${JSON.stringify(projectDir)} }) }); const pr = await r.json(); if (!r.ok) return { ok: false, step: "create", status: r.status, pr };
    const id = pr.row?.id ?? pr.id, got = await (await fetch("/app/api/e/programs/" + id)).json(); if ((got.row || got).folder !== ${JSON.stringify(projectDir)}) return { ok: false, step: "folder not saved", got };
    const name = projectLinkName({ id, name: "Proyecto con carpeta" });
    r = await fetch("/_gw/api/files/link", { method: "POST", headers: H, body: JSON.stringify({ name, target: ${JSON.stringify(projectDir)} }) }); const lk = await r.json(); if (!r.ok) return { ok: false, step: "link", lk };
    const again = await (await fetch("/_gw/api/files/link", { method: "POST", headers: H, body: JSON.stringify({ name, target: ${JSON.stringify(projectDir)} }) })).json(); if (again.path !== lk.path) return { ok: false, step: "link not idempotent" };
    const l = await (await fetch("/_gw/api/files/list?path=" + encodeURIComponent(lk.path))).json(); if (!l.entries?.some((e) => e.name === "informe.txt") || !l.entries.some((e) => e.name === "guiones" && e.type === "dir")) return { ok: false, step: "list", l };
    const txt = await (await fetch("/_gw/api/files/download?path=" + encodeURIComponent(lk.path + "/informe.txt"))).text(); if (txt !== "contenido del proyecto") return { ok: false, step: "read", txt };
    const bad = await fetch("/_gw/api/files/link", { method: "POST", headers: H, body: JSON.stringify({ name: "../x", target: ${JSON.stringify(projectDir)} }) }); const bad2 = await fetch("/_gw/api/files/link", { method: "POST", headers: H, body: JSON.stringify({ name: "ok", target: "relativa/ruta" }) });
    return { ok: bad.status === 400 && bad2.status === 400, linkPath: lk.path, id };`).then((r) => { linkPath = r.linkPath || ""; return r; }));
  await check("project CLAUDE.md: the programme's own folder got the project rules, with the toolbox check for THIS programme", async () => {
    const f = path.join(projectDir, "CLAUDE.md"); if (!fs.existsSync(f)) return { ok: false, step: "not written" }; const body = fs.readFileSync(f, "utf8");
    const id = /#\/p\/(\d+)/.exec(body)?.[1];
    return { ok: /# Proyecto: Proyecto con carpeta/.test(body) && /collado-doc check --program \d+/.test(body) && body.includes(projectDir) && body.includes("Claqueta") && !body.includes("{{") && !!id, id, size: body.length };
  });
  await check("collado-doc check: runs against the live app (as the agent would) and reports this machine's toolbox", async () => {
    const id = /#\/p\/(\d+)/.exec(fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8"))?.[1], token = path.join(dataDir, "homes", user, ".collado", "token");
    const r = spawnSync(process.execPath, [path.join(tools, "collado-doc.mjs"), "check", "--json", "--program", id], { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", COLLADO_API: appUrl, COLLADO_TOKEN_FILE: token }, timeout: 60000 });
    let j; try { j = JSON.parse(r.stdout); } catch { return { ok: false, status: r.status, out: (r.stdout + r.stderr).slice(0, 300) }; }
    const by = Object.fromEntries(j.results.map((x) => [x.id, x]));
    return { ok: j.platform === process.platform && by.pdf?.ok && /Chromium/.test(by.pdf.detail) && by.folder?.ok && by.folder.detail === projectDir && ["preview", "office", "python", "pymods"].every((k) => by[k] && typeof by[k].ok === "boolean" && (by[k].ok || /\S/.test(by[k].install))) && typeof j.max_quality === "boolean", exit: r.status, missing: j.missing_recommended };
  });
  await check("agent environment: the shell session has the workspace variables and its own Claude config dir, with the real HOME", () => page(String.raw`return await new Promise((res) => { const ws = new WebSocket("ws://" + location.host + "/_gw/ws/term?session=shell&cols=200&rows=30"); ws.binaryType = "arraybuffer"; let out = ""; const dec = new TextDecoder(), ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
    const clean = (x) => x.split(ESC + "]").map((part, i) => (i ? part.slice(part.indexOf(BEL) + 1) : part)).join("").replace(new RegExp(ESC + "\\[[0-9;?]*[ -/]*[@-~]", "g"), "").replace(/\r/g, "");
    const t = setTimeout(() => res({ ok: false, out: clean(out).slice(-300) }), 15000); ws.onopen = () => setTimeout(() => ws.send(new TextEncoder().encode('echo "@@W=$COLLADO_WORK|C=$CLAUDE_CONFIG_DIR|H=$HOME@@"' + String.fromCharCode(10))), 2500);
    ws.onmessage = (e) => { if (typeof e.data !== "string") { out += dec.decode(e.data); const all = [...clean(out).matchAll(/@@W=([^|]*)\|C=([^|]*)\|H=(.*?)@@/g)].filter((m) => !m[0].includes("$")); if (all.length) { clearTimeout(t); ws.close(); const m = all[all.length - 1]; res({ ok: true, w: m[1], c: m[2], h: m[3] }); } } }; })`).then((r) => ({ ...r, ok: r.ok && r.w === path.join(dataDir, "homes", user, "work") && r.c === path.join(dataDir, "homes", user, ".claude") && r.h === os.homedir() })));
  await check("file manager: double click opens the file with the system (path reaches the main process); Space still previews; the page cannot open files outside its workspace", async () => {
    const r = await page(`
      const bridge = window.colladoDesktop; if (!bridge) return { ok: false, step: "no bridge" };
      const outside = await bridge.openPath("/etc/hosts"), rel = await bridge.openPath("informe.txt"), nope = await bridge.openPath(${JSON.stringify(path.join(outDir, "x"))});
      location.hash = "#/files"; await new Promise((r) => setTimeout(r, 1200)); FM.goto(${JSON.stringify(linkPath)}); await new Promise((r) => setTimeout(r, 1500));
      const side = [...document.querySelectorAll("#pane-files .fm-side .fm-loc")].map((b) => b.textContent.trim());
      const item = [...document.querySelectorAll("#pane-files .fm-item")].find((i) => i.dataset.name === "informe.txt"); if (!item) return { ok: false, step: "no item", side, crumbs: document.querySelector(".fm-crumbs")?.innerText };
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); await new Promise((r) => setTimeout(r, 800));
      return { ok: outside.error === "outside_workspace" && rel.error === "invalid_path" && nope.error === "outside_workspace", outside, rel, side };`);
    const opened = lastOpened(); const good = r.ok && /Proyectos[\\/].*[\\/]informe\.txt$/.test(opened) && r.side.some((x) => /Proyecto con carpeta/.test(x));
    return { ok: good, opened, ...r };
  });
  await check("programme form: the local-folder field offers the native picker", () => page(`
    const f = document.getElementById("appframe"); location.hash = "#/app"; await new Promise((r) => setTimeout(r, 600)); const d = f.contentDocument; f.contentWindow.location.hash = "#/programs"; await new Promise((r) => setTimeout(r, 1500));
    [...d.querySelectorAll("button, a")].find((b) => /Nuevo programa/i.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 1500));
    const btn = [...d.querySelectorAll("button")].find((b) => /Elegir carpeta/.test(b.textContent)), label = [...d.querySelectorAll("label")].some((l) => /Carpeta local/.test(l.textContent));
    d.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); [...d.querySelectorAll(".nb-close")].forEach((b) => b.click()); f.contentWindow.location.hash = "#/"; await new Promise((r) => setTimeout(r, 500));
    return { ok: !!btn && label, button: !!btn, label };`));
  const cloudDir = path.join(outDir, "cloud-" + process.pid);
  await check("cloud sync: connect a synced folder, push the whole workspace encrypted, refuse bad input, disconnect", async () => {
    const r = await page(`
      const c = window.colladoDesktop.cloud, st0 = await c.status(); if (st0.connected || !st0.configured.folder) return { ok: false, step: "initial", st0 };
      const weak = await c.connect({ provider: "folder", folder: ${JSON.stringify(cloudDir)}, passphrase: "corta" }), rel = await c.connect({ provider: "folder", folder: "relativa", passphrase: "contraseña de prueba" }), noid = await c.connect({ provider: "google", passphrase: "contraseña de prueba" });
      const ok = await c.connect({ provider: "folder", folder: ${JSON.stringify(cloudDir)}, passphrase: "contraseña de prueba" }); if (!ok.ok) return { ok: false, step: "connect", ok };
      const sync = await c.syncNow(); const st = await c.status(); const again = await c.connect({ provider: "folder", folder: ${JSON.stringify(cloudDir)}, passphrase: "contraseña de prueba" });
      return { ok: weak.error === "weak_passphrase" && rel.error === "bad_folder" && noid.error === "no_client_id" && sync.ok && st.connected && st.lastSyncAt > 0 && st.state === "idle" && again.error === "already_connected" && !JSON.stringify(st).includes("master"), weak: weak.error, rel: rel.error, noid: noid.error, state: st.state, again: again.error };`);
    const files = fs.existsSync(cloudDir) ? fs.readdirSync(cloudDir) : [], blobs = files.filter((f) => f !== "config.json").map((f) => fs.readFileSync(path.join(cloudDir, f)));
    const leaks = blobs.some((b) => b.includes("Proyecto con carpeta") || b.includes("informe") || b.includes("SQLite format"));
    return { ...r, ok: r.ok && files.includes("manifest.bin") && files.includes("config.json") && files.filter((f) => f.startsWith("o-")).length >= 3 && !leaks, files: files.length, leaks };
  });
  const shot = async (name) => { await new Promise((r) => setTimeout(r, 700)); fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG()); };
  await check("cloud sync: the settings dialog shows the connected state and can disconnect", async () => {
    await page(`document.getElementById("menu").click(); await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll("#menupop button")].find((b) => /Nube y sincronización/.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 900)); 0`);
    await shot("cloud-connected.png");
    const r = await page(`
      const title = document.getElementById("mtitle").textContent, text = document.getElementById("mbody").innerText;
      const showsState = /Carpeta sincronizada/.test(text) && /Sincronizado|Sincronizando/.test(text) && /Desconectar/.test(text) && /Sincronizar ahora/.test(text);
      window.confirm = () => true; [...document.querySelectorAll("#mbody button")].find((b) => /Desconectar/.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 1200));
      const form = document.getElementById("mbody").innerText, sel = document.getElementById("cp"), opts = sel ? [...sel.options].map((o) => o.textContent) : [];
      const st = await window.colladoDesktop.cloud.status(); return { title, showsState, connected: st.connected, opts, hasPass: /Contraseña de sincronización/.test(form) };`);
    await shot("cloud-connect.png"); await page(`modal.close(null); 0`);
    return { ok: /Nube y sincronización/.test(r.title) && r.showsState && !r.connected && r.opts.length === 3 && r.hasPass, ...r };
  });
  await check("app name: the desktop build calls itself Claqueta in the window, the top bar, the tour and the cloud dialog", async () => {
    const r = await page(`
      const f = document.getElementById("appframe").contentDocument, me = await (await fetch("/_gw/api/me")).json();
      document.getElementById("tour-btn").click(); await new Promise((r) => setTimeout(r, 500)); const tour = document.querySelector(".tour-card")?.innerText || ""; document.getElementById("tour-btn").click();
      return { title: document.title, brand: document.querySelector(".brandtxt").textContent, appTitle: f.title, appName: me.appName, tour: tour.slice(0, 60), aria: document.querySelector(".brand").getAttribute("aria-label") };`);
    const { BrowserWindow } = await import("electron"); const winTitle = BrowserWindow.getAllWindows().map((w) => w.getTitle());
    return { ok: r.title === "Claqueta" && r.brand === "Claqueta" && r.aria === "Claqueta" && r.appTitle === "Claqueta" && r.appName === "Claqueta" && /Recorrido por Claqueta/.test(r.tour), ...r, winTitle };
  });
  await check("file manager wording: Importar / Exportar (not Subir / Descargar) in the toolbar and the context menu", () => page(`
    location.hash = "#/files"; await new Promise((r) => setTimeout(r, 1200)); const bar = document.querySelector("#pane-files .fm-actions").innerText;
    const empty = document.querySelector("#pane-files .fm-content"); empty.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 200, clientY: 300 })); await new Promise((r) => setTimeout(r, 300));
    const menu = document.querySelector("#pane-files .fm-menu")?.innerText || ""; document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.querySelector("#pane-files").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { ok: /Importar/.test(bar) && /Exportar/.test(bar) && !/Subir|Descargar/.test(bar) && /Importar archivos/.test(menu) && !/Subir/.test(menu), bar: bar.replace(/\s+/g, " "), menu: menu.replace(/\s+/g, " ").slice(0, 120) };`));
  await check("projects: the folder is required and unique at creation, can be changed in the programme page, and the page shows it", async () => {
    const second = path.join(outDir, "project2-" + process.pid), moved = path.join(outDir, "project2-moved-" + process.pid);
    const r = await page(`
      const H = { "content-type": "application/json", "x-requested-with": "collado" }, post = (b) => fetch("/app/api/e/programs", { method: "POST", headers: H, body: JSON.stringify(b) });
      const none = await post({ name: "Sin carpeta" }), dup = await post({ name: "Duplicada", folder: ${JSON.stringify(projectDir)} }), inner = await post({ name: "Anidada", folder: ${JSON.stringify(projectDir)} + "/sub" }), rel = await post({ name: "Rel", folder: "a/b" });
      const ok = await post({ name: "Segundo", folder: ${JSON.stringify(second)} }), pr = await ok.json(); const upd = await fetch("/app/api/e/programs/" + pr.id, { method: "PATCH", headers: H, body: JSON.stringify({ folder: ${JSON.stringify(moved)}, rev: pr.rev }) }), u = await upd.json();
      const empty = await fetch("/app/api/e/programs/" + pr.id, { method: "PATCH", headers: H, body: JSON.stringify({ folder: "", rev: u.rev }) });
      const f = document.getElementById("appframe"); location.hash = "#/app"; await new Promise((r) => setTimeout(r, 500)); f.contentWindow.location.hash = "#/p/" + pr.id; await new Promise((r) => setTimeout(r, 2200));
      const txt = f.contentDocument.body.innerText; f.contentWindow.location.hash = "#/"; await new Promise((r) => setTimeout(r, 400));
      return { none: [none.status, (await none.json()).error], dup: (await dup.json()).error, inner: (await inner.json()).error, rel: (await rel.json()).error, changed: u.folder, empty: empty.status, card: /Cambiar carpeta/.test(txt) && txt.includes(${JSON.stringify(moved)}) };`);
    return { ok: r.none[0] === 400 && /^required/.test(r.none[1]) && /^folder_in_use/.test(r.dup) && /^folder_overlaps/.test(r.inner) && r.rel === "folder_not_absolute" && r.changed === moved && r.empty === 400 && r.card && fs.existsSync(second) && fs.existsSync(moved), ...r };
  });
  await check("claude login (automatic): the endpoints exist, report idle and not logged in for a fresh workspace", () => page(`const s = await (await fetch("/_gw/api/agent/login/status")).json(); return { ok: s.state === "idle" && s.logged_in === false, s };`));
  await check("claude login status: a fresh workspace is NOT logged in, even when the user is logged in elsewhere on this Mac (own config dir, real HOME)", () => page(`const r = await (await fetch("/_gw/api/agent/login-status")).json(); return { ok: r.logged_in === false, r };`));
  await check("claude login helper: a link that Claude Code hard-wraps over several rows is read back whole", () => page(String.raw`
    const U = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference&code_challenge=u6bEdLRQic--1rC&code_challenge_method=S256&state=boBAe37wXB0lZkrVeKuir0yahCEgTgRwi0gUlPCQnoQ";
    const NL = String.fromCharCode(10), cols = 120, rows = []; for (let i = 0; i < U.length; i += cols) rows.push(U.slice(i, i + cols));
    const screen = ["Browser did not open? Use the url below to sign in (c to copy)", ...rows, "", "Paste code here if prompted >"].join(NL);
    const one = Tutor.unwrapLinks(screen, cols).match(/https:\/\/\S+/)[0], other = Tutor.unwrapLinks("see https://claude.ai/x" + NL + "next line here", 20);
    return { ok: one === U && other.includes(NL + "next line here"), same: one === U, len: one.length };`));
  await check("Neumorphism skin is on in the shell and in the app frame", () => page(`
    const f = document.getElementById("appframe"), fd = f.contentDocument, sheets = (d) => [...d.styleSheets].some((x) => /neu\\.css/.test(x.href || ""));
    const surf = (d) => getComputedStyle(d.documentElement).getPropertyValue("--nb-radius").trim();
    return { ok: document.documentElement.dataset.skin === "neu" && fd.documentElement.dataset.skin === "neu" && sheets(document) && sheets(fd) && surf(document) === "14px" && surf(fd) === "14px", shell: document.documentElement.dataset.skin, frame: fd.documentElement.dataset.skin };`));
  await check("single-person UI: tabs are Proyectos/Archivos/Log/Organizaciones, no user administration", () => page(`
    const tabs = [...document.querySelectorAll("#tabs a")].map((a) => a.textContent.trim());
    location.hash = "#/service"; await new Promise((r) => setTimeout(r, 1800));
    const logPane = document.getElementById("pane-service").innerText, buttons = [...document.querySelectorAll("#pane-service button")].map((b) => b.textContent.trim());
    location.hash = "#/orgs"; await new Promise((r) => setTimeout(r, 1000)); const orgs = document.getElementById("pane-orgs").innerText;
    location.hash = "#/admin"; await new Promise((r) => setTimeout(r, 600)); const viaUrl = location.hash, adminShown = !document.getElementById("pane-admin").hidden || document.getElementById("pane-admin").childElementCount > 0;
    location.hash = "#/service"; await new Promise((r) => setTimeout(r, 800));
    const ok = JSON.stringify(tabs) === JSON.stringify(["Proyectos", "Archivos", "Log", "Organizaciones"]) && /^log/i.test(logPane) && !/servicio|git/i.test(logPane) && buttons.length === 1 && buttons[0] === "Reiniciar la app" && !/Usuarios/.test(orgs) && !adminShown;
    const menuBtn = document.getElementById("menu"); menuBtn.click(); await new Promise((r) => setTimeout(r, 300));
    const items = [...document.querySelectorAll("#menupop button")].map((b) => b.textContent.trim()), pop = document.getElementById("menupop").innerText; menuBtn.click();
    const menuOk = menuBtn.textContent.trim() === "⚙ Configuración" && !/false|undefined|null/.test(pop) && !pop.includes(${JSON.stringify(process.env.USER || "usuario")}) && !items.some((i) => /contraseña|dos pasos|Cerrar sesión/.test(i)) && items.some((i) => /Idioma|Castellano/.test(i)) && items.some((i) => /tema/i.test(i)) && items.some((i) => /Recorrido/.test(i));
    return { ok: ok && menuOk, tabs, buttons, viaUrl, adminShown, menu: menuBtn.textContent.trim(), items };`));
  return results;
}
