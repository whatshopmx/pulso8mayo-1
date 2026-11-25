# NOM-04.b — Aceptar timbrado con FiscalAPI existente

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Implementación

- **Mismo snapshot alimenta CFDI:** `buildTimbradoInputFromPayslipSnapshot` y `stampApprovedPayrollSnapshot` en `lib/services/payroll-snapshot-service.ts` leen exclusivamente el snapshot inmutable aprobado (`ordinary_snapshot` vía `readApprovedPayrollSnapshot`), exigen completitud `NOM-06` (`canStamp` y `canApprove`), RFC válido y cuadre aritmético (`percepciones - deducciones = neto`), y entregan el desglose congelado a `timbrarNomina`.
- **Frontera HTTP unificada:** `POST /api/finance/fiscal/timbrar-nomina` acepta `{ runId, userId? }` bajo `requirePermissionApi("reports", "manage", { classification: "FINANCIAL" })`, emite cabeceras `X-Payroll-Run-Id` y `X-Payroll-Snapshot-Version`, y conserva el modo legacy para compatibilidad.
- **Persistencia de UUID/estado e idempotencia:** `timbrarNomina` (`lib/services/fiscal-service.ts`) admite `dbInstance` y `fetchImpl` opcionales para pruebas transaccionales aisladas, conserva la guarda `onConflictDoUpdate` con `setWhere: ne(status, "TIMBRADO")` en `cfdi_nomina_timbrados`, y `stampApprovedPayrollSnapshot` sincroniza `cfdi_uuid`, `cfdi_status` y `sello_digital` en `payroll_payslips` sin sobrescribir un recibo ya `TIMBRADO`.

## Verificación V1, V2 y V3

- **V1 + V3 API:** `node node_modules/vitest/vitest.mjs run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/payroll-nom04b-timbrado.test.ts lib/services/__tests__/payroll-nom03-nom04a-snapshot.test.ts` — **5/5** (3 nuevos `NOM-04.b` + 2 regresión `NOM-03`/`NOM-04.a`), exit 0.
- **V2 (Neon aislado `pulso_app` NOBYPASSRLS):** `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/payroll-nom04b-timbrado-db.test.ts` — **1/1**, exit 0 (bloqueo `409` sin aprobar, rechazo `RECHAZADO` sin UUID, reintento exitoso `TIMBRADO` con UUID/sello en `cfdi_nomina_timbrados` y `payroll_payslips`, reintento idempotente con 0 llamadas adicionales al PAC, aislamiento RLS `404` entre empresas, rollback y limpieza verificados).
- **ESLint:** exit 0, 0 errores.

## Límites y proveedor externo

- En esta corrida no se ejecutó llamada HTTP en vivo contra el servidor remoto de sandbox de FiscalAPI (`test.fiscalapi.com`); las respuestas del contrato v4 (éxito, rechazo `succeeded: false` y dedup/reintento) se validaron de forma determinista con `fetchImpl` inyectado sobre Postgres real (`pulso_app`). La validación en vivo con credenciales sandbox del proveedor queda explícitamente registrada como pendiente externa (no bloquea snapshot, exportación ni idempotencia local).
- Sin despliegue operativo ni aplicación de migraciones a `main` (`OPS-03`); filas `10.11`–`10.12` siguen abiertas hasta `VAL-01.M01-M17.M10`.
