# INV-01.b4b — Importación mediante writer atómico

Actualización 2026-11-22: **solo `INV-01.b4b.rls` queda aceptado V1/V2** con
login independiente, privilegios mínimos y copia desechable; [aceptación y
límites](../../2026-11-22/INV-01.b4b.rls/README.md). `INV-01.b4b` y los padres
siguen pendientes. Las restricciones históricas siguientes describen su fecha.

Continuación 2026-11-12. Base `2be55da631e34203b9f3dc5f9b8c1296751ca1ca`, árbol inicialmente limpio. Estado: código implementado; 109 unitarias focales, 15 pruebas Postgres aisladas y build global aprobados. No se acepta todavía el ticket ni la fila 11.11: dependencias/checkpoint y propagación visible siguen pendientes.

Implementación en cuatro archivos: `lib/services/sales-ingest-service.ts`, `lib/services/sale-consumption-service.ts`, `lib/services/__tests__/sales-ingest-service.test.ts`, `tests/integration/sale-consumption-application-db.test.ts`.

La ingestión usa `planSalesImport`, conserva identidad producto/día y admite fuente estable explícita (default `pos:import`, nunca el archivo). Verifica sucursal y resuelve UUID/nombre dentro de la empresa en la misma conexión serializable que aplica el writer. Nombres ambiguos o UUID ajenos no resuelven. Cada grupo usa el savepoint del writer: fallos de negocio devuelven errores para todas sus filas; fallos de infraestructura/serialización revierten el lote, con reintentos acotados de 40001/40P01. Insertado, actualizado y repetido se contabilizan por separado. No queda upsert de venta seguido de consumo legacy en este servicio.

El writer admite `totalRevenueCents: null` y conserva NULL en la revisión canónica. La proyección `sales_entries.total_revenue` mantiene su contrato no nullable: subtotal conocido, jamás se usa ese subtotal como prueba de cobertura. El resultado de importación entrega `revenueCoverage` por receta/día y `revenueComplete`; se consulta el head final de todos los productos/fuentes de esa receta/día. Un grupo con cualquier línea sin ingreso conserva NULL. Completar solo el ingreso no mueve stock. Se mantiene el bloqueo de ventas legacy sin revisión/proyección demostrable o con asignaciones incompletas; la prueba histórica previa continúa pasando.

## Preparación INV-01.b4b.rls

La primera ejecución con conexión TLS funcional reprodujo dos fallos nuevos `42501 permission denied for table recipes`: el catálogo runtime concedía columnas del snapshot, pero no `name`. Los 12 casos previos del writer pasaron. Se abrió el hijo b4b.rls para mantener el límite de archivos: SQL custom `0141_inv01b_import_recipe_name.sql`, journal/snapshot generados con `pnpm.cmd db:generate --custom --name=inv01b_import_recipe_name`, y prueba SQL compartida. La migración solo concede SELECT(name) si existe `pulso_app`; no amplía DML, SELECT general ni RLS. En cada fixture se ejecuta dentro de la transacción dueña antes de SET LOCAL ROLE; el rollback final revierte tanto el permiso como todos los datos sintéticos. **0141 no se aplica persistentemente a la rama aislada ni a main.**

## Verificación

- Regresión focal: `pnpm.cmd exec vitest run --configLoader bundle lib/services/__tests__/sales-ingest-service.test.ts lib/services/__tests__/sales-ingest-revisions.test.ts lib/services/__tests__/sale-consumption-contract.test.ts lib/services/__tests__/sale-consumption-delta.test.ts lib/services/__tests__/sale-consumption-snapshot.test.ts tests/unit/faltantes-traceability.test.ts tests/unit/migration-manifest.test.ts --maxWorkers=1 --pool=threads`: **109/109, siete archivos, exit 0**. Seis casos del adaptador usan doble de frontera del writer; no sustituyen Postgres.
- SQL: `$env:NODE_OPTIONS='--use-system-ca'; pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-consumption-application-db.test.ts --maxWorkers=1 --pool=threads`: **15/15, exit 0**, 12 regresiones y tres recorridos nuevos, rol `pulso_app`, aislamiento serializable, dos empresas/tres sucursales y rollback de fixtures. `.env.test` se comprueba contra el host operativo antes del provisionamiento. Rama aislada existente: `br-round-voice-belheola`, proyecto `soft-cloud-50478212`.
- Node v22.17.1 inicialmente no podía verificar el certificado TLS (`unable to verify the first certificate`). El reintento usa `--use-system-ca`; nunca se deshabilitó TLS ni se guardó configuración de certificados en el repositorio. La variable `NODE_USE_SYSTEM_CA=1` no resolvió el fallo en esta versión.
- TypeScript global `pnpm.cmd exec tsc --noEmit`: exit 0 inicial y exit 0 final después de añadir los últimos tests.
- ESLint de los cuatro archivos de implementación: exit 0.
- `pnpm.cmd run build`: **exit 0 acreditado** al reintentar después de que terminó el otro proceso, con `NODE_OPTIONS='--max-old-space-size=4096 --use-system-ca'` solo en el proceso del comando. Compilación en 104s, TypeScript completo, 444/444 páginas y optimización final. [Salida completa](build-success.txt). No se modificó configuración del proyecto ni se omitieron comprobaciones. Los intentos previos se conservan: lock ocupado; compilación correcta pero worker TypeScript exit 134 por heap cercano a 2 GB; reintento con 4 GB exit 1 por conexión al descargar fuentes. La ejecución final tuvo acceso de red autorizado y certificados del sistema, sin desactivar TLS.
- Avisos no bloqueantes del build final: `fetchConnectionCache` deprecado y `DYNAMIC_SERVER_USAGE` en `/dashboard/labor/documents` por `headers`; la ruta aparece dinámica en la salida final. El comando completó con exit 0; no se afirma ausencia de avisos.
- Validador final `pnpm.cmd exec tsx scripts/validate-faltantes.ts`: 239 filas, 86 entradas base, 73 hijos, 12 aceptaciones previas, cero errores, exit 0. El primer intento detectó la dependencia heredada INV-01.a ausente del hijo nuevo; se corrigió antes del resultado final.
- Revisión del diff: SQL parametrizado, sin dependencias añadidas, mismo writer/savepoint para venta y stock, sin cambios de contratos contables. `git diff --check`: exit 0. Apareció `.claude/settings.local.json` durante la ejecución; no forma parte de este incremento y no se modifica.

## Continuación 2026-11-17 — V2 reejecutada sobre el branch aislado

HEAD `69b044cd6cc330ebfc03f533d068e18df85ba23f` (los commits `368264c`/`69b044c` de otra sesión entraron durante la ejecución; el árbol probado es el vigente). Entorno: rama Neon aislada `ep-cold-morning-bewqoz3o` (`neondb`), rol `pulso_app` con `rolbypassrls=false` y sin membresías. No se aplicó DDL en esta sesión: al abrir la transacción autorizada para `0137/0138/0139/0141/0154` los objetos ya existían (otra sesión los había instalado), así que se hizo **rollback** sin cambios.

**Deriva de privilegios detectada y corregida (solo `recipes`).** El primer intento dio **16/17**: el caso «permiso de nombre mantiene RLS sin contexto y entre empresas» esperaba `42501` al hacer `UPDATE recipes` como `pulso_app` y no hubo error. La causa era deriva del entorno: `pulso_app` tenía `SELECT/INSERT/UPDATE/DELETE` **a nivel de tabla** en `public.recipes`, privilegio que ninguna migración concede (0137/0138/0141 solo otorgan columnas). Se revocaron esos grants y se reaplicaron exactamente los de `0137` (`id, company_id`), `0138` (`id, company_id, base_yield, unit`) y `0141` (`name`). Resultado: `has_table_privilege('pulso_app','public.recipes','UPDATE') = false`, `name` legible. La ejecución posterior pasó completa.

| Comando | Resultado |
|---|---|
| `NODE_OPTIONS=--use-system-ca pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-consumption-application-db.test.ts --maxWorkers=1 --pool=threads` | **17/17, exit 0**, 137.59 s |
| Primera ejecución, mismo comando (antes del fix de grants) | 16/17, 1 fallo esperado `42501`; conservado como diagnóstico |

Cubre: importación con y sin ingreso, repetición/corrección, captura manual atómica, resolución de nombres bajo runtime, receta ajena/ambigua, insuficiencia de stock, cambio de receta con reversión al lote original (incluido vencido), corrección monetaria sin mover stock, revisión obsoleta, venta legacy sin consumo, ingreso desconocido ≠ cero, precisión/desbordamiento y snapshot serializable obligatorio.

**Límite nuevo, no resuelto:** el branch conserva deriva del mismo tipo en `branches`, `inventory_batches`, `inventory_items` y `sales_entries` (`DELETE,INSERT,SELECT,UPDATE` a nivel de tabla; las migraciones solo conceden columnas). No se revocó para no romper suites concurrentes; el privilegio mínimo real de esos objetos queda para `SEC-05`. Esto no invalida los 17 casos (el writer solo usa columnas concedidas y RLS sigue activo), pero **no** debe declararse V2 de privilegios mínimos cerrada para esas tablas.

No se acepta todavía `INV-01.b4b`, `b4b.rls`, el padre `b4` ni `INV-01.b`: siguen pendientes la aceptación formal de la dependencia b4a en el registro, el checkpoint, las V3 HTTP/UI de `manual/bulk/smartlink/ui`, las V2/V3 de `storage` y `coverage.executive/menu`, y el build del hito.

## Límites y continuación

No se aplican migraciones a main, no hay backfill, despliegue ni aceptación operativa/API/UI. Los lectores legacy que consultan solo `sales_entries` todavía no reciben cobertura; deben consumir heads/cobertura antes de presentar ese subtotal como ingreso completo. Las fronteras API/UI deben mostrar `updated` y cobertura y fijar namespaces según origen en b4/INV-01.d. La captura manual y cualquier otra frontera que siga escribiendo consumo por separado permanecen en b4. Recuperación y carreras de conexiones independientes siguen en INV-01.c. El build global queda acreditado; las dependencias b3/b4a requieren su cierre de checkpoint por separado. No hay commit ni cierre de padre basado solo en este build.
