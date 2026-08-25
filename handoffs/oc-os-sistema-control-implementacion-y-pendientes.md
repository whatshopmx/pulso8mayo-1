# Handoff — Sistema de Control OC/OS (finzasordenes.md): Phases 1–2 implementadas, pendiente Phase 3 en adelante

**Fecha:** sesión 2026-08-25
**Repositorio:** `C:/Users/david/pulso29` — Pulso HORECA (Next.js 16 App Router, TypeScript strict:false, Drizzle + Neon Postgres, better-auth)
**Documento fuente del negocio:** `finzasordenes.md` (raíz del repo) — guía de Órdenes de Compra/Servicio, matriz de autorización, controles multi-sucursal y KPIs para grupo QSR de 3–15 sucursales.
**Plan de trabajo:** `tasks/plan-ordenes-oc-os.md` · checklist ejecutiva: `tasks/todo-ordenes-oc-os.md`
**Commits de esta línea de trabajo (en main):**
| Commit | Contenido |
|---|---|
| `973c34b` | Task 1 — esquema OS/matriz/centros/presupuestos (migración `0061`) + docs del plan |
| `47187c7` | Task 2 — generador de folios transaccional (`0062`: folio_counters + branches.code) |
| `d8a9b26` | docs — hallazgos del operating-config integrados al plan |
| `5299cf8` | Tasks 3+4 — servicios de matriz de autorización y presupuesto/tope emergencias (`0063`: emergency_purchase_cap_cents) |
*(Nota: `d6fcc0a` commiteó trabajo fiscal suelto previo que compartía el working tree; no pertenece a este plan.)*

**Estado al cierre:** ✅ **Phase 1 (Fundaciones) y Phase 2 (Business Logic) completas y verificadas** — migraciones aplicadas sin destructivos, 37 tests unitarios nuevos, suite completa **317 passed**, `pnpm run build` exit 0, concurrencia real del generador de folios verificada contra Neon (8 transacciones paralelas → 8 folios únicos consecutivos). Working tree limpio.
**Cambios sin commitear:** ninguno.

---

## 1. Resumen para retomar

Se construye el sistema documental-financiero OC/OS descrito en `finzasordenes.md`: Órdenes de Servicio como módulo independiente con evidencia y conformidad, matriz de autorización multi-nivel configurable por monto, presupuesto mensual por sucursal×centro de costo×partida, folios `OC/OS-[SUC]-[AÑO]-[N]` sin saltos, tope mensual de compras de emergencia y dashboard de KPIs gerenciales.

**Ya terminado:** datos (Task 1), folios (Task 2), lógica de aprobación (Task 3) y lógica de presupuesto/emergencias (Task 4).
**Siguiente paso concreto:** **Task 5a** — API de Órdenes de Servicio bajo `app/api/service-orders/` (CRUD + submit). El submit debe, dentro de UNA transacción: validar cotizaciones mínimas según la cadena (`resolveApprovalChain`), validar presupuesto (`checkBudgetAvailability`; emergencias vía `validateEmergencyCap`), emitir folio real (`nextFolio({tx})`, reemplazando el placeholder `DRAFT-*`), crear los `approval_requests` (`createApprovalRequests`) y mover status a `PENDING_APPROVAL`.

---

## 2. Decisiones de arquitectura (vinculantes — NO re-abrir)

1. **OS es módulo independiente**: documento financiero/aprobatorio propio; FK opcional a equipos (`serviceOrders.equipmentId` nullable, sin constraint hoy) y opcional a servicios normativos (`complianceServiceId`). No se integra forzosamente al módulo equipment.
2. **Matriz de autorización configurable en BD** (`approval_matrix_rules`), no hardcodeada. Seed perezoso: empresa sin reglas recibe la default del doc §4 al primer `resolveApprovalChain`.
3. **Presupuesto por sucursal × centro de costo × mes** (`branch_budgets`, unique branch+cc+mes). Validación en submit; alertas mensuales vía job Inngest (Task 11).
4. **Folios por contador transaccional** (`folio_counters`): upsert atómico `INSERT..ON CONFLICT DO UPDATE RETURNING` (lock de fila implícito, sin FOR UPDATE explícito). **El folio real se emite en el SUBMIT**, no al crear borrador — un borrador cancelado no deja hueco (doc §6 "folios sin saltos"). Los drafts llevan placeholder único `DRAFT-XXXXXXXX`.
5. **Corte vertical**: cada fase entrega flujo usable end-to-end.
6. **Esquema nuevo en módulo separado** `lib/db/schema/service-orders.ts`, exportado desde `schema/index.ts` y `schema.ts`.
7. **TRES capas de autorización coexisten sin unificarse**: (a) `approvalMatrixRules` multi-nivel → SOLO OC/OS; (b) gastos operativos sueltos → `expenseAuthorizationRules` con fallback `rolExigidoPorMonto()` sobre umbrales de `tenant_operating_config` (`lib/expenses/approval-policy.ts`, A16); (c) OC/OS NO lee esos umbrales ni A16.
8. **Tope de emergencias vive en `tenant_operating_config.emergencyPurchaseCapCents`** (NULL = sin tope), editable desde la UI existente del operating-config. Cuenta OC `purchaseType=EMERGENCIA` **y** OS `urgency=EMERGENCIA` (para que no se burle vía orden de servicio).
9. **Tesorería/corridas de pago fuera de alcance** → delegadas a `tasks/plan-payees-contrapartes.md`. Este plan solo deja el hook: OC/OS aprobadas exponen expectativa de pago (payee/supplier, monto, vencimiento).
10. **KPIs leen metas de `tenant_operating_config`** (`foodCostTargetPercent` etc., defaults en `DEFAULT_FINANCIAL_TARGETS` de `financial-kpi-types.ts`). No hardcodear metas propias.
11. **Lo existente NO se rehace** (ya funciona): requisiciones→OC→recepción→3-way match con CFDI SAT (`cfdiRecibidos`, RFC emisor ±$0.01 en `fiscal-buzon-service.ts`), caja chica, gastos operativos con autorización A16, payees anti-fragmentación, nómina timbrada, P&L snapshots.

---

## 3. LO QUE YA ESTÁ IMPLEMENTADO

### Task 1 ✅ — Esquema (migración `drizzle/0061_cute_the_captain.sql`)
`lib/db/schema/service-orders.ts`:
- Enums: `service_order_type` (CORRECTIVO|PREVENTIVO|CONTRACTUAL|EXTRAORDINARIO), `service_urgency` (NORMAL|URGENTE|EMERGENCIA), `service_order_status` (DRAFT|PENDING_APPROVAL|APPROVED|SCHEDULED|IN_PROGRESS|PENDING_CONFORMITY|CLOSED|REJECTED|CANCELLED), `purchase_type` (PROGRAMADA|STOCK|EMERGENCIA), `approval_doc_type` (OC|OS), `approval_request_status`, `evidence_type` (ANTES|DESPUES)
- Tablas: `service_orders` (folio unique, companyId, branchId, equipoId/complianceServiceId opcionales, supplierId, monto centavos, conformity_signed_by/at, createdBy text), `service_order_quotes`, `service_order_evidence`, `approval_matrix_rules` (**amountMin/amountMax INCLUSIVOS en centavos**, requiredRole, minQuotes, sequence, active), `approval_requests` (level, requiredRole, minQuotes, PENDING|APPROVED|REJECTED, resolvedBy/at/reason), `cost_centers` (unique company+code), `branch_budgets`
- Columnas nuevas en `purchase_orders`: `purchase_type`, `cost_center_id`, `folio_year`, `folio_sequence`

### Task 2 ✅ — Generador de folios (migración `drizzle/0062_loving_paibok.sql`)
- `folio_counters` (companyId, branchId, docType, year, lastSequence; unique 4-tuple)
- `branches.code` columna nueva (text, nullable) + unique parcial `(company_id, code) WHERE code IS NOT NULL` — **requisito del formato de folio que no existía**
- `lib/services/folio-generator.ts`: `formatFolio`, `parseFolio` (regex anclada `^(OC|OS)-([A-Z0-9]{1,12})-(\d{4})-(\d{4,})$` — rechaza DRAFT-* y legacy), `draftFolio()`, `detectGaps`, `nextFolio({companyId, branchId, docType, tx?})` (lanza `ApiError` claro si la sucursal no tiene `code` configurado), `findFolioGaps(companyId)` (auditoría §6; compara counters vs folios emitidos parseados)
- Verificación de concurrencia: `scratch/verify-folio-generator.ts` (tsx, rollback completo) — **8 tx paralelas → secuencias 1..8 exactas**
- Tests: `lib/services/folio-generator.test.ts` (12)

### Task 3 ✅ — Matriz de autorización
`lib/services/approval-matrix-service.ts`:
- Puros: `matchesRange` (inclusivo ambos extremos), `defaultMatrixRules()` ($0–500000¢ GERENTE/1 · $500001–2500000¢ ADMIN/2 · $2500001–10000000¢ OWNER/3 · >$10000000¢ OWNER/3, contiguos sin huecos), `buildChain` (filtra activos+cubiertos, ordena por sequence; monto sin cobertura → cadena vacía = error de config, el submit debe rechazar), `nextPendingLevel`, `denyApproval` → `"ROLE" | "SELF" | "NOT_CURRENT_LEVEL" | null`
- BD: `resolveApprovalChain` (seed perezoso), `createApprovalRequests`, `approveRequest(id, actorId, actorRole)` (al aprobar el último nivel: OS→APPROVED; OC→APPROVED+approvedBy/approvedAt), `rejectRequest(...)` (documento→REJECTED de inmediato; OC guarda rejectionReason)
- Segregación de funciones estilo A16: quien creó el doc (`serviceOrders.createdBy` / `purchaseOrders.requestedBy`) nunca puede aprobarlo
- Tests: `lib/services/approval-matrix-service.test.ts` (13)

### Task 4 ✅ — Presupuesto y tope de emergencias (migración `drizzle/0063_square_mister_sinister.sql`)
`lib/services/budget-service.ts`:
- Puros: `computeBudgetStatus(budgeted, commitments[])`, `evaluateEmergencyCap(cap|null, used, newAmount)` (límite inclusivo; cap null = permitido siempre)
- BD: `getBudget`, `getCommitted` (OS_COMMITTING_STATUSES = APPROVED..CLOSED; OC_COMMITTING_STATUSES = APPROVED|SENT|PARTIALLY_RECEIVED|CLOSED; mes por `to_char(created_at,'YYYY-MM')`; docs sin costCenterId no se atribuyen), `checkBudgetAvailability`, `getEmergencyUsage` (OC EMERGENCIA + OS EMERGENCIA), `validateEmergencyCap(companyId, branchId, month, pendingAmount)`
- Integración operating-config existente: columna `emergency_purchase_cap_cents` + campo en `components/company/operating-config-form.tsx` ("Vacío = sin tope") + zod en `app/api/company/operating-config/route.ts` + default `null` en `DEFAULT_TENANT_OPERATING_CONFIG` (`tenant-config-service.ts`)
- Tests: `lib/services/budget-service.test.ts` (12)

---

## 4. TAREAS PENDIENTES (fuente de verdad — actualizar este documento al avanzar)

> Convención: marcar `[x]` aquí Y en `tasks/plan-ordenes-oc-os.md` + `tasks/todo-ordenes-oc-os.md`, y añadir el commit.

### Checkpoint Foundation ✅ · Checkpoint Business Logic ✅

### Phase 3: APIs
- [ ] **Task 5a — API service-orders CRUD + submit** (`app/api/service-orders/route.ts`, `[id]/route.ts`, `[id]/submit/route.ts`)
  - GET lista con filtros (branchId/status/type) · POST crea borrador (zod; folio=`draftFolio()`, createdBy=session.user.id)
  - GET detalle (quotes+evidence+approvals) · PATCH solo en DRAFT
  - **submit** en UNA transacción: cadena=`resolveApprovalChain` (cadena vacía → 400 "monto no cubierto por la matriz"), cotizaciones ≥ max(minQuotes de la cadena), `checkBudgetAvailability` (bloquea si no ok salvo EMERGENCIA→`validateEmergencyCap`), `nextFolio({tx})` reemplaza placeholder, `createApprovalRequests({tx})`, status→PENDING_APPROVAL
  - Todas las rutas: `auth.api.getSession` + `requireTenant()` scoping
- [ ] **Task 5b — quotes / evidence / conformity**
  - `[id]/quotes` POST (adjuntar URL R2/local-fallback, mismo patrón que workflows)
  - `[id]/evidence` POST (ANTES|DESPUES)
  - `[id]/conformity` POST — solo rol GERENTE+, solo estado PENDING_CONFORMITY → CLOSED (+signedBy/At)
- [ ] **Task 6 — APIs aprobaciones, matriz, centros, presupuestos + integración OC**
  - ⚠️ **`app/api/approvals/` YA EXISTE (turnos RH, ShiftApprovalService) — NO colisionar**: usar `app/api/approval-requests/route.ts` (GET bandeja del rol), `[id]/approve/route.ts`, `[id]/reject/route.ts` (delegan en approveRequest/rejectRequest del servicio; denial→mapear a 403/409 con mensaje humano)
  - `app/api/approval-matrix/route.ts` GET/PUT (solo ADMIN+; validar traslape de rangos y contigüidad recomendada)
  - `app/api/cost-centers/route.ts` GET/POST · `app/api/budgets/route.ts` GET/PUT por mes
  - Extender submit de OC (`app/api/inventory/purchase-orders/`): purchaseType+costCenterId obligatorios al enviar, misma cadena/presupuesto/folio que OS (`poNumber` ← `nextFolio`, poblar folioYear/folioSequence). Retrocompatibilidad: OC ya enviadas no requieren matriz.

### Phase 4: UI
- [ ] **Task 7** — `app/dashboard/service-orders/page.tsx` (lista+filtros+badges, patrón purchase-orders) y `[id]/page.tsx` (timeline aprobaciones, galería ANTES/DESPUES, acciones según estado×rol); entrada en sidebar/nav
- [ ] **Task 8** — `app/dashboard/approvals/page.tsx` (bandeja agrupada, presupuesto restante, aprobar/rechazar con razón) + editor de matriz en `app/dashboard/company/approval-matrix/page.tsx` (junto a operating-config, patrón página cliente + API; NO en settings/)
- [ ] **Task 9** — `app/dashboard/budgets/page.tsx`: catálogo centros + grid mensual por sucursal/partida + barra consumo vs presupuestado (alerta ≥90%)

### Phase 5: KPIs y automatización
- [ ] **Task 10** — `app/dashboard/reports/control/page.tsx` + `app/api/reports/control/route.ts`: food cost % real vs teórico (recipes/sales-entry), gasto operativo % (OS/ventas), presupuesto vs ejecutado por partida, comparativo precios por insumo entre sucursales, ranking proveedores, % emergencias (<5%), desviación presupuestal. Metas desde `tenant_operating_config` (decisión #10). Filtro mes/sucursal
- [ ] **Task 11** — Job Inngest mensual `lib/inngest/functions/control-monthly-report.ts`: desviaciones, `findFolioGaps`, contratos por vencer ≤90 días (Phase 6), domiciliados desviados → NotificationDispatcher a OWNER/ADMIN. Registrar en `app/api/inngest/route.ts`

### Phase 6: Contratos y recurrentes
- [ ] **Task 12** — tabla `supplierContracts` (payee/supplier nullable, scope, monto ¢, vigencia, escalación INPC bool, paymentMethod CORRIDA|DOMICILIADO|TRANSFERENCIA, día cargo, partida, urlContrato, activo) — migración sin drops
- [ ] **Task 13** — CRUD `app/api/contracts/**` (ADMIN+ escribir); flag REQUIERE_INVESTIGACION si factura vs contrato varía >10%; alerta renovación ≤90 días una vez por contrato/mes
- [ ] **Task 14** — domiciliados: esperado vs cargos reales del mes (`cfdiRecibidos`/expenses del payee); alertas por desviación, cargo ausente, suscripción huérfana (sin consumo en trimestre)
- [ ] **Task 15** — `app/dashboard/contracts/page.tsx` (badges vigencia verde/ámbar≤90d/rojo, calendario de cargos, editor básico)

### Phase 7: KPIs extendidos (amplían Task 10)
- [ ] Cumplimiento proveedor (entregas a tiempo vs expectedDeliveryDate) · días de inventario (kardex) · % egresos sin documento origen (<2%) · % correctivo vs preventivo (<40%) · contratos vencidos (0)
- Excluido explícitamente: comparativo kWh (sin captura energética), auditorías físicas sorpresa (proceso humano), par levels (módulo inventory existente)

### Checkpoint final
- [ ] Flujo end-to-end demostrable (OS→aprobación→evidencia→conformidad; OC→matriz→recepción→conciliación) + KPIs con datos demo + `pnpm run build && pnpm run lint` verdes

---

## 5. Gotchas para el agente (leídos de esta sesión)

1. **`ApiError(mensaje, statusCode)`** — mensaje PRIMERO (clase en `lib/api/error.ts`). No invertir.
2. **Rutas API**: `app/api/approvals/` está tomado por turnos RH → bandeja OC/OS en `app/api/approval-requests/`.
3. **Folio en submit, no en draft**: crear OS con `draftFolio()`; `parseFolio()` lo descarta para que `findFolioGaps` no lo audite.
4. **Sucursal sin `code`** → `nextFolio` lanza 400 con mensaje accionable; las sucursales demo aún no tienen código asignado.
5. **Transacciones**: `db.transaction` solo funciona porque `lib/db/index.ts` usa driver `neon-serverless` + WebSocket (`ws`). No cambiar a neon-http.
6. **Scripts tsx**: primera línea `import "dotenv/config";` — los imports ESM se hoistean, un `config()` normal corre DESPUÉS de inicializar `lib/db` y falla sin DATABASE_URL. Alias `@/` funciona en tsx.
7. **Tests unitarios** (`pnpm test:unit`, vitest): solo lógica pura, sin DB ni browser. Globs: `lib/**/*.test.ts`, `tests/unit/**/*.test.ts`.
8. **Dinero SIEMPRE en centavos integer.** Meses como string "YYYY-MM". Rangos de matriz inclusivos en ambos extremos.
9. **Migraciones**: `pnpm db:generate` y REVISAR el SQL antes de `pnpm db:migrate` (nunca `db:push`). Las 3 migraciones de este plan (61-63) están aplicadas.
10. **Build**: warning "Error loading document stats … /dashboard/labor/documents" es PREEXISTENTE y no fatal — juzgar por exit code.
11. **i18n**: UI en español (convención del dashboard); usar `next-intl` si las páginas existentes lo hacen.

## 6. Open questions heredados (decidir durante Tasks 5–8)

- ¿Conformidad exige firma digital real o basta userId+timestamp? *(implementación actual asume registro simple)*
- Contrato firmado para >$100K (doc §4): no hay campo aún; considerar `requiresContract` en rules o dejarlo a Phase 6 (contracts).
- Calidad de datos de recipes/sales-entry para food cost teórico antes de Task 10.

## 7. Comandos rápidos

```bash
pnpm test:unit                 # 317 tests (37 nuevos de este plan)
pnpm run build                 # verificar antes de commit
npx tsx scratch/verify-folio-generator.ts   # concurrencia de folios (rollback, deja BD intacta)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest   # para Task 11
```
