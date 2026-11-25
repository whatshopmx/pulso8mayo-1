# NOM-04.a — Unificar recibos y exportación

Fecha: 2026-11-24. Base: `732a815136f0273ee267e564eb58a53fe6fa4548`.

## Implementación

- **Fuente única congelada:** `readApprovedPayrollSnapshot` y `buildPayrollSnapshotCsv` en `lib/services/payroll-snapshot-service.ts`.
- **Eliminación de cálculo sintético en exportación:** `app/api/payroll/export/route.ts` ya no estima `0.02375` IMSS / `0.03` ISR / `15` días fijos desde contratos vivos; lee exclusivamente el snapshot inmutable aprobado (`ordinary_snapshot`) por `runId` o por período aprobado más reciente, emitiendo cabeceras `X-Payroll-Run-Id` y `X-Payroll-Snapshot-Version`.
- **Garantías:** sumas de percepciones, deducciones y neto coinciden centavo a centavo con los recibos del snapshot; reexportar produce salida idéntica sin recalcular asistencia ni salarios.

## Verificación V1 y V3

- **V1 + V3 API:** `lib/services/__tests__/payroll-nom03-nom04a-snapshot.test.ts` **2/2**, exit 0 (cuadre exacto de sumas/netos, reexportación idéntica, 403 sin permiso `SENSITIVE`, 409 sin snapshot aprobado, 200 CSV desde snapshot).
- **V2 (Neon aislado `pulso_app`):** `tests/integration/payroll-nom03-snapshot-db.test.ts` **1/1**, exit 0 (relectura y reexportación idénticas desde Postgres real).
- **ESLint:** exit 0, 0 errores.

## Límites

- Requiere aprobación previa del borrador (`NOM-03`) antes de exportar; timbrado externo PAC corresponde a `NOM-04.b`.
