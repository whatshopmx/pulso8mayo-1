# PROD-01.b — Consumir elaborado sin descontar dos veces (aceptado V2)

Base: `50d7e64a08e60339bff0120bc27f40b176ff9def` + cambios locales de `PROD-01.b`.

## Resumen de implementación

- **Migración aditiva de privilegios scoped** (`drizzle/0162_prod01b_finished_consumption_grants.sql`):
  - Concede `GRANT SELECT (origin, parent_batch_ids) ON public.inventory_batches TO pulso_app` sin ampliar privilegios de escritura ni modificar migraciones anteriores.
- **Asignación FEFO con origen y genealogía de producción** (`lib/services/batch-allocation-policy.ts`, `lib/services/fefo-allocator.ts`):
  - `BatchCandidate.origin` y `AllocationRequest.requiredOrigin`.
  - Cuando `requiredOrigin === 'PRODUCTION'`, `allocateScopedBatches` exige `inventory_batches.origin = 'PRODUCTION'` y genealogía real (`jsonb_typeof(parent_batch_ids) = 'array' AND jsonb_array_length(parent_batch_ids) > 0`), sin afectar consultas de insumos regulares.
- **Consumo de elaborado en writer canónico** (`lib/services/sale-consumption-service.ts`):
  - Sustituye el bloqueo temporal `PENDING_RECOVERY` de `INV-02` por consumo real de lotes terminados (`requiredOrigin: 'PRODUCTION'`) para todo `inventoryItemId` publicado con `mode: 'FINISHED_PRODUCT_ON_SALE'`.
  - Si no existe lote terminado de producción con genealogía (incluso cuando haya lotes `PURCHASE` del mismo SKU), rechaza con `INSUFFICIENT_STOCK` sin dejar identidad, venta ni movimientos.
  - Al vender platillo padre o subreceta directa: descuenta el lote terminado FEFO sin volver a descontar los insumos crudos ya consumidos en producción (`PROD-01.a`).

## Verificación ejecutada

1. **V2 PostgreSQL nativo — flujo completo `PROD-01.b` (Neon desechable baseline 0158 + 0159/0160/0161/0162, rol LOGIN independiente `SALES_RUNTIME_DATABASE_URL`)**:
   - `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/production-finished-consumption-db.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**1/1**, 45.96 s):
     - Bloquea venta antes de producir incluso con lote `PURCHASE` del SKU elaborado.
     - Produce subreceta (`PROD-01.a`), verifica idempotencia y rechazo `409` en doble cierre de orden.
     - Vende platillo padre (insumo directo + subreceta `FINISHED_PRODUCT_ON_SALE`): descuenta insumo directo y lote terminado `PRODUCTION`, sin descontar dos veces los insumos de la subreceta ni tocar el lote `PURCHASE`.
     - Verifica genealogía completa: `sales_consumption_revisions.allocations` → `inventory_batches (origin='PRODUCTION', parent_batch_ids)` → `production_results.finished_batch_id` → `production_ingredients.batch_id`.
     - Reintentos concurrentes de la misma venta no duplican movimientos; corrección (`2→1`) y anulación (`1→0`) restauran el lote terminado sin tocar insumos crudos; venta directa de la subreceta descuenta solo el lote terminado.
2. **V2 PostgreSQL nativo — regresión completa `INV-02`**:
   - `$env:RUN_RECIPE_POLICY_RUNTIME='1'; node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/recipe-policy-runtime-db.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**8/8**, 125.99 s).
3. **V1 unitarias/PGlite y ESLint**:
   - `node node_modules/vitest/vitest.mjs run --configLoader bundle tests/unit/inventory/recipe-policy-publication-service-db.test.ts tests/unit/inventory/production-finished-batch-db.test.ts lib/services/__tests__/batch-allocation-policy.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**46/46**, 32.97 s).
   - `node node_modules/eslint/bin/eslint.js lib/services/batch-allocation-policy.ts lib/services/fefo-allocator.ts lib/services/sale-consumption-service.ts tests/unit/inventory/recipe-policy-publication-service-db.test.ts tests/integration/recipe-policy-runtime-db.test.ts tests/integration/production-finished-consumption-db.test.ts` → `exit 0`.

## Límites explícitos

- No acredita aún la unificación visible de planificación/ejecución en UI (`PROD-02`) ni la aceptación final de Módulo 12 (`VAL-01.M01-M17.M12`).
- Sin aplicación de `0161`/`0162` a base operativa ni despliegue.
