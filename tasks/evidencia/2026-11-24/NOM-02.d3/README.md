# NOM-02.d3 — Aplicar préstamos y descuentos autorizados

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación

- **Schema y migración aditiva `0165`:** `payroll_loans` y `payroll_loan_installments` en `lib/db/schema.ts` y `drizzle/0165_nom02_adjustments_and_loans.sql`, con índice único parcial `payroll_loan_installments_applied_period_unique` (`WHERE status = 'APPLIED'`) que impide en PostgreSQL cobrar dos veces el mismo préstamo en el mismo período, `ENABLE/FORCE ROW LEVEL SECURITY` y permisos `pulso_app`.
- **Servicio:** `lib/services/payroll-loans-service.ts` (`planPayrollLoanDeductions`, `resolvePayrollLoansForPeriod`).
  - Conserva `balanceBeforeCents`, `balanceAfterCents`, `scheduledCents`, `appliedCents`, autorización (`authorizedBy`/`reason`) y cancelación (`cancelledBy`/`cancelReason`).
  - Aplica tope de saldo restante y límite legal LFT Art. 110 fr. I (30% sobre el excedente del salario mínimo del período para préstamos/anticipos de empresa).
  - Repetir el mismo período con cuota `APPLIED` devuelve `appliedCents = 0` (`alreadyAppliedInPeriod: true`).
- **Integración:** `calculateEmployeePayroll` y `construirDesgloseNomina` en `lib/services/payroll-service.ts` suman `loanDeductionsCents` a `totalDeduccionesCents` y emiten la deducción SAT correspondiente (`004`, `007`, `009`, `011`, etc.).

## Verificación V1 y V2

- **V1:** `lib/services/__tests__/payroll-nom02d3-loans.test.ts` **4/4**, exit 0 (cuota + saldo + nodo SAT, idempotencia de período repetido, tope saldo restante, tope 30% LFT Art. 110 y exclusión de cancelados/pausados/otra empresa).
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS, migración `0165` en rollback):** `tests/integration/payroll-nom02c2-d3-db.test.ts` **2/2**, exit 0 (incluye verificación real de error PostgreSQL `23505` al intentar duplicar cuota `APPLIED` y aislamiento RLS entre dos empresas).
- **ESLint y Drizzle check:** exit 0, 0 errores.

## Límites

- Candidata `0165` verificada únicamente en rollback aislado; sin aplicación operativa ni despliegue.
