# BAN-05 — Completar identidad de ingresos esperados

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Implementación

- **Esquema y migración candidata (`drizzle/0169_ban05_expected_income_identity.sql`, `idx 169`, `lib/db/schema.ts`):**
  - Se agregó `destination_bank_account_id` (`REFERENCES company_bank_accounts(id)`) a `aggregator_settlements`.
  - Se habilitó RLS fail-closed y privilegios mínimos para `pulso_app` en `gateway_transactions` y `aggregator_settlements`, validando pertenencia de `destination_bank_account_id` a la misma empresa.
- **Servicio de agregadores (`lib/services/aggregator-settlement-service.ts`):** `createAndReconcileAggregatorSettlement` valida `branchId` y `destinationBankAccountId` (activa y perteneciente a `companyId`) y admite `dbInstance` opcional.
- **Contrato canónico de identidad y separación de etapas (`lib/services/expected-income-service.ts`):**
  - `buildExpectedIncomeRecord`: unifica corte (`SALES_CUT`), terminal (`TERMINAL_GATEWAY`) y agregador (`AGGREGATOR_SETTLEMENT`) conservando `identityKey` SHA-256 estable, fuente/canal, fechas, bruto, comisión, IVA, neto esperado y `destinationBankAccountId`.
  - Separa explícitamente las etapas `SALE` (corte POS), `SETTLEMENT` (liquidación documentada sin abono bancario confirmado) y `DEPOSIT` (abono bancario confirmado en `bank_transactions`).
  - `evaluateExpectedIncomeAmbiguity` y `listExpectedIncomes`: dejan explícitamente `AMBIGUOUS` / `PENDING` / `GROUPED_UNSUPPORTED` / `DISCREPANT` cualquier empate de candidatos, falta de cuenta destino/fecha, descuadre aritmético o depósito agrupado 1↔N, sin fabricar vínculos.

## Verificación V1 y V2

- **V1:** `lib/services/__tests__/ban05-expected-income.test.ts` (`3/3`) + regresión `lib/services/__tests__/aggregator-settlement-rules.test.ts` (`11/11`) = **14/14**, exit 0.
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS con `0167`+`0169`):** `tests/integration/ban05-expected-income-db.test.ts` — **1/1**, exit 0 (bloqueo `400` de cuenta destino ajena en agregador, preservación de identidad y cuenta destino en corte/terminal/agregador, separación `SALE`/`SETTLEMENT`/`DEPOSIT`, detección `AMBIGUOUS` ante empate, aislamiento RLS entre empresas y rollback limpio).
- **ESLint:** exit 0, 0 errores y 0 advertencias.

## Límites

- Migración candidata `0169_ban05_expected_income_identity.sql` verificada en entorno aislado; sin aplicación operativa (`OPS-03`). Destraba `BAN-06.a`.
