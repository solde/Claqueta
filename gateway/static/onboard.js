// First-login tutorial: walks a new person through logging in to Claude Code in THEIR console (each person has their own system user and login).
// It watches the terminal (for the login link) and the server (has the credentials file appeared?) and moves on by itself. Uses shell.js helpers
// (el, $, api, has, toast, store, TERMS, setDock, selectSession, canConsole). Loaded before shell.js; nothing runs until Tutor.maybeStart().
"use strict";
const Tutor = (() => {
  const SKIP = "collado.tutor.skip";                // sessionStorage: "Ahora no" hides it until the next login session
  const HOST = /^https:\/\/(?:[\w-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)\//;
  let card = null, step = 0, timer = null, poll = null, wasLoggedIn = null, sentCode = false;
  const enc = new TextEncoder();
  const term = () => TERMS.claude;
  const send = (seq) => { const t = term(); if (t?.ws?.readyState === 1) { t.ws.send(enc.encode(seq)); t.term?.focus(); return true; } toast("La consola aún no está conectada"); return false; };

  /** Text of the terminal (wrapped rows joined, so a long login link comes back in one piece). */
  function termText() {
    const t = term()?.term; if (!t) return "";
    const b = t.buffer.active, out = [];
    for (let i = Math.max(0, b.length - 300); i < b.length; i++) { const l = b.getLine(i); if (!l) continue; const s = l.translateToString(true); if (l.isWrapped && out.length) out[out.length - 1] += s; else out.push(s); }
    return out.join("\n");
  }
  /** Claude Code's UI hard-wraps a long link into rows of the terminal's width with real line breaks (the terminal does not know they are one line): glue the continuation rows back. */
  function unwrapLinks(text, cols) {
    const rows = text.split("\n"), out = [];
    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      while (/https?:\/\/\S*$/.test(r) && r.length >= cols - 3 && i + 1 < rows.length && /^\S+$/.test(rows[i + 1].trimEnd())) { r += rows[++i].trimEnd(); }   // full-width row ending in a link, next row has no spaces: it continues it
      out.push(r);
    }
    return out.join("\n");
  }
  function loginUrl() {
    const hits = [...unwrapLinks(termText(), term()?.term?.cols || 80).matchAll(/https:\/\/[^\s"'<>│║]+/g)].map((m) => m[0]).filter((u) => HOST.test(u));
    return hits.length ? hits[hits.length - 1] : null;
  }
  const sawClaude = () => /claude code|welcome|choose the text style|login method|select login/i.test(termText());

  const kbtn = (label, seq, title) => el("button", { class: "btn sm", type: "button", title, onmousedown: (e) => e.preventDefault(), onclick: () => send(seq) }, label);
  const keys = (...ks) => el("div", { class: "coach-keys", role: "group", "aria-label": "Teclas para el terminal" }, ...ks);
  const status = (ok, text) => el("p", { class: "coach-status " + (ok ? "ok" : "wait"), "aria-live": "polite" }, el("span", { class: "dot", "aria-hidden": "true" }), text);

  // Every step: title, a body builder (re-run each tick, so it can show live state), and optionally `auto()` -> true to advance by itself.
  const STEPS = [
    { get title() { return "Bienvenido a " + appName(); }, body: () => [
      el("p", {}, "Tu agente es Claude Code y trabaja desde tu propia consola, con tu carpeta y tu cuenta. Solo tienes que iniciar sesión una vez."),
      el("p", {}, "Te acompaño paso a paso (son 2 minutos). Necesitas una cuenta de Claude (Pro, Max, Team o Enterprise) y poder abrir un enlace en tu navegador."),
    ], next: "Empezar" },
    { title: "Mira la consola", on() { setDock(true); selectSession("claude"); }, body: () => [
      el("p", {}, "A la derecha tienes la consola con Claude Code. Si te pregunta por el estilo de texto o los colores, elige el que quieras y pulsa Intro."),
      keys(kbtn("↑", "\x1b[A"), kbtn("↓", "\x1b[B"), kbtn("Intro", "\r")),
      status(sawClaude(), sawClaude() ? "Claude Code está en marcha" : "Esperando a que arranque Claude Code…"),
    ], auto: () => false },
    { title: "Elige iniciar sesión", body: () => [
      el("p", {}, ["Cuando pregunte cómo quieres iniciar sesión, elige ", el("b", {}, "«Claude account with subscription»"), " (la primera opción) y pulsa Intro."]),
      el("p", {}, "Si esa pantalla ya pasó o no apareció, pulsa este botón para empezar el inicio de sesión:"),
      keys(kbtn("↑", "\x1b[A"), kbtn("↓", "\x1b[B"), kbtn("Intro", "\r"), el("button", { class: "btn sm primary", type: "button", onclick: () => send("/login\r") }, "Escribir /login")),
      status(!!loginUrl(), loginUrl() ? "¡Enlace de inicio de sesión recibido!" : "Esperando el enlace de inicio de sesión…"),
    ], auto: () => !!loginUrl() },
    { title: "Abre el enlace", body: () => {
      const u = loginUrl();
      return [
        el("p", {}, "Se abrirá una pestaña nueva de Claude. Inicia sesión si hace falta y pulsa ", el("b", {}, "Autorizar"), ". Te mostrará un código: cópialo y vuelve aquí."),
        u ? el("div", { class: "row" },
          el("a", { class: "btn primary", href: u, target: "_blank", rel: "noopener noreferrer", id: "coach-open" }, "Abrir el enlace ", ico("external")),
          el("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(u); toast("Enlace copiado"); } catch { toast("No se pudo copiar: selecciónalo en el terminal"); } } }, "Copiar enlace"))
          : status(false, "Aún no hay enlace. Vuelve al paso anterior (escribe /login)."),
        el("p", { class: "coach-hint" }, "Consejo: el enlace también se puede pulsar directamente en el terminal."),
      ];
    } },
    { title: "Pega el código", body: () => {
      const inp = el("input", { type: "text", id: "coach-code", placeholder: "Pega aquí el código", autocomplete: "off", spellcheck: "false", "aria-label": "Código de autorización" });
      const go = () => { const v = inp.value.trim(); if (!v) return inp.focus(); if (send(v)) { setTimeout(() => send("\r"), 200); sentCode = true; inp.value = ""; toast("Código enviado"); } };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      return [
        el("p", {}, "Pega el código que te mostró el navegador y pulsa Enviar. También puedes pegarlo directamente en el terminal (Ctrl/⌘+V) y pulsar Intro."),
        el("div", { class: "row" }, inp, el("button", { class: "btn primary", type: "button", onclick: go }, "Enviar")),
        el("p", { class: "coach-hint" }, "El código es personal: no lo compartas con nadie."),
        status(false, sentCode ? "Comprobando tu sesión…" : "Esperando el código…"),
      ];
    } },
    { title: "¡Listo!", body: () => [
      el("p", {}, "Claude Code ya tiene tu sesión. Se queda guardada en este equipo, no tendrás que repetirlo."),
      el("p", {}, "Prueba a preguntarle algo:"),
      el("button", { class: "btn primary", type: "button", onclick: async () => { try { await api("agent/send", "POST", { text: "Hola. Preséntate en dos frases y dime tres cosas que puedes hacer por mí en Collado." }); toast("Enviado al agente"); } catch (e) { toast(e.message); } } }, "Presentarte al agente"),
      el("button", { class: "btn", type: "button", onclick: () => { close(true); Tour.open(); } }, "Recorrido por la plataforma"),
      el("p", { class: "coach-hint" }, "Puedes repetir este tutorial desde tu menú de usuario."),
    ], final: true },
  ];

  function render() {
    if (!card) return;
    const s = STEPS[step], active = document.activeElement, keepFocus = card.contains(active) && active.tagName === "INPUT" ? { id: active.id, v: active.value, a: active.selectionStart } : null;
    const dots = el("div", { class: "coach-dots", "aria-hidden": "true" }, STEPS.map((_, i) => el("i", { class: i < step ? "done" : i === step ? "now" : "" })));
    const nav = el("div", { class: "row coach-nav" },
      step > 0 && !s.final ? el("button", { class: "btn sm", type: "button", onclick: () => go(step - 1) }, "‹ Atrás") : false, el("span", { class: "grow" }),
      s.final ? el("button", { class: "btn primary", type: "button", onclick: () => close(true) }, "Terminar")
        : [el("button", { class: "btn sm", type: "button", onclick: () => close(false) }, "Ahora no"), step === 4 ? false : el("button", { class: "btn primary", type: "button", onclick: () => go(step + 1) }, s.next || "Siguiente ›")]);
    card.replaceChildren(el("div", { class: "coach-head" }, el("span", { class: "coach-step" }, `Paso ${step + 1} de ${STEPS.length}`), dots), el("h2", { id: "coach-title" }, s.title), ...s.body(), nav);
    if (keepFocus) { const i = card.querySelector("#" + keepFocus.id); if (i) { i.value = keepFocus.v; i.focus(); try { i.setSelectionRange(keepFocus.a, keepFocus.a); } catch { /* ignore */ } } }
  }
  function go(n) { tick.sig = null; step = Math.max(0, Math.min(STEPS.length - 1, n)); STEPS[step].on?.(); render(); card?.querySelector("input,.btn.primary")?.focus?.({ preventScroll: true }); }

  async function check() {
    try {
      const r = await api("agent/login-status"); if (wasLoggedIn === null) wasLoggedIn = !!r.logged_in;   // reopened by someone already logged in: just let them read the steps
      if (r.logged_in && !wasLoggedIn && step < STEPS.length - 1) go(STEPS.length - 1);
    } catch { /* offline: keep going */ }
  }
  function tick() {
    if (!card) return; const s = STEPS[step];
    if (!s.final && s.auto?.() && step < STEPS.length - 1) return go(step + 1);
    const sig = JSON.stringify([step, sawClaude(), loginUrl(), sentCode]);   // re-render only when something changed (a rebuilt button would swallow a click in progress)
    if (sig !== tick.sig) { tick.sig = sig; if (document.activeElement?.tagName !== "INPUT") render(); }
  }
  function close(done) {
    clearInterval(timer); clearInterval(poll); timer = poll = null; card?.remove(); card = null;
    if (!done) { try { sessionStorage.setItem(SKIP, "1"); } catch { /* ignore */ } }
    $("#dock-toggle")?.focus?.();
  }
  // ---- desktop: automatic login. No steps in the console: the app starts `claude auth login`, the browser opens by itself and the person only has to authorise there ----------------------
  let auto = null, autoTimer = null;
  const AUTO_ERR = { not_installed: "Claude Code no está instalado en este equipo. Instálalo una vez (macOS/Linux: curl -fsSL https://claude.ai/install.sh | bash · Windows: irm https://claude.ai/install.ps1 | iex) y pulsa Reintentar.", login_failed: "No se completó el inicio de sesión.", timeout: "Se agotó el tiempo esperando la autorización.", cancelled: "Cancelado." };
  function stopAuto() { clearInterval(autoTimer); autoTimer = null; auto?.remove(); auto = null; }
  async function autoLogin() {
    if (auto || !canConsole() || !has("agent.console")) return; stopAuto();
    const status = el("p", { class: "coach-status wait", "aria-live": "polite" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, "Abriendo el navegador para iniciar sesión en Claude…"));
    const fallback = el("div", { hidden: true }), msg = (ok, t) => { status.className = "coach-status " + (ok === true ? "ok" : ok === false ? "bad" : "wait"); status.lastChild.textContent = t; };
    auto = el("aside", { class: "coach", role: "dialog", "aria-label": "Iniciar sesión en Claude" }, el("div", { class: "coach-head" }, el("h2", {}, "Inicio de sesión en Claude")), el("p", {}, "Se abre tu navegador: inicia sesión y pulsa «Autorizar». Esta ventana se cierra sola al terminar."), status, fallback,
      el("div", { class: "row end coach-nav" }, el("button", { class: "btn sm", type: "button", onclick: async () => { try { await api("agent/login/cancel", "POST"); } catch { /* ignore */ } stopAuto(); } }, "Cancelar")));
    document.body.append(auto); let shownUrl = "";
    const showFallback = (url) => {
      if (shownUrl === url) return; shownUrl = url; const inp = el("input", { type: "text", placeholder: "Código (solo si la página te lo muestra)", autocomplete: "off", spellcheck: "false", "aria-label": "Código de autorización" });
      const send = async () => { const v = inp.value.trim(); if (!v) return; try { await api("agent/login/code", "POST", { code: v }); inp.value = ""; toast("Código enviado"); } catch (e) { toast(e.message); } };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
      fallback.hidden = false; fallback.replaceChildren(el("p", { class: "coach-hint" }, "¿No se abrió el navegador?"), el("div", { class: "row" }, el("a", { class: "btn sm primary", href: url, target: "_blank", rel: "noopener noreferrer" }, "Abrir el enlace ", ico("external")),
        el("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch { toast("No se pudo copiar"); } } }, "Copiar enlace")), el("div", { class: "row" }, inp, el("button", { class: "btn sm", type: "button", onclick: send }, "Enviar")));
    };
    const fail = (code) => { clearInterval(autoTimer); autoTimer = null; msg(false, AUTO_ERR[code] || `No se pudo iniciar sesión (${code}).`); auto.querySelector(".coach-nav").prepend(el("button", { class: "btn sm primary", type: "button", onclick: () => { stopAuto(); autoLogin(); } }, "Reintentar")); };
    try { const s0 = await api("agent/login/start", "POST"); if (s0.state === "error") return fail(s0.error); } catch (e) { return fail(e.message); }
    autoTimer = setInterval(async () => {
      let s; try { s = await api("agent/login/status"); } catch { return; }
      if (s.logged_in || s.state === "done") { clearInterval(autoTimer); autoTimer = null; msg(true, "¡Sesión iniciada! Reiniciando la consola…"); toast("Claude Code: sesión iniciada"); try { connect("claude"); } catch { /* console not open */ } setTimeout(stopAuto, 1800); return; }
      if (s.state === "error") return fail(s.error); if (s.url) { msg(null, "Esperando a que autorices en el navegador…"); showFallback(s.url); }
    }, 1500);
  }
  function open(force = false) {
    if (ME.desktop) { if (!force && ME.noAutoLogin) return; if (force) { api("agent/login-status").then((r) => (r.logged_in ? toast("Claude Code ya tiene la sesión iniciada") : autoLogin())).catch(() => autoLogin()); } else autoLogin(); return; }
    if (card || !canConsole() || !has("agent.console")) return;
    if (!force) { try { if (sessionStorage.getItem(SKIP)) return; } catch { /* ignore */ } }
    try { sessionStorage.removeItem(SKIP); } catch { /* ignore */ }
    sentCode = false; wasLoggedIn = null;
    card = el("aside", { id: "coach", class: "coach", role: "dialog", "aria-labelledby": "coach-title", "aria-modal": "false" }); document.body.append(card);
    card.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); });
    go(0); timer = setInterval(tick, 1000); poll = setInterval(check, 2500); check();
  }
  /** At boot: show the tutorial to anyone with a console who has not logged in to Claude Code yet. */
  async function maybeStart() {
    if (!canConsole() || !has("agent.console")) return;
    try { const r = await api("agent/login-status"); if (r.logged_in === false) open(false); } catch { /* ignore */ }
  }
  return { open, maybeStart, close, isOpen: () => !!card || !!auto, loginUrl, unwrapLinks, autoLogin };
})();
