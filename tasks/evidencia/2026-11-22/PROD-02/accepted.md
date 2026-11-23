# PROD-02 — Unificar planificación y ejecución visible (aceptado V2/V3)

Base: `04d3fa6ab50486f2960d5303dad5f6e4022c7beb` + cambios locales de `PROD-02`.

## Resumen de implementación

- **Modelo unificado (`production_orders` → `production_results` → `inventory_batches`)**:
  - `lib/services/recipe-production.ts` y `lib/services/prep-list-service.ts`: devuelven `finishedBatchId` al producir/completar una línea.
  - `lib/services/production-service.ts`: `getOrders` enriquece las órdenes completadas con `finishedBatch` (`id`, `resultId`, `itemName`, `lotNumber`, `currentQuantity`, `initialQuantity`, `unit`, `expirationDate`, `origin`, `parentBatchCount`) conservando compatibilidad con filas sin lote terminado y sin eliminar tablas legadas (`production_plans`/`production_batches`).
  - `lib/services/hold-time-service.ts`: `getBoard` vincula `inventory_batches` e `inventory_items` sobre `production_results.finished_batch_id` para exponer saldo, caducidad y procedencia en el tablero "En línea".
  - `app/api/inventory/production/route.ts`: devuelve `finishedBatchId` en `POST action="record"`.
- **Ejecución visible en UI**:
  - `app/dashboard/inventory/production/production-client.tsx`: los botones **Producir** y **Completar Lote** propagan `recordOrderId` al formulario (bloqueando el selector de receta a la orden) y envían `orderId` en `POST /api/inventory/production`; las tarjetas `COMPLETED` muestran saldo (`currentQuantity/initialQuantity unit`), procedencia (`Producción · N lote(s) de insumo`) y caducidad; corrige el aviso obsoleto de faltante.
  - `components/inventory/hold-time-board.tsx`: muestra saldo actual y procedencia (`Producción (N insumos)`) cuando la tanda tiene lote terminado vinculado.

## Verificación ejecutada

1. **V2 PostgreSQL nativo (Neon desechable baseline 0158 + 0159/0160/0161/0162)**:
   - `node --use-system-ca --max-old-space-size=4096 node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts tests/integration/production-unified-flow-db.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**1/1**, 27.96 s): `PrepListService.createLine` → `ProductionService.getOrders` → `PrepListService.completeLine` → `finishedBatch` con saldo/caducidad/procedencia en `getOrders` y `HoldTimeService.getBoard`, más cierre de orden manual con `produceRecipeWithFefo(orderId)`.
2. **V3 navegador Chromium (Playwright)**:
   - `node node_modules/@playwright/test/cli.js test --config tests/playwright-sales-entry.config.ts tests/e2e/production-unified.spec.ts` → `exit 0` (**1/1**, 29.8 s): clic en **Completar Lote**, verificación de `orderId` en `POST /api/inventory/production`, render visible de **Saldo**, **Procedencia** y **Caducidad** en pestaña **Órdenes** y **En línea**, 0 `pageerror`.
3. **Regresión focal V1 y ESLint**:
   - `node node_modules/vitest/vitest.mjs run --configLoader bundle tests/unit/inventory/production-scope.test.ts tests/unit/inventory/production-fefo-db.test.ts tests/unit/inventory/production-finished-batch-db.test.ts lib/inventory/__tests__/prep-list.test.ts --maxWorkers=1 --pool=threads` → `exit 0` (**72/72**, 22.63 s).
   - `node node_modules/eslint/bin/eslint.js lib/services/recipe-production.ts lib/services/prep-list-service.ts lib/services/production-service.ts lib/services/hold-time-service.ts app/api/inventory/production/route.ts app/dashboard/inventory/production/production-client.tsx components/inventory/hold-time-board.tsx tests/integration/production-unified-flow-db.test.ts tests/e2e/production-unified.spec.ts tests/support/sales-entry-browser-server.ts` → `exit 0` (0 errores).

## Límites explícitos

- No acredita aún la aceptación de Módulo 12 (`VAL-01.M01-M17.M12`) ni `INV-03`/`REC-03A/B`.
- La verificación V3 usa el arnés controlado de Playwright del componente real (`ProductionClient` + `HoldTimeBoard`), sin despliegue operativo ni migración sobre `main`.
