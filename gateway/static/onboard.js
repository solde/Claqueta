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
      keys(kbtn("↑", "\x1b[A"), kbtn("↓", "\x1b[B"), kbtn("Intro ↵", "\r")),
      status(sawClaude(), sawClaude() ? "Claude Code está en marcha" : "Esperando a que arranque Claude Code…"),
    ], auto: () => false },
    { title: "Elige iniciar sesión", body: () => [
      el("p", {}, ["Cuando pregunte cómo quieres iniciar sesión, elige ", el("b", {}, "«Claude account with subscription»"), " (la primera opción) y pulsa Intro."]),
      el("p", {}, "Si esa pantalla ya pasó o no apareció, pulsa este botón para empezar el inicio de sesión:"),
      keys(kbtn("↑", "\x1b[A"), kbtn("↓", "\x1b[B"), kbtn("Intro ↵", "\r"), el("button", { class: "btn sm primary", type: "button", onclick: () => send("/login\r") }, "Escribir /login")),
      status(!!loginUrl(), loginUrl() ? "¡Enlace de inicio de sesión recibido!" : "Esperando el enlace de inicio de sesión…"),
    ], auto: () => !!loginUrl() },
    { title: "Abre el enlace", body: () => {
      const u = loginUrl();
      return [
        el("p", {}, "Se abrirá una pestaña nueva de Claude. Inicia sesión si hace falta y pulsa ", el("b", {}, "Autorizar"), ". Te mostrará un código: cópialo y vuelve aquí."),
        u ? el("div", { class: "row" },
          el("a", { class: "btn primary", href: u, target: "_blank", rel: "noopener noreferrer", id: "coach-open" }, "Abrir el enlace ↗"),
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
  function open(force = false) {
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
  return { open, maybeStart, close, isOpen: () => !!card, loginUrl, unwrapLinks };
})();
