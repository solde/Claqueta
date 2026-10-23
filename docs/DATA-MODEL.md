# Modelo de datos

_Generado por `scripts/docs-data-model.mjs` a partir de `app-seed/app/lib/schema/*.mjs`. No lo edites a mano: para añadir una entidad o un campo cambia el esquema y vuelve a generarlo._

Cada entidad declara sus campos una sola vez y de ahí salen **la tabla** SQLite (`syncSchema()` crea tablas y **solo añade** columnas), **la API** (`/api/e/<entidad>`), **el formulario y la lista** de la interfaz, **los permisos** y **las etiquetas** (es, ca, en: un test comprueba que ninguna falte).

El campo `programs.folder` (carpeta local del proyecto) solo existe en la app de escritorio.

Columnas que añade el motor a toda tabla: `id`, `created`, `updated`, `created_by`, `updated_by` y `rev` (revisión para el control de concurrencia optimista). Todo cambio queda en `changes` (con valores sensibles enmascarados).

## Módulos y permisos
| Módulo | Ver | Editar |
|---|---|---|
| `prod` | `app.view` | `app.edit` |
| `fin` | `fin.view` | `fin.edit` |
| `legal` | `legal.view` | `legal.edit` |
| `people` | `people.view` | `people.edit` |
| `own` | `app.view` | `app.view` |

Un campo puede exigir un permiso propio (columna *detalles*: `permiso`); los de tipo **secreto** se cifran con AES-256-GCM. Los importes se guardan en **céntimos** (enteros) y la API los entrega en **euros**.

## Entidades (62)

### Grupo: Directorio

#### `partners` — Entidad (Entidades)
Módulo `prod`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `kind` — Tipo de entidad | opción |  | opciones: `channel`, `client`, `supplier`, `sponsor`, `society`, `authority`, `producer`, `other` |
| `vat_id` — NIF/CIF | texto |  |  |
| `address` — Dirección | texto largo |  |  |
| `country` — País | texto |  |  |
| `contact_name` — Persona de contacto | texto |  |  |
| `email` — Correo | texto |  | formato email |
| `phone` — Teléfono | texto |  |  |
| `web` — Web | texto |  | formato url |
| `payment_days` — Días de pago | entero |  | mín 0 · máx 365 · por defecto 30 |
| `iban` — IBAN | secreto (cifrado) |  | máx 2000 · permiso: lee `fin.view`, escribe `fin.edit` |
| `active` — Activo | sí/no |  | por defecto 1 |
| `notes` — Notas | texto largo |  |  |

#### `people` — Persona (Personas)
Módulo `prod`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `staff`, `freelance`, `talent`, `guest`, `supplier_contact` |
| `profession` — Profesión | texto |  |  |
| `email` — Correo | texto |  | formato email |
| `phone` — Teléfono | texto |  |  |
| `city` — Ciudad | texto |  |  |
| `language` — Idioma | texto |  |  |
| `active` — Activo | sí/no |  | por defecto 1 |
| `agreement_id` — Convenio | referencia |  | → `agreements` |
| `partner_id` — Entidad | referencia |  | → `partners` · company invoicing for this person, if any |
| `rate_type` — Tipo de tarifa | opción |  | opciones: `day`, `hour`, `month`, `fee`, `episode` · permiso: lee `people.view`, escribe `people.edit` |
| `rate` — Tarifa | importe (céntimos en BD, euros en API) |  | permiso: lee `people.view`, escribe `people.edit` |
| `agent_name` — Representante | texto |  |  |
| `agent_contact` — Contacto del representante | texto |  |  |
| `national_id` — DNI/NIE | secreto (cifrado) |  | máx 2000 · permiso: lee `people.view`, escribe `people.edit` |
| `iban` — IBAN | secreto (cifrado) |  | máx 2000 · permiso: lee `people.view`, escribe `people.edit` |
| `address` — Dirección | secreto (cifrado) |  | máx 2000 · permiso: lee `people.view`, escribe `people.edit` |
| `birth_date` — Fecha de nacimiento | secreto (cifrado) |  | máx 2000 · permiso: lee `people.view`, escribe `people.edit` |
| `social_security` — Nº Seguridad Social | secreto (cifrado) |  | máx 2000 · permiso: lee `people.view`, escribe `people.edit` |
| `notes` — Notas | texto largo |  |  |
| `private_notes` — Notas privadas | texto largo |  | permiso: lee `people.view`, escribe `people.edit` |

#### `availability` — Disponibilidad (Disponibilidad)
Módulo `prod` · padre: `person_id`. Título: `person_id` + `kind`. Orden: `start_date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `person_id` — Persona | referencia | sí | → `people` (borrado en cascada) |
| `kind` — Tipo | opción |  | opciones: `unavailable`, `holiday`, `sick`, `tentative`, `available` |
| `start_date` — Fecha de inicio | fecha | sí |  |
| `end_date` — Fecha de fin | fecha | sí |  |
| `reason` — Motivo | texto |  | permiso: lee `people.view`, escribe `people.edit` |

#### `resources` — Recurso (Recursos)
Módulo `prod`. Título: `name`. Orden: `kind,name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `kind` — Tipo de recurso | opción |  | opciones: `studio`, `mobile_unit`, `camera`, `audio`, `lighting`, `edit_suite`, `room`, `vehicle`, `other` |
| `code` — Código | texto |  |  |
| `location` — Ubicación | texto |  |  |
| `capacity` — Capacidad | entero |  | mín 0 · máx 100000 |
| `status` — Estado | opción |  | opciones: `available`, `maintenance`, `retired` |
| `partner_id` — Entidad | referencia |  | → `partners` · rental company / owner |
| `daily_cost` — Coste diario | importe (céntimos en BD, euros en API) |  | permiso: lee `fin.view`, escribe `fin.edit` |
| `specs` — Especificaciones | texto largo |  |  |
| `notes` — Notas | texto largo |  |  |

#### `timesheets` — Parte de horas (Control de horas)
Módulo `people` · ámbito de programa: `program_id`. Título: `person_id` + `date`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `person_id` — Persona | referencia | sí | → `people` |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `date` — Fecha | fecha | sí |  |
| `start` — Entrada | hora | sí |  |
| `end` — Salida | hora | sí |  |
| `break_min` — Descanso (min) | entero |  | mín 0 · máx 600 · por defecto 0 |
| `hours` (solo lectura) — Horas | decimal |  |  |
| `overtime` (solo lectura) — Horas extra | decimal |  |  |
| `night_hours` (solo lectura) — Horas nocturnas | decimal |  |  |
| `holiday` — Festivo | sí/no |  | por defecto 0 |
| `rest_ok` (solo lectura) — Descanso correcto | sí/no |  | por defecto 1 |
| `status` — Estado | opción |  | opciones: `draft`, `validated`, `paid` |
| `notes` — Notas | texto largo |  |  |

### Grupo: Ajustes

#### `workflow_templates` — Plantilla de flujo (Plantillas de flujo)
Módulo `prod`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `magazine`, `news`, `gameshow`, `documentary`, `live_radio`, `podcast`, `series`, `entertainment`, `other` |
| `description` — Descripción | texto largo |  |  |
| `milestones` — Hitos | JSON |  | [{title, offset_days, duration_days, kind, after:[index]}] relative to the programme start; offsets from the episode air date are negative |
| `tasks` — Tareas | JSON |  | [{title, offset_days, priority}] |
| `episode_pipeline` — Plazos por estado | JSON |  | [{status, days_before_air}] deadlines per episode status |
| `budget_template_id` — Plantilla de presupuesto | referencia |  | → `budgets` filtrado por {"kind":"template"} |
| `checklist` — Lista de comprobación | JSON |  | delivery/compliance checklist items |

#### `agreements` — Convenio (Convenios)
Módulo `people`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Convenio | texto | sí |  |
| `max_daily_hours` — Horas máx./día | decimal |  | mín 0 · máx 24 · por defecto 8 |
| `max_weekly_hours` — Horas máx./semana | decimal |  | mín 0 · máx 168 · por defecto 40 |
| `min_daily_rest` — Descanso mín. entre jornadas (h) | decimal |  | mín 0 · máx 24 · por defecto 12 · hours between two working days |
| `min_weekly_rest` — Descanso semanal mín. (h) | decimal |  | mín 0 · máx 168 · por defecto 36 |
| `overtime_mult` — Multiplicador horas extra | decimal |  | mín 1 · máx 5 · por defecto 1.25 |
| `night_from` — Nocturnidad desde | hora |  | por defecto "22:00" |
| `night_to` — Nocturnidad hasta | hora |  | por defecto "06:00" |
| `night_mult` — Multiplicador nocturno | decimal |  | mín 1 · máx 5 · por defecto 1.25 |
| `holiday_mult` — Multiplicador festivo | decimal |  | mín 1 · máx 5 · por defecto 1.75 |
| `max_overtime_year` — Horas extra máx./año | entero |  | mín 0 · máx 2000 · por defecto 80 |
| `notes` — Notas | texto largo |  |  |

### Grupo: Programas

#### `programs` — Programa (Programas)
Módulo `prod` · ámbito de programa: `id` · visible para externos. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `code` — Código | texto |  | único |
| `kind` — Tipo de programa | opción |  | opciones: `magazine`, `news`, `gameshow`, `documentary`, `live_radio`, `podcast`, `series`, `entertainment`, `other` |
| `status` — Estado | opción |  | opciones: `development`, `active`, `paused`, `closed` |
| `channel_id` — Cadena / emisora | referencia |  | → `partners` filtrado por {"kind":"channel"} · network / broadcaster |
| `client_id` — Cliente | referencia |  | → `partners` · who is invoiced, if not the network |
| `logline` — Sinopsis breve | texto largo |  |  |
| `genre` — Género | texto |  |  |
| `format_desc` — Descripción del formato | texto largo |  |  |
| `language` — Idioma | opción |  | opciones: `es`, `ca`, `en`, `other` |
| `color` — Color | texto |  | formato color · por defecto "#2b6cb0" |
| `folder` — Carpeta local | texto | sí | formato folder · Carpeta de este equipo donde el proyecto guarda sus archivos (distinta para cada proyecto). El gestor de archivos se abre aquí. |
| `start_date` — Fecha de inicio | fecha |  |  |
| `end_date` — Fecha de fin | fecha |  |  |
| `duration_min` — Duración (min) | entero |  | mín 0 · máx 1000 |
| `episodes_per_season` — Episodios por temporada | entero |  | mín 0 · máx 1000 |
| `slot_desc` — Franja prevista | texto |  |  |
| `template_id` — Plantilla | referencia |  | → `workflow_templates` |
| `contract_value` — Valor del contrato | importe (céntimos en BD, euros en API) |  | permiso: lee `fin.view`, escribe `fin.edit` · agreed price with the network/client (excl. VAT) |
| `currency` — Moneda | texto |  | por defecto "EUR" |
| `producer` — Productor | texto |  |  |
| `executive` — Productor ejecutivo | texto |  |  |
| `notes` — Notas | texto largo |  |  |

#### `seasons` — Temporada (Temporadas)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id` · visible para externos. Título: `name`. Orden: `program_id,number`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `number` — Nº | entero |  | mín 0 · máx 999 · por defecto 1 |
| `name` — Nombre | texto |  |  |
| `status` — Estado | opción |  | opciones: `planning`, `production`, `delivered`, `aired`, `closed` |
| `start_date` — Fecha de inicio | fecha |  |  |
| `end_date` — Fecha de fin | fecha |  |  |
| `air_start` — Inicio de emisión | fecha |  |  |
| `episodes_planned` — Episodios previstos | entero |  | mín 0 · máx 1000 |
| `notes` — Notas | texto largo |  |  |

#### `episodes` — Episodio (Episodios)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id` · visible para externos. Título: `number` + `title`. Orden: `program_id,season_id,number`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `number` — Nº | entero |  | mín 0 · máx 99999 · por defecto 1 |
| `title` — Título | texto |  |  |
| `status` — Estado | opción |  | opciones: `planned`, `script`, `recorded`, `edited`, `qc`, `delivered`, `aired` |
| `synopsis` — Sinopsis | texto largo |  |  |
| `responsible` — Responsable | texto |  |  |
| `shoot_date` — Rodaje | fecha |  |  |
| `edit_due` — Montaje para | fecha |  |  |
| `delivery_due` — Entrega prevista | fecha |  |  |
| `air_date` — Emisión | fecha |  |  |
| `duration_target` — Duración objetivo (s) | entero |  | mín 0 · máx 100000 · seconds |
| `duration_actual` — Duración real (s) | entero |  | mín 0 · máx 100000 · seconds |
| `notes` — Notas | texto largo |  |  |

### Grupo: Planificación

#### `milestones` — Hito (Hitos)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `title`. Orden: `start_date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `title` — Título | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `phase`, `milestone` |
| `start_date` — Fecha de inicio | fecha | sí |  |
| `end_date` — Fecha de fin | fecha |  |  |
| `progress` — Progreso (%) | porcentaje |  | mín 0 · máx 100 · por defecto 0 |
| `status` — Estado | opción |  | opciones: `todo`, `doing`, `done`, `blocked` |
| `owner` — Responsable | texto |  |  |
| `depends_on` — Depende de | JSON |  | array of milestone ids this one depends on |
| `notes` — Notas | texto largo |  |  |

#### `rundown_items` — Bloque de escaleta (Escaleta)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id` · visible para externos. Título: `title`. Orden: `episode_id,position`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `episode_id` — Episodio | referencia | sí | → `episodes` (borrado en cascada) |
| `position` — Posición | entero |  | por defecto 0 |
| `block` — Bloque | texto |  |  |
| `title` — Título | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `intro`, `studio`, `interview`, `report`, `game`, `music`, `ad`, `promo`, `break`, `closing`, `other` |
| `duration_sec` — Duración (s) | entero |  | mín 0 · máx 36000 · por defecto 60 |
| `responsible` — Responsable | texto |  |  |
| `location` — Ubicación | texto |  |  |
| `fixed_time` — Hora fija | hora |  | hard-set clock time (live shows) |
| `content` — Contenido | texto largo |  |  |
| `media_ref` — Referencia de medio | texto |  |  |
| `notes` — Notas | texto largo |  |  |
| `status` — Estado | opción |  | opciones: `draft`, `ready`, `locked`, `done` |

#### `bookings` — Reserva (Reservas)
Módulo `prod` · ámbito de programa: `program_id` · padre: `resource_id` · visible para externos. Título: `title`. Orden: `start`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `resource_id` — Recurso | referencia | sí | → `resources` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `title` — Título | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `shoot`, `broadcast`, `edit`, `rehearsal`, `setup`, `meeting`, `other` |
| `start` — Inicio | fecha y hora | sí |  |
| `end` — Fin | fecha y hora | sí |  |
| `status` — Estado | opción |  | opciones: `tentative`, `confirmed`, `cancelled` |
| `notes` — Notas | texto largo |  |  |

#### `crew_assignments` — Asignación de equipo (Equipo asignado)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id`. Título: `person_id` + `role`. Orden: `start`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `episode_id` — Episodio | referencia |  | → `episodes` (borrado en cascada) |
| `booking_id` — Reserva | referencia |  | → `bookings` (borrado en cascada) |
| `person_id` — Persona | referencia | sí | → `people` |
| `role` — Función | texto | sí |  |
| `start` — Inicio | fecha y hora | sí |  |
| `end` — Fin | fecha y hora | sí |  |
| `status` — Estado | opción |  | opciones: `proposed`, `confirmed`, `declined` |
| `rate_override` — Tarifa específica | importe (céntimos en BD, euros en API) |  | permiso: lee `people.view`, escribe `people.edit` |
| `call_time` — Hora de citación | hora |  |  |
| `notes` — Notas | texto largo |  |  |

### Grupo: Colaboración

#### `tasks` — Tarea (Tareas)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id` · visible para externos (donde assignee = :user). Título: `title`. Orden: `due`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `title` — Título | texto | sí |  |
| `status` — Estado | opción |  | opciones: `todo`, `doing`, `review`, `done` |
| `priority` — Prioridad | opción |  | opciones: `low`, `medium`, `high` |
| `assignee` — Responsable | texto |  | gateway username of the person responsible |
| `due` — Fecha límite | fecha |  |  |
| `notes` — Notas | texto largo |  |  |
| `related_entity` — Elemento relacionado | texto |  |  |
| `related_id` — ID relacionado | entero |  |  |

#### `comments` — Comentario (Comentarios)
Módulo `prod` · ámbito de programa: `program_id` · visible para externos · sin historial. Título: `body`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `entity` — Entidad | texto | sí |  |
| `row_id` — ID | entero | sí |  |
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `body` — Comentario | texto largo | sí |  |
| `mentions` — Menciones | etiquetas |  |  |

#### `approvals` — Aprobación (Aprobaciones)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id` · visible para externos (donde approver = :user OR requested_by = :user). Título: `subject`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `entity` — Entidad | texto | sí |  |
| `row_id` — ID | entero | sí |  |
| `subject` — Asunto | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `editorial`, `network`, `legal`, `financial`, `client`, `internal` |
| `status` — Estado | opción |  | opciones: `pending`, `approved`, `rejected`, `changes` |
| `requested_by` — Solicitado por | texto |  |  |
| `approver` — Aprobador | texto |  | username (internal or external) |
| `due` — Vencimiento | fecha |  |  |
| `comment` — Comentario | texto largo |  |  |
| `decided_at` (solo lectura) — Decidido el | fecha y hora |  |  |
| `decided_by` (solo lectura) — Decidido por | texto |  |  |

#### `notifications` — Notificación (Notificaciones)
Módulo `own` · sin historial. Título: `title`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `user` — Usuario | texto | sí |  |
| `title` — Título | texto | sí |  |
| `body` — Texto | texto largo |  |  |
| `link` — Enlace | texto |  |  |
| `kind` — Tipo | texto |  |  |
| `key` — Clave | texto |  | único |
| `read` — Leída | sí/no |  | por defecto 0 |

#### `members` — Acceso externo (Accesos externos)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `username`. Orden: `program_id,username`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `username` — Usuario (login) | texto | sí | gateway username (role «externo») |
| `side` — Parte | opción |  | opciones: `network`, `freelance`, `supplier`, `client`, `other` |
| `org` — Organización | texto |  |  |
| `can_comment` — Puede comentar | sí/no |  | por defecto 1 |
| `sees_budget` — Ve el presupuesto | sí/no |  | por defecto 0 · may see budget summaries (read-only) |

### Grupo: Informes

#### `risks` — Riesgo (Riesgos)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `title`. Orden: `-score`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `title` — Título | texto | sí |  |
| `category` — Categoría | opción |  | opciones: `economic`, `legal`, `human`, `technical`, `editorial`, `commercial`, `other` |
| `probability` — Probabilidad | entero |  | mín 1 · máx 5 · por defecto 3 |
| `impact` — Impacto | entero |  | mín 1 · máx 5 · por defecto 3 |
| `score` (solo lectura) — Puntuación | entero |  |  |
| `status` — Estado | opción |  | opciones: `open`, `mitigated`, `accepted`, `closed` |
| `owner` — Responsable | texto |  |  |
| `mitigation` — Mitigación | texto largo |  |  |
| `review_date` — Revisión | fecha |  |  |

### Grupo: Finanzas

#### `budgets` — Presupuesto (Presupuestos)
Módulo `fin` · ámbito de programa: `program_id` · padre: `program_id`. Título: `name` + `version`. Orden: `program_id,name,-version`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `name` — Nombre | texto | sí |  |
| `kind` — Clase | opción |  | opciones: `budget`, `template` |
| `version` — Versión | entero |  | mín 1 · por defecto 1 |
| `status` — Estado | opción |  | opciones: `draft`, `submitted`, `approved`, `obsolete` |
| `currency` — Moneda | texto |  | por defecto "EUR" |
| `contingency_pct` — Imprevistos (%) | porcentaje |  | mín 0 · máx 100 · por defecto 5 |
| `episodes` — Episodios que cubre | entero |  | mín 0 · por defecto 0 · episodes the budget covers (to derive the per-episode cost) |
| `subtotal` (solo lectura) — Subtotal | importe (céntimos en BD, euros en API) |  |  |
| `vat` (solo lectura) — IVA | importe (céntimos en BD, euros en API) |  |  |
| `total` (solo lectura) — Total | importe (céntimos en BD, euros en API) |  |  |
| `approved_by` (solo lectura) — Aprobado por | texto |  |  |
| `approved_at` (solo lectura) — Aprobado el | fecha y hora |  |  |
| `notes` — Notas | texto largo |  |  |
| `parent_id` (solo lectura) — Versión anterior | referencia |  | → `budgets` |

#### `budget_lines` — Partida (Partidas)
Módulo `fin` · ámbito de programa: `program_id` · padre: `budget_id`. Título: `code` + `description`. Orden: `budget_id,code`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `budget_id` — Presupuesto | referencia | sí | → `budgets` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `chapter` — Capítulo | opción |  | opciones: `development`, `script`, `artistic`, `technical`, `studios`, `equipment`, `location`, `postproduction`, `music_rights`, `insurance`, `travel`, `marketing`, `overheads`, `contingency`, `other` |
| `code` — Partida nº | texto |  |  |
| `description` — Concepto | texto | sí |  |
| `qty` — Cantidad | decimal |  | por defecto 1 |
| `unit` — Unidad | texto |  | por defecto "ud" |
| `unit_cost` — Coste unitario | importe (céntimos en BD, euros en API) |  |  |
| `amount` (solo lectura) — Importe | importe (céntimos en BD, euros en API) |  |  |
| `vat_rate` — IVA (%) | decimal |  | mín 0 · máx 100 · por defecto 21 |
| `irpf_rate` — Retención (%) | decimal |  | mín 0 · máx 100 · por defecto 0 |
| `account` — Cuenta contable | texto |  | accounting account (Odoo export) |
| `notes` — Notas | texto largo |  |  |

#### `purchase_orders` — Orden de compra (Órdenes de compra)
Módulo `fin` · ámbito de programa: `program_id`. Título: `number` + `description`. Orden: `-number`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `number` (solo lectura) — Nº de orden | texto |  | único |
| `program_id` — Programa | referencia | sí | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `budget_line_id` — Partida | referencia |  | → `budget_lines` |
| `supplier_id` — Proveedor | referencia |  | → `partners` filtrado por {"kind":"supplier"} |
| `description` — Descripción | texto | sí |  |
| `amount` — Importe | importe (céntimos en BD, euros en API) | sí |  |
| `vat_rate` — IVA (%) | decimal |  | mín 0 · máx 100 · por defecto 21 |
| `needed_date` — Necesaria para | fecha |  |  |
| `status` — Estado | opción |  | opciones: `draft`, `pending`, `approved`, `rejected`, `invoiced`, `closed`, `cancelled` |
| `requested_by` (solo lectura) — Solicitado por | texto |  |  |
| `approved_by` (solo lectura) — Aprobado por | texto |  |  |
| `approved_at` (solo lectura) — Aprobado el | fecha y hora |  |  |
| `notes` — Notas | texto largo |  |  |

#### `bills` — Gasto o factura (Gastos y facturas)
Módulo `fin` · ámbito de programa: `program_id`. Título: `number` + `description`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `kind` — Clase | opción |  | opciones: `invoice`, `expense`, `payroll`, `other` |
| `number` — Nº de factura | texto |  |  |
| `date` — Fecha | fecha | sí |  |
| `due_date` — Vencimiento | fecha |  |  |
| `supplier_id` — Proveedor | referencia |  | → `partners` |
| `person_id` — Persona | referencia |  | → `people` |
| `supplier_name` — Proveedor (texto) | texto |  |  |
| `program_id` — Programa | referencia |  | → `programs` |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `budget_line_id` — Partida | referencia |  | → `budget_lines` |
| `po_id` — Orden de compra | referencia |  | → `purchase_orders` |
| `description` — Descripción | texto | sí |  |
| `base` — Base imponible | importe (céntimos en BD, euros en API) | sí |  |
| `vat_rate` — IVA (%) | decimal |  | mín 0 · máx 100 · por defecto 21 |
| `irpf_rate` — Retención (%) | decimal |  | mín 0 · máx 100 · por defecto 0 |
| `vat` (solo lectura) — IVA | importe (céntimos en BD, euros en API) |  |  |
| `irpf` (solo lectura) — Retención | importe (céntimos en BD, euros en API) |  |  |
| `total` (solo lectura) — Total | importe (céntimos en BD, euros en API) |  |  |
| `status` — Estado | opción |  | opciones: `pending`, `approved`, `rejected`, `paid` |
| `paid_date` — Pagado el | fecha |  |  |
| `payment_method` — Método de pago | opción |  | opciones: `transfer`, `card`, `cash`, `direct_debit`, `other` |
| `approved_by` (solo lectura) — Aprobado por | texto |  |  |
| `approved_at` (solo lectura) — Aprobado el | fecha y hora |  |  |
| `bank_movement_id` (solo lectura) — Movimiento bancario | referencia |  | → `bank_movements` |
| `notes` — Notas | texto largo |  |  |

#### `client_invoices` — Factura emitida (Facturación)
Módulo `fin` · ámbito de programa: `program_id`. Título: `number`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `series` — Serie | texto |  | por defecto "F" |
| `number` — Nº de factura | texto |  | único · left empty it is assigned on issue |
| `date` — Fecha de emisión | fecha | sí |  |
| `due_date` — Vencimiento | fecha |  |  |
| `client_id` — Cliente | referencia | sí | → `partners` |
| `program_id` — Programa | referencia |  | → `programs` |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `plan_id` — Hito de facturación | referencia |  | → `billing_plan` |
| `concept` — Concepto | texto | sí |  |
| `base` — Base imponible | importe (céntimos en BD, euros en API) | sí |  |
| `vat_rate` — IVA (%) | decimal |  | mín 0 · máx 100 · por defecto 21 |
| `irpf_rate` — Retención (%) | decimal |  | mín 0 · máx 100 · por defecto 0 · withholding applied by the client |
| `vat` (solo lectura) — IVA | importe (céntimos en BD, euros en API) |  |  |
| `irpf` (solo lectura) — Retención | importe (céntimos en BD, euros en API) |  |  |
| `total` (solo lectura) — Total | importe (céntimos en BD, euros en API) |  |  |
| `paid_amount` (solo lectura) — Cobrado | importe (céntimos en BD, euros en API) |  |  |
| `status` — Estado | opción |  | opciones: `draft`, `issued`, `partial`, `paid`, `void` |
| `notes` — Notas | texto largo |  |  |

#### `payments` — Cobro (Cobros)
Módulo `fin` · ámbito de programa: `program_id` · padre: `invoice_id`. Título: `date` + `amount`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `invoice_id` — Factura | referencia | sí | → `client_invoices` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `date` — Fecha | fecha | sí |  |
| `amount` — Importe | importe (céntimos en BD, euros en API) | sí |  |
| `method` — Forma de cobro | opción |  | opciones: `transfer`, `card`, `cash`, `direct_debit`, `other` |
| `reference` — Referencia | texto |  |  |
| `bank_movement_id` (solo lectura) — Movimiento bancario | referencia |  | → `bank_movements` |

#### `billing_plan` — Hito de facturación (Plan de facturación)
Módulo `fin` · ámbito de programa: `program_id` · padre: `program_id`. Título: `description`. Orden: `expected_date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `client_id` — Cliente | referencia |  | → `partners` |
| `description` — Descripción | texto | sí |  |
| `expected_date` — Fecha prevista | fecha | sí |  |
| `amount` — Importe | importe (céntimos en BD, euros en API) | sí |  |
| `vat_rate` — IVA (%) | decimal |  | mín 0 · máx 100 · por defecto 21 |
| `trigger` — Se factura al | opción |  | opciones: `date`, `delivery`, `air`, `milestone` |
| `status` — Estado | opción |  | opciones: `planned`, `invoiced`, `cancelled` |

#### `bank_movements` — Movimiento bancario (Movimientos bancarios)
Módulo `fin`. Título: `date` + `concept`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `date` — Fecha | fecha | sí |  |
| `concept` — Concepto | texto | sí |  |
| `amount` — Importe | importe (céntimos en BD, euros en API) | sí | positive = in, negative = out |
| `counterparty` — Contraparte | texto |  |  |
| `reference` — Referencia | texto |  |  |
| `account` — Cuenta | texto |  |  |
| `batch` (solo lectura) — Lote | texto |  |  |
| `matched` (solo lectura) — Conciliado | sí/no |  | por defecto 0 |
| `matched_entity` (solo lectura) — Conciliado con | texto |  |  |
| `matched_id` (solo lectura) — ID conciliado | entero |  |  |

#### `grants` — Subvención (Subvenciones)
Módulo `fin` · ámbito de programa: `program_id`. Título: `name`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `body` — Organismo | texto |  | granting authority |
| `reference` — Referencia | texto |  |  |
| `program_id` — Programa | referencia |  | → `programs` |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `status` — Estado | opción |  | opciones: `planned`, `applied`, `granted`, `denied`, `partial_paid`, `paid`, `justified` |
| `requested` — Solicitado | importe (céntimos en BD, euros en API) |  |  |
| `granted` — Concedido | importe (céntimos en BD, euros en API) |  |  |
| `received` — Recibido | importe (céntimos en BD, euros en API) |  |  |
| `apply_by` — Solicitar antes de | fecha |  |  |
| `resolution_date` — Fecha de resolución | fecha |  |  |
| `justify_by` — Justificar antes de | fecha |  |  |
| `installments` — Plazos de cobro | JSON |  | [{date, amount, received}] expected payments (feeds the cashflow) |
| `eligible_notes` — Gastos elegibles | texto largo |  |  |
| `notes` — Notas | texto largo |  |  |

### Grupo: Comercial

#### `rate_cards` — Tarifa (Tarifas publicitarias)
Módulo `fin`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `program_id` — Programa | referencia |  | → `programs` |
| `channel_id` — Cadena / emisora | referencia |  | → `partners` |
| `daypart` — Franja horaria | texto |  |  |
| `unit` — Unidad | opción |  | opciones: `spot_10`, `spot_20`, `spot_30`, `billboard`, `mention`, `placement`, `package`, `other` |
| `price` — Precio | importe (céntimos en BD, euros en API) | sí |  |
| `valid_from` — Válida desde | fecha |  |  |
| `valid_to` — Válida hasta | fecha |  |  |
| `notes` — Notas | texto largo |  |  |

#### `sponsorships` — Patrocinio (Patrocinios)
Módulo `fin` · ámbito de programa: `program_id`. Título: `name`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `sponsor_id` — Patrocinador | referencia | sí | → `partners` |
| `program_id` — Programa | referencia |  | → `programs` |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `kind` — Tipo | opción |  | opciones: `sponsorship`, `placement`, `branded`, `spots`, `billboard`, `other` |
| `status` — Estado | opción |  | opciones: `proposal`, `negotiation`, `signed`, `executed`, `invoiced`, `lost` |
| `fee` — Importe | importe (céntimos en BD, euros en API) |  |  |
| `start_date` — Fecha de inicio | fecha |  |  |
| `end_date` — Fecha de fin | fecha |  |  |
| `contract_id` — Contrato | referencia |  | → `contracts` |
| `invoice_id` — Factura | referencia |  | → `client_invoices` |
| `deliverables` — Entregables | texto largo |  |  |
| `restrictions` — Restricciones | texto largo |  |  |
| `notes` — Notas | texto largo |  |  |

#### `ad_spots` — Pase publicitario (Tráfico publicitario)
Módulo `fin` · ámbito de programa: `program_id` · padre: `sponsorship_id`. Título: `description`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `sponsorship_id` — Patrocinio | referencia | sí | → `sponsorships` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `broadcast_id` — Emisión | referencia |  | → `broadcasts` |
| `rate_card_id` — Tarifa publicitaria | referencia |  | → `rate_cards` |
| `description` — Descripción | texto |  |  |
| `position` — Posición | opción |  | opciones: `pre`, `mid`, `post`, `billboard`, `inside` |
| `duration_sec` — Duración (s) | entero |  | mín 0 · por defecto 20 |
| `price` — Precio | importe (céntimos en BD, euros en API) |  |  |
| `status` — Estado | opción |  | opciones: `planned`, `aired`, `invoiced` |
| `invoice_id` (solo lectura) — Factura | referencia |  | → `client_invoices` |

#### `placements` — Emplazamiento (Emplazamientos de producto)
Módulo `fin` · ámbito de programa: `program_id` · padre: `sponsorship_id`. Título: `brand`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `sponsorship_id` — Patrocinio | referencia |  | → `sponsorships` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `brand` — Marca | texto | sí |  |
| `description` — Descripción | texto largo |  |  |
| `scene` — Escena | texto |  |  |
| `tc_in` — TC entrada | texto |  |  |
| `tc_out` — TC salida | texto |  |  |
| `approved` — Aprobado | sí/no |  | por defecto 0 |
| `disclosure` — Aviso en pantalla | sí/no |  | por defecto 0 · on-screen notice of product placement shown |
| `notes` — Notas | texto largo |  |  |

### Grupo: Contratos y derechos

#### `contracts` — Contrato (Contratos)
Módulo `legal` · ámbito de programa: `program_id`. Título: `title`. Orden: `end_date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `title` — Título | texto | sí |  |
| `type` — Tipo de contrato | opción |  | opciones: `crew`, `talent`, `guest`, `supplier`, `network`, `sponsorship`, `format_license`, `music`, `archive`, `image_release`, `rights_assignment`, `nda`, `other` |
| `status` — Estado | opción |  | opciones: `draft`, `signing`, `active`, `expired`, `terminated` |
| `party` — Contraparte | texto |  | counterparty name (free text if not in the directory) |
| `person_id` — Persona | referencia |  | → `people` |
| `partner_id` — Entidad | referencia |  | → `partners` |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `signed_date` — Firmado el | fecha |  |  |
| `start_date` — Fecha de inicio | fecha |  |  |
| `end_date` — Fecha de fin | fecha |  |  |
| `auto_renew` — Renovación automática | sí/no |  | por defecto 0 |
| `notice_days` — Días de preaviso | entero |  | mín 0 · máx 730 · por defecto 30 · days of notice before expiry to raise an alert |
| `value` — Valor | importe (céntimos en BD, euros en API) |  | permiso: lee `fin.view`, escribe `legal.edit` |
| `payment_terms` — Condiciones de pago | texto |  |  |
| `exclusivity` — Exclusividad | sí/no |  | por defecto 0 |
| `territory` — Territorio | texto |  |  |
| `contains_personal_data` — Contiene datos personales | sí/no |  | por defecto 1 |
| `minors_involved` — Participan menores | sí/no |  | por defecto 0 |
| `summary` — Resumen | texto largo |  |  |
| `key_terms` — Cláusulas clave | texto largo |  | permiso: lee `legal.view`, escribe `legal.edit` |
| `notes` — Notas | texto largo |  |  |

#### `rights` — Derecho (Derechos)
Módulo `legal` · ámbito de programa: `program_id`. Título: `title`. Orden: `window_end`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `title` — Título | texto | sí |  |
| `kind` — Tipo de derecho | opción |  | opciones: `format`, `music`, `archive`, `talent_image`, `footage`, `script`, `other` |
| `holder` — Titular de los derechos | texto |  | rights holder / licensor |
| `partner_id` — Entidad | referencia |  | → `partners` |
| `person_id` — Persona | referencia |  | → `people` |
| `contract_id` — Contrato | referencia |  | → `contracts` |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `media` — Medio | opción |  | opciones: `all`, `tv`, `radio`, `online`, `festival`, `internal` |
| `territory` — Territorio | texto |  | por defecto "ES" |
| `languages` — Idiomas | texto |  |  |
| `exclusivity` — Exclusividad | opción |  | opciones: `none`, `semi`, `exclusive` |
| `window_start` — Inicio de ventana | fecha |  |  |
| `window_end` — Fin de ventana | fecha |  |  |
| `perpetual` — Perpetuo | sí/no |  | por defecto 0 |
| `max_runs` — Pases máximos | entero |  | mín 0 |
| `runs_used` — Pases usados | entero |  | mín 0 · por defecto 0 |
| `fee` — Importe | importe (céntimos en BD, euros en API) |  | permiso: lee `fin.view`, escribe `legal.edit` |
| `status` — Situación | opción |  | opciones: `negotiating`, `cleared`, `restricted`, `expired` |
| `restrictions` — Restricciones | texto largo |  |  |
| `notes` — Notas | texto largo |  |  |

#### `cue_sheets` — Cue sheet (Cue sheets)
Módulo `legal` · ámbito de programa: `program_id` · padre: `episode_id`. Título: `title`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `episode_id` — Episodio | referencia | sí | → `episodes` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `title` — Título | texto | sí |  |
| `status` — Estado | opción |  | opciones: `draft`, `ready`, `submitted` |
| `society` — Entidad de gestión | texto |  | por defecto "SGAE" |
| `submitted_at` — Presentada el | fecha |  |  |
| `reference` — Referencia | texto |  |  |
| `total_music_sec` (solo lectura) — Música total (s) | entero |  |  |
| `notes` — Notas | texto largo |  |  |

#### `cue_items` — Obra musical (Obras musicales)
Módulo `legal` · ámbito de programa: `program_id` · padre: `cue_sheet_id`. Título: `title`. Orden: `cue_sheet_id,position`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `cue_sheet_id` — Cue sheet | referencia | sí | → `cue_sheets` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `position` — Posición | entero |  | por defecto 0 |
| `title` — Título | texto | sí |  |
| `composer` — Compositor | texto |  |  |
| `author` — Autor | texto |  |  |
| `publisher` — Editorial musical | texto |  |  |
| `performer` — Intérprete | texto |  |  |
| `label` — Discográfica | texto |  |  |
| `library` — Librería musical | texto |  |  |
| `isrc` — ISRC | texto |  |  |
| `iswc` — ISWC | texto |  |  |
| `usage` — Uso | opción |  | opciones: `bi`, `bv`, `vi`, `vv`, `theme`, `jingle`, `logo`, `other` |
| `tc_in` — TC entrada | texto |  |  |
| `duration_sec` — Duración (s) | entero |  | mín 0 · por defecto 0 |
| `society` — Sociedad | texto |  |  |
| `share_pct` — Participación (%) | porcentaje |  | mín 0 · máx 100 · por defecto 100 |
| `right_id` — Derecho | referencia |  | → `rights` |
| `notes` — Notas | texto |  |  |

### Grupo: RGPD

#### `processing_activities` — Actividad de tratamiento (Registro de tratamientos)
Módulo `legal`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `purpose` — Finalidad | texto largo |  |  |
| `legal_basis` — Base jurídica | opción |  | opciones: `consent`, `contract`, `legal_obligation`, `legitimate_interest`, `public_interest`, `vital_interest` |
| `data_categories` — Categorías de datos | texto largo |  |  |
| `data_subjects` — Interesados | texto largo |  |  |
| `recipients` — Destinatarios | texto largo |  |  |
| `international_transfers` — Transferencias internacionales | texto largo |  |  |
| `retention_months` — Retención (meses) | entero |  | mín 0 · máx 1200 · por defecto 60 |
| `security_measures` — Medidas de seguridad | texto largo |  |  |
| `owner` — Responsable | texto |  |  |
| `dpia_required` — Requiere EIPD | sí/no |  | por defecto 0 |
| `review_date` — Revisión | fecha |  |  |
| `notes` — Notas | texto largo |  |  |

#### `consents` — Consentimiento (Consentimientos)
Módulo `legal` · ámbito de programa: `program_id`. Título: `subject` + `kind`. Orden: `expires`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `subject` — Asunto | texto | sí | person (or guardian for minors) |
| `person_id` — Persona | referencia |  | → `people` |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `kind` — Tipo | opción |  | opciones: `image`, `data`, `minor_guardian`, `marketing`, `voice` |
| `status` — Estado | opción |  | opciones: `granted`, `revoked`, `expired`, `pending` |
| `granted_date` — Concedido el | fecha |  |  |
| `expires` — Caduca | fecha |  |  |
| `minor` — Menor | sí/no |  | por defecto 0 |
| `contract_id` — Contrato | referencia |  | → `contracts` |
| `notes` — Notas | texto largo |  |  |

#### `dsr_requests` — Solicitud de derechos (Derechos de las personas)
Módulo `legal`. Título: `requester` + `kind`. Orden: `due`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `requester` — Solicitante | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `access`, `rectification`, `erasure`, `portability`, `objection`, `restriction` |
| `received` — Recibido | fecha | sí |  |
| `due` — Vencimiento | fecha |  | one month from reception unless extended |
| `status` — Estado | opción |  | opciones: `received`, `in_progress`, `resolved`, `rejected` |
| `resolution` — Resolución | texto largo |  |  |
| `handled_by` — Gestionado por | texto |  |  |
| `notes` — Notas | texto largo |  |  |

#### `retention_policies` — Política de retención (Retención documental)
Módulo `legal`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `entity` — Entidad (tabla) | texto | sí |  |
| `filter` — Condición | texto |  | SQL condition, e.g. status = 'expired' |
| `date_field` — Campo de fecha | texto |  | por defecto "updated" |
| `months` — Meses | entero | sí | mín 1 · máx 1200 · por defecto 60 |
| `action` — Acción | opción |  | opciones: `review`, `anonymize`, `delete` |
| `notes` — Notas | texto largo |  |  |

### Grupo: Material

#### `assets` — Material (Material y archivo)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id`. Título: `title`. Orden: `-updated`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `title` — Título | texto | sí |  |
| `program_id` — Programa | referencia |  | → `programs` |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `kind` — Tipo | opción |  | opciones: `raw`, `edit`, `master`, `audio`, `graphic`, `script`, `subtitle`, `still`, `music`, `other` |
| `version` — Versión | texto |  | por defecto "v1" |
| `status` — Estado | opción |  | opciones: `ingest`, `working`, `approved`, `archived`, `deleted` |
| `description` — Descripción | texto largo |  |  |
| `location_kind` — Tipo de ubicación | opción |  | opciones: `nas`, `cloud`, `tape`, `url`, `local`, `other` |
| `uri` — Ruta o enlace | texto |  | path / URL / tape id (the app never stores the video) |
| `container` — Contenedor | texto |  |  |
| `codec` — Códec | texto |  |  |
| `resolution` — Resolución | texto |  |  |
| `fps` — Fotogramas/s | texto |  |  |
| `audio` — Audio | texto |  |  |
| `duration_sec` — Duración (s) | entero |  | mín 0 |
| `size_mb` — Tamaño (MB) | entero |  | mín 0 |
| `checksum` — Checksum | texto |  |  |
| `language` — Idioma | texto |  |  |
| `shot_at` — Fecha de grabación | fecha |  |  |
| `tags` — Etiquetas | etiquetas |  |  |
| `right_id` — Derecho | referencia |  | → `rights` |
| `retention_until` — Conservar hasta | fecha |  |  |
| `notes` — Notas | texto largo |  |  |

### Grupo: Calidad y entrega

#### `delivery_specs` — Especificación de entrega (Especificaciones de entrega)
Módulo `prod` · visible para externos. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `partner_id` — Entidad | referencia |  | → `partners` |
| `container` — Contenedor | texto |  | por defecto "MXF" |
| `video_codec` — Códec de vídeo | texto |  | por defecto "XDCAM HD422 50" |
| `resolution` — Resolución | texto |  | por defecto "1920x1080" |
| `fps` — Fotogramas/s | texto |  | por defecto "25p" |
| `scan` — Barrido | texto |  |  |
| `colorspace` — Espacio de color | texto |  | por defecto "Rec.709" |
| `audio_layout` — Distribución de audio | texto |  | por defecto "Stereo + M&E" |
| `loudness` — Sonoridad | texto |  | por defecto "-23 LUFS (EBU R128)" |
| `true_peak` — Pico real | texto |  | por defecto "-1 dBTP" |
| `subtitles` — Subtítulos | texto |  |  |
| `duration_rule` — Regla de duración | texto |  |  |
| `naming` — Nomenclatura | texto |  |  |
| `delivery_method` — Método de entrega | texto |  |  |
| `checklist` — Lista de comprobación | JSON |  | [{id,label,category,required}] |
| `notes` — Notas | texto largo |  |  |

#### `qc_reports` — Informe de QC (Control de calidad)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id` · visible para externos. Título: `episode_id` + `version`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `episode_id` — Episodio | referencia | sí | → `episodes` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `asset_id` — Material | referencia |  | → `assets` |
| `spec_id` — Especificación | referencia |  | → `delivery_specs` |
| `version` — Versión | texto |  | por defecto "v1" |
| `date` — Fecha | fecha | sí |  |
| `performed_by` — Realizado por | texto |  |  |
| `checks` — Comprobaciones | JSON |  | {item_id: {ok:true\|false\|null, note}} |
| `result` — Resultado | opción |  | opciones: `pass`, `pass_notes`, `fail` |
| `notes` — Notas | texto largo |  |  |

#### `qc_issues` — Incidencia (Incidencias)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id` · visible para externos. Título: `description`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `episode_id` — Episodio | referencia | sí | → `episodes` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `qc_id` — Informe de QC | referencia |  | → `qc_reports` |
| `asset_id` — Material | referencia |  | → `assets` |
| `severity` — Gravedad | opción |  | opciones: `low`, `medium`, `high`, `blocker` |
| `description` — Descripción | texto largo | sí |  |
| `tc` — TC | texto |  |  |
| `status` — Estado | opción |  | opciones: `open`, `in_progress`, `resolved`, `wontfix` |
| `assigned` — Asignado a | texto |  |  |
| `resolved_at` (solo lectura) — Resuelto el | fecha y hora |  |  |
| `notes` — Notas | texto largo |  |  |

#### `deliveries` — Entrega (Entregas)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id` · visible para externos. Título: `episode_id` + `version`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `episode_id` — Episodio | referencia | sí | → `episodes` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `partner_id` — Entidad | referencia |  | → `partners` |
| `spec_id` — Especificación | referencia |  | → `delivery_specs` |
| `version` — Versión | texto |  | por defecto "v1" |
| `status` — Estado | opción |  | opciones: `preparing`, `sent`, `accepted`, `rejected` |
| `items` — Contenido del paquete | JSON |  | [{asset_id,name,size_mb,checksum}] frozen at send time |
| `checklist_state` — Estado de la lista | JSON |  |  |
| `method` — Método de envío | texto |  |  |
| `tracking_ref` — Referencia de envío | texto |  |  |
| `sent_at` (solo lectura) — Enviado el | fecha y hora |  |  |
| `sent_by` (solo lectura) — Enviado por | texto |  |  |
| `accepted_at` — Aceptado el | fecha y hora |  |  |
| `manifest_hash` (solo lectura) — Huella del paquete | texto |  |  |
| `notes` — Notas | texto largo |  |  |

#### `editorial_lines` — Línea editorial (Líneas editoriales)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `title`. Orden: `program_id,title`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `title` — Título | texto | sí |  |
| `body` — Texto | texto largo |  |  |
| `approved` — Aprobado | sí/no |  | por defecto 0 |
| `approved_by` (solo lectura) — Aprobado por | texto |  |  |

#### `compliance_checks` — Verificación normativa (Cumplimiento normativo)
Módulo `prod` · ámbito de programa: `program_id` · padre: `episode_id`. Título: `item`. Orden: `episode_id,area`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia | sí | → `episodes` (borrado en cascada) |
| `area` — Área | opción |  | opciones: `minors`, `advertising`, `accessibility`, `data_protection`, `pluralism`, `copyright`, `other` |
| `item` — Punto a verificar | texto | sí |  |
| `status` — Estado | opción |  | opciones: `pending`, `ok`, `review`, `breach`, `na` |
| `reviewer` — Revisor | texto |  |  |
| `date` — Fecha | fecha |  |  |
| `notes` — Notas | texto largo |  |  |

### Grupo: Emisión

#### `broadcasts` — Emisión (Parrilla y emisiones)
Módulo `prod` · ámbito de programa: `program_id` · visible para externos. Título: `date` + `start_time`. Orden: `date,start_time`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `channel_id` — Cadena / emisora | referencia |  | → `partners` filtrado por {"kind":"channel"} |
| `title` — Título | texto |  |  |
| `date` — Fecha | fecha | sí |  |
| `start_time` — Hora de inicio | hora | sí |  |
| `end_time` — Hora de fin | hora |  |  |
| `kind` — Tipo | opción |  | opciones: `premiere`, `repeat`, `live`, `preview` |
| `status` — Estado | opción |  | opciones: `planned`, `confirmed`, `aired`, `cancelled` |
| `actual_start` — Inicio real | hora |  |  |
| `actual_end` — Fin real | hora |  |  |
| `notes` — Notas | texto largo |  |  |

#### `ratings` — Dato de audiencia (Audiencias)
Módulo `prod` · ámbito de programa: `program_id` · padre: `broadcast_id`. Título: `source` + `date`. Orden: `-date`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `broadcast_id` — Emisión | referencia |  | → `broadcasts` (borrado en cascada) |
| `program_id` — Programa | referencia |  | → `programs` |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `date` — Fecha | fecha | sí |  |
| `source` — Fuente de medición | texto |  | por defecto "Kantar" |
| `target_label` — Target (demografía) | texto |  | por defecto "Total individuos" |
| `target_id` — Target | referencia |  | → `targets` |
| `audience_avg` — Audiencia media (miles) | entero |  | mín 0 · average audience (thousands) |
| `share_pct` — Cuota de pantalla (%) | decimal |  | mín 0 · máx 100 |
| `rating_pct` — Rating (%) | decimal |  | mín 0 · máx 100 |
| `reach` — Cobertura (miles) | entero |  | mín 0 · thousands |
| `peak` — Pico | entero |  | mín 0 |
| `minute_curve` — Curva minuto a minuto | JSON |  | [audience per minute] |
| `batch` (solo lectura) — Lote | texto |  |  |
| `notes` — Notas | texto |  |  |

### Grupo: Audiencias

#### `targets` — Target (Targets)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `name`. Orden: `program_id,name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `name` — Nombre | texto | sí |  |
| `age_range` — Franja de edad | texto |  |  |
| `description` — Descripción | texto largo |  |  |
| `habits` — Hábitos | texto largo |  |  |
| `channels` — Canales | texto largo |  |  |
| `needs` — Necesidades | texto largo |  |  |
| `size_note` — Tamaño del target | texto |  |  |
| `sources` — Fuentes | texto largo |  |  |

#### `competitors` — Competidor (Competencia)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `programme`. Orden: `program_id,programme`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `programme` — Programa | texto | sí |  |
| `channel` — Cadena | texto |  |  |
| `slot` — Franja | texto |  |  |
| `share` — Cuota | texto |  |  |
| `notes` — Notas | texto largo |  |  |
| `source` — Fuente | texto |  |  |

### Grupo: Documentos

#### `documents` — Documento (Documentos)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id` · visible para externos (donde shared = 1). Título: `title`. Orden: `-updated`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `title` — Título | texto | sí |  |
| `type` — Tipo de documento | opción |  | opciones: `format`, `bible`, `rundown`, `script`, `dossier`, `audience`, `target`, `competitor`, `production`, `marketing`, `report`, `contract`, `callsheet`, `budget`, `delivery`, `minutes`, `other` |
| `status` — Estado | opción |  | opciones: `draft`, `review`, `approved`, `final` |
| `language` — Idioma | opción |  | opciones: `es`, `ca`, `en` |
| `content` — Contenido | texto largo |  | Markdown with Claqueta directives |
| `template_id` — Plantilla | referencia |  | → `doc_templates` |
| `brand_id` — Marca / identidad | referencia |  | → `brands` |
| `vars` — Valores | JSON |  | values for the template variables |
| `options` — Opciones | JSON |  | layout overrides (page size, cover, toc...) |
| `tags` — Etiquetas | etiquetas |  |  |
| `shared` — Compartido con externos | sí/no |  | por defecto 0 · visible to external members of the programme |
| `version` (solo lectura) — Versión | entero |  | por defecto 1 |

#### `doc_versions` — Versión (Versiones)
Módulo `prod` · padre: `document_id` · oculta en el menú · sin historial. Título: `title`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `document_id` — Documento | referencia | sí | → `documents` (borrado en cascada) |
| `version` — Versión | entero |  |  |
| `title` — Título | texto |  |  |
| `content` — Contenido | texto largo |  |  |
| `note` — Nota | texto |  |  |

#### `brands` — Marca (Marcas e identidad)
Módulo `prod`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre de la marca | texto | sí | único |
| `description` — Descripción | texto |  |  |
| `primary` — Color principal | texto |  | formato color · por defecto "#1f3a5f" |
| `accent` — Color de acento | texto |  | formato color · por defecto "#e0a100" |
| `text_color` — Color del texto | texto |  | formato color · por defecto "#1c1f24" |
| `muted` — Color secundario | texto |  | formato color · por defecto "#6b7280" |
| `bg` — Fondo | texto |  | formato color · por defecto "#ffffff" |
| `table_head_bg` — Fondo cabecera de tabla | texto |  | formato color |
| `table_stripe` — Fondo de filas alternas | texto |  | formato color · por defecto "#f4f6f8" |
| `font_heading` — Fuente de títulos | texto |  | por defecto "Inter" |
| `font_body` — Fuente del texto | texto |  | por defecto "Inter" |
| `font_mono` — Fuente monoespaciada | texto |  | por defecto "DejaVu Sans Mono" |
| `font_files` — Fuentes subidas | JSON |  | [{family, weight, style, attachment_id}] custom fonts (uploaded as attachments) |
| `base_size` — Tamaño base (pt) | decimal |  | mín 7 · máx 16 · por defecto 10.5 · pt |
| `line_height` — Interlineado | decimal |  | mín 1 · máx 2.5 · por defecto 1.45 |
| `logo_attachment_id` — Logotipo (adjunto) | entero |  | attachment id of the logo (png/svg/jpg) |
| `logo_height_mm` — Alto del logotipo (mm) | entero |  | mín 4 · máx 60 · por defecto 14 |
| `page_size` — Tamaño de página | opción |  | opciones: `A4`, `A3`, `Letter`, `Legal` |
| `orientation` — Orientación | opción |  | opciones: `portrait`, `landscape` |
| `margin_mm` — Márgenes (mm) | JSON |  | {top,right,bottom,left} |
| `cover` — Portada | opción |  | opciones: `band`, `none`, `full`, `minimal`, `split` |
| `header_text` — Cabecera | texto |  | por defecto "{{brand}} · {{title}}" |
| `footer_text` — Pie de página | texto |  | por defecto "{{confidentiality}} · {{date}}" |
| `page_numbers` — Numerar páginas | sí/no |  | por defecto 1 |
| `heading_numbering` — Numerar títulos | sí/no |  | por defecto 0 |
| `watermark` — Marca de agua | texto |  | e.g. DRAFT; empty = none |
| `confidentiality` — Confidencialidad | texto |  | por defecto "Confidencial" |
| `legal_footer` — Texto legal | texto largo |  |  |
| `custom_css` — CSS personalizado | texto largo |  | appended to the generated stylesheet (HTML/PDF) |
| `is_default` — Por defecto | sí/no |  | por defecto 0 |

#### `doc_templates` — Plantilla de documento (Plantillas de documento)
Módulo `prod`. Título: `name`. Orden: `name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `type` — Tipo | opción |  | opciones: `format`, `bible`, `rundown`, `script`, `dossier`, `audience`, `target`, `competitor`, `production`, `marketing`, `report`, `contract`, `callsheet`, `budget`, `delivery`, `minutes`, `other` |
| `language` — Idioma | opción |  | opciones: `es`, `ca`, `en` |
| `description` — Descripción | texto |  |  |
| `brand_id` — Marca / identidad | referencia |  | → `brands` |
| `body` — Contenido de la plantilla | texto largo |  | Markdown + {{variables}} + data blocks |
| `variables` — Variables | JSON |  | [{key,label,type,default}] shown as a form when generating |
| `options` — Opciones | JSON |  | layout overrides |
| `builtin` (solo lectura) — De fábrica | sí/no |  | por defecto 0 |
| `key` (solo lectura) — Clave | texto |  |  |

#### `exports` — Exportación (Exportaciones)
Módulo `prod` · ámbito de programa: `program_id` · sin historial. Título: `name`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `name` — Nombre | texto | sí |  |
| `format` — Formato | texto |  |  |
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `document_id` — Documento | referencia |  | → `documents` |
| `attachment_id` — Adjunto | entero |  |  |
| `bytes` — Tamaño | entero |  |  |
| `notes` — Notas | texto |  |  |

### Grupo: Agente

#### `jobs` — Generación (Generaciones del agente)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id` · sin historial. Título: `kind`. Orden: `-created`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `kind` — Tipo de encargo | texto | sí |  |
| `prompt` — Encargo | texto largo |  |  |
| `extra` — Extra | texto largo |  |  |
| `status` — Estado | opción |  | opciones: `queued`, `running`, `done`, `failed`, `cancelled` |
| `output` (solo lectura) — Resultado | texto largo |  |  |
| `document_id` (solo lectura) — Documento | referencia |  | → `documents` |
| `error` (solo lectura) — Error | texto largo |  |  |
| `finished` (solo lectura) — Terminado | fecha y hora |  |  |
| `by` (solo lectura) — Lanzado por | texto |  |  |

### Grupo: Memorias

#### `media_items` — Imagen (Galería de imágenes)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `title`. Orden: `-featured,position,-id`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `episode_id` — Episodio | referencia |  | → `episodes` |
| `title` — Título | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `photo`, `still`, `behind_scenes`, `graphic`, `screenshot`, `press`, `logo`, `document`, `other` |
| `phase` — Fase | opción |  | opciones: `shoot`, `development`, `preproduction`, `post`, `delivery`, `broadcast`, `promotion`, `other` |
| `caption` — Pie de foto | texto largo |  | caption printed under the image |
| `alt_text` — Texto alternativo | texto |  | describes the image for screen readers |
| `credit` — Autoría | texto |  | author / photographer |
| `shot_date` — Fecha de la toma | fecha |  |  |
| `location_id` — Localización | referencia |  | → `locations` |
| `people` — Personas que aparecen | texto |  | who appears |
| `rights` — Derechos de uso | opción |  | opciones: `owned`, `licensed`, `release_pending`, `restricted` |
| `rights_note` — Nota de derechos | texto |  |  |
| `tags` — Etiquetas | etiquetas |  |  |
| `featured` — Destacada | sí/no |  | por defecto 0 |
| `position` — Posición | entero |  | por defecto 0 |
| `attachment_id` (solo lectura) — Adjunto | entero |  | the image file (attachment of this row) |
| `width` (solo lectura) — Ancho (px) | entero |  |  |
| `height` (solo lectura) — Alto (px) | entero |  |  |
| `origin` (solo lectura) — Origen | opción |  | opciones: `upload`, `agent`, `generated` |
| `spec` — Especificación del gráfico | JSON |  | graphic spec, when the image was generated |

#### `locations` — Localización (Localizaciones)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `name`. Orden: `program_id,name`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `name` — Nombre | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `exterior`, `studio`, `interior`, `remote`, `other` |
| `address` — Dirección | texto |  |  |
| `city` — Ciudad | texto |  |  |
| `country` — País | texto |  |  |
| `lat` — Latitud | decimal |  | mín -90 · máx 90 |
| `lng` — Longitud | decimal |  | mín -180 · máx 180 |
| `date_from` — Desde | fecha |  |  |
| `date_to` — Hasta | fecha |  |  |
| `shoot_days` — Días de rodaje | entero |  | mín 0 |
| `description` — Descripción | texto largo |  |  |
| `permit` — Permiso | texto |  | permit or authorisation |
| `contact` — Contacto | texto |  |  |

#### `memoirs` — Memoria (Memorias de proyecto)
Módulo `prod` · ámbito de programa: `program_id` · padre: `program_id`. Título: `title`. Orden: `-updated`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia | sí | → `programs` (borrado en cascada) |
| `season_id` — Temporada | referencia |  | → `seasons` |
| `title` — Título | texto | sí |  |
| `kind` — Tipo | opción |  | opciones: `subsidy`, `annual`, `client`, `season_close`, `festival`, `internal` |
| `language` — Idioma | opción |  | opciones: `es`, `ca`, `en` |
| `status` — Estado | opción |  | opciones: `draft`, `writing`, `review`, `approved`, `delivered` |
| `period_start` — Inicio del periodo | fecha |  |  |
| `period_end` — Fin del periodo | fecha |  |  |
| `funder` — Destinatario o financiador | texto |  | who receives it (funder, broadcaster, client) |
| `funder_ref` — Referencia del expediente | texto |  | file or call reference |
| `audience_note` — Quién la lee | texto |  | who reads it and what they look for |
| `tone` — Tono | opción |  | opciones: `institutional`, `narrative`, `technical` |
| `brief` — Instrucciones | texto largo |  | instructions for whoever writes it (person or agent) |
| `brand_id` — Marca / identidad | referencia |  | → `brands` |
| `cover_media_id` — Imagen de portada | referencia |  | → `media_items` |
| `document_id` (solo lectura) — Documento | referencia |  | → `documents` |
| `built_at` (solo lectura) — Generada el | fecha y hora |  |  |

#### `memoir_sections` — Sección de memoria (Secciones de memoria)
Módulo `prod` · ámbito de programa: `program_id` · padre: `memoir_id` · oculta en el menú. Título: `title`. Orden: `memoir_id,position`.

| Campo | Tipo | Obligatorio | Detalles |
|---|---|---|---|
| `program_id` — Programa | referencia |  | → `programs` (borrado en cascada) |
| `memoir_id` — Memoria | referencia | sí | → `memoirs` (borrado en cascada) |
| `key` — Clave | texto | sí |  |
| `title` — Título | texto |  |  |
| `position` — Posición | entero |  | por defecto 0 |
| `status` — Estado | opción |  | opciones: `empty`, `draft`, `review`, `approved`, `skipped` |
| `body` — Texto | texto largo |  | Collado Markdown |
| `fields` — Campos estructurados | JSON |  | structured fields of the section (see the catalogue) |
| `media_ids` — Imágenes | JSON |  | gallery images of the section |
| `visuals` — Gráficos | JSON |  | graphics of the section: [{type, ...spec}] |
| `agent_brief` — Encargo al agente | texto largo |  |  |
| `notes` — Notas | texto largo |  |  |
| `author` — Autor | texto |  |  |
| `origin` — Origen | opción |  | opciones: `human`, `agent` |
