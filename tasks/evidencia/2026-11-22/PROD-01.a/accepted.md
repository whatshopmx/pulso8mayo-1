# PROD-01.a — Crear lote de producto terminado (aceptado V1/V2)

Base: `2d3f8795078a8e58276f156f562ece3e71c1ff05` + cambios locales de `PROD-01.a`.

## Resumen de implementación

- **Schema y migración aditiva** (`lib/db/schema.ts`, `drizzle/0161_prod01a_finished_batch_link.sql`):
  - Columna nullable `finished_batch_id` (`uuid`) en `production_results` e índice único parcial `production_results_finished_batch_unique` (`WHERE finished_batch_id IS NOT NULL`).
  - Migración generada con `drizzle-kit generate --name prod01a_finished_batch_link` (2 sentencias aditivas, sin `DROP`, sin aplicación a base operativa ni `main`).
- **Servicio transaccional** (`lib/services/production-service.ts`):
  - `RecordProductionInput` acepta `finishedItemId` y `finishedExpirationDate` opcionales.
  - `resolveFinishedTarget` verifica presencia de `public.recipe_consumption_policies` vía `to_regclass` sin abortar transacciones, resuelve automáticamente políticas activas `FINISHED_PRODUCT_ON_SALE` de la receta, rechaza discrepancias con `finishedItemId`, valida pertenencia a empresa y conversión de unidad vía `unitFactor`.
  - Bloquea alta ficticia si `producedQuantity <= 0` o si no se consumieron ingredientes reales.
  - En la misma transacción que descuenta insumos FEFO e inserta `production_results` / `production_ingredients`: crea lote `inventory_batches` (`origin: 'PRODUCTION'`, `status: 'AVAILABLE'`, cantidad convertida, costo unitario exacto en centavos, caducidad por override o `holdTimeMinutes`, `parentBatchIds` con genealogía de lotes de insumos), inserta movimiento positivo `RECEIVING` en `inventory_movements` y vincula `production_results.finished_batch_id`.
  - Mantiene idempotencia por `workflowInstanceId` (repetición no duplica lote ni movimientos) y rollback total ante faltante de insumos (`409`).

## Verificación ejecutada

1. **V1 PGlite — alta terminada y guardas**:
   - `node node_modules/vitest/vitest.mjs run --configLoader bundle tests/unit/inventory/production-finished-batch-db.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**5/5**, 14.56 s).
2. **V1 regresión focal de producción y prep-list**:
   - `node node_modules/vitest/vitest.mjs run --configLoader bundle tests/unit/inventory/production-scope.test.ts tests/unit/inventory/production-fefo-db.test.ts lib/inventory/__tests__/prep-list.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**67/67**, 17.91 s).
3. **V2 PostgreSQL nativo (Neon desechable, baseline 0158 + 0159/0160/0161)**:
   - `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/production-finished-batch-db.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**1/1**, 22.10 s): rechazo cross-company, rechazo sin insumos, auto-resolución de política `INV-02`, rollback por faltante (`409`), alta atómica con genealogía + vínculo único `finished_batch_id` y replay idempotente por `workflowInstanceId`, con limpieza verificada.
4. **Lint focal**:
   - `node node_modules/eslint/bin/eslint.js lib/services/production-service.ts tests/unit/inventory/production-finished-batch-db.test.ts tests/integration/production-finished-batch-db.test.ts` → `exit 0`.

## Límites explícitos

- No acredita todavía el consumo al vender elaborado (`PROD-01.b`) ni la unificación visible de UI/planificación (`PROD-02`).
- Sin aplicación de migración `0161` a base operativa ni despliegue.
