# Evidencia de aceptación — `FIN-06.b` (Aceptar comisiones e ingresos por canal)

- **Fecha:** 2026-11-25
- **Base Git (`HEAD`):** `45a4cadfd2a45c87f9307e5fd4f0fb3e1515d9ed` (+ cambios locales de `BAN-06.b`, `FIN-06.a` y `FIN-06.b`)
- **Ticket:** `FIN-06.b` — *Aceptar comisiones e ingresos por canal* (`A / M`, depende de `FIN-06.a, BAN-06.b`, verificación `V2, V3`).
- **Estado:** `aceptado` en entorno aislado (`V2, V3`).

## Brechas corregidas durante la aceptación

1. **Desglose explícito de cuadre neto / bruto / IVA / banco por fuente (`lib/services/commission-types.ts`, `lib/services/commission-service.ts`, `app/api/finance/commissions/route.ts`):**
   - `ChannelCommission` y `BranchCommissions` ahora exponen `feeBaseCents`, `feeVatCents`, `expectedNetCents`, `bankMatchedCents` (y totales `totalFeeBaseCents`, `totalFeeVatCents`, `totalExpectedNetCents`, `totalBankMatchedCents`) además de `discrepancyCents`, `amountSource` y `reconciliationStatus`.
   - Cuadre verificado por fuente:
     - `RATE_ESTIMATE`: `baseSalesCents - feeBaseCents - feeVatCents === expectedNetCents`, `bankMatchedCents === 0`.
     - `GATEWAY_REPORTED` / `BANK_RECONCILED`: `feeBaseCents + feeVatCents === commissionCents`, `bankMatchedCents - expectedNetCents === discrepancyCents` en discrepancia y `=== 0` en confirmación.
     - `AGGREGATOR_REPORTED`: `expectedNetCents` refleja el neto de liquidación y `discrepancyCents` la varianza/descuadre.
2. **Reporte de cruce de plataforma sin ocultar depósitos pendientes (`lib/services/gateway-report-service.ts`):**
   - `GatewayReportService.getPlatformCrossReport` usaba `INNER JOIN` desde `bank_transactions`, ocultando por completo las transacciones de pasarela aún sin abono bancario.
   - Corregido a `LEFT JOIN` desde `gateway_transactions` hacia `bank_transactions` (`matchStatus = 'MATCHED'`), exponiendo `matchedCount`, `unmatchedCount`, `bankDifferenceCents`, `arithmeticDifferenceCents`, `documentedZero`, `amountSource`, `reconciliationStatus` y soporte `dbInstance`.
3. **Dato faltante nunca presentado como costo firme (`lib/services/pnl-types.ts`):**
   - `pnlLineSourceForCommission` impide clasificar como `MEASURED` cualquier sucursal con `uncoveredSalesCents > 0` o `coveragePercent < 100` (cobertura parcial) además de `NO_DATA` (faltante total).

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V2 Neon (`pulso_app`, `rolbypassrls = false`, `rolsuper = false`) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/fin06b-commissions-channel-acceptance-db.test.ts` | **PASS (1/1)** — tarifa estimada (`rappi` 27.5%+IVA), reportada (`CLIP` pendiente), conciliada (`CLIP` confirmado), cruce de plataforma con hueco visible (`-97,100`), discrepancia `-$5.00` + reversión/liberación post-`BAN-06.b`, faltante parcial/total y aislamiento RLS |
| V3 HTTP + regresiones | `node node_modules/vitest/vitest.mjs run tests/unit/finance/fin06b-commissions-channel-http.test.ts lib/services/__tests__/fin06a-reported-vs-reconciled.test.ts lib/services/__tests__/commission-audit.test.ts lib/services/__tests__/gateway-report-service.test.ts` | **PASS (15/15)** — `/api/finance/commissions` (incluyendo `403` alcance `NONE`), `/api/finance/reconciliation/platform-report`, `/api/finance/pnl` (`meta.containsEstimates = true` en faltantes) y regresiones |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/commission-types.ts lib/services/commission-service.ts lib/services/gateway-report-service.ts lib/services/pnl-types.ts app/api/finance/commissions/route.ts tests/unit/finance/fin06b-commissions-channel-http.test.ts tests/integration/fin06b-commissions-channel-acceptance-db.test.ts` | **PASS (0 errors, 1 warning preexistente)** |

## Límites explícitos

- Las migraciones candidatas (`0155`, `0167`, `0169`) y RLS de `channel_commission_rates` se aplicaron únicamente dentro de la transacción de prueba en Neon con `ROLLBACK`; no se aplicaron a entorno operativo (`OPS-03`).
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
