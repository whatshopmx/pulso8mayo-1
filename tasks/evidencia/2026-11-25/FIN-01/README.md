# Evidencia de aceptación — `FIN-01` (Distinguir saldo conciliado de caja proyectada)

- **Fecha:** 2026-11-25
- **Base Git (`HEAD`):** `45a4cadfd2a45c87f9307e5fd4f0fb3e1515d9ed` (+ cambios locales de `BAN-06.b`, `FIN-06.a`, `FIN-06.b` y `FIN-01`)
- **Ticket:** `FIN-01` — *Distinguir saldo conciliado de caja proyectada* (`I / M`, depende de `BAN-04, BAN-06.a`, verificación `V1, V3`).
- **Estado:** `aceptado` en entorno aislado (`V1, V3`).

## Cambios implementados

1. **Reglas puras de saldo conciliado vs caja proyectada ([cash-flow-balance-rules.ts](file:///C:/Users/david/pulso29/lib/services/cash-flow-balance-rules.ts)):**
   - Separa `CashBalanceSource` (`BANK_RECONCILED`, `MANUAL_BRANCH`, `MANUAL_COMPANY`, `NO_ANCHOR`), `describeOpeningBalance` (declara fuente, fecha efectiva y cuenta/últimos 4 dígitos) y `computeCashFlowHeroMetrics`.
   - Invariante sin ancla: cuando `initialBalanceCents === null` o faltan entradas estimadas, devuelve `minBalanceCents: null`, `endingBalanceCents: null`, `runwayDays: null`, `hasAbsoluteBalance: false`, `statusLevel: "UNANCHORED"` (nunca fabrica `$0.00` ni `30+ Días` ni `Cobertura Estable`).
2. **Saldo bancario conciliado por cuenta anclada ([company-bank-account-service.ts](file:///C:/Users/david/pulso29/lib/services/company-bank-account-service.ts), [cash-flow-service.ts](file:///C:/Users/david/pulso29/lib/services/cash-flow-service.ts)):**
   - `getReconciledAccountBalances` separa estrictamente movimientos `MATCHED` (`reconciledBalanceCents`, conciliados vía `BAN-04` / `BAN-06.a`) de movimientos importados aún pendientes `UNMATCHED` (`unmatchedDeltaCents`, `unmatchedCount`), excluyendo `IGNORED` y excluyendo cuentas sin ancla.
   - `getCashFlowProjection` corrige `openingBalance.asOfDate` cuando la fuente es `ACCOUNTS` (antes leía `supuesto?.asOfDate ?? null`, quedando nulo sin supuesto manual) y publica `balanceSource`, `sourceLabel`, `isBankAnchored`, `reconciledBalanceCents`, `unmatchedBankDeltaCents`, `unmatchedBankCount` y `projectionMeta` (`isEstimate: true`, `label: "Proyección estimada"`, `disclaimer`).
3. **UI coherente ([opening-balance-card.tsx](file:///C:/Users/david/pulso29/components/finance/opening-balance-card.tsx), [cash-flow-hero.tsx](file:///C:/Users/david/pulso29/components/finance/cash-flow-hero.tsx), [cash-flow-summary-card.tsx](file:///C:/Users/david/pulso29/components/finance/cash-flow-summary-card.tsx), [cash-flow-calendar.tsx](file:///C:/Users/david/pulso29/components/finance/cash-flow-calendar.tsx)):**
   - `OpeningBalanceCard` declara explícitamente fuente (`Saldo bancario conciliado` / `Supuesto manual` / `Sin ancla bancaria`), fecha (`asOfDate`), cuenta(s) con banco y últimos 4 dígitos, y aviso de movimientos importados sin conciliar excluidos del saldo conciliado.
   - `CashFlowHero` renderiza `"Sin ancla bancaria"` / `"Sin saldo base"` / `"—"` sin ancla (eliminando `$0.00` y `30+ Días` aparentes) y etiqueta toda la trayectoria como `"Caja Proyectada (Estimación)"`.
   - `CashFlowSummaryCard` corrige `"Ventas registradas"` → `"Entradas estimadas"`, muestra fuente/fecha/cuenta del saldo y etiqueta `"Caja proyectada al día 30 (estimación)"`.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 + V3 HTTP/UI + regresión | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/fin01-reconciled-vs-projected-cash.test.ts tests/unit/finance/fin01-cash-flow-balance-http.test.ts lib/services/__tests__/account-balance-service.test.ts` | **PASS (8/8)** — 3/3 V1 reglas/cuentas + 2/2 V3 HTTP `/api/finance/cash-flow` y renderizado SSR de `CashFlowHero`/`OpeningBalanceCard` (con ancla vs sin ancla + `403` alcance `NONE`) + 3/3 regresión `account-balance-service` |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/cash-flow-balance-rules.ts lib/services/company-bank-account-service.ts lib/services/cash-flow-service.ts components/finance/opening-balance-card.tsx components/finance/cash-flow-hero.tsx components/finance/cash-flow-summary-card.tsx components/finance/cash-flow-calendar.tsx lib/services/__tests__/fin01-reconciled-vs-projected-cash.test.ts tests/unit/finance/fin01-cash-flow-balance-http.test.ts` | **PASS (0 errors, 5 warnings preexistentes en componentes)** |

## Límites explícitos

- La prueba V3 verifica el contrato HTTP de `/api/finance/cash-flow` y el HTML renderizado de `CashFlowHero` / `OpeningBalanceCard` en Node (`react-dom/server`); no incluye navegación Playwright interactiva ni despliegue operativo (`OPS-03`).
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
