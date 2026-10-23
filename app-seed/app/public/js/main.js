// Boot, navigation, router. Views are loaded lazily (ES modules, no build step).
import { h, $, mount } from "./dom.js";
import { api } from "./api.js";
import { S, loadI18n, t, entName, groupLabel, LANGS, setLang } from "./i18n.js";
import { btn, icon, badge, toast, modal, spinner, emptyState } from "./ui.js";
import { flush, setOrg } from "./offline.js";
import { renderDetail } from "./detail.js";
import { entityList, go } from "./lists.js";
import { remember } from "./forms.js";
import "./views/extras.js";

const app = $("#app"); let main, side, topbar;
const EMBEDDED = window.parent !== window;   // inside the Collado shell: it owns the single top bar (search, notifications, language, theme, agent)
const external = () => S.me?.external;
const can = (entity) => !!S.schema.entities[entity];

// ---- navigation tree ---------------------------------------------------------------------------------------------------------------
function navTree() {
  const e = (name, label) => (can(name) ? { id: name, label: label || entName(name, true), href: `#/e/${name}`, icon: S.schema.entities[name].icon } : null);
  if (external()) return [{ label: null, items: [{ id: "dash", label: t("nav_home"), href: "#/", icon: "home" }, { id: "programs", label: entName("programs", true), href: "#/programs", icon: "tv" }, e("tasks"), e("approvals"), e("documents"), e("deliveries"), e("qc_reports"), e("episodes")].filter(Boolean) }];
  return [
    { label: null, items: [{ id: "dash", label: t("nav_home"), href: "#/", icon: "home" }, { id: "programs", label: entName("programs", true), href: "#/programs", icon: "tv" }, e("tasks")] },
    { label: groupLabel("planning"), items: [{ id: "calendar", label: t("nav_calendar"), href: "#/calendar", icon: "calendar" }, can("episodes") && { id: "rundowns", label: t("nav_rundowns"), href: "#/rundowns", icon: "list" }, { id: "gantt", label: t("nav_gantt"), href: "#/gantt", icon: "flag" }, e("milestones"), e("bookings")].filter(Boolean) },
    { label: groupLabel("directory"), items: [e("people"), e("resources"), e("availability"), e("timesheets"), e("partners")].filter(Boolean) },
    can("budgets") && { label: groupLabel("finance"), items: [e("budgets"), e("bills"), e("purchase_orders"), e("client_invoices"), { id: "cashflow", label: t("nav_cashflow"), href: "#/finance/cashflow", icon: "money" }, { id: "tax", label: t("nav_tax"), href: "#/finance/tax", icon: "receipt" }, { id: "bank", label: t("nav_bank"), href: "#/finance/bank", icon: "bank" }, e("grants"), { id: "profit", label: t("nav_profit"), href: "#/finance/profit", icon: "chart" }].filter(Boolean) },
    can("sponsorships") && { label: groupLabel("commercial"), items: [e("sponsorships"), e("rate_cards"), e("ad_spots"), e("placements")].filter(Boolean) },
    can("contracts") && { label: groupLabel("legal"), items: [e("contracts"), e("rights"), e("cue_sheets"), e("processing_activities"), e("consents"), e("dsr_requests"), e("retention_policies")].filter(Boolean) },
    { label: groupLabel("content"), items: [e("assets"), e("qc_reports"), e("qc_issues"), e("deliveries"), e("delivery_specs"), e("compliance_checks"), e("editorial_lines")].filter(Boolean) },
    can("memoirs") && { label: groupLabel("memoirs"), items: [{ id: "memoirs", label: t("nav_memoirs"), href: "#/memoirs", icon: "book" }, can("media_items") && { id: "gallery", label: t("nav_gallery"), href: "#/gallery", icon: "image" }, e("locations")].filter(Boolean) },
    { label: groupLabel("broadcast"), items: [e("broadcasts"), { id: "ratings", label: t("nav_ratings"), href: "#/ratings", icon: "chart" }, can("ratings") && { id: "forecast", label: t("nav_forecast"), href: "#/forecast", icon: "trend" }, e("targets"), e("competitors")].filter(Boolean) },
    { label: groupLabel("collab"), items: [e("approvals"), e("risks"), e("comments"), { id: "alerts", label: t("nav_alerts"), href: "#/alerts", icon: "alert" }].filter(Boolean) },
    { label: groupLabel("docs"), items: [e("documents"), e("doc_templates"), e("brands"), e("exports")].filter(Boolean) },
    can("jobs") && S.me.perms.some((p) => p === "*" || p === "agent.jobs") && { label: groupLabel("agent"), items: [{ id: "jobs", label: t("nav_agent"), href: "#/agent", icon: "robot" }] },
    { label: groupLabel("settings"), items: [{ id: "settings", label: t("nav_settings"), href: "#/settings", icon: "settings" }, e("workflow_templates"), e("agreements"), e("members")].filter(Boolean) },
  ].filter(Boolean);
}
function drawSide() {
  const cur = location.hash || "#/";
  side.replaceChildren(...navTree().map((g) => h("div.side__group", g.label && h("div.side__label", g.label), g.items.map((it) => h("a", { class: ["side__link", (cur === it.href || (it.href !== "#/" && cur.startsWith(it.href + "/")) || (it.href !== "#/" && cur.startsWith(it.href + "?"))) && "active"], href: it.href, onclick: () => document.body.classList.remove("nav-open") }, icon(it.icon), h("span", it.label))))));
}

// ---- top bar -----------------------------------------------------------------------------------------------------------------------------
let unread = 0;
function drawTop() {
  const search = h("input.nb-input.top__search", { type: "search", placeholder: t("search_everything"), "aria-label": t("search"), oninput: onSearch, onfocus: onSearch, autocomplete: "off" });
  const results = h("div.nb-pop.top__results", { hidden: true });
  async function onSearch() { const q = search.value.trim(); if (q.length < 2) { results.hidden = true; return; } clearTimeout(onSearch.t); onSearch.t = setTimeout(async () => { const r = await api.get(`api/search?q=${encodeURIComponent(q)}`, { silent: true }).catch(() => ({ results: [] })); results.replaceChildren(...(r.results.length ? r.results.slice(0, 14).map((x) => h("a", { href: `#/e/${x.entity}/${x.id}`, onclick: () => { results.hidden = true; search.value = ""; } }, icon(S.schema.entities[x.entity]?.icon), h("span", x.label), h("span.nb-caption", entName(x.entity)))) : [h("div.nb-help", { style: { padding: "8px" } }, t("no_results"))])); results.hidden = false; }, 220); }
  document.addEventListener("click", (e) => { if (!e.target.closest(".top__search,.top__results")) results.hidden = true; });
  const bell = btn("", { ico: "bell", kind: "secondary", sm: true, title: t("notifications"), onclick: openNotifications, cls: "bell" });
  const lang = h("div.nb-selectwrap.top__lang", h("select.nb-select", { "aria-label": t("language"), onchange: (e) => setLang(e.target.value) }, Object.entries(LANGS).map(([k, v]) => h("option", { value: k, selected: k === S.lang }, v))));
  const theme = btn("", { ico: "sun", kind: "secondary", sm: true, title: t("theme"), onclick: toggleTheme });
  topbar.replaceChildren(btn("", { ico: "menu", kind: "secondary", sm: true, cls: "menu-btn", title: t("menu"), onclick: () => document.body.classList.toggle("nav-open") }), h("a.nb-logo", { href: "#/" }, h("span.dot"), "Collado"), h("div.top__searchwrap", search, results), h("span.nb-grow"), h("span.offline", { hidden: true, id: "offline" }, icon("warn"), " ", t("offline")), lang, theme, bell);
  refreshBell();
}
function toggleTheme() { const cur = document.documentElement.dataset.theme; const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("collado.theme", next); } catch { /* ignore */ } }
async function refreshBell() { try { const r = await api.get("api/notifications", { silent: true }); unread = r.unread; const b = $(".bell"); if (b) { b.querySelector(".cnt")?.remove(); if (unread) b.append(h("span.cnt", String(unread))); } window.__notifs = r.rows; } catch { /* offline */ } }
async function openNotifications() {
  const r = await api.get("api/notifications", { silent: true }).catch(() => ({ rows: [] }));
  const m = modal({ title: t("notifications"), body: h("div", r.rows.length ? r.rows.map((n) => h("a.notif", { class: n.read ? "" : "unread", href: n.link || "#/", onclick: () => { m.close(); } }, h("b", n.title), n.body && h("div.nb-help", n.body.startsWith("{") ? "" : n.body), h("span.nb-caption", new Date(n.created).toLocaleString(S.lang)))) : emptyState(t("no_notifications"))),
    actions: [btn(t("mark_all_read"), { kind: "secondary", onclick: async () => { await api.post("api/notifications/read", { all: true }); m.close(); refreshBell(); } })] });
}

// ---- router ----------------------------------------------------------------------------------------------------------------------------
const ROUTES = [
  [/^#?\/?$/, () => import("./views/dashboard.js").then((m) => m.dashboard)],
  [/^#\/programs$/, () => import("./views/programs.js").then((m) => m.programList)],
  [/^#\/p\/(\d+)(?:\/(\w+))?(?:\/(\d+))?/, () => import("./views/programs.js").then((m) => m.workspace)],
  [/^#\/e\/(\w+)\/(\d+)/, () => (root, m, params) => (m[1] === "documents" && !params.get("raw") ? go(`#/doc/${m[2]}`) : renderDetail(m[1], Number(m[2]), root))],
  [/^#\/e\/(\w+)/, () => (root, m) => entityPage(root, m[1])],
  [/^#\/calendar/, () => import("./views/planning.js").then((m) => m.masterCalendar)],
  [/^#\/rundowns/, () => import("./views/planning.js").then((m) => m.rundownIndex)],
  [/^#\/rundown\/(\d+)/, () => import("./views/planning.js").then((m) => m.rundownEditor)],
  [/^#\/gantt/, () => import("./views/planning.js").then((m) => m.ganttPage)],
  [/^#\/finance\/cashflow/, () => import("./views/finance.js").then((m) => m.cashflowPage)],
  [/^#\/finance\/tax/, () => import("./views/finance.js").then((m) => m.taxPage)],
  [/^#\/finance\/bank/, () => import("./views/finance.js").then((m) => m.bankPage)],
  [/^#\/finance\/profit/, () => import("./views/finance.js").then((m) => m.profitPage)],
  [/^#\/ratings/, () => import("./views/broadcast.js").then((m) => m.ratingsPage)],
  [/^#\/gallery/, () => import("./views/gallery.js").then((m) => m.galleryPage)],
  [/^#\/memoirs/, () => import("./views/memoir.js").then((m) => m.memoirsPage)],
  [/^#\/memoir\/(\d+)/, () => import("./views/memoir.js").then((m) => m.memoirPage)],
  [/^#\/forecast/, () => import("./views/forecast.js").then((m) => m.forecastPage)],
  [/^#\/alerts/, () => import("./views/dashboard.js").then((m) => m.alertsPage)],
  [/^#\/doc\/(\d+)/, () => import("./views/docs.js").then((m) => m.docEditor)],
  [/^#\/agent/, () => import("./views/docs.js").then((m) => m.agentPage)],
  [/^#\/settings(?:\/(\w+))?/, () => import("./views/settings.js").then((m) => m.settingsPage)],
];
export function entityPage(root, entity) {
  const ent = S.schema.entities[entity]; if (!ent) { root.replaceChildren(emptyState(t("not_found"))); return; }
  root.replaceChildren(h("header.pagehead", h("div", h("h1.nb-h1", icon(ent.icon), " ", entName(entity, true)))), entityList({ entity, openAfterCreate: true }));
}
async function route() {
  drawSide(); if (EMBEDDED) window.parent.postMessage({ type: "collado:route", hash: location.hash || "#/" }, location.origin); const hash = location.hash || "#/"; const base = hash.split("?")[0];
  for (const [re, loader] of ROUTES) { const m = re.exec(base); if (!m) continue; main.replaceChildren(spinner()); try { const fn = await loader(); const holder = h("div.page"); main.replaceChildren(holder); await fn(holder, m, new URLSearchParams(hash.split("?")[1] || "")); if (!EMBEDDED || document.hasFocus()) main.focus({ preventScroll: true }); window.scrollTo(0, 0); } catch (e) { console.error(e); main.replaceChildren(emptyState(t("load_failed"), btn(t("retry"), { onclick: route }))); } return; }
  main.replaceChildren(emptyState(t("not_found")));
}

// ---- boot ------------------------------------------------------------------------------------------------------------------------------------
async function boot() {
  try { const th = localStorage.getItem("collado.theme"); if (th) document.documentElement.dataset.theme = th; } catch { /* ignore */ }
  try {
    await loadI18n();
    [S.me, S.schema] = await Promise.all([api.get("api/me"), api.get("api/schema")]); setOrg(S.me.org);
  } catch (e) { app.replaceChildren(h("div.boot", h("h2", "Collado"), h("p", "No se pudo cargar la aplicación. / Could not load the app."), btn("Reload", { onclick: () => location.reload() }))); return; }
  topbar = h("header.topbar"); side = h("nav.side", { "aria-label": t("navigation") }); main = h("main#main.main", { tabindex: "-1" });
  app.replaceChildren(topbar, side, main, h("div.scrim", { onclick: () => document.body.classList.remove("nav-open") }));
  document.body.classList.toggle("embedded", EMBEDDED);
  if (!EMBEDDED) { drawTop(); setInterval(refreshBell, 60000); }
  window.addEventListener("hashchange", route); route();
  const banner = h("div.nb-alert.nb-alert--warn.offline-banner", { hidden: true, role: "status" }, icon("warn"), t("offline"));
  if (EMBEDDED) main.before(banner);
  const on = () => { if ($("#offline")) $("#offline").hidden = navigator.onLine; banner.hidden = navigator.onLine; if (navigator.onLine) flush((n) => { toast(t("synced", { n }), "ok"); route(); }); };
  window.addEventListener("online", on); window.addEventListener("offline", on); on();
  // The service worker is for the web build (offline cache of a remote server). On the desktop the server is on this computer: it would only intercept and copy every request. Remove it if an old one exists.
  if ("serviceWorker" in navigator) { if (document.documentElement.dataset.skin === "neu") navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {}); else navigator.serviceWorker.register("sw.js").catch(() => {}); }
  if (EMBEDDED) { const lay = () => window.parent.postMessage({ type: "collado:layout", compact: window.innerWidth <= 860 }, location.origin); window.addEventListener("resize", lay); lay(); }
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin) return; const d = e.data || {};
    if (d.type === "collado:navigate") location.hash = d.hash;
    else if (d.type === "collado:toggle-nav") document.body.classList.toggle("nav-open");
    else if (d.type === "collado:theme") document.documentElement.dataset.theme = d.theme;
  });
}
boot();
