---
name: collado-calidad-entrega
description: Control de calidad (QC), especificaciones técnicas de entrega por cadena (formato, códec, loudness, subtítulos), registro de incidencias, paquete de entrega con trazabilidad, almacenamiento y archivo, metadatos del material. Úsala al preparar o revisar una entrega, un master o una checklist técnica.
---
# Calidad y entrega

## Principio
**La especificación vinculante es la de la cadena/cliente.** Las plantillas de Collado son orientativas: pide el documento técnico y refleja sus valores en `delivery_specs` (checklist incluida) antes del primer episodio.

## Referencias técnicas habituales (verifícalas con la cadena)
- **Vídeo broadcast HD**: 1920×1080, 25p (o 50i heredado), Rec.709, contenedor MXF OP1a con XDCAM HD422 50 Mbps o el códec que pida la cadena; streaming/OTT: ProRes 422 HQ o H.264/H.265 de alto bitrate, UHD según plataforma.
- **Audio**: 48 kHz, 24 bit, estéreo (+ pistas de M&E si hay versión internacional); **sonoridad EBU R128 de referencia −23 LUFS (±0,5 LU) y pico real ≤ −1 dBTP** en broadcast europeo. Radio: criterio de la emisora (suele seguir R128). Podcast: referencias habituales −16 LUFS estéreo y −14 LUFS en streaming musical; confirma la plataforma.
- **Subtítulos y accesibilidad**: fichero aparte (STL/SRT/XML/IMSC según cadena), subtitulado para personas sordas y audiodescripción si aplica; legibilidad (contraste, tiempos, posición).
- **Nomenclatura**: la de la cadena (p. ej. `PROGRAMA_Exxx_vN`). Metadatos: título, episodio, duración, idioma, emisión, versión.

## Flujo de calidad en Collado
1. **Material** (`assets`): título, tipo (raw/edit/master/audio/subtítulos…), versión, estado (`ingest → working → approved → archived`), **localización real** (NAS/nube/cinta/URL: la app no almacena el vídeo), códec, resolución, fps, duración, checksum, derecho asociado.
2. **QC** (`qc_reports`): elige la especificación → aparece la **checklist** (OK / KO / N/A + nota); resultado `pass / pass_notes / fail`. Mide sonoridad y pico con herramienta real; **no declares «pass» sin medición**.
3. **Incidencias** (`qc_issues`): severidad (`low…blocker`), código de tiempo, responsable, estado; las bloqueantes impiden dar por lista la entrega.
4. **Cumplimiento** (`compliance_checks`) y **aprobaciones** (editorial, cadena, legal) con responsable.
5. **Entrega** (`deliveries`): versión, destinatario, especificación, método, `items` congelados al enviar con **huella SHA-256 del paquete** (trazabilidad: quién, cuándo, qué). `collado-api report delivery-readiness episode=N` resume si está lista: material aprobado, QC superado, sin incidencias graves, cumplimiento, derechos y música cubiertos, cue sheet lista, aprobaciones.

## Almacenamiento y archivo
Regla 3-2-1 (3 copias, 2 soportes, 1 fuera de sitio) para masters; checksum al copiar y verificación periódica; nomenclatura estable; metadatos suficientes para localizar (programa, episodio, versión, fecha, derechos y vencimiento); política de retención por tipo (raw, masters, proyectos de edición) acordada con la cadena y con el equipo jurídico.

## Checklist de entrega (adáptala a la especificación)
- [ ] Formato, códec, resolución, fps, espacio de color conformes · duración y bloques correctos.
- [ ] Cabecera/claqueta/barras y cierres según cadena · sin pérdidas de fotograma ni desincronización.
- [ ] Sonoridad y pico medidos dentro de tolerancia · pistas en el orden pedido.
- [ ] Subtítulos/accesibilidad entregados · rótulos legibles y dentro de áreas seguras.
- [ ] Cue sheet y listado de derechos · autorizaciones archivadas.
- [ ] Nombre de fichero y metadatos correctos · checksum registrado.
- [ ] Informe de QC adjunto · aprobaciones concedidas.
Cuando prepares el paquete, genera la plantilla `delivery` como justificante.
