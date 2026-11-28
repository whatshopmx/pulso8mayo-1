# Evidencia de aceptación — `REC-03A` (Revalidar lotes con anomalía histórica H01)

- **Fecha:** 2026-11-27
- **Base Git (`HEAD`):** `35515c62f66a49e0b998f531b507c0ebed4dfd4b` (+ cambios locales de `REC-03A` / `REC-03B`)
- **Ticket:** `REC-03A` — *Revalidar lotes con anomalía histórica* (`R / M`, depende de `P0-04, SEC-00`, verificación `V2`).
- **Estado:** `aceptado` en entorno aislado (`V2`).

## Cambios implementados y hallazgo corregido

1. **Revalidación pura por lote (`lib/inventory/receiving-overcount-revalidation.ts`):**
   - Evalúa expediente completo por lote nacido en recepción (`supplier_batch_info->>'receivingReportId'`): `SCOPE_MISMATCH`, `NO_RECEIVING_MOVEMENT`, `MULTIPLE_RECEIVING_MOVEMENTS`, `RECEIVING_NOT_INITIAL`, `NEGATIVE_DELTA`, `DELTA_NOT_RECEIVED_QUANTITY`, `CORRECTED_BALANCE_NEGATIVE`, `REPORT_MISSING`, `REPORT_SCOPE_MISMATCH`, `REPORT_LINE_MISSING`, `REPORT_LINE_QUANTITY_MISMATCH`, `CREATED_AT_UNKNOWN`, `CREATED_AFTER_FIX` y `MARKER_WITH_RESIDUAL`.
   - Clasifica estrictamente en `SUFFICIENT` (propone `-delta` exacto hasta el ledger), `AMBIGUOUS` (sin cantidad propuesta; retenido para conteo físico) y `ALREADY_CORRECTED` (sin efectos al repetir). Expone `unit` del ítem para `REC-03B`.
2. **Servicio dry-run READ ONLY y ajuste preparado en copia aislada (`lib/services/receiving-overcount-service.ts`, `scripts/diag-receiving-overcount.ts`):**
   - `readReceivingOvercountRevalidation` se ejecuta en transacción `READ ONLY`, cuenta los lotes que realmente existan (sin asumir un número fijo) y reporta `nonReceivingMismatches` por separado.
   - **Hallazgo real corregido en V2:** el borrador inicial insertaba `quantity_change = -delta` en `inventory_movements` al corregir H01, lo que restaba `-delta` a un ledger que ya era correcto (`10 -> 0`) mientras el saldo bajaba de `20 -> 10` (disparando `POSTCONDITION_FAILED`). Se corrigió para registrar el movimiento marcador con `quantity_change = 0` (`reference_id = 'REC-03:H01:<batchId>'`) conservando intacto `SUM(inventory_movements) === current_quantity`, mientras `current_quantity` baja `-delta` y la auditoría `AUD-02` documenta `before`, `after`, `balanceAdjustment` y `ledgerQuantityChange: 0`.
   - `scripts/diag-receiving-overcount.ts` bloquea `--apply` contra cualquier host operativo declarado en `.env` (exit 3) y exige `--url-env` explícito.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 unitarias + regresiones | `node node_modules/vitest/vitest.mjs run tests/unit/inventory/receiving-overcount-revalidation.test.ts tests/unit/inventory/receiving-overcount-diagnostic.test.ts` | **PASS (17/17)** |
| V2 PostgreSQL nativo (base desechable + copia aislada con `RUN_REC03A_SOURCE_COPY=1`) | `$env:RUN_REC03A_SOURCE_COPY='1'; node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/receiving-overcount-revalidation-db.test.ts` | **PASS (6/6)** — dry-run `READ ONLY` sin mutaciones, clasificación de 3 `SUFFICIENT` + 6 `AMBIGUOUS`, ajuste solo de `SUFFICIENT` dejando `current_quantity === ledger` + `AUD-02`, idempotencia en repetición, carrera simultánea de 2 conexiones (`APPLIED` + `ALREADY_CORRECTED`), rechazo sin efectos de ambiguos/obsoletos y dry-run sobre copia de la base aislada (`candidates: 0`, `sufficient: 0`, `ambiguous: 0`, `nonReceivingMismatches: 35`). |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/inventory/receiving-overcount-revalidation.ts lib/services/receiving-overcount-service.ts scripts/diag-receiving-overcount.ts tests/unit/inventory/receiving-overcount-revalidation.test.ts tests/integration/receiving-overcount-revalidation-db.test.ts` | **PASS (0 errors, 0 warnings)** |

## Límites explícitos

- No se modificaron datos operativos ni la base principal; todas las pruebas se ejecutaron sobre bases desechables aisladas destruidas al terminar `afterAll`.
- La aplicación operativa de correcciones históricas sigue gobernada por `REC-03B` y respaldo verificado del entorno objetivo (`OPS-03`).
