// Sends a request to the person's agent console (the shell that hosts the app types it there). Outside the shell (a plain browser tab) the text is shown to be copied.
import { h } from "./dom.js";
import { t } from "./i18n.js";
import { btn, modal, toast } from "./ui.js";

const embedded = () => window.parent !== window;

/** Resolves true when the text was delivered to the console. */
export function askAgent(text) {
  if (!embedded()) { const ta = h("textarea.nb-textarea", { rows: 8, readOnly: true }, text); const m = modal({ title: t("ask_agent"), body: h("div", h("p.nb-help", t("agent_copy_help")), ta), actions: [btn(t("close"), { onclick: () => m.close() })] }); ta.select(); return Promise.resolve(false); }
  return new Promise((resolve) => {
    const id = `${Date.now()}${Math.random()}`, done = (ok) => { window.removeEventListener("message", onMsg); clearTimeout(timer); resolve(ok); };
    const onMsg = (e) => { const m = e.data || {}; if (m.type !== "collado:agent-sent" || m.id !== id) return; if (!m.ok) toast(m.error || "error", "error"); done(!!m.ok); };
    const timer = setTimeout(() => done(false), 8000); window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "collado:agent-send", id, text }, location.origin);
  });
}
