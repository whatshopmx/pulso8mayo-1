# INV-01.a — Identidad y revisión de venta consumida

Fecha local de continuación: 2026-11-11; las capturas posteriores tienen UTC 2026-11-12. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` con cambios locales; [captura renovada](baseline.json). Padre descompuesto en [INV-01.a1](../INV-01.a1/README.md) y [INV-01.a2](../INV-01.a2/README.md) porque contrato/pruebas y persistencia/migración exceden cinco archivos juntos.

Estado: **aceptado V1,V2 en rama aislada**. Checkpoint final: **51 unitarias y 11 de integración, exit 0**, TypeScript exit 0, lint sin errores (tres advertencias en imports previos de schema) y build exit 0 con 443/443 páginas. [Resultados y hashes](results.json), [unitarias](unit.log), [integración](integration.log), [build](build.log). La regresión incluye el arnés y los cuatro casos previos de acceso a ventas.

## Contrato

La identidad es la tupla empresa/sucursal/fuente/producto/día civil. Fuente es un namespace estable (`pos:main`), no el nombre de un archivo. El producto conserva una clave opaca del origen, con mayúsculas significativas, independiente de recipeId. El contrato normaliza UUID/fuente y espacios periféricos del producto; no desplaza fechas por UTC ni redondea cantidades.

Las cantidades vendidas conservan numeric(10,2), igual que sales_entries, como strings exactos no negativos. Solo null explícito representa el primer hecho; un head desconocido o sin cantidad nunca se convierte en cero. Cada revisión registra número/versión previa, cantidad previa/nueva, receta, snapshot de definición/versionKey, asignaciones pendientes por lote/unidad/movimiento original, movimientos diferenciales y actor/fecha. Las unidades físicas de asignaciones y movimientos se expresan como strings con cuatro decimales, según inventario.

`sales_consumption_identities` es la identidad estable. `sales_consumption_revisions` es append-only. La unicidad por identidad/revisión y la FK a identidad/revisión/cantidad previas impiden duplicados, saltos y un antes inventado. FORCE RLS acota empresa y sucursal cuando esta se declara. WITH CHECK verifica que la sucursal y la receta pertenecen a la empresa; el runtime tiene SELECT/INSERT y lectura mínima para esas comprobaciones. Los triggers impiden modificar/eliminar hechos incluso al dueño ordinario.

La bitácora conserva suficiente información para reconstruir 10→12→8→0 y devolver contra la asignación original; las pruebas usan un oráculo manual de 0.1 KG/porción y referencias sintéticas identificadas. **Aquí no se ejecuta el descuento/devolución de stock ni se valida una transferencia física real**: INV-01.b debe crear los movimientos reales y la revisión en una sola transacción, validar referencias/unidades/saldos y construir el snapshot en servidor. Los JSON son snapshots tipados y se exige su forma contenedora; eso no sustituye la validación semántica contra inventario de INV-01.b.

## Datos existentes y compatibilidad

[Main](characterization-main.json) y [rama aislada](characterization-test.json): cero sales_entries, movimientos, recetas y lotes; cero anomalías de alcance o fecha. La cuenta anterior no se consultó ni se presupone vacía. No se ejecuta backfill.

En código, sales_entries no tiene fuente/producto externo/revisión: su llave actual es empresa/sucursal/fecha/receta. Los movimientos legacy contienen texto de motivo sin un vínculo durable a la venta. Si aparecen registros heredados, no se puede inferir consumo cero ni reconstruirlo desde la receta actual: requieren caracterización/evidencia y recuperación de INV-01.c. Un archivo o un `USAGE` del mismo día no demuestran identidad.

El writer legacy y TheoreticalConsumptionService permanecen intactos. La nueva bitácora aún no se invoca desde HTTP/UI. En INV-01.b, la proyección sales_entries debe respetar su agregación por receta/día: no sobrescribir una fuente con otra ni confundir cambio de mapeo con producto nuevo. INT-01 conserva el mapeo versionado; INV-01.d acepta el recorrido visible.

## Entorno, migración y verificación

0137 fue generada con `pnpm.cmd db:generate --name inv01a_sale_consumption_identity`; se revisó el SQL y se añadieron guards/privilegios antes de aplicarla. Es aditiva: crea dos tablas, restricciones/políticas y triggers; no modifica stock/ventas existentes ni contiene DROP/backfill.

Aplicación mediante `pnpm.cmd db:migrate` con MIGRATION_DATABASE_URL/DATABASE_URL de la rama aislada `br-round-voice-belheola`, proyecto `soft-cloud-50478212`; TLS verificado con certificados del sistema. El journal acreditó 0137 y el runner terminó con exit 0. Main `br-steep-frog-bet3a8l6` conserva el baseline hasta 0136: **0137 pendiente allí**, sin despliegue supuesto.

Se conserva el [launcher de referencia](migrate-isolated.cjs.txt) como texto, con validación del host aislado y del último tag revisado. No cambia `.env` ni usa el fallback operativo. El diagnóstico posterior de solo lectura se archiva en [test-manifest.json](test-manifest.json).

Pruebas iniciales: 26 unitarias del contrato aprobadas y siete SQL aprobadas tras detectar primero la ausencia de tablas. Las pruebas PostgreSQL usan dos empresas, dos sucursales de A/una de B, rol NOBYPASSRLS, grants de la migración sin ampliar UPDATE/DELETE, snapshots congelados y rollback verificado de todos los fixtures. El [checkpoint final](results.json) reúne regresión, tipos, lint, build y hashes; no se acredita un comando en curso como pasado.

Revisión con la skill code-review-and-quality: corrección de la cadena por FK, NULL de CHECK cerrado con IS TRUE, ausencia de redondeo, aislamiento/privilegios, inmutabilidad, índices de unicidad y preservación de writers ajenos. Se mantienen las tablas junto a recipes/sales_entries para no introducir un ciclo con el schema modular; extraer todo el dominio es otro cambio. Sin endpoint nuevo ni cambios contables.

Referencia de diseño SQL: [restricciones de PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-constraints.html), en particular FK/UNIQUE para invariantes entre filas y tratamiento de NULL en CHECK. El criterio de aceptación es la prueba real, no la cita.
