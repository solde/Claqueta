// Built-in brand kits and document templates (Spanish). Duplicate and edit them from the UI, or ask the agent to create new ones; translated variants are just more templates.
import { create } from "../engine.mjs";

const BRANDS = [
  { name: "Collado", description: "Rojo REC con negro (por defecto)", primary: "#C8102E", accent: "#1C1F24", table_stripe: "#fbeeee", is_default: 1 },
  { name: "Sobrio", description: "Grafito y rojo señal; portada minimalista", primary: "#222222", accent: "#c8321f", muted: "#555555", table_stripe: "#f2f2f2", cover: "minimal", font_heading: "Liberation Sans", font_body: "Liberation Sans" },
  { name: "Editorial", description: "Serif, granate y dorado; portada dividida", primary: "#5a1f2b", accent: "#b08d57", muted: "#6a5d5d", table_stripe: "#f7f1ea", cover: "split", font_heading: "Liberation Serif", font_body: "Liberation Serif", base_size: 11, line_height: 1.5 },
  { name: "Neobrutalista", description: "Mismo lenguaje que la aplicación: negro, rojo REC y bordes gruesos", primary: "#000000", accent: "#F01E2C", muted: "#333333", text_color: "#000000", table_head_bg: "#F01E2C", table_stripe: "#ffe6e3", cover: "full", font_heading: "Space Grotesk", font_body: "Space Grotesk", font_mono: "Space Mono",
    custom_css: "h1,h2{text-transform:uppercase;letter-spacing:-.02em} h2{border-bottom:3pt solid #000} th{color:#000!important;border:1.5pt solid #000} td{border:.8pt solid #000} .callout,.box{border:1.5pt solid #000!important} .cover.full .ctitle{color:#FFFFFF}" },
];

const V = (key, label, type = "text", def) => ({ key, label, type, ...(def !== undefined ? { default: def } : {}) });
const LEGAL = `:::callout kind=warn title="Borrador orientativo"
Este texto es una plantilla de partida preparada por un asistente, **no es asesoramiento jurídico**. Debe revisarlo y adaptarlo una persona con formación jurídica antes de firmarlo.
:::`;

const TEMPLATES = [
  { key: "dossier", name: "Dossier de formato / pitch", type: "dossier", description: "Presentación del programa para cadenas y financiadores",
    options: { cover: "yes" }, variables: [V("highlights", "Puntos fuertes (Markdown)", "long"), V("ask", "Qué se pide (emisión, financiación, coproducción)", "text", "Valoración y reunión de seguimiento")],
    body: `---
title: {{program.name}}
subtitle: {{program.logline}}
client: {{program.channel_id_label}}
---
:::toc depth=2:::

## Resumen ejecutivo
{{program.logline}}

{{vars.highlights|md}}

## El formato
{{program.format_desc|md}}

:::kv
Género: {{program.genre}}
Duración: {{program.duration_min}} min
Episodios por temporada: {{program.episodes_per_season}}
Franja prevista: {{program.slot_desc}}
:::

## Público objetivo
:::data source=targets program={{program.id}}
:::

{{#if episode.id}}
## Estructura del programa
:::data source=rundown episode={{episode.id}}
:::
{{/if}}

## Competencia y contexto
:::data source=competitors program={{program.id}}
:::

## Equipo
Productor: {{program.producer}} · Productor ejecutivo: {{program.executive}}

## Calendario
:::data source=milestones program={{program.id}}
:::

## Siguiente paso
{{vars.ask}}

{{#if company.name}}{{company.name}} · {{company.email}} · {{company.phone}}{{/if}}
` },
  { key: "bible", name: "Biblia del programa", type: "bible", description: "Documento de referencia interno del formato",
    options: { cover: "yes" }, variables: [],
    body: `---
title: Biblia · {{program.name}}
subtitle: Documento de referencia del formato
---
:::toc depth=2:::

## 1. Concepto
{{program.logline}}

{{program.format_desc|md}}

## 2. Tono y estilo
_Describe el tono, la voz del presentador, la dirección de arte, el ritmo y las referencias._

## 3. Estructura del episodio
{{#if episode.id}}
:::data source=rundown episode={{episode.id}}
:::
{{else}}
_Añade aquí el reloj o la escaleta tipo del episodio (minutaje por bloque)._
{{/if}}

## 4. Secciones recurrentes
| Sección | Objetivo | Duración | Responsable |
|:--|:--|--:|:--|
|  |  |  |  |

## 5. Personajes y roles
:::data source=entity entity=people cols="name,kind,profession"
:::

## 6. Público
:::data source=targets program={{program.id}}
:::

## 7. Producción
- Plató/estudio:
- Equipo mínimo:
- Calendario tipo de un episodio: guion → grabación → montaje → QC → entrega

## 8. Normas editoriales
:::data source=entity entity=editorial_lines program={{program.id}} cols="title,body"
:::

## 9. Riesgos
:::data source=risks program={{program.id}}
:::
` },
  { key: "rundown", name: "Escaleta del episodio", type: "rundown", description: "Escaleta con tiempos acumulados", options: { orientation: "landscape" }, variables: [],
    body: `# Escaleta · {{program.name}} · E{{episode.number}} {{episode.title}}

**Emisión:** {{episode.air_date|date}} · **Duración objetivo:** {{episode.duration_target|duration}} · **Responsable:** {{episode.responsible}}

:::data source=rundown episode={{episode.id}} total=1
:::

## Notas de realización
` },
  { key: "callsheet", name: "Hoja de rodaje / citación", type: "callsheet", description: "Citación del equipo, horarios, localización y contactos", options: { orientation: "portrait" },
    variables: [V("date", "Fecha de rodaje", "date"), V("location", "Localización / plató"), V("address", "Dirección y cómo llegar", "long"), V("weather", "Previsión meteorológica"), V("hospital", "Centro sanitario más cercano"), V("notes", "Avisos para el equipo", "long")],
    body: `# Hoja de rodaje

:::kv
Programa: {{program.name}}
Episodio: E{{episode.number}} {{episode.title}}
Fecha: {{vars.date|date}}
Lugar: {{vars.location}}
Dirección: {{vars.address}}
Productor/a: {{program.producer}}
Meteo: {{vars.weather}}
:::

## Equipo citado
:::data source=crew episode={{episode.id}}
:::

## Recursos reservados
:::data source=bookings episode={{episode.id}}
:::

## Plan de la jornada
:::data source=rundown episode={{episode.id}}
:::

## Avisos
{{vars.notes|md}}

:::callout kind=danger title="Seguridad y emergencias"
Centro sanitario más cercano: {{vars.hospital}}. Teléfono de emergencias: 112. Cualquier incidente se comunica de inmediato a producción.
:::
` },
  { key: "broadcast-sheet", name: "Hoja de emisión (directo)", type: "callsheet", description: "Escaleta de directo con tiempos, contactos y plan B", options: { orientation: "landscape" },
    variables: [V("start", "Hora de inicio", "time"), V("director", "Realizador/a"), V("planb", "Plan B técnico", "long")],
    body: `# Hoja de emisión · {{program.name}}

**Fecha:** {{episode.air_date|date}} · **Inicio:** {{vars.start}} · **Realización:** {{vars.director}}

:::data source=rundown episode={{episode.id}} total=1
:::

## Equipo
:::data source=crew episode={{episode.id}}
:::

## Plan B
{{vars.planb|md}}
` },
  { key: "audience-report", name: "Informe de audiencias", type: "audience", description: "Evolución, comparativa y lectura de resultados", options: { cover: "yes" },
    variables: [V("analysis", "Lectura y conclusiones (Markdown)", "long"), V("sources", "Fuentes y metodología", "long", "Kantar Media (audimetría); consumo en directo + diferido según se indique.")],
    body: `---
title: Audiencias · {{program.name}}
subtitle: Informe de resultados
---
## Resumen
:::data source=ratings program={{program.id}} show="date,episode,audience,share,rating,target"
:::

:::chart source=ratings program={{program.id}} type=line x=date y=share title="Cuota de pantalla (%)"
:::

## Lectura
{{vars.analysis|md}}

## Competencia en la franja
:::data source=competitors program={{program.id}}
:::

## Fuentes y metodología
{{vars.sources|md}}
` },
  { key: "budget", name: "Presupuesto", type: "budget", description: "Presupuesto formal por capítulos y partidas", options: { cover: "yes" }, variables: [V("budget", "ID del presupuesto", "int"), V("notes", "Hipótesis y exclusiones", "long")],
    body: `---
title: Presupuesto · {{program.name}}
subtitle: Detalle por capítulos
---
## Resumen por capítulos
:::data source=budget budget={{vars.budget}}
:::

:::chart source=budget_chapters budget={{vars.budget}} type=hbar x=name y=planned title="Importe por capítulo"
:::

## Detalle de partidas
:::data source=budget budget={{vars.budget}} lines=1
:::

## Hipótesis y exclusiones
{{vars.notes|md}}

_Importes sin IVA salvo que se indique. Imprevistos incluidos según porcentaje del presupuesto._
` },
  { key: "variance", name: "Informe de desviación presupuestaria", type: "report", description: "Previsto vs real por capítulo y por episodio", options: { cover: "yes" }, variables: [V("budget", "ID del presupuesto", "int"), V("analysis", "Análisis de desviaciones", "long")],
    body: `---
title: Desviación presupuestaria · {{program.name}}
subtitle: Previsto, comprometido y real
---
## Por capítulo
:::data source=budget budget={{vars.budget}} actuals=1
:::

:::chart source=budget_chapters budget={{vars.budget}} type=bar x=name y=planned,actual,committed title="Previsto / real / comprometido"
:::

## Por episodio
:::data source=variance_episodes program={{program.id}}
:::

## Análisis
{{vars.analysis|md}}
` },
  { key: "weekly-status", name: "Informe semanal de estado", type: "report", description: "Estado del programa para la reunión de producción", variables: [V("highlights", "Novedades de la semana", "long"), V("decisions", "Decisiones pendientes", "long")],
    body: `# Estado semanal · {{program.name}}
_{{today|date}} · {{user.name}}_

## Resumen
{{vars.highlights|md}}

:::chart source=pipeline program={{program.id}} type=donut x=name y=n title="Episodios por estado"
:::

## Próximos hitos
:::data source=milestones program={{program.id}}
:::

## Tareas abiertas
:::data source=tasks program={{program.id}} f.status=in:todo|doing|review
:::

## Riesgos
:::data source=risks program={{program.id}}
:::

## Decisiones pendientes
{{vars.decisions|md}}
` },
  { key: "minutes", name: "Acta de reunión", type: "minutes", description: "Acuerdos, responsables y plazos", variables: [V("date", "Fecha", "date"), V("attendees", "Asistentes"), V("agenda", "Orden del día", "long"), V("agreements", "Acuerdos (lista)", "long")],
    body: `# Acta de reunión · {{program.name}}

:::kv
Fecha: {{vars.date|date}}
Asistentes: {{vars.attendees}}
Redacta: {{user.name}}
:::

## Orden del día
{{vars.agenda|md}}

## Acuerdos
{{vars.agreements|md}}

## Acciones
| Acción | Responsable | Plazo |
|:--|:--|:--|
|  |  |  |
` },
  { key: "sponsor", name: "Propuesta de patrocinio", type: "marketing", description: "Oferta comercial para un patrocinador", options: { cover: "yes" }, variables: [V("sponsor", "Patrocinador"), V("package", "Paquete propuesto (Markdown)", "long"), V("fee", "Inversión (€)", "num"), V("terms", "Condiciones", "long")],
    body: `---
title: Propuesta de patrocinio
subtitle: {{program.name}} × {{vars.sponsor}}
client: {{vars.sponsor}}
---
## El programa
{{program.logline}}

## Audiencia
:::data source=ratings program={{program.id}} show="date,audience,share"
:::

## Qué ofrecemos
{{vars.package|md}}

## Inversión
**{{vars.fee|money}}** (sin IVA)

## Condiciones
{{vars.terms|md}}
` },
  { key: "contract-image", name: "Cesión de derechos de imagen", type: "contract", description: "Autorización de uso de imagen y voz (borrador orientativo)", options: {},
    variables: [V("person", "Nombre de la persona"), V("id", "DNI/NIE"), V("scope", "Alcance de la cesión", "long", "Emisión y explotación del programa en televisión, plataformas online, redes sociales y promoción, sin límite de pases."), V("territory", "Territorio", "text", "Mundial"), V("term", "Duración", "text", "Duración de los derechos de explotación del programa"), V("city", "Ciudad")],
    body: `# Autorización de uso de imagen y voz
${LEGAL}

En {{vars.city}}, a {{today|date}}.

**REUNIDOS.** De una parte, {{company.legal_name}} (NIF {{company.vat_id}}), productora del programa «{{program.name}}», en adelante *la Productora*. De otra, **{{vars.person}}** (documento {{vars.id}}), en adelante *la persona participante*.

## Cláusulas
1. **Objeto.** La persona participante autoriza a la Productora a captar y utilizar su imagen, voz y nombre en el programa «{{program.name}}».
2. **Alcance.** {{vars.scope}}
3. **Territorio y duración.** Territorio: {{vars.territory}}. Duración: {{vars.term}}.
4. **Gratuidad / contraprestación.** [Indicar si la cesión es gratuita o la compensación pactada.]
5. **Protección de datos.** Responsable del tratamiento: {{company.legal_name}}. Finalidad: gestionar la participación y explotar el programa. Base jurídica: consentimiento y ejecución del acuerdo. Derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {{company.email}}.
6. **Menores.** Si la persona participante es menor, firma su representante legal, que declara tener capacidad para ello.
7. **Ley aplicable y jurisdicción.** [Indicar.]

:::signature names="La Productora|La persona participante" place="{{vars.city}}"
:::
` },
  { key: "contract-services", name: "Contrato de prestación de servicios", type: "contract", description: "Freelance / proveedor (borrador orientativo)", options: {},
    variables: [V("provider", "Prestador/a"), V("provider_id", "NIF/NIE"), V("service", "Servicio", "long"), V("fee", "Retribución (€)", "num"), V("payment", "Forma y plazo de pago", "text", "Transferencia a 30 días desde la factura"), V("start", "Inicio", "date"), V("end", "Fin", "date"), V("city", "Ciudad")],
    body: `# Contrato de prestación de servicios
${LEGAL}

En {{vars.city}}, a {{today|date}}.

**{{company.legal_name}}** (NIF {{company.vat_id}}), *el Cliente*, y **{{vars.provider}}** (NIF/NIE {{vars.provider_id}}), *el Prestador*, acuerdan:

1. **Objeto.** {{vars.service}} para el programa «{{program.name}}».
2. **Plazo.** Del {{vars.start|date}} al {{vars.end|date}}.
3. **Retribución.** {{vars.fee|money}} (más IVA y menos retención de IRPF si procede). {{vars.payment}}.
4. **Independencia.** El Prestador actúa por cuenta propia, sin relación laboral. [Validar con asesoría laboral.]
5. **Propiedad intelectual.** [Definir la cesión de derechos sobre los trabajos entregados: ámbito, territorio, duración, exclusividad.]
6. **Confidencialidad.** Toda la información no pública del programa es confidencial, también tras la terminación.
7. **Protección de datos.** Cada parte cumple el RGPD y la normativa española en los datos que trate.
8. **Resolución y ley aplicable.** [Indicar.]

:::signature names="El Cliente|El Prestador" place="{{vars.city}}"
:::
` },
  { key: "minor-authorisation", name: "Autorización para participación de menores", type: "contract", description: "Participación y uso de imagen de un menor (borrador orientativo)", options: {},
    variables: [V("minor", "Nombre del menor"), V("guardian", "Madre/padre/tutor legal"), V("guardian_id", "DNI/NIE del tutor"), V("recording", "Fechas y lugar de grabación", "long"), V("city", "Ciudad")],
    body: `# Autorización para la participación de un menor
${LEGAL}

:::callout kind=warn title="Requisitos adicionales"
La participación de menores en producciones audiovisuales exige verificar requisitos específicos (autorizaciones administrativas, horarios, descansos y presencia de adulto responsable). Consulte con la asesoría jurídica y laboral antes de grabar.
:::

D./Dña. **{{vars.guardian}}** (documento {{vars.guardian_id}}), como representante legal de **{{vars.minor}}**, autoriza su participación en el programa «{{program.name}}» y la captación y uso de su imagen y voz, en los términos y con los límites siguientes:

- Grabación: {{vars.recording}}
- Uso: emisión del programa y su promoción, sin usos que puedan perjudicar al menor.
- El menor estará acompañado en todo momento por una persona adulta responsable.
- Puede revocar esta autorización por escrito a {{company.email}}; la revocación no afecta a lo ya emitido.

Información sobre protección de datos: responsable {{company.legal_name}}; finalidad: gestionar la participación; base jurídica: consentimiento del representante legal; derechos: acceso, rectificación, supresión, oposición, limitación y portabilidad en {{company.email}}.

:::signature names="Representante legal|Productora" place="{{vars.city}}"
:::
` },
  { key: "delivery", name: "Paquete de entrega", type: "delivery", description: "Resumen de la entrega con checklist y huella", variables: [V("delivery", "ID de la entrega", "int")],
    body: `# Entrega · {{program.name}} E{{episode.number}} {{episode.title}}

:::data source=entity entity=deliveries episode={{episode.id}} cols="version,partner_id,spec_id,status,sent_at,tracking_ref,manifest_hash"
:::

## Material entregado
:::data source=entity entity=assets episode={{episode.id}} f.status=approved cols="title,kind,version,codec,resolution,duration_sec,checksum"
:::

## Derechos y música
:::data source=cue_sheet episode={{episode.id}}
:::

## Incidencias de QC
:::data source=qc_issues episode={{episode.id}}
:::
` },
  { key: "cue-sheet", name: "Cue sheet musical", type: "report", description: "Relación de obras musicales de un episodio", options: { orientation: "landscape" }, variables: [],
    body: `# Cue sheet · {{program.name}} · E{{episode.number}} {{episode.title}}

:::kv
Emisión: {{episode.air_date|date}}
Productora: {{company.legal_name}}
:::

:::data source=cue_sheet episode={{episode.id}} total=1
:::
` },
];

export async function seedDocs(ctx) {
  const ids = {};
  for (const b of BRANDS) { const row = await create(ctx, "brands", b); ids[b.name] = row.id; }
  for (const t of TEMPLATES) await create(ctx, "doc_templates", { name: t.name, type: t.type, language: "es", description: t.description, body: t.body, variables: t.variables || [], options: t.options || {}, brand_id: ids.Collado, builtin: 1, key: t.key }, { internal: true });
}

/** Existing installs: move the two built-in brands that still have the old colours to the REC red scheme (never touches brands the team edited). */
export async function recolourBuiltinBrands(ctx) {
  const { q } = await import("../db.mjs"); const { update } = await import("../engine.mjs");
  const OLD = { Collado: { primary: "#1f3a5f", accent: "#e0a100" }, Neobrutalista: { accent: "#FFDE59" } };
  const NEW = { Collado: { primary: "#C8102E", accent: "#1C1F24", table_stripe: "#fbeeee", description: "Rojo REC con negro (por defecto)" }, Neobrutalista: { accent: "#F01E2C", table_head_bg: "#F01E2C", table_stripe: "#ffe6e3", description: "Mismo lenguaje que la aplicación: negro, rojo REC y bordes gruesos" } };
  for (const [name, old] of Object.entries(OLD)) { const b = q.get("SELECT * FROM brands WHERE name = ?", name); if (b && Object.entries(old).every(([k, v]) => String(b[k]).toLowerCase() === v.toLowerCase())) await update(ctx, "brands", b.id, NEW[name], { force: true }); }
}
