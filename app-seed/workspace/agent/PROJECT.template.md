# Proyecto: {{NAME}}{{CODE_SUFFIX}}

Reglas **de este proyecto** para el agente de {{APP_NAME}}. Prevalecen sobre las generales (`AGENT.md`, `AGENT.desktop.md`: están en `{{AGENT_DIR}}` y ya las tienes cargadas desde tu espacio de trabajo). Edita este fichero: es tuyo, {{APP_NAME}} no lo vuelve a escribir.

## Datos
- Programa en {{APP_NAME}}: **#{{ID}}** · {{KIND}} · abrir en la app: `#/p/{{ID}}`
- Esta carpeta: `{{FOLDER}}` (el campo *Carpeta local* de la ficha). Aquí se guardan los archivos del proyecto.

## Al empezar a trabajar en este proyecto (siempre)
1. Lee la ficha y lo que ya hay: `collado-api get programs {{ID}}`, `collado-api list episodes program_id={{ID}}`, `collado-api list documents program_id={{ID}}`, `collado-api alerts program={{ID}}`.
2. **Comprueba las herramientas para crear documentos con la máxima calidad:** `collado-doc check --program {{ID}}`.
   Si falta algo que mejora el resultado (vista previa de páginas, LibreOffice, Python con python-pptx…), dile a la persona qué falta, qué mejora y el comando exacto; **no instales nada sin su permiso**. Si no se instala, di qué no has podido comprobar.
3. Mira qué hay en esta carpeta antes de crear nada nuevo (no dupliques, no pises versiones).

## Dónde se guarda cada cosa
- `Documentos/` — informes, dossiers, actas y contratos (PDF/Word) y su fuente en Markdown (`.md`).
- `Presupuestos/` — hojas de cálculo y versiones de presupuesto.
- `Entregas/` — lo que se envía a cadena, cliente o proveedores (versión final, con fecha en el nombre).
- `Material/` — referencias, imágenes, logos y cualquier insumo.
Crea las subcarpetas que falten. Nombres: `AAAA-MM-DD_tipo_titulo_v1.ext`. Guarda también el documento editable en la app (`collado-doc save … --program {{ID}}`) para que quede con historial.

## Calidad de los documentos de este proyecto
- Usa la **marca** que corresponda (`collado-doc brands`); portada, índice y numeración en los documentos formales.
- Renderiza y **mira las páginas** antes de entregar (`collado-doc preview`); en Word/PowerPoint, conviértelos a PDF y revísalos si tienes LibreOffice. Pasa `collado-doc lint` sin errores.
- Cifras de la app con bloques de datos vivos, no copiadas. Datos personales mínimos (RGPD).

## Notas del proyecto (rellena)
- Cliente / cadena y especificaciones de entrega:
- Tono y vocabulario habituales:
- Decisiones tomadas:
- Pendiente / riesgos:
