// First-run content: workflow templates per programme type, budget skeletons, delivery specs, a generic working-time agreement, GDPR starters, settings.
// Everything is data: the team edits or deletes it from the UI. Seeds are applied once per `key` (see meta `seed:<key>`), so deleted items do not come back.
import { q, getMeta, setMeta, getSetting, setSetting, tx } from "./db.mjs";
import { create } from "./engine.mjs";
import { localCtx } from "./access.mjs";
import { DEFAULT_COMPLIANCE } from "./actions.mjs";
import { log } from "./util.mjs";

const J = JSON.stringify;
const ms = (title, offset_days, duration_days, after = [], kind = "phase") => ({ title, offset_days, duration_days, after, kind });
const WF = {
  magazine: { name: "Magacín (diario o semanal)", ms: [ms("Desarrollo del formato y biblia", 0, 21), ms("Maqueta / piloto", 21, 14, [0]), ms("Aprobación de la cadena", 35, 7, [1], "milestone"), ms("Preproducción: equipo, plató, grafismo", 42, 28, [2]),
      ms("Producción y emisión de la temporada", 70, 90, [3]), ms("Cierre, liquidación y balance de audiencias", 160, 21, [4])],
    tasks: ["Cerrar contrato con presentadores y colaboradores", "Reservar plató y control", "Definir parrilla de secciones y reloj de programa", "Plan de comunicación y redes", "Cerrar proveedores de grafismo y música"],
    pipeline: [["script", 7], ["recorded", 2], ["edited", 1], ["qc", 1], ["delivered", 1]] },
  news: { name: "Informativo", ms: [ms("Línea editorial y libro de estilo", 0, 14), ms("Diseño de escenografía y grafismo", 7, 28, [0]), ms("Pruebas técnicas y ensayos", 35, 14, [1]), ms("Emisión 0 / lanzamiento", 49, 1, [2], "milestone"), ms("Emisión regular", 50, 120, [3])],
    tasks: ["Acuerdos de agencias y fuentes", "Protocolo de verificación de información", "Plan de contingencia de directos", "Escaleta tipo y cronometraje", "Formación en normativa audiovisual (menores, rectificación)"],
    pipeline: [["script", 0], ["recorded", 0], ["delivered", 0]] },
  gameshow: { name: "Concurso / entretenimiento", ms: [ms("Desarrollo del formato y reglamento", 0, 28), ms("Licencia de formato / cesión de derechos", 14, 28, [0]), ms("Casting de concursantes", 42, 28, [1]), ms("Diseño de plató y juegos", 42, 42, [1]), ms("Ensayos y pruebas de juego", 90, 14, [2, 3]),
      ms("Grabación de la temporada", 105, 45, [4]), ms("Postproducción y entrega", 120, 60, [5])],
    tasks: ["Reglamento y bases legales del concurso", "Seguro de responsabilidad civil y de premios", "Autorizaciones de menores y concursantes", "Auditoría / notario de premios", "Plan de rodaje por bloques de grabación"],
    pipeline: [["recorded", 21], ["edited", 10], ["qc", 6], ["delivered", 4]] },
  documentary: { name: "Documental", ms: [ms("Investigación y tratamiento", 0, 45), ms("Pitch y financiación (cadena, ayudas)", 30, 60, [0], "milestone"), ms("Preproducción y localizaciones", 90, 30, [1]), ms("Rodaje", 120, 60, [2]),
      ms("Montaje y postproducción de imagen", 180, 60, [3]), ms("Música, mezcla y etalonaje", 240, 30, [4]), ms("Entrega y estreno", 270, 14, [5], "milestone")],
    tasks: ["Solicitar subvenciones y ayudas", "Cesiones de imagen y de derechos de archivo", "Plan de localizaciones y permisos", "Seguro de producción", "Clearance de archivo y música"],
    pipeline: [["recorded", 60], ["edited", 25], ["qc", 12], ["delivered", 7]] },
  live_radio: { name: "Radio en directo", ms: [ms("Diseño del programa y reloj de programación", 0, 14), ms("Equipo y estudio", 7, 21, [0]), ms("Programas de prueba", 28, 7, [1]), ms("Estreno", 35, 1, [2], "milestone"), ms("Temporada de emisión", 36, 200, [3])],
    tasks: ["Definir reloj de programación (hot clock)", "Acuerdos de publicidad y patrocinio", "Banco de sintonías, cortinillas y música (licencias)", "Protocolo de directos y plan B técnico", "Podcast on-demand: publicación del programa"],
    pipeline: [["script", 0], ["recorded", 0], ["delivered", 0]] },
  podcast: { name: "Podcast", ms: [ms("Concepto, formato y público objetivo", 0, 14), ms("Identidad sonora y de marca", 7, 21, [0]), ms("Episodio piloto", 21, 14, [1]), ms("Lanzamiento (3 episodios)", 35, 7, [2], "milestone"), ms("Temporada regular", 42, 100, [3])],
    tasks: ["Elegir alojamiento (hosting) y distribución", "Preparar arte, descripción y feed RSS", "Plan de promoción por episodio", "Contrato y condiciones con invitados", "Métricas: descargas, oyentes únicos y retención"],
    pipeline: [["script", 7], ["recorded", 5], ["edited", 2], ["delivered", 1]] },
};

const BUDGET_CHAPTERS = {
  common: [
    ["development", "01", "Desarrollo y biblia del formato", "global"], ["script", "02", "Guion / redacción", "mes"],
    ["artistic", "03", "Presentadores y colaboradores", "días"], ["artistic", "04", "Invitados y caché", "ud"],
    ["technical", "05", "Dirección y realización", "días"], ["technical", "06", "Equipo técnico (cámaras, sonido, iluminación)", "días"], ["technical", "07", "Producción (jefe/a, ayudantes)", "días"],
    ["studios", "08", "Alquiler de plató / estudio", "días"], ["equipment", "09", "Alquiler de equipos y unidades móviles", "días"], ["location", "10", "Localizaciones y exteriores", "días"],
    ["postproduction", "11", "Montaje y edición", "días"], ["postproduction", "12", "Grafismo y animación", "global"], ["postproduction", "13", "Mezcla, sonorización y etalonaje", "días"],
    ["music_rights", "14", "Música, archivo y derechos", "global"], ["insurance", "15", "Seguros (producción, RC)", "global"], ["travel", "16", "Viajes, dietas y alojamiento", "días"],
    ["marketing", "17", "Promoción y comunicación", "global"], ["overheads", "18", "Gastos generales y administración", "mes"],
  ],
};
const BUDGET_KIND_EXTRA = {
  gameshow: [["artistic", "04b", "Premios y dotación de juegos", "global"], ["studios", "08b", "Escenografía y atrezo", "global"]],
  documentary: [["development", "01b", "Investigación y documentación", "mes"], ["music_rights", "14b", "Compra de archivo y derechos de imagen", "global"]],
  live_radio: [["technical", "06b", "Operación técnica y emisión", "mes"], ["overheads", "18b", "Líneas, streaming y distribución", "mes"]],
  podcast: [["technical", "06b", "Edición y sonido por episodio", "ud"], ["marketing", "17b", "Hosting, distribución y promoción de episodios", "mes"]],
};

const SPECS = [
  { name: "TV HD · generalista (plantilla)", container: "MXF OP1a", video_codec: "XDCAM HD422 50 Mbps", resolution: "1920x1080", fps: "25p", scan: "progresivo", colorspace: "Rec.709", audio_layout: "Estéreo (+ M&E si procede), 48 kHz 24 bit",
    loudness: "-23 LUFS (EBU R128, ±0,5 LU)", true_peak: "-1 dBTP", subtitles: "Fichero aparte (STL/SRT/XML) según cadena", naming: "PROGRAMA_Exxx_vN_HD.mxf", delivery_method: "Según cadena (FTP/Aspera/disco)",
    notes: "Plantilla orientativa: la especificación vinculante es la de la cadena. Sustituir por sus valores.",
    list: [["Vídeo dentro de la norma (códec, resolución, fps)", "video"], ["Cabecera y cierre correctos; barras/tono y claqueta según cadena", "video"], ["Sin pérdida de fotogramas ni fallos de sincronía", "video"], ["Áreas seguras de título y grafismo respetadas", "video"],
      ["Sonoridad medida (programa y total) dentro de tolerancia", "audio"], ["Pico real por debajo del límite", "audio"], ["Pistas de audio en el orden pedido (L/R, M&E)", "audio"], ["Subtítulos / subtitulado para sordos entregados", "access"], ["Audiodescripción entregada (si aplica)", "access"],
      ["Duración total y por bloques conforme a escaleta", "editorial"], ["Cue sheet entregada", "legal"], ["Autorizaciones y cesiones archivadas", "legal"], ["Nomenclatura y metadatos del fichero correctos", "meta"]] },
  { name: "Streaming / OTT (plantilla)", container: "MOV / MP4", video_codec: "ProRes 422 HQ o H.264/H.265 alto bitrate", resolution: "3840x2160 o 1920x1080", fps: "25p", colorspace: "Rec.709 / Rec.2020 según plataforma",
    audio_layout: "Estéreo + 5.1 opcional", loudness: "Según plataforma (p. ej. -27 LKFS diálogo en OTT)", true_peak: "-2 dBTP", subtitles: "IMSC/TTML o SRT por idioma", naming: "TÍTULO_TEMP_EPISODIO_IDIOMA", delivery_method: "Portal de la plataforma",
    notes: "Plantilla orientativa: confirmar con la guía técnica de la plataforma.",
    list: [["Master en el formato pedido", "video"], ["Subtítulos por idioma validados", "access"], ["Audio mezcla estéreo (y 5.1 si procede)", "audio"], ["Metadatos y sinopsis", "meta"], ["Imágenes promocionales y póster", "meta"], ["Informe de QC", "quality"]] },
  { name: "Radio · emisión (plantilla)", container: "WAV / BWF", video_codec: "", resolution: "", fps: "", audio_layout: "Estéreo 48 kHz 24 bit", loudness: "-23 LUFS (EBU R128) o criterio de la emisora", true_peak: "-1 dBTP", naming: "PROGRAMA_FECHA_vN.wav",
    delivery_method: "Según emisora", notes: "Plantilla orientativa.", list: [["Duración exacta y cierre sin silencios", "audio"], ["Sonoridad medida", "audio"], ["Sin clipping ni ruido de fondo", "audio"], ["Cue sheet musical", "legal"], ["Ficha del programa y guion de continuidad", "meta"]] },
  { name: "Podcast · distribución (plantilla)", container: "MP3 128–192 kbps CBR o AAC", video_codec: "", resolution: "", fps: "", audio_layout: "Estéreo (o mono para voz) 44,1 kHz", loudness: "-16 LUFS estéreo (referencia habitual; confirmar plataforma)", true_peak: "-1 dBTP", naming: "podcast_eNNN_titulo.mp3",
    delivery_method: "Hosting + RSS", notes: "Plantilla orientativa.", list: [["Etiquetas ID3 y arte de portada 3000x3000", "meta"], ["Sonoridad y pico real correctos", "audio"], ["Descripción, capítulos y notas del episodio", "meta"], ["Música y samples con licencia", "legal"], ["Consentimiento de invitados", "legal"]] },
];

/** First-run seed data of an organization: workflow templates, collective agreement, delivery specs, GDPR records, default settings, document templates and brands. Idempotent (each block runs once). */
export async function seedAll() {
  const ctx = localCtx("sistema");
  await once("workflows", async () => {
    for (const [kind, w] of Object.entries(WF)) {
      const lines = [...BUDGET_CHAPTERS.common, ...(BUDGET_KIND_EXTRA[kind] || [])];
      const b = await create(ctx, "budgets", { name: `Plantilla de partidas · ${w.name}`, kind: "template", status: "draft", contingency_pct: 5, notes: "Estructura orientativa: importes a cero para que el equipo los rellene." });
      for (const [chapter, code, description, unit] of lines) await create(ctx, "budget_lines", { budget_id: b.id, chapter, code, description, qty: 1, unit, unit_cost: 0, vat_rate: 21 });
      await create(ctx, "workflow_templates", { name: w.name, kind, description: "Fases, hitos y tareas típicas; ajusta fechas al crear el programa.", milestones: w.ms, tasks: w.tasks.map((title, i) => ({ title, offset_days: 7 + i * 7, priority: "medium" })),
        episode_pipeline: w.pipeline.map(([status, days_before_air]) => ({ status, days_before_air })), budget_template_id: b.id });
    }
  });
  await once("agreements", async () => {
    await create(ctx, "agreements", { name: "Referencia legal general (Estatuto de los Trabajadores)", max_daily_hours: 9, max_weekly_hours: 40, min_daily_rest: 12, min_weekly_rest: 36, overtime_mult: 1.25, night_mult: 1.25, holiday_mult: 1.75, max_overtime_year: 80,
      notes: "Valores de referencia del marco general (jornada ordinaria 40 h/semana en cómputo anual, máx. 9 h/día, descanso de 12 h entre jornadas y 1,5 días semanales, 80 h extra/año). Sustituir por el convenio colectivo que aplique a cada persona." });
  });
  await once("specs", async () => {
    for (const s of SPECS) { const { list, ...rest } = s; await create(ctx, "delivery_specs", { ...rest, checklist: list.map(([label, category], i) => ({ id: `c${i + 1}`, label, category, required: true })) }); }
  });
  await once("gdpr", async () => {
    await create(ctx, "processing_activities", { name: "Gestión de equipo, talento e invitados", purpose: "Contratación, citaciones, pagos y obligaciones laborales y fiscales de las personas que participan en las producciones.", legal_basis: "contract",
      data_categories: "Identificación, contacto, datos bancarios, tarifas, imagen y voz.", data_subjects: "Equipo, freelance, talento, invitados.", recipients: "Gestoría/asesoría, entidades de gestión, cadena (listados de equipo).", retention_months: 72, security_measures: "Acceso por roles, doble factor, cifrado de campos sensibles y de contratos, auditoría de cambios.", owner: "", notes: "Ejemplo inicial: revisar con el DPO o la asesoría." });
    await create(ctx, "processing_activities", { name: "Casting y participantes (concursantes, público)", purpose: "Selección y participación en grabaciones, incluidas autorizaciones de imagen y de menores.", legal_basis: "consent", data_categories: "Identificación, contacto, imagen, voz, datos de menores y tutores.", data_subjects: "Candidatos, concursantes, público, menores.",
      retention_months: 24, security_measures: "Formularios con consentimiento explícito; borrado tras el plazo.", dpia_required: 0, notes: "Ejemplo inicial: revisar con el DPO o la asesoría." });
    await create(ctx, "retention_policies", { name: "Contratos finalizados", entity: "contracts", filter: "status IN ('expired','terminated')", date_field: "end_date", months: 72, action: "review", notes: "Referencia: plazo mercantil de 6 años; confirmar con la asesoría." });
    await create(ctx, "retention_policies", { name: "Solicitudes de derechos resueltas", entity: "dsr_requests", filter: "status IN ('resolved','rejected')", date_field: "received", months: 36, action: "review" });
  });
  await once("settings", async () => {
    if (!getSetting("company")) setSetting("company", { name: "", legal_name: "", vat_id: "", address: "", email: "", phone: "", web: "" }, "sistema");
    if (!getSetting("finance")) setSetting("finance", { opening_balance: 0, default_vat: 21, vat_rates: [21, 10, 4, 0], irpf_rates: [0, 7, 15, 19], odoo: {} }, "sistema");
    if (!getSetting("alerts")) setSetting("alerts", { contract_days: 60, right_days: 60, grant_days: 45, overrun_warn: 90, delivery_days: 7 }, "sistema");
    if (!getSetting("compliance_checklists")) setSetting("compliance_checklists", DEFAULT_COMPLIANCE, "sistema");
  });
  try { const { seedDocs, recolourBuiltinBrands } = await import("./docs/seed.mjs"); await once("docs-v1", () => seedDocs(ctx)); await once("brands-rec-v1", () => recolourBuiltinBrands(ctx)); } catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND") log("seed docs failed:", e.message); }
}
/** Runs a seed block only if its marker is not in the meta table, then records it. */
async function once(key, fn) {
  if (getMeta(`seed:${key}`)) return;
  await fn(); setMeta(`seed:${key}`, new Date().toISOString()); log("seeded", key);
}
