# Implementation Plan — Pulso 1.0 Closeout · PHASE 0 (Control Core)

**Fecha:** 2026-10-16
**Programa:** `docs/closeout-pulso-1.0/` · auditoría `docs/auditoria-pulso-mirilla/`
**Estado previo:** Phase -1 (Security Gate) ✅ cerrado (`docs/closeout-pulso-1.0/PHASE--1-SECURITY-GATE.md`).
**Alcance:** Epic 0.1 Canonical Exception · Epic 0.2 Canonical Evidence · Epic 0.3 Audit Trail.
**Gate de salida:** una factura con discrepancia produce una `exception` con owner, SLA, acción, evidencia, resolución, verificación y cierre, **sin entidad paralela**.

> **Modo:** plan read-only. No se escribe código de producción hasta aprobación.
> Este plan respeta la regla de la fase: *inspeccionar → reutilizar → no modelo paralelo → migración solo si hace falta → writer y reader productivos → permisos → tenant-isolation test → workflow/E2E test → docs*.

---

## 1. Overview

Phase 0 extrae las **dos primitives que Pulso ya usa pero no tiene como entidad**:

1. **`exceptions`** — hoy `GroupExceptionsService.listOpen()` es un agregador de lectura sobre 8 fuentes (`incidents`, `compliance_alerts`, `equipment_alerts`, `nom035_action_plans`, `shift_approvals`, `shift_change_requests`, `inventory_alerts`, `daily_sales_cuts`), sin lifecycle, sin owner persistido, sin SLA, sin resolución verificable. Se crea la tabla canónica + servicio con lifecycle, y **adaptadores idempotentes** que proyectan las fuentes actuales hacia ella. Las fuentes **no se eliminan**: siguen siendo la verdad de dominio; `exceptions` es la capa transversal de control.

2. **`evidence`** — hoy `EvidenceStore` es un **registro in-process no durable** (`lib/services/evidence-store.ts`, comentario explícito: *"Persistence into a dedicated `evidence` table … deferred"*), y la evidencia real vive embebida en `workflow_instance_steps.evidence_url`, `incidents.photo_url`, `service_order_evidence`, `operating_expenses.evidenceUrl`. Se persiste la tabla y se hace write-through manteniendo `evidenceUrl` por compatibilidad.

3. **Audit trail unificado** — lectura única sobre `employee_audit_logs` + `inventory_audit_log` + `data_access_logs` + `config_change_logs`, y evidencia `who/what/when/before/after/reason` en acciones financieras críticas.

**Por qué P0:** todo el resto del closeout usa `exception` como salida de anomalía y `evidence` como prueba (grafo `09-PULSO-DOMAIN-DEPENDENCY-GRAPH.md` §5). Phase 1 (AP→Payment→Settlement) depende de ambas.

---

## 2. Architecture Decisions

### D1 — `exceptions` es aditiva, no sustituta (compatibilidad total)
La tabla se puebla por **upsert idempotente** con clave única `(company_id, subject_type, subject_id)`. Cada dominio conserva su writer y su pantalla. `GroupExceptionsService` pasa a leer de `exceptions` **detrás de flag** (`EXCEPTIONS_CANONICAL_READ`), con fallback al agregador legacy; se retira el fallback en Phase 7, no aquí.

### D2 — Vocabulario canónico = el que ya existe (no inventar enums nuevos)
Se reutiliza literalmente el vocabulario de `lib/services/group-exceptions-service.ts`:
- `ExceptionDomain` = `operacion | cumplimiento | equipos | personal | inventario | finanzas`
- `ExceptionSeverity` = `info | warning | high | critical | fatal`
- `QsrRiskCategory` = `DINERO | INOCUIDAD | ABASTO | PERSONAL`

Así la UI (`app/dashboard/exceptions/page.tsx`) y sus mapas `SEVERITY_LABELS/STYLES`, `CATEGORY_STYLES` no cambian.

### D3 — Lifecycle como máquina de estados pura y testeable
`lib/services/exception-lifecycle.ts` = función pura `transition(from, event, ctx) → { ok, to } | { ok:false, reason }`. El servicio (`exception-service.ts`) solo aplica. Los tests de transiciones corren sin DB.

```
OPEN → ASSIGNED → IN_ACTION → RESOLVED → VERIFIED → CLOSED
  └──────────────┴───────────┴──────────┴───────────┴→ REOPENED
  └→ ESCALATED (desde cualquier estado no terminal)
  └→ CANCELLED (desde cualquier estado no terminal)
```

### D4 — Adaptadores idempotentes dirigidos, no "sync en lectura"
Los adaptadores leen una fuente y producen un `RaiseExceptionInput`. Se ejecutan por **Inngest durable** (cron cada 10 min) + trigger on-demand (`POST /api/exceptions/sync`) + hook tras discrepancias de 3-way match. **Nunca** dentro de `listOpen` (nada de escrituras en un GET).

### D5 — `evidence` con write-through, no ruptura
`EvidenceStore` cambia su `Map` in-process por la tabla `evidence`, conservando la firma pública (`store`, `getByEntity`, `getByBranch`, `attachMetadata`). `workflow_instance_steps.evidence_url` sigue escribiéndose; el backfill crea las filas canónicas. La subida a R2 no cambia.

### D6 — Permisos: nuevo recurso RBAC `exceptions`, scoping por sucursal reutilizado
Se agrega `'exceptions'` al union `Resource` de `lib/permissions.ts` (no es modelo paralelo: es el catálogo existente). Lectura: cualquier rol con acceso al dashboard, acotado por `resolveBranchScope`. Escritura de ciclo: `ADMIN`/`GERENTE`(+`SUPER_ADMIN`). Excepciones `domain='finanzas'` exigen clasificación `FINANCIAL`. `verify` **no puede** ser el mismo usuario que `resolve` (segregación de funciones, mismo patrón que `denyExpenseResolution`). El acceso a un `evidence` hereda el permiso de su `subject`.

### D7 — SLA: política pura con defaults, configurable después
No hay campos de SLA en `tenant_operating_config` (verificado). `lib/services/exception-sla.ts` define `severidad → ventana` con defaults (`fatal/critical` = 30 min, `high` = 4 h, `warning` = 24 h, `info` = 72 h). Se documenta como extensible a config sin migrar aún.

### D8 — Escritura financiera auditada reutilizando lo existente
No se crea bitácora nueva. `AuditService` (empleado/inventario), `lib/security/audit.ts` (`data_access_logs`) y `config_change_logs` siguen siendo los writers; Phase 0 agrega una **vista de lectura unificada** y exige `before/after/reason` en las acciones financieras críticas.

---

## 3. Dependency Graph

```
[RBAC 'exceptions']──┐
                     ├──►[API excepciones]──►[UI feed]
[exceptions schema]──┤
      │              └──►[GroupExceptionsService lee canónico]
      ├──►[exception-lifecycle (puro)]──►[exception-service]──►[adaptadores]──►[Inngest sync]
      │                                                              │
      │                                                              └──►[invoice discrepancy adapter]
      │
      └──►[domain_events al crear/cerrar]

[evidence schema]──►[EvidenceStore persistente]──►[backfill workflow steps]──►[vínculos subject]
                                                                    │
                                                                    └──►[exception.evidence_id]

[audit-trail-service (lectura unificada)]──►[audit financiero before/after/reason]
```

**Orden:** schema → servicio puro → servicio DB → adaptadores → sync durable → API → UI → integración con fuentes.

---

## 4. Task List

### Phase 0.A — Fundación de esquema (bloquea todo)

#### Task 1: Esquema `exceptions` + migración
**Description:** Crear `lib/db/schema/exceptions.ts` con enums (`exception_domain`, `exception_severity`, `exception_status`, `qsr_risk_category`) y la tabla `exceptions`. Exportar desde `lib/db/schema/index.ts` (que `lib/db/schema.ts` ya re-exporta en línea 21). Generar migración con `pnpm db:generate`.

Columnas: `id`, `company_id` (FK companies, not null), `branch_id` (nullable), `domain`, `qsr_category`, `subject_type`, `subject_id`, `severity`, `reason`, `status` (default `OPEN`), `owner_id`, `sla_due_at`, `action_meta jsonb`, `resolution`, `resolved_by`, `resolved_at`, `verified_by`, `verified_at`, `closed_at`, `evidence_id` (nullable, FK diferida a `evidence` en Task 11), `reopened_from_id`, `metadata jsonb`, `created_at`, `updated_at`.
Índices: único `(company_id, subject_type, subject_id)`; búsqueda `(company_id, status, severity, sla_due_at)`; `(company_id, branch_id, status)`.

**Acceptance criteria:**
- [ ] `pnpm db:generate` produce `drizzle/0099_*.sql` con la tabla y enums; sin SQL destructivo.
- [ ] El índice único `(company_id, subject_type, subject_id)` existe en el SQL generado.
- [ ] `npx tsc --noEmit` limpio.

**Verification:** `pnpm db:generate && npx tsc --noEmit`; revisar el `.sql` a mano (regla `db:push` es peligroso).
**Dependencies:** None.
**Files likely touched:** `lib/db/schema/exceptions.ts` (nuevo), `lib/db/schema/index.ts`, `drizzle/0099_*.sql` + `drizzle/meta/*`.
**Estimated scope:** M (3–5 archivos).

#### Task 2: Recurso RBAC `exceptions`
**Description:** Agregar `'exceptions'` a `Resource` en `lib/permissions.ts` y poblarlo en la matriz de roles con la política de D6 (SUPER_ADMIN/ADMIN: manage; GERENTE: read+update; SUPERVISOR: read+update; EMPLEADO/READONLY: read).
**Acceptance criteria:**
- [ ] `hasPermission('GERENTE','exceptions','update') === true` y `hasPermission('EMPLEADO','exceptions','update') === false`.
- [ ] Ningún rol existente pierde permisos (test de no-regresión sobre la matriz).
**Verification:** `pnpm test:unit -- lib/rbac`.
**Dependencies:** None.
**Files likely touched:** `lib/permissions.ts`, `lib/rbac/__tests__/*`.
**Estimated scope:** S (1–2 archivos).

**Checkpoint A:** migración generada, tipos limpios, RBAC probado.

---

### Phase 0.B — Epic 0.1 Canonical Exception

#### Task 3: Máquina de estados pura
**Description:** `lib/services/exception-lifecycle.ts` con `transition(from, event)` para `ASSIGN/START_ACTION/RESOLVE/VERIFY/CLOSE/REOPEN/ESCALATE/CANCEL` y guardas: no `VERIFY` sin `RESOLVED`; no `CLOSE` sin `VERIFIED`; `RESOLVED` exige `resolution`; `VERIFY` exige verificador ≠ resolvedor.
**Acceptance criteria:**
- [ ] Toda transición legal e ilegal del diagrama D3 cubierta por test.
- [ ] El módulo no importa `db` (test sin mocks de base).
**Verification:** `pnpm test:unit -- exception-lifecycle`.
**Dependencies:** None (paralelizable con Task 1/2).
**Files likely touched:** `lib/services/exception-lifecycle.ts`, `lib/services/__tests__/exception-lifecycle.test.ts`.
**Estimated scope:** S.

#### Task 4: `exception-service` (writer/reader productivo)
**Description:** `raise`, `assign`, `startAction`, `resolve`, `verify`, `close`, `reopen`, `escalate`, `cancel`, `getById`, `list`, `listOpen`. `raise` hace upsert idempotente por `(company_id, subject_type, subject_id)`; calcula `sla_due_at` (Task 6) y emite `domain_events` (`EXCEPTION_RAISED` / `EXCEPTION_CLOSED`) vía `emitDomainEvent`. Toda mutación escribe audit (Task 15).
**Acceptance criteria:**
- [ ] `raise` dos veces con el mismo subject → una sola fila, `reason` actualizado.
- [ ] `verify` por el resolvedor → `ApiError`/`Error` de segregación.
- [ ] `listOpen(companyId, {branchId})` filtra por empresa y sucursal.
**Verification:** `pnpm test:unit -- exception-service`.
**Dependencies:** Tasks 1, 3.
**Files likely touched:** `lib/services/exception-service.ts`, `lib/services/__tests__/exception-service.test.ts`.
**Estimated scope:** M.

#### Task 5: Adaptadores (parte 1 — alertas de dominio)
**Description:** `lib/services/exception-adapters/` con registro y helper `upsertFromSource`. Adaptadores: `incident` (reusa `classifyQsrIncident` extraído de `GroupExceptionsService`), `inventory_alert`, `compliance_alert`, `equipment_alert`. Preservan mapeos de severidad existentes (`normalizeIncidentSeverity`, `normalizeInventorySeverity`, `normalizeEquipmentSeverity`).
**Acceptance criteria:**
- [ ] Cada adaptador convierte una fila real → `RaiseExceptionInput` con `subject_type` estable y `reason` no vacío.
- [ ] Correr el adaptador dos veces sobre la misma fuente no duplica.
**Verification:** `pnpm test:unit -- exception-adapters`.
**Dependencies:** Task 4.
**Files likely touched:** `lib/services/exception-adapters/{index,incident,inventory-alert,compliance-alert,equipment-alert}.ts`, tests.
**Estimated scope:** M.

#### Task 6: SLA + owner
**Description:** `lib/services/exception-sla.ts` (severidad→ventana, defaults de D7) y resolución de owner por defecto (gerente de la sucursal vía `branch-scope`/`users`), reutilizando `EscalationService` para notificar al cruzar SLA.
**Acceptance criteria:**
- [ ] `sla_due_at` se calcula al crear y al escalar.
- [ ] Excepción sin owner explícito recibe el gerente de sucursal o queda `OPEN` sin owner (nunca owner de otra empresa).
**Verification:** `pnpm test:unit -- exception-sla`.
**Dependencies:** Task 4.
**Files likely touched:** `lib/services/exception-sla.ts`, `lib/services/exception-service.ts`, tests.
**Estimated scope:** S.

#### Task 7: Adaptadores (parte 2 — personal/money/discrepancia)
**Description:** `nom035_action_plan`, `shift_approval`, `shift_change_request`, `cash_variance` (desde `daily_sales_cuts`, misma fórmula `|cashSales - cashCountedCents| >= 10000`), e **`invoice_discrepancy`** (nuevo: `invoices.matchStatus = 'DISCREPANCY'` → excepción con owner/SLA; hoy solo existe el campo). Este último es el acceptance del Gate 0.
**Acceptance criteria:**
- [ ] Factura con `matchStatus='DISCREPANCY'` produce excepción con `domain='finanzas'`, `qsr_category='DINERO'`, owner y SLA.
- [ ] Excepción autorizada (`EXCEPTION_APPROVED`) cierra/actualiza la excepción, no la duplica.
**Verification:** `pnpm test:unit -- exception-adapters` + test de caso `invoice_discrepancy`.
**Dependencies:** Task 5.
**Files likely touched:** `lib/services/exception-adapters/*` (5 archivos + test).
**Estimated scope:** M.

#### Task 8: Sync durable + trigger
**Description:** `lib/inngest/functions/exceptions-sync.ts`: cron `*/10 * * * *` que recorre empresas/sucursales y ejecuta adaptadores; expuesto vía `lib/inngest/functions/index.ts` (el `serve` usa `Object.values`). Evento `exceptions/sync.requested` para disparo on-demand. Logs `started/completed/failed/retrying`.
**Acceptance criteria:**
- [ ] La función aparece en `/api/inngest` al registrar el módulo.
- [ ] Un fallo en un adaptador no aborta los demás (aislamiento por adaptador).
**Verification:** `npx tsc --noEmit`; `INNGEST_DEV=1 pnpm run dev` + revisar registro.
**Dependencies:** Tasks 5, 7.
**Files likely touched:** `lib/inngest/functions/exceptions-sync.ts`, `lib/inngest/functions/index.ts`.
**Estimated scope:** M.

#### Task 9: API de excepciones
**Description:** `app/api/exceptions/route.ts` (GET lista con filtros domain/severity/status/branch, POST raise manual), `app/api/exceptions/[id]/route.ts` (GET), `[id]/{assign,resolve,verify,close}/route.ts`, `app/api/exceptions/sync/route.ts`. Scoping con nuevo `lib/api/exception-access.ts` (espejo de `lib/api/incident-access.ts`, pero `exceptions` sí tiene `company_id`, así que el filtro es directo). Guardas de D6.
**Acceptance criteria:**
- [ ] Un GERENTE no lee ni muta excepciones de otra sucursal (`NONE` fail-closed).
- [ ] Un usuario de otra empresa recibe 404 (no distingue inexistente de ajeno).
- [ ] `verify` por el mismo que resolvió → 403.
**Verification:** `pnpm test:unit -- api/exceptions` + `tests/api/exceptions-tenant-isolation.spec.ts` (Playwright).
**Dependencies:** Tasks 2, 4, 6.
**Files likely touched:** `app/api/exceptions/**` (6–7 archivos), `lib/api/exception-access.ts`.
**Estimated scope:** M.

#### Task 10: `GroupExceptionsService` lee canónico
**Description:** Añadir `exceptions` como fuente primaria detrás de flag `EXCEPTIONS_CANONICAL_READ`; fallback al agregador legacy. Derivar `deepLinkUrl`/`action` desde `action_meta` o `subject_type` (mapa), no almacenarlos.
**Acceptance criteria:**
- [ ] Con flag ON, el feed devuelve filas de `exceptions` con el mismo shape `GroupException`.
- [ ] Con flag OFF, comportamiento idéntico al actual (test existente verde).
**Verification:** `pnpm test:unit -- group-exceptions-service`.
**Dependencies:** Tasks 4, 7.
**Files likely touched:** `lib/services/group-exceptions-service.ts`, `lib/services/__tests__/group-exceptions-service.test.ts`.
**Estimated scope:** M.

#### Task 11: UI de lifecycle
**Description:** Sobre el feed existente (`app/dashboard/exceptions/page.tsx`), agregar columnas owner/SLA y acciones `Asignar / Iniciar acción / Resolver / Verificar / Cerrar` (reutiliza `SEVERITY_STYLES`, `CATEGORY_STYLES`). Respetar `DESIGN.md` (Operational Red ≤15%, sin sombras).
**Acceptance criteria:**
- [ ] Un `GERENTE` puede resolver y un `ADMIN` verificar desde la UI.
- [ ] Excepción cerrada desaparece del feed abierto.
**Verification:** `pnpm run build` + revisión manual en `/dashboard/exceptions`.
**Dependencies:** Task 9.
**Files likely touched:** `app/dashboard/exceptions/page.tsx`, `components/exceptions/*`.
**Estimated scope:** M.

#### Task 12: Hook en 3-way match + incidents
**Description:** Al persistir `matchStatus='DISCREPANCY'` en `invoice-matching-service` y al crear un `incident` en `incident-engine`, disparar `exceptions/sync.requested` (evento Inngest) para proyección inmediata, sin acoplar el dominio a la tabla.
**Acceptance criteria:**
- [ ] La excepción aparece en <1 s del match sin esperar el cron (en dev).
- [ ] Si Inngest está caído, el cron la recoge igual (degradación, no pérdida).
**Verification:** test de integración `invoice-matching-exception` extendido.
**Dependencies:** Task 8.
**Files likely touched:** `lib/services/invoice-matching-service.ts`, `lib/services/incident-engine.ts`, tests.
**Estimated scope:** S.

**Checkpoint B (Gate 0 funcional):** factura con discrepancia → excepción → owner → SLA → acción → resolución → verificación → cierre. `pnpm test:unit` verde.

---

### Phase 0.C — Epic 0.2 Canonical Evidence

#### Task 13: Esquema `evidence` + migración
**Description:** `lib/db/schema/evidence.ts` con enum `evidence_kind` (`PHOTO|DOCUMENT|RECEIPT|TEMPERATURE|TEXT|VIDEO|SYSTEM`) y tabla `evidence`: `id`, `company_id`, `branch_id`, `subject_type`, `subject_id`, `kind`, `storage_key`, `url`, `mime_type`, `content jsonb`, `ai_analysis jsonb`, `verified_by`, `verified_at`, `created_by`, `created_at`. Índice `(company_id, subject_type, subject_id)`. Exportar en `schema/index.ts`. Generar `0100_*.sql` y luego añadir FK diferida `exceptions.evidence_id → evidence.id` (Task 1 lo dejó nullable sin FK para evitar dependencia circular de migraciones).
**Acceptance criteria:**
- [ ] `0100_*.sql` crea tabla + enum + índice; la FK de `exceptions.evidence_id` se agrega aquí.
- [ ] `npx tsc --noEmit` limpio.
**Verification:** `pnpm db:generate && npx tsc --noEmit`.
**Dependencies:** Task 1.
**Files likely touched:** `lib/db/schema/evidence.ts`, `lib/db/schema/index.ts`, `lib/db/schema/exceptions.ts`, `drizzle/0100_*.sql`.
**Estimated scope:** M.

#### Task 14: `EvidenceStore` persistente
**Description:** Reescribir `lib/services/evidence-store.ts` para leer/escribir la tabla `evidence` conservando la firma pública y la subida a R2. Eliminar el `Map` in-process. `__resetForTests` pasa a limpiar por `companyId`.
**Acceptance criteria:**
- [ ] `store()` persiste; `getByEntity()` recupera entre procesos.
- [ ] Sin R2 configurado, el fallback `local://` sigue funcionando.
**Verification:** `pnpm test:unit -- evidence-store`.
**Dependencies:** Task 13.
**Files likely touched:** `lib/services/evidence-store.ts`, `lib/services/__tests__/evidence-store.test.ts` (nuevo).
**Estimated scope:** M.

#### Task 15: Backfill de evidencia embebida
**Description:** `scripts/backfill-evidence.ts` idempotente: `workflow_instance_steps.evidence_url` → `evidence(subject_type='workflow_step')`; `incidents.photo_url` → `subject_type='incident'`; `service_order_evidence` → `subject_type='service_order'`. Reporte de conteos.
**Acceptance criteria:**
- [ ] Correr dos veces no duplica (clave natural `(subject_type, subject_id, storage_key/url)`).
- [ ] Conteo antes/después reportado.
**Verification:** `npx tsx scripts/backfill-evidence.ts` (dry-run) + test de idempotencia.
**Dependencies:** Task 14.
**Files likely touched:** `scripts/backfill-evidence.ts`, test.
**Estimated scope:** S.

#### Task 16: Vínculos de evidencia por subject
**Description:** Permitir que `exceptions`, `operating_expenses` y `invoices` referencien `evidence.id`. `resolveException` acepta `evidenceId`; `expense-service` y subida de factura escriben fila en `evidence` además de su `evidenceUrl`.
**Acceptance criteria:**
- [ ] Un gasto, un paso de workflow y una excepción apuntan a la misma primitive.
- [ ] `evidenceUrl` legacy sigue poblado (write-through).
**Verification:** `pnpm test:unit -- evidence` + `tests/gasto-evidencia.spec.ts` verde.
**Dependencies:** Tasks 4, 14.
**Files likely touched:** `lib/services/exception-service.ts`, `lib/services/expense-service.ts`, `app/api/inventory/invoices/upload/route.ts`, tests.
**Estimated scope:** M.

**Checkpoint C:** evidencia durable y referenciable por 3 dominios; backfill idempotente.

---

### Phase 0.D — Epic 0.3 Audit Trail

#### Task 17: Lectura unificada de auditoría
**Description:** `lib/services/audit-trail-service.ts` que une `employee_audit_logs`, `inventory_audit_log`, `data_access_logs`, `config_change_logs` en un shape común (`who/what/when/before/after/reason/source`) con paginación y filtros; API `GET /api/audit/trail` con guardas.
**Acceptance criteria:**
- [ ] Devuelve filas de las 4 fuentes ordenadas por tiempo.
- [ ] Acotado por `company_id`; un GERENTE solo ve su sucursal.
**Verification:** `pnpm test:unit -- audit-trail-service` + test de permission.
**Dependencies:** Task 2.
**Files likely touched:** `lib/services/audit-trail-service.ts`, `app/api/audit/trail/route.ts`, tests.
**Estimated scope:** M.

#### Task 18: Cobertura financiera `before/after/reason`
**Description:** Asegurar que las acciones críticas registren auditoría: aprobación de factura/excepción de match, aprobación de gasto, aprobación de pago, liquidación de partida, ejecución de nómina y (cuando exista, Phase 5) conciliación. Reutiliza `AuditService`/`logDataAccess`; no crear bitácora nueva.
**Acceptance criteria:**
- [ ] Cada acción crítica produce ≥1 registro con `reason` no vacío.
- [ ] Test que falla si falta el `reason`.
**Verification:** `pnpm test:unit -- audit-coverage`.
**Dependencies:** Task 17.
**Files likely touched:** `lib/services/{expense,treasury,payroll,invoice-matching}-service.ts`, tests.
**Estimated scope:** M.

**Checkpoint D (Gate 0):** demo end-to-end de factura con discrepancia con traza de auditoría completa en `exceptions` + `evidence` + `audit`.

---

### Phase 0.E — Cierre de fase

#### Task 19: Documentación y tracker
**Description:** Crear `docs/closeout-pulso-1.0/PHASE-0-CONTROL-CORE.md` (qué se hizo, decisiones, evidencia) y actualizar `docs/closeout-pulso-1.0/00-STATUS.md` (Phase 0 → ✅). Documentar el flag `EXCEPTIONS_CANONICAL_READ` y el retiro pendiente del agregador legacy (Phase 7).
**Acceptance criteria:**
- [ ] `00-STATUS.md` marca Phase 0 cerrado con base en los gates A–D.
- [ ] Queda escrito el inventario de fallbacks a retirar en Phase 7.
**Verification:** revisión del doc; `git status` sin cambios no intencionales.
**Dependencies:** Tasks 1–18.
**Files likely touched:** `docs/closeout-pulso-1.0/00-STATUS.md`, `docs/closeout-pulso-1.0/PHASE-0-CONTROL-CORE.md`.
**Estimated scope:** S.

---

## 5. Checkpoints resumidos

| Checkpoint | Cubre | Criterio |
|---|---|---|
| A | T1–T2 | Migración `exceptions` generada, tsc limpio, RBAC probado |
| B | T3–T12 | **Gate 0**: discrepancia → excepción → owner/SLA → acción → resolución → verificación → cierre |
| C | T13–T16 | Evidencia durable + backfill idempotente + 3 dominios vinculados |
| D | T17–T18 | Audit unificado + cobertura financiera con `reason` |
| Cierre | T19 | Docs y tracker actualizados |

---

## 6. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Doble escritura durante migración | Alto | Upsert idempotente por `(company_id, subject_type, subject_id)`; flag de lectura con fallback |
| Adaptadores escribiendo en un GET | Alto | Prohibido por diseño (D4); sync solo por Inngest/trigger |
| `evidence_id` FK circular entre migraciones | Medio | Task 1 crea la columna sin FK; Task 13 agrega la FK |
| `drizzle-kit generate` se desincroniza del journal (documentado en repo) | Medio | Revisar el `.sql` a mano; nunca `db:push` |
| SLA hardcodeado molesta al cliente | Bajo | Defaults en módulo puro; extensible a `tenant_operating_config` sin migrar |
| Ruptura del feed de excepciones | Medio | `GroupExceptionsService` mantiene fallback legacy hasta Phase 7 |
| RLS aún no aplicada (Phase -1.4) | Medio | Scoping de app fail-closed (`NONE`) + tests de aislamiento; RLS en fase propia |
| Volumen de excepciones (cron cada 10 min sobre 8 fuentes) | Bajo | Índices por `(company_id, status, severity)`; sync incremental por `updated_at` |

---

## 7. Open Questions

1. **Ventana de backfill histórico:** ¿proyectar solo fuentes abiertas o también resueltas de los últimos N días? (Propuesta: abiertas + 30 días.)
2. **Owner por defecto:** ¿`users.id` del gerente de sucursal, o un rol (`GERENTE`) sin usuario? (Propuesta: usuario, con fallback a sin-owner.)
3. **¿Añadir `'exceptions'` como recurso RBAC o reutilizar `reports`?** (Propuesta: recurso propio, ya incluido en T2.)
4. **Umbrales SLA:** ¿los defaults de D7 son aceptables o quieres definirlos por dominio desde ya?
5. **`EXCEPTIONS_CANONICAL_READ`:** ¿flag de entorno o columna en `tenant_operating_config` para permitir rollout por cliente?

---

## 8. Fuera de alcance (explícito)

- Retiro físico de `GroupExceptionsService` legacy y de `evidenceUrl` → **Phase 7**.
- RLS en Postgres → fase propia (`PHASE--1-RLS-PLAN.md`).
- Pago de factura reconectado, approval engine, cost centers, pre-nómina, producción, banco → **Phases 1–5**.
- `payment_approvals` (doble firma) → ya resuelto en Phase -1.
