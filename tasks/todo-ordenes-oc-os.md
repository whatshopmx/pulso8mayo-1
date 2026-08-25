# TODO: Sistema de Control OC/OS

Plan completo: `tasks/plan-ordenes-oc-os.md`

## Decisiones (2026-08-25)

- Matrices de autorización **coexisten separadas**: `approvalMatrixRules` (OC/OS, multi-nivel) vs `expenseAuthorizationRules` (gastos sueltos).
- Tesorería/corridas de pago **delegadas a plan-payees**; este plan solo deja hook de expectativa de pago.
- Contratos recurrentes y domiciliados entran a este plan como **Phase 6**.

## Phase 1: Fundaciones (datos)

- [x] Task 1: Esquema OS + matriz autorización + centros costo + presupuestos (`lib/db/schema/service-orders.ts`, migración `0061` sin drops)
- [ ] Task 2: Generador de folios transaccional `OC/OS-[SUC]-[AÑO]-[N]` + auditoría de gaps (`lib/services/folio-generator.ts`)

## Checkpoint: Foundation

- [ ] Migración aplicada, build verde

## Phase 2: Servicios de negocio

- [ ] Task 3: Servicio matriz de autorización con seed default y niveles secuenciales (paralelizable con Task 4)
- [ ] Task 4: Servicio presupuesto (disponibilidad por partida/mes) + tope emergencias mensual (paralelizable con Task 3)

## Checkpoint: Business Logic

- [ ] Tests unitarios matrix + budget pasan

## Phase 3: APIs

- [ ] Task 5a: API service-orders CRUD + submit (valida cotizaciones/presupuesto)
- [ ] Task 5b: API service-orders quotes/evidence/conformity
- [ ] Task 6: APIs approval-requests (⚠️ `approvals/` ya existe para turnos RH — usar `approval-requests/`), approval-matrix, cost-centers, budgets + integración OC (purchaseType, centro costo, nuevo folio)

## Checkpoint: APIs

- [ ] Flujo end-to-end via API: OS→submit→aprobaciones→conformidad→CLOSED; OC nueva con folio nuevo

## Phase 4: UI

- [ ] Task 7: Páginas service-orders (lista + detalle con timeline y evidencias)
- [ ] Task 8: Bandeja de aprobaciones + admin de matriz de autorización
- [ ] Task 9: UI presupuestos y centros de costo con consumo vs presupuestado

## Phase 5: KPIs y automatización

- [ ] Task 10: Dashboard KPIs gerenciales (food cost, gasto operativo, comparativo precios, ranking proveedores, % emergencias, desviación)
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
