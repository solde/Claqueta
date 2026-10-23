// Small helpers shared by the whole app: errors, HTTP, dates, money, CSV.
export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
/** 400 error with a stable machine-readable code. */
export const bad = (m, extra) => new HttpError(400, m, extra);
/** 403 error (the caller lacks the permission). */
export const forbidden = (m = "forbidden") => new HttpError(403, m);
/** 404 error (also used to hide rows the caller may not see). */
export const notFound = (m = "not_found") => new HttpError(404, m);
/** 409 error (stale revision, duplicate); `extra` carries the current row or the clash. */
export const conflict = (m, extra) => new HttpError(409, m, extra);

/** Current instant as an ISO string (timestamps in the database). */
export const now = () => new Date().toISOString();
/** Today's date as YYYY-MM-DD (UTC). */
export const today = () => new Date().toISOString().slice(0, 10);

// ---- dates (always ISO strings; no timezone surprises: dates are plain YYYY-MM-DD) ---------------------------------------------------
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
/** True for HH:MM or HH:MM:SS (24 h). */
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
/** True for an ISO date-time (with T or space, optional seconds and zone). */
export const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s);
/** Adds `n` days (may be negative) to a YYYY-MM-DD date. */
export function addDays(date, n) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** Whole days from date `a` to date `b` (negative when b is earlier). */
export function diffDays(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5); }
/** Adds `n` months to a YYYY-MM-DD date. */
export function addMonths(date, n) { const d = new Date(date + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
/** The Monday of the week that contains the date. */
export function mondayOf(date) { const d = new Date(date + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }
/** "YYYY-Qn" for a date. */
export const quarterOf = (date) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
/** "HH:MM" to minutes since midnight. */
export const hhmmToMin = (s) => { const [h, m] = String(s || "0:0").split(":"); return Number(h) * 60 + Number(m || 0); };
/** Minutes since midnight to "HH:MM" (wraps at 24 h). */
export const minToHhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** "2026-03-01T10:00" / "2026-03-01 10:00" -> minutes since epoch (naive local time, good enough to compare overlaps). */
export const dtMin = (s) => Math.floor(Date.parse(String(s).replace(" ", "T").slice(0, 16) + ":00Z") / 60000);

// ---- money: integer cents in the DB, plain numbers (euros) in the API -----------------------------------------------------------------
export const toCents = (v) => Math.round((Number(v) || 0) * 100);
/** Integer cents to euros for the API (null stays null). */
export const fromCents = (c) => (c == null ? null : Math.round(c) / 100);
/** Rounds to two decimals without binary-float surprises. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---- strings --------------------------------------------------------------------------------------------------------------------------
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Lower-case ASCII slug (accents removed, max 60 characters). */
export const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "x";
/** Shortens a string to `n` characters with an ellipsis. */
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
/** Serialises rows as CSV (UTF-8 BOM, CRLF, ; separator by default) so Spanish-locale spreadsheets open it directly. */
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
/** Reads a request body into a Buffer, rejecting with 413 beyond `limit` bytes. */
export const readRaw = (req, limit = 2e6) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, "body_too_large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
/** Reads a JSON object body (empty body = {}); anything that is not an object is a 400 invalid_json. */
export async function readJson(req, limit = 4e6) {
  const b = await readRaw(req, limit); if (!b.length) return {};
  try { const v = JSON.parse(b.toString("utf8")); return v && typeof v === "object" ? v : {}; } catch { throw bad("invalid_json"); }
}
/** Timestamped console log line. */
export const log = (...a) => console.log(new Date().toISOString(), ...a);
