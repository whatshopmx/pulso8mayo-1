# FEFO-04B-3 — Consumo de producción con elegibilidad común

Fecha: 2026-10-28. Dependencias: FEFO-03, 04A y 04B-1 completadas. Dividido en implementación/pruebas (04B-3a: 4 archivos tocados más el contrato SQL del usuario, sin modificar) y cierre documental (04B-3b: evidencia, plan y checklist). No se aplicaron migraciones, no se corrigieron datos históricos y no se desplegó.

**Cerrado en local.** Código/pruebas en `4110233`; este cierre documental se guarda por separado. Continúa FEFO-04B-4 (consumo teórico y retiro del allocator anterior). FEFO-04 completo y Checkpoint 2 permanecen abiertos.

## Comportamiento implementado

`ProductionService.recordProduction` es el ÚNICO dueño transaccional del registro de producción, tanto manual como automático. En una sola transacción escribe el resultado, valida elegibilidad, descuenta lotes, inserta kardex `USAGE`, crea las líneas de insumo, calcula el costo y cierra la orden. Si el llamador ya trae un ejecutor (`produceRecipeWithFefo`), escribe en él; si no, abre `db.transaction`. Un fallo a mitad del recorrido revierte todo, incluidos ingredientes ya descontados.

La elegibilidad es la misma que usan venta y transferencia vía `allocateScopedBatches`: lote `AVAILABLE`, vencimiento futuro, de la empresa, sucursal y producto correctos, con `FOR UPDATE` sobre las filas de lote. Un lote explícito de otra sucursal o de otro producto se rechaza con 400 antes del primer insert; uno inexistente o sin saldo suficiente se trata como faltante y devuelve 409.

El faltante físico rechaza la producción completa (FEFO-02) y ya no produce parcialmente ni fabrica merma automática: `shortfalls` siempre devuelve `[]` y no se escribe `inventory_waste`. Esto sustituye el comportamiento T16.

Las unidades se convierten una sola vez, con la tabla `unit_conversions` de la empresa y el mismo ejecutor de la transacción. Si no existe conversión, o sólo existe para otra empresa, se rechaza con 400 en vez de asumir equivalencia. `produceRecipeWithFefo` conserva la unidad de origen de la línea de receta y delega la conversión a `recordProduction`; antes sustituía la unidad por la del insumo sin convertir la cantidad.

En FEFO automático, el esperado de la receta se reparte entre las asignaciones en la misma proporción que la cantidad, de modo que la suma de líneas sigue siendo el esperado y no N veces el total. El costo se acumula exacto y se redondea una sola vez a centavos al escribir.

## Pruebas y revisión

- RED inicial: `pnpm run test:unit tests/unit/inventory/production-fefo-db.test.ts` con el código previo: **19 de 20 casos fallaron**. El caso restante ya pasaba y se conservó sin cambios. La primera reproducción aislada (`-t "manual descuenta"`) confirmó que el camino legacy no escribía kardex `USAGE`, no validaba estado/caducidad y no era transaccional.
- El contrato `tests/unit/inventory/production-fefo-db.test.ts` es propiedad del usuario y **no se modificó**: se hizo pasar la implementación, no la prueba.
- GREEN enfocado: `production-fefo-db.test.ts` **20/20 aprobadas**, 1 archivo, código 0. Cubre: descuento único con `USAGE` y cierre de orden; estados EXPIRED/RESERVED/QUARANTINED/DEPLETED/null; caducidad igual a `now`, pasada y nula; faltante sin parcial ni merma; rollback del primer ingrediente si falla el segundo; lote repetido en dos líneas sin sobreasignar; lote de otro producto; orden de otra empresa; FEFO automático con reparto de cantidad/costo/esperado; conversión de unidad con el ejecutor de la empresa; conversión de otra empresa o inexistente; fallo real de kardex; fallo al insertar insumos; reintento de workflow sin doble descuento.
- Regresión de alcance: `production-scope.test.ts` + `production-fefo-db.test.ts` = **31/31 aprobadas**, 2 archivos, código 0. El fixture de alcance se actualizó al contrato nuevo (unidad del insumo, lote `AVAILABLE` con caducidad futura y costo) y el simulador ganó `.for()` awaitable para el lock; no se debilitó ninguna comprobación de aislamiento.
- Suite general: `pnpm run test:unit`: **179 archivos aprobados, 2,262 pruebas pasadas, 1 skipped y 1 todo preexistentes**, 0 fallos. Sin nuevas exclusiones.
- `npx tsc --noEmit`: código 0.
- `npx eslint lib/services/production-service.ts lib/services/recipe-production.ts tests/fixtures/db-simulado.ts tests/unit/inventory/production-scope.test.ts`: código 0, **0 errores y 4 advertencias preexistentes** de `db-simulado.ts` (parámetro sin usar y tres `any`), fuera del bloque modificado. Se retiró un import `sum` que quedó sin uso en `production-service.ts`.
- Build posterior al código final: `$env:NODE_OPTIONS="--max-old-space-size=8192"; pnpm run build`: código 0, TypeScript aprobado.
- `git diff --check`: código 0; sólo avisos de normalización LF/CRLF.

## Archivos

Implementación y pruebas (4): `lib/services/production-service.ts`, `lib/services/recipe-production.ts`, `tests/fixtures/db-simulado.ts`, `tests/unit/inventory/production-scope.test.ts`.

Sin modificar: `tests/unit/inventory/production-fefo-db.test.ts` (contrato del usuario) y `tasks/todo-lotes-fefo.md` (trabajo en curso del usuario).

## Límites

Las pruebas usan PGlite con el esquema Drizzle real y locks simulados por el motor de base de datos local. **No demuestran contención entre conexiones PostgreSQL independientes**: el `FOR UPDATE` está en el camino, pero la carrera real entre dos producciones concurrentes queda para la verificación de integración de FEFO-05A/Checkpoint 2.

`produceRecipeWithFefo` y `ProductionService.recordProduction` comparten contrato, pero los consumidores de workflow (`production-from-workflow.ts`, `prep-list-service.ts`) no se ejercitaron de punta a punta en esta tarea; su cobertura sigue siendo la de la suite existente.

El allocator anterior (`allocateFEFO`) sigue existiendo para consumo teórico hasta FEFO-04B-4. No se modificaron políticas persistidas, stock del demo, migraciones ni despliegues. Esta tarea no cierra FEFO-04 completo ni el Checkpoint 2.
