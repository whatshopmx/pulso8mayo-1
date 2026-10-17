# Todo — Pulso 1.0 Closeout · PHASE 0 (Control Core)

> Tracker de ejecución. Plan: `tasks/plan-closeout-pulso-1.0-phase-0.md`
> Estado del programa: `docs/closeout-pulso-1.0/00-STATUS.md`
> Regla: **no se avanza de checkpoint sin el anterior verde.**

## Estado (actualizado 2026-10-17)

| Checkpoint | Estado |
|---|---|
| A — Esquema + RBAC | ✅ cerrado |
| B — Epic 0.1 Canonical Exception | 🟡 Tasks 3–10 y 12 hechas; falta Task 11 (UI) |
| C — Epic 0.2 Canonical Evidence | ⬜ pendiente (Tasks 13–16) |
| D — Epic 0.3 Audit Trail | ⬜ pendiente (Tasks 17–18) |
| Cierre — docs | ⬜ pendiente (Task 19) |

**Verificación:** `npx tsc --noEmit` limpio; `vitest run` → **1625 passed**, 0 fallidos.
Commits: `f4943d3` (0.A) · `6c649e9` (lifecycle/servicio/SLA) · `77dbeab` (adaptadores)
· `56b1db6` (sync Inngest) · `291acc2` (API) · `b445c40` (feed canónico).

---

## Phase 0.A — Fundación de esquema

- [x] **Task 1 (M): Esquema `exceptions` + migración**
  - [x] `lib/db/schema/exceptions.ts` con enums + tabla `exceptions`.
  - [x] Exportar en `lib/db/schema/index.ts`.
  - [x] Índice único `(company_id, subject_type, subject_id)` + índices de consulta.
  - [x] `drizzle/0099_exotic_warpath.sql` revisado (aditivo, sin destructivo).
  - [x] *Verification:* `npx tsc --noEmit` limpio.

- [x] **Task 2 (S): Recurso RBAC `exceptions`**
  - [x] `'exceptions'` en `Resource` + matriz (manage SUPER_ADMIN/OWNER/ADMIN; read+update GERENTE/SUPERVISOR; read EMPLEADO/READONLY).
  - [x] *Verification:* test de no-regresión de la matriz.

### Checkpoint A ✅
- [x] Migración `exceptions` generada y revisada.
- [x] `npx tsc --noEmit` limpio.
- [x] RBAC probado sin pérdida de permisos.

---

## Phase 0.B — Epic 0.1 Canonical Exception

- [x] **Task 3 (S): Máquina de estados pura** — `lib/services/exception-lifecycle.ts`, 84 tests (matriz 9×8), sin `db`.
- [x] **Task 4 (M): `exception-service`** — `raise` upsert idempotente; `assign/startAction/resolve/verify/close/reopen/escalate/cancel`; domain events; auditoría; `getById/list/listOpen`; 11 tests con doble db en memoria.
- [x] **Task 5 (M): Adaptadores parte 1** — incident, inventory_alert, compliance_alert, equipment_alert; clasificación compartida extraída del feed legacy.
- [x] **Task 6 (S): SLA + owner** — `exception-sla.ts` (defaults D7) + owner por defecto = gerente de sucursal; 10 tests.
- [x] **Task 7 (M): Adaptadores parte 2** — nom035_action_plan, shift_approval, shift_change, cash_variance, invoice_discrepancy (Gate 0: `EXCEPTION_APPROVED` cancela).
- [x] **Task 8 (M): Sync durable Inngest** — `exceptions-sync` cron `*/10` + evento `exceptions/sync.requested`; concurrency 1; aislamiento por adaptador.
- [x] **Task 9 (M): API de excepciones** — `GET/POST /api/exceptions`, `GET /[id]`, `assign/start-action/resolve/verify/close/reopen/escalate/cancel`, `POST /sync`; `lib/api/exception-access.ts` + `withExceptionMutation` (RBAC + auditoría + 404 indistinto).
- [x] **Task 10 (M): `GroupExceptionsService` lee canónico** — flag `EXCEPTIONS_CANONICAL_READ`; fallback legacy intacto; mapeo puro a `GroupException`.
- [ ] **Task 11 (M): UI de lifecycle** — owner/SLA + acciones Asignar/Iniciar/Resolver/Verificar/Cerrar en `app/dashboard/exceptions/page.tsx`. **Siguiente.**
- [x] **Task 12 (S): Hook 3-way match + incidents** — `requestExceptionSync` desde `invoice-matching-service` (discrepancia y autorización) e `incident-engine`; degrada al cron.

### Checkpoint B — GATE 0
- [x] Backend: discrepancia → excepción → owner/SLA → acción → resolución → verificación → cierre (servicio + API + sync).
- [ ] UI: un GERENTE resuelve y un ADMIN verifica desde `/dashboard/exceptions`.
- [ ] `pnpm test:unit` verde — ✅ (1625 passed).
- [x] `npx tsc --noEmit` limpio.

---

## Phase 0.C — Epic 0.2 Canonical Evidence

- [ ] **Task 13 (M): Esquema `evidence` + migración**
- [ ] **Task 14 (M): `EvidenceStore` persistente**
- [ ] **Task 15 (S): Backfill**
- [ ] **Task 16 (M): Vínculos por subject**

### Checkpoint C
- [ ] Evidencia durable y recuperable entre procesos.
- [ ] Backfill idempotente con conteos.
- [ ] 3 dominios apuntan a la misma primitive.

---

## Phase 0.D — Epic 0.3 Audit Trail

- [ ] **Task 17 (M): Lectura unificada**
- [ ] **Task 18 (M): Cobertura financiera `before/after/reason`**

### Checkpoint D — GATE 0 (auditoría)
- [ ] Factura con discrepancia deja traza completa en `exceptions` + `evidence` + `audit`.

---

## Phase 0.E — Cierre

- [ ] **Task 19 (S): Documentación y tracker**
  - [ ] Crear `docs/closeout-pulso-1.0/PHASE-0-CONTROL-CORE.md`.
  - [ ] Actualizar `docs/closeout-pulso-1.0/00-STATUS.md` (Phase 0 ✅).
  - [ ] Inventario de fallbacks a retirar en Phase 7 (`GroupExceptionsService` legacy, `evidenceUrl`).

---

## Definición de Done (por tarea)

Cada tarea cierra solo si:
- [x] Writer y reader productivos (no solo schema).
- [x] Tenant scope explícito (`company_id`) y fail-closed.
- [x] Permisos aplicados.
- [x] Test unit; y tenant-isolation/E2E cuando aplique a API/UI.
- [x] `npx tsc --noEmit` limpio.
- [x] `pnpm test:unit` verde.
- [x] Sin modelo paralelo (se reutilizó primitive existente).
