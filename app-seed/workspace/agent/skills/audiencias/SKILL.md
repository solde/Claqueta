---
name: collado-audiencias
description: Estudios de audiencia, targets y competencia para televisión, radio y podcast; análisis de audiencia media, cuota de pantalla, rating y cobertura; importación de datos de medición, informes de resultados y recomendaciones de franja. Úsala para investigar mercado, interpretar resultados o preparar informes de audiencias.
---
# Audiencias, targets y competencia

## Métricas (define siempre qué estás usando)
- **Audiencia media (miles)**: media de espectadores durante la emisión. **Cuota de pantalla (share %)**: audiencia media / audiencia de todas las cadenas en ese momento. **Rating %**: audiencia sobre el universo total. **Cobertura/alcance acumulado**: personas distintas que vieron al menos un minuto. **Fidelidad**, **minuto de oro** (pico) y la **curva minuto a minuto** para ver dónde se cae la audiencia.
- Especifica **target** (total individuos, adultos 25-54, etc.), **ámbito** (nacional/autonómico), **fuente** (en televisión, la medición oficial vigente de audiencias por audímetro; en radio, el EGM de AIMC; en online/podcast, métricas de la plataforma: descargas, oyentes únicos, tiempo medio de escucha, retención) y si incluye **consumo en diferido/streaming**.
- Compara siempre con el **mismo target, franja y periodo comparable** (estacionalidad, competencia, deportes). Una cifra sin comparativa no es un resultado.

## Estudio de audiencia / mercado (encargo habitual)
1. Define la pregunta (¿qué decisión apoyará? franja, duración, target, renovación).
2. Busca datos **reales** (notas de prensa de cadenas, informes de consultoras de audiencias, estudios sectoriales, CNMC, AIMC/EGM): cita **fuente y fecha**; separa dato verificado de estimación.
3. Estructura: contexto de consumo del público objetivo · hábitos y dispositivos · competencia y franja (programas, cuotas recientes) · referencias comparables · riesgos/oportunidades · **recomendación** (franja, duración, periodicidad) con nivel de confianza.
4. Entrega como documento (`audience`) y guarda targets (`targets`) y competidores (`competitors`) en el programa. En la web no incluyas información confidencial del proyecto.

## Targets y personas
Principal y secundarios: demografía, geografía, nivel socioeconómico (si procede), intereses, **hábitos de consumo y dispositivos**, necesidades, barreras, canales para llegar. 3-5 **personas** (ficha breve con nombre ficticio, motivaciones, qué le haría volver o irse). Termina con una tabla resumen. Marca qué es dato y qué es hipótesis.

## Datos de medición en Claqueta
- Importa el CSV de la medición: `collado-api action import-ratings '{"program_id":N,"csv":"<contenido>"}'` (columnas: fecha, audiencia media, cuota, rating, cobertura, target, fuente; opcional episodio). Con `"dry":true` valida sin guardar.
- `collado-api report ratings program=N` → serie, medias, mejor/peor emisión y por temporada. Plantilla `audience-report` (gráfico de cuota + tabla + lectura).

## Interpretación (qué mirar y qué decir)
Tendencia (¿sube o baja semana a semana?) · efecto del lead-in/lead-out y de la competencia · episodios fuera de patrón (causa: invitado, evento, deporte) · target comercial vs total · retención (curva) · coste por punto de share o por mil espectadores si hay datos. Termina con **3 acciones**: mantener, ajustar (contenido, franja, promoción) o decidir (renovar/cancelar) y su impacto esperado.

## Antes de entregar un informe
- [ ] Fuente, periodo, target y universo explícitos en cada cifra · comparativa válida.
- [ ] Sin conclusiones causales no sustentadas · limitaciones y margen de error mencionados.
- [ ] Gráficos legibles, tablas con unidades · resumen ejecutivo al inicio.
