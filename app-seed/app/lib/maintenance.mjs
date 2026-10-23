// Periodic housekeeping: status flips that depend on dates, weekly digest of high alerts as notifications, old notification cleanup, orphan file sweep.
import { q, inOrg, listOrgSlugs } from "./db.mjs";
import { notify } from "./engine.mjs";
import { alerts } from "./alerts.mjs";
import { sweepFiles } from "./files.mjs";
import { today, addDays, log } from "./util.mjs";

/** Date-driven housekeeping of the current organization: expires contracts and rights, deletes old read notifications, notifies each editor of their high alerts. */
export function runMaintenance() {
  const t = today();
  const a = q.run("UPDATE contracts SET status = 'expired', rev = rev + 1 WHERE status = 'active' AND end_date != '' AND end_date < ? AND auto_renew = 0", t).changes;
  const b = q.run("UPDATE rights SET status = 'expired', rev = rev + 1 WHERE status IN ('cleared','restricted') AND perpetual = 0 AND window_end != '' AND window_end < ?", t).changes;
  q.run("DELETE FROM notifications WHERE read = 1 AND created < ?", addDays(t, -90) + "T");
  if (a || b) log("maintenance: expired", a, "contract(s),", b, "right(s)");
  const week = `${t.slice(0, 4)}-W${Math.floor((Date.parse(t) - Date.parse(t.slice(0, 4) + "-01-01")) / 6048e5)}`;
  for (const u of q.all("SELECT * FROM app_users")) {
    const ctx = { user: u.username, name: u.name, perms: new Set(String(u.perms).split(",").filter(Boolean)), roles: String(u.roles).split(","), local: false, external: false };
    if (!ctx.perms.has("app.edit")) continue;
    try { for (const al of alerts(ctx).filter((x) => x.severity === "high").slice(0, 12)) notify(u.username, `⚠ ${al.kind}`, JSON.stringify(al.params), `#/e/${al.entity}/${al.id}`, `alert:${al.key}:${week}:${u.username}`, "alert"); } catch (e) { log("digest failed for", u.username, e.message); }
  }
}
/** Housekeeping of every organization, each in its own database. */
async function runAll(withFiles) { for (const slug of listOrgSlugs()) { try { await inOrg(slug, () => { runMaintenance(); if (withFiles) sweepFiles(); }); } catch (e) { log("maintenance:", slug, e.message); } } }
/** Schedules maintenance five seconds after start and every six hours (file sweep only on the first run). */
export function startMaintenance() { setTimeout(() => runAll(true), 5000).unref(); setInterval(() => runAll(false), 6 * 3600e3).unref(); }
