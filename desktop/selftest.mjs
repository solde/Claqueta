// End-to-end checks that run inside the real window (`electron . --smoke-test=out.png`): the same requests the UI makes, against the real servers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";

/** The in-window self test run by `npm run desktop:smoke`: real checks of the whole stack inside the Electron window (login, files, render service, sync, memoirs, CLI tools...), each reported as ok or FAIL with its details. */
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
  await check("svg -> png: brand graphics", async () => { const out = {}; for (const k of ["kpi", "quote", "divider", "cover", "chart", "org"]) { const f = path.join(outDir, `g-${k}.svg`); if (!fs.existsSync(f)) continue; const r = await fetch(`${renderUrl}/svg-png?width=1200`, { method: "POST", headers: { "x-render-key": renderKey }, body: fs.readFileSync(f) }); out[k] = r.status === 200 ? (await r.arrayBuffer()).byteLength : (await r.text()).slice(0, 200); } const viaApp = await page(`const J = { "content-type": "application/json", "x-requested-with": "collado" }; const r = await fetch("/app/api/graphics/render", { method: "POST", headers: J, body: JSON.stringify({ spec: { type: "kpi_bars", title: "Metas", items: [{ label: "Capítulos", target: 3, achieved: 3 }, { label: "Audiencia", target: 100, achieved: 80, unit: "k" }] }, png: true }) }); const j = await r.json(); return { status: r.status, png: (j.png_base64 || "").length, w: j.width, err: j.error };`); return { ok: Object.values(out).every((v) => typeof v === "number" && v > 2000) && viaApp.png > 1000, out, viaApp }; });
  await check("collado-doc check: runs against the live app (as the agent would) and reports this machine's toolbox", async () => {
    const id = /#\/p\/(\d+)/.exec(fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8"))?.[1], token = path.join(dataDir, "homes", user, ".collado", "token");
    const r = spawnSync(process.execPath, [path.join(tools, "collado-doc.mjs"), "check", "--json", "--program", id], { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", COLLADO_API: appUrl, COLLADO_TOKEN_FILE: token }, timeout: 60000 });
    let j; try { j = JSON.parse(r.stdout); } catch { return { ok: false, status: r.status, out: (r.stdout + r.stderr).slice(0, 300) }; }
    const by = Object.fromEntries(j.results.map((x) => [x.id, x]));
    return { ok: j.platform === process.platform && by.pdf?.ok && /Chromium/.test(by.pdf.detail) && by.folder?.ok && by.folder.detail === projectDir && ["preview", "office", "python", "pymods"].every((k) => by[k] && typeof by[k].ok === "boolean" && (by[k].ok || /\S/.test(by[k].install))) && typeof j.max_quality === "boolean", exit: r.status, missing: j.missing_recommended };
  });
  await check("collado-doc memoir/media/graphic: the agent's commands work against the live app (create, write sections, graphics to the gallery, images, assemble)", async () => {
    const id = /#\/p\/(\d+)/.exec(fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8"))?.[1], token = path.join(dataDir, "homes", user, ".collado", "token"), env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", COLLADO_API: appUrl, COLLADO_TOKEN_FILE: token };
    // asynchronous on purpose: this process also hosts the render service the command calls (a blocking spawn would starve it)
     const cli = (...a) => new Promise((res) => { const c = spawn(process.execPath, [path.join(tools, "collado-doc.mjs"), ...a], { env, cwd: outDir }); let stdout = "", stderr = ""; c.stdout.on("data", (d) => { stdout += d; }); c.stderr.on("data", (d) => { stderr += d; }); const t = setTimeout(() => c.kill(), 60000); c.on("close", (status) => { clearTimeout(t); res({ status, stdout, stderr, out: stdout + stderr }); }); });
    const made =  await cli("memoir", "new", "--program", id, "--kind", "client", "--title", "Informe CLI", "--funder", "Canal Demo"); let memo; try { memo = JSON.parse(made.stdout); } catch { return { ok: false, step: "new", out: made.out.slice(0, 300) }; }
    fs.writeFileSync(path.join(outDir, "sec.md"), "El proyecto entregó **tres** capítulos. ".repeat(30)); fs.writeFileSync(path.join(outDir, "campos.json"), JSON.stringify({ one_liner: "Tres capítulos entregados", highlights: [{ text: "A tiempo" }] }));
    const w =  await cli("memoir", "write", String(memo.id), "exec_summary", path.join(outDir, "sec.md"), "--fields", path.join(outDir, "campos.json")), show =  await cli("memoir", "show", String(memo.id));
    fs.writeFileSync(path.join(outDir, "g.json"), JSON.stringify({ type: "kpi_bars", title: "Metas", items: [{ label: "Capítulos", target: 3, achieved: 3 }, { label: "Audiencia", target: 100, achieved: 80, unit: "k" }] }));
    const g =  await cli("graphic", "render", path.join(outDir, "g.json"), "-o", path.join(outDir, "g.png")), gs =  await cli("graphic", "save", path.join(outDir, "g.json"), "--program", id, "--title", "Metas CLI", "--caption", "Metas y logros");
    const ml =  await cli("media", "list", "--program", id), types =  await cli("graphic", "types"), cat =  await cli("memoir", "catalog");
    const ma = await cli("media", "add", path.join(outDir, "g.png"), "--program", id, "--title", "Gráfico CLI", "--caption", "Subida desde la consola", "--credit", "Agente", "--kind", "graphic"), mset = await cli("media", "set", String((JSON.parse(ma.stdout || "{}")).media_id || 0), "--caption", "Pie editado", "--featured", "1"), ml2 = await cli("media", "list", "--program", id);
    const built =  await cli("memoir", "build", String(memo.id)), png = fs.existsSync(path.join(outDir, "g.png")) ? fs.readFileSync(path.join(outDir, "g.png")) : Buffer.alloc(0);
    return { ok: w.status === 0 && /exec_summary/.test(w.stdout) && /exec_summary\s+draft\s+100/.test(show.stdout) && /DATOS REALES/.test(show.stdout) && g.status === 0 && png.length > 3000 && png[0] === 0x89 && gs.status === 0 && /Metas CLI/.test(ml.stdout) && /kpi_bars/.test(types.stdout) && /exec_summary/.test(cat.stdout) && ma.status === 0 && mset.status === 0 && /Pie editado/.test(ml2.stdout) && built.status === 0 && /document_id/.test(built.stdout), w: w.out.slice(0, 160), show: show.stdout.slice(0, 200), g: g.out.slice(0, 160), built: built.out.slice(0, 160), png: png.length };
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
  await check("audience forecast: the section opens for a programme with measurements and shows a forecast, the next audience and the what-if", async () => {
    const r = await page(`
      try {
      const H = { "content-type": "application/json", "x-requested-with": "collado" }, post = async (e, b) => (await fetch("/app/api/e/" + e, { method: "POST", headers: H, body: JSON.stringify(b) })).json();
      const pr = await post("programs", { name: "Predicción", folder: ${JSON.stringify(path.join(outDir, "prediccion"))} }), day = (i) => new Date(Date.UTC(2026, 0, 5 + 7 * i)).toISOString().slice(0, 10);
      for (let i = 0; i < 9; i++) { const b = await post("broadcasts", { program_id: pr.id, date: day(i), start_time: "22:00", kind: i % 3 ? "premiere" : "repeat", status: "aired" }); await post("ratings", { program_id: pr.id, broadcast_id: b.id, date: day(i), audience_avg: 1500 - i * 55 + (i % 2) * 70, share_pct: 10 - i * 0.3, target_label: "Total individuos" }); }
      const f = document.getElementById("appframe"); location.hash = "#/app"; await new Promise((r) => setTimeout(r, 500)); f.contentWindow.location.hash = "#/forecast?program=" + pr.id; await new Promise((r) => setTimeout(r, 2500));
      const d = f.contentDocument, txt = d.body.innerText, svgs = d.querySelectorAll("svg.chart").length, bands = d.querySelectorAll(".fc-band").length;
      return { ok: /Predicción de audiencias/.test(txt) && /Simular una emisión/.test(txt) && svgs === 2 && bands === 2 && !/NaN|undefined|\\[object/.test(txt), svgs, bands, head: txt.slice(0, 160) };
      } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }`);
    await shot("forecast.png"); await page(`document.getElementById("appframe").contentWindow.location.hash = "#/"; 0`); return r;
  });
  await check("memoirs: gallery with uploaded and generated images, a memoir edited section by section, assembled into a document, all pages render", async () => {
    const r = await page(`
      try {
      const J = { "content-type": "application/json", "x-requested-with": "collado" }, post = async (e, b) => (await fetch("/app/api/e/" + e, { method: "POST", headers: J, body: JSON.stringify(b) })).json(), act = async (n, b) => (await fetch("/app/api/actions/" + n, { method: "POST", headers: J, body: JSON.stringify(b) })).json();
      const png = (color, label) => new Promise((res) => { const c = document.createElement("canvas"); c.width = 1200; c.height = 800; const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 1200, 800); g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.arc(850, 300, 190, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "700 90px sans-serif"; g.fillText(label, 70, 700); c.toBlob(res, "image/png"); });
      const pr = await post("programs", { name: "Memoria de prueba", folder: ${JSON.stringify(path.join(outDir, "memoria"))}, genre: "Magazine", logline: "Un magazine de cultura" }), day = (i) => new Date(Date.UTC(2026, 2, 2 + 7 * i)).toISOString().slice(0, 10);
      for (let i = 0; i < 4; i++) { const e = await post("episodes", { program_id: pr.id, number: i + 1, title: "Capítulo " + (i + 1), duration_target: 3000, shoot_date: day(i), air_date: day(i + 2), status: "delivered" }); const b = await post("broadcasts", { program_id: pr.id, episode_id: e.id, date: day(i + 2), start_time: "22:00", kind: "premiere", status: "aired" }); await post("ratings", { program_id: pr.id, broadcast_id: b.id, date: day(i + 2), audience_avg: 900 + i * 40, share_pct: 8 + i * 0.4, target_label: "Total" }); }
      await post("locations", { program_id: pr.id, name: "Plató 1", city: "Barcelona", country: "España", lat: 41.39, lng: 2.17, shoot_days: 5 }); await post("locations", { program_id: pr.id, name: "Playa de Sitges", city: "Sitges", country: "España", lat: 41.23, lng: 1.81, shoot_days: 2 });
      const up = [["#1f3a5f", "Plató"], ["#2f9e73", "Equipo"], ["#d1495b", "Final"]];
      for (const [i, [col, lab]] of up.entries()) { const blob = await png(col, lab); await fetch("/app/api/media?program=" + pr.id + "&name=" + lab + ".png&caption=" + encodeURIComponent("Imagen de " + lab) + "&credit=Ana%20Ruiz&kind=" + (i ? "behind_scenes" : "photo") + "&featured=" + (i === 0 ? 1 : 0), { method: "POST", headers: { "x-requested-with": "collado" }, body: blob }); }
      const gen = await (await fetch("/app/api/graphics/save", { method: "POST", headers: J, body: JSON.stringify({ program_id: pr.id, title: "El programa en cifras", caption: "Cifras clave", spec: { type: "stats", auto: 1, program: pr.id, title: "El programa en cifras" } }) })).json();
      const memo = await act("memoir-create", { program_id: pr.id, kind: "subsidy", funder: "Departament de Cultura", funder_ref: "EXP-2026-14" });
      await act("memoir-section", { memoir_id: memo.id, key: "exec_summary", body: "El magazine produjo **cuatro capítulos** de 50 minutos, rodados en dos localizaciones y emitidos en prime time con una cuota media del 8,6 %.", fields: { one_liner: "Cuatro capítulos de cultura emitidos en prime time", highlights: [{ text: "Cuatro capítulos entregados" }, { text: "Cuota media del 8,6 %" }] } });
      await act("memoir-section", { memoir_id: memo.id, key: "objectives", fields: { objectives: [{ objective: "Entregar 4 capítulos", indicator: "Capítulos", target: 4, achieved: 4, unit: "ud" }, { objective: "Audiencia media", indicator: "Miles", target: 1000, achieved: 960, unit: "k" }] } });
      const rows = (await (await fetch("/app/api/e/media_items?f.program_id=" + pr.id + "&limit=20&refs=0", { headers: { "x-requested-with": "collado" } })).json()).rows;
      await act("memoir-section", { memoir_id: memo.id, key: "gallery", media_ids: rows.map((x) => x.id).slice(0, 4), fields: { layout: "mosaic" } });
      const built = await act("memoir-build", { memoir_id: memo.id });
      const f = document.getElementById("appframe"); location.hash = "#/app"; await new Promise((r) => setTimeout(r, 500));
      const visit = async (h, ms) => { f.contentWindow.location.hash = h; await new Promise((r) => setTimeout(r, ms || 2500)); return f.contentDocument.body.innerText; };
      const gal = await visit("#/gallery?program=" + pr.id), galImgs = f.contentDocument.querySelectorAll(".gal__item img").length;
      window.__shots = { gallery: true }; 
      return { ok: true, ids: { program: pr.id, memo: memo.id, doc: built.document_id }, galOk: /Galería/.test(gal), galImgs, gen: gen.id, built };
      } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }`);
    if (!r.ok) return r;
    await shot("gallery.png");
    const nav = (hash, ms = 2800) => page(`const f = document.getElementById("appframe"); f.contentWindow.location.hash = ${JSON.stringify(hash)}; await new Promise((r) => setTimeout(r, ${ms})); const d = f.contentDocument; return { text: d.body.innerText, imgs: d.querySelectorAll("img").length, loaded: [...d.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 0).length };`);
    const memo = await nav("#/memoir/" + r.ids.memo); await shot("memoir.png");
    await page(`const f = document.getElementById("appframe"); [...f.contentDocument.querySelectorAll(".memoir__link")].find((b) => /Objetivos/.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 1500)); 0`); await shot("memoir-objectives.png");
    const docp = await nav("#/doc/" + r.ids.doc, 3500); await shot("memoir-doc.png");
    const list = await nav("#/memoirs?program=" + r.ids.program); await shot("memoirs.png");
    await page(`const f = document.getElementById("appframe"); f.contentWindow.location.hash = "#/gallery?program=${r.ids.program}"; await new Promise((r) => setTimeout(r, 1500)); [...f.contentDocument.querySelectorAll("button")].find((b) => /Crear gráfico/.test(b.textContent))?.click(); await new Promise((r) => setTimeout(r, 2500)); 0`); await shot("graphic-dialog.png");
    await page(`const f = document.getElementById("appframe"); f.contentDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); [...f.contentDocument.querySelectorAll(".nb-close")].forEach((b) => b.click()); f.contentWindow.location.hash = "#/"; 0`);
    const rend = await page(`const J = { "content-type": "application/json", "x-requested-with": "collado" }; const h = await (await fetch("/app/api/docs/render", { method: "POST", headers: J, body: JSON.stringify({ document_id: ${r.ids.doc}, format: "html" }) })).text(); const p = await fetch("/app/api/docs/render", { method: "POST", headers: J, body: JSON.stringify({ document_id: ${r.ids.doc}, format: "pdf" }) }); const pdf = p.ok ? (await p.arrayBuffer()).byteLength : -1; const d = await fetch("/app/api/docs/render", { method: "POST", headers: J, body: JSON.stringify({ document_id: ${r.ids.doc}, format: "docx" }) }); const hs = await (await fetch("/app/api/docs/render", { method: "POST", headers: J, body: JSON.stringify({ document_id: ${r.ids.doc}, format: "html", screen: true }) })).text(); return { screenHtml: hs, html: h.length, gallery: /class="gallery/.test(h), chart: /<figure class="chart"><svg/.test(h), funder: h.includes("Departament de Cultura"), caption: h.includes("Imagen de Plató"), pdf, docx: d.ok ? (await d.arrayBuffer()).byteLength : -1, htmlText: h };`);
    fs.writeFileSync(path.join(outDir, "memoria.html"), rend.htmlText); fs.writeFileSync(path.join(outDir, "memoria-screen.html"), rend.screenHtml);
    { const { BrowserWindow } = await import("electron"); const w = new BrowserWindow({ show: false, width: 1000, height: 1000, webPreferences: { offscreen: false } }); await w.loadFile(path.join(outDir, "memoria-screen.html")); await new Promise((res) => setTimeout(res, 800)); const total = await w.webContents.executeJavaScript("document.documentElement.scrollHeight"); for (let i = 0; i * 1000 < Math.min(total, 9000); i++) { await w.webContents.executeJavaScript(`window.scrollTo(0, ${i * 1000})`); await new Promise((res) => setTimeout(res, 250)); fs.writeFileSync(path.join(outDir, `memoria-${i}.png`), (await w.webContents.capturePage()).toPNG()); } w.destroy(); }
    const bad = /NaN|undefined|\[object/;
    return { ok: r.galImgs === 4 && r.galOk && /Resumen ejecutivo/.test(memo.text) && /Objetivos/.test(memo.text) && !bad.test(memo.text) && /Memoria de prueba|Justificación/.test(list.text) && Object.assign(globalThis, { __rend: { gallery: rend.gallery, chart: rend.chart, funder: rend.funder, caption: rend.caption } }) && rend.gallery && rend.chart && rend.funder && rend.caption && rend.pdf > 20000 && rend.docx > 8000 && !bad.test(rend.htmlText.replace(/data:image[^"]*/g, "")), galImgs: r.galImgs, render: { html: rend.html, pdf: rend.pdf, docx: rend.docx, gallery: rend.gallery, chart: rend.chart, funder: rend.funder, caption: rend.caption }, built: r.built };
  });
  await check("claude login (automatic): the endpoints exist, report idle and not logged in for a fresh workspace", () => page(`const s = await (await fetch("/_gw/api/agent/login/status")).json(); return { ok: s.state === "idle" && s.logged_in === false, s };`));
  await check("the app server (a worker thread of the hub) restarts cleanly on demand and comes back healthy with its data", () => page(`
    const H = { "x-requested-with": "collado" }; const before = await (await fetch("/app/api/e/programs?limit=1")).json();
    const r = await fetch("/_gw/api/service/restart", { method: "POST", headers: H }); if (!r.ok) return { ok: false, step: "restart", status: r.status };
    let healthy = false; for (let i = 0; i < 60 && !healthy; i++) { await new Promise((x) => setTimeout(x, 500)); try { healthy = (await (await fetch("/_gw/api/service/status")).json()).app.healthy === true; } catch { /* still down */ } }
    const after = await (await fetch("/app/api/e/programs?limit=1")).json(); return { ok: healthy && (after.total ?? after.rows?.length) === (before.total ?? before.rows?.length), healthy, before: before.total, after: after.total };`));
  await check("top bar: no Preguntar button nor app-running indicator; the organization menu lists real entries (no [object ...])", () => page(`
    const hidden = (id) => { const e = document.getElementById(id); return !e || e.hidden || getComputedStyle(e).display === "none"; };
    const b = document.getElementById("org-btn"); if (b.hidden) return { ok: hidden("ask") && hidden("led"), note: "no org button" }; b.click(); await new Promise((r) => setTimeout(r, 300));
    const pop = document.getElementById("orgpop").innerText; b.click(); return { ok: hidden("ask") && hidden("led") && hidden("tour-btn") && !/object|HTML/.test(pop) && /Gestionar organizaciones/.test(pop), pop: pop.replace(/\s+/g, " ") };`));
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
    document.getElementById("menu").click(); await new Promise((r) => setTimeout(r, 300)); [...document.querySelectorAll("#menupop button")].find((b) => b.textContent.trim() === "Log")?.click(); await new Promise((r) => setTimeout(r, 1800));
    const logPane = document.getElementById("pane-service").innerText, buttons = [...document.querySelectorAll("#pane-service button")].map((b) => b.textContent.trim());
    location.hash = "#/orgs"; await new Promise((r) => setTimeout(r, 1000)); const orgs = document.getElementById("pane-orgs").innerText;
    location.hash = "#/admin"; await new Promise((r) => setTimeout(r, 600)); const viaUrl = location.hash, adminShown = !document.getElementById("pane-admin").hidden || document.getElementById("pane-admin").childElementCount > 0;
    location.hash = "#/service"; await new Promise((r) => setTimeout(r, 800));
    const ok = JSON.stringify(tabs) === JSON.stringify(["Proyectos", "Archivos", "Organizaciones"]) && /^log/i.test(logPane) && !/servicio|git/i.test(logPane) && buttons.length === 1 && buttons[0] === "Reiniciar la app" && !/Usuarios/.test(orgs) && !adminShown;
    const menuBtn = document.getElementById("menu"); menuBtn.click(); await new Promise((r) => setTimeout(r, 300));
    const items = [...document.querySelectorAll("#menupop button")].map((b) => b.textContent.trim()), pop = document.getElementById("menupop").innerText; menuBtn.click();
    const menuOk = menuBtn.textContent.trim() === "Configuración" && !/false|undefined|null/.test(pop) && !pop.includes(${JSON.stringify(process.env.USER || "usuario")}) && !items.some((i) => /contraseña|dos pasos|Cerrar sesión/.test(i)) && items.some((i) => /Idioma|Castellano/.test(i)) && items.some((i) => /tema/i.test(i)) && items.some((i) => /recorrido/i.test(i)) && items.includes("Log");
    return { ok: ok && menuOk, tabs, buttons, viaUrl, adminShown, menu: menuBtn.textContent.trim(), items };`));
  return results;
}
