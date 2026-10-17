# Todo — Pulso 1.0 Closeout · PHASE 0 (Control Core)

> Tracker de ejecución. Plan: `tasks/plan-closeout-pulso-1.0-phase-0.md`
> Estado del programa: `docs/closeout-pulso-1.0/00-STATUS.md`
> Regla: **no se avanza de checkpoint sin el anterior verde.**

---

## Phase 0.A — Fundación de esquema

- [ ] **Task 1 (M): Esquema `exceptions` + migración**
  - [ ] Crear `lib/db/schema/exceptions.ts` con enums + tabla `exceptions`.
  - [ ] Exportar en `lib/db/schema/index.ts`.
  - [ ] Índice único `(company_id, subject_type, subject_id)` + índices de consulta.
  - [ ] `pnpm db:generate` → `drizzle/0099_*.sql`; revisar SQL a mano (sin destructivo).
  - [ ] *Verification:* `npx tsc --noEmit` limpio.

- [ ] **Task 2 (S): Recurso RBAC `exceptions`**
  - [ ] Agregar `'exceptions'` a `Resource` en `lib/permissions.ts` + matriz de roles.
  - [ ] *Verification:* `pnpm test:unit -- lib/rbac`; no-regresión de permisos.

### Checkpoint A
- [ ] Migración `exceptions` generada y revisada.
- [ ] `npx tsc --noEmit` limpio.
- [ ] RBAC probado sin pérdida de permisos.

---

## Phase 0.B — Epic 0.1 Canonical Exception

- [ ] **Task 3 (S): Máquina de estados pura**
  - [ ] `lib/services/exception-lifecycle.ts` (ASSIGN/START_ACTION/RESOLVE/VERIFY/CLOSE/REOPEN/ESCALATE/CANCEL).
  - [ ] Guardas: RESOLVE exige `resolution`; VERIFY exige verificador ≠ resolvedor; CLOSE exige VERIFIED.
  - [ ] Sin importar `db`.
  - [ ] *Verification:* `pnpm test:unit -- exception-lifecycle` (todas las transiciones).

- [ ] **Task 4 (M): `exception-service`**
  - [ ] `raise` con upsert idempotente; `assign/startAction/resolve/verify/close/reopen/escalate/cancel`.
  - [ ] `getById/list/listOpen`.
  - [ ] Emitir `domain_events` (`EXCEPTION_RAISED`/`EXCEPTION_CLOSED`).
  - [ ] Escribir audit en cada mutación.
  - [ ] *Verification:* `pnpm test:unit -- exception-service`.

- [ ] **Task 5 (M): Adaptadores parte 1**
  - [ ] `exception-adapters/index.ts` + helper `upsertFromSource`.
  - [ ] `incident`, `inventory_alert`, `compliance_alert`, `equipment_alert`.
  - [ ] Reusar mapeos de severidad existentes.
  - [ ] *Verification:* `pnpm test:unit -- exception-adapters` (idempotencia).

- [ ] **Task 6 (S): SLA + owner**
  - [ ] `exception-sla.ts` con defaults por severidad.
  - [ ] Resolución de owner por sucursal; escalamiento al cruzar SLA vía `EscalationService`.
  - [ ] *Verification:* `pnpm test:unit -- exception-sla`.

- [ ] **Task 7 (M): Adaptadores parte 2**
  - [ ] `nom035_action_plan`, `shift_approval`, `shift_change_request`, `cash_variance`.
  - [ ] **`invoice_discrepancy`** (`matchStatus='DISCREPANCY'` → excepción con owner/SLA).
  - [ ] *Verification:* test de `invoice_discrepancy`; no duplica `EXCEPTION_APPROVED`.

- [ ] **Task 8 (M): Sync durable Inngest**
  - [ ] `lib/inngest/functions/exceptions-sync.ts` (cron `*/10`) + evento `exceptions/sync.requested`.
  - [ ] Registrar en `lib/inngest/functions/index.ts`.
  - [ ] Aislar fallos por adaptador; logs started/completed/failed/retrying.
  - [ ] *Verification:* `INNGEST_DEV=1 pnpm run dev` + función visible en `/api/inngest`.

- [ ] **Task 9 (M): API de excepciones**
  - [ ] `GET/POST /api/exceptions`, `GET /api/exceptions/[id]`.
  - [ ] `POST /api/exceptions/[id]/{assign,resolve,verify,close}`, `POST /api/exceptions/sync`.
  - [ ] `lib/api/exception-access.ts` (empresa + sucursal, fail-closed).
  - [ ] Guardas RBAC + segregación de funciones + clasificación FINANCIAL.
  - [ ] *Verification:* `tests/api/exceptions-tenant-isolation.spec.ts` + permission test.

- [ ] **Task 10 (M): `GroupExceptionsService` lee canónico**
  - [ ] Flag `EXCEPTIONS_CANONICAL_READ`; fuente primaria `exceptions`.
  - [ ] Fallback legacy intacto; derivar `deepLinkUrl`/`action`.
  - [ ] *Verification:* test existente de `group-exceptions-service` verde en OFF y ON.

- [ ] **Task 11 (M): UI de lifecycle**
  - [ ] Owner/SLA + acciones Asignar/Iniciar/Resolver/Verificar/Cerrar.
  - [ ] Respetar `DESIGN.md` (Operational Red ≤15%, sin sombras).
  - [ ] *Verification:* `pnpm run build` + revisión manual.

- [ ] **Task 12 (S): Hook 3-way match + incidents**
  - [ ] Disparar `exceptions/sync.requested` al persistir discrepancia/incidente.
  - [ ] Degradación al cron si Inngest está caído.
  - [ ] *Verification:* extender `invoice-matching-exception`.

### Checkpoint B — GATE 0
- [ ] Factura con discrepancia → excepción → owner → SLA → acción → resolución → verificación → cierre.
- [ ] `pnpm test:unit` verde.
- [ ] `npx tsc --noEmit` limpio.

---

## Phase 0.C — Epic 0.2 Canonical Evidence

- [ ] **Task 13 (M): Esquema `evidence` + migración**
  - [ ] `lib/db/schema/evidence.ts` + enum + índice; exportar.
  - [ ] `0100_*.sql`; agregar FK `exceptions.evidence_id`.
  - [ ] *Verification:* `pnpm db:generate && npx tsc --noEmit`.

- [ ] **Task 14 (M): `EvidenceStore` persistente**
  - [ ] Reescribir con tabla `evidence`; conservar firma pública y subida R2.
  - [ ] *Verification:* `pnpm test:unit -- evidence-store`.

- [ ] **Task 15 (S): Backfill**
  - [ ] `scripts/backfill-evidence.ts` (workflow steps, incidents, service orders).
  - [ ] Idempotente; reporte de conteos.
  - [ ] *Verification:* dry-run + test de idempotencia.

- [ ] **Task 16 (M): Vínculos por subject**
  - [ ] `exception`, `expense`, `invoice` referencian `evidence.id`.
  - [ ] Write-through conserva `evidenceUrl`.
  - [ ] *Verification:* `tests/gasto-evidencia.spec.ts` verde.

### Checkpoint C
- [ ] Evidencia durable y recuperable entre procesos.
- [ ] Backfill idempotente con conteos.
- [ ] 3 dominios apuntan a la misma primitive.

---

## Phase 0.D — Epic 0.3 Audit Trail

- [ ] **Task 17 (M): Lectura unificada**
  - [ ] `lib/services/audit-trail-service.ts` (4 fuentes, shape común, paginado).
  - [ ] `GET /api/audit/trail` con guardas + scoping.
  - [ ] *Verification:* `pnpm test:unit -- audit-trail-service` + permission test.

- [ ] **Task 18 (M): Cobertura financiera `before/after/reason`**
  - [ ] Aprobación factura/gasto/pago, liquidación de partida, ejecución de nómina.
  - [ ] Reusar `AuditService`/`logDataAccess`.
  - [ ] *Verification:* `pnpm test:unit -- audit-coverage` (falla si falta `reason`).

### Checkpoint D — GATE 0 (auditoría)
- [ ] Factura con discrepancia deja traza completa en `exceptions` + `evidence` + `audit`.

---

## Phase 0.E — Cierre

- [ ] **Task 19 (S): Documentación y tracker**
  - [ ] Crear `docs/closeout-pulso-1.0/PHASE-0-CONTROL-CORE.md`.
  - [ ] Actualizar `docs/closeout-pulso-1.0/00-STATUS.md` (Phase 0 ✅).
  - [ ] Inventario de fallbacks a retirar en Phase 7 (`GroupExceptionsService`, `evidenceUrl`).
  - [ ] *Verification:* revisión de docs + `git status` limpio.

---

## Definición de Done (por tarea)

Cada tarea cierra solo si:
- [ ] Writer y reader productivos (no solo schema).
- [ ] Tenant scope explícito (`company_id`) y fail-closed.
- [ ] Permisos aplicados.
- [ ] Test unit; y tenant-isolation/E2E cuando aplique a API/UI.
- [ ] `npx tsc --noEmit` limpio.
- [ ] `pnpm test:unit` verde.
- [ ] Sin modelo paralelo (se reutilizó primitive existente).
