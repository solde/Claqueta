---
name: collado-contratos-derechos
description: Contratos con equipo, talento, invitados, proveedores y cadenas; cesión de imagen y de derechos; derechos de formato, música, archivo y talento con ventanas y territorios; cue sheets y entidades de gestión; protección de datos (RGPD), consentimientos, menores y retención documental. Úsala al preparar o revisar contratos, comprobar si hay derechos para emitir o gestionar datos personales.
---
# Contratos, derechos y protección de datos

> Todo lo que redactes aquí es **borrador de trabajo para revisión jurídica**. No eres un despacho de abogados: prepara, estructura, detecta lagunas y formula preguntas; la validación es humana.

## Contratos: mapa de tipos y qué debe quedar claro
| Tipo | Puntos esenciales |
|---|---|
| Equipo (laboral / mercantil) | Modalidad correcta (valida con asesoría laboral: la contratación temporal cambió en 2022), convenio aplicable, categoría, jornada, horas extra, descansos, duración vinculada a obra/temporada, cesión de derechos de propiedad intelectual de lo creado. |
| Talento / presentadores | Alcance de la exclusividad, imagen y voz, duración, tarifas por episodio/cachet, derechos conexos, promoción, cláusulas de moral/salida, seguro. |
| Invitados / participantes | Autorización de grabación, cesión de imagen y voz (medios, territorio, duración), gratuidad o compensación, datos personales, menores (tutor legal). |
| Proveedores | Objeto, entregables, plazos, penalizaciones, propiedad de lo creado, confidencialidad, seguros, forma de pago. |
| Cadena / cliente | Precio, hitos de facturación, entregables y especificación técnica, aprobaciones, derechos y ventanas de emisión, exclusividad, promoción, auditoría. |
| Patrocinio / emplazamiento | Marca, contraprestaciones, exclusividad sectorial, aviso de emplazamiento, aprobación de la marca, tarifas. |
| Licencia de formato / música / archivo | Licenciante, ámbito (medio, territorio, idiomas, **ventana** de fechas), exclusividad, nº de pases, tarifa, restricciones, créditos. |
| NDA | Definición de información, plazo, excepciones, devolución/destrucción. |

## En Claqueta
- `contracts`: tipo, parte, programa/episodio, fechas, **días de preaviso** (genera alerta de vencimiento), valor (visible solo con `fin.view`), exclusividad, territorio, datos personales/menores. Sube el PDF firmado como **archivo adjunto** (se guarda cifrado).
- Plantillas de partida: `contract-image` (cesión de imagen), `contract-services` (prestación de servicios), `minor-authorisation` (menores). Genera con `collado-doc new --template contract-services --program N --var provider="…" …` y revisa; **todas llevan el aviso de revisión jurídica**.
- `rights`: tipo (formato, música, archivo, imagen de talento…), titular, medio (tv/radio/online/todos), **territorio**, **ventana** (`window_start/end` o perpetuo), exclusividad, nº de pases, restricciones. `collado-api report rights-check episode=N` comprueba, para la fecha de emisión, si cada derecho está vigente y si hay música sin derecho asociado.

## Derechos: preguntas que hay que contestar antes de emitir
¿Medio y territorio cubiertos? ¿La **fecha de emisión (y repeticiones, VOD, redes)** cae dentro de la ventana? ¿Hay límite de pases? ¿Quién es el titular real (autor, editorial, productor fonográfico, intérprete)? ¿Se necesitan **dos licencias** para música (sincronización y comunicación pública)? ¿Hay créditos obligatorios? ¿Los invitados y el talento han cedido imagen para **todos** los medios previstos?
Entidades de gestión habituales (España): SGAE (autores/música), AIE y AGEDI (intérpretes y productores fonográficos), AISGE (intérpretes audiovisuales), DAMA (autores audiovisuales), EGEDA (productores audiovisuales). Confirma con el equipo con cuáles tiene licencia general la cadena.

## Cue sheet (relación musical de un episodio)
Por obra: título, compositor/autor, editorial, intérprete, sello/librería, ISRC/ISWC si los hay, uso (sintonía, fondo instrumental BI, fondo vocal BV, visual…), minutaje de entrada y duración, entidad de gestión y porcentaje. Se crea en `cue_sheets` + `cue_items`; exporta con `collado-doc xlsx --source cue_sheet --param episode=N` o la plantilla `cue-sheet`. Cada obra debe enlazarse a un `right` (si no, la entrega lo marca).

## RGPD y datos personales
- **Registro de actividades de tratamiento** (`processing_activities`): finalidad, base jurídica, categorías, destinatarios, plazo de conservación, medidas. Hay ejemplos iniciales: revísalos con el DPO/asesoría.
- **Consentimientos** (`consents`): imagen, datos, tutor de menores, marketing; con caducidad (genera alerta).
- **Derechos de las personas** (`dsr_requests`): acceso, rectificación, supresión, portabilidad, oposición, limitación; plazo de respuesta de un mes desde la recepción (genera alerta).
- **Retención** (`retention_policies`): regla por entidad y plazo; la app avisa de los registros que lo superan. Las cifras (6 años mercantil, etc.) son **referencias**: confírmalas.
- Menores: autorización de su representante legal, horarios y descansos específicos, y especial cuidado con su identificación en emisión y redes. **Consulta a la asesoría antes de grabar.**
- Los campos sensibles (DNI, IBAN, tarifas) solo los ve quien tiene `people.view`: **no los copies a documentos de uso externo**.

## Checklist para revisar un contrato recibido
Partes e identificación · objeto y entregables · precio, IVA/retención y plazos de pago · duración, renovación y preaviso · exclusividad y territorio · propiedad intelectual y cesiones · confidencialidad · protección de datos · responsabilidad y seguros · resolución y penalizaciones · ley aplicable y jurisdicción · anexos. Devuelve: **resumen en 10 líneas, riesgos ordenados, cláusulas a negociar y preguntas para el jurídico**.
