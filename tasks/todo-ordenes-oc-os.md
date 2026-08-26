# TODO: Sistema de Control OC/OS

Plan completo: `tasks/plan-ordenes-oc-os.md`

## Decisiones (2026-08-25)

- Matrices de autorización **coexisten en tres capas**: `approvalMatrixRules` (OC/OS, multi-nivel) · `expenseAuthorizationRules` + umbrales del operating-config vía `rolExigidoPorMonto()` (gastos sueltos) · OC/OS no lee esos umbrales ni A16.
- **Tope de emergencias** en `tenant_operating_config.emergencyPurchaseCapCents`, editable desde `app/dashboard/company/operating-config` (UI existente de umbrales).
- Tesorería/corridas de pago **delegadas a plan-payees**; este plan solo deja hook de expectativa de pago.
- Contratos recurrentes y domiciliados entran a este plan como **Phase 6**.
- KPIs de control leen metas de `tenant_operating_config` (targets food/labor/margin ya configurables).

## Phase 1: Fundaciones (datos)

- [x] Task 1: Esquema OS + matriz autorización + centros costo + presupuestos (`lib/db/schema/service-orders.ts`, migraciones `0061`/`0062` aplicadas, commiteado)
- [x] Task 2: Generador de folios transaccional `OC/OS-[SUC]-[AÑO]-[N]` + auditoría de gaps (`lib/services/folio-generator.ts`, concurrencia verificada 8/8 únicos)

## Checkpoint: Foundation

- [x] Migraciones aplicadas, build verde, tests unitarios OK

## Phase 2: Servicios de negocio

- [x] Task 3: Servicio matriz de autorización con seed default y niveles secuenciales (denegaciones ROLE/SELF/nivel-no-actual)
- [x] Task 4: Servicio presupuesto + tope emergencias en `emergencyPurchaseCapCents` (operating-config UI/API incluidos)

## Checkpoint: Business Logic

- [x] Tests unitarios matrix + budget pasan (25 nuevos, suite 317 OK)

## Phase 3: APIs

- [x] Task 5a: API service-orders CRUD + submit (valida cotizaciones/presupuesto) — commit `7aa9b80`: `lib/services/service-order-service.ts` + `app/api/service-orders/{route,[id]/route,[id]/submit/route}.ts`; submit en 1 tx (cadena→cotizaciones→presupuesto/emergencias→folio real→approvals→PENDING_APPROVAL); submit concurrente sin gap de folio
- [x] Task 5b: API quotes/evidence/conformity + transiciones (schedule/start/complete/cancel) — commit `41bcae3`; conformity GERENTE+ solo en PENDING_CONFORMITY → CLOSED
- [x] Task 6: APIs approval-requests (⚠️ `approvals/` ya existe para turnos RH — usar `approval-requests/`), approval-matrix, cost-centers, budgets + integración OC (purchaseType, centro costo, nuevo folio) — commit `95d1c2c`: bandeja actionable con presupuesto restante; OC submit pasa por matriz/presupuesto y emite folio real en tx

## Checkpoint: APIs

- [x] Flujo end-to-end via API verificado contra dev server (OS→submit→aprobaciones multi-nivel→conformidad→CLOSED; OC nueva con folio `OC-CDMX01-2026-0001`; findFolioGaps sin huecos)

## Phase 4: UI

- [x] Task 7: Páginas service-orders (lista + detalle con timeline y evidencias) — commit `9f83b59`: sección 'Control' en sidebar; acciones estado×rol; upload R2 evidencias/cotizaciones
- [x] Task 8: Bandeja de aprobaciones + admin de matriz de autorización — **entregado por R4/R5 de la Phase 4-bis** (commit `6fd6403`), como tabs de Finanzas › Control Interno en vez de `company/approval-matrix`: la ubicación original se descartó al reintegrar superficies
- [x] Task 9: UI presupuestos y centros de costo con consumo vs presupuestado — commit `b44f598`: `app/dashboard/budgets/page.tsx` (grid mensual sucursales×centros, captura ADMIN+, barra de consumo, alerta ≥90%) + `hooks/queries/use-budgets.ts` + entrada "Presupuestos" en sidebar Finanzas

## Phase 4-bis: Re-integración de superficies (decisión usuario 2026-08-25)

> OS bajo **Equipos › Servicios Normativos** · control gerencial bajo **Finanzas › Control Interno**. Sin sección "Control" suelta.

- [x] R1: Mover UI OS a `equipment/compliance/service-orders` + sidebar Equipos + eliminar sección "Control" — commit `git mv` por archivo (el dir estaba lockeado por dev server); hrefs internos actualizados; sin sección "Control"
- [x] R2: API: crear/filtrar por `complianceServiceId` — zod ya lo aceptaba; se agregó filtro en `listOrders`, validación FK contra empresa en create/update (400 accionable, antes 500) y query param en GET + hook
- [x] R3: Botón "Generar OS" pre-llenado y enlace "Ver OS" en cada servicio normativo — `components/service-orders/create-order-dialog.tsx` compartido (estado derivado, sin useEffect); lista soporta `?complianceServiceId=` con badge para quitar filtro. Verificado e2e: crear OS vinculada 201, filtro OK, FK foránea 400, rutas 200/404 correctas
- [x] R4: Bandeja "Autorizaciones" como tab de Control Interno (aprobación/rechazo con motivo, presupuesto restante) — commit `6fd6403`: `components/service-orders/approval-inbox.tsx` + `useApprovalInbox()`; badge de pendientes en el tab (misma query react-query → un solo fetch); barra de presupuesto ámbar ≥90%; cap emergencias mostrado; e2e: approve→documentFinalized→OS APPROVED→bandeja vacía
- [x] R5: Editor "Matriz de Autorización" como tab de Control Interno (solo ADMIN+, warnings de huecos) — commit `6fd6403`: `components/service-orders/approval-matrix-editor.tsx` con patrón borrador derivado; toggle OS/OC; errores inline del PUT y huecos como avisos; verificado traslape misma-secuencia→400, multi-nivel acumulativo→200 sin warnings, hueco→200 con warning; matriz demo restaurada

## Phase 5: KPIs y automatización

- [x] Task 10: Dashboard KPIs gerenciales — rama `feat/oc-os-task10-kpis`, tres commits incrementales (`1f00cf6`, `2f35c37`, `677e480`): `lib/services/control-kpi-types.ts` (contrato puro, 32 tests) + `control-kpi-service.ts` + `GET /api/reports/control` (GERENTE+) + `app/dashboard/reports/control/page.tsx` + entrada "Control Gerencial" en sidebar Finanzas
  - [x] Presupuesto vs. ejecutado por partida y desviación presupuestal (§7, §E)
  - [x] % de compras de emergencia contra meta <5% (§7)
  - [x] Comparativo de precios del mismo insumo entre sucursales (§7) — promedio ponderado, dispersión contra la sucursal más barata, umbral 5/10%; se apaga si el alcance es una sola sucursal
  - [x] Ranking de proveedores por monto (§7). **Cumplimiento de entrega queda en Phase 7**, donde el plan ya lo tenía
  - [x] Gasto operativo % = Gastos OS / Ventas (§E). SIN semáforo: el documento no fija meta para este KPI y no se inventó una
  - [x] Food cost % real (reutiliza `calculateFinancialKPIs`, conserva procedencia MEASURED/DERIVED/NO_DATA)
  - [ ] Food cost % **teórico**: BLOQUEADO por datos, no por código. Exige venta a nivel platillo en `sales_entries` y la ingesta de POS solo llena `daily_sales_cuts` con totales por turno (1 fila en toda la tabla). Se expone como `NO_DATA` con nota que nombra el dato faltante; la brecha real−teórico queda en `—`. Desbloquea: ingesta de POS a nivel platillo → cierra open question #3
- [ ] Task 11: Job Inngest mensual (desviaciones, folios gap, contratos por vencer, domiciliados conciliados, alertas vía NotificationDispatcher)

## Phase 6: Contratos y gastos recurrentes (nueva)

- [ ] Task 12: Tabla supplierContracts (vigencia, escalación INPC, método pago, partida) — migración sin drops
- [ ] Task 13: Servicio+API contratos; conciliación factura-vs-contrato (>10% → investigación); alerta renovación 90 días
- [ ] Task 14: Lista maestra de domiciliados + conciliación mensual cargo esperado vs real + suscripciones huérfanas
- [ ] Task 15: UI contratos (badges vigencia, calendario de cargos)

## Phase 7: KPIs extendidos (amplía Task 10)

- [ ] Cumplimiento proveedor (entregas a tiempo), días de inventario, % egresos sin documento (<2%), % correctivo vs preventivo (<40%), contratos vencidos (0)
- [ ] Excluido: comparativo kWh (requiere módulo de captura energética — futuro)

## Checkpoint: Complete

- [ ] `pnpm run build && pnpm run lint` verdes
- [ ] Recorrido manual end-to-end OK
