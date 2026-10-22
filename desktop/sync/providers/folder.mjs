// A folder as the "cloud": the folder that Google Drive for desktop or OneDrive already keeps in sync on this computer (or any shared/network folder). No account, no network from Collado.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export class FolderProvider {
  constructor({ dir }) { this.dir = dir; this.id = "folder"; this.label = "Carpeta sincronizada"; }
  async init() { await fsp.mkdir(this.dir, { recursive: true }); }
  #file(name) { if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("bad_name"); return path.join(this.dir, name); }
  /** Map name -> { size } of every object. */
  async list() { const out = new Map(); for (const n of await fsp.readdir(this.dir).catch(() => [])) { if (n.endsWith(".part")) continue; const st = await fsp.stat(path.join(this.dir, n)).catch(() => null); if (st?.isFile()) out.set(n, { size: st.size }); } return out; }
  async read(name) { try { return await fsp.readFile(this.#file(name)); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
  async write(name, buf) { const f = this.#file(name), t = f + ".part"; await fsp.writeFile(t, buf); await fsp.rename(t, f); }
  async remove(name) { await fsp.rm(this.#file(name), { force: true }); }
}
