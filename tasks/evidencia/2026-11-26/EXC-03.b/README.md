# Evidencia de aceptación — `EXC-03.b` (Probar job recuperable de SLA)

- **Fecha:** 2026-11-26
- **Base Git (`HEAD`):** `8d8b3f7979aae74af766cd62cfd0a21ad8f5f233` (+ cambios locales de `EXC-03.a` y `EXC-03.b`)
- **Ticket:** `EXC-03.b` — *Probar job recuperable de SLA* (`A / M`, depende de `EXC-03.a`, verificación `V1, V2`).
- **Estado:** `aceptado` en entorno aislado (`V1, V2`).

## Cambios implementados

1. **Reutilización de reglas unitarias puras (`lib/services/exception-sla.ts`):**
   - `SLA_ESCALATABLE_STATUSES` e `isEligibleForSlaEscalation(row, now)` reutilizan `isSlaBreached` (`exception-sla.ts`) más `isTerminal` y `allowedEvents` (`exception-lifecycle.ts`), excluyendo siempre estados terminales (`CLOSED`, `CANCELLED`) y filas ya `ESCALATED`.
2. **Servicio recuperable de barrido SLA (`lib/services/exception-sla-job-service.ts`):**
   - `sweepCompanyExceptionSla` opera estrictamente por `companyId` con reloj controlado (`now`), invoca `ExceptionService.escalate(..., { expectedStatus: row.status })` (serializado con `pg_advisory_xact_lock` + guarda optimista `status`) y trata conflictos `409` como `skippedAlreadyHandled` para que caídas, reintentos y carreras concurrentes nunca dupliquen escalamientos.
3. **Función durable Inngest (`lib/inngest/functions/exceptions-sla-sweep.ts`, registrada en `lib/inngest/functions/index.ts`):**
   - `exceptionsSlaSweep` (`cron: "*/15 * * * *"` + evento `exceptions/sla-sweep.requested` con `{ companyId?, nowIso? }`, `concurrency: 1`, `retries: 3`) ejecuta un `step.run` independiente por empresa para recuperación incremental sin re-escalar empresas ya procesadas.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 unitarias + regresión SLA | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/exc03b-sla-job.test.ts lib/services/__tests__/exception-sla.test.ts` | **PASS (12/12)** — 10/10 reglas puras `exception-sla` + 2/2 `exc03b-sla-job` (elegibilidad, exclusión de terminales/`ESCALATED` y `409` concurrente) |
| V2 Neon (caída/reintento + reloj controlado + carrera concurrente) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/exc03b-sla-job-db.test.ts` | **PASS (1/1)** — caída simulada tras escalar `b1`, reintento en `T0` escala solo `b2`, 3a corrida `0` escalamientos, `CLOSED`/`CANCELLED`/`companyB` intactas, avance a `T0+45m` escala solo `idFuture`, y carrera simultánea con dos conexiones produce exactamente `1` escalamiento |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/exception-sla.ts lib/services/exception-sla-job-service.ts lib/inngest/functions/exceptions-sla-sweep.ts lib/inngest/functions/index.ts lib/services/__tests__/exc03b-sla-job.test.ts tests/integration/exc03b-sla-job-db.test.ts` | **PASS (0 errors, 0 warnings)** |

## Límites explícitos

- La verificación V2 ejecuta `sweepCompanyExceptionSla` directamente contra Neon aislado con limpieza determinista; no dispara un servidor Inngest Cloud remoto ni aplica cambios en producción (`OPS-03`).
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
