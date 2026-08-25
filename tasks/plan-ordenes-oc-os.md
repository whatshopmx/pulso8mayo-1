# Implementation Plan: Sistema de Control OC/OS (Órdenes de Compra y Servicio)

> **Fuente de verdad para continuidad entre sesiones:** `handoffs/oc-os-sistema-control-implementacion-y-pendientes.md` — contexto, implementado, pendientes y gotchas. Este plan y `tasks/todo-ordenes-oc-os.md` se mantienen sincronizados con ella.

## Overview

Implementar el sistema de control documental y financiero descrito en `finzasordenes.md`: Órdenes de Servicio como documento formal independiente, matriz de autorización por monto, centros de costo con presupuesto mensual, folios `OC/OS-[SUCURSAL]-[AÑO]-[CONSECUTIVO]` sin saltos, compras de emergencia con tope mensual, y dashboard de KPIs gerenciales.

## Contexto (lo que ya existe — NO rehacer)

| Concepto | Implementación existente |
|---|---|
| Requisiciones | `requisitions`, `requisitionItems` (lib/db/schema.ts:1010) |
| Órdenes de compra | `purchaseOrders`, `purchaseOrderItems` con enum `purchase_order_status` (schema.ts:1037) |
| Proveedores | `suppliers` + UI `components/inventory/supplier-*` |
| Conciliación 3-way match | `invoices.purchaseOrderId`, `matchedPurchaseOrderId`, `matchTolerancePercent` |
| Recepción | `app/dashboard/inventory/receiving/page.tsx` |
| Mantenimiento equipos | `lib/db/schema/equipment.ts`: `equipmentMaintenanceHistory`, `serviceProviders`, `equipmentMaintenanceSchedules` |
| Roles | enum `role` en lib/db/schema/auth.ts (`OWNER|ADMIN|GERENTE|SUPERVISOR|EMPLEADO|READONLY`) |
| Config de umbrales | `tenantOperatingConfig` (schema.ts:2866) + UI `app/dashboard/company/operating-config/` + `components/company/operating-config-form.tsx`: 7 dimensiones estructurales, `managerAuthLimitCents`, `doubleApprovalThresholdCents`, `pettyCashLimitCents`, targets KPI (food/labor/margin) con defaults en `financial-kpi-types.ts` |
| Política gastos sueltos | `lib/expenses/approval-policy.ts` (A16): segregación de funciones + fallback `rolExigidoPorMonto()` que lee los umbrales del operating-config; usado por `expense-service.ts` (:164, :713) |
| Notificaciones | `NotificationDispatcher` / `NotificationService` (WhatsApp/email/in-app) |
| Dinero | Montos en centavos (integer) — mantener convención |

## Architecture Decisions

1. **OS como módulo independiente** (decisión del usuario): documento financiero/aprobatorio propio; FK opcional a `branch_equipments`. No se integra forzadamente al módulo equipment.
2. **Matriz de autorización configurable en BD** (no hardcodeada): tabla por empresa con rangos de monto → rol aprobador → cotizaciones mínimas. Resolución de cadena al enviar a aprobación.
3. **Presupuesto por sucursal × centro de costo × mes**: validación de disponibilidad en creación/aprobación de OC/OS; alertas de desviación vía job Inngest mensual.
4. **Folios generados por servicio transaccional** (`folio-generator.ts`): consecutivo por empresa+sucursal+tipo+año usando `SELECT ... FOR UPDATE` sobre tabla contador (evita colisiones y saltos). Órdenes legacy conservan su `poNumber`.
5. **Corte vertical**: cada fase entrega un flujo usable end-to-end (schema+migración → servicios → API → UI).
6. **Esquema nuevo en módulo separado** `lib/db/schema/service-orders.ts`, exportado desde `schema/index.ts` y `schema.ts`.
7. **Matrices/umbrales de autorización coexisten en tres capas** (decisión del usuario, refinada tras investigación del operating-config): (a) `approvalMatrixRules` multi-nivel secuencial gobierna OC/OS exclusivamente; (b) gastos operativos sueltos siguen con `expenseAuthorizationRules` (regla explícita) con fallback `rolExigidoPorMonto()` sobre los umbrales de `tenant_operating_config`; (c) OC/OS NO lee esos umbrales ni la política A16 — tiene su propia cadena. No se migra ni unifica nada.
8. **Tope de emergencias vive en `tenant_operating_config`** (no constante ni regla nueva): columna nueva `emergencyPurchaseCapCents`, editable desde el formulario operating-config existente que ya administra los demás umbrales financieros.
8. **Tesorería/corridas de pago fuera de alcance**: delegada al flujo de lotes CLABE de `tasks/plan-payees-contrapartes.md`. Este plan solo deja el hook: OC/OS aprobadas exponen expectativa de pago (payee/supplier, monto, vencimiento).
9. **Lo que ya existe NO se rehace** (investigación 2026-08): caja chica (`pettyCashFunds`/`pettyCashTransactions`), 3-way match con CFDI SAT (`cfdiRecibidos` + conciliación por RFC emisor ±$0.01 en `fiscal-buzon-service.ts`), gastos operativos con autorización (`operatingExpenses`), payees anti-fragmentación, nómina timbrada (`cfdiNominaTimbrados`), recepción con checklist, P&L snapshots.
10. **KPIs leen objetivos del operating-config** (investigación 2026-08-25): el dashboard de control usa `foodCostTargetPercent` etc. de `tenant_operating_config` (defaults `DEFAULT_FINANCIAL_TARGETS`) como metas de las semáforizaciones — no hardcodea metas propias.

## Task List

### Phase 1: Fundaciones (datos)

- [x] **Task 1: Esquema de OS, matriz, centros de costo y presupuesto** ✅ Implementado y verificado en código (2026-08-25): `service-orders.ts` exportado desde schema.ts/index.ts, migración `drizzle/0061_cute_the_captain.sql` con 7 enums + 6 tablas + columnas OC (`purchase_type`, `cost_center_id`, `folio_year`, `folio_sequence`), 0 DROPs. Pendiente: aplicar migración (`db:migrate`) y commit — archivos sin commitear en working tree
  Crear `lib/db/schema/service-orders.ts` con:
  - Enums: `service_order_type` (CORRECTIVO|PREVENTIVO|CONTRACTUAL|EXTRAORDINARIO), `service_urgency` (NORMAL|URGENTE|EMERGENCIA), `service_order_status` (DRAFT|PENDING_APPROVAL|APPROVED|SCHEDULED|IN_PROGRESS|PENDING_CONFORMITY|CLOSED|REJECTED|CANCELLED), `purchase_type` (PROGRAMADA|STOCK|EMERGENCIA)
  - Tablas: `serviceOrders` (folio único, companyId, branchId, tipo, urgencia, status, equipoId nullable FK branch_equipments, alcance, justificación, supplierId nullable, monto centavos, fechas programada/real, conformidad firmadaPor/firmadaAt), `serviceOrderQuotes` (URL, proveedor, monto), `serviceOrderEvidence` (URL, tipo ANTES/DESPUES, reporte técnico), `approvalMatrixRules` (companyId, docType OC|OS, montoMin, montoMax, rol requerido, cotizacionesMin, secuencia), `approvalRequests` (docType, docId, nivel, rol, estado PENDING|APPROVED|REJECTED, resolvedBy/resolvedAt/reason), `costCenters` (companyId, código, nombre, partida contable, activo), `branchBudgets` (branchId, costCenterId, mes YYYY-MM, monto centavos, unique constraint)
  - Agregar columnas a `purchaseOrders`: `purchaseType`, `costCenterId`, `folioYear`, `folioSequence`
  - Exportar desde `lib/db/schema/index.ts`

  **Acceptance criteria:**
  - [ ] `pnpm db:generate` genera migración SIN drops de tablas existentes
  - [ ] Migración aplicable con `pnpm db:migrate` contra .env
  - [ ] `pnpm run build` pasa

  **Verification:** revisar SQL generado en drizzle/, build limpio
  **Dependencies:** None
  **Files:** `lib/db/schema/service-orders.ts` (nuevo), `lib/db/schema/index.ts`, `lib/db/schema.ts`, `drizzle/*` (generado)
  **Estimated scope:** Medium

- [x] **Task 2: Generador de folios transaccional** ✅ Implementado (migración `0062_loving_paibok.sql` aplicada): tabla `folio_counters`, columna `branches.code` (unique parcial por empresa), `lib/services/folio-generator.ts` con upsert atómico `ON CONFLICT DO UPDATE RETURNING` (lock de fila implícito), folio de borrador `DRAFT-*` para no romper la serie, `findFolioGaps()` + 12 tests unitarios (`folio-generator.test.ts`). Concurrencia verificada con 8 tx paralelas → 8 folios únicos consecutivos (scratch/verify-folio-generator.ts, rollback)

  **Acceptance criteria:**
  - [ ] Folio sigue formato `[TIPO]-[CODIGO_SUCURSAL]-[AÑO]-[CONSECUTIVO]`
  - [ ] Dos llamadas concurrentes no producen el mismo folio (lock)
  - [ ] `findFolioGaps()` reporta secuencias faltantes

  **Verification:** script tsx ad-hoc o test unitario simple; build
  **Dependencies:** Task 1
  **Files:** `lib/services/folio-generator.ts`, `lib/db/schema/service-orders.ts`
  **Estimated scope:** Small

### Checkpoint: Foundation
- [x] Migraciones 0061+0062 aplicadas sin destructivos (`db:migrate` OK)
- [x] Build verde (`pnpm run build` exit 0) · 292 tests unitarios pasan

### Phase 2: Servicios de negocio

- [x] **Task 3: Servicio de matriz de autorización** ✅ Implementado (`lib/services/approval-matrix-service.ts`): `resolveApprovalChain` con seed perezoso de matriz default, `createApprovalRequests`, `approveRequest`/`rejectRequest` con denegaciones ROLE/SELF/NOT_CURRENT_LEVEL (segregación estilo A16), cierre automático del documento al aprobar el último nivel. Rangos inclusivos en centavos contiguos sin huecos. 13 tests unitarios

  **Acceptance criteria:**
  - [ ] Cadena correcta para montos límite ($5,000 exacto va al primer nivel)
  - [ ] Usuario con rol insuficiente no puede aprobar
  - [ ] Documento solo pasa a APPROVED cuando todos los niveles aprueban

  **Verification:** tests unitarios de resolveApprovalChain; build
  **Dependencies:** Task 1
  **Files:** `lib/services/approval-matrix-service.ts`
  **Estimated scope:** Medium

- [x] **Task 4: Servicio de presupuesto y tope de emergencias** ✅ Implementado (`lib/services/budget-service.ts`): `checkBudgetAvailability` (comprometido = OS+OC en estados que comprometen, mes por `to_char(created_at)`) y `validateEmergencyCap` leyendo `tenantOperatingConfig.emergencyPurchaseCapCents` (migración `0063`, NULL = sin tope). Cuenta OC EMERGENCIA + OS urgencia EMERGENCIA. Campo agregado a operating-config-form + API zod + defaults. 12 tests unitarios. Integración en submits: Tasks 5/6

  **Acceptance criteria:**
  - [ ] Disponible calculado correctamente con múltiples OC/OS del mes
  - [ ] OC no-emergencia sin presupuesto se rechaza al enviar; emergencia permitida hasta tope
  - [ ] Tope de emergencias respeta acumulado mensual

  **Verification:** tests unitarios; build
  **Dependencies:** Task 1
  **Files:** `lib/services/budget-service.ts`, `lib/db/schema.ts` (columna emergencyPurchaseCapCents) + migración, `components/company/operating-config-form.tsx`, `app/api/company/operating-config/route.ts`
  **Estimated scope:** Medium

### Checkpoint: Business Logic
- [x] Tests unitarios matrix (13) + budget (12) pasan · 317/317 suite completa · build verde

### Phase 3: APIs

- [ ] **Task 5: API de Órdenes de Servicio** — ✅ 5a implementada y commiteada (`7aa9b80`, 2026-08-25): `lib/services/service-order-service.ts` con `listOrders/getOrderDetail/createDraft/updateDraft/submitOrder`; rutas `app/api/service-orders/route.ts` (GET lista+POST), `[id]/route.ts` (GET detalle, PATCH solo DRAFT) e `[id]/submit/route.ts`. Submit en UNA transacción: `resolveApprovalChain` → cotizaciones ≥ max(minQuotes) → presupuesto o `validateEmergencyCap` → `nextFolio({tx})` reemplaza DRAFT-* → `createApprovalRequests({tx}, ahora con tx opcional)` → PENDING_APPROVAL. Concurrencia resuelta con UPDATE condicional `WHERE status='DRAFT'` + rollback del folio. FKs opcionales validadas contra la empresa del tenant. Build/lint verdes, 317 tests OK
  Rutas bajo `app/api/service-orders/`:
  - `route.ts` (GET lista con filtros sucursal/status/tipo, POST crear borrador con validación zod)
  - `[id]/route.ts` (GET detalle con quotes+evidence+approvals, PATCH editar en DRAFT)
  - `[id]/submit/route.ts` (valida cotizaciones mínimas según matriz, presupuesto, crea approvals, pasa a PENDING_APPROVAL)
  - `[id]/quotes/route.ts` (POST adjuntar cotización) ✅ 5b
  - `[id]/evidence/route.ts` (POST subir evidencia antes/después a R2/local fallback — mismo patrón que workflows) ✅ 5b
  - `[id]/conformity/route.ts` (POST firma de conformidad del gerente → CLOSED) ✅ 5b

  **Acceptance criteria:**
  - [ ] Todas las rutas verifican sesión (`getSession()`) y scoping por tenant (`lib/tenant-context.ts`)
  - [ ] Submit rechaza si faltan cotizaciones o no hay presupuesto
  - [ ] Conformidad solo la firma un GERENTE+ de la sucursal y solo en estado PENDING_CONFORMITY

  **Verification:** curl manual contra dev server; lint
  **Dependencies:** Tasks 2, 3, 4
  **Files:** `app/api/service-orders/**` (~6 archivos)
  **Estimated scope:** Large → dividir en 5a (CRUD+submit) y 5b (quotes/evidence/conformity) si excede sesión

- [ ] **Task 6: APIs de aprobaciones, matriz y presupuestos + integración OC**
  - ⚠️ **Ruta `app/api/approvals/` YA EXISTE** y pertenece a aprobaciones de turnos (`ShiftApprovalService`, RH). Usar `app/api/approval-requests/route.ts` (GET bandeja pendiente del rol del usuario), `[id]/approve/route.ts`, `[id]/reject/route.ts` — coincide con la tabla `approval_requests`
  - `app/api/approval-matrix/route.ts` (GET/PUT reglas por empresa, solo ADMIN+)
  - `app/api/cost-centers/route.ts` (GET/POST), `app/api/budgets/route.ts` (GET/PUT por mes)
  - Extender submit de purchase orders existente (`app/api/inventory/purchase-orders*`): agregar `purchaseType` + `costCenterId`, pasar por matriz y presupuesto, folio nuevo formato

  **Acceptance criteria:**
  - [ ] Bandeja solo muestra approvals del nivel actual cuyo rol ≤ rol del usuario
  - [ ] OC nueva recibe folio `OC-[SUC]-[AÑO]-[N]` y pasa por matriz/presupuesto igual que OS
  - [ ] PUT de matriz valida solapamiento de rangos de monto

  **Verification:** curl manual; lint
  **Dependencies:** Tasks 2, 3, 4
  **Files:** `app/api/approval-requests/**`, `app/api/approval-matrix/**`, `app/api/cost-centers/**`, `app/api/budgets/**`, `app/api/inventory/purchase-orders/**`
  **UI Task 8:** `app/dashboard/approvals/**`, `app/dashboard/company/approval-matrix/**`
  **Estimated scope:** Large
  ✅ Implementado y commiteado (`95d1c2c`, 2026-08-25): ver handoff §3 Task 6

### Checkpoint: APIs
- [ ] Flujo completo via API: crear OS → submit → aprobar niveles → conformidad → CLOSED
- [ ] OC con nuevo folio pasa por matriz

### Phase 4: UI

- [ ] **Task 7: Páginas de Órdenes de Servicio** ✅ implementada (`9f83b59`, 2026-08-25)
  `app/dashboard/service-orders/page.tsx` (lista con filtros y badges de estado/urgencia, patrón de purchase-orders/page.tsx) y `[id]/page.tsx` (detalle: timeline de aprobaciones, galería evidencias antes/después, botones según estado y rol: editar/enviar/aprobar/firmar conformidad). Formulario de creación con selector de centro de costo.

  **Acceptance criteria:**
  - [ ] Lista y detalle renderizan datos reales de la API
  - [ ] Acciones visibles solo según estado y rol del usuario
  - [ ] Navegación agregada al menú lateral del dashboard

  **Verification:** recorrido manual en dev server; lint/build
  **Dependencies:** Task 5
  **Files:** `app/dashboard/service-orders/**`, componente sidebar/nav
  **Estimated scope:** Large

- [ ] **Task 8: Bandeja de aprobaciones + admin de matriz**
  `app/dashboard/approvals/page.tsx` (pendientes agrupados por documento, monto, regla aplicada, presupuesto restante, acciones aprobar/rechazar con razón). Editor de la matriz en `app/dashboard/company/approval-matrix/page.tsx` — bajo la sección Organización, junto al operating-config existente (mismo patrón de página cliente + API), NO en settings/.

  **Acceptance criteria:**
  - [ ] Aprobar desde la UI mueve el documento al siguiente nivel (visible en timeline)
  - [ ] Editor persiste reglas y previene rangos traslapados

  **Verification:** recorrido manual; build
  **Dependencies:** Tasks 6, 7
  **Files:** `app/dashboard/approvals/**`, `app/dashboard/company/approval-matrix/**`
  **Estimated scope:** Large

- [ ] **Task 9: Presupuestos y centros de costo (UI)**
  `app/dashboard/budgets/page.tsx`: catálogo de centros de costo + captura mensual por sucursal/partida (grid editable) + barra de consumo real vs presupuestado por partida.

  **Acceptance criteria:**
  - [ ] Captura guarda presupuestos y refleja consumo de OC/OS aprobadas
  - [ ] Alerta visual cuando consumo ≥ 90% del presupuesto

  **Verification:** recorrido manual; build
  **Dependencies:** Tasks 6, 9 depende de budgets API (Task 6)
  **Files:** `app/dashboard/budgets/**`
  **Estimated scope:** Medium

### Phase 5: KPIs y automatización

- [ ] **Task 10: Dashboard de KPIs gerenciales**
  `app/dashboard/reports/control/page.tsx` con Recharts (patrón de reports/executive). Metas/semáforos leídas de `tenant_operating_config` (`foodCostTargetPercent`, `laborCostTargetPercent`, defaults en `DEFAULT_FINANCIAL_TARGETS`) — decisión #10:
  - Food cost % real vs teórico por sucursal (usa datos recipes/sales-entry existentes)
  - Gasto operativo % (OS/ventas) y presupuesto vs ejecutado por partida
  - Comparativo de precios por insumo entre sucursales, ranking proveedores (cumplimiento + monto)
  - % compras emergencia (meta <5%), desviación presupuestal mensual

  **Acceptance criteria:**
  - [ ] Cada KPI tiene endpoint o query propia con scoping por empresa
  - [ ] Filtro de mes/sucursal funcional
  - [ ] Build y lint limpios

  **Dependencies:** Tasks 6, 9
  **Files:** `app/dashboard/reports/control/**`, `app/api/reports/control/route.ts`
  **Estimated scope:** Large

- [ ] **Task 11: Job Inngest de control mensual**
  Función cron en `lib/inngest/functions/`: reporte mensual de desviaciones presupuestales, auditoría de folios sin saltos (`findFolioGaps`), auditoría de contratos por vencer (90 días) y domiciliados conciliados, % emergencias fuera de meta → notifica vía `NotificationDispatcher` a OWNER/ADMIN.

  **Acceptance criteria:**
  - [ ] Función registrada y visible en dev server de Inngest (`INNGEST_DEV=1`)
  - [ ] Notificación enviada cuando hay desviación o gap de folios

  **Verification:** disparo manual desde UI Inngest local
  **Dependencies:** Tasks 2, 4, 10
  **Files:** `lib/inngest/functions/control-monthly-report.ts`, registro de functions
  **Estimated scope:** Small

### Checkpoint: Complete (core OC/OS)
- [ ] Flujo end-to-end demostrable: requisición→OC→matriz→recepción→conciliación, y OS→aprobación→evidencia→conformidad
- [ ] Dashboard KPIs poblado con datos demo
- [ ] `pnpm run build && pnpm run lint` verdes

### Phase 6: Contratos y gastos recurrentes (agregada tras investigación del doc integral)

Cubre los gaps del doc `finzasordenes.md` sección "gastos operativos a fondo": contratos con vigencia/escalación, conciliación factura-vs-contrato y lista maestra de domiciliados. La tesorería/corridas queda delegada a plan-payees (decisión #8).

- [ ] **Task 12: Tabla de contratos de servicios**
  Crear tabla `supplierContracts` en módulo propio o `service-orders.ts`: payeeId/supplierId nullable, scope sucursal o corporativo, monto (centavos), vigencia inicio/fin, escalación INPC (bool), método de pago (CORRIDA|DOMICILIADO|TRANSFERENCIA), día de cargo/pago, partida/categoría (4xxx), urlContrato, activo. Migración sin drops.

  **Acceptance criteria:**
  - [ ] Migración sin drops; build verde

  **Dependencies:** Task 1
  **Files:** `lib/db/schema/service-orders.ts` (o `contracts.ts`)
  **Estimated scope:** Small

- [ ] **Task 13: Servicio + API de contratos con conciliación**
  - CRUD `app/api/contracts/**` (solo ADMIN+ para escribir)
  - Al registrar `operatingExpense` o conciliar `cfdiRecibidos` contra contrato: si variación monto facturado vs contrato >10% → flag `REQUIERE_INVESTIGACION` antes de aprobar pago
  - Job/alerta de renovación: contratos que vencen en ≤90 días → NotificationDispatcher

  **Acceptance criteria:**
  - [ ] Variación >10% bloquea aprobación automática del gasto ligado
  - [ ] Alerta 90 días se genera una sola vez por contrato/mes

  **Dependencies:** Task 12
  **Files:** `lib/services/contract-service.ts`, `app/api/contracts/**`, job Inngest
  **Estimated scope:** Medium

- [ ] **Task 14: Lista maestra de domiciliados + conciliación mensual**
  Vista/filtro sobre contracts con `paymentMethod=DOMICILIADO`: monto esperado + día de cargo. Job mensual compara cargos reales del mes (`cfdiRecibidos`/expenses del payee) vs esperado → alerta por desviación o cargo ausente/inesperado; detección de suscripciones huérfanas (sin consumo registrado en trimestre).

  **Acceptance criteria:**
  - [ ] Cargo real ≠ esperado genera alerta con diferencia
  - [ ] Domiciliado sin cargo en el mes genera alerta

  **Dependencies:** Tasks 13, buzón fiscal existente
  **Files:** `lib/services/recurring-payments-service.ts`, job Inngest
  **Estimated scope:** Medium

- [ ] **Task 15: UI de contratos**
  `app/dashboard/contracts/page.tsx`: lista con badges de vigencia (verde/ámbar ≤90d/rojo vencido), calendario de cargos del mes, editor básico. Navegación en sidebar.

  **Dependencies:** Task 13
  **Files:** `app/dashboard/contracts/**`
  **Estimated scope:** Medium

### Phase 7: KPIs extendidos (amplía Task 10)

KPIs adicionales del doc integral que se agregan al dashboard de control:
- **Cumplimiento de proveedor**: entregas a tiempo / total (`receivingReports.createdAt` vs `purchaseOrders.expectedDeliveryDate`)
- **Días de inventario**: inventario promedio / consumo diario (kardex)
- **% egresos sin documento origen** (meta <2%): gastos sin OC/OS/contrato/caja chica asociada
- **% correctivo vs preventivo** (meta <40% correctivo): desde serviceOrders por tipo
- **Contratos vencidos sin renovar** (meta 0)

**Excluido explícitamente:**
- Comparativo kWh entre sucursales gemelas — no existe captura de consumos energéticos; requiere módulo nuevo (facturas CFE/gas). Anotado como futuro.
- Auditorías sorpresa de inventario físico vs sistema — control de proceso operativo (procedimiento humano); el software solo aporta reporte de mermas e inventarios ya existente.
- Punto de reorden automático / par levels — cubierto por módulo inventory existente, fuera de alcance de este plan.

### Phase 8: Cierre

- [ ] Checkpoint final: flujo completo + Phase 6 integrada, build/lint verdes

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `db:generate` propone drops de tablas existentes | High | Revisar SQL de la migración antes de aplicar; nunca correr `db:push` |
| Colisión de folios concurrentes | High | Lock transaccional en tabla contador (`FOR UPDATE`) |
| Regresión en flujo OC existente al integrar matriz | High | Mantener retrocompatibilidad: OCs en estados intermedios no requieren matriz; solo nuevas al hacer submit |
| Scoping multi-tenant omitido en rutas nuevas | High | Checklist: toda ruta usa getSession + tenant-context |
| Montos mezclando pesos/centavos | Med | Convención única integer-centavos, helpers existentes |
| Alcance XL en una sola sesión | Med | Tasks 5, 6, 7, 8, 10 marcadas L con subdivisión explícita |

## Open Questions

- Tope mensual de compras de emergencia: ¿valor default sugerido (p.ej. $10,000 MXN por sucursal/mes) o dejarlo null hasta que el admin lo configure?
- ¿La firma de conformidad requiere firma digital real o basta registro userId+timestamp?
- ¿Los KPIs de food cost teórico ya tienen fuente confiable en recipes/sales-entry o hay que validar calidad de datos primero?

## Parallelization

- **Secuencial obligatorio:** Tasks 1→2→(3,4 paralelizables)→5/6→7→8→9→10→11→(12→13→14, 15 tras 13)
- **Paralelizable:** Tasks 3 y 4 entre sí; Task 11 puede avanzarse una vez 2 y 4 listos; Phase 6 (12-15) independiente de UI core (7-9) una vez Task 11 definida
