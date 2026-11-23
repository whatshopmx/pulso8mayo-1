# INV-01.b4b — aceptación V1/V2 del servicio de ingestión

2026-11-22. Base `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. **Aceptado V1/V2 en entorno aislado**, conforme al alcance del hijo. No acepta los padres INV-01.b/b4, la fila 11.11, propagación visible pendiente, recovery, migración operativa ni despliegue.

Las cuatro dependencias están aceptadas en el mapa: INV-01.a, INV-01.b3, INV-01.b4a e INV-01.b4b.rls. La preparación RLS conserva su [aceptación anterior](../INV-01.b4b.rls/README.md), incluidos SELECT(name) mínimo, ausencia de SELECT general/DML, nombres ambiguos/ajenos y dos empresas/tres sucursales. El servicio y las reglas puras no se sustituyeron; se desbloqueó el arnés de V2.

El template con datos seguía afectado por el scheduler TimescaleDB. Se eligió explícitamente una base vacía desde template0 y el snapshot versionado 0158, conservando PK/FK/checks/defaults/políticas, SQL custom de inmutabilidad y grants declarados. No se modifica el comportamiento por defecto de los otros consumidores del provisionador ni se atribuye a esta prueba una migración de datos históricos. [Construcción, límites y carreras complementarias de políticas](../INV-02/runtime.md).

La prueba llama SalesIngestService.ingest; el propio servicio abre su conexión runtime, verifica login sin bypass/propiedad/membresías y opera con SERIALIZABLE. Los resultados se observan después del commit desde otra conexión. Cada archivo usa su propia base y login aleatorios, retirados y verificados al terminar. No se usa SET ROLE, doble de writer ni conexión dueña como runtime.

| Criterio de INV-01.b4b | Evidencia |
| --- | --- |
| Identidad y agrupación bajo catálogo propio | UUID/nombre con rol mínimo, SKU estable, filas agrupadas y conteos inserted/updated/skipped; unidad y recorridos nativos. Resolución ambigua/ajena conserva la aceptación de b4b.rls. |
| Ingreso no reportado | Grupo mixto queda con ingreso canónico NULL; proyección mantiene subtotal conocido y cobertura false. Completar ingreso conserva los movimientos. Cero conocido sigue siendo cero. |
| Corrección, repetición y cobertura entre fuentes | Misma identidad, diferencial físico exacto, repetición sin efectos, nueva fuente manual y cobertura conjunta de receta/día. |
| Fallos de negocio por grupo | Insuficiencia y receta ajena devuelven todas las filas agrupadas; se conserva únicamente el grupo válido. |
| Captura atómica | Un grupo insuficiente revierte también los grupos anteriores, observado en la conexión independiente. |
| Infraestructura | Trigger P0001 real en el segundo grupo: el lote no atómico se aborta íntegro, sin convertir el fallo SQL en error de negocio ni dejar consumo parcial. |
| Consumo previo no demostrado | Se conserva el bloqueo del writer b3 y su aceptación previa; el servicio no lo elude con upsert/consumo legacy separado. Las nuevas pruebas pasan por ese mismo writer/savepoint. |

Resultados finales:

- **109/109 unitarias**, siete archivos, exit 0, 8.05 s. Incluye servicio/normalización/revisiones/contrato/diferencial/snapshot y trazabilidad/manifiesto.
- **4/4 V2 de ingestión**, exit 0, 85.862 s de pruebas; dentro de la corrida conjunta de **12/12, cero omitidas**, dos archivos, exit 0, 253.11 s. Las otras ocho corresponden a INV-02 y no se cuentan como cuatro ingestiones adicionales.
- [Resultados nativos por nombre, estado, duración y hashes](../INV-02/runtime-results.json). El exportador exige doce éxitos, cero omitidas y limpieza terminada.
- ESLint de los cuatro archivos de pruebas/provisión modificados: exit 0, sin avisos. `git diff --check`: exit 0.
- Build final del código de aplicación, sesión 10116: **exit 0**, Webpack 5.2 min, TypeScript aprobado, 455/455 páginas y trazas completas. Sólo se añadieron/modificaron pruebas después de iniciar ese build; el código de aplicación probado no cambió.

Comandos:

```powershell
pnpm.cmd exec vitest run --configLoader bundle lib/services/__tests__/sales-ingest-service.test.ts lib/services/__tests__/sales-ingest-revisions.test.ts lib/services/__tests__/sale-consumption-contract.test.ts lib/services/__tests__/sale-consumption-delta.test.ts lib/services/__tests__/sale-consumption-snapshot.test.ts tests/unit/faltantes-traceability.test.ts tests/unit/migration-manifest.test.ts --maxWorkers=1 --pool=threads
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_RECIPE_POLICY_RUNTIME='1'
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/recipe-policy-runtime-db.test.ts tests/integration/sales-ingest-runtime-db.test.ts --maxWorkers=1 --pool=threads --reporter=default --reporter=json --outputFile=.tmp/inv02-runtime-final.json
```

La suite caracteriza el modo anterior a activar políticas (baseline 0158, sin catálogo 0159); la suite complementaria verifica el modo publicado con 0159/0160. Las fronteras HTTP/UI, enlaces, storage, lectores financieros y recovery conservan sus tareas y puertas propias. La aceptación del servicio no convierte una evidencia sintética en prueba de operación de una sucursal real.
