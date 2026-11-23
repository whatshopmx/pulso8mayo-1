# INV-02 — PostgreSQL independiente desde base vacía

Base: `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. **8/8 V2 nativas de políticas y 4/4 de ingestión**, doce aprobadas sin omisiones. Sin aceptación dependiente de INV-02, migración operativa ni activación externa. INV-01.b4b sí acredita sus propios criterios V1/V2 aislados: [aceptación y límites](../INV-01.b4b/accepted.md).

La copia del template compartido estaba bloqueada por el scheduler de TimescaleDB, según la evidencia de INV-01.b4b. El motor Docker local tampoco está disponible (comprobado dentro y fuera del sandbox). Se implementó una alternativa explícita del provisionador: `createSalesRuntimeDatabase({ baseline: '0158' })`. El comportamiento por defecto de los demás consumidores sigue siendo la copia original.

La alternativa exige el mismo endpoint de pruebas distinto del operativo, crea una base con nombre aleatorio desde `template0` y reconstruye las **206 tablas** del snapshot 0158 mediante la API instalada de Drizzle Kit. Se restauran desde 0137 los cinco bloques SQL de FORCE/función/triggers de inmutabilidad que no representa el snapshot. Los grants declarados de 0137/0138/0139/0141 se conceden sólo al login aleatorio nuevo, sin modificar pulso_app ni membresías compartidas. Después, la suite aplica **0159/0160 reales y completos sólo en esa base**, alcanzando 207 tablas.

Esto prueba un esquema nuevo con las columnas, defaults, índices, PK/FK/checks y políticas del snapshot, más los SQL personalizados indicados. No demuestra la actualización de una base existente con sus datos y permisos históricos, ni que se hayan restaurado todos los triggers manuales de otros dominios. No se declara equivalencia con la migración de un entorno desplegado.

Referencias de la alternativa: [CREATE DATABASE/template0 de PostgreSQL 18](https://www.postgresql.org/docs/18/sql-createdatabase.html), [administración de bases mediante SQL en Neon](https://neon.com/docs/manage/databases). Se usa el driver WebSocket existente; no se añadió dependencia ni CLI externa.

Seguridad y limpieza:

- Se generan base y login únicos; el login es NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB, sin membresías.
- La guardia real de withSalesWriterTransaction comprueba credenciales independientes, tablas/RLS y ausencia de propiedad antes de ejecutar el callback.
- Se valida el prefijo/nombre y propiedad de la base antes de eliminarla. FORCE sólo afecta a esa base generada. Se verifica ausencia de base/rol después de retirarlos.
- El manifiesto local `.tmp/sales-runtime-database-fixture.json` conserva sólo identificadores y estado de limpieza; nunca contraseñas ni URI. No se terminan conexiones ni se modifica la base origen.

Resultados obtenidos:

1. **Smoke nativo 1/1, exit 0, 13.65 s:** reconstrucción de 206 tablas y sesión con current_user=session_user=login nuevo, base propia y cero membresías; guardia real aprobada. Manifiesto final databaseCreated=false, roleCreated=false, closed=true.
2. Primera ampliación: **4/5 nativas**, exit 1. Correcciones/ingresos/anulación y demanda archivada, falta de cobertura/elaborado sin efectos y fallo de auditoría con rollback pasaron. La prueba de FK usó una versión ajena ya publicada y chocó primero con unicidad (23505), por lo que no demostraba la FK. Se corrigió el caso para usar otra versión ajena sin publicar; no fue un arreglo del código de producto.
3. Ampliación con dos carreras: **7/7 nativas, exit 0**, sesión 68467 terminada; 167.99 s (159.52 s de pruebas). Cada carrera retiene el advisory lock desde una conexión dueña separada y exige observar dos conexiones runtime esperando ese lock en pg_stat_activity antes de liberarlo. Comprueba publicación idempotente y publicación↔venta, no sólo lanzamiento simultáneo de promesas. La prueba corregida alcanza la FK 23503 y verifica además inmutabilidad desde el dueño. Manifiesto final: databaseCreated=false, roleCreated=false, closed=true; base/rol retirados.
4. **Corrida final 12/12, cero omitidas, dos archivos, exit 0**, sesión 89461 terminada, 253.11 s. Políticas: ocho casos (159.020 s de archivo/provisión), incluido padre/subreceta congelada sin relación mutable, retroactividad rechazada y elaborado bloqueado con mensaje PROD-01. Ingestión: cuatro casos (85.862 s de archivo/provisión), sobre otra base fresca. [Reporte sanitizado por caso y hashes de fuentes](runtime-results.json). El exportador comprueba doce éxitos, cero pendientes/omitidas, dos archivos aprobados y limpieza final; los dos afterAll verificaron retiro de sus propios recursos. El manifiesto final también confirma false/false/true.

Las observaciones posteriores al commit proceden de otra conexión. Los escenarios emplean dos empresas, login sin bypass, grants por columna, FK compuestas e inmutabilidad del dueño. Las ventas atraviesan SalesIngestService.ingest y su selector de conexión runtime real. Los triggers de fallo se crean únicamente en la base desechable y se retiran con finally.

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_RECIPE_POLICY_RUNTIME='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/recipe-policy-runtime-db.test.ts --maxWorkers=1 --pool=threads
```

La suite de cuatro pruebas de INV-01.b4b usa la baseline explícita, conserva el modo anterior a activar políticas y restaura el entorno al terminar. Sus cuatro casos pasaron; no se atribuye a las carreras de INV-02 su aceptación. La regresión unitaria de ingestión pasó **109/109**, exit 0, 8.05 s; ESLint de los cuatro archivos modificados de pruebas/provisión: exit 0, sin avisos.

Un diagnóstico auxiliar por tsx falló antes de cargar su script con ENOMEM en uv_os_get_passwd. No cambió datos ni recursos de la prueba; no se reintentó mientras había presión de memoria. Build final de producto **10116 terminado, exit 0**: Webpack 5.2 min, TypeScript aprobado, 455/455 páginas en 106 s y trazas completas. Los cambios nuevos desde ese build son archivos de pruebas, excluidos de la compilación de aplicación; no se necesita repetir el build sin cambios de producto.
