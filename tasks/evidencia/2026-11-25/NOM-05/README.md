# NOM-05 — Enlazar obligación neta con tesorería (y cierre de Puerta 2)

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Implementación

- **Esquema y migración candidata (`drizzle/0168_nom05_payroll_obligations.sql`, `idx 168`, `lib/db/schema/treasury.ts`):**
  - `payroll_treasury_obligations`: una única obligación por `(company_id, user_id, period_start, period_end)` con `CHECK (paid_amount_cents + remaining_amount_cents = net_amount_cents)` y `payment_status IN ('OPEN','PARTIALLY_PAID','PAID')`, con RLS fail-closed y privilegios para `pulso_app`.
  - `payroll_treasury_allocations`: asignaciones de pago parcial/total desde `payment_run_items` con unicidad por `(company_id, idempotency_key)` y `(obligation_id, payment_run_item_id)`, y RLS fail-closed.
- **Servicio (`lib/services/payroll-treasury-service.ts`):**
  - `syncPayrollObligationsFromApprovedSnapshot`: consume exclusivamente `readApprovedPayrollSnapshot` (`ordinary_snapshot`), crea idempotentemente una obligación por empleado/período sin exigir `cfdi_status = 'TIMBRADO'`.
  - `recordPayrollObligationPayment`: aplica pagos parciales o totales desde partidas `PAYROLL` `CONFIRMED` bajo `pg_advisory_xact_lock`, con idempotencia por `idempotencyKey`, bloqueo `409` contra sobrepago y sin alterar `cfdi_status` ni `cfdi_uuid`.
  - `listPayrollObligations`: expone de forma independiente el estado de pago (`paymentStatus`, `netAmountCents`, `paidAmountCents`, `remainingAmountCents`), el estado fiscal CFDI (`cfdiStatus`, `cfdiUuid`) y la conciliación bancaria acumulada vía `BAN-04` (`bankReconciledCents`, `bankReconciliationStatus`).
- **Frontera HTTP (`app/api/finance/treasury/payroll/obligations/route.ts`):** `GET` (`reports:read` FINANCIAL) y `POST` (`reports:manage` FINANCIAL) para `SYNC_FROM_SNAPSHOT` y `RECORD_PAYMENT`.

## Verificación V2 y V3

- **V2 (Neon aislado `pulso_app` NOBYPASSRLS con `0166`+`0167`+`0168`):** `tests/integration/nom05-payroll-obligations-db.test.ts` — **1/1**, exit 0 (bloqueo `409` sin aprobar, sync idempotente sin exigir CFDI, pago parcial + repetición idempotente + rechazo `409` de sobrepago, conciliación bancaria `BAN-04`, independencia total CFDI↔pago tras timbrar y tras deshacer conciliación, aislamiento RLS `404` entre empresas, rollback limpio).
- **V3 HTTP:** `tests/unit/finance/nom05-payroll-obligations-http.test.ts` — **2/2**, exit 0 (`403` sin permisos `FINANCIAL`, `SYNC_FROM_SNAPSHOT`, `RECORD_PAYMENT`, `409` sobrepago y `GET` acotado por `ctx.userCompanyId`).
- **ESLint:** exit 0, 0 errores y 0 advertencias.

## Cierre de Puerta 2

Con `NOM-01`, `NOM-02.a..e`, `NOM-02.c1.*`, `NOM-06`, `NOM-03`, `NOM-04.a`, `NOM-04.b` y `NOM-05` todos aceptados en entorno aislado, queda cerrada **Puerta 2 (Frente 2 — Nómina calculada y explicable)**. Sin despliegue operativo ni aplicación de migraciones (`0165`–`0168`) a `main` (`OPS-03`); filas `10.*`/`12.*` quedan abiertas hasta `VAL-01`.
