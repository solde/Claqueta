# Memorias de proyecto: estudio de secciones y campos

_Generado por `scripts/memoir-study.mjs` a partir del catálogo de la aplicación (`app-seed/app/lib/memoir-catalog.mjs`). No lo edites a mano._

## 1. Qué es y para qué sirve
Una **memoria de proyecto** resume lo que se hizo, con qué recursos y qué resultados dio. Se pide para **justificar subvenciones o ayudas**, rendir cuentas a una **cadena o cliente**, cerrar una **temporada**, presentar el proyecto a **festivales y premios** o hacer un **balance interno**. Lo que separa una memoria buena de una mediocre:

1. **Datos verificables**, no adjetivos: cada afirmación lleva una cifra, una fecha o una fuente.
2. **Estructura predecible**: quien la evalúa busca secciones concretas en un orden concreto.
3. **Material visual con propósito**: fotos con pie y autoría, y gráficos que se leen de un vistazo.
4. **Coherencia entre secciones**: las mismas cifras en el resumen, en la economía y en los resultados.
5. **Adaptada al lector**: una justificación de subvención no se escribe como un dosier de festivales.

## 2. Cómo lo resuelve la aplicación
- Cada memoria tiene un **tipo** (qué secciones incluye por defecto), un **destinatario** (financiador, cadena, cliente), un **periodo**, un **idioma**, un **tono** (institucional, narrativo o técnico) y un **encargo** libre para quien la escribe (persona o agente).
- Cada **sección** tiene: texto en Markdown, **campos estructurados** (los de este documento), **imágenes** de la galería y **gráficos**; estado (vacía, borrador, revisión, aprobada, omitida) y una **completitud** calculada.
- La aplicación **rellena sola** lo que ya sabe (tabla «Datos automáticos» de cada sección): nadie teclea dos veces una cifra.
- El agente trabaja con `collado-doc memoir show/write/build` y crea material con `collado-doc media` y `collado-doc graphic`.
- **Ensamblar** genera un documento editable (con índice, portada con la marca, tablas, galería y gráficos) que se exporta a PDF o Word.

## 3. Tipos de memoria y secciones que incluyen
| Tipo | Para quién | Secciones por defecto |
|---|---|---|
| `subsidy` | Justificación de subvención o ayuda | cover, exec_summary, context, objectives, content, execution, team, locations, numbers, economic, audience, impact, compliance, next_steps, gallery, credits, annexes |
| `annual` | Memoria anual | cover, exec_summary, context, objectives, content, execution, team, locations, numbers, economic, audience, impact, compliance, risks_lessons, next_steps, gallery, credits, annexes |
| `client` | Informe para cliente o cadena | cover, exec_summary, context, objectives, content, execution, team, locations, numbers, economic, audience, impact, compliance, risks_lessons, next_steps, gallery, credits, annexes |
| `season_close` | Cierre de temporada | cover, exec_summary, context, objectives, content, execution, team, locations, numbers, economic, audience, impact, compliance, risks_lessons, next_steps, gallery, credits, annexes |
| `festival` | Dosier de festivales y premios | cover, exec_summary, context, content, execution, team, locations, numbers, audience, impact, next_steps, gallery, credits, annexes |
| `internal` | Balance interno | cover, exec_summary, context, objectives, content, execution, team, numbers, economic, impact, compliance, risks_lessons, next_steps, gallery, credits, annexes |

## 4. Secciones y campos
Tipos de campo: `text` (una línea), `long` (varios párrafos), `num`, `date`, `enum`, `list` (filas con las columnas indicadas), `media` (imágenes de la galería). Un asterisco marca lo **obligatorio** para considerar completa la sección.

### 4.1 Portada y datos del proyecto (`cover`)
Identifica el proyecto, el periodo que cubre y a quién va dirigida la memoria.

- **Extensión recomendada:** sin texto largo (sección visual o de listado)
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** ficha del programa (nombre, género, logline, productora, fechas, canal, cliente); periodo de la memoria
- **Material visual sugerido:** cover_art, hero image

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Subtítulo | `subtitle` | text |  |
| Edición o temporada | `edition` | text |  |
| Frase de portada | `tagline` | text |  |
| Productora | `producer` | text |  |
| Versión del documento | `version` | text |  |
| Imagen de portada | `cover_media` | media |  |

### 4.2 Resumen ejecutivo (`exec_summary`)
Una página que se lee sola: qué se ha hecho, con qué resultados y qué se concluye.

- **Extensión recomendada:** 150–350 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** episodios: número, estado, emisión, duración; minutos previstos y reales; presupuesto, real, comprometido y desviación (requiere permiso de finanzas); audiencia y cuota media, mejor y peor emisión
- **Material visual sugerido:** stats

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| El proyecto en una frase \* | `one_liner` | text |  |
| Cinco logros destacados | `highlights` | list | filas: Logro (`text`, text) |
| Cifras clave | `key_figures` | list | filas: Concepto (`label`, text), Valor (`value`, text), Unidad (`unit`, text) |
| Conclusión | `conclusion` | long |  |

### 4.3 Presentación y contexto (`context`)
De dónde nace el proyecto, qué es y a quién se dirige.

- **Extensión recomendada:** 200–500 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** ficha del programa (nombre, género, logline, productora, fechas, canal, cliente); targets de público
- **Material visual sugerido:** hero image, quote

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Logline | `logline` | text |  |
| Género y formato | `genre` | text |  |
| Origen y motivación | `origin` | long |  |
| Público objetivo | `target_audience` | long |  |
| Entidades colaboradoras | `partners` | list | filas: Entidad (`name`, text), Papel (`role`, text) |

### 4.4 Objetivos y grado de cumplimiento (`objectives`)
Qué se proponía el proyecto y en qué medida se ha conseguido, con indicadores medibles.

- **Extensión recomendada:** 150–400 palabras
- **Aplica a:** subsidy, annual, client, season_close, internal
- **Datos automáticos:** episodios: número, estado, emisión, duración; audiencia y cuota media, mejor y peor emisión
- **Material visual sugerido:** kpi_bars

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Objetivos e indicadores \* | `objectives` | list | filas: Objetivo (`objective`, text), Indicador (`indicator`, text), Meta (`target`, num), Logrado (`achieved`, num), Unidad (`unit`, text), Comentario (`comment`, text) |

### 4.5 Contenido y formato (`content`)
Qué se ha producido: estructura, secciones, temas y propuesta editorial.

- **Extensión recomendada:** 250–600 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** episodios: número, estado, emisión, duración; minutos previstos y reales; líneas editoriales
- **Material visual sugerido:** gallery, stills

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Descripción del formato | `format_description` | long |  |
| Línea editorial | `editorial_line` | long |  |
| Temas o bloques destacados | `themes` | list | filas: Tema (`theme`, text), Nota (`note`, text) |
| Invitados o protagonistas | `guests` | list | filas: Nombre (`name`, text), Episodio (`episode`, text), Por qué destaca (`why`, text) |
| Innovación o rasgos diferenciales | `innovation` | long |  |

### 4.6 Ejecución y cronología (`execution`)
Cómo se ha desarrollado el trabajo, fase a fase, y qué desviaciones hubo.

- **Extensión recomendada:** 250–600 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** hitos del proyecto; días de rodaje; episodios: número, estado, emisión, duración
- **Material visual sugerido:** timeline, gantt

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Fases \* | `phases` | list | filas: Fase (`phase`, text), Inicio (`start`, date), Fin (`end`, date), Resumen (`summary`, text) |
| Desviaciones y cambios | `deviations` | list | filas: Qué cambió (`what`, text), Motivo (`reason`, text), Medida adoptada (`action`, text) |
| Metodología de trabajo | `methodology` | long |  |

### 4.7 Equipo y organización (`team`)
Quién ha hecho el proyecto y cómo se ha organizado el trabajo.

- **Extensión recomendada:** 120–350 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** personas y roles del equipo
- **Material visual sugerido:** orgchart, photos of the team

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Descripción del equipo | `team_summary` | long |  |
| Responsables clave | `key_roles` | list | filas: Nombre (`name`, text), Cargo (`role`, text) |
| Personas implicadas | `headcount` | num |  |
| Proveedores y colaboraciones externas | `providers` | list | filas: Proveedor (`name`, text), Servicio (`service`, text) |
| Igualdad, inclusión y condiciones laborales | `equality` | long |  |

### 4.8 Localizaciones y rodaje (`locations`)
Dónde se ha grabado, cuántos días y qué logística ha hecho falta.

- **Extensión recomendada:** 100–300 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival
- **Datos automáticos:** localizaciones con coordenadas y días de rodaje; días de rodaje
- **Material visual sugerido:** locations_map, behind the scenes

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Resumen del rodaje | `summary` | long |  |
| Logística y desplazamientos | `logistics` | long |  |
| Permisos y autorizaciones | `permits` | long |  |

### 4.9 El proyecto en cifras (`numbers`)
Una página de cifras de un vistazo: episodios, minutos, días de rodaje, equipo, audiencia.

- **Extensión recomendada:** 0–120 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** episodios: número, estado, emisión, duración; minutos previstos y reales; días de rodaje; personas y roles del equipo; audiencia y cuota media, mejor y peor emisión; presupuesto, real, comprometido y desviación (requiere permiso de finanzas)
- **Material visual sugerido:** stats

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Cifras adicionales | `extra_stats` | list | filas: Valor (`value`, text), Concepto (`label`, text), Icono (`icon`, text) |

### 4.10 Memoria económica (`economic`)
Cuánto ha costado, cómo se ha financiado y por qué hay desviaciones.

- **Extensión recomendada:** 200–500 palabras
- **Aplica a:** subsidy, annual, client, season_close, internal
- **Permiso necesario para sus datos:** `fin.view`
- **Datos automáticos:** presupuesto, real, comprometido y desviación (requiere permiso de finanzas); presupuesto por capítulos; facturado, cobrado, subvenciones, margen (finanzas)
- **Material visual sugerido:** waterfall, donut by chapter

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Fuentes de financiación \* | `funding` | list | filas: Fuente (`source`, text), Importe (`amount`, num), Nota (`note`, text) |
| Explicación de desviaciones | `variance_notes` | long |  |
| Justificación del gasto | `justification` | long |  |
| Aportaciones en especie | `in_kind` | long |  |

### 4.11 Resultados y audiencia (`audience`)
Cómo ha respondido el público: emisión, audiencia, cuota, alcance y rendimiento digital.

- **Extensión recomendada:** 200–500 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival
- **Datos automáticos:** audiencia y cuota media, mejor y peor emisión; predicción de audiencia
- **Material visual sugerido:** audience line, heatmap

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Emisión y franja | `broadcast_note` | long |  |
| Resultados digitales | `digital` | list | filas: Plataforma (`platform`, text), Métrica (`metric`, text), Valor (`value`, num) |
| Lectura de los datos | `reading` | long |  |

### 4.12 Impacto y repercusión (`impact`)
Qué ha cambiado o se ha conseguido más allá de la emisión: prensa, premios, comunidad.

- **Extensión recomendada:** 150–450 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** audiencia y cuota media, mejor y peor emisión
- **Material visual sugerido:** quote, kpi_bars, press clippings

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Indicadores de impacto | `kpis` | list | filas: Indicador (`name`, text), Meta (`target`, num), Logrado (`achieved`, num), Unidad (`unit`, text) |
| Prensa y medios | `press` | list | filas: Medio (`outlet`, text), Titular (`title`, text), Fecha (`date`, date), URL (`url`, text) |
| Premios y selecciones | `awards` | list | filas: Premio o festival (`name`, text), Año (`year`, text), Resultado (`result`, text) |
| Testimonios | `quotes` | list | filas: Cita (`text`, text), Persona (`person`, text), Cargo o relación (`role`, text) |
| Impacto social o comunitario | `community` | long |  |

### 4.13 Cumplimiento, derechos y sostenibilidad (`compliance`)
Que todo está en regla: derechos, protección de datos, accesibilidad y buenas prácticas ambientales.

- **Extensión recomendada:** 150–400 palabras
- **Aplica a:** subsidy, annual, client, season_close, internal
- **Datos automáticos:** derechos por estado; incidencias de calidad
- **Material visual sugerido:** —

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Derechos y licencias | `rights_note` | long |  |
| Protección de datos e imagen | `data_protection` | long |  |
| Accesibilidad entregada | `accessibility` | list | filas: Medida (`measure`, text), Cobertura (`coverage`, text) |
| Medidas de sostenibilidad | `sustainability` | list | filas: Medida (`measure`, text), Resultado (`result`, text) |
| Huella de carbono estimada (kg CO₂e) | `carbon_kg` | num |  |

### 4.14 Riesgos y lecciones aprendidas (`risks_lessons`)
Qué estuvo a punto de salir mal, qué funcionó y qué haríamos distinto.

- **Extensión recomendada:** 150–400 palabras
- **Aplica a:** annual, season_close, internal, client
- **Datos automáticos:** riesgos principales y su mitigación
- **Material visual sugerido:** —

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Lecciones \* | `lessons` | list | filas: Lo que funcionó (`worked`, text), Lo que mejorar (`improve`, text), Recomendación (`recommendation`, text) |

### 4.15 Próximos pasos y continuidad (`next_steps`)
Qué viene después: distribución, nuevas temporadas, acciones pendientes.

- **Extensión recomendada:** 80–250 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** ninguno
- **Material visual sugerido:** —

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Acciones | `actions` | list | filas: Acción (`action`, text), Responsable (`owner`, text), Fecha (`date`, date) |
| Continuidad del proyecto | `continuity` | long |  |

### 4.16 Galería de imágenes (`gallery`)
La mejor selección visual del proyecto, con pie de foto y autoría.

- **Extensión recomendada:** sin texto largo (sección visual o de listado)
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** imágenes de la galería
- **Material visual sugerido:** gallery

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Imágenes seleccionadas | `media` | media |  |
| Composición | `layout` | enum | mosaic / strip / hero / grid |
| Texto introductorio | `intro` | text |  |

### 4.17 Créditos y agradecimientos (`credits`)
Quién ha financiado, producido y colaborado, con los logos y avisos que exijan los financiadores.

- **Extensión recomendada:** 0–200 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** personas y roles del equipo
- **Material visual sugerido:** logos

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Texto de financiación (lema obligatorio) | `funders_notice` | long |  |
| Agradecimientos | `acknowledgements` | long |  |
| Logos de financiadores y colaboradores | `logos` | media |  |

### 4.18 Anexos (`annexes`)
La documentación que respalda lo dicho: contratos, facturas, certificados, enlaces.

- **Extensión recomendada:** 0–150 palabras
- **Aplica a:** subsidy, annual, client, season_close, festival, internal
- **Datos automáticos:** ninguno
- **Material visual sugerido:** —

| Campo | Clave | Tipo | Contenido |
|---|---|---|---|
| Documentos anexos | `items` | list | filas: Referencia (`ref`, text), Documento (`title`, text), Nota (`note`, text) |

## 5. Galería de imágenes: campos de cada imagen
| Campo | Para qué |
|---|---|
| Título, **pie de foto**, **texto alternativo** | Lo que se imprime bajo la imagen y lo que oyen los lectores de pantalla |
| **Autoría** | Obligatoria en cualquier entrega externa |
| Tipo (fotografía, fotograma, detrás de las cámaras, captura, prensa, logo, documento, gráfico) y **fase** (desarrollo, preproducción, rodaje, postproducción, entrega, emisión, promoción) | Elegir la imagen adecuada para cada sección |
| Episodio, **localización**, fecha de la toma, personas que aparecen | Contexto y trazabilidad |
| **Derechos de uso** (propia, con licencia, autorización pendiente, restringida) y nota | Evitar publicar lo que no se puede |
| Destacada, orden | Selección automática de la galería |
| Ancho y alto, origen (subida, agente, generada), especificación | Maquetación y regeneración de gráficos |

## 6. Localizaciones
Nombre, tipo (exterior, plató, interior, remota), dirección, ciudad, país, **latitud y longitud**, fechas, **días de rodaje**, descripción, permiso y contacto. Alimentan la sección *Localizaciones y rodaje* y el mapa.

## 7. Gráficos que el agente y las personas pueden generar
Todos se dibujan con la **marca** del equipo (colores y tipografías), salen como imagen o como bloque vivo dentro del documento y se guardan en la galería.

| Tipo | Qué es | Datos que admite |
|---|---|---|
| `stats` | The project in numbers (stat cards) | title, auto, program, stats, width |
| `quote` | Quote card | text, person, role |
| `timeline` | Timeline of milestones or airings | items, source, program, title |
| `orgchart` | Team organisation chart | source, program, root |
| `locations_map` | Map of shoot locations (schematic, offline) | source, program, points |
| `kpi_bars` | Target vs achieved bars | items, source |
| `divider` | Section divider image | title, subtitle, number |
| `cover_art` | Cover artwork (portrait) | title, subtitle, footer |
| `chart` | Chart from inline data or a data source (bar, hbar, line, area, donut, waterfall, heatmap, gantt) | chart_type, data, source, x, y, stacked |

Gráficos de datos (tipo `chart`): barras, barras horizontales, líneas, **área**, anillo, **cascada** (del presupuesto al gasto real), **mapa de calor** y gantt.
Dentro de cualquier documento: `:::graphic type=…`, `:::gallery ids=… layout=mosaic|strip|hero|grid|logos` y `:::chart source=… type=…`.

## 8. Comprobaciones de calidad
- Completitud por sección (campos obligatorios + extensión mínima) y global.
- `collado-doc lint`: variables sin resolver, bloques de datos que fallan, marcas `[Indicar: …]` que quedan, saltos de título.
- Vista previa de páginas en PNG para revisar tablas, portada e imágenes.
- Derechos de imagen y datos personales: las imágenes con autorización pendiente o restringidas no deberían salir del equipo.
