// Orchestrates cloud sync for the desktop app: connect / disconnect, the decision at start-up (pull what another computer pushed, handle conflicts and the one-computer-at-a-time lease),
// periodic lease renewal and pushes while the app runs, and the final push when it closes. Electron-free on purpose: the host injects the vault, the browser opener and the dialogs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { SyncEngine, SyncError, initRemote, unlockRemote, remoteExists } from "./engine.mjs";
import { authorize, TokenSource } from "./oauth.mjs";
import { FolderProvider } from "./providers/folder.mjs";
import { GoogleDriveProvider, GOOGLE } from "./providers/google.mjs";
import { OneDriveProvider, MICROSOFT } from "./providers/microsoft.mjs";

const PROVIDERS = { google: "Google Drive", microsoft: "OneDrive", folder: "Carpeta sincronizada" };
/** How often the lease is renewed while the app runs (5 min) and how often changes are pushed (15 min). */
export const LEASE_RENEW_MS = 5 * 60e3, PUSH_EVERY_MS = 15 * 60e3;

/** Where secrets rest. The desktop host passes Electron's safeStorage (OS keychain); without one the file is only readable by its owner. */
export class PlainVault { seal(s) { return Buffer.from(s, "utf8"); } open(b) { return b.toString("utf8"); } get strong() { return false; } }

/** Orchestrates cloud sync for the desktop app: connect/disconnect, the decision at start-up (pull, conflicts, the lease), periodic pushes while it runs, and the final push on exit. Free of Electron: the host injects the vault, the browser opener and the dialogs. */
export class CloudSync {
  /** paths: { userData, dataDir, gwDir, localUser } · defaults: { google:{clientId,clientSecret}, microsoft:{clientId} } · io: { vault, openUrl(url), confirm(message, buttons)->index, relaunch(), busy(text) } */
  constructor({ paths, defaults = {}, io, log = () => {}, fetchImpl = fetch, endpoints = {}, appName = "Collado" }) {
    Object.assign(this, { paths, defaults, io, log, fetchImpl, endpoints, appName });
    this.cfgFile = path.join(paths.userData, "cloud.json"); this.secretFile = path.join(paths.userData, "cloud.secrets");
    this.cfg = this.#readJson(this.cfgFile) || {}; this.secrets = this.#readSecrets();
    this.engine = null; this.provider = null; this.timers = []; this.suspended = false; this.forcePush = false; this.busy = false;
    this.run = { state: this.cfg.provider ? "idle" : "off", error: "", progress: null, lastSyncAt: this.cfg.lastSyncAt || 0, pendingPull: !!this.cfg.pendingPull, offline: false };
  }
  // ---- persistence ----------------------------------------------------------------------------------------------------------------------------------------
  #readJson(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }
  #readSecrets() { try { return JSON.parse(this.io.vault.open(fs.readFileSync(this.secretFile))); } catch { return {}; } }
  #save() { fs.mkdirSync(this.paths.userData, { recursive: true }); fs.writeFileSync(this.cfgFile, JSON.stringify(this.cfg, null, 2), { mode: 0o600 }); fs.writeFileSync(this.secretFile, this.io.vault.seal(JSON.stringify(this.secrets)), { mode: 0o600 }); }
  /** True when a provider and the encryption key are configured. */
  get connected() { return !!this.cfg.provider && !!this.secrets.master; }

  /** What the UI shows. No secret ever leaves this object. */
  status() {
    const d = this.defaults;
    return { connected: this.connected, provider: this.cfg.provider || null, providerLabel: PROVIDERS[this.cfg.provider] || "", folder: this.cfg.provider === "folder" ? this.cfg.folder : undefined, state: this.suspended ? (this.run.error ? "error" : "suspended") : this.run.state, error: this.run.error, progress: this.run.progress,
      lastSyncAt: this.run.lastSyncAt, offline: this.run.offline, pendingPull: this.run.pendingPull, device: this.cfg.deviceName, vaultStrong: !!this.io.vault.strong, skipped: this.run.skipped || 0,
      configured: { google: !!(this.cfg.google?.clientId || d.google?.clientId), microsoft: !!(this.cfg.microsoft?.clientId || d.microsoft?.clientId), folder: true } };
  }

  // ---- building blocks ------------------------------------------------------------------------------------------------------------------------------------
  #client(kind) { return { clientId: this.cfg[kind]?.clientId || this.defaults[kind]?.clientId || "", clientSecret: this.secrets[`${kind}Secret`] || this.defaults[kind]?.clientSecret || "" }; }
  #providerFor(kind, tokens) {
    if (this.endpoints.factory) return this.endpoints.factory(kind, this.cfg, tokens);   // tests
    if (kind === "folder") return new FolderProvider({ dir: this.cfg.folder });
    const c = this.#client(kind), ts = new TokenSource({ tokens, tokenUrl: (kind === "google" ? GOOGLE : MICROSOFT).tokenUrl, clientId: c.clientId, clientSecret: c.clientSecret, scope: kind === "microsoft" ? MICROSOFT.scope : undefined, fetchImpl: this.fetchImpl, persist: (t) => { this.secrets.tokens = t; this.#save(); } });
    return kind === "google" ? new GoogleDriveProvider({ tokens: ts, folderName: this.appName, fetchImpl: this.fetchImpl, ...(this.endpoints.google || {}) }) : new OneDriveProvider({ tokens: ts, fetchImpl: this.fetchImpl, ...(this.endpoints.microsoft || {}) });
  }
  #engine(provider, master) {
    const { userData, dataDir, gwDir, localUser } = this.paths;
    return new SyncEngine({ provider, master, device: { id: this.cfg.deviceId, name: this.cfg.deviceName }, statePath: path.join(userData, "sync", "state.json"), backupsDir: path.join(userData, "sync", "backups"), log: this.log,
      onProgress: (p) => { this.run.progress = p; this.io.busy?.(p.phase === "upload" ? `Subiendo ${p.done}/${p.total}…` : p.phase === "download" ? `Descargando ${p.done}/${p.total}…` : "Preparando…"); },
      roots: [{ ns: "appdata", dir: path.join(dataDir, "appdata"), sqlite: true }, { ns: "home", dir: path.join(dataDir, "homes", localUser) },
        { ns: "gateway", dir: gwDir, exclude: (r) => r !== "auth.json" }, { ns: "shared", dir: path.join(dataDir, "shared"), exclude: (r) => r !== "TEAM.md" }] });
  }
  #prepare() {
    if (!this.connected) return false;
    this.provider = this.#providerFor(this.cfg.provider, this.secrets.tokens); this.engine = this.#engine(this.provider, Buffer.from(this.secrets.master, "base64")); return true;
  }
  #fail(e) {
    const net = e?.cause?.code && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR/.test(e.cause.code) || e?.name === "TimeoutError" || /fetch failed/.test(e?.message || "");
    this.run.offline = !!net; this.run.state = net ? "offline" : "error";
    this.run.error = net ? "Sin conexión: se sincronizará cuando vuelva internet." : ({ lease_held: `«${e.by}» está usando Collado.`, remote_newer: "La nube tiene cambios más recientes.", bad_passphrase: "La contraseña de sincronización no es correcta.", not_connected: "Hay que volver a iniciar sesión en la cuenta de la nube.", invalid_grant: "El acceso a la cuenta ha caducado o se ha revocado: vuelve a conectar la nube.", no_client_id: "Falta el identificador de la aplicación (Client ID).", access_denied: "No se concedió el acceso a la cuenta." })[e?.code] || `${e?.message || e}`;
    this.log("cloud sync:", e?.code || e?.message || e);
  }

  // ---- connect / disconnect ---------------------------------------------------------------------------------------------------------------------------
  async connect({ provider, clientId, clientSecret, passphrase, folder }) {
    if (!PROVIDERS[provider]) throw new SyncError("bad_provider");
    if (this.connected) throw new SyncError("already_connected");
    if (String(passphrase || "").length < 8) throw new SyncError("weak_passphrase");
    const cfg = { provider, deviceId: crypto.randomUUID(), deviceName: `${os.hostname().split(".")[0]} (${process.platform})`, connectedAt: Date.now() }; let tokens = null;
    const secrets = {};
    if (provider === "folder") { if (!folder || !path.isAbsolute(folder)) throw new SyncError("bad_folder"); fs.mkdirSync(folder, { recursive: true }); cfg.folder = path.resolve(folder); }
    else {
      const k = provider; cfg[k] = { clientId: clientId || this.defaults[k]?.clientId || "" }; if (k === "google" && clientSecret) secrets.googleSecret = clientSecret;
      const cid = cfg[k].clientId, cs = secrets.googleSecret || this.defaults[k]?.clientSecret || ""; if (!cid) throw new SyncError("no_client_id");
      const P = k === "google" ? GOOGLE : MICROSOFT; this.run.state = "connecting";
      tokens = await authorize({ authUrl: (this.endpoints.authUrl?.[k]) || P.authUrl, tokenUrl: (this.endpoints.tokenUrl?.[k]) || P.tokenUrl, clientId: cid, clientSecret: cs, scope: P.scope, extra: P.extra, loopbackHost: k === "microsoft" ? "localhost" : "127.0.0.1", openUrl: this.io.openUrl, fetchImpl: this.fetchImpl, appName: this.appName });
    }
    const saved = { cfg: this.cfg, secrets: this.secrets }; this.cfg = cfg; this.secrets = { ...secrets, tokens };
    try {
      const prov = this.#providerFor(provider, tokens); await prov.init(); let master, adopt = false;
      if (!(await remoteExists(prov))) master = await initRemote(prov, passphrase);
      else {
        master = await unlockRemote(prov, passphrase);
        const choice = await this.io.confirm(`La nube (${PROVIDERS[provider]}) ya contiene datos de ${this.appName}.\n\n¿Qué quieres hacer?`, ["Usar los datos de la nube", "Reemplazar la nube con este equipo", "Cancelar"],
          `Usar los de la nube: ${this.appName} se reiniciará y los datos de este equipo que cambien se guardan antes en una carpeta de copias. Reemplazar: lo que hay en la nube se sustituye por lo de este equipo.`);
        if (choice === 2 || choice === undefined) throw new SyncError("cancelled"); adopt = choice === 0; if (!adopt) this.forcePush = true;
      }
      this.secrets.master = master.toString("base64"); this.cfg.pendingPull = adopt; this.#save(); this.run = { ...this.run, state: "idle", error: "", pendingPull: adopt, lastSyncAt: 0 };
      this.#prepare();
      if (adopt) { this.io.relaunch(); return this.status(); }   // the databases are open: the cloud copy is applied at the next start, before anything opens them
      this.startTimers(); this.syncNow().catch(() => {}); return this.status();
    } catch (e) { this.cfg = saved.cfg; this.secrets = saved.secrets; this.run.state = this.cfg.provider ? "idle" : "off"; throw e; }
  }
  /** Releases the lease, forgets the local sync state and the stored secrets; the cloud copy stays. */
  async disconnect() {
    this.stopTimers(); try { await this.engine?.releaseLease(); } catch { /* offline: the lease expires by itself */ }
    this.engine?.forget(); this.cfg = {}; this.secrets = {}; this.engine = this.provider = null; this.suspended = false; this.forcePush = false;
    for (const f of [this.cfgFile, this.secretFile]) fs.rmSync(f, { force: true }); this.run = { state: "off", error: "", progress: null, lastSyncAt: 0, pendingPull: false, offline: false };
    return this.status();
  }

  // ---- while the app runs --------------------------------------------------------------------------------------------------------------------------------------
  /** Pushes now. A second call while one is running waits for it instead of starting another. */
  async syncNow() {
    if (!this.engine && !this.#prepare()) throw new SyncError("not_connected");
    if (this.suspended) return this.status();
    if (this.current) { try { await this.current; } catch { /* the first caller gets the error */ } return this.status(); }
    this.current = this.#doSync().finally(() => { this.current = null; }); await this.current; return this.status();
  }
  async #doSync() {
    this.busy = true; this.run.state = "syncing"; this.run.error = "";
    try {
      const r = await this.engine.push({ force: this.forcePush }); this.forcePush = false; this.run.lastSyncAt = this.engine.state.lastSyncAt; this.run.skipped = r.skipped?.length || 0; this.run.state = "idle"; this.run.offline = false;
      this.cfg.lastSyncAt = this.run.lastSyncAt; this.#save();
    } catch (e) { this.#fail(e); if (e.code === "lease_held" || e.code === "remote_newer") this.suspended = true; throw e; }
    finally { this.busy = false; this.run.progress = null; }
  }
  /** Starts the periodic lease renewal and the periodic push of changes. */
  startTimers() {
    this.stopTimers();
    this.timers.push(setInterval(async () => { if (this.busy || this.suspended || !this.engine) return; try { await this.engine.renewLease(); this.run.offline = false; if (this.run.state === "offline") this.run.state = "idle"; } catch (e) { this.#fail(e); if (e.code === "lease_held") this.suspended = true; } }, LEASE_RENEW_MS).unref?.());
    this.timers.push(setInterval(async () => { if (this.busy || this.suspended || !this.engine) return; try { if ((await this.engine.localChanges()).dirty) await this.syncNow(); } catch { /* status already set */ } }, PUSH_EVERY_MS).unref?.());
  }
  /** Stops the periodic timers. */
  stopTimers() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  // ---- start-up and shutdown -------------------------------------------------------------------------------------------------------------------------------
  /** Runs before the app's processes start. Returns "quit" when the person decides not to continue. */
  async bootSync(say = () => {}) {
    if (!this.#prepare()) return "ok";
    try {
      say(`Comprobando ${this.cfg.provider === "folder" ? "la carpeta" : PROVIDERS[this.cfg.provider]}…`); await this.provider.init();
      const remote = await this.engine.checkRemote();
      if (remote.lease) {
        const c = await this.io.confirm(`«${remote.lease.name}» tiene ${this.appName} abierto (o se cerró sin poder sincronizar).`, ["Tomar el control aquí", "Trabajar sin sincronizar esta vez", "Salir"], "Si tomas el control y el otro equipo sigue abierto, sus últimos cambios no llegarán aquí.");
        if (c === 2 || c === undefined) return "quit"; if (c === 1) { this.suspended = true; return "ok"; } this.forceLease = true;
      }
      const local = await this.engine.localChanges(), pending = this.run.pendingPull;
      if (remote.exists && (remote.newer || pending)) {
        let useCloud = true;
        if (local.dirty && !pending) {
          const c = await this.io.confirm("Hay cambios en este equipo y también más recientes en la nube.", ["Usar la nube (guardo copia de lo de aquí)", "Mantener este equipo (sobrescribo la nube)", "Salir"], `Cambios locales sin sincronizar: ${local.added.length} nuevos, ${local.changed.length} modificados, ${local.removed.length} borrados.`);
          if (c === 2 || c === undefined) return "quit"; useCloud = c === 0;
        }
        if (useCloud) {
          say("Descargando los datos de la nube…"); await this.engine.acquireLease({ force: !!this.forceLease }); const r = await this.engine.pull();
          this.cfg.pendingPull = false; this.run.pendingPull = false; this.run.lastSyncAt = this.engine.state.lastSyncAt; this.#save(); this.log("cloud sync: pulled", JSON.stringify({ ...r, bytes: undefined }));
        } else this.forcePush = true;
      } else if (remote.exists) await this.engine.acquireLease({ force: !!this.forceLease });
      this.run.state = "idle"; this.run.offline = false; this.startTimers(); return "ok";
    } catch (e) {
      this.#fail(e);
      if (e.code === "bad_passphrase" || e.code === "not_connected") { await this.io.confirm(`No se pudo sincronizar: ${this.run.error}\n\n${this.appName} seguirá con los datos de este equipo. Vuelve a conectar la nube desde Configuración.`, ["Entendido"]); this.suspended = true; return "ok"; }
      if (!this.run.offline) { const c = await this.io.confirm(`No se pudo comprobar la nube: ${this.run.error}`, ["Continuar sin sincronizar", "Salir"]); if (c !== 0) return "quit"; this.suspended = true; return "ok"; }
      this.startTimers(); return "ok";   // offline: work locally, the next push (timer, Sincronizar ahora, or closing) will catch up
    }
  }
  /** Runs after the app's processes have stopped, so the databases are quiet. */
  async shutdownSync() {
    this.stopTimers(); if (!this.connected || this.suspended || !this.engine || this.run.pendingPull) return;
    try { await this.current; } catch { /* a periodic push in flight finishes first */ }
    try { this.io.busy?.("Sincronizando con la nube…"); await this.syncNow(); await this.engine.releaseLease(); } catch (e) { this.#fail(e); this.log("cloud sync at exit failed:", this.run.error); }
  }
}
