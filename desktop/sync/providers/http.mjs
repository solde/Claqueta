// Small shared HTTP layer for the cloud providers: bearer token, retries with back-off on throttling and server errors, one forced refresh on 401.
export class HttpError extends Error { constructor(status, body, url) { super(`http_${status}`); this.status = status; this.body = String(body || "").slice(0, 300); this.url = String(url).replace(/\?.*$/, ""); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function send({ fetchImpl = fetch, tokens, url, init = {}, retries = 4, expect = [200], auth = true, sleepMs = (n) => 500 * 2 ** n }) {
  let refreshed = false;
  for (let n = 0; ; n++) {
    const headers = { ...(init.headers || {}) }; if (auth && tokens) headers.authorization = `Bearer ${await tokens.get()}`;
    let r; try { r = await fetchImpl(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(10 * 60e3) }); } catch (e) { if (n >= retries) throw e; await sleep(sleepMs(n)); continue; }
    if (expect.includes(r.status)) return r;
    if (r.status === 401 && auth && tokens && !refreshed) { refreshed = true; tokens.invalidate(); continue; }
    if ((r.status === 429 || r.status >= 500) && n < retries) { const ra = Number(r.headers.get("retry-after")); await r.arrayBuffer().catch(() => {}); await sleep(ra > 0 ? Math.min(ra * 1000, 30000) : sleepMs(n)); continue; }
    throw new HttpError(r.status, await r.text().catch(() => ""), url);
  }
}
export const NAME_OK = /^[A-Za-z0-9._-]{1,120}$/;
