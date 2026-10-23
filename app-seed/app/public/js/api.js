// fetch wrapper: relative URLs only (the app lives under /app/ behind the gateway), JSON in/out, errors as exceptions with a stable `code`.
import { toast } from "./ui.js";
import { queueOffline } from "./offline.js";

/** An API failure with its HTTP status, stable error code (the server's `error`) and detail. */
export class ApiError extends Error { constructor(status, code, detail) { super(code); this.status = status; this.code = code; this.detail = detail; } }
const HEADERS = { "x-requested-with": "collado" };

/** One fetch with JSON in/out, the CSRF header and same-origin credentials; a 401 reloads the page, network errors are queued when `offlineKey` is given, and failures raise ApiError (and a toast unless `silent`). */
async function request(method, url, body, { raw, silent, offlineKey } = {}) {
  const opts = { method, headers: { ...HEADERS }, credentials: "same-origin" };
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); } else if (body !== undefined) opts.body = body;
  let res;
  try { res = await fetch(url, opts); }
  catch (e) {
    if (offlineKey && method !== "GET") { await queueOffline({ method, url, body }); toast("offline_queued", "warn"); return { queued: true }; }
    if (!silent) toast("offline", "error"); throw new ApiError(0, "offline");
  }
  if (res.status === 401) { location.reload(); throw new ApiError(401, "unauthorized"); }
  if (raw) { if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j.error || "error", j.detail); } return res; }
  const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) { const err = new ApiError(res.status, data?.error || `http_${res.status}`, data?.detail); if (!silent) toast(err, "error"); throw err; }
  return data;
}
/** Verbs over `request` (get, post, patch, put, del, raw). All URLs are relative: the app lives under /app/ behind the gateway. */
export const api = {
  get: (u, o) => request("GET", u, undefined, o), post: (u, b, o) => request("POST", u, b ?? {}, o), patch: (u, b, o) => request("PATCH", u, b, o), put: (u, b, o) => request("PUT", u, b, o), del: (u, o) => request("DELETE", u, undefined, o),
  raw: (m, u, b) => request(m, u, b, { raw: true }),
};
/** Object to a query string, skipping empty values (the result starts with ? or is empty). */
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== "") p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
/** The generic entity endpoints (list, get, create, update with optimistic `rev`, remove). */
export const entityApi = {
  list: (entity, params) => api.get(`api/e/${entity}${qs(params)}`),
  get: (entity, id) => api.get(`api/e/${entity}/${id}`),
  create: (entity, body) => api.post(`api/e/${entity}`, body),
  update: (entity, id, body, offlineKey) => api.patch(`api/e/${entity}/${id}`, body, { offlineKey }),
  remove: (entity, id) => api.del(`api/e/${entity}/${id}`),
};
