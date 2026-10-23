// Collado shell: ONE top bar (navigation, global search, notifications, agent, console toggle, user menu), the app in an iframe, a console dock on the right
// (open / close / maximise / resize), the service panel and users + roles administration. No framework, no build step.
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const appName = () => (typeof ME !== "undefined" && ME?.appName) || "Collado";   // the desktop build calls itself differently (see brand.mjs)
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;   // only ever fed with trusted markup (the QR SVG generated locally)
    else if (v === true) n.setAttribute(k, ""); else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== false && c != null && c !== "") n.append(c instanceof Node ? c : document.createTextNode(c));
  return n;
};
const fmtDate = (s) => (s ? new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—");

let ME = null, CATALOGUE = {};

async function api(path, method = "GET", body) {
  const r = await fetch("/_gw/api/" + path, { method, headers: { "content-type": "application/json", "x-requested-with": "collado" }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.replace("/login"); throw new Error("sesión caducada"); }
  if (d.must_change) { await forcePasswordChange(); return api(path, method, body); }
  if (d.must_enroll) { await enrollDialog(true); return api(path, method, body); }
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }
const has = (p) => ME.user.permissions.includes(p);

// ---- modal ---------------------------------------------------------------------------------------------------------------------------
function modal(title, body, { dismissable = true } = {}) {
  return new Promise((resolve) => {
    const m = $("#modal"), prev = document.activeElement;
    $("#mtitle").textContent = title; $("#mbody").replaceChildren(body); m.hidden = false;
    const close = (v) => { m.hidden = true; m.onkeydown = null; m.onclick = null; prev?.focus?.(); resolve(v); };
    modal.close = close;
    m.onkeydown = (e) => { if (e.key === "Escape" && dismissable) close(null); };
    m.onclick = (e) => { if (e.target === m && dismissable) close(null); };
    (body.querySelector("input,select,button") || body).focus();
  });
}
const buttons = (...b) => el("div", { class: "row end" }, ...b);

// ---- password change -----------------------------------------------------------------------------------------------------------------
async function forcePasswordChange() { return passwordDialog(true); }
async function passwordDialog(forced) {
  const err = el("p", { class: "err", role: "alert" });
  const cur = el("input", { type: "password", autocomplete: "current-password", id: "pw0" }), n1 = el("input", { type: "password", autocomplete: "new-password", id: "pw1" }),
    n2 = el("input", { type: "password", autocomplete: "new-password", id: "pw2" });
  const form = el("form", {}, forced ? el("p", {}, "Tu contraseña es temporal. Elige una nueva para continuar (mínimo 10 caracteres).") : "",
    el("label", { for: "pw0" }, "Contraseña actual"), cur, el("label", { for: "pw1" }, "Nueva contraseña"), n1, el("label", { for: "pw2" }, "Repite la nueva contraseña"), n2, err,
    buttons(!forced && el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), el("button", { class: "btn primary", type: "submit" }, "Cambiar contraseña")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    if (n1.value !== n2.value) { err.textContent = "Las contraseñas nuevas no coinciden"; return; }
    try {
      const r = await fetch("/_gw/api/me/password", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "collado" }, body: JSON.stringify({ current: cur.value, next: n1.value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = d.error || "No se pudo cambiar"; return; }
      modal.close(true); toast("Contraseña cambiada");
    } catch { err.textContent = "Sin conexión"; }
  });
  const res = await modal(forced ? "Cambia tu contraseña" : "Cambiar contraseña", form, { dismissable: !forced });
  if (res && ME) ME.user.must_change = false;
  return res;
}

// ---- two-factor enrolment ----------------------------------------------------------------------------------------------------------------------
async function enrollDialog(forced) {
  let start;
  try { start = await fetch("/_gw/api/me/2fa/start", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "collado" } }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; }); }
  catch (e) { toast(e.message); return null; }
  const qr = qrcode(0, "M"); qr.addData(start.uri); qr.make();
  const qrBox = el("div", { class: "qr", html: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) });
  const err = el("p", { class: "err", role: "alert" }), code = el("input", { type: "text", id: "tc", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7" });
  const form = el("form", {}, el("p", {}, forced ? "Para entrar hace falta la verificación en dos pasos. " : "", "Escanea el QR con tu aplicación de autenticación (Google Authenticator, Aegis, 1Password…) y escribe el código que muestra."),
    qrBox, el("p", { class: "lead" }, "¿No puedes escanear? Clave manual: ", el("span", { class: "mono secret-inline" }, start.secret)),
    el("label", { for: "tc" }, "Código de 6 cifras"), code, err, buttons(!forced && el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), el("button", { class: "btn primary", type: "submit" }, "Activar")));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault(); err.textContent = "";
    try {
      const r = await fetch("/_gw/api/me/2fa/confirm", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "collado" }, body: JSON.stringify({ code: code.value }) });
      const d = await r.json().catch(() => ({})); if (!r.ok) { err.textContent = d.error || "Código incorrecto"; return; }
      modal.close(d.recovery);
    } catch { err.textContent = "Sin conexión"; }
  });
  const codes = await modal(forced ? "Activa la verificación en dos pasos" : "Verificación en dos pasos", form, { dismissable: !forced });
  if (!codes) return null;
  if (ME) { ME.user.totp = true; ME.user.needs_enroll = false; }
  const text = codes.join("\n");
  await modal("Códigos de recuperación", el("div", {}, el("p", {}, "Guárdalos en un lugar seguro. Cada uno sirve una sola vez si pierdes el móvil. No se volverán a mostrar."), el("pre", { class: "secret" }, text),
    buttons(el("button", { class: "btn", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(text); toast("Copiados"); } catch { toast("Selecciónalos y cópialos a mano"); } } }, "Copiar"),
      el("button", { class: "btn primary", onclick: () => modal.close(true) }, "Los he guardado"))), { dismissable: false });
  return true;
}

// ---- views / routing -----------------------------------------------------------------------------------------------------------------
// Main views: the app (default), service and users. The console is NOT a view: it is a dock next to whatever view is showing.
const VIEWS = ["app", "files", "service", "admin", "orgs"];
const canView = (v) => ({ app: has("app.view"), files: canConsole(), service: has("service.manage"), admin: has("users.manage") && !ME.desktop, orgs: has("platform.admin") })[v];
const canConsole = () => has("agent.console") || has("agent.shell");
let current = null;

function route() {
  let v = location.hash.replace(/^#\/?/, "").split("/")[0];
  if (v === "console" || v === "split") { v = "app"; if (canConsole()) setDock(true); history.replaceState(null, "", "#/app"); }   // old bookmarks
  if (!VIEWS.includes(v) || !canView(v)) v = VIEWS.find(canView) || "none";
  show(v);
}
function show(v) {
  current = v;
  for (const a of document.querySelectorAll("#tabs a")) a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false");
  $("#pane-app").hidden = v !== "app"; $("#pane-files").hidden = v !== "files"; $("#pane-service").hidden = v !== "service"; $("#pane-admin").hidden = v !== "admin"; $("#pane-orgs").hidden = v !== "orgs";
  document.body.classList.toggle("in-app", v === "app");
  if (v === "app") { const f = $("#appframe"); if (f.getAttribute("src") === "about:blank") f.src = "/app/"; }
  if (v === "files") FM.mount($("#pane-files"));
  if (v === "service") renderService(); else stopServicePoll();
  if (v === "admin") renderAdmin();
  if (v === "orgs") renderOrgs();
  if (v === "none") { $("#pane-admin").hidden = false; $("#pane-admin").replaceChildren(el("h1", {}, "Sin acceso"), el("p", { class: "lead" }, "Tu cuenta no tiene permisos asignados. Pide a un administrador que te asigne un rol.")); }
}
function goApp(hash) {
  if (current !== "app") location.hash = "#/app";
  const f = $("#appframe"), send = () => f.contentWindow?.postMessage({ type: "collado:navigate", hash }, location.origin);
  if (f.getAttribute("src") === "about:blank") { f.addEventListener("load", send, { once: true }); show("app"); } else send();
}

// ---- console dock: open / close / maximise / resize (state is remembered) ----------------------------------------------------------------------
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
let dockOpen = false, dockMax = false;
function setDock(open, { remember = true } = {}) {
  if (open && !canConsole()) return;
  dockOpen = open; if (!open) dockMax = false;
  const stage = $("#stage"); stage.classList.toggle("dock-open", open); stage.classList.toggle("dock-max", open && dockMax);
  $("#pane-console").hidden = !open; $("#splitter").hidden = !open;
  $("#dock-toggle").setAttribute("aria-pressed", String(open)); $("#dock-max").setAttribute("aria-pressed", String(dockMax)); $("#dock-max").textContent = dockMax ? "Restaurar" : "Maximizar";
  if (remember) store.set("collado.dock", open ? "open" : "closed");
  if (open) { initConsole(); requestAnimationFrame(() => { fitAll(); focusTerm(); }); }
}
function setDockMax(on) { dockMax = on; setDock(true, { remember: false }); $("#stage").classList.toggle("dock-max", on); requestAnimationFrame(() => { fitAll(); focusTerm(); }); }
function initDock() {
  if (!canConsole()) return;
  const t = $("#dock-toggle"); t.hidden = false;
  t.addEventListener("click", () => setDock(!dockOpen)); $("#dock-close").addEventListener("click", () => setDock(false)); $("#dock-max").addEventListener("click", () => setDockMax(!dockMax));
  // the width is kept as a PERCENTAGE of the stage (CSS clamps it to 320px..stage-320px), so it adapts to any window width and to later window resizes
  const MIN = 320, stageW = () => $("#stage").getBoundingClientRect().width;
  const setPct = (px, save) => { const pct = Math.round(Math.max(MIN, Math.min(stageW() - MIN, px)) / stageW() * 1000) / 10; $("#stage").style.setProperty("--dock-w", pct + "%"); if (save) store.set("collado.dock.pct", String(pct)); fitAll(); };
  const pct = Number(store.get("collado.dock.pct")); if (pct > 5 && pct < 95) $("#stage").style.setProperty("--dock-w", pct + "%");
  const sp = $("#splitter"); let startX = 0, startW = 0;
  const move = (e) => setPct(startW + (startX - e.clientX), false);
  sp.addEventListener("pointerdown", (e) => { startX = e.clientX; startW = $("#pane-console").getBoundingClientRect().width; sp.setPointerCapture(e.pointerId); sp.classList.add("drag"); $("#appframe").style.pointerEvents = "none"; sp.addEventListener("pointermove", move); });
  const end = (e) => { sp.classList.remove("drag"); sp.removeEventListener("pointermove", move); $("#appframe").style.pointerEvents = ""; setPct($("#pane-console").getBoundingClientRect().width, true); try { sp.releasePointerCapture(e.pointerId); } catch { /* already released */ } };
  sp.addEventListener("pointerup", end); sp.addEventListener("pointercancel", end);
  sp.addEventListener("dblclick", () => { $("#stage").style.removeProperty("--dock-w"); store.set("collado.dock.pct", ""); fitAll(); });   // back to the default width
  sp.addEventListener("keydown", (e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); setPct($("#pane-console").getBoundingClientRect().width + (e.key === "ArrowLeft" ? 40 : -40), true); });
  document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "c") { e.preventDefault(); setDock(!dockOpen); } });   // Ctrl+Alt+C
  // wide screens: console open by default (that is why the portal exists); phones: closed until asked for
  const pref = store.get("collado.dock"); setDock(pref ? pref === "open" && matchMedia("(min-width: 901px)").matches : !ME.desktop && matchMedia("(min-width: 901px)").matches, { remember: false });   // desktop: closed until asked for (an open console starts Claude Code, ~220 MB)
}

// ---- console (xterm.js + WebSocket to the persistent tmux session) --------------------------------------------------------------------------
const TERMS = {};   // name -> { term, fit, ws, host, veil, retry }
let activeSession = null;
const SESSION_LABEL = { claude: "Claude Code", shell: "Terminal bash" };
function initConsole() {
  if (initConsole.done) return; initConsole.done = true;
  const sessions = ["claude", "shell"].filter((s) => has(s === "claude" ? "agent.console" : "agent.shell"));
  const tabs = $("#subtabs");
  for (const s of sessions) {
    const b = el("button", { type: "button", role: "tab", "aria-selected": "false", "data-s": s, onclick: () => selectSession(s) }, SESSION_LABEL[s]);
    tabs.append(b);
    const host = el("div", { class: "term", hidden: true, "data-s": s });
    const veil = el("div", { class: "veil", hidden: true }, el("div", { class: "msg" }), el("div", {}, el("button", { class: "btn primary", type: "button", onclick: () => connect(s) }, "Reconectar")));
    $("#termwrap").append(host, veil);
    TERMS[s] = { host, veil, retry: 0 };
  }
  tabs.append(el("span", { class: "grow" }), el("span", { class: "hint" }, "La sesión sigue activa aunque cierres la pestaña"));
  // special keys that touch keyboards lack (Claude Code needs Esc, Tab, Shift+Tab, arrows, Ctrl+C)
  const KEYS = [["Esc", "\x1b"], ["Tab", "\t"], ["⇧Tab", "\x1b[Z"], ["↑", "\x1b[A"], ["↓", "\x1b[B"], ["←", "\x1b[D"], ["→", "\x1b[C"], ["Ctrl+C", "\x03"], ["Intro", "\r"]];
  $("#pane-console").append(el("div", { class: "keybar", role: "toolbar", "aria-label": "Teclas especiales" }, KEYS.map(([label, seq]) =>
    el("button", { type: "button", onmousedown: (e) => e.preventDefault(), onclick: () => { const t = TERMS[activeSession]; if (t?.ws?.readyState === 1) t.ws.send(new TextEncoder().encode(seq)); t?.term?.focus(); } }, label))));
  selectSession(sessions[0]);
}
function selectSession(s) {
  activeSession = s;
  for (const b of document.querySelectorAll("#subtabs button")) b.setAttribute("aria-selected", b.dataset.s === s ? "true" : "false");
  for (const [n, t] of Object.entries(TERMS)) { t.host.hidden = n !== s; if (t.veilShown) t.veil.hidden = n !== s; }
  if (!TERMS[s].term) connect(s);
  requestAnimationFrame(() => { fitAll(); focusTerm(); });
}
function focusTerm() { TERMS[activeSession]?.term?.focus(); }
function fitAll() {
  for (const t of Object.values(TERMS)) if (t.term && !t.host.hidden && t.host.offsetParent) {
    const fs = t.host.clientWidth < 420 ? 12 : 14; if (t.term.options.fontSize !== fs) t.term.options.fontSize = fs;   // narrow dock / phone: keep enough columns for Claude Code's UI
    try { t.fit.fit(); } catch { /* not laid out yet */ }
  }
}
function setVeil(t, msg, show) { t.veilShown = show; t.veil.hidden = !show || t.host.hidden; t.veil.firstChild.textContent = msg || ""; }

function connect(s) {
  const t = TERMS[s];
  if (!t.term) {
    const css = getComputedStyle(document.documentElement);
    t.term = new Terminal({ fontFamily: css.getPropertyValue("--mono"), fontSize: 14, cursorBlink: true, scrollback: 5000, allowProposedApi: true,
      theme: { background: "#0f1114", foreground: "#ece9e1", cursor: "#ef5a44", selectionBackground: "#3a4252" } });
    t.fit = new FitAddon.FitAddon(); t.term.loadAddon(t.fit); t.term.loadAddon(new WebLinksAddon.WebLinksAddon());
    t.term.open(t.host);
    const enc = new TextEncoder();
    t.term.onData((d) => { if (t.ws?.readyState === 1) t.ws.send(enc.encode(d)); });
    t.term.onBinary((d) => { if (t.ws?.readyState === 1) t.ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0))); });
    t.term.onResize(({ cols, rows }) => { if (t.ws?.readyState === 1) t.ws.send(JSON.stringify({ type: "resize", cols, rows })); });
    new ResizeObserver(() => { if (!t.host.hidden) fitAll(); }).observe(t.host);
  }
  try { t.fit.fit(); } catch { /* noop */ }
  clearTimeout(t.timer); setVeil(t, "", false);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/_gw/ws/term?session=${s}&cols=${t.term.cols}&rows=${t.term.rows}`);
  ws.binaryType = "arraybuffer"; t.ws = ws;
  ws.onopen = () => { t.retry = 0; ws.send(JSON.stringify({ type: "resize", cols: t.term.cols, rows: t.term.rows })); if (s === activeSession) t.term.focus(); };
  ws.onmessage = (e) => {
    if (typeof e.data === "string") { try { const m = JSON.parse(e.data); if (m.type === "exit") setVeil(t, "La sesión terminó. Al reconectar se abrirá una nueva.", true); if (m.type === "error") setVeil(t, m.message, true); } catch { /* ignore */ } return; }
    t.term.write(new Uint8Array(e.data));
  };
  ws.onclose = (e) => {
    if (t.ws !== ws) return;
    if (e.code === 4401) { location.replace("/login"); return; }
    if (e.code === 4403) { setVeil(t, "Tus permisos han cambiado. Recarga la página.", true); return; }
    if (t.veilShown) return;                                   // "exit" / "error" message already shown: wait for the user
    if (t.retry < 6) { t.retry++; setVeil(t, `Conexión perdida. Reintentando (${t.retry})…`, true); t.timer = setTimeout(() => connect(s), Math.min(1000 * 2 ** t.retry, 15000)); }
    else setVeil(t, "No se pudo reconectar con la consola.", true);
  };
}
addEventListener("resize", () => requestAnimationFrame(fitAll));

// Messages from the app in the iframe: collado:agent-send {text} (type a prompt into the person's console), collado:open-console, collado:route {hash}
let appHash = "#/";
addEventListener("message", async (e) => {
  if (e.source !== $("#appframe").contentWindow || e.origin !== location.origin) return;
  const m = e.data || {};
  if (m.type === "collado:route") { appHash = String(m.hash || "#/"); return; }
  if (m.type === "collado:open-console") { setDock(true); return; }
  if (m.type === "collado:open-folder") { openProjectFolder(m); return; }
  if (m.type === "collado:layout") { document.body.classList.toggle("app-compact", !!m.compact); return; }
  if (m.type !== "collado:agent-send") return;
  const frame = $("#appframe");
  const reply = (ok, error) => frame.contentWindow.postMessage({ type: "collado:agent-sent", id: m.id, ok, error }, location.origin);
  if (!has("agent.console")) { reply(false, "No tienes permiso para usar la consola del agente"); toast("No tienes permiso para usar la consola"); return; }
  try { await api("agent/send", "POST", { text: String(m.text || "") }); reply(true); setDock(true); toast("Enviado al agente"); }
  catch (err) { reply(false, err.message); toast(err.message); }
});

// Desktop: a project lives in a folder chosen by the person. The file manager reaches it through a link inside the person's home (Proyectos/<name>-<id>), created on demand.
const projectLinkName = (p) => `${String(p.name || "proyecto").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 60) || "proyecto"}-${p.id}`;
async function openProjectFolder(p) {
  try {
    const r = await api("files/link", "POST", { name: projectLinkName(p), target: p.folder });
    location.hash = "#/files"; FM.goto(r.path);
  } catch (e) { toast(({ target_not_found: "La carpeta del proyecto ya no existe: " + p.folder, target_not_a_directory: "La ruta del proyecto no es una carpeta", invalid_target: "La carpeta del proyecto debe ser una ruta completa" })[e.message] || e.message); }
}

// ---- cloud sync (desktop): Google Drive, OneDrive or a synced folder ---------------------------------------------------------------------------------------------
const CLOUD_ERR = { weak_passphrase: "La contraseña debe tener al menos 8 caracteres", bad_passphrase: "Esa contraseña no corresponde a los datos que ya hay en la nube", no_client_id: "Falta el identificador de la aplicación (Client ID)", bad_folder: "Elige una carpeta (ruta completa)", cancelled: "Cancelado",
  access_denied: "No se concedió el acceso a la cuenta", timeout: "Se agotó el tiempo esperando el inicio de sesión", already_connected: "Ya hay una nube conectada", forbidden: "No permitido" };
async function cloudDialog() {
  const bridge = window.colladoDesktop?.cloud; if (!bridge) { toast("La sincronización solo está en la app de escritorio"); return; }
  const body = el("div"), when = (t) => (t ? fmtDate(t) : "nunca"), STATE = { off: "Sin conectar", idle: "Sincronizado", syncing: "Sincronizando…", offline: "Sin conexión: se sincronizará al volver", error: "Error", suspended: "En pausa (otro equipo tiene el control)", connecting: "Conectando…" };
  let poll = null; const stop = () => { clearInterval(poll); poll = null; };
  const connectedView = (st) => {
    const err = el("p", { class: "err", role: "alert" }, st.error || "");
    const sync = el("button", { class: "btn primary", type: "button", disabled: st.state === "syncing", onclick: async () => { sync.disabled = true; const r = await bridge.syncNow(); if (r.error) toast(CLOUD_ERR[r.error] || r.message || "No se pudo sincronizar"); draw(); } }, "Sincronizar ahora");
    const off = el("button", { class: "btn danger", type: "button", onclick: async () => { if (!confirm("¿Desconectar la nube? Los datos de este equipo no se tocan y la copia de la nube se queda como está.")) return; stop(); await bridge.disconnect(); draw(); } }, "Desconectar");
    return el("div", {}, el("p", { class: "lead" }, st.pendingPull ? `${appName()} se reiniciará para aplicar los datos de la nube.` : `Todos los datos de ${appName()} se copian cifrados con tu contraseña. Mientras está conectado, ${appName()} usa internet solo para esto.`),
      el("dl", { class: "kv" }, ...[["Servicio", st.providerLabel + (st.folder ? ` · ${st.folder}` : "")], ["Este equipo", st.device || "—"], ["Estado", STATE[st.state] || st.state], ["Última sincronización", when(st.lastSyncAt)], ...(st.skipped ? [["Omitidos (demasiado grandes)", String(st.skipped)]] : [])].flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
      err, !st.vaultStrong ? el("p", { class: "lead" }, "Este sistema no tiene almacén seguro de claves: la clave de sincronización se guarda en un archivo protegido solo para tu usuario.") : "",
      buttons(off, sync, el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cerrar")));
  };
  const connectView = (st) => {
    const prov = el("select", { id: "cp" }, [["google", "Google Drive"], ["microsoft", "OneDrive"], ["folder", "Carpeta sincronizada (Drive/OneDrive de escritorio)"]].map(([v, l]) => el("option", { value: v }, l)));
    const cid = el("input", { type: "text", id: "ccid", autocomplete: "off", spellcheck: "false" }), csec = el("input", { type: "password", id: "ccs", autocomplete: "off" }), folder = el("input", { type: "text", id: "cfo", autocomplete: "off", spellcheck: "false", placeholder: "/ruta/a/Google Drive/Collado" });
    const pick = el("button", { class: "btn sm", type: "button", onclick: async () => { const p = await window.colladoDesktop.pickFolder(folder.value.trim()); if (p) folder.value = p; } }, "Elegir carpeta…");
    const pw = el("input", { type: "password", id: "cpw", autocomplete: "new-password" }), pw2 = el("input", { type: "password", id: "cpw2", autocomplete: "new-password" }), err = el("p", { class: "err", role: "alert" });
    const apiBox = el("div", {}, el("p", { class: "lead" }, `Esta copia de ${appName()} no trae las credenciales de la aplicación para este servicio. Créalas en el panel de desarrolladores (ver docs/DESKTOP.md) y pégalas aquí.`), el("label", { for: "ccid" }, "Client ID"), cid, el("div", { id: "csecbox" }, el("label", { for: "ccs" }, "Client secret (Google)"), csec));
    const folderBox = el("div", {}, el("label", { for: "cfo" }, "Carpeta (dentro de Google Drive para escritorio, OneDrive…)"), el("div", { class: "row" }, el("div", { style: "flex:1" }, folder), pick));
    const refresh = () => { const k = prov.value; apiBox.hidden = k === "folder" || !!st.configured[k]; folderBox.hidden = k !== "folder"; $("#csecbox", apiBox) && ($("#csecbox", apiBox).hidden = k !== "google"); };
    prov.addEventListener("change", refresh);
    const go = el("button", { class: "btn primary", type: "submit" }, "Conectar");
    const form = el("form", {}, el("p", { class: "lead" }, `Lleva todos tus datos de ${appName()} (programas, adjuntos, archivos y la clave de cifrado) a la nube para trabajar desde otro equipo. Se sube todo cifrado con una contraseña que solo tú conoces.`),
      el("label", { for: "cp" }, "Dónde"), prov, apiBox, folderBox,
      el("label", { for: "cpw" }, "Contraseña de sincronización"), pw, el("label", { for: "cpw2" }, "Repite la contraseña"), pw2,
      el("p", { class: "lead", style: "margin-top:12px" }, "Si la pierdes, los datos de la nube no se pueden recuperar. En otro equipo tendrás que escribirla. Solo un equipo trabaja a la vez."), err,
      buttons(el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), go));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault(); err.textContent = ""; if (pw.value !== pw2.value) { err.textContent = "Las contraseñas no coinciden"; return; }
      go.disabled = true; go.textContent = prov.value === "folder" ? "Conectando…" : "Esperando el inicio de sesión en el navegador…";
      const r = await bridge.connect({ provider: prov.value, clientId: cid.value.trim(), clientSecret: csec.value, passphrase: pw.value, folder: folder.value.trim() });
      go.disabled = false; go.textContent = "Conectar"; if (r.error) { err.textContent = CLOUD_ERR[r.error] || r.message || r.error; return; }
      toast("Nube conectada"); draw();
    });
    refresh(); return form;
  };
  async function draw() { const st = await bridge.status(); if (!st) return; body.replaceChildren(st.connected ? connectedView(st) : connectView(st)); if (st.connected && !poll) poll = setInterval(draw, 2000); if (!st.connected) stop(); }
  await draw(); await modal("Nube y sincronización", body); stop();
}

// ---- service panel ---------------------------------------------------------------------------------------------------------------------
let servicePoll = null;
function stopServicePoll() { clearInterval(servicePoll); servicePoll = null; }
async function renderService() {
  const pane = $("#pane-service");
  const logbox = el("pre", { class: "logbox", "aria-label": "Registro de la app", tabindex: "0" }), info = el("dl", { class: "kv" });
  const act = async (name, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try { const r = await api("service/" + name, "POST"); toast(r.backup ? `Restaurada. Copia del código anterior: ${r.backup}` : "Hecho"); refresh(); } catch (e) { toast(e.message); }
  };
  const D = !!ME.desktop;   // desktop build: the app is read-only, so there is nothing to roll back or reset; the panel is just the log
  pane.replaceChildren(el("h1", {}, D ? "Log" : "Servicio"), el("p", { class: "lead" }, D ? "Estado de la app y registro en directo. Si algo falla, aquí verás por qué." : "Estado de la app de proyectos que mantiene el agente. Se reinicia sola al cambiar sus ficheros; si falla, aquí puedes volver atrás."), info,
    el("div", { class: "row" }, el("button", { class: "btn", onclick: () => act("restart") }, "Reiniciar la app"),
      ...(D ? [] : [el("button", { class: "btn", onclick: () => act("rollback", "Se descartan los cambios sin guardar y se vuelve a la última versión que arrancó bien. ¿Continuar?") }, "Volver a la última versión buena"),
      el("button", { class: "btn danger", onclick: () => act("reset", "Se sustituye el código de la app por el original (se guarda una copia comprimida del actual). Los datos de proyectos no se tocan. ¿Continuar?") }, "Restaurar la app original")])),
    el("h2", {}, "Registro"), logbox);
  async function refresh() {
    try {
      const [s, l] = await Promise.all([api("service/status"), api("service/logs?n=200")]);
      const a = s.app;
      info.replaceChildren(...[["Estado", `${a.state}${a.healthy ? " · sana" : ""}`], ["Reinicios", String(a.restarts ?? 0)], ["En marcha desde hace", `${a.uptime_s ?? 0} s`],
        ...(ME.desktop ? [] : [["Última copia (git)", a.last_snapshot ? fmtDate(a.last_snapshot) : "—"]]), ["Consola Claude", s.console?.claude ? "sesión activa" : "sin sesión"]].flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
      const atEnd = logbox.scrollTop + logbox.clientHeight >= logbox.scrollHeight - 30;
      logbox.textContent = l.lines.join("\n") || "(sin registro todavía)"; if (atEnd) logbox.scrollTop = logbox.scrollHeight;
    } catch (e) { info.replaceChildren(el("dt", {}, "Error"), el("dd", {}, e.message)); }
  }
  await refresh(); logbox.scrollTop = logbox.scrollHeight; stopServicePoll(); servicePoll = setInterval(refresh, 3000);
}

// ---- administration: users, roles, audit ---------------------------------------------------------------------------------------------------
let adminTab = "users", adminOrg = null;   // adminOrg: organization a super-admin is administering (null = the one they have open)
const curOrg = () => ME.org?.slug || null;
/** Admin API call for the organization being administered (?org= is only honoured for super-admins). */
const aApi = (path, method, body) => api(adminOrg && adminOrg !== curOrg() ? path + (path.includes("?") ? "&" : "?") + "org=" + encodeURIComponent(adminOrg) : path, method, body);
async function renderAdmin() {
  const pane = $("#pane-admin");
  let orgSel = "";
  if (has("platform.admin")) {
    const { orgs } = await api("orgs").catch(() => ({ orgs: [] })); adminOrg ||= curOrg();
    orgSel = el("div", { class: "row", style: "margin:8px 0" }, el("label", { for: "adm-org", style: "margin:0" }, "Organización:"),
      el("select", { id: "adm-org", onchange: (e) => { adminOrg = e.target.value; renderAdmin(); } }, orgs.map((o) => el("option", { value: o.slug, selected: o.slug === adminOrg }, o.name + (o.disabled ? " (desactivada)" : "")))));
  } else adminOrg = null;
  const tabs = el("div", { class: "row", role: "tablist" }, ...[["users", "Usuarios"], ["roles", "Roles y permisos"], ["audit", "Auditoría"]].map(([k, label]) =>
    el("button", { class: "btn sm", role: "tab", "aria-selected": String(adminTab === k), style: adminTab === k ? "border-color:var(--accent);font-weight:600" : "", onclick: () => { adminTab = k; renderAdmin(); } }, label)));
  const body = el("div", {});
  pane.replaceChildren(el("h1", {}, "Usuarios y roles"), el("p", { class: "lead" }, `Organización: ${adminOrgName()}. Los permisos viven en los roles de cada organización; una persona puede estar en varias, con roles distintos en cada una.`), orgSel, tabs, body);
  try {
    if (adminTab === "users") await adminUsers(body); else if (adminTab === "roles") await adminRoles(body); else await adminAudit(body);
  } catch (e) { body.replaceChildren(el("p", { class: "err" }, e.message)); }
}
const adminOrgName = () => (ME.user.orgs.find((o) => o.slug === (adminOrg || curOrg())) || {}).name || ME.org?.name || "";
const roleChips = (roles) => roles.map((r) => el("span", { class: "chip" + (r === "admin" ? " admin" : "") }, r));

async function secretDialog(title, intro, secret) {
  const copy = el("button", { class: "btn", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(secret); toast("Copiada"); } catch { toast("Selecciónala y cópiala a mano"); } } }, "Copiar");
  await modal(title, el("div", {}, el("p", {}, intro), el("div", { class: "secret" }, secret), el("p", { class: "lead" }, "Se muestra una sola vez. La persona deberá cambiarla al entrar."),
    buttons(copy, el("button", { class: "btn primary", onclick: () => modal.close(true) }, "Hecho"))));
}

async function adminUsers(body) {
  const [{ users }, { roles }] = await Promise.all([aApi("users"), aApi("roles")]); const sup = has("platform.admin");
  const table = el("table", {}, el("thead", {}, el("tr", {}, ...["Usuario", "Roles", ...(sup ? ["Organizaciones"] : []), "Estado", "2FA", "Último acceso", ""].map((h) => el("th", {}, h)))),
    el("tbody", {}, users.map((u) => el("tr", {},
      el("td", {}, el("strong", {}, u.username), u.name && u.name !== u.username ? el("div", { class: "lead", style: "margin:0;font-size:13px" }, u.name) : ""),
      el("td", {}, u.roles.length ? roleChips(u.roles) : el("span", { class: "lead" }, "sin roles")),
      sup ? el("td", { style: "font-size:13px" }, u.super ? "todas (super-admin)" : u.orgs_of.map((o) => (ME.user.orgs.find((x) => x.slug === o) || {}).name || o).join(", ")) : "",
      el("td", {}, u.disabled ? "Desactivado" : u.must_change ? "Contraseña temporal" : "Activo"),
      el("td", {}, u.totp ? "Sí" : "No"),
      el("td", {}, fmtDate(u.last_login)),
      el("td", { class: "actions" },
        el("button", { class: "btn sm", onclick: () => editUserRoles(u, roles) }, "Roles"), " ",
        sup ? el("button", { class: "btn sm", onclick: async () => { if (!confirm(u.super ? `¿Quitar el rol de super-admin a ${u.username}?` : `¿Hacer super-admin a ${u.username}? Podrá crear organizaciones, entrar en todas y usar Servicio.`)) return;
          try { await aApi("users/" + encodeURIComponent(u.username), "PATCH", { super: !u.super }); renderAdmin(); } catch (e) { toast(e.message); } } }, u.super ? "Quitar super-admin" : "Hacer super-admin") : "", " ",
        el("button", { class: "btn sm", onclick: async () => { if (!confirm(`¿Restablecer la contraseña de ${u.username}? Se cerrarán sus sesiones.`)) return;
          try { const r = await aApi("users/" + encodeURIComponent(u.username), "PATCH", { reset_password: true }); await secretDialog("Contraseña temporal", `Nueva contraseña de ${u.username}:`, r.password); renderAdmin(); } catch (e) { toast(e.message); } } }, "Contraseña"), " ",
        u.totp ? el("button", { class: "btn sm", onclick: async () => { if (!confirm(`¿Quitar la verificación en dos pasos de ${u.username}? Tendrá que activarla de nuevo al entrar.`)) return;
          try { await aApi("users/" + encodeURIComponent(u.username) + "/2fa-reset", "POST"); toast("2FA restablecido"); renderAdmin(); } catch (e) { toast(e.message); } } }, "Quitar 2FA") : "", " ",
        el("button", { class: "btn sm", onclick: async () => { try { await aApi("users/" + encodeURIComponent(u.username), "PATCH", { disabled: !u.disabled }); renderAdmin(); } catch (e) { toast(e.message); } } }, u.disabled ? "Activar" : "Desactivar"), " ",
        el("button", { class: "btn sm danger", onclick: async () => { if (!confirm(u.orgs_of.length > 1 ? `¿Quitar a ${u.username} de ${adminOrgName()}? Su cuenta sigue en sus otras organizaciones.` : `¿Borrar el usuario ${u.username}?`)) return;
          try { await aApi("users/" + encodeURIComponent(u.username), "DELETE"); renderAdmin(); } catch (e) { toast(e.message); } } }, u.orgs_of.length > 1 ? "Quitar de la organización" : "Borrar"),
        sup && u.orgs_of.length > 1 ? [" ", el("button", { class: "btn sm danger", onclick: async () => { if (!confirm(`¿Borrar la cuenta ${u.username} en TODAS las organizaciones?`)) return;
          try { await aApi("users/" + encodeURIComponent(u.username) + "?everywhere=1", "DELETE"); renderAdmin(); } catch (e) { toast(e.message); } } }, "Borrar en todas")] : "")))));
  body.replaceChildren(el("div", { class: "row", style: "margin:16px 0" }, el("button", { class: "btn primary", onclick: () => newUser(roles, sup) }, "Nuevo usuario")), el("div", { style: "overflow-x:auto" }, table));
}
function roleCheckboxes(roles, selected) {
  return roles.map((r) => { const id = "rc-" + r.name;
    return el("label", { class: "perm", for: id }, el("input", { type: "checkbox", id, value: r.name, checked: selected.includes(r.name) }), el("span", {}, el("strong", {}, r.name), " — " + (r.description || r.permissions.join(", ")))); });
}
async function newUser(roles, sup) {
  const err = el("p", { class: "err", role: "alert" }), u = el("input", { type: "text", id: "nu", autocomplete: "off", autocapitalize: "none", spellcheck: "false" }),
    n = el("input", { type: "text", id: "nn", autocomplete: "off" }), p = el("input", { type: "password", id: "np", autocomplete: "new-password", placeholder: "Vacío = generar una temporal" });
  const boxes = el("div", {}, roleCheckboxes(roles, ["editor"])), isSuper = el("input", { type: "checkbox", id: "ns" });
  const form = el("form", {}, sup ? el("p", { class: "lead" }, `Se crea en «${adminOrgName()}». Si el usuario ya existe en otra organización, se añade a esta con los roles elegidos (sin contraseña nueva).`) : "",
    el("label", { for: "nu" }, "Usuario (minúsculas, números . _ -)"), u, el("label", { for: "nn" }, "Nombre visible"), n, el("label", { for: "np" }, "Contraseña inicial (opcional)"), p,
    el("label", {}, "Roles en esta organización"), boxes, sup ? el("label", { class: "perm", for: "ns" }, isSuper, el("span", {}, el("strong", {}, "Super-admin"), " — crea organizaciones, entra en todas y usa Servicio")) : "", err,
    buttons(el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), el("button", { class: "btn primary", type: "submit" }, "Crear")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    try {
      const r = await aApi("users", "POST", { username: u.value.trim(), name: n.value.trim(), password: p.value || undefined, roles: [...boxes.querySelectorAll("input:checked")].map((i) => i.value), ...(isSuper.checked ? { super: true } : {}) });
      modal.close(true); if (r.existing) toast(`${r.user.username} ya tenía cuenta: añadido a ${adminOrgName()}`); else if (r.password) await secretDialog("Usuario creado", `Contraseña temporal de ${r.user.username}:`, r.password); else toast("Usuario creado"); renderAdmin();
    } catch (x) { err.textContent = x.message; }
  });
  await modal("Nuevo usuario", form);
}
async function editUserRoles(u, roles) {
  const err = el("p", { class: "err", role: "alert" }), boxes = el("div", {}, roleCheckboxes(roles, u.roles));
  const form = el("form", {}, boxes, err, buttons(el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), el("button", { class: "btn primary", type: "submit" }, "Guardar")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await aApi("users/" + encodeURIComponent(u.username), "PATCH", { roles: [...boxes.querySelectorAll("input:checked")].map((i) => i.value) }); modal.close(true); toast("Roles actualizados"); renderAdmin(); }
    catch (x) { err.textContent = x.message; }
  });
  await modal(`Roles de ${u.username}`, form);
}

async function adminRoles(body) {
  const { roles, permissions } = await aApi("roles");
  const cards = roles.map((r) => el("div", { class: "card" }, el("h3", {}, r.name, r.locked ? el("span", { class: "chip", style: "margin-left:8px" }, "fijo") : ""),
    el("p", { class: "lead", style: "margin:0 0 8px;font-size:13px" }, `${r.description || "Sin descripción"} · ${r.users} usuario(s)`),
    el("ul", { style: "margin:0 0 10px;padding-left:18px;font-size:13px" }, r.permissions.map((p) => el("li", {}, permissions[p] || p))),
    r.locked ? "" : el("div", { class: "row" }, el("button", { class: "btn sm", onclick: () => roleDialog(r, permissions) }, "Editar"),
      el("button", { class: "btn sm danger", onclick: async () => { if (!confirm(`¿Borrar el rol ${r.name}? Se quitará a sus ${r.users} usuario(s).`)) return;
        try { await aApi("roles/" + encodeURIComponent(r.name), "DELETE"); renderAdmin(); } catch (e) { toast(e.message); } } }, "Borrar"))));
  body.replaceChildren(el("div", { class: "row", style: "margin:16px 0" }, el("button", { class: "btn primary", onclick: () => roleDialog(null, permissions) }, "Nuevo rol")), el("div", { class: "cards" }, cards));
}
async function roleDialog(role, permissions) {
  const err = el("p", { class: "err", role: "alert" }), name = el("input", { type: "text", id: "rn", value: role?.name || "", disabled: !!role, autocapitalize: "none", spellcheck: "false" }),
    desc = el("input", { type: "text", id: "rd", value: role?.description || "" });
  const boxes = el("div", {}, Object.entries(permissions).map(([k, label]) => el("label", { class: "perm", for: "p-" + k },
    el("input", { type: "checkbox", id: "p-" + k, value: k, checked: !!role?.permissions.includes(k) }), el("span", {}, el("strong", { class: "mono" }, k), " — " + label))));
  const form = el("form", {}, el("label", { for: "rn" }, "Nombre del rol"), name, el("label", { for: "rd" }, "Descripción"), desc, el("label", {}, "Permisos"), boxes, err,
    buttons(el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), el("button", { class: "btn primary", type: "submit" }, "Guardar")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); const perms = [...boxes.querySelectorAll("input:checked")].map((i) => i.value);
    try {
      if (role) await aApi("roles/" + encodeURIComponent(role.name), "PUT", { description: desc.value, permissions: perms });
      else await aApi("roles", "POST", { name: name.value.trim(), description: desc.value, permissions: perms });
      modal.close(true); toast("Rol guardado"); renderAdmin();
    } catch (x) { err.textContent = x.message; }
  });
  await modal(role ? `Editar rol ${role.name}` : "Nuevo rol", form);
}
async function adminAudit(body) {
  const { events } = await aApi("audit?n=300");
  body.replaceChildren(el("div", { style: "overflow-x:auto;margin-top:16px" }, el("table", {}, el("thead", {}, el("tr", {}, ...["Fecha", "Quién", "Acción", "Detalle"].map((h) => el("th", {}, h)))),
    el("tbody", {}, events.map((e) => el("tr", {}, el("td", {}, fmtDate(e.t)), el("td", {}, e.actor), el("td", { class: "mono" }, e.action),
      el("td", { class: "mono", style: "font-size:12px" }, Object.entries(e).filter(([k]) => !["t", "actor", "action"].includes(k)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" "))))))));
}

// ---- organizations: switch (everybody who belongs to several) and manage (super-admin only) ---------------------------------------------------------------
async function switchOrg(slug) {
  if (slug === curOrg()) return;
  try { await api("me/org", "POST", { org: slug }); location.hash = "#/app"; location.reload(); } catch (e) { toast(e.message); }
}
function initOrgSwitch() {
  const b = $("#org-btn"), pop = $("#orgpop"), orgs = ME.user.orgs || [];
  if (!orgs.length || (orgs.length < 2 && !has("platform.admin"))) return;   // one company and no platform role: nothing to switch
  const close = () => { pop.hidden = true; b.setAttribute("aria-expanded", "false"); };
  b.hidden = false; b.replaceChildren((ME.org?.name || "Organización").slice(0, 22), " ", ico("down"));
  b.addEventListener("click", () => {
    const open = pop.hidden; pop.hidden = !open; b.setAttribute("aria-expanded", String(open)); if (!open) return;
    pop.style.right = Math.max(8, innerWidth - b.getBoundingClientRect().right) + "px";
    pop.replaceChildren(el("div", { class: "who" }, "Cambiar de organización"), ...(ME.user.orgs || []).map((o) => el("button", { type: "button", onclick: () => { close(); switchOrg(o.slug); } }, o.slug === curOrg() && ico("ok"), (o.slug === curOrg() ? " " : "") + o.name)),
      ...(has("platform.admin") ? [el("div", { class: "sep" }), el("button", { type: "button", onclick: () => { close(); location.hash = "#/orgs"; } }, "Gestionar organizaciones…")] : []));
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target) && e.target !== b) close(); });
}
async function renderOrgs() {
  const pane = $("#pane-orgs"); let list;
  try { list = (await api("orgs")).orgs; } catch (e) { pane.replaceChildren(el("h1", {}, "Organizaciones"), el("p", { class: "err" }, e.message)); return; }
  const rows = list.map((o) => el("tr", {}, el("td", {}, el("strong", {}, o.name), el("div", { class: "mono lead", style: "margin:0;font-size:12px" }, o.slug)), ...(ME.desktop ? [] : [el("td", {}, String(o.users))]), el("td", {}, o.disabled ? "Desactivada" : "Activa"),
    el("td", { class: "actions" },
      el("button", { class: "btn sm primary", disabled: !!o.disabled || o.slug === curOrg(), onclick: () => switchOrg(o.slug) }, o.slug === curOrg() ? "Aquí" : "Entrar"), " ",
      ME.desktop ? "" : el("button", { class: "btn sm", onclick: () => { adminOrg = o.slug; adminTab = "users"; location.hash = "#/admin"; } }, "Usuarios"), ME.desktop ? "" : " ",
      el("button", { class: "btn sm", onclick: async () => { const n = prompt("Nombre de la organización", o.name); if (!n || n.trim() === o.name) return; try { await api("orgs/" + o.slug, "PATCH", { name: n.trim() }); renderOrgs(); } catch (e) { toast(e.message); } } }, "Renombrar"), " ",
      o.slug === "principal" ? "" : el("button", { class: "btn sm", onclick: async () => { if (!o.disabled && !confirm(`¿Desactivar «${o.name}»? Nadie podrá entrar hasta que la actives; sus datos se conservan.`)) return;
        try { await api("orgs/" + o.slug, "PATCH", { disabled: !o.disabled }); renderOrgs(); } catch (e) { toast(e.message); } } }, o.disabled ? "Activar" : "Desactivar"))));
  pane.replaceChildren(el("h1", {}, "Organizaciones"), el("p", { class: "lead" }, ME.desktop ? "Cada organización (empresa) tiene su propia base de datos y sus archivos. Los datos nunca se borran desde aquí: una organización se desactiva." : "Cada organización (empresa) tiene su propia base de datos, archivos y usuarios con sus roles. Solo un super-admin las crea y puede entrar en todas. Los datos nunca se borran desde aquí: una organización se desactiva."),
    el("div", { class: "row", style: "margin:16px 0" }, el("button", { class: "btn primary", onclick: newOrg }, "Nueva organización")),
    el("div", { style: "overflow-x:auto" }, el("table", {}, el("thead", {}, el("tr", {}, ...(ME.desktop ? ["Organización", "Estado", ""] : ["Organización", "Usuarios", "Estado", ""]).map((h) => el("th", {}, h)))), el("tbody", {}, rows))));
}
async function newOrg() {
  const err = el("p", { class: "err", role: "alert" }), name = el("input", { type: "text", id: "on", autocomplete: "off" }), slug = el("input", { type: "text", id: "os", autocomplete: "off", autocapitalize: "none", spellcheck: "false" }),
    au = el("input", { type: "text", id: "oau", autocomplete: "off", autocapitalize: "none", spellcheck: "false" }), an = el("input", { type: "text", id: "oan", autocomplete: "off" });
  name.addEventListener("input", () => { if (!slug.dataset.touched) slug.value = name.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+|-+$/g, "").slice(0, 30); });
  slug.addEventListener("input", () => { slug.dataset.touched = "1"; });
  const form = el("form", {}, el("label", { for: "on" }, "Nombre de la empresa"), name, el("label", { for: "os" }, "Identificador (minúsculas, números y guiones)"), slug,
    ...(ME.desktop ? [] : [el("p", { class: "lead", style: "margin-top:14px" }, "Primer administrador de la organización (opcional; podrás crear más usuarios después, y a ti mismo ya te puedes añadir desde Usuarios):"),
    el("label", { for: "oau" }, "Usuario"), au, el("label", { for: "oan" }, "Nombre visible"), an]), err,
    buttons(el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar"), el("button", { class: "btn primary", type: "submit" }, "Crear")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    try {
      const r = await api("orgs", "POST", { name: name.value.trim(), slug: slug.value.trim(), ...(au.value.trim() ? { admin: { username: au.value.trim(), name: an.value.trim() } } : {}) });
      modal.close(true);
      if (r.admin?.password) await secretDialog("Organización creada", `Contraseña temporal de ${r.admin.user.username} (administrador de ${r.org.name}):`, r.admin.password); else toast("Organización creada");
      const me = await api("me"); ME = me; renderOrgs();
    } catch (x) { err.textContent = x.message; }
  });
  await modal("Nueva organización", form); name.focus();
}

// ---- single top bar: search, notifications, agent, language, theme ---------------------------------------------------------------------------
const appFetch = (path, opts) => fetch("/app/api/" + path, { credentials: "same-origin", headers: { "x-requested-with": "collado", "content-type": "application/json" }, ...opts }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || r.status); return d; });
let DICT = null;
const entityName = (e) => { const v = DICT?.e?.[e] || e; return v.split("|")[0]; };
async function loadDict() { try { DICT = await appFetch("i18n/" + (store.get("collado.lang") || (navigator.language || "es").slice(0, 2))); } catch { DICT = null; } }
function initSearch() {
  if (!has("app.view")) return; const wrap = $("#gsearch-wrap"), inp = $("#gsearch"), res = $("#gresults"); wrap.hidden = false; let timer;
  inp.addEventListener("input", () => { clearTimeout(timer); const q = inp.value.trim(); if (q.length < 2) { res.hidden = true; return; }
    timer = setTimeout(async () => { try { if (!DICT) await loadDict(); const r = await appFetch("search?q=" + encodeURIComponent(q)); res.replaceChildren(...(r.results.length ? r.results.slice(0, 14).map((x) => el("button", { type: "button", onclick: () => { res.hidden = true; inp.value = ""; goApp(`#/e/${x.entity}/${x.id}`); } }, el("span", {}, x.label), el("span", { class: "kind" }, entityName(x.entity)))) : [el("div", { class: "who" }, "Sin resultados")])); res.hidden = false; } catch { res.hidden = true; } }, 220); });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) res.hidden = true; });
}
function initBell() {
  if (!has("app.view")) return; const b = $("#bell"), cnt = $("#bellcnt"); b.hidden = false;
  const refresh = async () => { try { const r = await appFetch("notifications"); cnt.hidden = !r.unread; cnt.textContent = String(r.unread); return r; } catch { return null; } };
  b.addEventListener("click", async () => { const r = (await refresh()) || { rows: [] };
    const list = el("div", {}, r.rows.length ? r.rows.map((n) => el("button", { type: "button", class: "notif" + (n.read ? "" : " unread"), onclick: () => { modal.close(null); if (n.link) goApp(n.link); } }, el("b", {}, n.title), n.body && !String(n.body).startsWith("{") ? el("div", {}, n.body) : "", el("div", { class: "mono", style: "font-size:12px" }, fmtDate(n.created)))) : el("p", {}, "No tienes notificaciones."),
      buttons(el("button", { class: "btn", onclick: async () => { await appFetch("notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }).catch(() => {}); modal.close(null); refresh(); } }, "Marcar todo como leído"), el("button", { class: "btn primary", onclick: () => modal.close(null) }, "Cerrar")));
    modal("Notificaciones", list); });
  refresh(); setInterval(refresh, 60000);
}
function initAsk() {
  if (!has("agent.console")) return; const b = $("#ask"); b.hidden = false;
  b.addEventListener("click", async () => {
    const ta = el("textarea", { rows: "5", "aria-label": "Qué necesitas", placeholder: "Escribe lo que necesitas…" }); const err = el("p", { class: "err", role: "alert" });
    const send = el("button", { class: "btn primary", onclick: async () => { if (!ta.value.trim()) return; try { await api("agent/send", "POST", { text: `${ta.value.trim()}\n\n(Contexto: estoy viendo ${appHash} en Collado)` }); modal.close(true); setDock(true); toast("Enviado al agente"); } catch (e) { err.textContent = e.message; } } }, "Enviar");
    modal("Preguntar al agente", el("div", {}, el("p", { class: "lead" }, "Se escribe en tu consola de Claude Code junto con la pantalla en la que estás."), ta, err, buttons(el("button", { class: "btn", onclick: () => modal.close(null) }, "Cancelar"), send)));
  });
}
function applyTheme(t, notify = true) {
  document.documentElement.dataset.theme = t; store.set("collado-theme", t); store.set("collado.theme", t);
  if (notify) $("#appframe").contentWindow?.postMessage({ type: "collado:theme", theme: t }, location.origin);
}
function initNavBtn() {
  const b = $("#navbtn"); if (!has("app.view")) return; b.hidden = false;
  b.addEventListener("click", () => { if (current !== "app") location.hash = "#/app"; $("#appframe").contentWindow?.postMessage({ type: "collado:toggle-nav" }, location.origin); });
}

// ---- boot ---------------------------------------------------------------------------------------------------------------------------------
async function boot() {
  ME = await api("me"); CATALOGUE = ME.catalogue;
  const nav = $("#tabs");
  for (const a of nav.querySelectorAll("a")) { const spec = a.dataset.perm; const ok = spec.includes("&") ? spec.split("&").every(has) : spec.split("|").some(has); if (!ok || (ME.desktop && (a.dataset.view === "admin" || a.dataset.view === "service"))) a.remove(); }   // desktop: Log lives in the settings menu
  nav.hidden = false;
  const menu = $("#menu"), pop = $("#menupop");
  if (ME.desktop) menu.replaceChildren(ico("settings"), " Configuración"); else menu.textContent = ME.user.name || ME.user.username; menu.hidden = false;   // desktop: one person with every permission, so no name: the menu is just the settings
  const closePop = () => { pop.hidden = true; menu.setAttribute("aria-expanded", "false"); };
  menu.addEventListener("click", () => { const open = pop.hidden; pop.hidden = !open; menu.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target) && e.target !== menu) closePop(); });
  const lang = store.get("collado.lang") || (navigator.language || "es").slice(0, 2);
  const setLang = (l) => { store.set("collado.lang", l); closePop(); DICT = null; $("#appframe").contentWindow?.location.reload(); };
  pop.replaceChildren(...[ME.desktop ? false : el("div", { class: "who" }, `${ME.user.username} · ${ME.user.roles.join(", ") || "sin roles"}${ME.org ? " · " + ME.org.name : ""}`),
    has("app.view") ? el("div", {}, el("div", { class: "sub" }, "Idioma de la app"), ...[["es", "Castellano"], ["ca", "Català"], ["en", "English"]].map(([k, v]) => el("button", { onclick: () => setLang(k) }, lang.startsWith(k) && ico("ok"), (lang.startsWith(k) ? " " : "") + v)), el("div", { class: "sep" })) : "",
    el("button", { onclick: () => { closePop(); applyTheme(document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) ? "light" : "dark"); } }, "Cambiar tema claro/oscuro"),
    el("button", { onclick: () => { closePop(); Tour.open(); } }, ME.desktop ? "Ayuda: recorrido por la plataforma" : "Recorrido por la plataforma"),
    ME.desktop && has("service.manage") ? el("button", { onclick: () => { closePop(); location.hash = "#/service"; } }, "Log") : false,
    ME.desktop && window.colladoDesktop?.cloud ? el("button", { onclick: () => { closePop(); cloudDialog(); } }, "Nube y sincronización…") : false,
    has("agent.console") ? el("button", { onclick: () => { closePop(); Tutor.open(true); } }, (ME.desktop ? "Iniciar sesión en Claude Code" : "Tutorial: iniciar sesión en Claude Code")) : false,
    ME.desktop ? false : el("button", { onclick: () => { closePop(); passwordDialog(false); } }, "Cambiar contraseña"),
    ME.desktop ? false : el("button", { onclick: async () => { closePop(); if (ME.user.totp) toast("La verificación en dos pasos ya está activa. Un administrador puede restablecerla si pierdes el móvil."); else await enrollDialog(false); } }, "Verificación en dos pasos"),
    ME.desktop ? false : el("button", { onclick: async () => { await api("logout", "POST").catch(() => {}); location.replace("/login"); } }, "Cerrar sesión")].filter(Boolean));   // replaceChildren would print `false` as text
  { const t = store.get("collado-theme") || store.get("collado.theme"); if (t) { document.documentElement.dataset.theme = t; store.set("collado.theme", t); } }
  if (ME.user.must_change) await forcePasswordChange();
  if (ME.user.needs_enroll) await enrollDialog(true);
  addEventListener("hashchange", route); route();
  if (!ME.desktop) { $("#tour-btn").hidden = false; } $("#tour-btn").addEventListener("click", () => Tour.isOpen() ? Tour.close(true) : Tour.open());
  initOrgSwitch(); initDock(); initSearch(); initBell(); if (!ME.desktop) initAsk(); initNavBtn(); loadDict(); Tutor.maybeStart();
  const led = $("#led"), txt = $("#ledtxt");
  const poll = async () => {
    try {
      const s = await api("service/status"); const a = s.app;
      led.hidden = false; led.className = "led " + (a.healthy ? "ok" : a.state === "down" || a.state === "crashed" ? "bad" : ""); txt.textContent = a.healthy ? "App en marcha" : `App: ${a.state}`;
    } catch { led.hidden = true; }
  };
  if (!ME.desktop) { poll(); setInterval(poll, 10000); }   // desktop: no "app running" indicator (and one timer less)
}
boot().catch((e) => { document.body.append(el("pre", { style: "padding:16px;color:var(--bad)" }, "No se pudo iniciar la interfaz: " + e.message)); });
