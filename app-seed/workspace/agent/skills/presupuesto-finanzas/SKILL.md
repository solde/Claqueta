---
name: collado-presupuesto-finanzas
description: Presupuestos de producción audiovisual por capítulos y partidas, versiones, coste previsto vs real, desviaciones, órdenes de compra, facturas de proveedores, facturación a cadenas, cashflow, IVA y retenciones, subvenciones, rentabilidad y exportación a contabilidad (Odoo). Úsala para cualquier cuestión de dinero de un programa.
---
# Presupuesto y finanzas de producción

## Estructura de un presupuesto (capítulos típicos de televisión)
Desarrollo · Guion/redacción · Personal artístico (presentadores, colaboradores, invitados) · Equipo técnico y de producción · Estudios/platós · Equipos y unidades móviles · Localizaciones/exteriores · Postproducción (montaje, grafismo, sonido) · Música, archivo y derechos · Seguros · Viajes y dietas · Promoción · Gastos generales · **Imprevistos** (porcentaje explícito; 5-10 % es habitual, justifícalo).
Cada **partida**: código, concepto, **cantidad × unidad × coste unitario**, IVA, y cuenta contable si se exporta a Odoo. Presupuesta por **episodio** (líneas con `episode_id`) lo específico y deja lo común como «general» (la app lo reparte entre episodios).

## Reglas
- Las tarifas y costes unitarios los pone la persona o salen de contratos/tarifarios del equipo: **si no las tienes, deja la partida con hipótesis marcada o pide el dato**; no inventes tarifas ni convenios.
- Un presupuesto **aprobado se bloquea**: los cambios van en una **nueva versión** (`collado-api action budget-version '{"budget_id":N}'`). Aprobar requiere el permiso `fin.approve`: tú propones, la persona aprueba.
- Moneda: euros (decimales con punto en la API). Todo importe sin IVA salvo que se diga.
- Siempre muestra: total sin IVA, IVA, total, coste por episodio y por minuto, y qué porcentaje es personal, técnica, derechos y general.

## Seguimiento (previsto · comprometido · real)
- **Comprometido** = órdenes de compra aprobadas aún no facturadas. **Real** = facturas/gastos aprobados o pagados contra la partida. `collado-api report budget budget=N` devuelve por capítulo/partida previsto, comprometido, real, desviación y % usado; `report episode-variance program=N` lo reparte por episodio.
- Alertas: ≥90 % de ejecución es aviso, >100 % es grave. Cuando haya desviación, explica **causa, impacto en el margen y opciones** (reasignar partida, nueva versión, renegociar, recortar alcance).

## Compras y gastos
Flujo: orden de compra (`draft → pending → approved`) → factura de proveedor (`pending → approved → paid`) enlazada a partida y episodio. El IVA y la retención IRPF se calculan solos (`base`, `vat_rate`, `irpf_rate`). Para freelance con retención, registra la tasa que indique la asesoría (no supongas el tipo).

## Facturación a la cadena / cliente
`client_invoices` (borrador → emitida con número automático → cobrada parcial/total con `payments`), plan de facturación (`billing_plan`) por hitos o por entrega/emisión. Conciliación bancaria: `action import-bank` con CSV y `suggest-matches`/`match-movement`.

## Tesorería
`report cashflow program=N months=6 forecast=1`: cobros (facturas pendientes por vencimiento, plan de facturación, subvenciones) frente a pagos (facturas por vencimiento, órdenes de compra aprobadas y, con `forecast`, el presupuesto aún no ejecutado). Señala **meses con saldo negativo** y propón acciones (adelantar facturación, retrasar pagos dentro de plazo, línea de financiación).

## IVA y retenciones
`report tax year=2026 quarter=Q1` resume IVA repercutido/soportado y retenciones practicadas por perceptor. Es **informativo**: la declaración la presenta la gestoría; recomienda siempre validarlo con ella. Los tipos aplicables dependen del caso (consúltalo): no los des por buenos.

## Subvenciones
Registra solicitud, resolución, importe concedido, plazos de **justificación** (genera alerta) y calendario de cobro (`installments` alimenta el cashflow). Guarda en `eligible_notes` los gastos elegibles de las bases.

## Rentabilidad
`report profitability`: ingresos previstos (contrato + patrocinios firmados + subvenciones concedidas) menos coste previsto (máx. presupuesto y real+comprometido) → margen previsto y margen a fecha. Explica supuestos.

## Entregables habituales
- Presupuesto formal: plantilla `budget` (PDF/Word con portada) + Excel (`collado-doc xlsx --source budget --param budget=N --param lines=1`).
- Informe de desviación: plantilla `variance`.
- Exportación contable: `GET /api/export/odoo-bills` y `odoo-invoices` (ajusta cuentas/impuestos en Ajustes → Finanzas).
