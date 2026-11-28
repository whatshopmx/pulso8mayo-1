# Evidencia de aceptación — `APR-01` y sus 5 hijos (`APR-01.compra`, `APR-01.factura`, `APR-01.gasto`, `APR-01.pago`, `APR-01.nomina`)

- **Fecha:** 2026-11-27
- **Base Git (`HEAD`):** `6c46701d49f5c4517436cc9ebff9ba7c1ff57a1f` (+ cambios locales de `APR-01`)
- **Tickets cubiertos:**
  - `APR-01.compra` — *Aprobación de compra (`OC`/`OS`): actor, capacidad, sucursal, motivo, evidencia y concurrencia* (`I / M`, `V1, V2, V3`)
  - `APR-01.factura` — *Aprobación de factura (`INVOICE`): actor, capacidad, sucursal, motivo, evidencia y concurrencia* (`I / M`, `V1, V2, V3`)
  - `APR-01.gasto` — *Aprobación de gasto (`EXPENSE`): actor, capacidad, sucursal, motivo, evidencia y concurrencia* (`I / M`, `V1, V2, V3`)
  - `APR-01.pago` — *Aprobación de pago (`PAYMENT_RUN`): actor, capacidad, sucursal, motivo, evidencia y concurrencia* (`I / M`, `V1, V2, V3`)
  - `APR-01.nomina` — *Aprobación de nómina (`PAYROLL`): actor, capacidad, sucursal, motivo, evidencia y concurrencia* (`I / M`, `V1, V2, V3`)
  - `APR-01` — *Alinear aprobación de documentos* (`I / P`, depende de `AUD-02, NOM-03, BAN-04`, `V1, V2, V3`)
- **Estado:** `aceptado` en entorno aislado (`V1, V2, V3`).

## Cambios implementados

1. **Contrato puro de versión aprobada, autoridad, alcance de sucursal, motivo e invalidación material (`lib/services/document-approval-rules.ts`):**
   - `extractCanonicalMaterialSnapshot` y `canonicalStringify` (con llaves ordenadas recursivamente, invariante al reordenamiento de PostgreSQL `jsonb`) calculan `materialFingerprint` (SHA-256) para los 6 documentos (`OC`, `OS`, `INVOICE`, `EXPENSE`, `PAYMENT_RUN` y `PAYROLL` reutilizando `inputFingerprint` de `NOM-03`), excluyendo campos cosméticos (`notes`, `title`, `dueDate`, `technicalReport`, `folio`, `serie`, `exceptionReason`).
   - `detectMaterialChange` identifica exactamente qué campos materiales cambiaron (`changedFields`).
   - `validateDeclaredAuthority` exige rol mínimo (`roleIsAtLeast`), alcance de sucursal (`BranchScope`: `ALL`/`BRANCH`/`NONE` fail-closed, impidiendo aprobar documentos de otra sucursal o corporativos desde un rol acotado), segregación de funciones (conservando únicamente la especialización ejecutiva `OWNER`/`SUPER_ADMIN` en `EXPENSE` de `approval-policy.ts`), motivo válido cuando aplica y segundo firmante distinto cuando `requiresDualApproval === true`.
   - `auditEntityTypeForDocument` enlaza cada tipo a las 5 entradas del catálogo crítico `AUD-02`: `APPROVAL_PURCHASE`, `APPROVAL_INVOICE`, `APPROVAL_EXPENSE`, `APPROVAL_PAYMENT` y `APPROVAL_PAYROLL`.
2. **Persistencia canónica y migración candidata (`lib/db/schema/document-approvals.ts`, `lib/db/schema/index.ts`, `drizzle/0170_apr01_document_approvals.sql`, `drizzle/meta/_journal.json`):**
   - Tabla `document_approvals` con `doc_type IN ('OC','OS','INVOICE','EXPENSE','PAYMENT_RUN','PAYROLL')`, `branch_id`, `approval_version` monotónica, `approval_reason`, `evidence_id`, índice único parcial `WHERE status = 'APPROVED'` (máximo una versión aprobada activa por documento), RLS + `FORCE ROW LEVEL SECURITY` y grants a `pulso_app`.
3. **Servicio atómico, concurrencia, bandeja unificada y API HTTP (`lib/services/document-approval-service.ts`, `lib/services/unified-approval-inbox-service.ts`, `app/api/finance/approvals/documents/route.ts`):**
   - `recordDocumentApproval` serializa con `pg_advisory_xact_lock`, valida `expectedVersion` con rechazo `409 Conflict` ante carrera concurrente, es idempotente ante misma huella material sin `expectedVersion`, persiste `branchId`/`evidenceId`/`approvalReason` y escribe auditoría `AUD-02` atómica.
   - `checkAndInvalidateOnMaterialChange` conserva la aprobación ante cambios cosméticos; ante cambio material marca `INVALIDATED`, sincroniza cada especialización (`OC → PENDING_APPROVAL`, `OS → DRAFT`, `INVOICE → DISCREPANCY` limpiando excepción, `EXPENSE → PENDING_APPROVAL`, `PAYMENT_RUN → PENDING_APPROVAL` + `payment_approvals → REJECTED`, `PAYROLL → STALE_REQUIRES_NEW_SNAPSHOT`) y escribe `AUD-02` en la misma transacción.
   - `unified-approval-inbox-service.ts` incorpora `PAYROLL` (`DRAFT`, autoridad `>= ADMIN`) junto a `OC`, `OS`, `EXPENSE` y `PAYMENT_RUN`.
   - `GET/POST /api/finance/approvals/documents` aplica RBAC financiero (`reports:read` / `reports:update`), deriva `actorScope` exclusivamente desde la sesión (`resolveBranchScope`), expone versión/autoridad/sucursal/evidencia/historial y propaga `403`/`400`/`409`.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 + V3 HTTP + regresiones de especializaciones | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/apr01-document-approvals-rules.test.ts tests/unit/finance/apr01-document-approvals-http-v3.test.ts lib/services/__tests__/unified-approval-inbox-service.test.ts lib/services/approval-matrix-service.test.ts lib/treasury/__tests__/dual-approval.test.ts` | **PASS (45/45)** — reglas puras de los 6 tipos (`OC`/`OS`/`INVOICE`/`EXPENSE`/`PAYMENT_RUN`/`PAYROLL`), invarianza `jsonb`, autoridad/sucursal/motivo/doble firma, contrato HTTP `GET`/`POST` (`403`/`400`/`409`/`200`) + 25/25 `approval-matrix` + 10/10 `dual-approval` + 5/5 `unified-approval-inbox`. |
| V2 Neon (esquema efímero `apr01_<hex>` + `0170` + `NOBYPASSRLS`) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/apr01-document-approvals-db.test.ts` | **PASS (1/1)** — aprobación v1 en los 6 tipos (`OC`, `OS`, `INVOICE`, `EXPENSE`, `PAYMENT_RUN`, `PAYROLL`), bloqueo por sucursal (`403`), persistencia de `evidenceId` y `approvalReason`, idempotencia, cambio cosmético sin invalidar (contra reordenamiento `jsonb` real de Postgres), invalidación material sincronizando las 6 especializaciones (`INVOICE → DISCREPANCY`), re-aprobación v2 preservando v1, 5 tipos críticos `AUD-02`, carrera real en 2 conexiones simultáneas (`expectedVersion: 0` → 1 gana, 1 recibe `409 Conflict`), rollback atómico ante fallo FK y aislamiento RLS real bajo rol `NOBYPASSRLS`. |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/db/schema/document-approvals.ts lib/db/schema/index.ts lib/services/document-approval-rules.ts lib/services/document-approval-service.ts lib/services/unified-approval-inbox-service.ts app/api/finance/approvals/documents/route.ts lib/services/__tests__/apr01-document-approvals-rules.test.ts tests/unit/finance/apr01-document-approvals-http-v3.test.ts tests/integration/apr01-document-approvals-db.test.ts` | **PASS (0 errors, 0 warnings)** |
| TypeScript (`tsc`) | `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **PASS (exit 0, 0 diagnósticos)** |

## Límites explícitos

- La migración candidata `0170_apr01_document_approvals.sql` se verificó exclusivamente en un esquema efímero aislado (`apr01_<hex>`) sobre Neon sin mutar `public` ni desplegar en producción (`OPS-03`).
- `Puerta 4` permanece abierta hasta completar `EXC-04.merma` (dependiente de `INV-04` en Frente 5); el cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
