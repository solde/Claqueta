---
name: collado-planificacion-equipo
description: Planificación de rodajes y directos, calendario maestro, reservas de estudios y equipos, hojas de rodaje y de emisión, asignación de equipo y talento, disponibilidad, conflictos, horas, descansos, horas extra y convenios. Úsala al organizar un rodaje o una temporada, resolver conflictos de recursos o controlar el tiempo de trabajo.
---
# Planificación, recursos y equipo

## Calendario maestro
Un solo calendario con: rodajes/directos, montajes y salas, reuniones, entregas, emisiones, vencimientos. Cada reserva de **recurso** (plató, unidad móvil, cámara, sala) y cada **asignación de persona** tiene inicio y fin con hora.
- Consulta conflictos: `collado-api report conflicts from=2026-02-01 to=2026-02-28 [program=N]` → reservas solapadas, persona en dos asignaciones, persona no disponible (vacaciones/baja), recurso en mantenimiento.
- Antes de crear una reserva/asignación comprueba el hueco: `collado-api report check-slot resource_id=N start=2026-02-01T08:00 end=2026-02-01T14:00` (o `person_id=N`).
- Crea reservas tentativas (`status: tentative`) mientras no esté confirmado; confirma cuando haya contrato/OK.

## Hoja de rodaje / citación
Plantilla `callsheet`: fecha, lugar y cómo llegar, productor/a y contactos, **citaciones por persona (hora de llamada, no la de inicio)**, recursos reservados, plan de la jornada, avisos (seguridad, vestuario, comida), centro sanitario cercano y teléfonos de emergencia. Se genera con datos reales: `collado-doc new --template callsheet --program N --episode N --var date=… --var location=…`. Revísala visualmente antes de enviar y comprueba que **nadie citado está «no disponible»**.
Hoja de emisión (directo): plantilla `broadcast-sheet` (escaleta con tiempos, equipo, plan B).

## Equipo, talento y disponibilidad
- `people` (equipo, freelance, talento, invitados): profesión, contacto, convenio, tarifa (solo `people.view`).
- `availability`: vacaciones, bajas, no disponibilidad; `crew_assignments`: quién hace qué, cuándo y con qué estado (propuesto/confirmado/rechazado).
- Para castings o invitados: propón candidatos con criterios (encaje, disponibilidad, coste, riesgo) y deja la decisión a la persona.

## Tiempo de trabajo (horas, descansos, convenios)
`timesheets` calcula horas, **horas extra** (sobre el máximo diario del convenio), horas nocturnas y si se respetó el **descanso mínimo entre jornadas**. `collado-api report timesheets from=… to=…` agrega por persona y semana y marca excesos semanales y anuales.
- Los límites salen del **convenio** asignado a cada persona (`agreements`). Hay un convenio de *referencia legal general* de partida: **sustitúyelo por el convenio real**; no lo supongas.
- Plan de rodaje: agrupa por localización y por talento, respeta descansos y comidas, deja margen para imprevistos (10-15 % del día) y anota quién puede cubrir cada ausencia clave.
- Señala siempre: jornadas largas consecutivas, nocturnidad, festivos y viajes (el tiempo de desplazamiento cuenta según el convenio: consúltalo).

## Gantt y dependencias
Hitos (`milestones`) con `depends_on`; `report gantt program=N` marca el **camino crítico** y las dependencias violadas (un hito que empieza antes de que termine su predecesor). Usa las plantillas de flujo como punto de partida y ajusta duraciones a la realidad del equipo.

## Preguntas de control de un plan
¿Hay estudio y equipos libres esas fechas? ¿Las personas clave están disponibles y descansadas? ¿Cabe todo en el presupuesto de días? ¿Qué pasa si falla X (talento, plató, conexión)? ¿Quién autoriza horas extra y gastos? ¿Los permisos, seguros y autorizaciones de menores están listos?
