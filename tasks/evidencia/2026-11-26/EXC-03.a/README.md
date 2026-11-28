# Evidencia de aceptación — `EXC-03.a` (Probar lifecycle concurrente)

- **Fecha:** 2026-11-26
- **Base Git (`HEAD`):** `8d8b3f7979aae74af766cd62cfd0a21ad8f5f233` (+ cambios locales de `EXC-03.a`)
- **Ticket:** `EXC-03.a` — *Probar lifecycle concurrente* (`A / M`, depende de `EXC-02, AUD-02`, verificación `V2`).
- **Estado:** `aceptado` en entorno aislado (`V2`).

## Endurecimiento aplicado

- **`lib/services/exception-service.ts` (`applyEvent` y los 8 eventos de lifecycle):**
  - Bloqueo transaccional serializado por excepción vía `pg_advisory_xact_lock(hashtextextended(companyId || ':' || id, 603))` antes de leer la fila y evaluar `transition(...)`.
  - Guarda optimista sobre `status` en `UPDATE exceptions ... WHERE id = ... AND company_id = ... AND status = row.status` que devuelve `409 Conflict` si el estado cambió concurrentemente.
  - Soporte opcional `opts?: { expectedStatus?: ExceptionStatus }` en `assign`, `startAction`, `resolve`, `verify`, `close`, `reopen`, `escalate` y `cancel` para rechazar con `409 Conflict` cualquier sobrescritura sobre un estado observado desactualizado (p. ej. `RESOLVE` vs `CANCEL` simultáneos sobre `IN_ACTION`).
  - `reopen` y `escalate` ahora calculan su parche (`patchBuilder`) **después** de adquirir el bloqueo transaccional sobre la fila fresca.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V2 Neon (carreras reales con 2 conexiones) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/exc03a-concurrent-lifecycle-db.test.ts` | **PASS (2/2)** — carrera `RESOLVE` vs `CANCEL` (`1` ganador / `1` `409`, `1` auditoría), segregación de funciones (`VERIFY` por el mismo resolvedor → `409` sin mutación ni auditoría), carrera doble `VERIFY` (`1` ganador / `1` `409`), transición ilegal `OPEN → CLOSE` (`409` sin cambios/auditoría), rollback atómico ante fallo de auditoría (`AUD-02` FK) y cruce entre empresas (`404` indistinto) |
| Regresión unitaria lifecycle/service | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/exception-service.test.ts lib/services/__tests__/exception-lifecycle.test.ts lib/services/__tests__/exception-raise-atomic.test.ts lib/services/__tests__/exception-sla.test.ts` | **PASS (107/107)** — 84 `exception-lifecycle` + 11 `exception-service` + 10 `exception-sla` + 2 `exception-raise-atomic` |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/exception-service.ts tests/integration/exc03a-concurrent-lifecycle-db.test.ts` | **PASS (0 errors, 1 warning preexistente)** |

## Límites explícitos

- La prueba concurrente ejecuta contra Neon aislado (`TEST_DATABASE_URL`) con limpieza determinista en `afterAll`; no aplica migraciones a base operativa (`OPS-03`).
- El job recuperable de SLA corresponde a `EXC-03.b` y la conexión de acciones canónicas en la UI a `EXC-05`.
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
