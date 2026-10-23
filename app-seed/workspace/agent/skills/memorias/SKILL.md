---
name: collado-memorias
description: Redactar memorias de proyecto (justificación de subvención, memoria anual, informe para cadena o cliente, cierre de temporada, dosier de festivales) sección a sección, con datos reales del proyecto, galería de imágenes y gráficos propios (cifras, cronología, organigrama, mapa de localizaciones, cascada de presupuesto, tarjetas de cita, portadas y separadores). Úsala cuando te pidan una memoria, un balance o un informe de resultados, cuando haya que crear imágenes o infografías para un programa, o para ordenar y poner pie de foto a su galería.
---
# Memorias de proyecto: texto por secciones y material gráfico

Una **memoria** es un conjunto de **secciones** (resumen ejecutivo, objetivos, ejecución, economía, audiencia, impacto…). Cada sección tiene **texto**, **campos estructurados** (tablas de objetivos, hitos, premios, financiación…), **imágenes** de la galería y **gráficos**. Claqueta/Collado ensambla todo en un documento editable que se exporta a PDF o Word con la marca del equipo.

## Flujo (síguelo en orden)
1. **Comprueba las herramientas**: `collado-doc check --program N` (motor de PDF, rasterizador de gráficos).
2. **Crea o localiza la memoria**: `collado-doc memoir list --program N`; si no existe, `collado-doc memoir new --program N --kind subsidy|annual|client|season_close|festival|internal --funder "Destinatario" --ref "EXP-1"`. `collado-doc memoir catalog` te enseña **todas las secciones y sus campos** (con la finalidad y la extensión recomendada de cada una).
3. **Lee el encargo y los datos**: `collado-doc memoir show ID`. Te da, por sección, el estado, lo que falta, el encargo concreto de la persona (`ENCARGO`), las **cifras reales del proyecto** (episodios, minutos, días de rodaje, equipo, presupuesto, audiencia, riesgos, hitos, localizaciones) y la galería con sus pies de foto. Es tu **única fuente de cifras**.
4. **Reúne lo que no está en la aplicación**: lee los documentos del proyecto y su carpeta local; pregunta a la persona por lo que solo ella sabe (objetivos y metas, premios, prensa, testimonios, lecciones). No lo inventes.
5. **Escribe cada sección** (`collado-doc memoir write ID SECCION texto.md --field clave=valor --fields campos.json --status draft`). Texto en Markdown de Collado (ver `collado-documentos`). Los **campos de lista** (objetivos, hitos, premios, prensa, financiación…) van en `--fields` como JSON: `{"objectives":[{"objective":"…","indicator":"…","target":10,"achieved":10,"unit":"ud","comment":"…"}]}`. Los campos se **fusionan**: puedes ir sección a sección sin pisar lo anterior.
6. **Añade material visual** (siguiente apartado) y asócialo: `--media 12,15` (ids de la galería) o `--visuals visuales.json`.
7. **Ensambla**: `collado-doc memoir build ID` crea/actualiza el documento (`#/doc/N`). Después `collado-doc lint --doc N`, `collado-doc preview --doc N --pages 1-6` y **mira las páginas** con la herramienta de lectura de imágenes. Corrige y vuelve a ensamblar (es idempotente).
8. **Entrega**: `collado-doc render --doc N --format pdf --program P -o memoria.pdf` (y `docx` si la persona va a editarla). Di dónde está y qué falta (`[Indicar: …]` que queden y por qué).

## Cómo escribir cada sección
- **Cada cifra sale de `memoir show`, de un documento del proyecto o de la persona** y se cita su origen si no es obvio. Lo estimado se dice estimado. Nunca redondees a tu favor ni inventes metas.
- **Respeta la extensión** recomendada y el **tono** de la memoria (`institutional`: sobrio y verificable; `narrative`: más humano y con historias; `technical`: precisión y método). Primero la conclusión, luego el detalle.
- **Una idea por párrafo**, frases cortas, voz activa, sin adjetivos vacíos («exitoso», «innovador») sin un dato que los respalde. El resumen ejecutivo se escribe **al final**, cuando ya conoces el resto.
- **Justificación de subvención**: sigue la estructura que pide la convocatoria si la persona te la da (pégala en `--field` o en el encargo); relaciona objetivo → indicador → resultado; explica toda desviación económica y su causa.
- **Económica**: datos del presupuesto real (`facts.budget`); las desviaciones se explican en `variance_notes`; separa gasto justificado de gasto comprometido.
- **Personas y menores**: no incluyas datos personales (DNI, IBAN, tarifas) ni nombres de menores; antes de usar imágenes con personas comprueba el campo **Derechos** (`owned`, `licensed`, `release_pending`, `restricted`): no uses las de autorización pendiente o restringidas en una memoria que salga del equipo y avisa.
- Si una sección no aplica, **omítela** (`--status skipped`) en vez de rellenarla con paja.

## Galería de imágenes
- `collado-doc media list --program N` → qué hay y qué **no tiene pie de foto**. `collado-doc media add foto.jpg --program N --caption "Qué se ve, dónde y cuándo" --credit "Autoría" --kind photo|still|behind_scenes|press|logo --phase shoot --episode N --featured 1`.
- Si el proyecto tiene vídeos y no hay fotos buenas, `collado-doc media frames video.mp4 --program N --count 8` saca fotogramas repartidos (requiere ffmpeg: `collado-doc check`); luego **elige** los mejores, ponles pie y borra o deja sin destacar el resto.
- **Pie de foto** = qué se ve + quién/dónde + cuándo (una línea). **Texto alternativo** (`--alt`) = lo que vería quien no puede ver la imagen. Pon **autoría** siempre.
- Elige 6–12 imágenes **variadas** (equipo, plató, resultado final, detalle) y de buena resolución; evita duplicados y fotos desenfocadas. Marca las mejores con `--featured 1`.
- Asócialas a sus secciones (`memoir write … --media`) o a la sección *Galería* (composición `mosaic`, `strip`, `hero` o `grid`).

## Gráficos propios
`collado-doc graphic types` lista los tipos con su especificación y un ejemplo. Resumen:
| Tipo | Para qué | Datos |
|---|---|---|
| `stats` | «El proyecto en cifras»: tarjetas con icono | `auto:1` + `program` lo rellena con datos reales; `stats:[{value,label,icon}]` para añadir |
| `kpi_bars` | Meta frente a logrado (objetivos, impacto) | `items:[{label,target,achieved,unit}]` |
| `timeline` | Cronología de hitos o emisiones | `source: milestones\|episodes` + `program`, o `items:[{date,label}]` |
| `orgchart` | Organigrama del equipo | `source: crew` + `program`, o `root:{name,children:[…]}` |
| `locations_map` | Mapa esquemático de localizaciones (sin conexión) | `source: locations` + `program` (con lat/lng) |
| `chart` | Barras, líneas, área, anillo, **cascada** (presupuesto → real), **mapa de calor**, gantt | `chart_type` + `data:{rows:[{label,value}]}` o `source` de `collado-doc sources` |
| `quote` | Tarjeta de cita o testimonio | `text`, `person`, `role` |
| `divider` / `cover_art` | Separadores de sección y portada | `title`, `subtitle`, `number` |
Flujo: escribe `spec.json` → `collado-doc graphic render spec.json -o prueba.png --program N` → **mira el PNG** (lectura de imágenes) → ajusta → `collado-doc graphic save spec.json --program N --title "…" --caption "…"` (queda en la galería, y se puede insertar en cualquier documento). Para que un gráfico se mantenga **vivo** con los datos, no lo guardes: ponlo en la sección como directiva (`:::graphic type=stats auto=1 program=N`) o en `--visuals`.
- Dentro de **cualquier documento** puedes usar `:::graphic type=kpi_bars` + JSON en el cuerpo, `:::gallery ids=12,15 layout=mosaic`, y `:::chart source=… type=waterfall|heatmap|area|line|bar|donut|hbar|gantt`.
- **Gráfico a medida** (algo que no cubren los tipos): dibuja un **SVG** autocontenido y regístralo: `collado-doc graphic svg mi.svg --program N --title "…"`. Reglas: `viewBox` explícito (p. ej. `0 0 1200 630`), **sin imágenes ni fuentes externas** ni scripts, texto ≥ 14 px, contraste suficiente, **colores de la marca** (`collado-doc brands`), márgenes ≥ 40 px, nada cortado. Renderízalo a PNG y revísalo antes de guardarlo.
- Los gráficos con **datos de dinero** requieren permiso de finanzas; si fallan por permisos, dilo en vez de inventar.

## Calidad: lista de comprobación antes de entregar
- [ ] Ninguna sección obligatoria vacía (`memoir show`: completitud y «falta»); sin `[Indicar: …]` salvo que lo hayas avisado.
- [ ] Cifras coherentes entre secciones (episodios, minutos, importes, fechas) y con `memoir show`.
- [ ] Cada imagen con pie y autoría; ninguna con derechos pendientes; resolución suficiente.
- [ ] Cada gráfico se lee a tamaño de página, con título claro y unidades.
- [ ] `collado-doc lint` sin errores; revisadas **las páginas** en PNG (tablas cortadas, páginas casi vacías, imágenes pixeladas).
- [ ] Idioma, tono y destinatario de la memoria respetados; sin datos personales innecesarios.
