---
name: collado-app
description: Cómo leer y escribir datos de Collado (programas, temporadas, episodios, escaletas, tareas, hitos, presupuestos, gastos, facturas, contratos, derechos, material, QC, entregas, emisiones, audiencias, comentarios, aprobaciones…) con collado-api; filtros, informes, acciones, permisos y recetas. Úsala siempre que tengas que consultar o modificar datos de la app.
---
# Trabajar con los datos de Collado (`collado-api`)

Actúas con **los permisos de tu persona** (token en `~/.collado/token`, caduca a las 24 h: si da 401, hay que reabrir la consola). Ejecuta `collado-api` sin argumentos para ver la ayuda.

## Descubrir
- `collado-api schema` → entidades; `collado-api schema episodes` → campos, tipos (`text, long, int, num, pct, money, bool, date, datetime, time, enum, ref, json, tags, secret`), opciones de enums, referencias (`-> programs`), solo lectura.
- Los **valores de enum son códigos en inglés** (`status: "in_progress"`); las **referencias son ids** (`program_id: 3`); el dinero va en **euros** (`1200.5`); fechas `YYYY-MM-DD`, horas `HH:MM`, fecha y hora `YYYY-MM-DDTHH:MM`.
- `collado-api search "texto"` busca en todo lo que puedes ver.

## Leer
`collado-api list episodes program_id=3 status=in:planned|script sort=number limit=50` · filtros: `campo=valor`, `campo=in:a|b`, `campo=>=2026-02-01`, `campo=<=…`, `campo=!=x`, `campo=~texto` (contiene), `campo=null|notnull`; `q=texto` busca; `sort=-fecha`; `limit`/`offset`. `collado-api get episodes 12` devuelve la fila y las etiquetas de sus referencias. `history <entidad> <id>` = quién cambió qué.

## Escribir
`collado-api create tasks '{"program_id":3,"title":"Cerrar contrato","assignee":"marta","due":"2026-02-10","priority":"high"}'` · para JSON largo usa `@fichero.json` o `-` (stdin) y evita problemas de comillas · `batch <entidad> '[{…},{…}]'` (hasta 500) · `update <entidad> <id> '{"status":"done","rev":3}'` (con `rev` detectas ediciones concurrentes: 409 `stale`) · `delete <entidad> <id>` (409 `in_use` si tiene datos relacionados: archívalo cambiando el estado).
Errores claros: `required:campo`, `invalid_option:campo` (te muestra las opciones), `invalid_ref`, `field_forbidden:campo`, `needs:fin.approve`, `budget_locked`.

## Entidades principales (módulo · permiso)
Programas: `programs, seasons, episodes, milestones, tasks, rundown_items, risks, members` (app.view/edit) · Directorio: `partners, people` (datos sensibles: `people.view`), `resources, bookings, availability, crew_assignments, timesheets, agreements` · Finanzas (`fin.view/edit`; aprobar: `fin.approve`): `budgets, budget_lines, purchase_orders, bills, client_invoices, payments, billing_plan, bank_movements, grants, rate_cards, sponsorships, ad_spots, placements` · Legal (`legal.view/edit`): `contracts, rights, cue_sheets, cue_items, processing_activities, consents, dsr_requests, retention_policies` · Material y calidad: `assets, delivery_specs, qc_reports, qc_issues, deliveries, editorial_lines, compliance_checks` · Emisión: `broadcasts, ratings, targets, competitors` · Documentos: `documents, doc_templates, brands, exports` · Colaboración: `comments, approvals, notifications`.

## Informes y acciones
`report`: `budget budget=ID`, `episode-variance program=ID`, `cashflow program=ID months=6 forecast=1`, `tax year=2026 quarter=Q1`, `profitability`, `conflicts from= to= program=`, `check-slot resource_id=|person_id= start= end=`, `timesheets from= to=`, `rundown episode=ID`, `gantt program=ID`, `ratings program=ID`, `rights-check episode=ID`, `delivery-readiness episode=ID`. Y `alerts [program=ID]`, `dashboard [program=ID]`.
`action`: `apply-template {program_id}`, `budget-version {budget_id}`, `clone-budget`, `init-compliance {episode_id}`, `plan-episode {episode_id}`, `reorder-rundown {episode_id, ids}`, `copy-rundown {from_episode_id,to_episode_id}`, `import-ratings {csv, program_id, dry}`, `import-bank {csv, dry}`, `suggest-matches {movement_id}`, `match-movement {movement_id, entity, id}`, `invoice-ad-spots {sponsorship_id}`, `queue-job {program_id, kind, instructions}`.

## Reglas de negocio que debes conocer
- Importes calculados (`amount`, `vat`, `total`, `subtotal`, horas extra…) los calcula la app: no los envíes.
- **Presupuesto aprobado = bloqueado** (nueva versión). **Aprobaciones** de presupuestos, órdenes de compra y facturas de proveedor requieren `fin.approve`.
- Facturas emitidas no se editan (se anulan); las órdenes de compra y facturas pagadas no se borran.
- Los campos secretos (DNI, IBAN, datos privados) solo aparecen con el permiso correspondiente; no los copies fuera.
- Cada cambio queda en el historial con tu usuario.

## Recetas
- *Alta de episodios*: `batch episodes '[{"program_id":3,"season_id":1,"number":7,"title":"…","air_date":"2026-03-02"}]'` → `action plan-episode` por cada uno.
- *Estado semanal*: `dashboard program=3` + `alerts program=3` + `report gantt program=3` → documento `weekly-status`.
- *¿Se puede emitir el E4?*: `report delivery-readiness episode=…` + `report rights-check` + `compliance_checks` abiertos.
- *Dónde está cada cosa para la persona*: enlaces `#/p/ID/money`, `#/e/entidad/ID`, `#/doc/ID`, `#/rundown/ID`.
