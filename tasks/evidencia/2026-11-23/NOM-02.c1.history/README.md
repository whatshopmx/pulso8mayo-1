# Historia verificable de vacaciones — escritores, puente leave, lector de nómina y aceptación (`NOM-02.c1.history`)

Base: `6aed025` (`history.contract` y `history.schema` ya aceptados; 82 registros previos). Este hito implementa y acredita en entorno aislado los 5 hijos restantes (`grants`, `decisions`, `leave`, `reader`, `acceptance`) y cierra el padre `NOM-02.c1.history` (**88 registros aceptados**).

## Implementación por hijo

1. **`NOM-02.c1.history.grants`** (V1/V2/V3):
   - Cierre de asignaciones legacy sin capacidad administrativa: `lib/services/leave-balance-service.ts`, `app/api/leave/balances/route.ts`, catálogo crítico `LEAVE_ENTITLEMENT` en `lib/services/audit-service.ts`, pruebas `tests/unit/payroll/leave-balances-scope-db.test.ts` (25/25) y `tests/integration/leave-balances-db.test.ts` (2/2).
   - Administración de historial verificado (`OPEN_STREAM`, sucesor, `EXTEND_COVERAGE`, `GRANT`, `REVOKE_GRANT` y lectura `GET`): `lib/db/vacation-runtime.ts` (`withVacationHistoryTransaction` validando RLS+FORCE, privilegios mínimos sin secuencia ni catálogo, 4 políticas y 6 triggers; sin fallback al propietario), `lib/services/vacation-history-grants-service.ts`, `app/api/vacations/history/route.ts`, `tests/unit/payroll/vacation-history-grants-db.test.ts` (9/9) y `tests/integration/vacation-history-grants-db.test.ts` (2/2).

2. **`NOM-02.c1.history.decisions`** (V1/V2/V3):
   - Vínculo atómico entre aprobación/cancelación de `vacation_requests` y `vacation_history_events`: `lib/services/vacation-history-decisions.ts`, `app/api/vacations/approve/route.ts`, `app/api/vacations/route.ts`, `tests/unit/payroll/vacation-history-decisions-db.test.ts` (4/4) y `tests/integration/vacation-history-decisions-db.test.ts` (1/1 con `VACATIONS_RUNTIME_DATABASE_URL` LOGIN mínimo).

3. **`NOM-02.c1.history.leave`** (V1/V2/V3):
   - Cierre del escape PATCH genérico en `/api/leave/requests`, derivación de días civiles y año del período (no reloj actual), transición condicionada `WHERE status = ...`, actualización atómica de saldos y puente `APPROVE_REQUEST`/`CANCEL_REQUEST` para permisos `VACATION`: `lib/services/leave-request-service.ts`, `app/api/leave/requests/route.ts`, `tests/unit/payroll/vacation-history-leave-db.test.ts` (4/4) y `tests/integration/vacation-history-leave-db.test.ts` (1/1 con carrera de aprobación 200/409).

4. **`NOM-02.c1.history.reader`** (V1/V2):
   - Lector al corte consistente (`knownAt` + `throughVersion` bajo advisory lock compartido con escritores) conectado a `resolveVacationsForPeriod` sin fallback a saldos mutables (`vacation_accruals`/`leave_balances`), preservando `vacationSource: "VERIFIED_HISTORY"`, `historyManifest`, `MISSING`, `CONFLICT` y `QUERY_ERROR`: `lib/services/vacation-history-reader.ts`, `lib/services/payroll-service.ts` y `tests/unit/payroll/vacation-history-reader-db.test.ts` (4/4).

5. **`NOM-02.c1.history.acceptance`** (V2/V3):
   - Recorrido integrado en PostgreSQL nativo (Neon desechable baseline `0158` + `0163` + `0164`) con dos empresas, dos sucursales, LOGIN mínimo independiente (`VACATIONS_RUNTIME_DATABASE_URL`), grants + vacaciones + permisos VACATION + lectura de nómina al corte + cancelación/sucesor posterior + replay determinista del manifiesto + ausencia de fallback mutable + aislamiento entre empresas: `tests/integration/vacation-history-acceptance-db.test.ts` (1/1, exit 0, 43.20 s).

## Verificación ejecutada

| Gate | Resultado |
|---|---|
| Regresión unitaria/PGlite (9 archivos: `vacation-history-reader-db`, `vacation-history-leave-db`, `vacation-history-decisions-db`, `vacation-history-grants-db`, `leave-balances-scope-db`, `vacation-history`, `vacation-history-schema-db`, `payroll-nom02c1-vacations`, `payroll-nom02c1-balance-status`) | **108/108**, exit 0, 52.07 s |
| Regresión de alcance rutas vacaciones (`vacation-routes-scope-db.test.ts`) | **28/28**, exit 0 |
| Integración Neon V2 (`leave-balances-db`, `vacation-history-grants-db`, `vacation-history-decisions-db`, `vacation-history-leave-db`, `vacation-history-acceptance-db`) | **7/7** (4 + 1 + 1 + 1), exit 0, LOGIN mínimo sin BYPASSRLS y limpieza verificada |
| ESLint sobre archivos nuevos/modificados | exit 0, 0 errores |
| `tsc --noEmit --incremental false` (4 GB heap) | exit 0, 0 errores |
| `next build` (4 GB heap) | **exit 0**, compilación 2.2 min, TypeScript y **456/456** páginas; `BUILD_ID: O5tL4LSCTDS9DcQElKSy1` |
| Trazabilidad (`validate-faltantes.ts` + `faltantes-traceability.test.ts`) | exit 0, 0 errores, 11/11 unitarias |

## Límites

- Candidatas `0163` y `0164` verificadas únicamente en PGlite y bases Neon desechables; sin aplicación operativa ni despliegue.
- El cierre de `NOM-02.c1` y las filas `09.11`/`10.05` conservan su estado parcial hasta completar la adopción operativa y `NOM-06`.
- No se modificaron credenciales ni se alteraron cambios locales de otros frentes en el árbol de trabajo.
