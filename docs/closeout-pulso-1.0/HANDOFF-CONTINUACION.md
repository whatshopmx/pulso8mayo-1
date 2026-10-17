# HANDOFF — Continuación del cumplimiento vs `sistemainvestigacion17oct.md`

**Generado:** 2026-10-17
**Rama:** `main`
**Último commit:** `a65c6da` — `fix(receiving): H07 — costo por unidad convertida y lectura de temperatura exigible` (8 archivos, +426/−17)
**Estado del working tree:** hay WIP **sin commitear de Phase -1** (ver §3) + docs/planes nuevos sin trackear. **Resolver esto antes de seguir.**

> **Propósito:** que un agente nuevo, en sesión nueva, arranque sin re-descubrir
> nada. Este doc es la fuente de verdad del *estado*; el detalle de diseño vive en
> el plan de Phase 0 (`tasks/plan-closeout-pulso-1.0-phase-0.md`). No lo repito aquí.

---

## 1. Resumen ejecutivo

| Pieza | Estado |
|---|---|
| Evaluación vs los 17 módulos | 🟡 **Parcial** — reporte en `docs/reporte-cumplimiento-sistema-2026-10-17.md` |
| Matriz de 239 puntos | `docs/matriz-cumplimiento-sistema-2026-10-17.csv` (98 impl / 98 parcial / 39 base / 4 sin impl) |
| **H07 — Recepción** | ✅ **CERRADO** en `a65c6da` (costo convertido + lectura de temperatura exigible) |
| H01 Evidencia común (P0) | 🔴 Abierto — `EvidenceStore` sigue en memoria |
| H02 Excepción canónica (P0) | 🔴 Abierto — no existe tabla `exceptions` |
| H03 Nómina real | 🔴 Abierto — overtime y deducciones en cero |
| H04 Banca y conciliación | 🔴 Abierto — no existen cuentas/movimientos bancarios |
| H05 Lote de producto terminado | 🔴 Abierto — `TODO` vigente |
| H06 Correcciones venta→consumo | 🔴 Abierto — sólo consume en filas nuevas |
| H08 Mantenimiento recurrente | 🟡 Abierto — hay reader, no writer |
| H09 Auditoría / aprobaciones / RLS | 🟡 Mejorado por Phase -1; RLS sólo plan |
| H10 Cierre financiero / perfiles | 🔴 Abierto |

**Siguiente bloque:** Phase 0 — Control Core (H01 + H02 + H09). Del plan completo en
`tasks/plan-closeout-pulso-1.0-phase-0.md` (19 tareas, 4 checkpoints).

---

## 2. Cómo arrancar (orden de lectura)

1. `AGENTS.md` — reglas del repo (pnpm, Drizzle, Inngest, multi-tenant, `db:push` peligroso).
2. **Este doc** completo.
3. `docs/reporte-cumplimiento-sistema-2026-10-17.md` — hallazgos H01–H10 con evidencia.
4. `tasks/plan-closeout-pulso-1.0-phase-0.md` — plan de implementación de Phase 0 (D1–D8, tareas 1–19).
5. `docs/closeout-pulso-1.0/00-STATUS.md` — tracker del programa.
6. `git log --oneline -5` y `git status --short` — estado real antes de tocar nada.

---

## 3. WIP sin commitear (resolver primero)

Estos archivos provienen de **Phase -1 (Security Gate)** y estaban sin commitear al
generar este handoff. **No los mezcles con slice nuevos**; decide si commitearlos como
`feat(security): Phase -1 — security gate` antes de empezar Phase 0.

| Archivo | Qué contiene |
|---|---|
| `app/api/payroll/{route,run/route,validate/route}.ts` | S-1: gate ABAC `reports:read/manage` (FINANCIAL), `ctx` en vez de body |
| `app/api/notifications/{dispatch,process}/route.ts` + `lib/api/internal-auth.ts` | S-2: protección de endpoints internos |
| `lib/services/treasury-service.ts` + `lib/treasury/disbursement-policy.ts` + `lib/treasury/__tests__/dual-approval.test.ts` | S-3: doble firma con writer real sobre `payment_approvals` |
| `tasks/plan.md`, `tasks/todo.md` | trackers (ruido, revisar antes de commitear) |

Untracked relevantes que **sí** deben conservarse: `docs/closeout-pulso-1.0/`,
`docs/matriz-*.csv`, `docs/reporte-*.md`, `sistemainvestigacion17oct.md`,
`tasks/plan-closeout-pulso-1.0-phase-0.md`, `tasks/todo-closeout-pulso-1.0-phase-0.md`.

Verificación de Phase -1 (ya documentada en `PHASE--1-SECURITY-GATE.md`): `tsc` limpio,
1471 tests verdes, eslint del set tocado sin errores. Tras `a65c6da` la suite completa
está en **1487 verdes** (120 archivos).

---

## 4. Lo que se hizo en `a65c6da` (H07) — no rehacer

- `lib/services/receiving-cost.ts` (nuevo) — `convertReceivedAmount()`: divide el costo
  por el factor de conversión; conserva el valor total (2 cajas @ $1,000 ⇒ 20 kg @ $100).
- `lib/services/receiving-temperature.ts` — `requiresTemperatureReading()`,
  `evaluateReceivingTemperaturePolicy()` (`OK` / `QUARANTINE` / `MISSING_READING`) y
  `missingTemperatureReadings()`. El wrapper legacy `evaluateReceivingTemperature` sigue
  existiendo (compatibilidad).
- `lib/services/receiving-service.ts` — **pre-flight sin escrituras** en
  `processReceiving`: carga los ítems, exige lectura para `REFRIGERATED`/`FROZEN` y lanza
  antes de crear reporte/lote/stock. Excepción autorizada = motivo ≥8 chars + permiso
  `inventory:update`; se traza en `supplierBatchInfo` (`temperatureReadingMissing`,
  `temperatureExceptionReason`). `ReceivingActor` ahora acepta `role?: Role`.
- `lib/services/receiving-from-workflow.ts` — propaga `paso-temperatura` a cada línea
  del v3 (antes se descartaba).
- `app/api/inventory/receiving/route.ts` — pasa `role`.
- `components/inventory/receiving-workflow.tsx` — bloquea el envío si falta la lectura.
- Tests: `receiving-cost.test.ts` (nuevo, 7), `receiving-temperature.test.ts` (23).

---

## 5. Próximos pasos: Phase 0 — Control Core

> Regla del programa (repetida por el plan): **inspeccionar → reutilizar → no modelo
> paralelo → migración sólo si hace falta → writer y reader productivos → permisos →
> tenant-isolation test → workflow/E2E test → docs.** Y: *no se avanza de checkpoint sin
> el anterior verde.*

### Slice A (bajo riesgo, sin DB) — recomendado para empezar

| # | Tarea | Archivos | Verificación |
|---|---|---|---|
| 2 | Recurso RBAC `exceptions` | `lib/permissions.ts` + tests en `lib/rbac/__tests__/` | `hasPermission('GERENTE','exceptions','update')===true`, `EMPLEADO===false`; sin regresión en la matriz |
| 3 | Máquina de estados pura | `lib/services/exception-lifecycle.ts` + `lib/services/__tests__/exception-lifecycle.test.ts` | todas las transiciones legales/ilegales; el módulo **no importa `db`** |

Estados (D3): `OPEN → ASSIGNED → IN_ACTION → RESOLVED → VERIFIED → CLOSED`, más
`REOPENED / ESCALATED / CANCELLED`. Guardas: `RESOLVE` exige `resolution`; `VERIFY` exige
verificador ≠ resolvedor; `CLOSE` exige `VERIFIED`.

### Slice B (requiere migración) — confirmar antes de generar

| # | Tarea | Archivos | Nota |
|---|---|---|---|
| 1 | Esquema `exceptions` + migración | `lib/db/schema/exceptions.ts` (nuevo), `lib/db/schema/index.ts` | ⚠️ `pnpm db:generate`; revisar el `.sql` **a mano**; el journal de Drizzle se desincroniza (documentado en el repo). **Nunca `db:push`.** |
| 13 | Esquema `evidence` + migración | `lib/db/schema/evidence.ts` (nuevo) | La FK `exceptions.evidence_id → evidence.id` se agrega aquí (evita ciclo de migraciones) |
| 14 | `EvidenceStore` persistente | `lib/services/evidence-store.ts` | Conservar la firma pública (`store/getByEntity/getByBranch/attachMetadata`); eliminar el `Map` |

### Slice C — EPIC 0.1 completo (Adaptadores, SLA, API, UI)

Tareas 4–12 del plan. **Gate 0 (Checkpoint B):** una factura con discrepancia produce una
`exception` con owner, SLA, acción, evidencia, resolución, verificación y cierre.
Adaptador clave: `invoice_discrepancy` desde `invoices.matchStatus='DISCREPANCY'`.

### Checkpoints (del plan §5)

| CP | Cubre | Criterio |
|---|---|---|
| A | T1–T2 | Migración `exceptions` generada y revisada, `tsc` limpio, RBAC probado |
| B | T3–T12 | **Gate 0** funcional end-to-end |
| C | T13–T16 | Evidencia durable + backfill idempotente + 3 dominios vinculados |
| D | T17–T18 | Audit unificado + cobertura financiera con `reason` |

---

## 6. Estado verificado de los hallazgos abiertos (anclas para no re-investigar)

Anclas vigentes a `a65c6da`; si mueven, confirma con `codegraph_search`/`codegraph_node`.

| Hallazgo | Evidencia actual |
|---|---|
| H01 Evidencia | `lib/services/evidence-store.ts`: registro `Map` en proceso; **no existe** `lib/db/schema/evidence.ts` ni tabla/enum `evidence` |
| H02 Excepción | **no existe** `lib/db/schema/exceptions.ts`; `lib/services/group-exceptions-service.ts` sigue siendo agregador de lectura sobre 8 fuentes |
| H03 Nómina | `lib/services/payroll-service.ts` (~líneas 330/333): `overtimePayCents: 0`, `totalDeduccionesCents: 0` |
| H04 Banca | Sin símbolos `companyBankAccounts`/`bankTransactions`; `lib/db/schema/treasury.ts` (~77): `sourceAccount` es `text` libre |
| H05 Producción | `lib/services/production-service.ts` (~232): `TODO: insert into inventoryBatches for finished goods` |
| H06 Venta→consumo | `lib/services/sales-ingest-service.ts` (~166): consume sólo `if (written?.isNew)` |
| H08 Mantenimiento | `equipmentMaintenanceSchedules` se **lee** en `lib/services/equipment-service.ts` (~391); no hay writer/generador de recurrencias |
| H09 Auditoría/RLS | Sin `ENABLE ROW LEVEL SECURITY` ni `CREATE POLICY` en `drizzle/` ni `lib/`; auditoría fragmentada (`audit-service.ts`, `lib/security/audit.ts`) |
| H10 Perfiles | `lib/permissions.ts`: 7 roles; `DIRECTOR_OPS` existe como nivel de aprobador, no como rol de usuario |

---

## 7. Contratos y gotchas del repo (no romper)

- **Multi-tenant:** todo scoped por `tenantId`/`companyId`; usar `lib/tenant-context.ts`.
- **Auth:** `better-auth` + `getSession()`; en APIs modernas, `requirePermissionApi(resource, action, { classification, audit })` (ABAC en `lib/rbac/abac.ts`). El `tenantId` y `userId` salen del `ctx`, **nunca del body**.
- **Permisos:** matriz en `lib/permissions.ts` (`Resource` incluye `users|companies|branches|workflows|inventory|reports|settings|billing`). Phase 0 agrega `exceptions` como recurso propio (D6).
- **Fail-closed:** en scoping devolver `NONE` y en guardas denegar ante rol/regla desconocida (`roleIsAtLeast` ya lo hace).
- **R2 storage** con fallback local si faltan credenciales.
- **Inngest:** `INNGEST_DEV=1` para dev local; funciones en `lib/inngest/functions/` (el `serve` usa `Object.values` del índice).
- **Drizzle:** `pnpm db:generate` (migraciones) y `pnpm db:migrate`; **`pnpm db:push` puede tirar tablas**. Revisar cada `.sql` generado a mano.
- **Feature flag** previsto para lectura canónica de excepciones: `EXCEPTIONS_CANONICAL_READ` (con fallback al agregador legacy hasta Phase 7).
- **Frontend:** respetar `DESIGN.md` (Operational Red ≤15%, flat sin sombras, familia Geist).
- **Tests:** excluidos de `tsconfig`; E2E con Playwright (`pnpm test:e2e`). Vitest unitario con `--maxWorkers=2` (el entorno agota memoria con más).

---

## 8. Comandos de verificación (por incremento)

```bash
# tipos
npx tsc --noEmit --incremental false

# tests unitarios completos (el entorno agota memoria con más workers)
npx vitest run --maxWorkers=2 --reporter=dot

# lint de lo tocado
npx eslint <archivos tocados>

# build de producción (antes de declarar terminado)
pnpm run build

# E2E (requiere base de datos / staging)
pnpm test:e2e
```

Tras `a65c6da`: `tsc` limpio, **1487 passed / 1 skip / 1 todo / 0 fallos** (120 archivos),
eslint sin errores. `build` y E2E **no** se corrieron en esa sesión.

---

## 9. Definition of Done por slider (checklist)

- [ ] El cambio hace una sola cosa y la completa.
- [ ] Tests existentes verdes + test nuevo del comportamiento.
- [ ] `npx tsc --noEmit` limpio.
- [ ] `eslint` de lo tocado sin errores nuevos.
- [ ] Commit atómico con mensaje descriptivo (no mezclar con WIP ajeno).
- [ ] Para DB: migración revisada a mano + plan de rollback; nunca `db:push`.

---

## 10. Fuentes

- Requisitos: `sistemainvestigacion17oct.md`
- Evaluación: `docs/reporte-cumplimiento-sistema-2026-10-17.md` + `docs/matriz-cumplimiento-sistema-2026-10-17.csv`
- Plan Phase 0: `tasks/plan-closeout-pulso-1.0-phase-0.md` (+ `tasks/todo-closeout-pulso-1.0-phase-0.md`)
- Tracker del programa: `docs/closeout-pulso-1.0/00-STATUS.md`
- Phase -1: `docs/closeout-pulso-1.0/PHASE--1-SECURITY-GATE.md`, `PHASE--1-RLS-PLAN.md`
