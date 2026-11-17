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

## Límites

Este es un gate SQL, no una corrida Next autenticada con conexión de login
`pulso_app`. Las rutas POS aún deben usar contexto transaccional y proyecciones
compatibles con esos permisos. La adopción del rol de runtime para auth y los
demás lectores del servidor corresponde a SEC-05 y al lote/entorno de OPS-03.
No se acepta `INV-01.b4.storage` ni sus padres. No cambió código de aplicación en
este primer incremento y no se repitió un build de Next sin cambios ejecutables.
