# Interfaces HTTP

_Generado por `scripts/docs-api.mjs` (la parte de la app sale de las rutas registradas en `app-seed/app/lib/routes.mjs`). No lo edites a mano: cambia la descripción en el script._

Todo va por **127.0.0.1**. En el servicio, solo el **gateway** está expuesto; en la app de escritorio ninguna interfaz sale del equipo. Las tres capas:

1. **Gateway** (`gateway/gateway.mjs`): la única cara pública. Login, sesiones, roles, consola, archivos y proxy a la app.
2. **agentd** (`gateway/agentd.mjs`): consolas, usuarios, supervisor de la app y trabajos del agente. Solo escucha a gateway, app y tokens de persona.
3. **App** (`app-seed/app`): datos y documentos. Acepta el gateway (clave interna + cabeceras de identidad) y tokens de persona (el agente).

Errores: JSON `{ "error": "codigo_estable", "detail": ... }` con el estado HTTP (400 validación, 401, 403, 404, 409 conflicto, 413 tamaño).

## 1. App (`/api/*`)
Cuerpos JSON salvo donde se indica. Importes en **euros** (la base de datos usa céntimos). Cada llamada se ejecuta en la base de datos de la organización de quien llama.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/me` | Quién soy: usuario, organización, roles, permisos y capacidades del servidor (PDF, rasterizador...). |
| GET | `/api/schema` | El esquema de datos que puede ver quien llama: entidades, campos, títulos, listas, tableros y permisos de escritura. |
| GET | `/api/i18n/:lang` | Diccionario de etiquetas (es, ca, en) para la interfaz. |
| GET | `/api/users` | Personas conocidas de la organización (para asignar tareas y aprobaciones). |
| GET | `/api/e/:entity` | Lista filas de una entidad. Filtros `f.campo=valor` (`>=`, `<=`, `!=`, `in:a\|b`, `~texto`, `null`, `notnull`), `q`, `sort`, `limit`, `offset`, `ids`, `refs=0`. |
| POST | `/api/e/:entity` | Crea una fila (validación, reglas de negocio e historial en una transacción). |
| POST | `/api/e/:entity/batch` | Crea varias filas de una vez. |
| GET | `/api/e/:entity/:id` | Una fila con las etiquetas de lo que referencia. |
| PATCH | `/api/e/:entity/:id` | Actualiza campos de una fila; con `rev` falla si alguien la cambió antes (409). |
| PUT | `/api/e/:entity/:id` | Igual que PATCH. |
| DELETE | `/api/e/:entity/:id` | Borra una fila (409 `in_use` si algo la referencia). |
| GET | `/api/e/:entity/:id/history` | Historial de cambios de una fila (secretos enmascarados). |
| GET | `/api/e/:entity/:id/files` | Adjuntos de una fila. |
| GET | `/api/e/:entity/:id/comments` | Comentarios de una fila. |
| GET | `/api/e/:entity/:id/approvals` | Aprobaciones de una fila. |
| GET | `/api/search` | Búsqueda global (`q`, mínimo dos caracteres) en todas las entidades legibles. |
| GET | `/api/activity` | Actividad reciente, global o de un programa (`program`). |
| POST | `/api/files` | Sube un archivo (cuerpo binario) y lo adjunta a una fila: `entity`, `id`, `name`, `shared`. |
| POST | `/api/links` | Adjunta un enlace en lugar de un archivo. |
| GET | `/api/files/:id` | Descarga un adjunto (`inline=1` para vista previa; `thumb=1` o `max=N` para una versión reducida de una imagen). |
| DELETE | `/api/files/:id` | Borra un adjunto. |
| POST | `/api/media` | Añade una imagen a la galería de un programa (cuerpo binario; `program`, `name` y los metadatos como parámetros). |
| GET | `/api/graphics/types` | Tipos de gráfico con su especificación y un ejemplo. |
| POST | `/api/graphics/render` | Dibuja un gráfico a partir de una especificación con la marca; devuelve el SVG (y el PNG en base64 con `png: true`). |
| POST | `/api/graphics/save` | Dibuja un gráfico y lo guarda como imagen de la galería de un programa. |
| GET | `/api/dashboard` | Datos de la pantalla de inicio. |
| GET | `/api/alerts` | Alertas de quien llama, ordenadas por gravedad (`program` opcional). |
| GET | `/api/notifications` | Notificaciones propias y número de no leídas. |
| POST | `/api/notifications/read` | Marca notificaciones como leídas (`ids` o `all: true`). |
| GET | `/api/reports/:name` | Informes de solo lectura (ver la tabla de informes). |
| POST | `/api/actions/:name` | Operaciones de negocio (ver la tabla de acciones). |
| GET | `/api/jobs/kinds` | Tipos de generación del agente disponibles. |
| GET | `/api/export/ics` | Calendario iCalendar de fechas clave (rodajes, emisiones, entregas, reservas, hitos, contratos). |
| GET | `/api/export/odoo-bills` | Facturas de proveedor en CSV con la forma de importación de Odoo. |
| GET | `/api/export/odoo-invoices` | Facturas emitidas en CSV con la forma de importación de Odoo. |
| GET | `/api/export/csv/:entity` | CSV de una entidad con los mismos filtros que la lista. |
| GET | `/api/settings/:key` | Lee un ajuste de la organización (company, finance, alerts, compliance_checklists...). |
| PUT | `/api/settings/:key` | Guarda un ajuste (según su permiso). |
| GET | `/api/docs/capabilities` | Qué puede hacer este servidor con documentos (motor PDF, rasterizador, formatos). |
| GET | `/api/docs/sources` | Orígenes de datos disponibles para bloques `:::data` y `:::chart`. |
| POST | `/api/docs/lint` | Revisa un documento: variables sin resolver, bloques fallidos, marcas pendientes, estructura. |
| POST | `/api/docs/preview` | HTML de pantalla de un documento para previsualizarlo. |
| POST | `/api/docs/render` | Renderiza un documento a pdf, docx, html, md o png (páginas); con `save` lo guarda como exportación del programa. |
| POST | `/api/docs/from-template` | Crea un documento editable a partir de una plantilla con datos reales. |
| POST | `/api/docs/xlsx` | Excel con columnas tipadas y totales a partir de un origen de datos o de hojas dadas. |

### Informes (`GET /api/reports/:name`)
| Nombre | Qué devuelve |
|---|---|
| `budget` | Presupuesto por capítulos con previsto, comprometido y real (`budget`). |
| `episode-variance` | Coste previsto frente a real por episodio (`program`, `season`). |
| `cashflow` | Tesorería por meses con previsión (`program`, `from`, `months`, `forecast`). |
| `tax` | IVA y retenciones de un periodo (`year`, `quarter`). |
| `profitability` | Rentabilidad por programa (ingresos previstos, coste y margen). |
| `conflicts` | Conflictos de recursos y personas entre fechas. |
| `check-slot` | Comprueba si un recurso o persona está libre en una franja. |
| `timesheets` | Tiempo trabajado por persona, con horas extra y nocturnas. |
| `rundown` | Escaleta con tiempos acumulados frente al objetivo (`episode`). |
| `gantt` | Hitos con dependencias, camino crítico y violaciones (`program`, `season`). |
| `ratings` | Resumen de audiencia de un programa: medias, mejor y peor emisión, series. |
| `forecast` | Predicción de audiencia de las próximas emisiones y de una franja hipotética (`program`, `target`, `date`, `time`, `kind`). |
| `memoir-brief` | Lo que lee el agente de una memoria: secciones, estado, lo que falta, cifras reales y galería (`memoir`). |
| `memoir-facts` | Cifras que la aplicación conoce de un programa para una memoria (`program`). |
| `memoir-catalog` | Catálogo de secciones y campos de las memorias en un idioma (`lang`). |
| `rights-check` | Cobertura de derechos de un episodio y música sin licencia (`episode`). |
| `delivery-readiness` | Qué falta para entregar un episodio (`episode`, `spec`). |

### Acciones (`POST /api/actions/:name`)
| Nombre | Qué hace |
|---|---|
| `memoir-create` | Crea una memoria con las secciones de su tipo. |
| `memoir-section` | Escribe una sección de una memoria por su clave (texto, campos, imágenes, gráficos, estado). |
| `memoir-build` | Ensambla la memoria en un documento editable. |
| `apply-template` | Crea temporada, hitos, tareas, episodios y presupuesto de un programa desde su plantilla de flujo. |
| `clone-budget` | Copia un presupuesto con todas sus partidas. |
| `budget-version` | Crea la siguiente versión de un presupuesto. |
| `init-compliance` | Crea las verificaciones normativas de un episodio. |
| `plan-episode` | Calcula y crea el calendario tipo de un episodio. |
| `reorder-rundown` | Reordena los bloques de una escaleta. |
| `copy-rundown` | Copia la escaleta de un episodio a otro. |
| `import-ratings` | Importa mediciones de audiencia desde CSV (con simulación previa). |
| `import-bank` | Importa movimientos bancarios desde CSV. |
| `suggest-matches` | Sugiere facturas o gastos para conciliar un movimiento bancario. |
| `match-movement` | Concilia un movimiento bancario con una factura o un gasto. |
| `unmatch-movement` | Deshace una conciliación. |
| `invoice-ad-spots` | Genera la factura de los pases publicitarios emitidos. |
| `queue-job` | Encola una generación del agente para un programa. |
| `cancel-job` | Cancela una generación del agente. |

## 2. Gateway (`/_gw/api/*`)
Cookie de sesión `HttpOnly`/`SameSite=Strict` y cabecera `x-requested-with` en toda escritura (anti-CSRF). Toda acción de administración queda en el registro de auditoría.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | login | — | Paso 1: usuario y contraseña. Devuelve sesión o `pending` si hace falta el código 2FA. |
| POST | login/totp | — | Paso 2: código TOTP o de recuperación. |
| POST | logout | sesión | Cierra la sesión. |
| GET | me | sesión | Usuario, organización activa, permisos y catálogo de permisos. |
| POST | me/org | sesión | Cambia de organización. |
| POST | me/password | sesión | Cambia la contraseña propia. |
| POST | me/2fa/start · confirm · disable | sesión | Activa o desactiva la verificación en dos pasos. |
| GET | service/status | sesión | Estado de la app y de las consolas propias. |
| GET | service/logs | service.manage | Registro de la app. |
| POST | service/restart · rollback · reset | service.manage | Reinicia la app o vuelve a una versión anterior del código (solo en el servicio). |
| GET | agent/login-status | sesión | Si la persona ya ha iniciado sesión en Claude Code. |
| POST | agent/login/start · code · cancel | agent.console | Login automático de Claude Code (escritorio). |
| POST | agent/send | agent.console | Escribe un texto en la consola de Claude de la persona. |
| GET/POST/PATCH | orgs | platform.admin | Organizaciones. |
| GET/POST/PATCH/DELETE | users · users/:name · users/:name/2fa-reset | users.manage | Personas de la organización. |
| GET/POST/PUT/DELETE | roles · roles/:name | users.manage | Roles y sus permisos. |
| GET | audit | users.manage | Registro de auditoría. |
| GET/POST | files/<op> (list, stat, find, download, upload, mkdir, touch, rename, copy, trash, restore, rm, emptytrash; en escritorio también link y abspath) | agent.console o agent.shell | Gestor de archivos sobre la carpeta personal. |
| WS | /_gw/ws/term?session=claude\|shell | agent.console / agent.shell | Terminal de la consola de la persona. |
| ANY | /app/* | app.view | Proxy a la app con la identidad de la sesión. |

## 3. agentd
| Método | Ruta | Qué hace |
|---|---|---|
| GET | /healthz | Salud. |
| GET | /status · /logs | Estado de la app y de las consolas; registro (service.manage). |
| POST | /restart · /rollback · /reset | Gestión del código de la app (en escritorio solo reinicio). |
| POST | /send | Escribe en la consola de Claude de una persona. |
| POST | /org | Cambia la organización del token de una persona. |
| POST | /job | Ejecuta una generación `claude -p` (solo la clave de la app). |
| GET/POST | /claude-login · /claude-login/code · /claude-login/cancel | Login automático de Claude Code (escritorio). |
| GET | /claude-status | Si Claude Code tiene sesión (solo existencia de las credenciales). |
| GET/POST | /files/<op> | Operaciones del gestor de archivos, ejecutadas como la persona. |
| WS | /term?session= | Terminal de una sesión. |
