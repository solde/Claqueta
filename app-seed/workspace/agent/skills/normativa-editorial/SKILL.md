---
name: collado-normativa-editorial
description: Cumplimiento de la normativa audiovisual y editorial — protección de menores y calificación por edades, comunicación comercial, patrocinio y emplazamiento de producto, accesibilidad, pluralismo y líneas editoriales, derecho de rectificación, aprobaciones de la cadena. Úsala al revisar un contenido antes de emitir o al preparar la lista de comprobación de un episodio.
---
# Normativa y línea editorial

> Esta skill ayuda a **detectar y documentar** puntos de cumplimiento. Las normas (en España, la Ley General de Comunicación Audiovisual y su desarrollo, los códigos de autorregulación, las condiciones de cada cadena y, en datos, el RGPD) cambian: **confirma el texto vigente con la asesoría** y la guía editorial de la cadena. No afirmes límites numéricos ni franjas concretas como ciertos si no los has verificado.

## Áreas y puntos de control
- **Menores**: calificación por edades asignada y coherente con el contenido; franja horaria compatible; autorizaciones de menores participantes y presencia de adulto responsable; protección de su imagen e identidad; sin contenido perjudicial fuera de franja.
- **Comunicación comercial**: claramente identificable y separada del contenido; patrocinio identificado (inicio y/o final); **emplazamiento de producto con aviso** (inicio, final y tras pausas, cuando aplica); límites de tiempo de comunicación comercial verificados con la cadena; sin publicidad encubierta; restricciones por sector (alcohol, juego, salud…).
- **Accesibilidad**: subtitulado, audiodescripción y lengua de signos en las proporciones que exijan la norma y la cadena; legibilidad de rótulos y grafismos; mezcla inteligible.
- **Protección de datos e imagen**: cesiones firmadas, información de privacidad facilitada, minimización.
- **Pluralismo y rigor informativo**: contraste de fuentes, derecho de réplica/rectificación, separación entre opinión e información, trato a personas vulnerables y a víctimas.
- **Propiedad intelectual**: música, archivo y contenido de terceros con licencia y declarados.
- **Línea editorial** del programa (`editorial_lines`): valores, límites, estilo, temas sensibles; aprobada por quien corresponda.

## En Collado
- `collado-api action init-compliance '{"episode_id":N}'` crea la **lista de verificación** del episodio (por áreas). Estados: `pending · ok · review · breach · na`, con revisor, fecha y notas. Los puntos en `review/breach` con emisión próxima generan alerta.
- **Aprobaciones** (`approvals`): editorial, cadena, legal, financiera o del cliente; con solicitante, aprobador, fecha límite y comentario. Un contenido no se da por entregable hasta que `delivery-readiness` marca aprobaciones concedidas.
- Los textos de los puntos son **prompts de verificación**, no citas legales; edítalos en Ajustes → Cumplimiento.

## Cómo revisar un episodio (encargo típico)
1. Lee escaleta, guion y material; identifica **riesgos por área** (menores, publicidad, rigor, derechos, datos).
2. Para cada punto: ¿ok / a revisar / incumple / no aplica? Con evidencia (minuto, fuente, documento).
3. Propón correcciones concretas (cambiar de franja, añadir aviso, recortar, pedir autorización, sustituir música).
4. Registra el resultado en `compliance_checks` y pide las aprobaciones necesarias. Entrega un informe breve: **riesgos altos primero**, lo que se debe corregir antes de emitir y lo que necesita decisión humana.

## Señales de alarma (escala siempre a una persona)
Menores identificables sin autorización · publicidad sin identificar · acusaciones a personas concretas sin contraste · uso de música o archivo sin licencia · datos sensibles en emisión o en redes · petición de la cadena que contradice la línea editorial.
