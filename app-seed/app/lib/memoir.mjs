// Project memoirs: the facts the app already knows, the sections people (or the agent) write, and the assembly into one editable document.
//   facts(ctx, programId)            figures of the project gathered from the other modules (only what the caller may see)
//   createMemoir(ctx, input)         a memoir with the sections of its kind
//   brief(ctx, memoirId)             what the agent reads: sections, state, missing material, facts, gallery
//   saveSection(ctx, input)          writes a section by key (text, structured fields, images, graphics, status)
//   buildMemoir(ctx, memoirId)       Collado Markdown of the whole memoir, stored as an editable document (exportable to PDF / Word)
import { q } from "./db.mjs";
import * as E from "./engine.mjs";
import { has } from "./access.mjs";
import { bad, today } from "./util.mjs";
import * as R from "./reports.mjs";
import { SECTIONS, ORDER, KINDS, KIND_LABEL, defaultSections, catalog, completeness, sectionTitle } from "./memoir-catalog.mjs";

const safe = (fn, d = null) => { try { return fn(); } catch { return d; } };
const rows = (ctx, entity, filters, limit = 500, sort) => safe(() => E.list(ctx, entity, { filters, limit, refs: "0", ...(sort ? { sort } : {}) }).rows, []);
const round = (x, d = 1) => (x == null || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d);
const lang = (l) => (["es", "ca", "en"].includes(l) ? l : "es");

/** Everything the app knows about a project that a memoir needs. Keys are stable: the agent and the section builders rely on them. */
export function facts(ctx, programId) {
  const program = safe(() => E.getRow(ctx, "programs", programId)); if (!program) throw bad("no_program");
  const label = (entity, id) => (id ? safe(() => E.label(entity, id), "") : "");
  const eps = rows(ctx, "episodes", { program_id: programId }, 500, "number");
  const byStatus = {}; for (const e of eps) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  const planned = eps.reduce((s, e) => s + (e.duration_target || 0), 0), actual = eps.reduce((s, e) => s + (e.duration_actual || 0), 0);
  const aired = eps.filter((e) => e.air_date).map((e) => e.air_date).sort();
  const locs = rows(ctx, "locations", { program_id: programId }, 200, "name"), shootDates = new Set(eps.map((e) => e.shoot_date).filter(Boolean));
  const crewRows = safe(() => q.all("SELECT person_id, role FROM crew_assignments WHERE program_id = ?", Number(programId)), []);
  const roles = {}; for (const c of crewRows) if (c.role) roles[c.role] = (roles[c.role] || 0) + 1;
  const out = {
    program: { id: program.id, name: program.name, code: program.code, kind: program.kind, status: program.status, genre: program.genre, logline: program.logline, language: program.language, format: program.format_desc, channel: label("partners", program.channel_id),
      client: label("partners", program.client_id), producer: program.producer, executive: program.executive, start_date: program.start_date, end_date: program.end_date, episodes_per_season: program.episodes_per_season, currency: program.currency || "EUR" },
    episodes: { count: eps.length, by_status: byStatus, aired: aired.length, first_air: aired[0] || null, last_air: aired[aired.length - 1] || null, list: eps.map((e) => ({ number: e.number, title: e.title, status: e.status, air_date: e.air_date, shoot_date: e.shoot_date, minutes: e.duration_actual || e.duration_target ? Math.round((e.duration_actual || e.duration_target) / 60) : null })) },
    runtime: { planned_min: Math.round(planned / 60), actual_min: Math.round(actual / 60) },
    shoot: { days: Math.max(shootDates.size, locs.reduce((s, l) => s + (l.shoot_days || 0), 0)), first: [...shootDates].sort()[0] || null, last: [...shootDates].sort().pop() || null },
    crew: { people: new Set(crewRows.map((c) => c.person_id)).size, roles: Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([role, n]) => ({ role, n })) },
    locations: locs.map((l) => ({ id: l.id, name: l.name, kind: l.kind, city: l.city, country: l.country, lat: l.lat, lng: l.lng, shoot_days: l.shoot_days, date_from: l.date_from, date_to: l.date_to })),
    milestones: rows(ctx, "milestones", { program_id: programId }, 200, "start_date").map((m) => ({ title: m.title, kind: m.kind, start: m.start_date, end: m.end_date, status: m.status })),
    targets: rows(ctx, "targets", { program_id: programId }, 20).map((t) => ({ name: t.name, age_range: t.age_range })),
    editorial_lines: rows(ctx, "editorial_lines", { program_id: programId }, 20).map((l) => ({ title: l.title || l.name || "", text: String(l.description || l.text || "").slice(0, 400) })),
    risks: rows(ctx, "risks", { program_id: programId }, 100, "-score").slice(0, 10).map((r) => ({ title: r.title, category: r.category, score: r.score, status: r.status, mitigation: r.mitigation })),
    qc: (() => { const i = rows(ctx, "qc_issues", { program_id: programId }, 500); return { issues: i.length, open: i.filter((x) => !["closed", "resolved", "fixed", "done"].includes(x.status) && !x.resolved_at).length }; })(),
    rights: (() => { const r = rows(ctx, "rights", { program_id: programId }, 500); const by = {}; for (const x of r) by[x.status] = (by[x.status] || 0) + 1; return { count: r.length, by_status: by }; })(),
    media: (() => { const m = rows(ctx, "media_items", { program_id: programId }, 1000); const by = {}; for (const x of m) by[x.kind] = (by[x.kind] || 0) + 1; return { count: m.length, by_kind: by, featured: m.filter((x) => x.featured).length }; })(),
  };
  const aud = safe(() => R.ratingsSummary(ctx, { program_id: programId }));
  out.audience = aud && aud.series.length ? { n: aud.series.length, avg_share: aud.avg_share, avg_audience_k: aud.avg_audience, best: aud.best, worst: aud.worst } : null;
  if (has(ctx, "fin.view")) {
    const p = safe(() => R.profitability(ctx, { program: programId })?.programs?.[0]);
    const b = safe(() => q.get("SELECT id FROM budgets WHERE program_id = ? AND kind = 'budget' ORDER BY (status = 'approved') DESC, version DESC, id DESC LIMIT 1", Number(programId)));
    const rep = b ? safe(() => R.budgetReport(ctx, { budget_id: b.id })) : null;
    out.budget = rep ? { budget_id: b.id, name: rep.budget.name, version: rep.budget.version, status: rep.budget.status, currency: rep.budget.currency, planned: rep.totals.planned_lines, actual: rep.totals.actual, committed: rep.totals.committed, variance: rep.totals.variance, pct: rep.totals.pct,
      chapters: rep.chapters.map((c) => ({ chapter: c.chapter, planned: c.planned, actual: c.actual })) } : null;
    out.billing = p ? { contract_value: p.contract_value, invoiced: p.invoiced, collected: p.collected, grants: p.grants, sponsorship: p.sponsorship, forecast_margin: p.forecast_margin } : null;
  }
  return out;
}

const KEYS = (s) => s.fields.map((f) => f.key);

export async function createMemoir(ctx, input) {
  const program = E.getRow(ctx, "programs", input.program_id), kind = KINDS.includes(input.kind) ? input.kind : "annual", l = lang(input.language || program.language || ctx.lang);
  const m = await E.create(ctx, "memoirs", { program_id: program.id, title: input.title || `${KIND_LABEL[kind][l]} · ${program.name}`, kind, language: l, status: "draft", season_id: input.season_id, period_start: input.period_start || program.start_date, period_end: input.period_end || program.end_date,
    funder: input.funder, funder_ref: input.funder_ref, tone: input.tone || "institutional", brief: input.brief, brand_id: input.brand_id, audience_note: input.audience_note });
  let pos = 0; for (const key of Array.isArray(input.sections) && input.sections.length ? input.sections.filter((k) => SECTIONS[k]) : defaultSections(kind)) await E.create(ctx, "memoir_sections", { program_id: program.id, memoir_id: m.id, key, title: sectionTitle(key, l), position: ++pos * 10, status: "empty", origin: "human" });
  return m;
}

const sectionRows = (ctx, memoirId) => rows(ctx, "memoir_sections", { memoir_id: memoirId }, 200, "position").map((s) => ({ ...s, fields: s.fields && typeof s.fields === "object" ? s.fields : {}, media_ids: Array.isArray(s.media_ids) ? s.media_ids : [], visuals: Array.isArray(s.visuals) ? s.visuals : null }));

/** Writes one section by key. Fields are merged key by key; passing `body`, `fields`, `media_ids`, `visuals` or `status` changes only those. */
export async function saveSection(ctx, input) {
  const m = E.getRow(ctx, "memoirs", input.memoir_id), key = String(input.key || ""); if (!SECTIONS[key] && !/^custom_[a-z0-9_]{1,40}$/.test(key)) throw bad("unknown_section");
  const cur = sectionRows(ctx, m.id).find((s) => s.key === key), patch = {};
  if (input.title !== undefined) patch.title = String(input.title).slice(0, 200);
  if (input.body !== undefined) patch.body = String(input.body);
  if (input.fields !== undefined) { if (typeof input.fields !== "object" || input.fields === null) throw bad("invalid_fields"); patch.fields = { ...(cur?.fields || {}), ...input.fields }; }
  if (input.media_ids !== undefined) patch.media_ids = [...new Set([].concat(input.media_ids).map(Number).filter(Boolean))];
  if (input.visuals !== undefined) patch.visuals = input.visuals === null ? null : [].concat(input.visuals);
  for (const k of ["notes", "agent_brief", "author", "origin", "position"]) if (input[k] !== undefined) patch[k] = input[k];
  patch.status = input.status || (cur && cur.status !== "empty" && cur.status !== "skipped" ? cur.status : (patch.body || patch.fields || patch.media_ids) ? "draft" : (cur?.status || "empty"));
  if (cur) return E.update(ctx, "memoir_sections", cur.id, patch);
  return E.create(ctx, "memoir_sections", { program_id: m.program_id, memoir_id: m.id, key, title: patch.title || sectionTitle(key, m.language), position: patch.position ?? (Math.max(0, ...sectionRows(ctx, m.id).map((s) => s.position)) + 10), ...patch });
}

/** The brief an agent works from: what to write, what is already there, what is missing and the real figures. */
export function brief(ctx, memoirId) {
  const m = E.getRow(ctx, "memoirs", memoirId), l = lang(m.language), cat = catalog(l), byKey = Object.fromEntries(cat.sections.map((s) => [s.key, s]));
  const secs = sectionRows(ctx, m.id).map((s) => { const c = completeness(s.key, s); return { key: s.key, title: s.title || sectionTitle(s.key, l), status: s.status, words: String(s.body || "").trim() ? String(s.body).trim().split(/\s+/).length : 0, completeness: c.pct, missing: c.missing, agent_brief: s.agent_brief || "", notes: s.notes || "",
    guide: byKey[s.key] ? { purpose: byKey[s.key].purpose, words: byKey[s.key].words, fields: byKey[s.key].fields, facts: byKey[s.key].facts, visuals: byKey[s.key].visuals } : null, has: { body: !!String(s.body || "").trim(), fields: Object.keys(s.fields || {}), media: s.media_ids.length, visuals: (s.visuals || []).length } }; });
  const media = rows(ctx, "media_items", { program_id: m.program_id }, 300, "position,-id").map((x) => ({ id: x.id, title: x.title, kind: x.kind, phase: x.phase, caption: x.caption, credit: x.credit, rights: x.rights, featured: !!x.featured, episode_id: x.episode_id, ratio: x.width && x.height ? round(x.width / x.height, 2) : null }));
  return { memoir: { id: m.id, title: m.title, kind: m.kind, language: m.language, status: m.status, tone: m.tone, funder: m.funder, funder_ref: m.funder_ref, period: [m.period_start, m.period_end], audience_note: m.audience_note, brief: m.brief, document_id: m.document_id },
    sections: secs, facts: facts(ctx, m.program_id), gallery: media, overall: secs.length ? Math.round(secs.filter((s) => s.status !== "skipped").reduce((a, s) => a + s.completeness, 0) / Math.max(1, secs.filter((s) => s.status !== "skipped").length)) : 0 };
}

// ---- assembly -------------------------------------------------------------------------------------------------------------------------------
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const table = (cols, rs) => (rs.length ? `| ${cols.map((c) => cell(c.label)).join(" | ")} |\n|${cols.map((c) => (c.type === "num" ? "---:" : "---")).join("|")}|\n${rs.map((r) => `| ${cols.map((c) => cell(r[c.key])).join(" | ")} |`).join("\n")}\n` : "");
const emptyRow = (r) => !r || !Object.values(r).some((x) => String(x ?? "").trim());
const directive = (name, attrs, body = "") => `:::${name} ${Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${/[\s"]/.test(String(v)) ? JSON.stringify(String(v)) : v}`).join(" ")}${body ? `\n${body}\n` : "\n"}:::\n`;
const hasList = (s, k) => Array.isArray(s.fields[k]) && s.fields[k].some((r) => !emptyRow(r));

/** Visual elements each section gets when the author has not chosen its own (`visuals` null): all built from live data, nothing to maintain by hand. */
function autoVisuals(key, ctx, m, f) {
  const p = m.program_id, out = [];
  switch (key) {
    case "numbers": out.push(directive("graphic", { type: "stats", auto: 1, program: p, title: f.program.name })); break;
    case "execution": if (f.milestones.length) out.push(directive("graphic", { type: "timeline", source: "milestones", program: p })); break;
    case "team": if (f.crew.people) out.push(directive("graphic", { type: "orgchart", source: "crew", program: p })); break;
    case "locations": if (f.locations.some((l) => l.lat != null && l.lng != null)) out.push(directive("graphic", { type: "locations_map", source: "locations", program: p })); break;
    case "economic": if (f.budget) out.push(directive("chart", { source: "budget_chapters", budget: f.budget.budget_id, type: "bar", y: "planned,actual", title: true })); break;
    case "audience": if (f.audience) out.push(directive("chart", { source: "ratings", program: p, type: "line", y: "share", x: "date", title: true })); break;
    case "objectives": { const k = (m._sections?.find((s) => s.key === "objectives")?.fields.objectives || []).filter((r) => r.target && r.achieved !== undefined && r.achieved !== ""); if (k.length) out.push(directive("graphic", { type: "kpi_bars", source: "section", section: "objectives", memoir: m.id })); break; }
    case "impact": { const k = (m._sections?.find((s) => s.key === "impact")?.fields.kpis || []).filter((r) => r.target && r.achieved !== undefined && r.achieved !== ""); if (k.length) out.push(directive("graphic", { type: "kpi_bars", source: "section", section: "impact", field: "kpis", memoir: m.id })); break; }
    default: break;
  }
  return out;
}

function renderList(def, field, rowsIn, l) {
  const rs = rowsIn.filter((r) => !emptyRow(r)); if (!rs.length) return "";
  const head = `**${field.label}**\n\n`;
  if (field.key === "highlights") return head + rs.map((r) => `- ${cell(r.text)}`).join("\n") + "\n\n";
  if (field.key === "quotes") return rs.map((r) => `> ${cell(r.text)}\n> — ${cell([r.person, r.role].filter(Boolean).join(", "))}\n`).join("\n") + "\n";
  return head + table(field.cols, rs) + "\n";
}

export async function buildMarkdown(ctx, memoirId) {
  const m = E.getRow(ctx, "memoirs", memoirId), l = lang(m.language), f = facts(ctx, m.program_id), secs = sectionRows(ctx, m.id); m._sections = secs;
  const cat = Object.fromEntries(catalog(l).sections.map((s) => [s.key, s])), cover = secs.find((s) => s.key === "cover")?.fields || {};
  const coverMedia = m.cover_media_id || (Array.isArray(cover.cover_media) ? cover.cover_media[0] : null), att = (id) => { const mi = safe(() => E.getRow(ctx, "media_items", id)); return mi?.attachment_id ? `att:${mi.attachment_id}` : null; };
  const subtitle = cover.subtitle || [f.program.name, [m.period_start, m.period_end].filter(Boolean).join(" – ")].filter(Boolean).join(" · ");
  let md = `---\ntitle: ${JSON.stringify(m.title)}\nsubtitle: ${JSON.stringify(subtitle)}\ncover: yes\n${m.funder ? `client: ${JSON.stringify(m.funder)}\n` : ""}---\n\n`;
  const hero = coverMedia ? att(coverMedia) : null; if (hero) md += `:::cover\n![](${hero})\n:::\n\n`;
  md += ":::toc depth=2:::\n\n";
  for (const s of secs) {
    if (s.status === "skipped" || s.key === "cover") continue;
    const def = cat[s.key], title = s.title || def?.title || s.key; let part = `# ${title}\n\n`; let any = false;
    const body = String(s.body || "").trim();
    if (body) { part += `${body}\n\n`; any = true; }
    for (const fd of def?.fields || []) {
      const v = s.fields[fd.key];
      if (fd.type === "list" && Array.isArray(v)) { const t = renderList(def, fd, v, l); if (t) { part += t; any = true; } }
      else if ((fd.type === "long" || fd.type === "text") && !body && v && String(v).trim() && !["subtitle", "edition", "tagline", "producer", "version"].includes(fd.key)) { part += `**${fd.label}**\n\n${String(v).trim()}\n\n`; any = true; }
      else if (fd.type === "num" && v !== undefined && v !== "" && fd.key !== "headcount") { part += `**${fd.label}:** ${v}\n\n`; any = true; }
    }
    const ids = s.key === "gallery" ? (s.media_ids.length ? s.media_ids : (Array.isArray(s.fields.media) ? s.fields.media : [])) : s.media_ids;
    let pics = ids; if (s.key === "gallery" && !pics.length) pics = rows(ctx, "media_items", { program_id: m.program_id, featured: 1 }, 12, "position,-id").map((x) => x.id);
    if (s.key === "credits" && Array.isArray(s.fields.logos) && s.fields.logos.length) pics = s.fields.logos;
    if (pics.length) { part += directive("gallery", { ids: pics.join(","), layout: s.key === "credits" ? "logos" : s.fields.layout || (pics.length === 1 ? "hero" : "mosaic"), title: s.key === "gallery" ? s.fields.intro : "" }) + "\n"; any = true; }
    const BODY_KEYS = ["data", "stats", "items", "root", "points"];
    const visuals = s.visuals === null || s.visuals === undefined ? autoVisuals(s.key, ctx, m, f) : s.visuals.map((v) => { if (typeof v === "string") return v; const extra = Object.fromEntries(BODY_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])); return directive(v.type === "chart" && v.source ? "chart" : "graphic", Object.fromEntries(Object.entries(v).filter(([k]) => !BODY_KEYS.includes(k))), Object.keys(extra).length ? JSON.stringify(extra) : ""); });
    if (visuals.length) { part += visuals.join("\n") + "\n"; any = true; }
    if (!any && def) part += `[Indicar: ${def.purpose}]\n\n`;
    md += part;
  }
  return md;
}

/** Stores the assembled memoir as an editable document of the programme and links it. Returns { document_id, words, sections, missing }. */
export async function buildMemoir(ctx, memoirId) {
  const m = E.getRow(ctx, "memoirs", memoirId), content = await buildMarkdown(ctx, m.id);
  let doc = m.document_id ? safe(() => E.getRow(ctx, "documents", m.document_id)) : null;
  const fields = { title: m.title, content, type: "report", language: m.language, program_id: m.program_id, brand_id: m.brand_id || undefined, status: "draft" };
  doc = doc ? await E.update(ctx, "documents", doc.id, fields) : await E.create(ctx, "documents", fields);
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  await E.update(ctx, "memoirs", m.id, { document_id: doc.id, built_at: now }, { internal: true });
  const placeholders = (content.match(/\[Indicar:/g) || []).length;
  return { document_id: doc.id, title: doc.title, words: content.split(/\s+/).length, placeholders, open: `#/doc/${doc.id}` };
}

export { catalog, completeness, defaultSections, sectionTitle, SECTIONS, ORDER };
void today; void KEYS;
