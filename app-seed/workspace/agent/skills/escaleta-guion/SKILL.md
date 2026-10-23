---
name: collado-escaleta-guion
description: Escaleta, minutaje, guion de programas de televisión y radio, reloj de programación (hot clock), cronometraje de directos y grabaciones, hoja de emisión y guion de continuidad. Úsala al crear o ajustar una escaleta, repartir tiempos, preparar un directo o redactar un guion.
---
# Escaleta, minutaje y guion

## Principios
- La escaleta es **el contrato de tiempo** del episodio: cada bloque tiene tipo, duración, responsable, recursos y notas. La suma debe cuadrar con la duración objetivo **menos** el margen técnico acordado (cabeceras, pausas, créditos).
- Ritmo: alterna intensidad (entrevista larga ↔ pieza corta), coloca el «gancho» antes de cada pausa, cierra con avance del próximo programa. En directo reserva **colchón** (30-90 s) elástico en un bloque que se pueda estirar/recortar.
- En directo los bloques con **hora fija** (conexiones, publicidad, hora en punto) mandan: el resto se ajusta.

## En Claqueta
- Los bloques viven en `rundown_items` (episodio, posición, bloque, título, tipo, duración en segundos, responsable, hora fija, contenido, notas). `collado-api report rundown episode=N` devuelve hora de inicio de cada bloque, total, diferencia con el objetivo y avisos de huecos/solapes con las horas fijas.
- Crea varios bloques de una vez: `collado-api batch rundown_items '[{"episode_id":N,"block":"Bloque 1","title":"Cabecera","kind":"intro","duration_sec":45,"position":10}, …]'` (posiciones de 10 en 10).
- Copia de otro episodio: `collado-api action copy-rundown '{"from_episode_id":A,"to_episode_id":B}'`. Reordena: `action reorder-rundown '{"episode_id":N,"ids":[…]}'`.
- Documentos: plantilla `rundown` (escaleta), `callsheet` (hoja de rodaje), `broadcast-sheet` (hoja de emisión de directo).

## Reparto de tiempos (guía, ajusta al formato)
Magacín de 90 min: cabecera 0:45 · titulares 5 min · entrevista principal 12-15 min · pausa 3-4 min · reportajes 6-8 min · juego/sección 8-10 min · servicios/tiempo 5-6 min · cierre y avance 1:30. Pausas publicitarias según lo contratado con la cadena (confírmalo; no lo supongas).

## Reloj de radio (hot clock)
Hora en 60 minutos: apertura/sintonía → titulares → bloque principal → cuña/publicidad → entrevista → servicios → cierre/identificador. Incluye **pisadas** (cuándo entra la música o la cuña), horas de conexión con redes/corresponsales y tiempos de relleno elásticos. Entrega como tabla (minuto, elemento, duración, quién, notas).

## Guion
- Televisión: columnas **Imagen | Sonido/Texto | Duración** (o formato de guion literario si es ficción/documental). Presentador: textos cortos, frases habladas, sin subordinadas largas. Entradillas y despedidas de pieza con duración.
- Radio: texto para el oído, frases cortas, indicaciones de música/efectos entre corchetes, tiempos por párrafo (≈ 150-170 palabras/min a ritmo de locución; compruébalo con una lectura real).
- Podcast: guion abierto (puntos clave) para entrevistas; cerrado para narrativo; incluye marcas de capítulos y llamadas a la acción.

## Control antes de dar por buena una escaleta
- [ ] Suma = objetivo (± tolerancia) y bloques de hora fija coherentes.
- [ ] Cada bloque tiene responsable y recursos (plató, cámara, conexión, grafismo, música con derecho).
- [ ] Música y archivo anotados para la cue sheet; invitados con autorización/cesión.
- [ ] Punto de corte/plan B si falla una conexión; material de relleno disponible.
- [ ] Accesibilidad y rotulación previstas; calificación por edades coherente con los contenidos.
