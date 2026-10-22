// Guided tour of the whole platform: highlights each zone of the shell, switches view / opens the console for you, and offers a "try it" button.
// Steps depend on the person's permissions. Uses shell.js helpers (el, $, has, canConsole, setDock, setDockMax, goApp, applyTheme, Tutor); loaded before shell.js.
"use strict";
const Tour = (() => {
  const wide = () => matchMedia("(min-width: 901px)").matches;
  let card = null, spot = null, steps = [], i = 0, timer = null, sig = "", from = null, moved = false;
  const app = (hash) => { moved = true; goApp(hash); };   // the tour moves the app's own route around; it goes back to the dashboard when it ends

  // target: CSS selector of the zone to highlight (none/hidden -> centred card). on(): prepares the screen. tryit: optional [label, fn].
  const ALL = [
    { get title() { return "Recorrido por " + appName(); }, body: "En un par de minutos verás cada zona de la plataforma y podrás probarla. Usa ← → del teclado o los botones; Esc para salir.\nNo se cambia nada de tus datos." },
    { title: "Las secciones", target: "#tabs", get body() { return ME.desktop ? "Arriba tienes las secciones: Proyectos, Archivos, Log y Organizaciones." : "Arriba tienes las secciones. Solo aparecen las que tu rol permite: Proyectos, Archivos, Servicio y Usuarios."; } },
    { when: () => !$("#org-btn")?.hidden, title: "Tu organización", target: "#org-btn", get body() { return ME.desktop ? "Trabajas dentro de una organización (empresa): sus programas y archivos son solo suyos. Desde aquí saltas a otra; la página se recarga y tu agente pasa a trabajar en ella." : "Trabajas dentro de una organización (empresa): sus programas, archivos y usuarios son solo suyos. Desde aquí saltas a otra a la que tengas acceso; la página se recarga y tu agente pasa a trabajar en ella."; }, tryit: ["Abrir el selector", () => $("#org-btn")?.click()] },
    { when: () => has("app.view"), title: "Proyectos", target: "#pane-app", on: () => { app("#/"); }, body: "La app de producción de TV, radio y podcast: programas, episodios, equipo, finanzas, contratos y más. Cambia de idioma (es / ca / en) desde tu menú." },
    { when: () => has("app.view"), title: "El menú de la app", target: "#pane-app", on: () => { app("#/calendar"); }, body: "A la izquierda de la app, el menú agrupa: Planificación (calendario, escaletas, Gantt), Directorio, Finanzas, Comercial, Legal, Contenido, Emisión, Colaboración, Documentos y Ajustes. Verás lo que tu rol permita. En pantallas pequeñas se abre con ☰." },
    { when: () => has("app.view"), title: "Documentos con tu marca", target: "#pane-app", body: "En «Documentos» escribes en Markdown con datos vivos y exportas a PDF, Word, HTML, Excel o PowerPoint con marcas y plantillas propias." },
    { when: () => has("agent.jobs"), title: "Encargos al agente", target: "#pane-app", on: () => { app("#/agent"); }, body: "En «Agente» pides trabajos (informes, documentos, análisis) que Claude hace en segundo plano y te devuelve aquí." },
    { when: () => has("app.view"), title: "Búsqueda global", target: "#gsearch-wrap", tryit: ["Escribir en el buscador", () => $("#gsearch")?.focus()], body: "Busca programas, personas, contratos, episodios… de toda la plataforma. Empieza a escribir (mínimo 2 letras)." },
    { when: () => has("app.view"), title: "Notificaciones", target: "#bell", body: "Avisos de aprobaciones, menciones, vencimientos y alertas. El número rojo son los no leídos." },
    { when: () => has("agent.console"), title: "Preguntar al agente", target: "#ask", body: "Escribe una petición corta: llega a tu consola de Claude Code junto con la pantalla en la que estás, para que tenga contexto." },
    { when: () => canConsole(), title: "La consola", target: "#dock-toggle", on: () => setDock(true, { remember: false }), body: "Abre o cierra la consola (Ctrl+Alt+C). Es un panel al lado de la pantalla en la que estés.", tryit: ["Abrir / cerrar consola", () => setDock(!dockOpen, { remember: false })] },
    { when: () => canConsole(), title: "Tu agente y tu terminal", target: "#pane-console", on: () => setDock(true, { remember: false }), body: "«Claude Code» es tu agente personal, con tu carpeta y tu cuenta. «Terminal bash» es un terminal normal. La sesión sigue viva aunque cierres la pestaña. Abajo hay teclas especiales para móvil (Esc, Tab, flechas, Ctrl+C)." },
    { when: () => canConsole() && wide(), title: "Ajusta el ancho", target: "#splitter", on: () => setDock(true, { remember: false }), body: "Arrastra la barra para cambiar el ancho de la consola (también con ← →; doble clic la devuelve a su tamaño). «Maximizar» la pone a pantalla completa.", tryit: ["Maximizar / restaurar", () => setDockMax(!dockMax)] },
    { when: () => canConsole(), title: "Archivos", target: "#pane-files", on: () => { location.hash = "#/files"; }, body: "Un explorador tipo Finder de tu carpeta personal: sube (arrastra archivos o carpetas), descarga (carpetas en .zip), renombra, mueve, previsualiza con Espacio y recupera desde la papelera." },
    { when: () => has("service.manage") && ME.desktop, title: "Log", target: "#pane-service", on: () => { location.hash = "#/service"; }, body: "Estado de la app y su registro en directo. Si algo falla, aquí ves por qué; también puedes reiniciar la app." },
    { when: () => has("service.manage") && !ME.desktop, title: "Servicio", target: "#pane-service", on: () => { location.hash = "#/service"; }, body: "Solo para super-admins. Estado de la app que mantiene el agente (común a todas las organizaciones): reiniciar, volver a la última versión buena o restaurar el original, y ver el registro en directo." },
    { when: () => has("users.manage") && !ME.desktop, title: "Usuarios y roles", target: "#pane-admin", on: () => { location.hash = "#/admin"; }, body: "Crea personas de tu organización, asigna roles y permisos, restablece contraseñas y 2FA, y consulta la auditoría. Una persona puede estar en varias organizaciones con roles distintos en cada una." },
    { when: () => has("platform.admin"), title: "Organizaciones", target: "#pane-orgs", on: () => { location.hash = "#/orgs"; }, get body() { return ME.desktop ? "Crea una organización por empresa: cada una tiene su propia base de datos y sus archivos, y puedes saltar entre ellas. Una organización no se borra: se desactiva." : "Solo los super-admins crean organizaciones (con su primer administrador), pueden entrar en todas y crear usuarios en cualquiera desde «Usuarios». Una organización no se borra: se desactiva."; } },
    { get title() { return ME.desktop ? "Configuración" : "Tu menú"; }, target: "#menu", on: () => { location.hash = from?.hash || "#/app"; }, tryit: ["Cambiar tema claro/oscuro", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")], get body() { return ME.desktop ? "Configuración: aquí cambias el idioma y el tema, repites este recorrido y tienes el tutorial de Claude Code." : "Aquí cambias el idioma, el tema, la contraseña y la verificación en dos pasos, repites este recorrido y cierras sesión."; } },
    { title: "¡Eso es todo!", final: true, body: "Puedes repetir el recorrido cuando quieras con el botón «?» de la barra superior." },
  ];

  const cur = () => steps[i];
  const target = () => { const s = cur(); const t = s?.target && document.querySelector(s.target); if (!t) return null; const r = t.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(t).visibility !== "hidden" ? r : null; };

  function place() {
    if (!card) return;
    const r = target(), vw = innerWidth, vh = innerHeight, pad = 5;
    if (r) { Object.assign(spot.style, { display: "block", left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + 2 * pad + "px", height: r.height + 2 * pad + "px" }); spot.classList.remove("none"); }
    else { Object.assign(spot.style, { display: "block", left: vw / 2 + "px", top: vh / 2 + "px", width: "0px", height: "0px" }); spot.classList.add("none"); }
    const w = card.offsetWidth, h = card.offsetHeight, S = card.style;
    S.left = S.top = S.right = S.bottom = "auto";
    if (!wide()) { S.left = S.right = "8px"; if (r && r.top > vh * 0.5) S.top = "68px"; else S.bottom = "8px"; return; }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (!r) { S.left = (vw - w) / 2 + "px"; S.top = Math.max(16, (vh - h) / 2) + "px"; return; }
    const g = 14, cx = clamp(r.left + r.width / 2 - w / 2, 12, vw - w - 12), cy = clamp(r.top + r.height / 2 - h / 2, 12, vh - h - 12);
    const spots = [[cx, r.bottom + g], [cx, r.top - g - h], [r.right + g, cy], [r.left - g - w, cy]];
    const ok = spots.find(([x, y]) => x >= 8 && y >= 8 && x + w <= vw - 8 && y + h <= vh - 8);
    if (ok) { S.left = ok[0] + "px"; S.top = ok[1] + "px"; }
    else { S.bottom = "16px"; if (r.left + r.width / 2 > vw / 2) S.left = "16px"; else S.right = "16px"; }   // a big zone (a pane): card in the free corner
  }

  function render() {
    const s = cur(), last = i === steps.length - 1;
    const bar = el("div", { class: "tour-bar", "aria-hidden": "true" }, el("i", { style: `width:${Math.round(((i + 1) / steps.length) * 100)}%` }));
    const text = s.body.split("\n").map((p) => el("p", {}, p));
    const nav = el("div", { class: "row coach-nav" },
      i > 0 ? el("button", { class: "btn sm", type: "button", onclick: () => go(i - 1) }, "‹ Atrás") : false, el("span", { class: "grow" }),
      last ? [has("agent.console") ? el("button", { class: "btn sm", type: "button", onclick: () => { close(false); Tutor.open(true); } }, "Iniciar sesión en Claude Code") : false, el("button", { class: "btn primary", type: "button", id: "tour-next", onclick: () => close(false) }, "Terminar")]
        : [el("button", { class: "btn sm", type: "button", onclick: () => close(true) }, "Salir"), el("button", { class: "btn primary", type: "button", id: "tour-next", onclick: () => go(i + 1) }, i === 0 ? "Empezar" : "Siguiente ›")]);
    card.replaceChildren(el("div", { class: "coach-head" }, el("span", { class: "coach-step" }, `${i + 1} / ${steps.length}`)), bar, el("h2", { id: "tour-title" }, s.title), ...text,
      ...(s.tryit ? [el("div", { class: "row" }, el("button", { class: "btn sm", type: "button", onclick: s.tryit[1] }, "Pruébalo: " + s.tryit[0]))] : []), nav);
  }
  function go(n) {
    if (dockMax) setDockMax(false);
    i = Math.max(0, Math.min(steps.length - 1, n)); cur().on?.(); sig = ""; render(); place(); card.querySelector("#tour-next")?.focus({ preventScroll: true });
    const back = () => { if (card && document.activeElement?.closest?.(".term")) card.querySelector("#tour-next")?.focus({ preventScroll: true }); };   // the dock grabs the focus for the terminal; keep it on the tour
    back(); for (const ms of [150, 500]) setTimeout(() => { place(); back(); }, ms);   // views / the dock settle a moment after the switch
  }
  function onKey(e) {
    if (!card || e.target.closest?.("input,textarea,select")) return;
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "ArrowRight" && i < steps.length - 1) { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); go(i - 1); }
  }
  /** `restore`: put the screen back as it was when the tour started (leaving halfway); at the end it stays where the person is. */
  function close(restore) {
    clearInterval(timer); timer = null; document.removeEventListener("keydown", onKey, true); removeEventListener("resize", place);
    if (dockMax) setDockMax(false);
    card?.remove(); spot?.remove(); card = spot = null;
    if (moved) { moved = false; goApp("#/"); }
    if (restore && from) { if (location.hash !== from.hash) location.hash = from.hash; if (dockOpen !== from.dock) setDock(from.dock, { remember: false }); }
    from = null; $("#tour-btn")?.focus?.();
  }
  function open() {
    if (card) return;
    if (typeof Tutor !== "undefined" && Tutor.isOpen()) Tutor.close(false);
    steps = ALL.filter((s) => !s.when || s.when()); i = 0; from = { hash: location.hash || "#/app", dock: dockOpen };
    spot = el("div", { id: "tour-spot", class: "tour-spot", "aria-hidden": "true" });
    card = el("aside", { id: "tour", class: "tour-card", role: "dialog", "aria-labelledby": "tour-title", "aria-modal": "false" });
    document.body.append(spot, card);
    document.addEventListener("keydown", onKey, true); addEventListener("resize", place);
    timer = setInterval(() => { const r = target(), s = r ? [r.left, r.top, r.width, r.height].map(Math.round).join() : "-"; if (s !== sig) { sig = s; place(); } }, 250);
    go(0);
  }
  return { open, close, isOpen: () => !!card };
})();
