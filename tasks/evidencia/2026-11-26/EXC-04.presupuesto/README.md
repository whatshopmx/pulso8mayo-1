# Evidencia de aceptación — `EXC-04.presupuesto` (Completar excepción de presupuesto)

- **Fecha:** 2026-11-26
- **Base Git (`HEAD`):** `8d8b3f7979aae74af766cd62cfd0a21ad8f5f233` (+ cambios locales de `EXC-03.a`, `EXC-03.b`, `EXC-05` y `EXC-04.presupuesto`)
- **Ticket:** `EXC-04.presupuesto` — *Completar excepción de presupuesto* (`I / M`, depende de `EXC-03.b`, verificación `V1, V2`).
- **Estado:** `aceptado` en entorno aislado (`V1, V2`).

## Cambios implementados

1. **Reglas puras de sobre-presupuesto (`lib/services/budget-exception-rules.ts`):**
   - `evaluateOverbudgetRule` evalúa el cruce del 100% de la partida presupuestal (`BUDGET_EXCEEDED_100_PCT`), calcula excedente, porcentaje consumido, severidad (`high` / `critical >= 120%`), rol efectivo mínimo (`ADMIN` o superior si la regla de monto exige `OWNER`/`SUPER_ADMIN`) e instantánea inmutable `ruleSnapshot`.
   - `resolveBudgetExceptionOwnerId` selecciona determinísticamente el responsable (`ownerId`) dentro de usuarios activos de la empresa respetando autoridad y segregación de funciones.
   - `buildBudgetOverrunExceptionInput` preserva `ruleSnapshot` y `ownerId` originales en reevaluaciones repetidas; `buildBudgetExceptionClosureReason` garantiza motivo `AUD-02` >= 4 caracteres.
2. **Persistencia canónica y cierre auditado atómico (`lib/services/budget-exception-service.ts` + `lib/services/exception-adapters/budget-overrun.ts`):**
   - `raiseBudgetOverrunException` registra/sincroniza `subjectType = "budget_overrun"` de forma idempotente por `(companyId, 'budget_overrun', expenseId)`, sin duplicar ni reabrir excepciones terminales y conservando la regla/responsable originales.
   - `closeBudgetOverrunExceptionInTx` ejecuta dentro de la transacción activa la actualización de metadata (`closure`), la transición de cierre auditado en `ExceptionService` (`CLOSE`/`VERIFY+CLOSE`/`CANCEL` con `actorId` autenticado) y la bitácora crítica `AUD-02` (`APPROVAL_EXPENSE`).
   - `budgetOverrunAdapter` queda registrado en `EXCEPTION_ADAPTERS` (`lib/services/exception-adapters/index.ts`) para backfill y autorreconciliación sin duplicados.
3. **Alineación de presupuesto y flujo de gastos (`lib/services/budget-service.ts`, `lib/services/expense-service.ts`, `lib/services/unified-approval-inbox-service.ts`):**
   - `EXPENSE_COMMITTING_STATUSES` incluye `PENDING_OVERBUDGET_APPROVAL` y alinea el mes contable de gastos con `coalesce(business_date, created_at)`.
   - `createOperatingExpense` crea gasto + excepción canónica `budget_overrun` en la misma transacción.
   - `approveOperatingExpense` y `rejectOperatingExpense` (antes bloqueaba rechazar `PENDING_OVERBUDGET_APPROVAL`) exigen rol `>= ADMIN` y segregación, ejecutan cierre auditado atómico (`AUD-02` + `exceptions`) y revierten completos ante fallo de auditoría.
   - `getOperatingExpenses` y `listExpensesPending` reflejan `PENDING_OVERBUDGET_APPROVAL` con su rol efectivo `>= ADMIN`.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V1 unitarias + regresiones presupuesto/gastos/adaptadores | `node node_modules/vitest/vitest.mjs run lib/services/__tests__/exc04-presupuesto-rules.test.ts lib/services/budget-service.test.ts tests/unit/finance/expense-transaction-db.test.ts lib/services/__tests__/exception-adapters.test.ts lib/services/__tests__/exception-service.test.ts` | **PASS (43/43)** — 6/6 reglas puras `EXC-04.presupuesto` + 9/9 `budget-service` + 6/6 PGlite `expense-transaction-db` + 11/11 `exception-adapters` (10 adaptadores) + 11/11 `exception-service`. |
| V2 Neon (esquema efímero aislado) | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/exc04-presupuesto-db.test.ts` | **PASS (1/1)** — detección atómica con `ruleSnapshot` y `ownerId` (`ADMIN`), 3 repeticiones/adaptador sin duplicar ni pisar regla/owner, bloqueo `GERENTE` y cross-tenant, rollback atómico ante fallo FK de `AUD-02`, aprobación y rechazo con cierre canónico + bitácora `AUD-02` (`APPROVAL_EXPENSE` + `EXCEPTION`), compromiso y liberación presupuestal, y no reapertura en re-ejecución del adaptador. |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/budget-exception-rules.ts lib/services/budget-exception-service.ts lib/services/exception-adapters/budget-overrun.ts lib/services/exception-adapters/index.ts lib/services/budget-service.ts lib/services/expense-service.ts lib/services/unified-approval-inbox-service.ts lib/services/__tests__/exc04-presupuesto-rules.test.ts lib/services/__tests__/exception-adapters.test.ts tests/integration/exc04-presupuesto-db.test.ts` | **PASS (0 errors)** |

## Límites explícitos

- La prueba V2 clona tablas en un esquema efímero (`exc04p_<hex>`) sobre Neon aislado añadiendo la columna candidata `voucher_reference` (`0148_fc15_petty_cash.sql`) sin mutar `public` ni aplicar migraciones en producción (`OPS-03`).
- El cierre funcional de filas de la matriz permanece reservado a `VAL-01` / `VAL-03`.
