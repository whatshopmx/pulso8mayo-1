# NOM-02.c2 — Incorporar bonos e incidencias

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación

- **Schema y migración aditiva `0165`:** `payroll_adjustments` en `lib/db/schema.ts` y `drizzle/0165_nom02_adjustments_and_loans.sql` con `idempotency_key` único por empresa, `applied_run_id`, `version`, `tax_treatment` (`FULLY_TAXABLE` | `EXEMPT` | `PARTIAL_EXEMPT`), `exempt_amount_cents`, `ENABLE/FORCE ROW LEVEL SECURITY`, política `payroll_adjustments_company_isolation` y permisos `pulso_app`.
- **Servicio:** `lib/services/payroll-adjustments-service.ts` (`evaluatePayrollAdjustments`, `resolvePayrollAdjustmentsForPeriod`, `computeAdjustmentsFingerprint`, `isDraftInvalidatedByAdjustments`).
  - Solo conceptos `APPROVED` y no aplicados en otra corrida entran al cálculo, deduplicados por `id` e `idempotencyKey`.
  - Huella SHA-256 determinista detecta cualquier edición, cambio de versión o cancelación posterior para invalidar el borrador afectado.
- **Integración:** `calculateEmployeePayroll` y `construirDesgloseNomina` en `lib/services/payroll-service.ts` incorporan percepciones (gravadas/exentas) y deducciones de incidencias aprobadas y reflejan su efecto en la base gravable de ISR.

## Verificación V1 y V2

- **V1:** `lib/services/__tests__/payroll-nom02c2-adjustments.test.ts` **4/4**, exit 0 (tratamientos fiscales, deduplicación, exclusión de no aprobados/ya aplicados, invalidación de borrador por fingerprint y validaciones `RangeError`).
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS, migración `0165` en rollback):** `tests/integration/payroll-nom02c2-d3-db.test.ts` **2/2**, exit 0 (RLS dos empresas, cambio posterior invalida fingerprint).
- **ESLint y Drizzle check:** exit 0, 0 errores.

## Límites

- Candidata `0165` verificada únicamente en rollback aislado; sin aplicación operativa ni despliegue.
