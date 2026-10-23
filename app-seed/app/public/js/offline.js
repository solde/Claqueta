// Partial offline support: a queue (IndexedDB) of small field updates made while the network is down; replayed when it comes back. See sw.js for the read cache.
const DB = "collado-offline";
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore("queue", { keyPath: "id", autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("queue", mode); const out = fn(t.objectStore("queue")); t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };
// queued writes remember the organization they were made in and are only replayed there (the person may switch company before the network is back)
let ORG = ""; export const setOrg = (o) => { ORG = o || ""; };
/** Stores a failed small update in IndexedDB to replay later. */
export async function queueOffline(item) { try { await tx("readwrite", (s) => s.add({ ...item, org: ORG, ts: Date.now() })); } catch { /* storage unavailable */ } }
/** Queued updates. */
export const pending = async () => { try { return await tx("readonly", (s) => s.getAll()); } catch { return []; } };
/** Replays queued updates of the current organization in order; stops at the first network failure. */
export async function flush(onDone) {
  const items = await pending(); let ok = 0;
  for (const it of items) {
    if ((it.org || "principal") !== (ORG || "principal")) continue;
    try { const r = await fetch(it.url, { method: it.method, headers: { "x-requested-with": "collado", "content-type": "application/json" }, body: it.body === undefined ? undefined : JSON.stringify(it.body), credentials: "same-origin" });
      if (r.ok || r.status === 409 || r.status === 404) { await tx("readwrite", (s) => s.delete(it.id)); if (r.ok) ok++; } else break; } catch { break; }
  }
  if (ok && onDone) onDone(ok);
}
