# BAN-01 — Aceptar cuentas e importación bancaria

Fecha: 2026-11-25. Base: `732a815136f0273ee267e564eb58a53fe6fa4548` + árbol local.

## Cambios y correcciones

- **Errores por línea visibles (`lib/services/bank-statement-service.ts`):** `importBankStatement` ahora devuelve `errors: ParseError[]` (`{ line, raw, message }`) además de `importedCount`, `duplicateCount` y `errorCount`, exponiendo diagnósticos por línea en `POST /api/finance/bank-transactions`.
- **Aislamiento de fingerprint por empresa:** `buildFingerprint` incluye `companyId` cuando está presente para impedir colisiones entre empresas cuando `sourceBankAccountId` es `null`.
- **Soporte transaccional aislado:** `importBankStatement`, `listCompanyBankAccounts` y `createCompanyBankAccount` aceptan `dbInstance` opcional para ejecución bajo `SET LOCAL ROLE pulso_app` (`NOBYPASSRLS`).

## Verificación V2 y V3

- **V2 (Neon aislado `pulso_app` NOBYPASSRLS + `0167_sec05_tesoreria_rls.sql`):** `tests/integration/ban01-bank-accounts-import-db.test.ts` — **1/1**, exit 0:
  - Cuenta bancaria cifrada en reposo (`account_number` distinto del texto plano) y solo `accountLastFour` expuesto en lectura.
  - Importación CSV formato bancario MX (3 filas válidas + 2 defectuosas) devuelve `importedCount=3`, `duplicateCount=0`, `errorCount=2` y `errors` con número de línea y motivo.
  - Reimportación del mismo CSV no duplica (`importedCount=0`, `duplicateCount=3`, 3 filas totales en DB).
  - Empresa B rechazada con `400` al intentar importar sobre cuenta de Empresa A, y sin colisión de fingerprint al importar su propio archivo.
- **V3 HTTP + parser:** `tests/unit/finance/ban01-bank-import-http.test.ts` (`2/2`) + `lib/services/__tests__/bank-statement-service.test.ts` (`26/26`) = **28/28**, exit 0; ESLint **0 errores**.

## Límites

- La prueba usa una muestra CSV sintética con formato de estado de cuenta bancario MX (BBVA/Santander) explícitamente identificada como sintética; la aceptación con un archivo bancario real anonimizado de cliente queda registrada como validación externa pendiente conforme a la sección 7 del plan.
- Sin despliegue operativo ni aplicación de `0167` a `main` (`OPS-03`). Destraba `BAN-04` y `BAN-05`.
