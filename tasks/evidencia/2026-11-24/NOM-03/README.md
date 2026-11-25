# NOM-03 — Aprobar un snapshot inmutable

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación

- **Schema y migración aditiva `0166`:** `drizzle/0166_nom03_payroll_snapshot.sql` añade `snapshot_version`, `input_fingerprint`, `approved_by`, `approved_at` y `ordinary_snapshot` a `payroll_runs`, y `bonuses_cents`, `isr_retenido_cents`, `imss_obrero_cents`, `loan_deductions_cents`, `net_pay_cents` y `ordinary_snapshot` a `payroll_payslips`.
- **Servicio:** `lib/services/payroll-snapshot-service.ts` (`computePayrollInputFingerprint`, `createPayrollDraftSnapshot`, `invalidatePayrollDraft`, `approvePayrollSnapshot`).
  - Congela entradas, versiones de reglas (`isrTableVersion`, `imssRuleVersion`, `umaDailyCents`), importes por empleado, totales y actor/fecha de aprobación.
  - Editar entradas cambia `inputFingerprint` o marca `STALE` incrementando `snapshot_version`; la aprobación atómica exige `WHERE status = 'DRAFT' AND snapshot_version = $expected AND input_fingerprint = $current`, devolviendo `409 Conflict` ante cualquier carrera editar↔aprobar o doble aprobación.
  - Exige completitud `NOM-06` (`completeness.canApprove`) en todos los recibos del borrador antes de aprobar.

## Verificación V2 y V3

- **V2 (Neon aislado `pulso_app` NOBYPASSRLS, migración `0166` en rollback):** `tests/integration/payroll-nom03-snapshot-db.test.ts` **1/1**, exit 0 (invalidación de borrador → `409`, aprobación exitosa v2, doble aprobación → `409`, aislamiento entre empresas → `404`).
- **V3 API:** `lib/services/__tests__/payroll-nom03-nom04a-snapshot.test.ts` **2/2**, exit 0 (control de permiso `SENSITIVE`, `409` sin snapshot aprobado, `200` con `X-Payroll-Snapshot-Version`).
- **Drizzle check + ESLint:** exit 0, 0 errores.

## Límites

- Candidata `0166` verificada únicamente en rollback aislado; sin aplicación operativa ni despliegue.
