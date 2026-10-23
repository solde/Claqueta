// OAuth 2.0 for a desktop application: authorization code + PKCE with a loopback redirect (RFC 8252). The system browser does the sign-in; Collado never sees the password.
// Tokens live only in the main process; the caller persists them encrypted (see store.mjs). Nothing here touches the network except the provider's own token endpoint.
import http from "node:http";
import crypto from "node:crypto";

const b64u = (b) => Buffer.from(b).toString("base64url");
/** An OAuth failure with its code (denied, timeout, not_connected...) and the provider's description. */
export class OAuthError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }

async function tokenRequest(url, params, fetchImpl) {
  const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new OAuthError(j.error || `token_${r.status}`, j.error_description);
  return { access: j.access_token, refresh: j.refresh_token || null, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
}

/** Full interactive sign-in. `openUrl(url)` shows the consent page (the system browser). Resolves to { access, refresh, expiresAt }. */
export async function authorize({ authUrl, tokenUrl, clientId, clientSecret, scope, extra = {}, loopbackHost = "127.0.0.1", openUrl, fetchImpl = fetch, timeoutMs = 5 * 60e3, appName = "Collado" }) {
  if (!clientId) throw new OAuthError("no_client_id");
  const verifier = b64u(crypto.randomBytes(48)), challenge = b64u(crypto.createHash("sha256").update(verifier).digest()), state = b64u(crypto.randomBytes(16));
  let finish, fail; const done = new Promise((res, rej) => { finish = res; fail = rej; }); done.catch(() => {});   // a denial can arrive while we are still opening the browser
  const handler = (req, res) => {
    const u = new URL(req.url, "http://x"); if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
    const page = (msg) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(`<!doctype html><meta charset=utf-8><title>${appName}</title><body style="font:16px system-ui;margin:48px;text-align:center"><h2>${appName}</h2><p>${msg}</p>`); };
    if (u.searchParams.get("state") !== state) { page("Respuesta no válida."); return; }   // someone else's request: ignore it, keep waiting
    if (u.searchParams.get("error")) { page("No se ha concedido el acceso. Puedes cerrar esta pestaña."); fail(new OAuthError(u.searchParams.get("error"))); return; }
    const code = u.searchParams.get("code"); if (!code) { page("Falta el código."); return; }
    page(`Listo: ya puedes cerrar esta pestaña y volver a ${appName}.`); finish(code);
  };
  // the redirect host may be "localhost" (Microsoft): listen on IPv4 and IPv6 loopback so whichever the browser resolves reaches us (never on a public interface)
  const servers = []; const listen = (host, port) => new Promise((res, rej) => { const s = http.createServer(handler); s.once("error", rej); s.listen(port, host, () => { servers.push(s); res(s.address().port); }); });
  const port = await listen("127.0.0.1", 0); if (loopbackHost === "localhost") await listen("::1", port).catch(() => {});
  const redirectUri = `http://${loopbackHost}:${port}/callback`, timer = setTimeout(() => fail(new OAuthError("timeout")), timeoutMs);
  try {
    await openUrl(`${authUrl}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope, state, code_challenge: challenge, code_challenge_method: "S256", ...extra })}`);
    const code = await done;
    return await tokenRequest(tokenUrl, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, ...(clientSecret ? { client_secret: clientSecret } : {}) }, fetchImpl);
  } finally { clearTimeout(timer); for (const s of servers) s.close(); }
}

/** Exchanges a refresh token for a new access token. */
export const refreshToken = ({ tokenUrl, clientId, clientSecret, refresh, scope, fetchImpl = fetch }) =>
  tokenRequest(tokenUrl, { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), ...(scope ? { scope } : {}) }, fetchImpl).then((t) => ({ ...t, refresh: t.refresh || refresh }));

/** Keeps a valid access token for a provider: refreshes shortly before expiry and tells `persist` about every new token set. */
export class TokenSource {
  constructor({ tokens, tokenUrl, clientId, clientSecret, scope, persist = () => {}, fetchImpl = fetch }) { Object.assign(this, { tokens, tokenUrl, clientId, clientSecret, scope, persist, fetchImpl }); }
  /** Marks the access token as expired so the next `get` refreshes it. */
  invalidate() { if (this.tokens) this.tokens = { ...this.tokens, expiresAt: 0 }; }
  /** A valid access token, refreshing it (once even for concurrent callers) when it is about to expire; throws not_connected without a refresh token. */
  async get() {
    if (this.tokens?.access && this.tokens.expiresAt > Date.now()) return this.tokens.access;
    if (!this.tokens?.refresh) throw new OAuthError("not_connected");
    this.tokens = await (this.inflight ||= refreshToken({ tokenUrl: this.tokenUrl, clientId: this.clientId, clientSecret: this.clientSecret, refresh: this.tokens.refresh, scope: this.scope, fetchImpl: this.fetchImpl }).finally(() => { this.inflight = null; }));
    this.persist(this.tokens); return this.tokens.access;
  }
}
