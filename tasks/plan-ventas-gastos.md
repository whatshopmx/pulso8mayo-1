# Implementation Plan: Módulos Financieros v2 — Ventas/POS (M13) + Pagos y Gastos (M16)

> **Continuación de** `tasks/plan-grupo-restaurantero.md` (Fases 1-8, gaps v1).
> **Fuente:** `docs/pulso-diseno-grupo-restaurantero.md` v2 — Secciones 4 (M13, M16), 15, 19.
> **Baseline del gap analysis:** 2026-08-04. M13 = 0%, M16 = 0%. Son el denominador de todos los KPIs financieros (food-cost %, labor %, P&L, flujo de efectivo).

## Overview

Implementar los dos módulos financieros fundacionales del diseño v2:

- **M13 (Ventas y POS):** ingesta del corte de ventas diario por archivo (upload manual + adjunto WhatsApp), plantillas de mapeo de columnas por tipo de POS, integración al workflow de cierre con recordatorio/escalación, y los KPIs derivados: venta por sucursal/turno/canal, ticket promedio, **costo de alimentos como % de venta** y **costo laboral como % de venta**.
- **M16 (Pagos y Gastos):** caja chica por sucursal (fondo fijo, salidas con evidencia, reposición), gastos operativos por categoría, autorización por niveles de monto, calendario de flujo de efectivo consolidado, y **P&L estimado por sucursal**.

Decisión de alcance: el diseño especifica 3 canales de ingesta para M13 (WhatsApp, buzón de correo CC, upload manual). Este plan cubre **upload manual + WhatsApp**. El buzón de correo requiere infra de inbound email (ver Open Questions) y se difiere.

## Architecture Decisions

1. **Dinero en centavos (integer)** — consistente con el schema existente (`invoices.subtotal`, `sales_entries.total_revenue`). Nunca floats.
2. **Multi-tenant estricto** — toda tabla con `companyId` + `branchId`, todo endpoint con `requireTenant()` (patrón de `lib/tenant-context.ts`).
3. **Parseo con `exceljs`** — ya es dependencia del proyecto (v4.4.0); maneja XLSX y CSV. No se agregan dependencias.
4. **Esquema canónico + diccionario de alias + mapeo configurable, no parsers hardcodeados** — El mercado de POS en México está fragmentado (Soft Restaurant, NCR Aloha, Oracle Simphony, Poster, Square, Aspel CAJA, Eleventa, SICAR…), así que no existe "el formato de corte". Pulso define: (a) un **esquema canónico** de campos que le interesan (ver T25), (b) un **diccionario de alias** con las variantes de nombre de columna que usa cada POS (`lib/services/pos-column-aliases.ts` como archivo de datos, crece con cada cliente), y (c) tabla `pos_mapping_templates` con JSONB de mapeo columna-POS → campo-canónico. Al subir un archivo de ejemplo, el sistema **auto-detecta columnas por alias** (normalizando acentos/mayúsculas) y propone el mapeo con nivel de confianza; el usuario confirma o ajusta en la UI. La "librería de parsers" del diseño se acumula como plantillas, no como código.
5. **Soporte de 4 formas de archivo (file shapes)** — Los cortes reales vienen en estructuras distintas: `summary` (llave:valor, típico corte de caja), `payment_summary` (tabla forma-de-pago → importe), `ticket_detail` (un renglón por ticket → agregar por suma/conteo/agrupación), y `multi_sheet` (Excel con hoja resumen + detalle). El servicio de ingesta detecta la forma y agrega cuando aplica — nunca exige al cliente "exportar en formato Pulso".
6. **Validación de cortes al ingestar** — totales razonables, formas de pago esperadas, fecha coherente, duplicados por (sucursal, fecha, turno). Rechazo con motivo explícito, nunca silencioso (patrón del upload de facturas en `app/api/inventory/invoices/upload/route.ts`).
6. **Aprobaciones de gastos: tabla nueva, no reusar `shift_approvals`** — dominios distintos (laboral vs financiero). Se sigue el mismo patrón de servicio (`ShiftApprovalService` → `ExpenseApprovalService`) y se reutiliza el motor de escalamiento de `notification-dispatcher.ts`.
7. **P&L y flujo de efectivo son servicios de lectura agregada** — no tablas materializadas. Fuentes: `daily_sales_cuts` + consumo teórico (`theoretical-consumption-service`) + costo laboral (`labor-calculator`) + `operating_expenses` + `invoices` (cuentas por pagar). Caching con `unstable_cache` (patrón de `cross-branch-service`).
8. **Notificaciones nuevas vía NotificationDispatcher** — nuevos event types: `SALES_CUT_MISSING`, `SALES_CUT_RECEIVED`, `EXPENSE_PENDING_APPROVAL`, `PETTY_CASH_LOW`. Templates en español, canales WhatsApp + in-app.
9. **Crons en Inngest** (no QStash — dirección actual del proyecto): `cron-sales-cut-reminder` (post-horario de cierre) y `cron-petty-cash-check` (diario).
10. **Nav:** nueva sección "Finanzas" en `components/app-sidebar.tsx` (Ventas, Caja Chica, Gastos, Flujo de Efectivo, P&L).

## Task List

### Phase 9: M13 — Ventas y POS

- [ ] T24: Schema de ventas (`daily_sales_cuts`, `pos_mapping_templates`) + migración
- [ ] T25: Servicio de ingesta de cortes (parseo + mapeo + validación)
- [ ] T26: Upload manual: API + UI (primer slice vertical funcional)
- [ ] T27: Configuración de plantillas de mapeo POS (API + UI)
- [ ] T28: Dashboard de ventas (sucursal/turno/canal, ticket promedio)
- [ ] T29: KPIs financieros: food-cost % y labor % de venta + alertas de desviación

**Checkpoint H** — upload manual funciona end-to-end, dashboard muestra cortes reales, KPIs calculan.

- [ ] T30: WhatsApp: recepción de documento (CSV/XLSX) + formulario fallback de corte
- [ ] T31: Integración al workflow de cierre + cron recordatorio/escalación

**Checkpoint I** — corte recibido por WhatsApp cierra el paso del workflow; si no llega, escala.

### Phase 10: M16 — Pagos y Gastos

- [ ] T32: Schema de gastos (`petty_cash_funds`, `petty_cash_transactions`, `operating_expenses`, `expense_authorization_rules`) + migración
- [ ] T33: Caja chica: servicio + API + UI (fondo, salidas con evidencia, saldo)
- [ ] T34: Reposición de caja chica: alerta de umbral + cron
- [ ] T35: Gastos operativos: servicio + API + UI por categoría
- [ ] T36: Autorización de gastos por niveles de monto (aprobaciones + notificaciones)

**Checkpoint J** — caja chica y gastos operan end-to-end con autorización por monto.

- [ ] T37: Flujo de efectivo consolidado (calendario: CxP + gastos + nómina)
- [ ] T38: P&L estimado por sucursal (servicio + widget en dashboard ejecutivo)

**Checkpoint K** — flujo de efectivo y P&L visibles con datos reales; KPIs financieros del dashboard ejecutivo (Sección 19 del diseño) completos.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Formatos de corte POS muy diversos | Alto | Mapeo configurable por tenant (Decisión 4); empezar con 1-2 POS reales del cliente piloto; validación estricta con errores accionables |
| WasenderAPI no soporta recepción de documentos (CSV/XLSX), solo imágenes | Medio | Verificar en T30 con spike de 1 hora antes de comprometer el diseño; fallback: foto del corte + OCR (ya existe capacidad OCR en evidence-processor) o upload manual |
| `db:push` puede dropear tablas | Alto | Usar `pnpm db:generate` + migraciones; nunca `db:push` sin verificar `.env` |
| P&L con datos incompletos da números engañosos | Medio | El widget muestra cobertura de datos ("basado en 18/30 días de ventas, gastos al 70% de categorías"); nunca un número sin contexto |
| Scope creep hacia M14/M15/M17 | Medio | M14 (canales delivery) se habilita gratis si el corte trae forma de pago por agregador — capturar `paymentMethod` en el schema, pero sin conciliación de comisiones (eso es M14, fuera de scope) |

## Open Questions

- [ ] **Q1:** ¿Buzón de correo CC (`ventas-[sucursal]@pulso.mx`) en esta fase? Requiere inbound email (Resend inbound o MX propio). **Recomendación: diferir a fase posterior; upload + WhatsApp cubren el 80% del valor.**
- [x] **Q2 (resuelta 2026-08-04):** No hay cortes de ejemplo reales; el mercado POS mexicano está fragmentado. → Se implementa esquema canónico + diccionario de alias + auto-detección con confirmación del usuario (Decisiones 4-5). Las plantillas por POS específico se acumulan con cada cliente nuevo, empezando por una plantilla "genérica".
- [ ] **Q3:** ¿Caja chica requiere desglose por denominaciones de efectivo o solo monto + evidencia? **Recomendación: monto + foto de ticket (simple, sustituye la libreta).**
- [ ] **Q4:** ¿P&L con IVA o sin IVA? **Recomendación: sin IVA (visión operativa, no fiscal).**
- [ ] **Q5:** ¿El formulario fallback de WhatsApp (venta total, efectivo/tarjeta, tickets) vive dentro del workflow de cierre o como conversación independiente? **Recomendación: dentro del cierre (paso dedicado), consistente con el diseño.**

## Parallelization Opportunities

- **T24-T29 (M13 core)** y **T32-T36 (M16 core)** son independientes entre sí → 2 agentes en paralelo.
- T30-T31 (WhatsApp/cierre) requieren T25-T26 terminados (contrato del servicio de ingesta).
- T37-T38 (flujo/P&L) requieren T28 + T35 (fuentes de datos completas).
- Migraciones de schema (T24, T32) deben correr secuencialmente aunque el código sea paralelo.

## Estimated Total

15 tareas (T24-T38): ~4 S, ~9 M, ~2 L. Comparable a las fases 1-3 del plan anterior combinadas.
