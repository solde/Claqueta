// HTTP API. Everything under /api; static files are served by server.mjs. All handlers receive the caller's context (identity + permissions).
import { q, getSetting, setSetting } from "./db.mjs";
import * as E from "./engine.mjs";
import { ENTITIES } from "./schema.mjs";
import { has, canRead } from "./access.mjs";
import * as R from "./reports.mjs";
import * as A from "./actions.mjs";
import { alerts, dashboard } from "./alerts.mjs";
import { applyTemplate, cloneBudget, newBudgetVersion } from "./logic.mjs";
import * as F from "./files.mjs";
import * as J from "./jobs.mjs";
import { clientDict, normLang } from "./i18n/index.mjs";
import { listSources } from "./docs/datasets.mjs";
import { renderDocument, buildDocument, capabilities, FORMATS } from "./docs/render.mjs";
import { renderHtml } from "./docs/html.mjs";
import { lintDocument } from "./docs/lint.mjs";
import { buildXlsx } from "./docs/xlsx.mjs";
import { resolveBrand } from "./docs/brand.mjs";
import { runSource } from "./docs/datasets.mjs";
import { HttpError, bad, forbidden, notFound, readJson, readRaw, send, today, csvRows, slug } from "./util.mjs";

const routes = [];
const on = (method, path, fn) => routes.push({ method, re: new RegExp("^" + path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$"), fn });
const query = (url) => Object.fromEntries(url.searchParams.entries());
const num = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw notFound(); return n; };
const filtersOf = (qs) => Object.fromEntries(Object.entries(qs).filter(([k]) => k.startsWith("f.")).map(([k, v]) => [k.slice(2), v]));
const ok = (v) => ({ status: 200, body: v });
const created = (v) => ({ status: 201, body: v });
const raw = (buffer, type, name, inline = false) => ({ status: 200, raw: buffer, type, headers: { "content-disposition": `${inline ? "inline" : "attachment"}; filename="${String(name).replace(/[^\w.\- ]/g, "_")}"`, "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" } });

// ---- session, schema, i18n ---------------------------------------------------------------------------------------------------------
on("GET", "/api/me", (ctx) => ok({ user: ctx.user, name: ctx.name, org: ctx.org, roles: ctx.roles, perms: ctx.local ? ["*"] : [...ctx.perms], external: ctx.external, caps: capabilities() }));
on("GET", "/api/schema", (ctx) => ok(E.schemaForClient(ctx)));
on("GET", "/api/i18n/:lang", (ctx, req, res, p) => ok(clientDict(p.lang)));
on("GET", "/api/users", (ctx) => { if (ctx.external) return ok({ users: [] }); return ok({ users: q.all("SELECT username, name, roles, last_seen FROM app_users ORDER BY name") }); });

// ---- generic entities -------------------------------------------------------------------------------------------------------------
on("GET", "/api/e/:entity", (ctx, req, res, p, url) => { const qs = query(url); return ok(E.list(ctx, p.entity, { filters: filtersOf(qs), q: qs.q, sort: qs.sort, limit: qs.limit, offset: qs.offset, ids: qs.ids, refs: qs.refs })); });
on("POST", "/api/e/:entity", async (ctx, req, res, p) => created(await E.create(ctx, p.entity, await readJson(req))));
on("POST", "/api/e/:entity/batch", async (ctx, req, res, p) => { const body = await readJson(req); const out = []; for (const [i, row] of (body.rows || []).slice(0, 500).entries()) { try { out.push({ ok: true, row: await E.create(ctx, p.entity, row) }); } catch (e) { out.push({ ok: false, index: i, error: e.message }); } } return created({ results: out }); });
on("GET", "/api/e/:entity/:id", (ctx, req, res, p) => ok(E.get(ctx, p.entity, num(p.id))));
for (const m of ["PATCH", "PUT"]) on(m, "/api/e/:entity/:id", async (ctx, req, res, p) => ok(await E.update(ctx, p.entity, num(p.id), await readJson(req))));
on("DELETE", "/api/e/:entity/:id", async (ctx, req, res, p) => ok(await E.remove(ctx, p.entity, num(p.id))));
on("GET", "/api/e/:entity/:id/history", (ctx, req, res, p) => ok({ history: E.history(ctx, p.entity, num(p.id)) }));
on("GET", "/api/e/:entity/:id/files", (ctx, req, res, p) => ok({ files: F.listFiles(ctx, p.entity, num(p.id)) }));
on("GET", "/api/e/:entity/:id/comments", (ctx, req, res, p) => ok(E.list(ctx, "comments", { filters: { entity: p.entity, row_id: String(num(p.id)) }, sort: "created", limit: 300, refs: "0" })));
on("GET", "/api/e/:entity/:id/approvals", (ctx, req, res, p) => ok(E.list(ctx, "approvals", { filters: { entity: p.entity, row_id: String(num(p.id)) }, sort: "-created", limit: 50, refs: "0" })));
on("GET", "/api/search", (ctx, req, res, p, url) => ok({ results: E.search(ctx, url.searchParams.get("q")) }));
on("GET", "/api/activity", (ctx, req, res, p, url) => ok({ activity: E.activity(ctx, { program: url.searchParams.get("program") }) }));

// ---- files ---------------------------------------------------------------------------------------------------------------------------
on("POST", "/api/files", async (ctx, req, res, p, url) => { const qs = query(url); const buf = await readRaw(req, F.MAX_FILE + 1024); return created(F.addFile(ctx, { entity: qs.entity, id: num(qs.id), name: qs.name || "file", mime: String(req.headers["content-type"] || "").split(";")[0], buffer: buf, shared: qs.shared === "1", label: qs.label || "" })); });
on("POST", "/api/links", async (ctx, req) => { const b = await readJson(req); return created(F.addLink(ctx, { entity: b.entity, id: num(b.id), url: b.url, label: b.label, shared: !!b.shared })); });
on("GET", "/api/files/:id", (ctx, req, res, p, url) => { const f = F.readFile(ctx, num(p.id)); const inline = url.searchParams.get("inline") === "1" && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime); return raw(f.buffer, f.mime, f.name, inline); });
on("DELETE", "/api/files/:id", (ctx, req, res, p) => ok(F.removeFile(ctx, num(p.id))));

// ---- dashboard, alerts, notifications --------------------------------------------------------------------------------------------------
on("GET", "/api/dashboard", (ctx, req, res, p, url) => ok(dashboard(ctx, { program: url.searchParams.get("program") })));
on("GET", "/api/alerts", (ctx, req, res, p, url) => ok({ alerts: alerts(ctx, { program: url.searchParams.get("program") }) }));
on("GET", "/api/notifications", (ctx) => ok({ ...E.list(ctx, "notifications", { sort: "-created", limit: 60, refs: "0" }), unread: q.get("SELECT COUNT(*) AS n FROM notifications WHERE user = ? AND read = 0", ctx.user).n }));
on("POST", "/api/notifications/read", async (ctx, req) => { const b = await readJson(req); if (b.all) q.run("UPDATE notifications SET read = 1 WHERE user = ?", ctx.user); else for (const id of b.ids || []) q.run("UPDATE notifications SET read = 1 WHERE user = ? AND id = ?", ctx.user, Number(id)); return ok({ ok: true }); });

// ---- reports -------------------------------------------------------------------------------------------------------------------------
const REPORTS = {
  budget: (ctx, p) => R.budgetReport(ctx, { budget_id: num(p.budget) }), "episode-variance": (ctx, p) => R.episodeVariance(ctx, { program_id: num(p.program), season_id: p.season }), cashflow: (ctx, p) => R.cashflow(ctx, { program: p.program, from: p.from, months: p.months, forecast: p.forecast === "1" }),
  tax: (ctx, p) => R.taxReport(ctx, p), profitability: (ctx, p) => R.profitability(ctx, p), conflicts: (ctx, p) => ({ conflicts: R.conflicts(ctx, p) }), "check-slot": (ctx, p) => R.checkSlot(ctx, p), timesheets: (ctx, p) => R.timesheetReport(ctx, { ...p, person_id: p.person, program_id: p.program }),
  rundown: (ctx, p) => R.rundownTiming(ctx, { episode_id: num(p.episode) }), gantt: (ctx, p) => R.gantt(ctx, { program_id: num(p.program), season_id: p.season }), ratings: (ctx, p) => R.ratingsSummary(ctx, { program_id: num(p.program), season_id: p.season }),
  "rights-check": (ctx, p) => R.rightsCheck(ctx, { episode_id: num(p.episode) }), "delivery-readiness": (ctx, p) => R.deliveryReadiness(ctx, { episode_id: num(p.episode), spec_id: p.spec }),
};
on("GET", "/api/reports/:name", (ctx, req, res, p, url) => { const fn = REPORTS[p.name]; if (!fn) throw notFound(); return ok(fn(ctx, query(url))); });

// ---- actions ---------------------------------------------------------------------------------------------------------------------------
const ACTIONS = {
  "apply-template": async (ctx, b) => { if (!has(ctx, "app.edit")) throw forbidden("needs:app.edit"); return applyTemplate(ctx, num(b.program_id)); },
  "clone-budget": async (ctx, b) => { if (!has(ctx, "fin.edit")) throw forbidden("needs:fin.edit"); return cloneBudget(ctx, num(b.budget_id), { program_id: b.program_id, season_id: b.season_id, name: b.name, kind: b.kind, version: b.version }); },
  "budget-version": async (ctx, b) => { if (!has(ctx, "fin.edit")) throw forbidden("needs:fin.edit"); return newBudgetVersion(ctx, num(b.budget_id)); },
  "init-compliance": (ctx, b) => A.initCompliance(ctx, { episode_id: num(b.episode_id), areas: b.areas }), "plan-episode": (ctx, b) => A.planEpisode(ctx, { episode_id: num(b.episode_id) }),
  "reorder-rundown": (ctx, b) => A.reorderRundown(ctx, b), "copy-rundown": (ctx, b) => A.duplicateEpisodeRundown(ctx, b),
  "import-ratings": (ctx, b) => A.importRatings(ctx, b), "import-bank": (ctx, b) => A.importBank(ctx, b), "suggest-matches": (ctx, b) => ({ matches: A.suggestMatches(ctx, num(b.movement_id)) }),
  "match-movement": (ctx, b) => A.matchMovement(ctx, b), "unmatch-movement": (ctx, b) => A.unmatchMovement(ctx, num(b.movement_id)), "invoice-ad-spots": (ctx, b) => A.invoiceAdSpots(ctx, b),
  "queue-job": (ctx, b) => J.queueJob(ctx, b), "cancel-job": (ctx, b) => J.cancelJob(ctx, num(b.id)),
};
on("POST", "/api/actions/:name", async (ctx, req, res, p) => { const fn = ACTIONS[p.name]; if (!fn) throw notFound(); return ok(await fn(ctx, await readJson(req, 12e6))); });
on("GET", "/api/jobs/kinds", () => ok({ kinds: Object.fromEntries(Object.entries(J.JOB_KINDS).map(([k, v]) => [k, { label: v.label, hint: v.hint, doc: v.doc }])) }));

// ---- exports ---------------------------------------------------------------------------------------------------------------------------
on("GET", "/api/export/ics", (ctx, req, res, p, url) => ({ status: 200, raw: Buffer.from(A.icsExport(ctx, { program: url.searchParams.get("program") })), type: "text/calendar; charset=utf-8", headers: { "content-disposition": 'attachment; filename="collado.ics"' } }));
on("GET", "/api/export/odoo-bills", (ctx, req, res, p, url) => ({ status: 200, raw: Buffer.from(A.exportOdooBills(ctx, query(url))), type: "text/csv; charset=utf-8", headers: { "content-disposition": 'attachment; filename="odoo-vendor-bills.csv"' } }));
on("GET", "/api/export/odoo-invoices", (ctx, req, res, p, url) => ({ status: 200, raw: Buffer.from(A.exportOdooInvoices(ctx, query(url))), type: "text/csv; charset=utf-8", headers: { "content-disposition": 'attachment; filename="odoo-customer-invoices.csv"' } }));
on("GET", "/api/export/csv/:entity", (ctx, req, res, p, url) => { const qs = query(url); const { rows } = E.list(ctx, p.entity, { filters: filtersOf(qs), q: qs.q, sort: qs.sort, limit: "all", refs: "0" }); return { status: 200, raw: Buffer.from(A.exportCsv(ctx, p.entity, rows)), type: "text/csv; charset=utf-8", headers: { "content-disposition": `attachment; filename="${p.entity}.csv"` } }; });

// ---- settings --------------------------------------------------------------------------------------------------------------------------
const SETTINGS = { company: { read: "app.view", write: ["users.manage", "fin.edit"] }, finance: { read: "fin.view", write: ["fin.edit"] }, alerts: { read: "app.view", write: ["users.manage"] }, compliance_checklists: { read: "app.view", write: ["users.manage", "legal.edit"] } };
on("GET", "/api/settings/:key", (ctx, req, res, p) => { const s = SETTINGS[p.key]; if (!s || !has(ctx, s.read) || (ctx.external && p.key !== "company")) throw notFound(); return ok({ key: p.key, value: getSetting(p.key, {}) }); });
on("PUT", "/api/settings/:key", async (ctx, req, res, p) => { const s = SETTINGS[p.key]; if (!s || !s.write.some((x) => has(ctx, x)) || ctx.external) throw forbidden("forbidden"); const b = await readJson(req); setSetting(p.key, b.value ?? {}, ctx.user); q.run("INSERT INTO changes(ts, user, entity, row_id, action, program_id, diff) VALUES (?, ?, 'settings', 0, 'update', NULL, ?)", new Date().toISOString(), ctx.user, JSON.stringify({ [p.key]: "updated" })); return ok({ ok: true }); });

// ---- documents ---------------------------------------------------------------------------------------------------------------------------
on("GET", "/api/docs/capabilities", () => ok({ formats: Object.keys(FORMATS), tools: capabilities() }));
on("GET", "/api/docs/sources", () => ok({ sources: listSources() }));
on("POST", "/api/docs/lint", async (ctx, req) => ok(await lintDocument(ctx, await readJson(req))));
on("POST", "/api/docs/preview", async (ctx, req) => { const b = await readJson(req); const r = await renderDocument(ctx, { ...b, screen: true }, "html"); return { status: 200, raw: r.buffer, type: r.mime, headers: { "x-collado-warnings": encodeURIComponent(JSON.stringify(r.warnings || [])), "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:" } }; });
on("POST", "/api/docs/render", async (ctx, req) => {
  const b = await readJson(req, 12e6); const format = String(b.format || "pdf"); const r = await renderDocument(ctx, b, format);
  const name = `${slug(b.filename || r.title || "documento")}.${r.ext}`;
  if (b.save) {
    if (!has(ctx, "app.edit")) throw forbidden("needs:app.edit");
    const ex = await E.create(ctx, "exports", { name, format: r.ext, program_id: b.program_id || null, document_id: b.document_id || null, bytes: r.buffer.length, notes: (r.warnings || []).slice(0, 5).join("; ") });
    const att = F.addFile(ctx, { entity: "exports", id: ex.id, name, mime: r.mime.split(";")[0], buffer: r.buffer, shared: !!b.shared });
    return created({ export_id: ex.id, attachment_id: att.id, name, bytes: r.buffer.length, warnings: r.warnings });
  }
  if (format === "png") return ok({ ...JSON.parse(r.buffer.toString("utf8")), warnings: r.warnings });
  return { status: 200, raw: r.buffer, type: r.mime, headers: { "content-disposition": `attachment; filename="${name}"`, "x-collado-warnings": encodeURIComponent(JSON.stringify(r.warnings || [])) } };
});
on("POST", "/api/docs/from-template", async (ctx, req) => {
  if (!has(ctx, "app.edit")) throw forbidden("needs:app.edit");
  const b = await readJson(req); const t = E.getRow(ctx, "doc_templates", num(b.template_id));
  const doc = await E.create(ctx, "documents", { program_id: b.program_id || null, episode_id: b.episode_id || null, title: b.title || t.name, type: t.type, status: "draft", language: b.lang || t.language || "es", content: t.body, template_id: t.id, brand_id: b.brand_id || t.brand_id || null, vars: b.vars || {}, options: t.options || {} });
  return created(doc);
});
on("POST", "/api/docs/xlsx", async (ctx, req) => {
  const b = await readJson(req, 12e6); const lang = normLang(b.lang || ctx.lang); const brand = resolveBrand(E.getRow(ctx, "brands", b.brand_id || (q.get("SELECT id FROM brands WHERE is_default = 1")?.id || 0)) ?? {}, {});
  let sheets = b.sheets;
  if (!sheets && b.source) { const ds = await runSource(ctx, b.source, b.params || {}, lang); sheets = [{ name: ds.title || b.source, title: ds.title, columns: ds.columns, rows: ds.rows }]; }
  if (!Array.isArray(sheets) || !sheets.length) throw bad("nothing_to_export");
  const buffer = buildXlsx({ title: b.title || sheets[0].title || "", author: ctx.name, sheets, brand, lang, currency: b.currency || "EUR" });
  return { status: 200, raw: buffer, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "content-disposition": `attachment; filename="${slug(b.filename || sheets[0].name || "datos")}.xlsx"` } };
});

export async function handle(ctx, req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue; const m = r.re.exec(url.pathname); if (!m) continue;
    const out = await r.fn(ctx, req, res, m.groups || {}, url);
    if (out.raw) { res.writeHead(out.status, { "content-type": out.type, "content-length": out.raw.length, "cache-control": "no-store", "x-content-type-options": "nosniff", ...(out.headers || {}) }); return void res.end(out.raw); }
    return send(res, out.status, out.body);
  }
  throw new HttpError(404, "not_found");
}
