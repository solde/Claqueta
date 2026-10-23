// Dashboard (portfolio view), alerts page.
import { h } from "../dom.js";
import { api, qs } from "../api.js";
import { S, t, entName, fmt, optLabel } from "../i18n.js";
import { btn, badge, statusBadge, icon, card, pageHead, emptyState, statusColor, ch } from "../ui.js";
import { barChart, donut, hbars, PAL } from "../charts.js";
import { remember, refLabel } from "../forms.js";

const SEV = { high: ["red", "!!"], medium: ["orange", "!"], low: ["blue", "i"] };
export function alertText(a) {
  const p = { ...a.params, amount: a.params.amount != null ? fmt.money(a.params.amount) : "", days: a.params.days != null ? Math.abs(a.params.days) : "", pct: a.params.pct, status: a.params.status ? optLabel("episodes", "status", a.params.status) : "", area: a.params.area ? optLabel("compliance_checks", "area", a.params.area) : "", severity: a.params.severity ? optLabel("qc_issues", "severity", a.params.severity) : "" };
  const msg = S.d.ui[`alert.${a.kind}`] || a.kind; return Object.entries(p).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, "g"), v ?? ""), msg);
}
export function alertItem(a, withDate = true) {
  const [c, mark] = SEV[a.severity] || SEV.low;
  return h("li", badge(mark, c, "nb-badge--sq"), h("a", { href: a.entity === "people" ? `#/e/people/${a.id}` : `#/e/${a.entity}/${a.id}` }, alertText(a)), withDate && a.date && h("span.nb-caption", fmt.date(a.date)));
}
export async function alertsPage(root) {
  const r = await api.get("api/alerts");
  root.append(pageHead(t("nav_alerts"), t("alerts_help")), r.alerts.length ? h("ul.alertlist", r.alerts.map((a) => alertItem(a))) : emptyState(t("no_alerts")));
}

export async function dashboard(root) {
  const d = await api.get("api/dashboard");
  const n = (arr, k) => arr.filter((x) => x.status === k).reduce((a, b) => a + b.n, 0);
  const stats = [
    ["c-accent", n(d.programs, "active"), t("stat_active_programs")], ["c-blue", d.pipeline.filter((p) => !["aired", "delivered"].includes(p.status)).reduce((a, b) => a + b.n, 0), t("stat_open_episodes")],
    ["c-red", d.alert_counts.high || 0, t("stat_high_alerts")], ["c-pink", d.my_tasks.length, t("stat_my_tasks")],
    ...(d.finance ? [["c-green", fmt.money(d.finance.receivable), t("stat_receivable")], ["c-orange", fmt.money(d.finance.receivable_overdue), t("stat_overdue")], ["c-purple", fmt.money(d.finance.payable), t("stat_payable")]] : []),
  ];
  const order = ["planned", "script", "recorded", "edited", "qc", "delivered", "aired"]; const pipe = d.pipeline.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)); const tot = pipe.reduce((a, b) => a + b.n, 0) || 1;
  root.append(pageHead(t("nav_home"), `${S.me.name} · ${fmt.date(d.today)}`, [btn(t("new_program"), { ico: "plus", onclick: () => { location.hash = "#/programs?new=1"; } })]),
    h("div.stats", stats.map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", String(v)), h("span", l)))),
    h("div.cols2",
      h("div.stack",
        card(d.alerts.length ? h("ul.alertlist", d.alerts.slice(0, 8).map((a) => alertItem(a))) : emptyState(t("no_alerts")), { head: ch("alert", t("nav_alerts")) }),
        card(tot > 0 ? [h("div.pipeline", pipe.map((p) => h("i", { class: `c-${statusColor(p.status)}`, style: { flex: p.n }, title: `${optLabel("episodes", "status", p.status)}: ${p.n}` }, p.n))), h("div.legend", pipe.map((p) => h("span", h("i", { class: `c-${statusColor(p.status)}` }), `${optLabel("episodes", "status", p.status)} · ${p.n}`)))] : emptyState(t("empty_list")), { head: ch("film", t("pipeline")) }),
        d.finance && card(d.finance.cashflow.length ? barChart({ rows: d.finance.cashflow.map((b) => ({ label: fmt.month(b.month), values: [b.in, b.out] })), series: [t("cash_in"), t("cash_out")], money: true }) : null, { head: ch("money", t("nav_cashflow")) }),
      ),
      h("div.stack",
        card(d.my_tasks.length ? h("ul.alertlist", d.my_tasks.map((k) => h("li", statusBadge("tasks", "status", k.status), h("a", { href: `#/e/tasks/${k.id}` }, k.title), k.due && h("span.nb-caption", fmt.date(k.due))))) : emptyState(t("no_tasks")), { head: ch("check", t("stat_my_tasks")) }),
        d.my_approvals?.length ? card(h("ul.alertlist", d.my_approvals.map((a) => h("li", statusBadge("approvals", "kind", a.kind), h("a", { href: `#/e/approvals/${a.id}` }, a.subject), a.due && h("span.nb-caption", fmt.date(a.due))))), { head: ch("stamp", t("my_approvals")) }) : null,
        card(d.upcoming.length ? h("ul.alertlist", d.upcoming.map((e) => h("li", statusBadge("episodes", "status", e.status), h("a", { href: `#/e/episodes/${e.id}` }, `${e.program} · E${e.number} ${e.title || ""}`), h("span.nb-caption", fmt.date(e.air_date))))) : emptyState(t("empty_list")), { head: ch("antenna", t("upcoming_airings")) }),
        card(d.bookings.length ? h("ul.alertlist", d.bookings.map((b) => h("li", badge(b.status === "confirmed" ? icon("ok") : icon("clock"), b.status === "confirmed" ? "green" : "yellow", "nb-badge--sq"), h("a", { href: `#/e/bookings/${b.id}` }, `${b.resource} · ${b.title}`), h("span.nb-caption", fmt.datetime(b.start))))) : emptyState(t("empty_list")), { head: ch("calendar", t("this_week_resources")) }),
        d.audiences.length ? card(hbars({ items: d.audiences.map((a, i) => ({ label: a.program, value: a.share || 0, color: PAL[i % PAL.length] })) }), { head: ch("chart", t("share_last_60")) }) : null,
        d.workload ? card(hbars({ items: d.workload.map((w) => ({ label: w.name, value: w.hours, color: "var(--nb-pink)" })) }), { head: ch("users", t("workload_4w")) }) : null,
        d.risks.length ? card(h("ul.alertlist", d.risks.map((r) => h("li", badge(String(r.score), r.score >= 15 ? "red" : r.score >= 8 ? "orange" : "yellow", "nb-badge--sq"), h("a", { href: `#/e/risks/${r.id}` }, r.title), h("span.nb-caption", r.owner || "")))), { head: ch("alert", entName("risks", true)) }) : null,
      )));
}
