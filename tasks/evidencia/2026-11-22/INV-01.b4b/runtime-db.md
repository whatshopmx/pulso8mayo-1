# INV-01.b4b — ingesta con commits y login independiente

2026-11-22. Actualización posterior: **4/4 V2 de ingestión aprobadas y servicio b4b aceptado V1/V2** mediante baseline vacía explícita. [Aceptación vigente y límites](accepted.md). Los apartados siguientes conservan el diagnóstico del intento anterior; el origen no se intervino.

## Intento previo mediante copia del template

Código de pruebas: `b1b791e6252e90f83b3f45c4bca91fe35fb29cea`.
Estado de ese intento: **pruebas preparadas; nueva V2 sin ejecutar por fallo de clonación**.
No se aceptó b4b ni ningún padre en ese intento; entonces había 25 registros aceptados.

Se añadió `tests/integration/sales-ingest-runtime-db.test.ts`, sin cambios en
aplicación, SQL ni permisos compartidos. Usa el provisionador existente de copia
desechable, login nuevo NOBYPASSRLS/NOSUPERUSER y grants declarados. Los imports
del host se resuelven después de provisionar; `SalesIngestService.ingest` abre
su conexión real con `SALES_RUNTIME_DATABASE_URL`, guardia de rol y aislamiento
serializable. Las observaciones se hacen después del commit desde otra conexión.

Los cuatro casos preparados verifican:

- Agrupación con ingreso NULL, repetición sin efectos, delta físico, completar
  solo ingreso y cobertura conjunta entre fuentes; cero conocido sigue siendo cero.
- Fallos de negocio por stock o receta ajena conservando grupos válidos y
  devolviendo el error de todas las filas agrupadas.
- Captura atómica que revierte grupos anteriores ante insuficiencia de stock.
- Fallo SQL P0001 inyectado mediante trigger solo en la copia, tras un primer
  grupo válido: aborta todo el lote, incluso sin atomic. Se exige código y
  mensaje del fallo; una excepción cualquiera no cuenta como prueba.

## Resultados comprobados

| Verificación | Resultado |
| --- | --- |
| Siete archivos focales de ingesta/writer/manifiesto/trazabilidad | 109/109, exit 0, 17.61 s |
| ESLint del archivo nuevo | exit 0, sin avisos |
| Integración nueva | exit 1 en beforeAll; **0 casos ejecutados, 4 omitidos**, no se acredita V2 |
| Limpieza del provisionador | databaseCreated=false, roleCreated=false, closed=true; no llegó a crear base ni rol |
| Diagnóstico mínimo de clonación | 55006 reproducido fuera de Vitest; bases de diagnóstico ausentes al terminar |

El build previo de aplicación sigue vigente porque solo se añadió una prueba,
excluida del build según la configuración del proyecto. Ese build no acredita
estos cuatro casos nuevos ni reemplaza la V2 pendiente.

## Causa observada del bloqueo

El preflight y la consulta posterior devolvían cero conexiones en `neondb`,
pero CREATE DATABASE fallaba con «There is 1 other session using the database».
Una segunda conexión observó pg_stat_activity cada 100 ms **durante** el comando
y capturó `TimescaleDB Background Worker Scheduler for database 16397` en
`neondb`. La sesión desaparecía antes de la consulta posterior. El cliente de
clonación confirmó current_database=postgres; servidor 18.7 (84da7d8).

Esto sustituye la hipótesis anterior de imports como explicación demostrada:
no se aisló entonces un import culpable. La copia puede fallar sin cargar la
aplicación. La observación identifica un worker interno durante el comando;
no demuestra que toda espera histórica tuviera esta causa.

La opción timescaledb.disable_load=on, limitada a una sesión administrativa
de diagnóstico, tampoco evitó el worker ni el 55006. No se aplicó al proyecto
ni se cambió la configuración de la base origen. El
[loader oficial](https://github.com/timescale/timescaledb/blob/main/src/loader/loader.c)
contiene notificación RESTART al usar un template explícito, compatible con
la observación. No se presume que su versión main sea idéntica a la instalada.

No se ejecutó timescaledb_pre_restore/post_restore, ALTER DATABASE,
pg_terminate_backend ni instalación/desinstalación de extensiones en el origen.
La alternativa a evaluar es una rama de prueba independiente o un procedimiento
coordinado de copia compatible con el scheduler; no un fallback a escritura en
la base compartida. La suite conserva su fallo explícito ante este bloqueo.

## Reproducción

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-ingest-runtime-db.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec eslint tests/integration/sales-ingest-runtime-db.test.ts
pnpm.cmd exec vitest run --configLoader bundle lib/services/__tests__/sales-ingest-service.test.ts lib/services/__tests__/sales-ingest-revisions.test.ts lib/services/__tests__/sale-consumption-contract.test.ts lib/services/__tests__/sale-consumption-delta.test.ts lib/services/__tests__/sale-consumption-snapshot.test.ts tests/unit/faltantes-traceability.test.ts tests/unit/migration-manifest.test.ts --maxWorkers=1 --pool=threads
```

El wrapper local `node .tmp/pos-next-verify.cjs ingest` exige los cuatro nombres
con status passed y rechaza una corrida omitida aunque el runner devolviera cero.
Log/reporte/resultado del intento están en `.tmp/sales-ingest-provision-failure*`;
diagnóstico final en `.tmp/pos-clone-probe-result.json`. Son artefactos locales,
no requisitos para reproducir desde checkout ni evidencia de cuatro éxitos.

La dependencia de catálogo b4b.rls conserva su aceptación aislada anterior;
este fallo no modifica aquellos resultados. Ingestión, padres y matriz 11.11
conservan sus estados pendientes/Parcial. Sin despliegue ni aplicación operativa.
