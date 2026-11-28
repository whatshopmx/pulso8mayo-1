# Evidencia de aceptación — `EXC-04.ausencia` (Completar excepción de ausencia)

- **Fecha:** 2026-11-27
- **Base Git (`HEAD`):** `6861923ae4a691d2e7d0a4b5dc1b46b7b58110f5` (+ cambios locales de `EXC-04.ausencia`)
- **Ticket:** `EXC-04.ausencia` — *Completar excepción de ausencia* (`I / M`, depende de `EXC-03.b, NOM-02.a`, verificación `V1, V2`).
- **Estado:** `aceptado` en entorno aislado (`V1, V2`).

## Cambios implementados

1. **Reglas puras de ausencia e historial (`lib/services/absence-exception-rules.ts`):**
   - `classifyShiftAbsenceState` distingue explícitamente:
     - `APPROVED_ABSENCE` (`NO_SHOW` confirmado: `!requiresApproval || approvedAt != null`) → descuenta día pagadero en `NOM-02.a`.
     - `PENDING_ABSENCE_REVIEW` (`NO_SHOW` con `requiresApproval = true && !approvedAt`) → asistencia pendiente de confirmación o regularización (NO descuenta como falta aprobada).
     - `PENDING_ATTENDANCE` (`PENDING` / `ACTIVE` / `COMPLETED` sin aprobar) → asistencia pendiente.
     - `COVERED_BY_APPROVED_LEAVE` → día cubierto por vacación o permiso `APPROVED` (no levanta falta injustificada).
   - `resolveAbsenceOwnerId` elige responsable determinista dentro de la empresa (`supervisorId` → `branchManagerId` → rol operativo activo), nunca el propio colaborador ausente.
   - `appendAbsenceHistory` y `buildAbsenceExceptionInput` conservan `ownerId` y el historial append-only en `metadata.history` deduplicando detecciones repetidas.
2. **Alineación `NOM-02.a` (`lib/services/payroll-service.ts`):**
   - `resolveAttendanceForPeriod` clasifica `NO_SHOW` con `requiresApproval && !approvedAt` exclusivamente en `pendingAttendanceDetails` y solo agrega a `noShowDates` las faltas aprobadas (`!requiresApproval || approvedAt != null`).
3. **Servicio atómico, adaptador y API (`lib/services/absence-exception-service.ts`, `lib/services/exception-adapters/employee-absence.ts`, `lib/services/exception-adapters/index.ts`, `app/api/shift-sessions/route.ts`):**
   - `detectAbsenceException` proyecta idempotente `subjectType = "employee_absence"` respetando vacaciones/permisos aprobados y conservando `ownerId` e historial.
   - `approveAbsence` confirma falta aprobada (exigiendo segregación `actorId !== employeeId` y bloqueando con `409` días con permiso/vacación aprobada) y escribe auditoría crítica `AUD-02` en la misma transacción.
   - `regularizeAbsence` regulariza a `COMPLETED`/`CANCELLED` (con modo `ATTENDANCE_COMPLETED` / `JUSTIFIED_LEAVE` / `CANCELLED`), cierra la excepción canónica conservando `ownerId` e historial completo, y escribe auditoría crítica `AUD-02` (`EXCEPTION` + `ATTENDANCE_REGULARIZATION`) atómicamente.
   - `employeeAbsenceAdapter` queda registrado en `EXCEPTION_ADAPTERS` y `PUT /api/shift-sessions` enlaza detección al marcar `NO_SHOW` y regularización al volver a `COMPLETED`/`CANCELLED`.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 unitarias + regresiones NOM-02.a y adaptadores | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/exc04-ausencia-rules.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/exception-adapters.test.ts lib/services/__tests__/exception-service.test.ts` | **PASS (42/42)** — 4/4 reglas puras `EXC-04.ausencia` + 16/16 `payroll-nom02a-attendance` + 11/11 `exception-adapters` (11 adaptadores) + 11/11 `exception-service`. |
| V2 Neon (esquema efímero aislado `exc04a_<hex>`) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/exc04-ausencia-db.test.ts` | **PASS (1/1)** — detección `PENDING_ABSENCE_REVIEW` con `ownerId=supervisorId` e historial, `NOM-02.a` bloquea sin descontar, 3 repeticiones/adaptador sin duplicar ni alterar `ownerId`/historial, segregación + aislamiento entre empresas, `approveAbsence` actualiza a `APPROVED_ABSENCE` y `NOM-02.a` descuenta 1 día, rollback atómico ante fallo FK de `AUD-02`, `regularizeAbsence` cierra excepción conservando `ownerId` + historial `[DETECTED, APPROVED_ABSENCE, REGULARIZED_ATTENDANCE]` + `AUD-02` y restaura 15 días pagaderos, y día con vacación `APPROVED` no levanta falta y rechaza con `409`. |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/absence-exception-rules.ts lib/services/absence-exception-service.ts lib/services/exception-adapters/employee-absence.ts lib/services/exception-adapters/index.ts lib/services/payroll-service.ts app/api/shift-sessions/route.ts lib/services/__tests__/exc04-ausencia-rules.test.ts lib/services/__tests__/exception-adapters.test.ts tests/integration/exc04-ausencia-db.test.ts` | **PASS (0 errors)** |

## Límites explícitos

- La prueba V2 corre sobre un esquema efímero aislado (`exc04a_<hex>`) en Neon sin mutar `public` ni aplicar migraciones en producción (`OPS-03`).
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
