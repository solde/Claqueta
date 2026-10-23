// The only bridge between the page and the operating system. Exposed to the shell (top frame); the app frame reaches it through the same-origin parent.
// Everything is validated again in the main process (desktop/main.mjs): this file holds no logic.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("colladoDesktop", Object.freeze({
  platform: process.platform,
  /** Native "choose a folder" dialog. Resolves to the absolute path, or null if cancelled. */
  pickFolder: (current) => ipcRenderer.invoke("collado:pick-folder", typeof current === "string" ? current : ""),
  /** Opens a file of the person's workspace with the application the system has chosen for it. */
  openPath: (p) => ipcRenderer.invoke("collado:open-path", String(p)),
  /** Cloud sync of the whole workspace (Google Drive, OneDrive or a synced folder). Secrets never come back through here. */
  cloud: Object.freeze({
    status: () => ipcRenderer.invoke("collado:cloud-status"),
    connect: (o) => ipcRenderer.invoke("collado:cloud-connect", { provider: String(o?.provider || ""), clientId: String(o?.clientId || ""), clientSecret: String(o?.clientSecret || ""), passphrase: String(o?.passphrase || ""), folder: String(o?.folder || "") }),
    disconnect: () => ipcRenderer.invoke("collado:cloud-disconnect"),
    syncNow: () => ipcRenderer.invoke("collado:cloud-sync"),
  }),
}));
