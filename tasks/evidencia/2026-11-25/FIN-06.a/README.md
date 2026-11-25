# Evidencia de aceptación — `FIN-06.a` (Separar importe reportado y conciliado)

- **Fecha:** 2026-11-25
- **Base Git (`HEAD`):** `45a4cadfd2a45c87f9307e5fd4f0fb3e1515d9ed` (+ cambios locales de `BAN-06.b` y `FIN-06.a`)
- **Ticket:** `FIN-06.a` — *Separar importe reportado y conciliado* (`I / M`, depende de `BAN-06.a`, verificación `V1, V2`).
- **Estado:** `aceptado` en entorno aislado (`V1, V2`).

## Cambios implementados

1. **Separación ortogonal de procedencia vs estado de conciliación (`lib/services/commission-types.ts`):**
   - `CommissionAmountSource`: `"RATE_ESTIMATE" | "CUT_REPORTED" | "GATEWAY_REPORTED" | "AGGREGATOR_REPORTED" | "BANK_RECONCILED" | "DOCUMENTED_ZERO" | "NO_DATA"`.
   - `CommissionReconciliationStatus`: `"PENDING" | "DISCREPANT" | "CONFIRMED" | "NOT_APPLICABLE"`.
   - Etiquetas canónicas en español compartidas por API, P&L y UI (`commissionAmountSourceLabel`, `commissionReconciliationStatusLabel`, `formatCommissionProvenanceTag`) y agregadores conservadores (`aggregateAmountSource`, `aggregateReconciliationStatus`).
   - Partición aditiva por canal y sucursal: `reportedCents` (pendiente/discrepante), `reconciledCents` (confirmada en banco/liquidación), `estimatedCents` (tarifa configurada), `discrepancyCents` y bandera explícita `documentedZero`.
2. **Cálculo real de reportado vs conciliado (`lib/services/commission-service.ts`):**
   - `getCommissionsByBranch` (con soporte `dbInstance` para ejecución bajo `pulso_app`) cruza `gateway_transactions` contra `bank_transactions` (`matchStatus = 'MATCHED'`) y consulta `aggregator_settlements` del período.
   - Distingue `GATEWAY_REPORTED` (`PENDING`), `BANK_RECONCILED` (`CONFIRMED`), `DISCREPANT` (diferencia bancaria o aritmética `> 1` centavo con `discrepancyCents`), `DOCUMENTED_ZERO` (`fee = 0` documentado o sucursal sólo mostrador) y `NO_DATA` (venta comisionable sin tarifa ni reporte).
3. **Coherencia API, P&L y UI (`lib/services/pnl-types.ts`, `lib/services/pnl-service.ts`, `lib/services/pnl-derived-detail-service.ts`, `app/api/finance/commissions/route.ts`, `components/finance/commissions-by-channel-table.tsx`, `components/finance/pnl-branch-table.tsx`):**
   - `pnlLineSourceForCommission` y `buildPnlCommissionPresentation` garantizan que un importe reportado `PENDING` o `DISCREPANT` **no** se degrade falsamente a `"conciliada"` ni se marque como `MEASURED` firme en el P&L (se clasifica `DERIVED` con etiquetas idénticas a la API hasta quedar `CONFIRMED`).
   - La UI de comisiones y la celda de comisiones del P&L usan `formatCommissionProvenanceTag` en lugar de la etiqueta fija `"conciliada"`.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 unitarias + regresión | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/fin06a-reported-vs-reconciled.test.ts lib/services/__tests__/commission-audit.test.ts` | **PASS (8/8)** — 3/3 `FIN-06.a` + 5/5 regresión `commission-audit` |
| V2 Neon (`pulso_app`, `rolbypassrls = false`, `rolsuper = false`) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/fin06a-reported-vs-reconciled-db.test.ts` | **PASS (1/1)** — 6 sucursales (pendiente, confirmada en banco, discrepante `-$6.00`, cero documentado confirmado, sin datos y agregador conciliado) + aislamiento multi-tenant bajo RLS en rollback |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/commission-types.ts lib/services/commission-service.ts lib/services/pnl-types.ts lib/services/pnl-service.ts lib/services/pnl-derived-detail-service.ts app/api/finance/commissions/route.ts components/finance/commissions-by-channel-table.tsx components/finance/pnl-branch-table.tsx lib/services/__tests__/fin06a-reported-vs-reconciled.test.ts tests/integration/fin06a-reported-vs-reconciled-db.test.ts` | **PASS (0 errors, 2 pre-existing warnings en `commission-service.ts`)** |

## Límites explícitos

- Las migraciones candidatas (`0155`, `0167`, `0169`) y la política RLS de `channel_commission_rates` se ejercitaron dentro de la transacción de prueba en Neon con `ROLLBACK`; no se aplicaron a base operativa (`OPS-03`).
- Se observó que `channel_commission_rates` aún no cuenta con política RLS/`GRANT` dedicada para `pulso_app` en el catálogo de migraciones (seguimiento bajo `SEC-05.resto`).
- La aceptación integral HTTP/UI de comisiones e ingresos por canal corresponde a `FIN-06.b`, y el cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
