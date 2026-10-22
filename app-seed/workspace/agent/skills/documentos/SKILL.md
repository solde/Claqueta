---
name: collado-documentos
description: Producir documentos de alta calidad y totalmente personalizables (PDF, Word, HTML, Excel, PowerPoint) con la marca del equipo — Markdown de Collado con portada, índice, tablas, gráficos, bloques de datos vivos, columnas, avisos y firmas; plantillas, marcas, previsualización en imágenes y revisión. Úsala siempre que haya que crear, rellenar, personalizar o exportar un documento, informe, dossier, contrato, escaleta, presupuesto o presentación.
---
# Documentos profesionales con Collado

## Flujo recomendado (sigue estos pasos)
1. **Elige el punto de partida**: `collado-doc templates` (dossier, bible, rundown, callsheet, broadcast-sheet, audience-report, budget, variance, weekly-status, minutes, sponsor, contract-image, contract-services, minor-authorisation, delivery, cue-sheet) y `collado-doc brands`. Si no hay plantilla, escribe tú el Markdown.
2. **Redacta en Markdown de Collado** en tu carpeta (`~/work/informe.md`). Usa **variables** y **bloques de datos** en vez de copiar cifras: así el documento sigue vivo.
3. **Revisa**: `collado-doc lint informe.md --program N` (variables sin resolver, bloques fallidos, marcas `[Indicar…]`, saltos de nivel de título).
4. **Renderiza**: `collado-doc render informe.md --format pdf --brand "Collado" --program N --cover -o informe.pdf` (también `docx`, `html`, `md`).
5. **Mira el resultado de verdad**: `collado-doc preview informe.md --program N --pages 1-4` genera `informe-preview-1.png…`; ábrelos con la herramienta de lectura de imágenes y corrige (tablas cortadas, páginas casi vacías, portada, títulos huérfanos, desbordes, orden). Repite hasta que esté limpio.
6. **Guarda y entrega**: `collado-doc save informe.md --program N --type report` (documento editable en la app, con historial) y/o el fichero exportado. Dile a la persona dónde está (`#/doc/ID`).

Atajos: `collado-doc new --template dossier --program N --var ask="…"` crea el documento editable ya relleno con datos reales; `collado-doc render --template callsheet --program N --episode N --var date=2026-02-01 --var location="Plató 1" --format pdf` renderiza sin guardar.

## Collado Markdown (resumen)
Markdown habitual (títulos `#`–`####`, negrita, cursiva, listas anidadas y de tareas, citas, código, tablas con alineación `:--|--:`, imágenes `![texto](att:ID "pie")` o `logo`) más:
```
---                                  (cabecera opcional)
title: Dossier · {{program.name}}
subtitle: Propuesta de formato
cover: band                          (yes|band|full|minimal|split|none)
client: Canal Demo
---
:::toc depth=2:::                    índice
:::callout kind=info|warn|danger|ok title="Ojo"
Texto…
:::
:::columns
Columna izquierda
---col---
Columna derecha
:::
:::box color=accent|primary|plain  …  :::
:::kv
Clave: valor
Otra clave: valor
:::
:::signature names="La Productora|La otra parte" place="Barcelona"
:::
:::landscape  …contenido apaisado…  :::
\pagebreak                           salto de página
```
**Variables**: `{{program.name}}`, `{{episode.title}}`, `{{season.number}}`, `{{company.legal_name}}`, `{{user.name}}`, `{{today}}`, `{{vars.clave}}`; filtros `{{x|money}}`, `|date`, `|pct`, `|num:1`, `|duration`, `|upper`, `|default:"-"`, `|join:", "`, `|md` (inserta Markdown tal cual); condicionales `{{#if vars.x}}…{{else}}…{{/if}}` y bucles `{{#each lista}}{{this.campo}}{{/each}}`. Lo que no existe sale vacío y **lint lo avisa**.
**Bloques de datos vivos** (tablas con formato por tipo y, si procede, fila de totales):
```
:::data source=episodes program={{program.id}}
:::
:::data source=budget budget=7 actuals=1 lines=1       (presupuesto por capítulos, con real/comprometido)
:::
:::data source=entity entity=contracts program=3 cols="title,party,end_date,status" f.status=active
:::
```
Orígenes: `collado-doc sources` (episodes, tasks, milestones, contracts, rights, targets, competitors, risks, cue_sheet, qc_issues, rundown, crew, bookings, budget, budget_chapters, variance_episodes, cashflow, tax, withholdings, profitability, ratings, pipeline, timesheets, alerts, rights_check, entity). Respetan **tus permisos**: si no ves finanzas, el bloque falla y lo dice.
**Gráficos**: `:::chart source=cashflow program=3 type=bar|line|hbar|donut|gantt x=month y=in,out title="Cashflow"` `:::` (SVG vectorial: en PDF/HTML nítido; en Word se rasteriza).
Los textos sustituidos se escapan; usa `|md` solo para Markdown que quieras interpretar.

## Marca y personalización (todo es dato)
- Una **marca** (`brands`) define colores (primario, acento, texto, tabla), fuentes (títulos/cuerpo/mono; fuentes propias subidas como adjuntos), tamaño base e interlineado, tamaño y orientación de página, márgenes, **portada** (`none|band|full|minimal|split`), logotipo, texto de cabecera y pie con variables (`{{brand}} {{title}} {{date}} {{page}} {{pages}} {{confidentiality}} {{version}}`), numeración, numeración de títulos, **marca de agua** (p. ej. DRAFT), aviso de confidencialidad, texto legal y **CSS propio** (`custom_css`, solo HTML/PDF).
  - Crea o ajusta: `collado-api create brands '{"name":"Cliente X","primary":"#0b3d91","accent":"#ff7a00","font_heading":"Inter","cover":"split","watermark":"BORRADOR","header_text":"{{brand}} · {{title}}"}'`.
  - Logo: sube la imagen como adjunto de la marca (`POST /api/files?entity=brands&id=N&name=logo.png`) y guarda el id en `logo_attachment_id`.
  - Úsala con `--brand "Cliente X"`. Fuentes instaladas seguras: Inter, Liberation Sans/Serif/Mono, DejaVu; las propias se incrustan en PDF/HTML (en Word hay que tenerlas instaladas).
- Una **plantilla** (`doc_templates`) es Markdown con `variables` (`[{key,label,type,default}]`) y `options` (`{"cover":"yes","orientation":"landscape"}`): `collado-api create doc_templates '{…}'`. Puedes crear plantillas por idioma, por cliente o por tipo de documento.
- Opciones por documento/por render: `--cover[=estilo]`, `--landscape`, `--watermark TEXTO`, `--lang es|ca|en` (cabeceras, fechas y números en ese idioma), `--pdfa`.

## Excel, Word a mano y PowerPoint
- **Excel**: `collado-doc xlsx --source budget --param budget=7 --param actuals=1 -o presupuesto.xlsx` (columnas tipadas, formatos de moneda/fecha/%, **fórmulas SUM**, cabecera con la marca, filtros, panel inmovilizado). A medida: `--spec spec.json` con `{"sheets":[{"name":"…","columns":[{"key","label","type":"money|num|pct|date|text","total":"sum"}],"rows":[…]}]}`.
- **Word/Excel con control total** en Python: `import sys; sys.path.insert(0,"/opt/collado-tools"); from colladodoc import brand, new_docx, add_table, new_xlsx, write_table` (usa python-docx/openpyxl con la marca).
- **PowerPoint**: `collado-doc deck deck.json -o presentacion.pptx` con
```json
{"title":"…","subtitle":"…","meta":"Cliente · 2026","footer":"Confidencial","slides":[
 {"type":"title"},{"type":"section","title":"El formato"},
 {"type":"bullets","title":"Puntos fuertes","bullets":["Uno",["subpunto","otro"],"Dos"],"notes":"Notas del orador"},
 {"type":"two","title":"Antes / después","left":["…"],"right":["…"]},
 {"type":"table","title":"Escaleta","columns":["Hora","Bloque"],"rows":[["09:00","Cabecera"]]},
 {"type":"chart","chart":"bar|line|pie|hbar","title":"Cuota","categories":["E1","E2"],"series":[{"name":"Share","values":[13.4,14.3]}]},
 {"type":"image","title":"Plató","path":"foto.png","caption":"…"},{"type":"quote","text":"…","by":"…"}]}
```
  Comprueba el resultado convirtiéndolo a PDF con LibreOffice (`soffice --headless --convert-to pdf`) y mirando las páginas con `pdftoppm -png`, si está disponible.

## Criterios de calidad (no entregues sin cumplirlos)
- Una idea por sección; resumen ejecutivo arriba; títulos que digan algo («La cuota sube un 12 %», no «Resultados»).
- Tablas ≤ 7 columnas en vertical (si no, `:::landscape` o `--landscape`); cifras alineadas con unidad; totales cuadrados.
- Portada y numeración en documentos formales; fecha, versión y autor visibles; confidencialidad si procede.
- Sin párrafos de más de ~8 líneas; listas cuando enumeras; imágenes con pie y resolución suficiente.
- Idioma y registro del destinatario; revisión ortográfica; sin marcas `[Indicar…]` ni variables vacías.
- Contratos y textos normativos: aviso de **revisión jurídica** visible (las plantillas ya lo incluyen).
- Contraste legible (la marca puede ser clara u oscura; la portada `full` usa el primario de fondo).

## Problemas frecuentes
- *«pdf_unavailable»*: el servidor no tiene WeasyPrint → entrega HTML o Word y avísalo.
- *Tabla que se corta*: reduce columnas, usa `show="a,b,c"` en el bloque de datos o apaisado.
- *Variable sin resolver*: revisa la ruta (`collado-api get programs N` muestra los campos); las referencias tienen etiqueta `<campo>_label` (`{{program.channel_id_label}}`).
- *Fuente que no sale*: usa una instalada o sube la fuente como adjunto de la marca.
- *Gráfico vacío en Word*: necesita `rsvg-convert`; si falta se inserta la tabla de datos.
