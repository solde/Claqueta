---
name: collado-formatos
description: Desarrollo de formatos de televisión, radio y podcast — logline, concepto, biblia del programa, pitch/dossier de venta, piloto, diferenciación y viabilidad. Úsala cuando pidan crear, mejorar, evaluar o presentar un formato o un programa nuevo.
---
# Desarrollo de formatos

## Qué distingue un buen formato
Una **promesa clara** (qué obtiene la audiencia y por qué volver), un **mecanismo repetible** (estructura que se puede producir cada semana/día al coste previsto), **reconocibilidad** (título, sintonía, secciones, tono) y **encaje** (franja, cadena, público, competencia). Si no cabe en una frase (logline) y en un reloj de programa, aún no está desarrollado.

## Logline
Una frase: **protagonista/sujeto + situación + objetivo/conflicto + gancho**. Máximo 30 palabras, sin adjetivos vacíos. Genera varias variantes por tono y recomienda una.

## Biblia del programa (estructura)
1. Concepto y premisa · 2. Tono y estilo (voz, ritmo, referencias, qué *no* es) · 3. Estructura del episodio con minutaje (reloj/escaleta tipo) · 4. Secciones recurrentes (objetivo, duración, responsable, recursos) · 5. Presentadores/personajes/perfiles de invitado · 6. Dirección de arte, decorado y grafismo · 7. Música y sonido · 8. Público objetivo y franja · 9. Producción: equipo mínimo, plató, ciclo de trabajo de un episodio, coste objetivo · 10. Normas editoriales y límites · 11. Riesgos · 12. Ejemplos desarrollados (piloto).
Plantilla: `collado-doc new --template bible --program N` y completa; los datos vivos (targets, competencia, riesgos, escaleta) se insertan con bloques `:::data`.

## Pitch / dossier de venta (lectura de 5 minutos)
Titular + logline · Por qué ahora (tendencia, hueco de parrilla, dato verificado) · Concepto en una página · Público y encaje en parrilla · Estructura de episodio · Equipo y credenciales · Referencias/competencia (qué hay, qué falta) · Viabilidad: coste orientativo por episodio, calendario, necesidades · Propuesta de colaboración. Plantilla `dossier` (+ `--cover`). Evidencia con **fuente y fecha**; nunca cifras inventadas.

## Evaluación rápida de viabilidad (devuelve una tabla)
Criterio | Valoración (1-5) | Evidencia | Riesgo/acción: diferencial, encaje con la cadena, público y tamaño, coste por episodio vs. precio de licencia previsible, complejidad de producción, dependencia de talento, riesgo de derechos (formato, música), escalabilidad (temporadas, versiones internacionales).

## Radio y podcast
Radio: reloj de programación (apertura, bloques, tertulia/entrevista, publicidad, servicios, cierre) con tiempos y reglas de pisada. Podcast: promesa y público, duración estándar, frecuencia, formato (monólogo, entrevista, narrativo), identidad sonora, distribución y métricas objetivo.

## Encargos habituales y cómo resolverlos
- «Dame 10 títulos/loglines»: agrupa por tono, recomienda uno.
- «Prepara el dossier para X»: lee la ficha y documentos en Collado, completa huecos con supuestos marcados, genera PDF con marca y portada, previsualiza.
- «Evalúa esta idea»: tabla de viabilidad + 3 riesgos + 3 siguientes pasos.
Guarda los resultados como documentos del programa (tipos `format`, `bible`, `dossier`).
