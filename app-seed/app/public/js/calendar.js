// Month grid + week/timeline helpers used by the entity calendar view and the master calendar.
import { h } from "./dom.js";
import { fmt, t } from "./i18n.js";
import { btn, icon } from "./ui.js";

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Monday of the week of a YYYY-MM-DD date. */
export const mondayOf = (s) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); };
/** Today's date as YYYY-MM-DD. */
export const todayIso = () => iso(new Date());
export { addDays };

/** events: [{ date, end?, label, icon?, color?, onclick?, title? }] (end optional, inclusive). Returns { el, setMonth(ym) }. */
export function monthGrid({ month = todayIso().slice(0, 7), events = [], onMonth, onDay }) {
  const root = h("div.cal"); let cur = month;
  function draw() {
    const [y, m] = cur.split("-").map(Number); const first = `${cur}-01`; const start = mondayOf(first); const days = []; for (let i = 0; i < 42; i++) days.push(addDays(start, i));
    const byDay = {}; for (const ev of events) { const end = ev.end && ev.end >= ev.date ? ev.end : ev.date; let d = ev.date < days[0] ? days[0] : ev.date; for (let n = 0; d <= end && d <= days[41] && n < 62; n++, d = addDays(d, 1)) (byDay[d] ||= []).push(ev); }
    const title = new Intl.DateTimeFormat(document.documentElement.lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(first + "T00:00:00Z"));
    root.replaceChildren(
      h("div.cal__head.nb-row.between", h("h3", title), h("div.nb-row", btn("", { ico: "back", sm: true, kind: "secondary", title: t("previous"), onclick: () => go(-1) }), btn(t("today"), { sm: true, kind: "secondary", onclick: () => { cur = todayIso().slice(0, 7); draw(); onMonth?.(cur); } }), btn("", { ico: "next", sm: true, kind: "secondary", title: t("next"), onclick: () => go(1) }))),
      h("div.cal__grid", days.slice(0, 7).map((d) => h("div.cal__dow", fmt.weekday(d))), days.map((d) => {
        const evs = byDay[d] || []; const out = d.slice(0, 7) !== cur;
        return h("div", { class: ["cal__day", out && "out", d === todayIso() && "today"], onclick: () => onDay?.(d) }, h("span.cal__num", Number(d.slice(8))), evs.slice(0, 4).map((ev) => h(ev.onclick ? "button" : "div", { class: ["cal__ev", `c-${ev.color || "yellow"}`], type: ev.onclick ? "button" : undefined, title: ev.title || ev.label, onclick: (e) => { e.stopPropagation(); ev.onclick?.(); } }, ev.icon && icon(ev.icon), ev.label)), evs.length > 4 && h("div.cal__more", `+${evs.length - 4}`));
      })));
  }
  function go(n) { const [y, m] = cur.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); cur = d.toISOString().slice(0, 7); draw(); onMonth?.(cur); }
  draw(); return { el: root, setEvents(e) { events = e; draw(); }, get month() { return cur; } };
}

/** Resource timeline: rows = resources/people, columns = days (14 by default), bars = bookings. */
export function timeline({ from, days = 14, rows, conflictsOf = () => false, onBar, onCell }) {
  const start = from || mondayOf(todayIso()); const cols = Array.from({ length: days }, (_, i) => addDays(start, i));
  const grid = h("div.tl", { style: { gridTemplateColumns: `180px repeat(${days}, minmax(46px, 1fr))` } },
    h("div.tl__corner", ""), cols.map((d) => h("div", { class: ["tl__col", d === todayIso() && "today", [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()) && "we"] }, h("b", fmt.weekday(d)), h("span", Number(d.slice(8))))),
    rows.flatMap((r) => [h("div.tl__row", { title: r.sub || "" }, r.label), h("div.tl__cells", { style: { gridColumn: `span ${days}` }, onclick: (e) => { const rect = e.currentTarget.getBoundingClientRect(); const i = Math.floor(((e.clientX - rect.left) / rect.width) * days); onCell?.(r, cols[Math.max(0, Math.min(days - 1, i))]); } },
      cols.map((d) => h("i", { class: [[0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()) && "we", d === todayIso() && "today"] })),
      (r.bars || []).map((b) => { const s = Math.max(0, (Date.parse(b.start.slice(0, 10)) - Date.parse(start)) / 864e5), e = Math.min(days, (Date.parse((b.end || b.start).slice(0, 10)) - Date.parse(start)) / 864e5 + 1); if (e <= 0 || s >= days) return null;
        return h("button", { type: "button", class: ["tl__bar", `c-${b.color || "blue"}`, b.conflict && "conflict"], style: { left: `${(s / days) * 100}%`, width: `${((e - s) / days) * 100}%` }, title: `${b.label} ${b.start.slice(11, 16)}–${(b.end || "").slice(11, 16)}`, onclick: (ev) => { ev.stopPropagation(); onBar?.(b); } }, b.conflict && icon("warn"), b.label); }))]));
  return h("div.tl-wrap", grid);
}
