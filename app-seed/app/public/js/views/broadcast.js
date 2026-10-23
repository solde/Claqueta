// Audiences: summary, charts and CSV import of measurement data.
import { h } from "../dom.js";
import { api, qs } from "../api.js";
import { S, t, entName, fmt } from "../i18n.js";
import { btn, badge, icon, card, pageHead, emptyState, toast, ch, confirmDialog } from "../ui.js";
import { barChart } from "../charts.js";
import { go } from "../lists.js";

/** Audience summary and charts of a programme, with CSV import. */
export async function ratingsBlock(programId, { compact = false } = {}) {
  const r = await api.get(`api/reports/ratings?program=${programId}`, { silent: true }).catch(() => null);
  const file = h("input", { type: "file", accept: ".csv,.txt", hidden: true, onchange: async () => { const f = file.files[0]; if (!f) return; const csv = await f.text(); try { const dry = await api.post("api/actions/import-ratings", { csv, program_id: programId, dry: true }); if (await confirmDialog(t("import_ratings_confirm", { n: dry.created, m: dry.matched, e: dry.errors.length }), { ok: t("import") })) { const res = await api.post("api/actions/import-ratings", { csv, program_id: programId }); toast(t("imported", { n: res.created })); go(`#/ratings?program=${programId}`); location.reload(); } } catch { /* toast */ } file.value = ""; } });
  const importBtn = S.schema.entities.ratings?.canWrite && h("div", file, btn(t("import_csv"), { ico: "upload", sm: true, kind: "secondary", onclick: () => file.click() }), h("span.nb-help", { style: { marginLeft: "8px" } }, t("import_ratings_help")));
  if (!r || !r.series.length) return card([emptyState(t("no_ratings")), importBtn], { head: ch("chart", entName("ratings", true)) });
  return card([h("div.stats", [["c-yellow", r.avg_share != null ? fmt.pct(r.avg_share) : "—", t("avg_share")], ["c-blue", r.avg_audience != null ? fmt.num(r.avg_audience) : "—", t("avg_audience")], ["c-green", r.best ? `${fmt.pct(r.best.share)}${r.best.episode ? " · E" + r.best.episode : ""}` : "—", t("best")], ["c-red", r.worst ? `${fmt.pct(r.worst.share)}${r.worst.episode ? " · E" + r.worst.episode : ""}` : "—", t("worst")]].map(([c, v, l]) => h("div", { class: ["stat", c] }, h("b", v), h("span", l)))),
    h("div.cols2", barChart({ rows: r.series.map((x) => ({ label: fmt.dateShort(x.date), values: [x.share || 0] })), series: [t("share")], type: "line", height: 220, colors: ["var(--nb-pink)"] }), barChart({ rows: r.series.map((x) => ({ label: x.episode || fmt.dateShort(x.date), values: [x.audience || 0] })), series: [t("audience_k")], height: 220, colors: ["var(--nb-blue)"] })), importBtn], { head: ch("chart", entName("ratings", true)) });
}
/** The Audiences page. */
export async function ratingsPage(root, m, params) {
  const progs = await api.get("api/e/programs?limit=200&sort=name&refs=0"); let pid = params.get("program") || progs.rows[0]?.id;
  root.append(pageHead(t("nav_ratings"), t("ratings_help")), h("div.nb-selectwrap", { style: { maxWidth: "300px", marginBottom: "16px" } }, h("select.nb-select", { "aria-label": entName("programs"), onchange: (e) => go(`#/ratings?program=${e.target.value}`) }, progs.rows.map((p) => h("option", { value: p.id, selected: String(p.id) === String(pid) }, p.name)))));
  if (pid) root.append(await ratingsBlock(pid)); else root.append(emptyState(t("no_programs")));
}
