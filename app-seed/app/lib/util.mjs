// Small helpers shared by the whole app: errors, HTTP, dates, money, CSV.
export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
export const bad = (m, extra) => new HttpError(400, m, extra);
export const forbidden = (m = "forbidden") => new HttpError(403, m);
export const notFound = (m = "not_found") => new HttpError(404, m);
export const conflict = (m, extra) => new HttpError(409, m, extra);

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

// ---- dates (always ISO strings; no timezone surprises: dates are plain YYYY-MM-DD) ---------------------------------------------------
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
export const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s);
export function addDays(date, n) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function diffDays(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }
export function addMonths(date, n) { const d = new Date(date + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
export function mondayOf(date) { const d = new Date(date + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
export const quarterOf = (date) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
export const hhmmToMin = (s) => { const [h, m] = String(s || "0:0").split(":"); return Number(h) * 60 + Number(m || 0); };
export const minToHhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** "2026-03-01T10:00" / "2026-03-01 10:00" -> minutes since epoch (naive local time, good enough to compare overlaps). */
export const dtMin = (s) => Math.floor(Date.parse(String(s).replace(" ", "T").slice(0, 16) + ":00Z") / 60000);

// ---- money: integer cents in the DB, plain numbers (euros) in the API -----------------------------------------------------------------
export const toCents = (v) => Math.round((Number(v) || 0) * 100);
export const fromCents = (c) => (c == null ? null : Math.round(c) / 100);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---- strings --------------------------------------------------------------------------------------------------------------------------
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
export const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

// ---- CSV (RFC 4180-ish; auto-detects ; or , separators for spreadsheets exported in es locale) -----------------------------------------
export function parseCsv(text, sep) {
  text = String(text).replace(/^﻿/, "");
  if (!sep) { const first = text.split(/\r?\n/, 1)[0]; sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.includes("\t") ? "\t" : ","); }
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
export function csvRows(rows, sep = ";") {
  const cell = (v) => { v = v == null ? "" : String(v); return /[";\n\r,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return "﻿" + rows.map((r) => r.map(cell).join(sep)).join("\r\n") + "\r\n";
}
/** Spanish-friendly number parsing: "1.234,56" / "1,234.56" / "12,5%" / "-3". */
export function parseNum(s) {
  if (typeof s === "number") return s;
  let t = String(s ?? "").trim().replace(/[%€$\s]/g, ""); if (!t) return 0;
  const lc = t.lastIndexOf(","), ld = t.lastIndexOf(".");
  if (lc > ld) t = t.replace(/\./g, "").replace(",", "."); else t = t.replace(/,/g, "");
  const n = Number(t); return Number.isFinite(n) ? n : 0;
}

// ---- HTTP -----------------------------------------------------------------------------------------------------------------------------
export function send(res, code, body, type = "application/json", headers = {}) {
  const buf = type === "application/json" ? Buffer.from(JSON.stringify(body)) : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(code, { "content-type": type.includes("charset") || !/^(text|application\/json)/.test(type) ? type : type + "; charset=utf-8", "content-length": buf.length,
    "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(buf);
}
export const readRaw = (req, limit = 2e6) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, "body_too_large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
export async function readJson(req, limit = 4e6) {
  const b = await readRaw(req, limit); if (!b.length) return {};
  try { const v = JSON.parse(b.toString("utf8")); return v && typeof v === "object" ? v : {}; } catch { throw bad("invalid_json"); }
}
export const log = (...a) => console.log(new Date().toISOString(), ...a);
