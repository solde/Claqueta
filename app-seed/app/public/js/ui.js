// UI components in the neobrutalism kit (nb.css). Emoji are the icon set: no assets, always aligned, hidden from screen readers.
import { h, $, clear } from "./dom.js";
import { t, errText, optLabel } from "./i18n.js";

const ICONS = { building: "🏢", flow: "🧭", tv: "📺", layers: "🗂️", film: "🎞️", flag: "🚩", check: "✅", chat: "💬", stamp: "🛂", bell: "🔔", users: "👥", list: "📋", alert: "⚠️", person: "👤", scale: "⚖️", calendar: "📅",
  camera: "🎥", clock: "⏱️", euro: "💶", cart: "🛒", receipt: "🧾", bank: "🏦", gift: "🎁", tag: "🏷️", handshake: "🤝", megaphone: "📢", bag: "🛍️", contract: "📝", key: "🔐", music: "🎵", shield: "🛡️", inbox: "📥",
  archive: "🗄️", reel: "🎬", spec: "📐", truck: "🚚", pen: "🖋️", antenna: "📡", chart: "📊", target: "🎯", swords: "⚔️", doc: "📄", palette: "🎨", template: "🧩", download: "⬇️", robot: "🤖", search: "🔎", plus: "＋",
  edit: "✏️", trash: "🗑️", close: "✕", menu: "☰", filter: "⏷", link: "🔗", upload: "⬆️", history: "🕘", settings: "⚙️", home: "🏠", globe: "🌐", sun: "☀️", moon: "🌙", back: "←", next: "→", save: "💾", eye: "👁️", print: "🖨️", copy: "⧉", up: "▲", down: "▼", ok: "✔", warn: "⚠", err: "✖", info: "ℹ", ics: "🗓️", dash: "🧭", money: "💰", sparkle: "✨", send: "➤" };
export const ch = (i, text) => [icon(i), " ", text];
export const icon = (n, cls = "") => h("span", { class: ["ico", cls], "aria-hidden": "true" }, ICONS[n] || n || "•");

const GREEN = ["done", "approved", "paid", "delivered", "aired", "active", "confirmed", "accepted", "signed", "executed", "resolved", "ok", "pass", "granted", "cleared", "justified", "available", "validated", "final", "invoiced", "issued", "ready", "locked", "mitigated", "ingest_ok", "aired"];
const YELLOW = ["pending", "planned", "todo", "draft", "proposed", "tentative", "planning", "preparing", "queued", "received", "review", "proposal", "development", "script", "recorded", "applied", "signing", "open", "low", "medium_"];
const BLUE = ["doing", "running", "in_progress", "working", "submitted", "sent", "edited", "qc", "production", "negotiation", "negotiating", "partial", "partial_paid", "recorded_", "ingest", "confirmed_", "premiere", "live"];
const ORANGE = ["medium", "restricted", "pass_notes", "changes", "paused", "maintenance", "high", "semi", "expiring"];
const RED = ["rejected", "failed", "fail", "blocked", "blocker", "breach", "overdue", "void", "cancelled", "expired", "terminated", "denied", "lost", "declined", "unavailable", "sick", "revoked", "wontfix"];
export function statusColor(v) { v = String(v); return RED.includes(v) ? "red" : GREEN.includes(v) ? "green" : ORANGE.includes(v) ? "orange" : BLUE.includes(v) ? "blue" : YELLOW.includes(v) ? "yellow" : "white"; }
export const badge = (text, color = "yellow", extra = "") => h("span", { class: ["nb-badge", color !== "yellow" && `nb-badge--${color}`, extra] }, text);
export const statusBadge = (entity, field, v) => (v === null || v === undefined || v === "" ? null : badge(optLabel(entity, field, v), statusColor(v)));

export function btn(label, o = {}) {
  const { onclick, kind, sm, ico, type = "button", disabled, title, href, cls } = o;
  const attrs = { class: ["nb-btn", kind && `nb-btn--${kind}`, sm && "nb-btn--sm", !label && "nb-btn--icon", cls], type, disabled, title, "aria-label": title || undefined, onclick, ...(o["data-view"] ? { "data-view": o["data-view"] } : {}) };
  return href ? h("a", { ...attrs, href }, ico && icon(ico), label) : h("button", attrs, ico && icon(ico), label);
}

// ---- toast / modal / confirm -------------------------------------------------------------------------------------------------------
let toastEl, toastTimer;
export function toast(msg, kind = "ok") {
  const text = msg instanceof Error ? errText(msg) : (typeof msg === "string" && !msg.includes(" ") ? t(msg) : msg);
  const k = msg instanceof Error ? "error" : kind;
  if (toastEl) toastEl.remove(); clearTimeout(toastTimer);
  toastEl = h("div", { class: ["nb-toast", k !== "ok" && `nb-toast--${k}`], role: "status", "aria-live": "polite" }, icon(k === "error" ? "err" : k === "warn" ? "warn" : k === "info" ? "info" : "ok"), text);
  document.body.append(toastEl); toastTimer = setTimeout(() => toastEl?.remove(), k === "error" ? 6500 : 3200);
}
const stack = [];
export function modal({ title, body, actions, wide, onclose, dismiss = true }) {
  const prev = document.activeElement;
  const close = (v) => { overlay.remove(); stack.pop(); document.removeEventListener("keydown", onKey); prev?.focus?.(); onclose?.(v); };
  const closeBtn = h("button", { class: "nb-close", type: "button", "aria-label": t("close"), onclick: () => close() }, "✕");
  const dlg = h("div", { class: ["nb-dialog", wide && "nb-dialog--wide"], role: "dialog", "aria-modal": "true", "aria-label": title || "" }, dismiss && closeBtn, title && h("h2", title), body, actions && h("div.nb-row.end", { style: { marginTop: "18px" } }, actions));
  const overlay = h("div.nb-modal", { onmousedown: (e) => { if (dismiss && e.target === overlay) close(); } }, dlg);
  const onKey = (e) => { if (e.key === "Escape" && stack[stack.length - 1] === overlay && dismiss) close(); if (e.key === "Tab") trap(e, dlg); };
  stack.push(overlay); document.addEventListener("keydown", onKey); document.body.append(overlay);
  setTimeout(() => (dlg.querySelector("[autofocus], input:not([type=hidden]), select, textarea, button:not(.nb-close)") || closeBtn).focus(), 0);
  return { close, el: dlg };
}
function trap(e, root) { const f = [...root.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')]; if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
export function confirmDialog(text, { danger = false, ok = t("confirm"), title = t("are_you_sure") } = {}) {
  return new Promise((res) => { let done = false; const finish = (v) => { if (!done) { done = true; res(v); } }; const m = modal({ title, body: h("p", text), onclose: () => finish(false), actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }), btn(ok, { kind: danger ? "danger" : undefined, onclick: () => { finish(true); m.close(); } })] }); });
}
export function promptDialog(label, { value = "", title = "", type = "text", help = "" } = {}) {
  return new Promise((res) => { let done = false; const inp = h("input.nb-input", { type, value, autofocus: true }); const finish = (v) => { if (!done) { done = true; res(v); } };
    const m = modal({ title: title || label, body: h("div", h("label.nb-label", label), inp, help && h("div.nb-help", help)), onclose: () => finish(null), actions: [btn(t("cancel"), { kind: "secondary", onclick: () => m.close() }), btn(t("accept"), { onclick: () => { finish(inp.value); m.close(); } })] });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { finish(inp.value); m.close(); } }); });
}

// ---- layout bits ---------------------------------------------------------------------------------------------------------------------
export const card = (children, o = {}) => h("section", { class: ["nb-card", o.color && `nb-card--${o.color}`, o.flat && "nb-card--flat", o.tight && "nb-card--tight", o.cls], ...(o.attrs || {}) }, o.head && h("div.nb-card__head", o.head), children);
export const emptyState = (text, action) => h("div.empty", h("div.empty__ico", "∅"), h("p", text), action);
export const spinner = () => h("div.spinner", { role: "status", "aria-label": t("loading") }, "…");
export const pageHead = (title, sub, actions) => h("header.pagehead", h("div", h("h1.nb-h1", title), sub && h("p.nb-help", sub)), actions && h("div.nb-row", actions));
export function tabs(items, active, onChange, o = {}) {
  const bar = h("div.tabs", { role: "tablist" }, items.filter(Boolean).map((it) => h("button.nb-tab", { type: "button", role: "tab", "aria-selected": String(it.id === active), onclick: () => onChange(it.id), "data-tab": it.id }, it.icon && icon(it.icon), it.label, it.count !== undefined && it.count !== null && badge(String(it.count), "white"))));
  return bar;
}
export const selectWrap = (sel) => h("div.nb-selectwrap", sel);
export function progress(pct, o = {}) { const p = Math.max(0, Math.min(100, Number(pct) || 0)); const cls = o.warn !== undefined ? (pct >= 100 ? "bad" : pct >= o.warn ? "warn" : "") : ""; return h("div", { class: ["nb-progress", cls], role: "progressbar", "aria-valuenow": String(Math.round(p)), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: { width: p + "%" } }), h("span", Math.round(Number(pct) || 0) + "%")); }
export function kv(pairs) { return h("dl.kv", pairs.filter(Boolean).map(([k, v]) => h("div", h("dt", k), h("dd", v ?? "")))); }
export function dropdown(anchorLabel, items, o = {}) {
  const pop = h("div.nb-pop", { hidden: true, style: { right: "0", top: "100%", marginTop: "6px" } }, items.filter(Boolean).map((it) => h("button", { type: "button", onclick: () => { pop.hidden = true; it.onclick?.(); } }, it.icon && icon(it.icon), it.label)));
  const b = btn(anchorLabel, { kind: o.kind || "secondary", sm: true, ico: o.ico, onclick: (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; } });
  const wrap = h("div", { style: { position: "relative", display: "inline-block" } }, b, pop); document.addEventListener("click", () => { pop.hidden = true; }); return wrap;
}
export function copyText(text) { navigator.clipboard?.writeText(text).then(() => toast("copied"), () => toast("copy_failed", "warn")); }
