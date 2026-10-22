// Collado file manager ("Archivos"): a Finder-like explorer over the person's own home folder. All the work happens server side AS their system user
// (agentd -> fsops.mjs); this is only the UI. Uses helpers from shell.js ($, el, api, modal, buttons, toast, fmtDate). Loaded before shell.js.
"use strict";
const FM = (() => {
  const ICONS = { dir: "📁", trash: "🗑️", img: "🖼️", pdf: "📕", doc: "📝", sheet: "📊", deck: "📽️", audio: "🎵", video: "🎬", zip: "🗜️", code: "🧾", text: "📄", file: "📄", link: "🔗" };
  const EXT = { png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img", svg: "img", pdf: "pdf", doc: "doc", docx: "doc", odt: "doc", rtf: "doc", xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet", tsv: "sheet",
    ppt: "deck", pptx: "deck", odp: "deck", mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", mp4: "video", mov: "video", webm: "video", mkv: "video", zip: "zip", gz: "zip", tgz: "zip", tar: "zip",
    js: "code", mjs: "code", ts: "code", py: "code", sh: "code", json: "code", css: "code", html: "code", yml: "code", yaml: "code", xml: "code", sql: "code", md: "text", txt: "text", log: "text", ics: "text" };
  const KINDS = { img: "Imagen", pdf: "Documento PDF", doc: "Documento", sheet: "Hoja de cálculo", deck: "Presentación", audio: "Audio", video: "Vídeo", zip: "Archivo comprimido", code: "Código", text: "Texto", file: "Documento", dir: "Carpeta", link: "Alias" };
  const PREVIEW_IMG = new Set(["png", "jpg", "jpeg", "gif", "webp"]), PREVIEW_TEXT = new Set(["txt", "md", "json", "csv", "tsv", "log", "yaml", "yml", "js", "mjs", "ts", "css", "py", "sh", "xml", "ini", "toml", "sql", "ics", "html", "svg"]);
  const extOf = (n) => (n.includes(".") ? n.split(".").pop().toLowerCase() : "");
  const kindOf = (e) => (e.type === "dir" ? "dir" : EXT[extOf(e.name)] || "file");
  const iconOf = (e) => (e.link && e.type !== "dir" ? ICONS.link : ICONS[kindOf(e)] || ICONS.file);
  const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
  const join = (a, b) => (a ? `${a}/${b}` : b);
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const base = (p) => p.split("/").pop();
  const ERR = { exists: "Ya existe un elemento con ese nombre", not_found: "No se encuentra", forbidden: "Sin permiso para hacerlo", outside_home: "Fuera de tu carpeta", into_itself: "No se puede mover o copiar dentro de sí mismo",
    too_large: "Archivo demasiado grande", not_empty: "La carpeta no está vacía", no_directory: "La carpeta de destino no existe", invalid_path: "Nombre no válido" };
  const errText = (e) => ERR[e] || e || "No se pudo completar";
  const TRASH = ".Trash";
  const dt = (ms) => (ms ? new Date(ms).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "—");

  async function call(path, method = "GET", body) {   // like api(), but errors carry the server's code
    const r = await fetch("/_gw/api/" + path, { method, headers: { "x-requested-with": "collado", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { location.replace("/login"); throw new Error("sesión caducada"); }
    if (!r.ok) { const e = new Error(errText(d.error)); e.code = d.error; e.status = r.status; throw e; }
    return d;
  }
  const q = (o) => new URLSearchParams(o).toString();

  function mount(pane) {
    if (pane.dataset.fm) { if (mount.pending !== undefined) { const p = mount.pending; mount.pending = undefined; mount.S.load(p); } else mount.S?.refresh?.(); return; }
    pane.dataset.fm = "1";
    const S = (mount.S = { cwd: "", entries: [], sel: new Set(), anchor: null, view: localStorage.getItem("collado.fm.view") || "icon", sort: localStorage.getItem("collado.fm.sort") || "name", asc: localStorage.getItem("collado.fm.asc") !== "0",
      hidden: localStorage.getItem("collado.fm.hidden") === "1", back: [], fwd: [], clip: null, filter: "", found: null, loading: false, dirs: [], renaming: null });
    const persist = () => { try { localStorage.setItem("collado.fm.view", S.view); localStorage.setItem("collado.fm.sort", S.sort); localStorage.setItem("collado.fm.asc", S.asc ? "1" : "0"); localStorage.setItem("collado.fm.hidden", S.hidden ? "1" : "0"); } catch { /* ignore */ } };
    const inTrash = () => S.cwd === TRASH;

    // ---- skeleton -------------------------------------------------------------------------------------------------------------------------
    const side = el("nav", { class: "fm-side", "aria-label": "Ubicaciones" });
    const bBack = el("button", { class: "btn sm", type: "button", title: "Atrás (Alt+←)", "aria-label": "Atrás", onclick: () => go(-1) }, "‹");
    const bFwd = el("button", { class: "btn sm", type: "button", title: "Adelante (Alt+→)", "aria-label": "Adelante", onclick: () => go(1) }, "›");
    const bUp = el("button", { class: "btn sm", type: "button", title: "Carpeta superior (Alt+↑)", "aria-label": "Carpeta superior", onclick: () => up() }, "↑");
    const crumbs = el("div", { class: "fm-crumbs", role: "navigation", "aria-label": "Ruta" });
    const bIcon = el("button", { class: "btn sm", type: "button", "aria-label": "Vista de iconos", title: "Iconos", onclick: () => setView("icon") }, "▦");
    const bList = el("button", { class: "btn sm", type: "button", "aria-label": "Vista de lista", title: "Lista", onclick: () => setView("list") }, "☰");
    const sortSel = el("select", { "aria-label": "Ordenar por", onchange: () => { S.sort = sortSel.value; persist(); render(); } },
      [["name", "Nombre"], ["mtime", "Fecha"], ["size", "Tamaño"], ["kind", "Tipo"]].map(([v, l]) => el("option", { value: v }, l)));
    const search = el("input", { type: "search", class: "fm-search", placeholder: "Filtrar · Intro busca dentro", "aria-label": "Filtrar o buscar archivos", autocomplete: "off" });
    const bNew = el("button", { class: "btn sm", type: "button", title: "Nueva carpeta (Ctrl+Mayús+N)", onclick: () => newItem("dir") }, "＋ Carpeta");
    const bUpload = el("button", { class: "btn sm", type: "button", title: "Subir archivos", onclick: () => pick(false) }, "⇧ Subir");
    const bDown = el("button", { class: "btn sm primary", type: "button", title: "Descargar la selección (carpetas en .zip)", onclick: () => download([...S.sel].map((n) => full(n))) }, "⇩ Descargar");
    const bTrash = el("button", { class: "btn sm", type: "button", title: "Mover a la papelera (Supr)", onclick: () => remove() }, "🗑 Papelera");
    const bHidden = el("button", { class: "btn sm", type: "button", "aria-pressed": "false", title: "Mostrar archivos ocultos (Ctrl+Mayús+.)", onclick: () => { S.hidden = !S.hidden; persist(); render(); } }, ".·");
    const tool = el("div", { class: "fm-tool", role: "toolbar", "aria-label": "Herramientas" }, el("div", { class: "fm-nav" }, bBack, bFwd, bUp), crumbs,
      el("div", { class: "fm-views", role: "group" }, bIcon, bList), sortSel, bHidden, search);
    const actions = el("div", { class: "fm-actions", role: "toolbar", "aria-label": "Acciones" }, bNew, bUpload, bDown, bTrash);
    const content = el("div", { class: "fm-content", tabindex: "0", role: "listbox", "aria-multiselectable": "true", "aria-label": "Archivos" });
    const status = el("div", { class: "fm-status", "aria-live": "polite" });
    const xfers = el("div", { class: "fm-xfers" });
    const drop = el("div", { class: "fm-drop", hidden: true }, "Suelta aquí para subir");
    const fileInput = el("input", { type: "file", multiple: true, hidden: true }), dirInput = el("input", { type: "file", multiple: true, webkitdirectory: true, hidden: true });
    const menu = el("div", { class: "fm-menu pop", role: "menu", hidden: true });
    const main = el("div", { class: "fm-main" }, tool, actions, el("div", { class: "fm-body" }, content, drop), xfers, status);
    pane.replaceChildren(el("div", { class: "fm" }, side, main, menu, fileInput, dirInput));

    // ---- data ------------------------------------------------------------------------------------------------------------------------------
    const full = (name) => (S.found ? name : join(S.cwd, name));          // in search results `name` is already a path
    const byName = (n) => (S.found || S.entries).find((e) => e.name === n);
    async function load(path, { push = true, keep = false } = {}) {
      S.loading = true; status.textContent = "Cargando…";
      try {
        const d = await call("files/list?" + q({ path }));
        if (push && path !== S.cwd) { S.back.push(S.cwd); S.fwd = []; }
        S.cwd = d.path ?? path; S.entries = d.entries; S.found = null; S.filter = ""; search.value = "";
        if (!keep) { S.sel.clear(); S.anchor = null; }
        else for (const n of [...S.sel]) if (!S.entries.some((e) => e.name === n)) S.sel.delete(n);
      } catch (e) { toast(e.message); if (S.cwd !== path && path) return load("", { push: false }); }
      S.loading = false; render(); if (!keep) content.scrollTop = 0;
    }
    S.refresh = () => load(S.cwd, { push: false, keep: true }); S.load = load;
    const go = (d) => { const stack = d < 0 ? S.back : S.fwd; if (!stack.length) return; const to = stack.pop(); (d < 0 ? S.fwd : S.back).push(S.cwd); load(to, { push: false }); };
    const up = () => { if (S.cwd) load(parent(S.cwd)); };
    async function loadProjects() {   // desktop: projects (programs) that have a local folder
      if (!ME.desktop) return;
      try { const r = await (await fetch("/app/api/e/programs?limit=300&sort=name")).json(); S.projects = (r.rows || []).filter((p) => p.folder).map((p) => ({ id: p.id, name: p.name, folder: p.folder })); } catch { S.projects = []; }
    }
    async function loadSide() { await loadProjects(); try { const d = await call("files/list?" + q({ path: "" })); S.dirs = d.entries.filter((e) => e.type === "dir" && !e.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name, "es")); } catch { S.dirs = []; } renderSide(); }

    // ---- listing helpers -------------------------------------------------------------------------------------------------------------------
    function visible() {
      let l = S.found ? S.found.slice() : S.entries.filter((e) => (S.hidden || !e.name.startsWith(".")) && !(S.cwd === "" && e.name === TRASH));
      if (S.filter && !S.found) { const f = S.filter.toLowerCase(); l = l.filter((e) => e.name.toLowerCase().includes(f)); }
      const dir = S.asc ? 1 : -1, nm = (a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });
      const cmp = { name: nm, mtime: (a, b) => a.mtime - b.mtime, size: (a, b) => a.size - b.size, kind: (a, b) => KINDS[kindOf(a)].localeCompare(KINDS[kindOf(b)], "es") || nm(a, b) }[S.sort];
      return l.sort((a, b) => (a.type === "dir") !== (b.type === "dir") ? (a.type === "dir" ? -1 : 1) : dir * cmp(a, b));
    }

    // ---- rendering -------------------------------------------------------------------------------------------------------------------------
    function renderSide() {
      const item = (label, icon, path, extra = {}) => el("button", { type: "button", class: "fm-loc", "aria-current": S.cwd === path && !S.found ? "true" : "false", "data-path": path, onclick: () => load(path), ...extra }, el("span", { class: "i", "aria-hidden": "true" }, icon), el("span", {}, label));
      const projects = (S.projects || []).map((p) => { const lp = `Proyectos/${projectLinkName(p)}`; return item(p.name, "🎬", lp, { onclick: () => openProjectFolder(p), title: p.folder, "aria-current": S.cwd === lp || S.cwd.startsWith(lp + "/") ? "true" : "false" }); });
      side.replaceChildren(el("h3", {}, "Favoritos"), item("Inicio", "🏠", ""), item("Papelera", ICONS.trash, TRASH),
        ...(projects.length ? [el("h3", {}, "Proyectos"), ...projects] : []),
        ...(S.dirs.length ? [el("h3", {}, "Carpetas")] : []), ...S.dirs.filter((d) => !(projects.length && d.name === "Proyectos")).map((d) => item(d.name, "📁", d.name)));
    }
    function renderCrumbs() {
      const parts = S.cwd ? S.cwd.split("/") : [];
      const out = [el("button", { type: "button", onclick: () => load("") }, "Inicio")];
      parts.forEach((p, i) => { out.push(el("span", { class: "sep", "aria-hidden": "true" }, "›"), el("button", { type: "button", onclick: () => load(parts.slice(0, i + 1).join("/")), "aria-current": i === parts.length - 1 ? "page" : "false" }, p === TRASH ? "Papelera" : ME.desktop && parts[i - 1] === "Proyectos" ? p.replace(/-\d+$/, "") : p)); });
      crumbs.replaceChildren(...out);
    }
    function nameCell(e) {
      if (S.renaming === e.name) {
        const input = el("input", { class: "fm-rename", value: e.name, "aria-label": "Nuevo nombre", spellcheck: "false" });
        queueMicrotask(() => { input.focus(); const dot = e.type === "file" ? e.name.lastIndexOf(".") : -1; input.setSelectionRange(0, dot > 0 ? dot : e.name.length); });
        let done = false; const finish = (ok) => { if (done) return; done = true; S.renaming = null; if (ok && input.value.trim() && input.value !== e.name) doRename(e, input.value.trim()); else render(); content.focus(); };
        input.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); else if (ev.key === "Escape") finish(false); });
        input.addEventListener("blur", () => finish(true)); input.addEventListener("click", (ev) => ev.stopPropagation()); input.addEventListener("dblclick", (ev) => ev.stopPropagation());
        return input;
      }
      return el("span", { class: "nm", title: S.found ? e.name : e.name }, S.found ? base(e.name) : e.name);
    }
    function render() {
      bIcon.setAttribute("aria-pressed", String(S.view === "icon")); bList.setAttribute("aria-pressed", String(S.view === "list")); bHidden.setAttribute("aria-pressed", String(S.hidden)); sortSel.value = S.sort;
      bBack.disabled = !S.back.length; bFwd.disabled = !S.fwd.length; bUp.disabled = !S.cwd; renderCrumbs(); renderSide();
      const l = visible();
      content.className = `fm-content ${S.view}`;
      if (!l.length) content.replaceChildren(el("div", { class: "fm-empty" }, el("div", { class: "big", "aria-hidden": "true" }, S.found ? "🔍" : inTrash() ? ICONS.trash : "📂"),
        el("p", {}, S.found ? "Sin resultados" : S.filter ? "Nada coincide con el filtro" : inTrash() ? "La papelera está vacía" : "Carpeta vacía"), S.found || S.filter || inTrash() ? false : el("p", { class: "hint" }, "Arrastra archivos aquí o usa «Subir».")));
      else {
        const rows = l.map((e) => {
          const r = el("div", { class: "fm-item" + (S.sel.has(e.name) ? " sel" : "") + (S.clip?.cut && S.clip.paths.includes(full(e.name)) ? " cut" : ""), role: "option", "aria-selected": String(S.sel.has(e.name)), "data-name": e.name, "data-type": e.type,
            draggable: "true", title: S.found ? e.name : "" },
          el("span", { class: "ic", "aria-hidden": "true" }, iconOf(e)), nameCell(e),
          S.view === "list" ? [el("span", { class: "c-date" }, dt(e.mtime)), el("span", { class: "c-size" }, e.type === "dir" ? "—" : fmtSize(e.size)), el("span", { class: "c-kind" }, S.found ? parent(e.name) || "Inicio" : KINDS[kindOf(e)])] : false);
          return r;
        });
        if (S.view === "list") rows.unshift(el("div", { class: "fm-head", role: "presentation" }, ...[["name", "Nombre"], ["mtime", "Fecha de modificación"], ["size", "Tamaño"], ["kind", S.found ? "Carpeta" : "Tipo"]].map(([k, lab]) =>
          el("button", { type: "button", class: "h-" + k, onclick: () => { if (S.sort === k) S.asc = !S.asc; else { S.sort = k; S.asc = true; } persist(); render(); } }, lab, S.sort === k ? (S.asc ? " ▲" : " ▼") : ""))));
        content.replaceChildren(...rows);
      }
      updateBar();
    }
    /** Selection-dependent chrome; selection changes never rebuild the rows (a rebuilt row would swallow the second click of a double click). */
    function updateBar() {
      const l = visible(), n = S.sel.size;
      bDown.disabled = !n; bTrash.textContent = inTrash() ? "🗑 Vaciar" : "🗑 Papelera"; bTrash.title = inTrash() ? "Vaciar la papelera" : "Mover a la papelera (Supr)";
      bNew.hidden = inTrash(); bUpload.hidden = inTrash(); bTrash.disabled = inTrash() ? !S.entries.some((e) => !e.name.startsWith(".")) : !n;
      const tot = l.reduce((a, e) => a + (e.type === "file" ? e.size : 0), 0);
      status.textContent = n ? `${n} seleccionado${n > 1 ? "s" : ""} de ${l.length}` : S.found ? `${l.length} resultado${l.length === 1 ? "" : "s"}` : `${l.length} elemento${l.length === 1 ? "" : "s"}${tot ? ` · ${fmtSize(tot)}` : ""}`;
      if (S.clip) status.textContent += ` · ${S.clip.paths.length} ${S.clip.cut ? "cortado" : "copiado"}${S.clip.paths.length > 1 ? "s" : ""}`;
    }
    function paintSel() {
      for (const it of content.querySelectorAll(".fm-item")) { const on = S.sel.has(it.dataset.name); it.classList.toggle("sel", on); it.setAttribute("aria-selected", String(on)); }
      updateBar();
    }
    function setView(v) { S.view = v; persist(); render(); }

    // ---- selection -------------------------------------------------------------------------------------------------------------------------
    const names = () => visible().map((e) => e.name);
    function select(name, { add = false, range = false } = {}) {
      const all = names();
      if (range && S.anchor && all.includes(S.anchor)) { const a = all.indexOf(S.anchor), b = all.indexOf(name); if (!add) S.sel.clear(); for (const n of all.slice(Math.min(a, b), Math.max(a, b) + 1)) S.sel.add(n); }
      else if (add) { S.sel.has(name) ? S.sel.delete(name) : S.sel.add(name); S.anchor = name; }
      else { S.sel = new Set([name]); S.anchor = name; }
      paintSel();
    }
    const itemOf = (t) => t.closest?.(".fm-item");
    content.addEventListener("click", (ev) => {
      const it = itemOf(ev.target);
      if (!it) { if (!ev.target.closest(".fm-head")) { S.sel.clear(); paintSel(); } return; }
      select(it.dataset.name, { add: ev.ctrlKey || ev.metaKey, range: ev.shiftKey });
    });
    content.addEventListener("dblclick", (ev) => { const it = itemOf(ev.target); if (it) open(byName(it.dataset.name)); });
    content.addEventListener("contextmenu", (ev) => {
      ev.preventDefault(); const it = itemOf(ev.target);
      if (it) { if (!S.sel.has(it.dataset.name)) select(it.dataset.name); } else { S.sel.clear(); paintSel(); }
      showMenu(ev.clientX, ev.clientY, !!it);
    });
    // long press = context menu on touch screens
    let lp = null; content.addEventListener("touchstart", (ev) => { const it = itemOf(ev.target), t = ev.touches[0]; if (!it) return; lp = setTimeout(() => { if (!S.sel.has(it.dataset.name)) select(it.dataset.name); showMenu(t.clientX, t.clientY, true); lp = null; }, 550); }, { passive: true });
    for (const t of ["touchend", "touchmove", "touchcancel"]) content.addEventListener(t, () => { clearTimeout(lp); }, { passive: true });

    async function open(e) {
      if (!e) return;
      if (e.type === "dir") return load(full(e.name));
      if (inTrash()) return toast("Restaura el archivo para abrirlo");
      if (ME.desktop && window.colladoDesktop?.openPath) return openWithSystem(e);   // desktop: the application the system has chosen for this kind of file
      preview(e);
    }

    async function openWithSystem(e) {
      try {
        const { path } = await call("files/abspath?" + q({ path: full(e.name) }));
        const r = await window.colladoDesktop.openPath(path);
        if (r?.revealed) toast("Es un programa: se muestra en su carpeta en lugar de ejecutarlo");
        else if (r?.error) toast("No se pudo abrir: " + r.error);
      } catch (err) { toast(err.message); }
    }

    // ---- actions ---------------------------------------------------------------------------------------------------------------------------
    const selected = () => [...S.sel].map(byName).filter(Boolean);
    async function run(label, fn) { try { const r = await fn(); return r ?? true; } catch (e) { toast(`${label}: ${e.message}`); return false; } finally { await S.refresh(); if (!S.cwd || S.dirs.length) loadSide(); } }
    async function newItem(type) {
      const nm = await promptName(type === "dir" ? "Nueva carpeta" : "Nuevo archivo", type === "dir" ? "carpeta sin título" : "sin título.txt"); if (!nm) return;
      if (await run("No se pudo crear", () => call("files/" + (type === "dir" ? "mkdir" : "touch"), "POST", { path: join(S.cwd, nm) }))) { S.sel = new Set([nm]); S.anchor = nm; render(); }
    }
    function promptName(title, value, label = "Nombre") {
      const inp = el("input", { value, "aria-label": label, spellcheck: "false" });
      const ok = el("button", { class: "btn primary", type: "button", onclick: () => modal.close(inp.value.trim() || null) }, "Aceptar"), cancel = el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cancelar");
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } });   // preventDefault: focus returns to the opener button, which would otherwise be "clicked" by this same Enter
      const p = modal(title, el("div", {}, el("label", { class: "fm-lab" }, label, inp), buttons(cancel, ok)));
      queueMicrotask(() => { inp.focus(); const dot = value.lastIndexOf("."); inp.setSelectionRange(0, dot > 0 ? dot : value.length); });
      return p;
    }
    const confirmDlg = (title, text, okLabel = "Aceptar", danger = false) => new Promise((res) => {
      const ok = el("button", { class: "btn " + (danger ? "danger" : "primary"), type: "button", onclick: () => modal.close(true) }, okLabel);
      modal(title, el("div", {}, el("p", {}, text), buttons(el("button", { class: "btn", type: "button", onclick: () => modal.close(false) }, "Cancelar"), ok))).then((v) => res(!!v));
    });
    function startRename() { const s = selected(); if (s.length !== 1 || S.found || inTrash()) return; S.renaming = s[0].name; render(); }
    async function doRename(e, to) {
      if (to.includes("/")) { toast("El nombre no puede contener «/»"); return render(); }
      await run("No se pudo renombrar", async () => { try { await call("files/rename", "POST", { from: full(e.name), to: join(parent(full(e.name)), to) }); } catch (er) {
        if (er.code === "exists" && await confirmDlg("Ya existe", `Ya hay un elemento llamado «${to}». ¿Reemplazarlo?`, "Reemplazar", true)) await call("files/rename", "POST", { from: full(e.name), to: join(parent(full(e.name)), to), overwrite: true }); else throw er; } S.sel = new Set([to]); });
    }
    async function duplicate() { const s = selected(); if (!s.length || inTrash()) return; await run("No se pudo duplicar", async () => { for (const e of s) { const ext = e.type === "file" && e.name.includes(".") ? "." + extOf(e.name) : "", b = ext ? e.name.slice(0, -ext.length) : e.name; await call("files/copy", "POST", { from: full(e.name), to: join(parent(full(e.name)), `${b} copia${ext}`) }); } }); }
    async function remove() {
      if (inTrash()) {   // in the trash: delete for good / empty
        const s = selected();
        if (!s.length) { if (await confirmDlg("Vaciar la papelera", "Se eliminará todo lo que hay en la papelera. No se puede deshacer.", "Vaciar", true)) await run("No se pudo vaciar", () => call("files/emptytrash", "POST", {})); return; }
        if (await confirmDlg("Eliminar definitivamente", `¿Eliminar ${s.length === 1 ? `«${s[0].name}»` : `${s.length} elementos`}? No se puede deshacer.`, "Eliminar", true)) await run("No se pudo eliminar", () => call("files/rm", "POST", { paths: s.map((e) => join(TRASH, e.name)) }));
        S.sel.clear(); return;
      }
      const s = selected(); if (!s.length) return;
      await run("No se pudo mover a la papelera", () => call("files/trash", "POST", { paths: s.map((e) => full(e.name)) })); S.sel.clear(); toast(`${s.length === 1 ? "Movido" : s.length + " movidos"} a la papelera`); render();
    }
    async function restore() { const s = selected(); if (!s.length) return; await run("No se pudo restaurar", () => call("files/restore", "POST", { names: s.map((e) => e.name) })); S.sel.clear(); loadSide(); }
    function copyOrCut(cut) { const s = selected(); if (!s.length || inTrash()) return; S.clip = { cut, paths: s.map((e) => full(e.name)) }; render(); toast(`${s.length} ${cut ? "cortado" : "copiado"}${s.length > 1 ? "s" : ""}`); }
    async function paste(into = S.cwd) {
      if (!S.clip || inTrash()) return; const c = S.clip;
      await run("No se pudo pegar", async () => { for (const p of c.paths) { const to = join(into, base(p)); if (to === p && c.cut) continue; await call("files/" + (c.cut ? "rename" : "copy"), "POST", { from: p, to }); } });
      if (c.cut) S.clip = null; render();
    }
    async function moveTo(paths, dest) {   // drag & drop inside the manager
      const ok = paths.filter((p) => parent(p) !== dest && p !== dest && !dest.startsWith(p + "/")); if (!ok.length) return;
      await run("No se pudo mover", async () => { for (const p of ok) await call("files/rename", "POST", { from: p, to: join(dest, base(p)) }); }); S.sel.clear(); render();
    }
    function download(paths) {
      if (!paths.length) return; const a = el("a", { href: "/_gw/api/files/download?" + paths.map((p) => "path=" + encodeURIComponent(p)).join("&"), download: "" });
      document.body.append(a); a.click(); a.remove();
    }
    async function info() {
      const s = selected(), t = s.length ? s[0] : null, target = t ? full(t.name) : S.cwd; let d;
      try { d = await call("files/stat?" + q({ path: target })); } catch (e) { return toast(e.message); }
      const rows = [["Nombre", d.name || "Inicio"], ["Tipo", d.type === "dir" ? "Carpeta" : KINDS[kindOf(d)]], ["Tamaño", fmtSize(d.deep ?? d.size) + (d.type === "dir" ? " (con el contenido)" : "")], ["Ubicación", "~/" + parent(d.path || target)],
        ["Modificado", dt(d.mtime)], ["Permisos", d.mode], d.link ? ["Alias", "Sí"] : null].filter(Boolean);
      modal("Información", el("div", {}, el("div", { class: "fm-infohead" }, el("span", { class: "big", "aria-hidden": "true" }, iconOf(d)), el("strong", {}, d.name || "Inicio")), el("dl", { class: "kv" }, rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
        buttons(el("button", { class: "btn primary", type: "button", onclick: () => modal.close(null) }, "Cerrar"))));
    }
    async function doSearch(text) {
      if (!text.trim()) { S.found = null; return render(); }
      status.textContent = "Buscando…";
      try { const d = await call("files/find?" + q({ path: S.cwd, q: text.trim() })); S.found = d.entries.map((e) => ({ ...e, name: e.path })); S.sel.clear(); } catch (e) { toast(e.message); }
      render();
    }
    search.addEventListener("input", () => { S.filter = search.value; if (S.found) { S.found = null; } render(); });
    search.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") doSearch(search.value); else if (e.key === "Escape") { search.value = ""; S.filter = ""; S.found = null; render(); content.focus(); } else if (e.key === "ArrowDown") { e.preventDefault(); content.focus(); } });

    // ---- quick look ------------------------------------------------------------------------------------------------------------------------
    function preview(e) {
      const ext = extOf(e.name), url = "/_gw/api/files/download?" + q({ path: full(e.name), inline: "1" }), nm = base(e.name);
      let body;
      if (PREVIEW_IMG.has(ext)) body = el("img", { src: url, alt: nm, class: "ql-img" });
      else if (ext === "pdf") body = el("iframe", { src: url, title: nm, class: "ql-frame" });
      else if (["mp3", "wav", "ogg", "m4a"].includes(ext)) body = el("audio", { src: url, controls: true, class: "ql-media" });
      else if (["mp4", "webm", "mov"].includes(ext)) body = el("video", { src: url, controls: true, class: "ql-vid" });
      else if (PREVIEW_TEXT.has(ext) && e.size <= 1048576) { body = el("pre", { class: "ql-text" }, "Cargando…"); fetch(url).then((r) => r.text()).then((t) => { body.textContent = t.slice(0, 300000); }).catch(() => { body.textContent = "No se pudo leer el archivo."; }); }
      else body = el("div", { class: "fm-empty" }, el("div", { class: "big", "aria-hidden": "true" }, iconOf(e)), el("p", {}, PREVIEW_TEXT.has(ext) ? "Archivo demasiado grande para la vista previa." : "No hay vista previa para este tipo de archivo."));
      const dl = el("button", { class: "btn primary", type: "button", onclick: () => download([full(e.name)]) }, "⇩ Descargar");
      const done = modal(nm, el("div", { class: "ql" }, el("div", { class: "ql-body" }, body), buttons(el("span", { class: "grow ql-meta" }, `${fmtSize(e.size)} · ${dt(e.mtime)}`), dl, el("button", { class: "btn", type: "button", onclick: () => modal.close(null) }, "Cerrar"))));
      $("#modal .dialog")?.classList.add("wide");
      done.then(() => { $("#modal .dialog")?.classList.remove("wide"); body.pause?.(); if (body.tagName === "IFRAME") body.src = "about:blank"; });
    }
    function quickLook() { const s = selected(); if (s.length === 1 && s[0].type === "file" && !inTrash()) preview(s[0]); else if (s.length === 1 && s[0].type === "dir") info(); }

    // ---- context menu ----------------------------------------------------------------------------------------------------------------------
    function showMenu(x, y, onItem) {
      const s = selected(), one = s.length === 1, items = [];
      const add = (label, fn, o = {}) => items.push(el("button", { type: "button", role: "menuitem", disabled: o.disabled, onclick: () => { hideMenu(); fn(); } }, label, o.key ? el("kbd", {}, o.key) : false));
      const sep = () => items.push(el("div", { class: "sep" }));
      if (onItem && inTrash()) { add("Restaurar", restore); add("Eliminar definitivamente…", remove); sep(); add("Información", info); }
      else if (onItem) {
        add(one && (s[0].type === "dir" || ME.desktop) ? "Abrir" : "Vista previa", () => (one ? open(s[0]) : 0), { disabled: !one, key: "Intro" }); if (ME.desktop && one && s[0].type === "file") add("Vista previa", () => preview(s[0]), { key: "Espacio" }); add("Descargar" + (s.some((e) => e.type === "dir") || s.length > 1 ? " (.zip)" : ""), () => download(s.map((e) => full(e.name))));
        sep(); add("Renombrar", startRename, { disabled: !one || !!S.found, key: "F2" }); add("Duplicar", duplicate, { disabled: !!S.found }); add("Copiar", () => copyOrCut(false), { key: "Ctrl+C" }); add("Cortar", () => copyOrCut(true), { key: "Ctrl+X" });
        if (S.clip && one && s[0].type === "dir") add("Pegar dentro", () => paste(full(s[0].name)));
        sep(); add("Información", info, { key: "Ctrl+I" }); add("Mover a la papelera", remove, { key: "Supr" });
      } else if (inTrash()) { add("Vaciar la papelera…", remove, { disabled: !S.entries.some((e) => !e.name.startsWith(".")) }); }
      else { add("Nueva carpeta", () => newItem("dir"), { key: "Ctrl+⇧+N" }); add("Nuevo archivo de texto", () => newItem("file")); sep(); add("Pegar", () => paste(), { disabled: !S.clip, key: "Ctrl+V" }); add("Subir archivos…", () => pick(false)); add("Subir carpeta…", () => pick(true));
        sep(); add(S.hidden ? "Ocultar archivos ocultos" : "Mostrar archivos ocultos", () => { S.hidden = !S.hidden; persist(); render(); }); add("Información de esta carpeta", info); }
      menu.replaceChildren(...items); menu.hidden = false;
      const r = pane.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(x - r.left, r.width - w - 4)) + "px"; menu.style.top = Math.max(4, Math.min(y - r.top, r.height - h - 4)) + "px";
      menu.querySelector("button:not([disabled])")?.focus();
    }
    const hideMenu = () => { menu.hidden = true; };
    document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); });
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideMenu(); content.focus(); } else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const b = [...menu.querySelectorAll("button:not([disabled])")], i = b.indexOf(document.activeElement); b[(i + (e.key === "ArrowDown" ? 1 : -1) + b.length) % b.length]?.focus(); } });
    pane.addEventListener("scroll", hideMenu, true);

    // ---- keyboard --------------------------------------------------------------------------------------------------------------------------
    content.addEventListener("keydown", (ev) => {
      const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase(), all = names();
      if (mod && k === "a") { ev.preventDefault(); S.sel = new Set(all); paintSel(); }
      else if (mod && k === "c") { ev.preventDefault(); copyOrCut(false); } else if (mod && k === "x") { ev.preventDefault(); copyOrCut(true); } else if (mod && k === "v") { ev.preventDefault(); paste(); }
      else if (mod && k === "i") { ev.preventDefault(); info(); } else if (mod && k === "d") { ev.preventDefault(); duplicate(); }
      else if (mod && ev.shiftKey && k === "n") { ev.preventDefault(); newItem("dir"); }
      else if (mod && ev.shiftKey && (k === "." || k === ":")) { ev.preventDefault(); S.hidden = !S.hidden; persist(); render(); }
      else if (ev.altKey && ev.key === "ArrowLeft") { ev.preventDefault(); go(-1); } else if (ev.altKey && ev.key === "ArrowRight") { ev.preventDefault(); go(1); } else if ((ev.altKey && ev.key === "ArrowUp") || (mod && ev.key === "ArrowUp")) { ev.preventDefault(); up(); }
      else if (mod && ev.key === "ArrowDown") { ev.preventDefault(); const s = selected(); if (s.length === 1) open(s[0]); }
      else if (ev.key === "Enter") { ev.preventDefault(); const s = selected(); if (s.length === 1 && !ev.shiftKey) open(s[0]); }
      else if (ev.key === "F2") { ev.preventDefault(); startRename(); }
      else if (ev.key === " ") { ev.preventDefault(); quickLook(); }
      else if (ev.key === "Delete" || (ev.key === "Backspace" && mod)) { ev.preventDefault(); remove(); }
      else if (ev.key === "Backspace") { ev.preventDefault(); up(); }
      else if (ev.key === "Escape") { if (S.sel.size) { S.sel.clear(); paintSel(); } else if (S.found) { S.found = null; render(); } }
      else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault(); if (!all.length) return;
        const items = [...content.querySelectorAll(".fm-item")], cur = items.findIndex((i) => i.dataset.name === (S.anchor ?? "")); let i = cur < 0 ? 0 : cur;
        if (cur >= 0) {
          if (S.view === "list" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
            if (S.view === "list") i += ev.key === "ArrowDown" ? 1 : ev.key === "ArrowUp" ? -1 : 0;
            else { const r = items[cur].getBoundingClientRect(), vertical = ev.key === "ArrowDown" ? 1 : -1; const cand = items.filter((_, j) => (j - cur) * vertical > 0 && Math.abs(items[j].getBoundingClientRect().left - r.left) < r.width / 2 && (items[j].getBoundingClientRect().top - r.top) * vertical > 4);
              i = cand.length ? items.indexOf(vertical > 0 ? cand[0] : cand[cand.length - 1]) : cur; }
          } else i += ev.key === "ArrowRight" ? 1 : -1;
        }
        i = Math.max(0, Math.min(items.length - 1, i)); const name = items[i].dataset.name;
        if (ev.shiftKey) select(name, { range: true }); else { S.sel = new Set([name]); S.anchor = name; paintSel(); }
        content.querySelector(`.fm-item[data-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" });
      }
    });

    // ---- upload ----------------------------------------------------------------------------------------------------------------------------
    function pick(dir) { const inp = dir ? dirInput : fileInput; inp.value = ""; inp.click(); }
    fileInput.addEventListener("change", () => upload([...fileInput.files].map((f) => ({ file: f, rel: f.name }))));
    dirInput.addEventListener("change", () => upload([...dirInput.files].map((f) => ({ file: f, rel: f.webkitRelativePath || f.name }))));
    function putFile(rel, file, overwrite, onprogress) {
      return new Promise((resolve) => {
        const x = new XMLHttpRequest(); x.open("PUT", "/_gw/api/files/upload?" + q({ path: rel, mkdirs: "1", ...(overwrite ? { overwrite: "1" } : {}) }));
        x.setRequestHeader("x-requested-with", "collado"); x.upload.onprogress = (e) => e.lengthComputable && onprogress(e.loaded / e.total);
        x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* ignore */ } resolve({ status: x.status, error: d.error }); }; x.onerror = () => resolve({ status: 0, error: "network" }); x.send(file);
      });
    }
    async function upload(items, into = S.cwd) {
      if (!items.length || inTrash()) return; let okN = 0, replaceAll = null;
      for (const { file, rel } of items) {
        const bar = el("div", { class: "xf" }, el("span", { class: "xn" }, rel), el("progress", { max: "1", value: "0" })); xfers.append(bar);
        let r = await putFile(join(into, rel), file, false, (p) => { bar.querySelector("progress").value = p; });
        if (r.status === 409) {
          const yes = replaceAll ?? (await confirmDlg("Ya existe", `«${rel}» ya existe en esta carpeta. ¿Reemplazarlo?`, "Reemplazar", true)); if (items.length > 1 && replaceAll === null) replaceAll = yes;
          if (yes) r = await putFile(join(into, rel), file, true, (p) => { bar.querySelector("progress").value = p; }); else { bar.remove(); continue; }
        }
        bar.remove();
        if (r.status === 200) okN++; else toast(`${rel}: ${r.status === 413 ? "demasiado grande (máx. 200 MB)" : errText(r.error)}`);
      }
      if (okN) toast(`${okN} archivo${okN > 1 ? "s" : ""} subido${okN > 1 ? "s" : ""}`); await S.refresh(); loadSide();
    }
    async function readEntries(entry, prefix = "") {   // webkit directory traversal for dropped folders
      if (entry.isFile) return new Promise((res) => entry.file((f) => res([{ file: f, rel: prefix + f.name }]), () => res([])));
      const reader = entry.createReader(), out = []; const batch = () => new Promise((res) => reader.readEntries(res, () => res([])));
      for (let b = await batch(); b.length; b = await batch()) for (const c of b) out.push(...(await readEntries(c, prefix + entry.name + "/")));
      if (!out.length) return []; return out;
    }

    // ---- drag & drop (files from the OS and moves inside the manager) ---------------------------------------------------------------------------
    let dragPaths = null, depth = 0;
    content.addEventListener("dragstart", (ev) => {
      const it = itemOf(ev.target); if (!it || inTrash() || S.found) return ev.preventDefault();
      if (!S.sel.has(it.dataset.name)) { S.sel = new Set([it.dataset.name]); S.anchor = it.dataset.name; paintSel(); }
      dragPaths = [...S.sel].map(full); ev.dataTransfer.setData("text/plain", dragPaths.join("\n")); ev.dataTransfer.effectAllowed = "copyMove";
    });
    content.addEventListener("dragend", () => { dragPaths = null; content.querySelectorAll(".drop-on").forEach((n) => n.classList.remove("drop-on")); });
    const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
    const dropTarget = (t) => { const it = itemOf(t); return it?.dataset.type === "dir" ? it : null; };
    pane.addEventListener("dragenter", (ev) => { if (hasFiles(ev) && !inTrash()) { depth++; drop.hidden = false; } });
    pane.addEventListener("dragleave", (ev) => { if (hasFiles(ev) && --depth <= 0) { depth = 0; drop.hidden = true; } });
    pane.addEventListener("dragover", (ev) => {
      content.querySelectorAll(".drop-on").forEach((n) => n.classList.remove("drop-on"));
      const tgt = dropTarget(ev.target) || ev.target.closest(".fm-loc"); if (!hasFiles(ev) && !dragPaths) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = dragPaths ? (ev.altKey ? "copy" : "move") : "copy";
      if (tgt && !(dragPaths && tgt.classList.contains("fm-item") && S.sel.has(tgt.dataset.name))) tgt.classList.add("drop-on");
    });
    pane.addEventListener("drop", async (ev) => {
      ev.preventDefault(); depth = 0; drop.hidden = true; pane.querySelectorAll(".drop-on").forEach((n) => n.classList.remove("drop-on"));
      const dir = dropTarget(ev.target), loc = ev.target.closest(".fm-loc"), dest = dir ? full(dir.dataset.name) : loc ? loc.dataset.path : S.cwd;
      if (dragPaths) { const p = dragPaths; dragPaths = null; if (ev.altKey) { await run("No se pudo copiar", async () => { for (const x of p) await call("files/copy", "POST", { from: x, to: join(dest, base(x)) }); }); } else await moveTo(p, dest); return; }
      if (dest === TRASH) return;
      const its = [...(ev.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean), list = [];
      if (its.length) for (const e of its) list.push(...(await readEntries(e))); else for (const f of ev.dataTransfer.files) list.push({ file: f, rel: f.name });
      upload(list, dest);
    });

    // ---- start -----------------------------------------------------------------------------------------------------------------------------
        render(); load(mount.pending ?? "", { push: false }); mount.pending = undefined; loadSide();
    pane.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) hideMenu(); });
  }
  return { mount, refresh: () => mount.S?.refresh?.(), goto: (path) => { mount.pending = path; const pane = document.getElementById("pane-files"); if (mount.S && pane && !pane.hidden) { mount.pending = undefined; mount.S.load(path); } } };
})();
