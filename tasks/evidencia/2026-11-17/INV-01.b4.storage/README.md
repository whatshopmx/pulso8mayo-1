# INV-01.b4.storage — Almacenamiento POS privado durable y lectura autorizada

Continuación 2026-11-17 sobre HEAD `0dfd139d75a5870d7af3baad5423d218f54a093f` más cambios locales. **V1, V2, V3 HTTP y V3 navegador comprobadas con R2 real y sesión Better Auth real; sin aceptación: falta el runtime NOBYPASSRLS de V2.** Abajo se conservan, en orden, las continuaciones del 17 y del 18.

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

## Continuación 2026-11-17 — V2/V3 con R2 real y sesión Better Auth

HEAD `81ec4ddb97e6327b8c557c5ff9769d99a4b048af`. Incremento de verificación: **no se tocó código de producción**; se añadió una prueba de integración.

Archivo nuevo: `tests/integration/pos-storage-r2-db.test.ts` (3 casos).

| Comando | Resultado |
|---|---|
| `NODE_OPTIONS=--use-system-ca pnpm exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/pos-storage-r2-db.test.ts` | **3/3, exit 0** (27,6 s; 23,8 s de pruebas) |
| `pnpm exec eslint tests/integration/pos-storage-r2-db.test.ts` | **exit 0**, sin errores ni advertencias |

`NODE_OPTIONS=--use-system-ca` es necesario en este Windows para la cadena TLS de Neon y de R2.

### Entorno real de la corrida

- **Postgres**: base aislada de `.env.test` (`TEST_DATABASE_URL`, mismo branch aislado de trabajo). La prueba verifica en `beforeAll` que su host **no** coincide con el de `DATABASE_URL` de `.env`; nunca corre contra la operativa.
- **Rollback**: empresas, sucursales, usuarios, cuentas y cortes se insertan dentro de `db.transaction` y se fuerza rollback. Al final se comprueba que no sobreviven usuarios, sesiones, empresas ni cortes. Los inicios de sesión de better-auth también se revierten.
- **R2**: bucket real (`R2_BUCKET_NAME`) con credenciales de `.env`; la prueba exige `isR2Configured() === true` y falla con mensaje explícito si no lo está. Los objetos creados se borran en `afterAll` y se verifica que `getFromR2` ya no los encuentre (sin residuos en el bucket compartido).
- **Sesión**: Better Auth real por HTTP loopback (`/api/auth/sign-in/email`); la cookie resultante se valida con `auth.api.getSession` y se usa en las peticiones siguientes. Next sólo aporta `headers()`/`cookies()` (mismo patrón que `cogs-session-db.test.ts`); no se levanta `next dev`.

### Casos (V2)

1. Tras subir el archivo por la ruta, `daily_sales_cuts.raw_file_url` guarda la **KEY** `companies/{companyA}/branches/{branchA1}/pos/{fecha}/\d+_cierre_POS_.csv` — jerarquía de tenancy, nombre normalizado y nunca una URL `http(s)://`.
2. Una llamada GetObject independiente (`getFromR2`) devuelve **los mismos bytes** subidos: el objeto existe de verdad en R2, no es un mock.
3. La base sintética usa dos empresas y tres sucursales; lectura entre empresas y entre sucursales queda separada (ver V3).
4. Rollback sin residuos en DB y borrado verificado de los objetos R2.

### Casos (V3 HTTP)

| Caso | Resultado |
|---|---|
| POST multipart sin sesión | 401 |
| POST multipart con ADMIN de la empresa, sucursal propia | 200, `durable: true`, `matchedCount: 1`, key privada |
| GET `/api/sales/cuts/[id]/pos-file` como ADMIN de la empresa | 200 con `url`, `fileKey` y `expiresInSeconds: 600` |
| Descarga de la URL firmada | 200 y bytes idénticos al archivo subido |
| GET sin sesión | 401 |
| GET como GERENTE de la misma sucursal | 200 |
| GET como GERENTE de otra sucursal de la misma empresa | 404 |
| GET como ADMIN de otra empresa | 404 |
| GET como EMPLEADO (rol sin acceso a evidencia financiera) | 403 |
| POST como GERENTE hacia otra sucursal | 403 y `raw_file_url` sigue `NULL` |
| POST como ADMIN de otra empresa apuntando a sucursal ajena | 400 y `raw_file_url` sigue `NULL` |
| POST con `x-pulso-tenant-id` de otra empresa | 403 y sin escritura |
| POST con archivo vacío | 400 |
| POST con MIME no permitido (`application/pdf`) | 400 |

Los `console.error` de `ApiHandler.error` y de `[upload-pos] parse/ingest failed` en la salida son los rechazos **esperados** de cada caso, no fallos.

### Fallo encontrado en el propio arnés (no en el producto)

La primera corrida dio 2/3: `RequestContentLengthMismatchError` al subir un archivo vacío. Causa: el servidor loopback copiaba **todas** las cabeceras de la petición al fixture de sesión, así que el `content-length` de la petición anterior viajaba en la siguiente. Se corrigió copiando sólo `cookie` y `x-pulso-tenant-id` (y enviando sólo la cookie en las peticiones del cliente). No hubo cambio de código de producción.

## Límites

- **Runtime de la corrida**: `TEST_DATABASE_URL` conecta con el rol dueño del branch, no con `pulso_app` NOBYPASSRLS. El aislamiento acreditado es el de la **frontera de aplicación** (sesión → `company_id` en el `WHERE` y `resolveBranchScope`), que es la que usa esta ruta; RLS y privilegios de runtime para este flujo siguen en la órbita de SEC-05. No se afirma V2 de RLS aquí.
- **V3 navegador pendiente**: se acreditó el recorrido HTTP real con sesión; la pantalla que consume `pos-file` corresponde a `INV-01.d`/`b4.ui`.
- **V1** sigue siendo la de unitarias con R2 y DB mockeados (21/21 ya registrada arriba).
- Sin R2 configurado, la ruta degrada a `local://…` y NO afirma durabilidad; el modelo privado durable exige R2 (mismo criterio que `scoped-evidence.ts`).
- No se modifica el recorrido de ingesta de ventas (fuente `pos:import`) ni se aplica migración. Sin despliegue.
- El nombre del archivo se normaliza (`cierre POS!.csv` → `cierre_POS_.csv`); es comportamiento documentado por la unitaria, no una pérdida silenciosa.

No se acepta `INV-01.b4.storage`, el padre `INV-01.b4`, `INV-01.b` ni la fila 11.11. Para aceptar `b4.storage` falta la V3 navegador; el cierre del padre sigue pendiente además de `b4.coverage` (cogs/executive/menu) y la dependencia `b4b`.

## Continuación 2026-11-18 — productor directo adaptado al contrato POS

`app/api/sales/cuts/upload` (pantalla `/dashboard/sales/upload` y diálogo «Registrar Corte de Ventas») ya no escribe el namespace legacy `sales-cuts`: resuelve el día efectivo del corte, persiste la key canónica `companies/{companyId}/branches/{branchId}/pos/{businessDate}/…`, valida alcance de sucursal, roles, tamaño y MIME, y reutiliza el build para ingestar sin parsear dos veces. Los cortes que antes quedaban sin archivo legible se abren con la ruta de lectura existente.

Verificación: 10/10 unitarias de la ruta, 2/2 del servicio precomputado, 80/80 focales con regresión, 4/4 integración con R2 real + Neon aislado + sesión Better Auth real, `tsc`, ESLint y build completo (455/455 páginas) exit 0. [Detalle y límites](legacy-producer.md). No hay aceptación nueva; runtime NOBYPASSRLS sigue pendiente.

## Continuación 2026-11-18 - V3 navegador del productor directo

`tests/integration/pos-next-browser.test.ts` incorpora un tercer caso que recorre la pantalla real `/dashboard/sales/upload` contra un Next de producción (build aparte en `.tmp/next-pos-browser` para no competir con `next dev`), Better Auth real, Neon aislado y R2 real: sube el CSV por el `<input type="file">`, espera el 200 de `POST /api/sales/cuts/upload`, comprueba las dos filas `SALON`/`DELIVERY` con la key canónica, los bytes en el bucket y la lectura autorizada del corte recién creado. 3/3 casos, exit 0. El recorrido encontró que la pantalla navegaba a `/dashboard/sales/cuts`, una ruta sin página: corregido a `/dashboard/sales`. También queda registrado que ningún layout monta `<Toaster />`, así que los avisos `toast` no se pintan (brecha global, no corregida aquí). [Detalle y límites](next-browser-v3.md). Se mantienen 24 registros aceptados.
