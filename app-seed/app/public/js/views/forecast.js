// Audience forecast: expected audience and share of the next broadcasts of a programme (from its measured history), plus a what-if for any slot.
import { h } from "../dom.js";
import { api } from "../api.js";
import { S, t, entName, optLabel, fieldLabel, fmt } from "../i18n.js";
import { btn, badge, card, pageHead, emptyState, ch, selectWrap } from "../ui.js";
import { go } from "../lists.js";

const W = 760, H = 260, L = 56, R = 12, T = 14, B = 34;
const nice = (v) => { const e = 10 ** Math.floor(Math.log10(Math.max(v, 1))); return Math.ceil((v / e) * 2) / 2 * e; };
const factorLabel = (f) => (f.factor === "weekday" ? fmt.weekday(`2024-01-0${Number(f.key) + 1}`) : f.factor === "band" ? t(`band_${f.key}`) : optLabel("broadcasts", "kind", f.key));
const sign = (v) => `${v > 0 ? "+" : ""}${fmt.num(v, 1)} %`;

/** History as a line and the forecast of the next broadcasts as a range (P10..P90) around the median. */
function forecastChart(hist, slots, key, digits) {
  const pts = hist.filter((x) => x[key] != null).map((x) => ({ x: x.date, v: Number(x[key]) })), fut = slots.filter((s) => s[key]).map((s) => ({ x: s.date, ...s[key] }));
  const all = [...pts.map((p) => p.v), ...fut.flatMap((f) => [f.p90, f.p10])]; if (!all.length) return null;
  const max = nice(Math.max(...all)), n = pts.length + fut.length, step = (W - L - R) / Math.max(1, n - 1), X = (i) => L + step * i, Y = (v) => T + (H - T - B) * (1 - v / max);
  const svg = h("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", preserveAspectRatio: "xMidYMid meet" });
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4; svg.append(h("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), style: "stroke:var(--nb-ink);stroke-width:1;opacity:.2" }), h("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 10 }, fmt.num(v, digits && max < 20 ? 1 : 0))); }
  if (fut.length) {
    const j0 = pts.length, top = fut.map((f, i) => `${X(j0 + i)},${Y(f.p90)}`), bot = fut.map((f, i) => `${X(j0 + i)},${Y(f.p10)}`).reverse(), anchor = pts.length ? [`${X(j0 - 1)},${Y(pts[j0 - 1].v)}`] : [];
    svg.append(h("polygon", { points: [...anchor, ...top, ...bot].join(" "), class: "fc-band" }), h("polyline", { points: [...anchor, ...fut.map((f, i) => `${X(j0 + i)},${Y(f.p50)}`)].join(" "), class: "fc-line fc-line--fc" }));
    fut.forEach((f, i) => svg.append(h("circle", { cx: X(j0 + i), cy: Y(f.p50), r: 4, class: "fc-dot fc-dot--fc" })));
  }
  if (pts.length) { svg.append(h("polyline", { points: pts.map((p, i) => `${X(i)},${Y(p.v)}`).join(" "), class: "fc-line" })); pts.forEach((p, i) => svg.append(h("circle", { cx: X(i), cy: Y(p.v), r: 3, class: "fc-dot" }))); }
  const labels = [...pts.map((p) => p.x), ...fut.map((f) => f.x)], every = Math.ceil(labels.length / 10);
  labels.forEach((d, i) => { if (i % every === 0) svg.append(h("text", { x: X(i), y: H - 12, "text-anchor": "middle", "font-size": 10 }, fmt.dateShort(d))); });
  return h("div", svg, h("div.legend", h("span", h("i.fc-key"), t("forecast_history")), h("span", h("i.fc-key.fc-key--fc"), t("forecast_median")), h("span", h("i.fc-key.fc-key--band"), t("forecast_range"))));
}
const range = (f, digits, unit = "") => (f ? h("span", h("b", fmt.num(f.p50, digits) + unit), h("span.nb-caption", ` (${fmt.num(f.p10, digits)}–${fmt.num(f.p90, digits)})`)) : "—");
const QCOLOR = { high: "green", medium: "yellow", low: "red", none: "white" };
const factorBadges = (fs) => (fs || []).map((f) => badge(`${factorLabel(f)} ${sign(f.pct)}`, f.pct >= 0 ? "green" : "orange"));

export async function forecastPage(root, m, params) {   // `root` is reassigned below to a grid wrapper once the header is drawn
  const progs = await api.get("api/e/programs?limit=200&sort=name&refs=0"); const pid = params.get("program") || progs.rows[0]?.id;
  root.append(pageHead(t("nav_forecast"), t("forecast_help")), h("div.nb-selectwrap", { style: { maxWidth: "300px", marginBottom: "16px" } }, h("select.nb-select", { "aria-label": entName("programs"), onchange: (e) => go(`#/forecast?program=${e.target.value}`) }, progs.rows.map((p) => h("option", { value: p.id, selected: String(p.id) === String(pid) }, p.name)))));
  if (!pid) return void root.append(emptyState(t("no_programs")));
  const qs = new URLSearchParams({ program: pid }); for (const k of ["target", "date", "time", "kind"]) if (params.get(k)) qs.set(k, params.get(k));
  const r = await api.get(`api/reports/forecast?${qs}`);
  if (!r.model.audience) return void root.append(card([emptyState(t("forecast_no_data")), h("a.nb-btn.nb-btn--secondary", { href: `#/ratings?program=${pid}` }, t("nav_ratings"))], { head: ch("target", t("nav_forecast")) }));

  const page = h("div.fc-page"); const rootAll = root; root = page; rootAll.append(page);
  const kinds = S.schema.entities.broadcasts.fields.kind.options || [];
  const targetSel = r.targets.length > 1 && h("div.nb-selectwrap", { style: { maxWidth: "300px" } }, h("select.nb-select", { "aria-label": t("forecast_target"), onchange: (e) => go(`#/forecast?program=${pid}&target=${encodeURIComponent(e.target.value)}`) }, r.targets.map((x) => h("option", { value: x.label, selected: x.label === r.target }, `${x.label} (${x.n})`))));
  const a = r.model.audience, next = r.slots[0];
  root.append(card([h("div.stats", [["c-blue", next?.audience ? fmt.num(next.audience.p50) : "—", t("forecast_next_audience")], ["c-yellow", next?.share ? fmt.pct(next.share.p50) : "—", t("forecast_next_share")], ["c-green", fmt.num(a.recent_avg), t("forecast_recent_avg")], ["c-red", `${a.trend_pct_per_episode > 0 ? "+" : ""}${fmt.num(a.trend_pct_per_episode, 1)} %`, t("forecast_trend")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", v), h("span", l)))),
    h("div.nb-row", { style: { margin: "8px 0" } }, badge(t(`quality_${r.quality}`), QCOLOR[r.quality]), h("span.nb-help", t("forecast_quality_help", { n: a.n, p: a.spread_pct })), targetSel)], { head: ch("target", t("nav_forecast")) }));
  root.append(h("div.cols2", card([forecastChart(r.history, r.slots, "audience", 0)], { head: ch("chart", t("forecast_audience")) }), card([forecastChart(r.history, r.slots, "share", 1)], { head: ch("chart", t("forecast_share")) })));

  const rows = r.slots.map((x) => h("tr", h("td", fmt.date(x.date), x.time && h("span.nb-caption", ` ${x.time}`)), h("td", x.episode || "—"), h("td", x.kind ? optLabel("broadcasts", "kind", x.kind) : "—"), h("td.num", range(x.audience, 0)), h("td.num", range(x.share, 1, " %")), h("td", factorBadges(x.factors))));
  const heads = [fieldLabel("broadcasts", "date"), entName("episodes"), fieldLabel("broadcasts", "kind"), t("forecast_audience"), t("forecast_share"), t("forecast_factors")];
  root.append(card([r.projected && h("p.nb-help", t("forecast_projected")), rows.length ? h("div.nb-table-wrap", h("table.nb-table", h("thead", h("tr", heads.map((l, i) => h("th", { class: i === 3 || i === 4 ? "num" : "" }, l)))), h("tbody", rows))) : emptyState(t("forecast_none_planned"))], { head: ch("calendar", t("forecast_upcoming")) }));

  const date = h("input.nb-input", { type: "date", value: params.get("date") || "", "aria-label": fieldLabel("broadcasts", "date") }), time = h("input.nb-input", { type: "time", value: params.get("time") || "", "aria-label": t("time") });
  const kind = h("select.nb-select", { "aria-label": fieldLabel("broadcasts", "kind") }, h("option", { value: "" }, "—"), kinds.map((k) => h("option", { value: k, selected: params.get("kind") === k }, optLabel("broadcasts", "kind", k))));
  const run = () => { if (!date.value) return date.focus(); const q = new URLSearchParams({ program: pid, date: date.value }); if (time.value) q.set("time", time.value); if (kind.value) q.set("kind", kind.value); if (r.target) q.set("target", r.target); go(`#/forecast?${q}`); };
  const w = r.what_if;
  root.append(card([h("p.nb-help", t("what_if_help")), h("div.nb-row", { style: { alignItems: "flex-end", gap: "12px", flexWrap: "wrap" } }, h("label", h("span.nb-caption", fieldLabel("broadcasts", "date")), date), h("label", h("span.nb-caption", t("time")), time), h("label", h("span.nb-caption", fieldLabel("broadcasts", "kind")), selectWrap(kind)), btn(t("what_if_run"), { ico: "sparkle", onclick: run })),
    w && h("div.stats", { style: { marginTop: "16px" } }, [["c-blue", range(w.audience, 0), t("forecast_audience")], ["c-yellow", range(w.share, 1, " %"), t("forecast_share")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", v), h("span", l)))),
    w?.factors.length ? h("div.nb-row", { style: { marginTop: "8px" } }, factorBadges(w.factors)) : null], { head: ch("sparkle", t("what_if")) }));
  root.append(card(h("p.nb-help", t("forecast_method_text")), { head: ch("info", t("forecast_method")), flat: true }));
}
