// "Caja de herramientas" for documents: which of the things that make documents come out at the best possible quality are available on THIS computer, what is lost if one is missing, and the exact
// command to install it on this operating system. Used by `collado-doc check` (agents run it when they start working on a project). Pure functions with injectable probes, so it is testable anywhere.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const pythonBin = () => process.env.COLLADO_PYTHON || (process.platform === "win32" ? "python" : "python3");
const GENERIC_FONTS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|inherit|initial)$/i;

/** Real probes (the tests replace them). */
export function realProbes(platform = process.platform) {
  const exts = platform === "win32" ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").concat([""]) : [""];
  const dirs = String(process.env.PATH || "").split(path.delimiter).concat(platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []);
  const which = (cmd, extra = []) => { for (const f of [...extra, ...dirs.flatMap((d) => exts.map((e) => path.join(d, cmd + e)))]) { try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ } } return null; };
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 }); return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() }; };
  const fontDirs = platform === "darwin" ? ["/System/Library/Fonts", "/Library/Fonts", path.join(os.homedir(), "Library/Fonts")] : platform === "win32" ? [path.join(process.env.WINDIR || "C:\\Windows", "Fonts"), path.join(process.env.LOCALAPPDATA || "", "Microsoft/Windows/Fonts")] : ["/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".fonts"), path.join(os.homedir(), ".local/share/fonts")];
  const fontFiles = () => { const out = []; const walk = (d, depth) => { let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const x of e) { if (x.isDirectory() && depth < 4) walk(path.join(d, x.name), depth + 1); else if (/\.(ttf|otf|ttc|woff2?)$/i.test(x.name)) out.push(x.name.toLowerCase().replace(/[^a-z0-9]/g, "")); } }; for (const d of fontDirs) walk(d, 0); return out; };
  return { platform, which, run, fontFiles, canWrite: (d) => { try { fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } }, exists: (p) => fs.existsSync(p) };
}

const soffice = { darwin: ["/Applications/LibreOffice.app/Contents/MacOS/soffice"], win32: ["C:\\Program Files\\LibreOffice\\program\\soffice.exe", "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"], linux: [] };
const hint = (platform, h) => h[platform] || h.linux || "";
const PY_MODULES = [["pptx", "python-pptx"], ["docx", "python-docx"], ["openpyxl", "openpyxl"], ["PIL", "pillow"], ["lxml", "lxml"]];

/** -> [{ id, label, level: "required"|"recommended"|"optional", ok, detail, impact, install }]. ctx = { caps, brands, program, probes } */
export function runChecks({ caps = {}, brands = [], program = null, probes = realProbes() }) {
  const P = probes, out = [], add = (r) => out.push(r), plat = P.platform, py = pythonBin(), tools = caps.tools || {};
  add({ id: "pdf", label: "Motor de PDF", level: "required", ok: !!tools.pdf, detail: tools.pdf ? (tools.pdf_engine || "disponible") : "no disponible",
    impact: "Sin él no hay PDF con la marca: solo HTML o Word.", install: "En la app de escritorio viene incluido: reiníciala (Ayuda › Buscar actualizaciones si persiste). En el servicio web hace falta WeasyPrint." });
  add({ id: "svg", label: "Gráficos en Word (SVG → imagen)", level: "recommended", ok: !!tools.svg_png, detail: tools.svg_png ? "disponible" : "no disponible", impact: "Los gráficos de los bloques `:::chart` no salen en el .docx (se inserta la tabla de datos).", install: "Viene con la app de escritorio; en el servicio web: librsvg (`rsvg-convert`)." });
  const pdftoppm = tools.png || P.which("pdftoppm");
  add({ id: "preview", label: "Vista previa de páginas (poppler / pdftoppm)", level: "recommended", ok: !!pdftoppm, detail: pdftoppm ? (typeof pdftoppm === "string" ? pdftoppm : "disponible") : "no encontrado",
    impact: "No podrás **ver** las páginas del documento (`collado-doc preview`) para corregir tablas cortadas, portadas vacías o desbordes: la revisión visual es imposible.",
    install: hint(plat, { darwin: "brew install poppler", win32: "scoop install poppler   (o: choco install poppler)", linux: "sudo apt install poppler-utils" }) });
  const so = P.which(plat === "win32" ? "soffice.exe" : "soffice", soffice[plat] || []) || P.which("libreoffice");
  add({ id: "office", label: "LibreOffice (convertir Word/Excel/PowerPoint a PDF)", level: "recommended", ok: !!so, detail: so || "no encontrado",
    impact: "No podrás comprobar cómo se ven los .docx, .xlsx y .pptx que generes (se entregarían sin ver): convertirlos a PDF para mirarlos exige LibreOffice.",
    install: hint(plat, { darwin: "brew install --cask libreoffice", win32: "winget install TheDocumentFoundation.LibreOffice", linux: "sudo apt install libreoffice-writer libreoffice-calc libreoffice-impress" }) });
  const pyPath = P.which(py) || (plat !== "win32" ? P.which("python") : P.which("python3")), pyv = pyPath ? P.run(pyPath, ["--version"]) : null, pyOk = !!(pyv?.ok && /Python 3\.(\d+)/.test(pyv.out) && Number(/Python 3\.(\d+)/.exec(pyv.out)[1]) >= 9);
  add({ id: "python", label: "Python 3.9+", level: "recommended", ok: pyOk, detail: pyOk ? `${pyv.out} (${pyPath})` : pyPath ? `versión no válida: ${pyv?.out || "?"}` : "no encontrado",
    impact: "Sin Python no hay PowerPoint (`collado-doc deck`) ni documentos Word/Excel a medida con las librerías de apoyo.",
    install: hint(plat, { darwin: "brew install python", win32: "winget install Python.Python.3.12", linux: "sudo apt install python3 python3-pip" }) });
  const missing = pyOk ? PY_MODULES.filter(([m]) => !P.run(pyPath, ["-I", "-c", `import ${m}`]).ok).map(([, pkg]) => pkg) : PY_MODULES.map(([, pkg]) => pkg);
  add({ id: "pymods", label: "Librerías de Python (python-pptx, python-docx, openpyxl, pillow, lxml)", level: "recommended", ok: pyOk && missing.length === 0, detail: !pyOk ? "requiere Python" : missing.length ? `faltan: ${missing.join(", ")}` : "todas instaladas",
    impact: "Faltan piezas para crear PowerPoint y Word/Excel a medida: propón PDF/Word estándar o instálalas.",
    install: `${py} -m pip install --user ${missing.length ? missing.join(" ") : PY_MODULES.map((x) => x[1]).join(" ")}    (si pip rechaza el entorno «gestionado»: usa un entorno virtual o pipx y define COLLADO_PYTHON con su python)` });
  const ff = P.which(plat === "win32" ? "ffmpeg.exe" : "ffmpeg");
  add({ id: "ffmpeg", label: "ffmpeg (fotogramas de vídeo para la galería, opcional)", level: "optional", ok: !!ff, detail: ff || "no encontrado", impact: "Sin él no puedes sacar fotogramas de los vídeos del proyecto con `collado-doc media frames` (sí puedes subir imágenes ya extraídas).",
    install: hint(plat, { darwin: "brew install ffmpeg", win32: "winget install Gyan.FFmpeg   (o: scoop install ffmpeg)", linux: "sudo apt install ffmpeg" }) });
  add({ id: "pandoc", label: "pandoc (opcional)", level: "optional", ok: !!P.which("pandoc"), detail: P.which("pandoc") || "no encontrado", impact: "Solo para conversiones de formato poco habituales.", install: hint(plat, { darwin: "brew install pandoc", win32: "winget install JohnMacFarlane.Pandoc", linux: "sudo apt install pandoc" }) });
  // fonts of the brands: PDF/HTML embed uploaded fonts, Word and the previews need them installed
  const wanted = new Map(); for (const b of brands) for (const k of ["font_heading", "font_body"]) { const f = String(b[k] || "").split(",")[0].replace(/["']/g, "").trim(); if (f && !GENERIC_FONTS.test(f)) (wanted.get(f) || wanted.set(f, new Set()).get(f)).add(b.name); }
  if (wanted.size) {
    const files = P.fontFiles(), norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ""), absent = [...wanted.keys()].filter((f) => !files.some((n) => n.includes(norm(f))));
    add({ id: "fonts", label: "Fuentes de las marcas instaladas", level: "recommended", ok: absent.length === 0, detail: absent.length ? `no encontradas: ${absent.map((f) => `${f} (${[...wanted.get(f)].join(", ")})`).join("; ")}` : `${wanted.size} fuente(s) encontradas`,
      impact: "Word y las vistas previas sustituirán la tipografía de la marca por otra; en PDF/HTML se incrustan si la fuente está subida como adjunto de la marca.", install: "Instala la fuente en el sistema (doble clic en el .ttf/.otf) o súbela como adjunto de la marca. La detección es aproximada (por nombre de archivo): si ya la tienes, ignora este aviso." });
  }
  if (program) {
    const f = program.folder; const ok = !f || (path.isAbsolute(f) && P.exists(f) && P.canWrite(f));
    add({ id: "folder", label: `Carpeta del proyecto «${program.name}»`, level: "required", ok, detail: !f ? "sin carpeta (se trabaja en tu carpeta de trabajo)" : !P.exists(f) ? `no existe: ${f}` : !P.canWrite(f) ? `sin permiso de escritura: ${f}` : f,
      impact: "Los archivos del proyecto no se podrán guardar donde la persona espera.", install: "Revisa el campo «Carpeta local» de la ficha del programa (o conecta el disco / reinicia el cliente de la nube que la contiene)." });
  }
  return out;
}
export function summarize(results) {
  const bad = (l) => results.filter((r) => !r.ok && r.level === l);
  return { ok: bad("required").length === 0, max_quality: results.every((r) => r.ok || r.level === "optional"), missing_required: bad("required").map((r) => r.id), missing_recommended: bad("recommended").map((r) => r.id) };
}
export function formatReport(results, { platform = process.platform, app = "" } = {}) {
  const sys = { darwin: "macOS", win32: "Windows", linux: "Linux" }[platform] || platform, L = [`Herramientas para documentos${app ? ` · ${app}` : ""} · ${sys}`, ""];
  for (const r of results) {
    L.push(`${r.ok ? "✔" : r.level === "required" ? "✖" : r.level === "recommended" ? "▲" : "·"} ${r.label} — ${r.detail}${r.level === "required" ? "  [imprescindible]" : r.level === "optional" ? "  [opcional]" : ""}`);
    if (!r.ok) { L.push(`    Pierdes: ${r.impact}`); if (r.install) L.push(`    Instalar: ${r.install}`); }
  }
  const s = summarize(results);
  L.push("", s.ok ? (s.max_quality ? "Calidad máxima posible: todo disponible." : `Se puede trabajar, pero NO a la máxima calidad: faltan ${s.missing_recommended.length} herramienta(s) recomendada(s). Propón instalarlas a la persona (no instales software del sistema sin su permiso) y di qué no podrás comprobar.`) : `Faltan herramientas imprescindibles (${s.missing_required.join(", ")}): resuélvelo o avisa antes de crear documentos.`);
  return L.join("\n");
}
