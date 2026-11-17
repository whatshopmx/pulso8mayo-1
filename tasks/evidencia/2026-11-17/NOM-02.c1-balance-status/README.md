# NOM-02.c1 — Saldo de vacaciones: distinguir dato ausente de fallo de consulta

Continuación 2026-11-17 sobre HEAD `368264cd5b20c33e99b97ced902695413bbe28ce` más cambios locales. **Código implementado y V1 comprobada; sin aceptación (V2 integrada y fuente/saldo histórico siguen pendientes).**

## Brecha cerrada

La revisión de la [consolidación 2026-11-16](../2026-11-16/CONSOLIDACION/README.md) dejó como pendiente para aceptar NOM-02.c1: «los ceros de fallback no distinguen dato ausente de fallo de consulta». En `resolveVacationsForPeriod`, tanto el fallo de la consulta de solicitudes como el de la consulta de saldo terminaban en `0` (o `[]`), idénticos a «no hay vacaciones» / «saldo cero»: un fallo transitorio de DB producía `vacationPrimeCents: 0` y `justification: "EXCEEDED_VACATION_BALANCE"` sin poder distinguirse de un saldo real de 0.

Este incremento separa los estados:

- `lib/services/payroll-service.ts`:
  - `VacationPeriodBreakdown` añade `vacationBalanceStatus` (`"AVAILABLE" | "MISSING" | "QUERY_ERROR"`) y `vacationRequestsStatus` (`"AVAILABLE" | "QUERY_ERROR"`); la `justification` se amplía con `"VACATION_BALANCE_MISSING"`, `"VACATION_BALANCE_QUERY_ERROR"` y `"VACATION_REQUESTS_QUERY_ERROR"`.
  - Un fallo de consulta ya no se colapsa a saldo 0: se marca `QUERY_ERROR` y la justificación lo declara (no `EXCEEDED`). Dato ausente (sin filas) se marca `MISSING` cuando hay vacaciones aprobadas, sin presentarlo como «excedido».
  - `LeavePeriodBreakdown` añade `leavesStatus` (`"AVAILABLE" | "QUERY_ERROR"`): el fallo al leer permisos no se lee como «sin permisos».
  - La regla de pago no cambia en el caso normal: `AVAILABLE` con saldo 0 explícito sigue produciendo `EXCEEDED_VACATION_BALANCE`; `AVAILABLE` con saldo suficiente sigue en `LFT_ARTS_76_80` y prima 25% (o contractual superior).
- `lib/services/__tests__/payroll-nom02c1-balance-status.test.ts` (nuevo): 7 casos de distinción.

No se toca el cálculo fiscal (concepto 021, tope 15 UMA) ni la fórmula de prima; solo el reporte de procedencia/estado del saldo.

## Verificación (V1)

| Comando | Resultado |
|---|---|
| `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/payroll-nom02c1-balance-status.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts` | **22/22, 2 archivos, exit 0** (7 nuevas + 15 regresión) |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **exit 0** |
| `pnpm.cmd exec eslint lib/services/payroll-service.ts lib/services/__tests__/payroll-nom02c1-balance-status.test.ts` | **exit 0**, 0 errores, 19 advertencias `any` preexistentes |

Casos nuevos: saldo 0 explícito precargado → `AVAILABLE` + `EXCEEDED`; sin registro → `MISSING` + `VACATION_BALANCE_MISSING` (no `EXCEEDED`); fallo de saldo → `QUERY_ERROR` + `VACATION_BALANCE_QUERY_ERROR`; fallo de solicitudes → `VACATION_REQUESTS_QUERY_ERROR` (no `SIN_VACACIONES`); vacío real → `SIN_VACACIONES`; fallo de permisos → `leavesStatus: QUERY_ERROR`; permisos precargados → `AVAILABLE`.

## V2 regresión (nómina real)

`NODE_OPTIONS=--use-system-ca pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/payroll-db.test.ts`: **14/14, exit 0**, 50.5 s, contra el Neon aislado `.env.test` (`ep-cold-morning-bewqoz3o`) con `pulso_app` NOBYPASSRLS. Incluye 4 casos NOM-02.c1 V2 (vacaciones 25% LFT, saldo parcial/excedido, permiso con/sin goce y aislamiento multi-empresa). Confirma que el cambio de estado de saldo no rompe el flujo de nómina en Postgres real.

**Límite:** la regresión V2 ejercita `AVAILABLE` (saldo real); las etiquetas `MISSING`/`QUERY_ERROR` se prueban a nivel V1 con `dbInstance` simulado. Un test V2 dedicado a esas dos etiquetas (revocación de SELECT bajo `pulso_app`) sigue pendiente.

## Límites

- **V1 únicamente**: `dbInstance` simulado (vacío/que falla); no hay Postgres real ni sesión.
- **V2 pendiente**: Postgres aislado con dos empresas; saldos históricos por período reales; confirmar que un fallo real de conexión no se confunde con saldo 0.
- **Pendiente de aceptación**: procedencia/vigencia fiscal de saldos históricos por período y bloqueo en NOM-06 (aprobación/timbrado) sobre `MISSING`/`QUERY_ERROR`. El bloqueo actual es declarativo (estado + justificación); NOM-06 debe consumirlo.
- No se modifica `resolveAttendanceForPeriod` (mismo patrón de catch silencioso); queda como límite explícito para NOM-06/CTA.

No se acepta `NOM-02.c1`. La fila 12.x sigue parcial.
