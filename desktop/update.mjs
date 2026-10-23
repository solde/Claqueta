// "Buscar actualizaciones": asks the release page of the repository (Gitea API) whether there is a newer version and which installer fits this computer. It only runs when the person asks for it
// (menu Ayuda): the app never phones home by itself. It does not install anything: it opens the download in the browser (unsigned builds cannot update themselves safely).
const num = (v) => String(v).replace(/^v/i, "").split(/[-+]/)[0].split(".").map((x) => parseInt(x, 10) || 0);
/** 1 if a > b, -1 if a < b, 0 if equal (1.10.0 > 1.9.0; a pre-release is older than its release). */
export function compareVersions(a, b) {
  const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  const pa = /-/.test(String(a).replace(/\+.*/, "")), pb = /-/.test(String(b).replace(/\+.*/, "")); return pa === pb ? 0 : pa ? -1 : 1;
}
/** The installer for this system among a release's assets (names are fixed by artifactName in package.json). */
export function pickAsset(assets, { platform, arch }) {
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : arch, want = { darwin: new RegExp(`-mac-${a}\\.dmg$`), win32: new RegExp(`-win-${a}-setup\\.exe$`), linux: new RegExp(`-linux-${a}\\.AppImage$`) }[platform];
  const archive = { win32: new RegExp(`-win-${a}\\.zip$`), linux: new RegExp(`-linux-${a}\\.tar\\.gz$`) }[platform];   // no installer built for this system (yet): the portable archive
  const list = assets || []; return (want && list.find((x) => want.test(x.name))) || (archive && list.find((x) => archive.test(x.name))) || null;
}
export const releasesUrl = ({ host, repo }) => `${host}/${repo}/releases`;
/** -> { status: "current" | "available" | "unreachable", current, latest?: { version, name, notes, page, asset, size }, error? } */
export async function checkForUpdate({ host, repo, current, platform, arch, fetchImpl = fetch, timeoutMs = 15000 }) {
  try {
    const r = await fetchImpl(`${host}/api/v1/repos/${repo}/releases?limit=10`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { status: "unreachable", current, error: r.status === 404 || r.status === 401 ? "El repositorio no es público o no existe: abre la página de descargas e inicia sesión." : `Respuesta ${r.status}` };
    const list = (await r.json()).filter((x) => !x.draft && !x.prerelease && /^v?\d+\.\d+/.test(x.tag_name)).sort((p, q) => compareVersions(q.tag_name, p.tag_name));
    const top = list[0]; if (!top || compareVersions(top.tag_name, current) <= 0) return { status: "current", current };
    const asset = pickAsset(top.assets, { platform, arch });
    // the URLs are built from the configured host: Gitea reports its internal address (ROOT_URL) in html_url / browser_download_url
    const page = `${host}/${repo}/releases/tag/${encodeURIComponent(top.tag_name)}`;
    return { status: "available", current, latest: { version: top.tag_name.replace(/^v/i, ""), name: top.name || top.tag_name, notes: String(top.body || "").slice(0, 1500), page, asset: asset ? { name: asset.name, url: `${host}/${repo}/releases/download/${encodeURIComponent(top.tag_name)}/${encodeURIComponent(asset.name)}`, size: asset.size } : null } };
  } catch (e) { return { status: "unreachable", current, error: "Sin conexión con el servidor de descargas." }; }
}
