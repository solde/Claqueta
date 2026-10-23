---
name: collado-produccion
description: Marco profesional de producción de televisión, radio y podcast — fases, roles, flujos por tipo de programa (magacín, informativo, concurso, documental, radio en directo, podcast), decisiones típicas y riesgos. Úsala al planificar un programa, una temporada o un episodio, al estructurar un flujo de trabajo o al revisar si un proyecto está bien montado.
---
# Producción audiovisual y sonora: marco de trabajo

## Fases y qué se decide en cada una
1. **Desarrollo**: idea → formato (biblia) → pitch/dossier → piloto o maqueta → aprobación de la cadena/financiador. Decisiones: público y franja, duración, coste objetivo por episodio, quién lo emite y cómo se financia (cadena, cliente, coproducción, ayudas, patrocinio).
2. **Financiación y contratos**: presupuesto aprobado, contrato con la cadena/cliente (precio, forma de pago, derechos, entregables, plazos), ayudas, patrocinios, seguros.
3. **Preproducción**: equipo, plató/estudios y equipos, localizaciones, casting/invitados, guiones/escaletas, grafismo y música (licencias), plan de rodaje, calendario maestro, seguros y permisos.
4. **Producción** (rodaje o directo): hojas de rodaje/citación, control de horas y descansos, partes de rodaje, gestión de incidencias, backup de material.
5. **Postproducción**: montaje, grafismo, sonido/mezcla, etalonaje, subtitulado y accesibilidad, música y cue sheet.
6. **Calidad y entrega**: QC según especificación de la cadena, paquete de entrega, aprobaciones (editorial, cadena, legal).
7. **Emisión y explotación**: parrilla, promoción, audiencias, archivo, derechos de explotación posteriores, balance y liquidación.

## Roles (quién decide qué)
Productor/a ejecutivo/a (financiación, relación con cadena, riesgo) · Director/a de producción y jefe/a de producción (presupuesto, plan, equipo, calendario) · Productor/a delegado/a · Ayudante/a de producción · Director/a de contenidos / showrunner (formato y tono) · Realizador/a (lenguaje audiovisual, directo) · Guionistas/redactores · Documentalistas · Técnicos (imagen, sonido, iluminación) · Montaje/postproducción · Grafismo · Contabilidad/controller · Jurídico/derechos · Responsable de continuidad/emisión · Comunicación.

## Flujo típico por tipo de programa (úsalo para proponer hitos y plazos; ajusta a la realidad)
- **Magacín / entretenimiento diario o semanal**: reloj de programa fijo; ciclo corto (guion–grabación–montaje–entrega en días); coste dominado por plató, presentadores y equipo fijo; riesgo: saturación de equipo y descansos.
- **Informativo**: directo, múltiples fuentes, verificación; riesgo editorial y de continuidad técnica; plan B de directo imprescindible.
- **Concurso / formato con licencia**: reglamento y bases legales, casting, ensayos de juego, grabaciones por bloques (varios episodios por jornada), premios y seguros; riesgo: licencia de formato, menores y concursantes, auditoría de premios.
- **Documental**: investigación larga, financiación por ayudas y preventas, derechos de archivo e imagen, montaje extenso; riesgo: clearance de archivo y música, desviación de calendario.
- **Radio en directo**: reloj de programación (hot clock), invitados, publicidad y patrocinio, plan B técnico, versión podcast bajo demanda.
- **Podcast**: concepto y público, identidad sonora, hosting/distribución (RSS), calendario editorial, métricas (descargas, oyentes únicos, retención).

## Cómo usar Claqueta para esto
- Crea el programa con una **plantilla de flujo** (`collado-api action apply-template '{"program_id":N}'`): genera temporada, hitos, tareas, episodios y un presupuesto de partida.
- Estados de episodio: `planned → script → recorded → edited → qc → delivered → aired`. Mantén las fechas `shoot_date`, `edit_due`, `delivery_due`, `air_date` (la acción `plan-episode` las calcula hacia atrás desde la emisión).
- Revisa a diario `collado-api alerts` (retrasos, conflictos de recursos, vencimientos, descansos) y el Gantt (`report gantt program=N`: camino crítico y dependencias violadas).

## Lista de revisión de un proyecto «bien montado»
- [ ] Hay contrato/encargo con la cadena o cliente y está definido qué se entrega, cuándo y con qué especificación.
- [ ] Presupuesto aprobado (versión) con imprevistos; costes por episodio calculados; cashflow viable (cobros vs pagos).
- [ ] Calendario maestro sin conflictos de estudio, equipos ni personas; descansos y horas cumplen el convenio.
- [ ] Derechos de música, archivo, formato e imagen resueltos para las fechas y medios de emisión.
- [ ] Aprobaciones editoriales/legales/cadena identificadas y con responsable.
- [ ] Riesgos principales con plan B y responsable; seguros contratados.
- [ ] Plan de QC y entrega (especificación de la cadena, loudness, subtítulos, accesibilidad).
