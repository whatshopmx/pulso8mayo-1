# INV-01.c.recovery.decision.service — Decisión administrativa independiente ligada a propuesta y estado verificado

Fecha: 2026-11-15.
Pista de trabajo: Track A2 (Ola 2) bajo INV-01.c.recovery.
Archivos de propiedad exclusiva (estrictamente 5 archivos):
1. `lib/services/sale-recovery-decision.ts` (NUEVO)
2. `app/api/inventory/sales-entry/recovery-decisions/route.ts` (NUEVO)
3. `lib/services/__tests__/sale-recovery-decision.test.ts` (NUEVO)
4. `tests/integration/sale-recovery-decision-db.test.ts` (NUEVO)
5. `tasks/evidencia/2026-11-11/INV-01.c.recovery.decision.service/README.md` (NUEVO)

Cero modificaciones a esquemas, migraciones o journals: la tabla `sale_recovery_decisions` y sus restricciones ya estaban completas en `lib/db/schema.ts` y migración `0143_inv01c_recovery_review.sql`.

---

## 1. Diseño y Arquitectura de la Solución

### 1.1 Contrato Estricto y Carga de Estado del Servidor
- El cliente HTTP proporciona **únicamente** `{ branchId, proposalId, decision }` donde `decision` es `'APPROVED' | 'REJECTED'`.
- La validación con Zod utiliza `.strict()`, rechazando cualquier intento del cliente de inyectar hashes (`proposalHash`, `stateHash`), solicitante (`requestedBy`), decisor (`decidedBy`), rol (`approverRole`), empresa (`companyId`) o marcas de tiempo (`decidedAt`).
- El servidor carga la propuesta desde la base de datos dentro de una transacción con aislamiento `serializable` y contexto de tenant (`setTenantContext`).
- Se recalculan canónicamente los hashes de la propuesta almacenada mediante `prepareSaleRecoveryReview(proposal)` para verificar su integridad antes de cualquier decisión.

### 1.2 Segregación Obligatoria de Funciones (Segregation of Duties)
- El decisor debe poseer una sesión administrativa activa (`ADMIN`, `OWNER`, `SUPER_ADMIN`) con permiso de inventario (`inventory:manage`).
- **Prohibición de autoaprobación**: el revisor debe ser un actor independiente distinto al solicitante que generó el expediente (`user.id !== storedProposal.requestedBy`).
- Esta regla se aplica en dos capas independientes:
  1. En la capa de servicio: lanza `ApiError.forbidden('La decisión administrativa requiere un actor independiente distinto al solicitante')` (HTTP 403 Forbidden).
  2. En el motor de base de datos: restricción check `CONSTRAINT "sale_recovery_reviewer_check" CHECK ("sale_recovery_decisions"."decided_by" <> "sale_recovery_decisions"."requested_by")` que impide físicamente la inserción en Postgres.

### 1.3 Detección de Obsolescencia del Estado
Antes de persistir la decisión, el servicio comprueba que la realidad operativa no haya divergido desde la preparación del expediente:
1. **Frescura de la venta legada**: Se verifica que `sales_entries` exista, que `recipeId` y `quantitySold` coincidan, y que la fecha de actualización nativa (`to_char(updatedAt, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`) sea idéntica a `proposal.legacy.updatedAt`. Si difiere por un solo microsegundo, se rechaza con 409 Conflict.
2. **Frescura y permanencia de evidencia**: Se verifica que ninguna de las pruebas documentales haya sido retirada (`deletedAt IS NOT NULL`) y que sus marcas de tiempo nativas de actualización coincidan exactamente con `proposal.evidence.evidenceUpdatedAt`.
3. **Ausencia de revisiones intermedias**: Se consulta `sales_consumption_revisions` y `sales_consumption_identities` para confirmar que no se hayan registrado consumos posteriores para la receta o producto y día de la venta. Si existen, se rechaza con 409 Conflict.
4. **Verificación canónica de aprobación**: Para decisiones `APPROVED`, se invoca `assertRecoveryReviewMatches` para certificar la consistencia completa de la demanda y verificar que la fecha de decisión no preceda a la verificación de la evidencia.

### 1.4 Persistencia Inmutable e Idempotencia
- Inserción en `sale_recovery_decisions` ligada a la clave foránea compuesta `sale_recovery_decision_target_fk` (`proposal_id`, `company_id`, `branch_id`, `proposal_hash`, `state_hash`, `requested_by`).
- Restricción de unicidad: `CONSTRAINT "sale_recovery_decision_unique" UNIQUE("proposal_id")`.
- Disparadores PostgreSQL activos:
  * `sale_recovery_decision_immutable`: Dispara excepción `23514` ante cualquier `UPDATE` o `DELETE`.
  * `sale_recovery_decision_timeline`: Dispara excepción `23514` si `decided_at < proposal.created_at`.
- Idempotencia:
  * Reenvío de la misma decisión por el mismo actor: devuelve el registro existente con `{ created: false }` (HTTP 200).
  * Intento de cambiar la decisión o intento de decisión por otro actor sobre una propuesta ya decidida: rechaza con 409 Conflict.

---

## 2. API Route (`/api/inventory/sales-entry/recovery-decisions`)
- **GET**: Consulta de expediente para revisión (`getRecoveryProposalForReview`).
  * Valida sesión administrativa y alcance de sucursal.
  * Carga expediente del servidor, calcula demanda y resumen de evidencias.
  * Retorna propuesta, decisión existente (si la hay) y bandera `canDecide` (falsa si el usuario es el solicitante o si ya hay decisión).
  * Encabezado `Cache-Control: private, no-store`.
- **POST**: Registro de decisión administrativa (`recordRecoveryDecision`).
  * Límite de payload de 16 KiB (`smallJson`).
  * Autenticación con `withTenantAuth` y verificación de rol administrativo.
  * Retorna estado 201 Created para nuevas decisiones y 200 OK para reintentos idempotentes.

---

## 3. Pruebas y Verificación

### 3.1 Pruebas Unitarias (V1)
Archivo: `lib/services/__tests__/sale-recovery-decision.test.ts`
Comando: `pnpm test:unit lib/services/__tests__/sale-recovery-decision.test.ts`
Resultado: **14/14 pruebas aprobadas en 220ms**.

Casos cubiertos:
1. `rechaza consultas sin autenticación o con roles no administrativos` (401 / 403).
2. `rechaza consulta con parámetros inválidos (extra fields o no UUID)` (400).
3. `lanza 404 cuando el expediente no existe en la empresa y sucursal`.
4. `retorna propuesta con canDecide=true para revisor independiente sin decisión previa`.
5. `retorna canDecide=false cuando el consultante es el solicitante`.
6. `rechaza payloads con campos declarados por el cliente fuera del contrato estricto` (400).
7. `rechaza autoaprobación (segregación de funciones: actorId === requestedBy)` (403).
8. `rechaza cuando la venta legada fue modificada posteriormente (obsolescencia)` (409).
9. `rechaza cuando la evidencia fue retirada o alterada (deletedAt != null o updatedAt divergente)` (409).
10. `rechaza cuando existen revisiones de consumo intermedias para el producto/receta` (409).
11. `aprueba legítimamente una propuesta válida por un administrador independiente` (201).
12. `registra rechazo legítimo (REJECTED) por un administrador independiente` (201).
13. `reintento idéntico del mismo decisor devuelve registro existente con created=false` (200).
14. `reintento con decisión distinta o distinto decisor lanza 409 Conflict`.

### 3.2 Pruebas de Integración en Neon Postgres Aislado (V2)
Archivo: `tests/integration/sale-recovery-decision-db.test.ts`
Entorno: Rama aislada Neon `br-round-voice-belheola` (`ep-cold-morning-bewqoz3o`), rol de runtime `pulso_app` (`rolsuper: false, rolbypassrls: false`).
Garantía: Todo el fixture y DDL corre dentro de transacción serializable con rollback forzado (`probe`), dejando cero objetos o filas residuales en la base de datos.

Comportamientos verificados contra PostgreSQL:
1. Aprobación legítima por actor independiente con inserción real en `sale_recovery_decisions` e idempotencia.
2. Segregación de funciones en servicio (403) y violación de check constraint `sale_recovery_reviewer_check` ante `decided_by = requested_by` en motor SQL.
3. Disparador de inmutabilidad (`sale_recovery_decision_immutable`): `UPDATE` y `DELETE` bloqueados con código `23514`.
4. Detección de obsolescencia ante `updated_at` de venta modificado y ante `deleted_at` de evidencia actualizado.
5. Rechazo legítimo (`REJECTED`) almacenado correctamente en base de datos.

### 3.3 Verificación de Tipos y ESLint
- TypeScript: Los 4 archivos de código y pruebas de la pista compilan con 0 errores de tipos.
- ESLint: 0 errores y 0 advertencias en los 4 archivos asignados.

---

## 5. Iteración 2 — Diagnóstico y Resolución de Error 42501 en Neon Aislado

### 5.1 Causa Raíz
En la ejecución original contra la base aislada Neon bajo el rol `pulso_app` (`NOBYPASSRLS`), la consulta de carga del expediente en `lib/services/sale-recovery-decision.ts` ejecutaba:
```ts
const [storedProposal] = await tx.select().from(saleRecoveryProposals).where(...).for('share', { of: saleRecoveryProposals });
```
En PostgreSQL, cualquier bloqueo a nivel de fila (`FOR SHARE`, `FOR UPDATE`, `FOR KEY SHARE`) exige permisos de `UPDATE` sobre la tabla correspondiente. Debido a que `sale_recovery_proposals` es una tabla inmutable y de solo anexión respaldada por triggers `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION 'Sale recovery proposals and decisions are immutable'`, la migración `0143_inv01c_recovery_review.sql` otorga estrictamente:
```sql
GRANT SELECT, INSERT ON public.sale_recovery_proposals, public.sale_recovery_decisions TO pulso_app;
```
Por diseño, `pulso_app` no posee (ni debe poseer) privilegios de `UPDATE` sobre propuestas inmutables. Al intentar bloquear filas con `FOR SHARE`, el motor de Neon Postgres rechazaba la operación con código `42501` (`insufficient_privilege`: permission denied for table sale_recovery_proposals).

### 5.2 Corrección Aplicada
1. **`lib/services/sale-recovery-decision.ts`**:
   - Se eliminó `.for('share', { of: saleRecoveryProposals })` al consultar `saleRecoveryProposals`. Las propuestas son física y lógicamente inmutables por disparador de base de datos (`sale_recovery_proposal_immutable`), por lo que el bloqueo de fila es redundante y generaba la violación de privilegios bajo `pulso_app`.
2. **`tests/integration/sale-recovery-decision-db.test.ts`**:
   - En las pruebas de violación de check constraint e inmutabilidad (`UPDATE`/`DELETE`), se envolvieron las operaciones directas de SQL en `tx.transaction(async nested => ...)` (savepoints) para evitar la invalidación del bloque de transacción Postgres (`25P02: current transaction is aborted`) y garantizar la verificación limpia de la tabla posterior.
3. **`lib/services/__tests__/sale-recovery-decision.test.ts`**:
   - Se adaptó el mock de transacción `mockTx` para que devuelva los registros esperados tanto en consultas directas como en consultas con `.for()`, preservando la compatibilidad de las 14 pruebas unitarias.

### 5.3 Resultados de Verificación Final
- **Pruebas de Integración (Postgres Neon `br-round-voice-belheola`, `pulso_app`)**:
  `pnpm vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-recovery-decision-db.test.ts`
  Resultado: **5/5 pruebas pasadas (exit code 0)** en 68.6s.
- **Pruebas Unitarias**:
  `pnpm vitest run --configLoader bundle lib/services/__tests__/sale-recovery-decision.test.ts lib/services/__tests__/sale-recovery-review.test.ts lib/services/__tests__/sale-recovery-proposals.test.ts`
  Resultado: **31/31 pruebas pasadas (exit code 0)** en 2.0s.
- **ESLint**:
  `pnpm exec eslint lib/services/sale-recovery-decision.ts tests/integration/sale-recovery-decision-db.test.ts lib/services/__tests__/sale-recovery-decision.test.ts`
  Resultado: **0 errores, 0 advertencias (exit code 0)**.
