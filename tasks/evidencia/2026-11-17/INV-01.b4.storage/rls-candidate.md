# POS — Candidata RLS y privilegios del vínculo de archivo

Base: `d3a2d64` más cambios locales preexistentes. Este incremento prepara
`0155_pos_storage_rls`; no aplica migraciones persistentemente a ningún entorno.

## Brecha reproducida

En la base aislada, `pulso_app` existe con `rolbypassrls=false` y `rolsuper=false`.
`daily_sales_cuts` tenía RLS desactivado y carecía de los permisos POS necesarios.
La primera prueba obtuvo `42501 permission denied`; eso no acreditaba RLS.
Con solo `SELECT(id)` concedido temporalmente dentro de una transacción, el rol
pudo leer los tres UUID sintéticos de dos empresas sin contexto de tenant.
La prueba esperaba cero y falló. No se consultaron filas ajenas al fixture.

## Contrato de la candidata

- Habilita RLS en `daily_sales_cuts` con `USING` y `WITH CHECK` por empresa y sucursal opcional. Sin empresa no hay lectura; sin sucursal el contexto abarca la empresa.
- Verifica que la sucursal de la fila pertenezca a la misma empresa, incluso frente a una escritura cruzada con permiso temporal sobre `branch_id`.
- Añade SELECT de `id, company_id, branch_id, business_date, raw_file_url` y UPDATE de `raw_file_url, validation_notes, updated_at` para `pulso_app`. No concede UPDATE de importes ni SELECT/UPDATE generales de tabla.
- Concede únicamente `branches(id, company_id)` para evaluar la pertenencia. No crea roles, credenciales ni membresías y no revoca privilegios de otros dominios.
- No fuerza RLS sobre el dueño de migración; la verificación cambia explícitamente a `pulso_app`, sin superuser ni bypass.

El modelo sigue las [políticas RLS de PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
La migración se generó con `pnpm db:generate --custom --name=pos_storage_rls`;
journal y snapshot están enlazados a 0154 y conservan el mismo schema declarativo,
como corresponde a una migración custom.

## Verificación del primer incremento

| Control | Resultado |
|---|---|
| Integración `pos-storage-rls.test.ts` | 4/4, exit 0; rol `pulso_app` real mediante `SET LOCAL ROLE`, SQL y RLS reales |
| Manifiesto de migraciones + trazabilidad | 20/20, dos archivos, exit 0 |
| ESLint del test SQL | exit 0 |
| Snapshot generado | `prevId` enlazado, contenido declarativo idéntico a 0154 salvo identificadores |

Los casos verifican: lectura sin contexto vacía; lectura de empresa y sucursal
sin filtros de tenant añadidos al SQL; vínculo propio y cero filas de otros
ámbitos; `42501` al editar `total_sales`; `WITH CHECK` ante sucursal cruzada.

Cada fixture instala la candidata en la transacción dueña, cambia al rol runtime
y termina en rollback. Se comprueba ausencia de las empresas sintéticas. Un
`afterAll` compara el catálogo antes/después: flags RLS, permisos de tabla y de
la key, y número de políticas permanecen iguales. Tampoco quedan grants o DDL.

## Segundo incremento: frontera de datos de las rutas

Sobre `e05449f`, se reprodujeron dos fallos de las rutas con PostgreSQL real,
la candidata instalada dentro de una transacción y `SET LOCAL ROLE pulso_app`:
GET devolvía 404 por no fijar contexto y el vínculo JSON devolvía 500/42501
porque `RETURNING *` solicitaba columnas no concedidas.

`lib/services/pos-cut-file-service.ts` concentra lectura y vínculo en
`withCompanyContext`. El contexto procede de la sesión y de las guardias de
sucursal. La lectura incluye empresa e ID, y sucursal para roles fijos; la
actualización conserva empresa, sucursal y día y devuelve únicamente `id`.
Ambas variantes de upload (multipart y JSON) usan esa actualización.

`pos-routes-rls.test.ts` prueba las rutas reales y sus consultas reales. Solo
sesión y R2 son dobles; la conexión cambia al rol existente `pulso_app`, cuya
ausencia de bypass se verifica, sin alterar contraseñas o membresías. Los
cuatro casos acreditan lectura propia, vínculo JSON propio y 404 sin firma
ante empresa o sucursal ajena. Cada fixture revierte DDL, grants y datos, y
comprueba que su empresa sintética no existe al finalizar.

| Control | Resultado |
|---|---|
| Rutas + políticas SQL, dos archivos de integración | 8/8, exit 0 |
| Unitarias de lectura, vínculo y almacenamiento POS | 44/44, tres archivos, exit 0 |
| ESLint de servicio, rutas y pruebas modificadas | exit 0 |
| Build de Next con Webpack y TypeScript | exit nativo 0, 637 s; `.tmp/pos-rls-build-result.json` |
| Next + sesión Better Auth + Neon aislado + R2 reales | `pos-next-browser.test.ts`, 1/1, exit 0; 40.48 s de prueba |

La última corrida de Next usa el build anterior de esta tabla y vuelve a
verificar carga, bytes del objeto, detalle de ventas y descarga en navegador,
rechazo de referencias ajenas, cierre de sesión y usuarios fuera del alcance.
Conserva el alcance y la limpieza descritos en `next-runtime.md`: el servidor
usa la conexión dueña actual (`bypassRls=true`), no acredita por sí solo RLS.
La evidencia de `pulso_app` corresponde a los dos archivos SQL de esta tabla.

## Límites

La prueba con `pulso_app` acredita SQL y frontera de datos de las rutas con
sesión/R2 simulados, no una corrida Next autenticada con conexión de login
`pulso_app`. La adopción del rol de runtime para auth y los
demás lectores del servidor corresponde a SEC-05 y al lote/entorno de OPS-03.
No se acepta `INV-01.b4.storage` ni sus padres. La candidata 0155 permanece
sin aplicar persistentemente. No se amplían permisos de auth, ingestión,
listados o importes para hacer pasar esta frontera POS.
