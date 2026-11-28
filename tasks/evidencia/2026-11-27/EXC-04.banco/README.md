# Evidencia de aceptación — `EXC-04.banco` (Completar excepción bancaria)

- **Fecha:** 2026-11-27
- **Base Git (`HEAD`):** `6861923ae4a691d2e7d0a4b5dc1b46b7b58110f5` (+ cambios locales de `EXC-04.ausencia` y `EXC-04.banco`)
- **Ticket:** `EXC-04.banco` — *Completar excepción bancaria* (`I / M`, depende de `EXC-03.b, BAN-04, BAN-06.a`, verificación `V2, V3`).
- **Estado:** `aceptado` en entorno aislado (`V2, V3`).

## Cambios implementados

1. **Reglas puras de fuente, antigüedad y política de no ocultamiento (`lib/services/bank-exception-rules.ts`):**
   - `buildBankExceptionInput` conserva fuente original (`sourceKind`, `sourceTable`, `sourceId`, `sourceBankAccountId`, `direction`, `reference`, `description`), fecha valor (`valueDate`), fecha de primera detección (`firstDetectedAt`), responsable determinista (`ownerId`) y diferencia (`differenceCents`), actualizando `ageDays` conforme avanza el reloj.
   - `evaluateReconciliationDifferencePolicy` permite cierre automático únicamente cuando `differenceCents === 0` (`EXACT_MATCH`); si `differenceCents !== 0`, bloquea el cierre silencioso exigiendo disposición explícita (`EXPLAINED_FEE`, `WRITE_OFF`, `PENDING_ADJUSTMENT`, `IGNORED_WITH_REASON`) + motivo auditado >= 4 caracteres y preservando `differenceCents`.
2. **Servicio canónico, adaptador y hooks en conciliación (`lib/services/bank-exception-service.ts`, `lib/services/exception-adapters/bank-reconciliation.ts`, `lib/services/bank-statement-service.ts`):**
   - `syncCompanyBankExceptions` detecta idempotentemente egresos bancarios pendientes, depósitos pendientes o agrupados (`GROUPED_DEPOSIT_UNSUPPORTED`), liquidaciones de pasarela sin cuenta destino / vencidas / con discrepancia aritmética (`ARITHMETIC_NET_MISMATCH`) y partidas de corrida `CONFIRMED` vencidas; autorreconcilia solo cruces exactos (`differenceCents === 0`) sin ocultar diferencias.
   - `resolveBankExceptionOnReconciliation` cierra con `reconciliationTrace` completo y bitácora crítica `AUD-02` (`BANK_RECONCILIATION` + `EXCEPTION`) dentro de la misma transacción, o devuelve `409 Conflict` manteniendo abierta la diferencia si no se documenta disposición.
   - `tryResolveBankExceptionOnExactMatchInTx` se ejecuta dentro de la transacción de `confirmMatch` (`BAN-04`) y `confirmDepositMatch` (`BAN-06.a`) verificando privilegios reales (`has_table_privilege`) para conservar compatibilidad con roles mínimos de pruebas previas.
   - `bankReconciliationAdapter` queda registrado en `EXCEPTION_ADAPTERS` (`lib/services/exception-adapters/index.ts`).
3. **Contrato HTTP V3 (`app/api/finance/bank-transactions/exceptions/route.ts`):**
   - `GET /api/finance/bank-transactions/exceptions` (`reports:read` `FINANCIAL`) expone excepciones bancarias con fuente, antigüedad, diferencia y traza de conciliación.
   - `POST /api/finance/bank-transactions/exceptions` (`reports:update` `FINANCIAL`) soporta `SYNC`, `REPORT_DISCREPANCY` y `RESOLVE_WITH_TRACE` (devuelve `409 Conflict` si se intenta ocultar una diferencia).

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V3 HTTP + regresiones bancarias y adaptadores | `node node_modules/vitest/vitest.mjs run tests/unit/finance/exc04-banco-http-v3.test.ts tests/unit/finance/ban04-outflow-matching-http.test.ts tests/unit/finance/ban06a-deposit-reconciliation-http.test.ts tests/unit/finance/ban06b-deposit-correction-http.test.ts lib/services/__tests__/exception-adapters.test.ts` | **PASS (19/19)** — RBAC 403, `GET`/`POST` (`SYNC`, `RESOLVE_WITH_TRACE`), bloqueo `409` ante ocultamiento de diferencia, preservación de fuente/antigüedad/diferencia, más regresiones `BAN-04`, `BAN-06.a`, `BAN-06.b` y 12 adaptadores. |
| V2 Neon (esquema efímero aislado `exc04b_<hex>`) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/exc04-banco-db.test.ts` | **PASS (1/1)** — detección de egreso/partida/depósito/pasarela discrepante (`-1,500`c), repetición en `+5d` sin duplicar y actualizando `ageDays` conservando `valueDate`/`firstDetectedAt`/`ownerId`/`differenceCents`, cierre atómico vía `confirmMatch` (`BAN-04`) y `confirmDepositMatch` (`BAN-06.a`) con `reconciliationTrace` + `AUD-02`, bloqueo `409` al intentar ocultar diferencia, aislamiento `404`, rollback atómico ante fallo FK `AUD-02`, y cierre con `EXPLAINED_FEE` preservando `-1,500`c en traza y auditoría. |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/bank-exception-rules.ts lib/services/bank-exception-service.ts lib/services/exception-adapters/bank-reconciliation.ts lib/services/exception-adapters/index.ts lib/services/bank-statement-service.ts app/api/finance/bank-transactions/exceptions/route.ts lib/services/__tests__/exception-adapters.test.ts tests/unit/finance/exc04-banco-http-v3.test.ts tests/integration/exc04-banco-db.test.ts` | **PASS (0 errors)** |

## Límites explícitos

- La prueba V2 corre sobre esquema efímero aislado (`exc04b_<hex>`) en Neon sin mutar `public` ni aplicar migraciones en producción (`OPS-03`).
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
