# INV-01.b4.storage — Almacenamiento POS privado durable y lectura autorizada

Continuación 2026-11-17 sobre HEAD `0dfd139d75a5870d7af3baad5423d218f54a093f` más cambios locales. **Código implementado y V1 comprobada; sin aceptación (V2/V3 pendientes).**

## Brecha cerrada

La ruta del cierre (`app/api/workflows/smart-links/upload-pos/route.ts`) recibía el archivo del POS y lo **ingestaba** en ventas, pero no persistía ningún byte: fabricaba un path (`pos-uploads/{tenant}/{branch}/{fecha}-{nombre}`) y lo guardaba en `daily_sales_cuts.raw_file_url` como si fuera evidencia durable. La cadena no apuntaba a nada.

Este incremento hace que el archivo se **persista de forma privada y durable**, y añade la **lectura autorizada**:

- `lib/storage/pos-upload.ts` (nuevo): key canónica con jerarquía de tenancy `companies/{companyId}/branches/{branchId}/pos/{businessDate}/{ts}_{nombre}`; validación de tamaño (≤10 MiB) y tipo; `storePosUpload` (bytes → R2, devuelve la KEY); `resolvePosUploadUrl` (KEY → URL firmada con TTL de 10 min; URLs legacy `http(s)://`/`local://` se sirven tal cual).
- `app/api/workflows/smart-links/upload-pos/route.ts` (modificado): en multipart lee los bytes, valida y sube a R2; guarda la **KEY** (no URL pública) en `raw_file_url`; degrada a `local://…` si R2 no está configurado y declara `durable: false` en la respuesta.
- `app/api/sales/cuts/[id]/pos-file/route.ts` (nuevo): `GET` autorizado que busca el corte por `company_id` (sesión), aplica `resolveBranchScope` (GERENTE/SUPERVISOR solo su sucursal → 404, no 403, para no filtrar existencia) y devuelve la URL firmada.

`companyId` sale siempre de la sesión, nunca del cliente. No se introduce URL pública navegable.

## Verificación (V1)

| Comando | Resultado |
|---|---|
| `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/storage/__tests__/pos-upload.test.ts tests/unit/sales/pos-file-read.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts` | **21/21, 3 archivos, exit 0** |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **exit 0** |
| `pnpm.cmd exec eslint lib/storage/pos-upload.ts lib/storage/__tests__/pos-upload.test.ts app/api/workflows/smart-links/upload-pos/route.ts "app/api/sales/cuts/[id]/pos-file/route.ts" tests/unit/sales/pos-file-read.test.ts` | **exit 0**, sin errores ni advertencias |
| `git diff --check` | **exit 0** (avisos LF/CRLF) |

Casos unitarios de `pos-upload`: key con jerarquía y nombre normalizado; nombre sin alfanuméricos → `pos.csv`; validación de vacío/exceso/tipo; `storePosUpload` sube y devuelve la KEY y valida antes de tocar storage; `resolvePosUploadUrl` devuelve `null` sin valor, conserva URLs legacy, presigna KEY y devuelve `null` si falla el presignado.

Casos de la ruta de lectura: id mal formado → 400 sin tocar storage; corte inexistente o de otra empresa → 404; alcance `NONE` → 403; sucursal ajena → 404 (no 403); corte sin archivo → 404; key sin URL → 404; corte propio → 200 con `url`, `fileKey` y `expiresInSeconds`.

Regresión: la frontera del cierre (`sales-entry-smart-link.test.ts`, 4 casos) sigue en verde; su `console.error` de 403/400 esperados es del `ApiHandler.error`, no un fallo.

## Límites

- **V1 únicamente**: unitarias con R2 simulado (`uploadToR2`/`generatePresignedUrl` mockeados) y DB de la ruta de lectura mockeada. No acredita almacenamiento R2 real ni sesión real.
- **V2 pendiente**: Postgres real + runtime NOBYPASSRLS con dos empresas/dos sucursales; objetos reales en R2 (o bucket de prueba) y rollback; `raw_file_url` se lee por empresa.
- **V3 pendiente**: recorrido HTTP con Better Auth real (subir → leer archivo propio; rechazo entre empresas/sucursales) y navegador.
- Sin R2 configurado, la ruta degrada a `local://…` y NO afirma durabilidad; el modelo privado durable exige R2 (mismo criterio que `scoped-evidence.ts`).
- No se modifica el recorrido de ingesta de ventas (fuente `pos:import`) ni se aplica migración. Sin despliegue.

No se acepta `INV-01.b4.storage`, el padre `INV-01.b4`, `INV-01.b` ni la fila 11.11. El cierre del padre sigue pendiente de `b4.coverage` (cogs/executive/menu), la dependencia `b4b` y la aceptación HTTP/UI en `INV-01.d`.
