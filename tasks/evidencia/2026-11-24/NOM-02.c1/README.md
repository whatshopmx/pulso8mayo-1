# NOM-02.c1 — Incorporar vacaciones y permisos

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Criterios verificados

1. **Dependencias aceptadas:** `NOM-02.a`, `NOM-02.c1.http` (incluidos `rls`, `runtime`, `civil-days`) y `NOM-02.c1.history` (incluidos sus 7 hijos: `contract`, `schema`, `grants`, `decisions`, `leave`, `reader`, `acceptance`).
2. **Adopción en `calculateEmployeePayroll` (`lib/services/payroll-service.ts`):**
   - Propaga `useVerifiedHistory`, `vacationHistory`, `historyCutoff` y `historyActorId` desde `options.vacationsInput` hacia `resolveVacationsForPeriod`.
   - Enlaza `resolveLeavesForPeriod` (permisos con goce y sin goce con `leaveRequestId`, fechas, estado y `leavesStatus`) directamente en el resultado `leaveBreakdown` de `calculateEmployeePayroll`.
   - La ausencia de dato (`MISSING`, `CONFLICT`, `QUERY_ERROR`) produce `vacationPrimeCents = 0` con causa explícita y **no** se convierte en vacaciones pagadas ni en falta laboral automática (`unpaidAbsenceDays = 0`).
3. **Pruebas V1 y V2:**
   - V1 focal: `payroll-nom02c1-vacations.test.ts` (17/17), `payroll-nom02c1-balance-status.test.ts` (13/13) y `vacation-history-reader-db.test.ts` (4/4): **34/34**, exit 0.
   - V2 Neon aislado (`pulso_app` NOBYPASSRLS, dos empresas, rollback): `tests/integration/payroll-nom02c1-balance-db.test.ts`: **5/5**, exit 0 (incluye `AVAILABLE`, `MISSING`, `QUERY_ERROR` por `REVOKE SELECT`, aislamiento de `vacation_accruals` y enlace/aislamiento de `leave_requests` con/sin goce).
   - Complementado con la aceptación integrada de `NOM-02.c1.history` (`7/7` Neon con LOGIN mínimo independiente).
   - ESLint focal: exit 0, 0 errores.

## Límites

- Las migraciones candidatas `0163` y `0164` siguen únicamente en entorno aislado/desechable; sin aplicación a operativo/main ni despliegue.
- El bloqueo de aprobación/timbrado por datos ausentes (`MISSING` / `QUERY_ERROR` / `CONFLICT`) se cierra en `NOM-06`; las filas `09.11` y `10.05` conservan su estado parcial hasta completar sus tareas restantes y `VAL-01`.
