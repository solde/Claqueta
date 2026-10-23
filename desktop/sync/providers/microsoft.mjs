// OneDrive through Microsoft Graph. Scope Files.ReadWrite.AppFolder: Collado only reaches its own app folder (/Apps/<app name>), never the rest of the OneDrive.
import { send, NAME_OK, HttpError } from "./http.mjs";

/** OAuth endpoints and scope for OneDrive (Microsoft Graph, app folder). */
export const MICROSOFT = { authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scope: "Files.ReadWrite.AppFolder offline_access", extra: { prompt: "select_account" } };
const SIMPLE_MAX = 4 * 1000 * 1000, CHUNK = 320 * 1024 * 10;   // Graph: simple upload up to 4 MB; chunks of a multiple of 320 KiB otherwise

/** Storage in the app folder of OneDrive (Microsoft Graph), with upload sessions for large objects. */
export class OneDriveProvider {
  constructor({ tokens, graphBase = "https://graph.microsoft.com/v1.0", fetchImpl = fetch }) { Object.assign(this, { tokens, graphBase, fetchImpl }); this.id = "microsoft"; this.label = "OneDrive"; this.root = `${graphBase}/me/drive/special/approot`; }
  #req(url, init, expect, auth = true) { return send({ fetchImpl: this.fetchImpl, tokens: this.tokens, url, init, expect, auth }); }
  #item(name) { if (!NAME_OK.test(name)) throw new Error("bad_name"); return `${this.root}:/${encodeURIComponent(name)}:`; }
  /** First access creates the app folder. */
  async init() { await this.#req(this.root, {}, [200]); }   // first access creates the app folder
  /** Map of object name to size. */
  async list() {
    const out = new Map(); let url = `${this.root}/children?$top=200&$select=name,size,file`;
    while (url) { const j = await (await this.#req(url, {}, [200])).json(); for (const f of j.value || []) if (f.file) out.set(f.name, { size: Number(f.size) || 0 }); url = j["@odata.nextLink"] || null; }
    return out;
  }
  /** Content of an object, or null. */
  async read(name) {
    const r = await this.#req(`${this.#item(name)}/content`, {}, [200, 404]); if (r.status === 404) return null;   // the 302 to the pre-authorised download URL is followed by fetch (without our token: it is another origin)
    return Buffer.from(await r.arrayBuffer());
  }
  /** Creates or replaces an object. */
  async write(name, buf) {
    if (buf.length <= SIMPLE_MAX) { await this.#req(`${this.#item(name)}/content`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: buf }, [200, 201]); return; }
    const s = await (await this.#req(`${this.#item(name)}/createUploadSession`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }) }, [200])).json();
    if (!s.uploadUrl) throw new HttpError(502, "no upload session", this.root);
    for (let at = 0; at < buf.length; at += CHUNK) {
      const part = buf.subarray(at, Math.min(at + CHUNK, buf.length));
      await this.#req(s.uploadUrl, { method: "PUT", headers: { "content-length": String(part.length), "content-range": `bytes ${at}-${at + part.length - 1}/${buf.length}` }, body: part }, [200, 201, 202], false);
    }
  }
  /** Deletes an object. */
  async remove(name) { await this.#req(this.#item(name), { method: "DELETE" }, [200, 204, 404]); }
}
