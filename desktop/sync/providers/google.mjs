// Google Drive (REST v3). Scope drive.file: Collado can only see the files it created itself, never the rest of the Drive. Everything lives in one folder ("Collado").
import { send, NAME_OK, HttpError } from "./http.mjs";

export const GOOGLE = { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/drive.file", extra: { access_type: "offline", prompt: "consent" } };
const FOLDER = "application/vnd.google-apps.folder", SIMPLE_MAX = 5 * 1048576;

export class GoogleDriveProvider {
  constructor({ tokens, folderName = "Collado", apiBase = "https://www.googleapis.com", fetchImpl = fetch }) { Object.assign(this, { tokens, folderName, apiBase, fetchImpl }); this.id = "google"; this.label = "Google Drive"; this.ids = new Map(); this.folderId = null; }
  #req(url, init, expect) { return send({ fetchImpl: this.fetchImpl, tokens: this.tokens, url, init, expect }); }
  #json = async (url, init, expect) => (await this.#req(url, init, expect)).json();
  async init() {
    const q = `name='${this.folderName}' and mimeType='${FOLDER}' and trashed=false and 'root' in parents`;
    const found = await this.#json(`${this.apiBase}/drive/v3/files?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "1" })}`);
    this.folderId = found.files?.[0]?.id || (await this.#json(`${this.apiBase}/drive/v3/files?fields=id`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: this.folderName, mimeType: FOLDER, parents: ["root"] }) })).id;
  }
  async #idOf(name) {
    if (!NAME_OK.test(name)) throw new Error("bad_name"); if (this.ids.has(name)) return this.ids.get(name);
    const j = await this.#json(`${this.apiBase}/drive/v3/files?${new URLSearchParams({ q: `name='${name}' and '${this.folderId}' in parents and trashed=false`, fields: "files(id)", pageSize: "1" })}`);
    const id = j.files?.[0]?.id || null; if (id) this.ids.set(name, id); return id;
  }
  async list() {
    const out = new Map(); this.ids.clear(); let page = "";
    do {
      const j = await this.#json(`${this.apiBase}/drive/v3/files?${new URLSearchParams({ q: `'${this.folderId}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,size)", pageSize: "1000", ...(page ? { pageToken: page } : {}) })}`);
      for (const f of j.files || []) if (!out.has(f.name)) { out.set(f.name, { size: Number(f.size) || 0 }); this.ids.set(f.name, f.id); }
      page = j.nextPageToken || "";
    } while (page);
    return out;
  }
  async read(name) {
    const id = await this.#idOf(name); if (!id) return null;
    const r = await this.#req(`${this.apiBase}/drive/v3/files/${id}?alt=media`, {}, [200, 404]); if (r.status === 404) { this.ids.delete(name); return null; }
    return Buffer.from(await r.arrayBuffer());
  }
  async write(name, buf) {
    const id = await this.#idOf(name), meta = id ? {} : { name, parents: [this.folderId] };
    if (buf.length <= SIMPLE_MAX) {   // multipart/related: metadata + media in one request
      const b = "collado" + Math.random().toString(36).slice(2), body = Buffer.concat([Buffer.from(`--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\ncontent-type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--`)]);
      const j = await this.#json(`${this.apiBase}/upload/drive/v3/files${id ? `/${id}` : ""}?uploadType=multipart&fields=id`, { method: id ? "PATCH" : "POST", headers: { "content-type": `multipart/related; boundary=${b}` }, body });
      this.ids.set(name, j.id); return;
    }
    const start = await this.#req(`${this.apiBase}/upload/drive/v3/files${id ? `/${id}` : ""}?uploadType=resumable&fields=id`, { method: id ? "PATCH" : "POST", headers: { "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(buf.length) }, body: JSON.stringify(meta) });
    const session = start.headers.get("location"); if (!session) throw new HttpError(502, "no upload session", this.apiBase);
    const done = await send({ fetchImpl: this.fetchImpl, auth: false, url: session, init: { method: "PUT", headers: { "content-length": String(buf.length) }, body: buf }, expect: [200, 201] });
    this.ids.set(name, (await done.json()).id);
  }
  async remove(name) { const id = await this.#idOf(name); if (!id) return; await this.#req(`${this.apiBase}/drive/v3/files/${id}`, { method: "DELETE" }, [200, 204, 404]); this.ids.delete(name); }
}
