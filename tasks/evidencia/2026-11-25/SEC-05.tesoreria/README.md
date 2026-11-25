# SEC-05.tesoreria — Aceptar RLS y privilegios de tesorería

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Inventario de tablas bancarias y de pagos

Se inventariaron 8 tablas del dominio de tesorería y banca que no tenían RLS habilitado y se aportó la migración candidata `drizzle/0167_sec05_tesoreria_rls.sql` (registrada en `drizzle/meta/_journal.json`, `idx 167`):

1. `company_bank_accounts` (`company_id` directo)
2. `supplier_bank_accounts` (`company_id` directo)
3. `payee_bank_accounts` (`company_id` directo)
4. `bank_transactions` (`company_id` directo + `source_bank_account_id` verificado contra la misma empresa)
5. `payment_runs` (`company_id` directo)
6. `payment_run_items` (sin `company_id`: acotada vía `EXISTS` sobre `payment_runs`)
7. `recurring_contracts` (`company_id` directo)
8. `recurring_payables` (`company_id` directo + `contract_id` verificado contra la misma empresa)

Políticas fail-closed con `NULLIF(current_setting('app.current_company_id', true), '')::uuid` y `GRANT SELECT, INSERT, UPDATE, DELETE` condicional para `pulso_app` (sin `FORCE ROW LEVEL SECURITY` para conservar bypass del dueño/migraciones).

## Verificación V2 y V3

- **V2 (Neon aislado `pulso_app` NOBYPASSRLS):** `tests/integration/sec05-tesoreria-rls-db.test.ts` — **1/1**, exit 0 (`0167_sec05_tesoreria_rls.sql` en transacción con rollback: fail-closed sin contexto, aislamiento de 2 empresas en las 8 tablas, rechazo de escrituras cruzadas en `payment_run_items` y `bank_transactions`, limpieza verificada).
- **V3 (HTTP y autorización de tesorería/banca):** `tests/unit/finance/sec05-tesoreria-http.test.ts` (`2/2`) + `tests/unit/finance/treasury-authorization.test.ts` (`17/17`) = **19/19**, exit 0 (`403` sin permisos `FINANCIAL`, propagación exclusiva de `ctx.userCompanyId`, `404` ante corridas ajenas y segregación de roles en corridas de pago).
- **ESLint:** exit 0, 0 errores.

## Límites

- Migración candidata `0167_sec05_tesoreria_rls.sql` verificada en entorno aislado; sin aplicación al entorno operativo (`OPS-03`). Destraba `BAN-01`.
