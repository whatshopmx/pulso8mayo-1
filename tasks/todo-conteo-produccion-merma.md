# Conteo dinámico, producción diaria y merma — Task List

> Plan completo en `tasks/plan-conteo-produccion-merma.md`. Marca con `[x]` al verificar.
>
> **Contexto crítico:** el spec original propone reconstruir infraestructura que ya existe.
> El resolver dinámico ya está (`workflow-execution-service.ts:22-30`), `lotes`=`inventory_batches`,
> `merma_records`=`inventory_waste`, `daily_production`=`production_results`, FEFO ya implementado en
> `theoretical-consumption-service.ts:52`, el cron ya existe y corre por **Inngest** (no QStash).
> Sólo faltan de verdad **2 tablas**: `stock_counts` e `inventory_snapshots`.
> Convención: `companyId`/`branchId`, **nunca** `tenantId`/`sucursalId`.

## Phase 0 — Base: tags + resolver dinámico genérico

- [x] **T1** `inventory_items.tags` — `jsonb` (no `text[]`+GIN; convención del repo, cf. `workflowTemplates.tags` `schema.ts:121`). `is_high_value` intacto. *Files: `lib/db/schema.ts`, `drizzle/0036_*.sql`. Size XS. Deps: None.*
- [x] **T2** `lib/workflows/dynamic-steps.ts` (new) — `resolveDynamicSteps(steps, ctx)` expande `metadata.dynamicSource = {entity, filter}` a N sub-pasos de tipos existentes (`NUMBER`/`SELECT`/`PHOTO`). **NO** añadir `dynamic_item_capture` a `WorkflowStepType`: `WorkflowStep` está definido 7 veces en el repo. Enganchar en `createExecution` (`workflow-execution-service.ts:22-30`) preservando la rama `STOCK_COUNT_TEMPLATE_NAME`. *Files: `lib/workflows/dynamic-steps.ts` (new), `lib/services/workflow-execution-service.ts` (edit), `lib/types/workflow.ts` (edit). Size M. Deps: T1.*

### Checkpoint 0 (T1–T2)
- [x] `npx tsc --noEmit` limpio (0 errores)
- [x] `pnpm db:generate` sólo `ALTER TABLE inventory_items ADD COLUMN tags` (sin DROP) — `0036_tags-inventory-items.sql`
- [ ] `pnpm test:e2e -- conteo-alto-valor.spec.ts limite-30-skus.spec.ts` verdes → sin regresión (**R-1**)
- [ ] Manual: template con `metadata.dynamicSource` genera N sub-pasos en el stepper

## Phase 1 — Conteo: sacar resultados del blob JSON

- [x] **T3** Tabla `stock_counts` — `companyId`, `branchId`, `itemId`, `workflowInstanceId`, `countedQuantity numeric(12,4)`, `systemQuantity numeric(12,4)`, `evidenceUrl`, `countedBy`, `countDate date`. Índice `(branchId, countDate DESC)` + único parcial `(workflowInstanceId, itemId)` (idempotencia, AD-4). *Files: `lib/db/schema.ts`, `drizzle/0037_*.sql`. Size S. Deps: None.*
- [x] **T4** `lib/services/stock-count-from-workflow.ts` (new) — patrón `receiving-from-workflow.ts`: descarta si `status !== 'COMPLETED'`, idempotente por el único de T3, lee sub-pasos `count-{itemId}`. Enganchar en `workflow-execution-service.ts:446-463`. NO duplicar `applyStockCountAdjustments`. *Files: + `lib/services/workflow-execution-service.ts` (edit). Size M. Deps: T2, T3.*
  - **Desvío del plan:** hacen falta DOS enganches, no uno. El conteo clásico se cierra por `StockCountService.completeStockCount` (ruta `action:"complete"`), que nunca pasa por el bloque `allCompleted` de `workflow-execution-service`. Sin el segundo enganche los conteos por template `Conteo de Inventario` no llegarían a `stock_counts`. Ambos son idempotentes por el único parcial.
- [x] **T5** Fix truncamiento — `stock-count-service.ts:295` usa `parseInt` → contar 2.5 kg guarda 2. Cambiar a `parseFloat`, propagar por `results[]`/`variance`/`variancePercent`; redondear sólo al llamar `recordAdjustment`. *Files: `lib/services/stock-count-service.ts` (edit). Size S. Deps: T3.*
  - **Ampliación necesaria:** el mismo `parseInt` estaba en los dos resúmenes de confirmación
    (`components/execution/workflow-stepper.tsx:852`, `components/workflow/workflow-executor.tsx:33`);
    sin corregirlos el operador vería "2" mientras se guarda "2.5". Además los `<Input type="number">`
    de captura no llevaban `step`, y el `step=1` implícito del navegador marca 2.5 como inválido y
    mueve los spinners de 1 en 1 — se añadió `step="any"`. Helper `roundQty()` a 4 decimales para no
    arrastrar ruido binario (2.5 − 2.2 = 0.30000000000000004) hasta el blob.
- [x] **T6** `tests/conteo-dinamico.spec.ts` (new) — N sub-pasos por `isHighValue=true`; al completar hay N filas en `stock_counts`; completar 2× no duplica. Helpers `findStockCountsForInstance`/`cleanupStockCounts`. *Files: + `tests/support/db.ts` (edit). Size M. Deps: T4, T5.*

### Checkpoint 1 (T3–T6)
- [x] `npx tsc --noEmit` limpio (0 errores); `pnpm db:generate` sólo `CREATE TABLE stock_counts` + FKs + índices — `0037_lush_malice.sql`, sin `DROP`
- [x] `pnpm test:e2e -- conteo-dinamico.spec.ts` verde (3/3)
- [ ] `pnpm test:e2e -- conteo-alto-valor.spec.ts` — aislado: **1 pasa, 1 falla**. El que falla es por un
      bug preexistente de la UI, ajeno a Phase 1 (ver abajo). Sin regresión: el test que fallaba en la
      suite completa (`por defecto cuenta solo los SKUs de alto valor`) **pasa aislado** — era estado
      compartido entre specs, no código.
- [x] Manual: contar 2.5 kg guarda `2.5000` — cubierto por aserción en `conteo-dinamico.spec.ts`
- [ ] 🛑 **Revisar con humano antes de Phase 2**

#### Suite E2E: de 10/4 a 14/0
> Los 3 fallos preexistentes que quedaban tras OQ-5 se limpiaron aparte de este plan:
- `conteo-alto-valor.spec.ts` — el toggle "ver todos" nunca mandaba `false`. Un checkbox desmarcado no
  viaja en el form, así que `formData.get("highValueOnly")` daba `null` y `null !== "false"` evaluaba
  a `true`: el toggle no hacía nada. Arreglado a `=== "true"` en
  `app/dashboard/inventory/stock-count/page.tsx:52` (el checkbox lleva `value="true"`).
- `gasto-evidencia.spec.ts` — dos cosas: (a) `tests/support/db.ts` consultaba
  `operating_expenses.amount_cents` y la columna se llama `amount`, ya en centavos (`schema.ts:2688`)
  → `SELECT amount AS amount_cents`; (b) el spec exigía `evidence_url` con esquema `https://`, pero sin
  credenciales de R2 la API usa el fallback documentado `local://`
  (`app/api/expenses/evidence/route.ts:45`) → la aserción acepta ambos esquemas.
- `corte-arqueo.spec.ts` — **no era bug de la app**. El dashboard filtra por la sucursal en foco
  (cookie `pulso_selected_branch`, leída en `app/dashboard/layout.tsx:39`); si nadie la fija se
  autoselecciona la primera sucursal. El snapshot del fallo lo delataba: "Mostrando Roma" mientras el
  corte era de Condesa. El spec ahora fija la cookie antes de navegar.

## Phase 2 — Snapshots de stock

- [ ] **T7** Tabla `inventory_snapshots` — `companyId`, `branchId`, `itemId`, `snapshotDate date`, `calculatedStock numeric(12,4)`, `countedStock numeric(12,4)` nullable, `variance` GENERATED STORED. Único `(companyId, branchId, itemId, snapshotDate)` + índice `(branchId, snapshotDate DESC)`. *Files: `lib/db/schema.ts`, `drizzle/0038_*.sql`. Size S. Deps: None.*
- [ ] **T8** `lib/services/inventory-snapshot-service.ts` (new) — `buildSnapshot(companyId, branchId, date)`: `calculatedStock` desde `inventory_batches`+`inventory_movements`, cruza último `stock_counts` del día, `ON CONFLICT DO UPDATE`. Sólo items `isHighValue=true`. ⚠️ Ver **OQ-4** antes de empezar (riesgo de doble resta del consumo por ventas). *Size M. Deps: T3, T7.*
- [ ] **T9** `lib/inngest/functions/cron-inventory-snapshot.ts` (new) — cron diario (`0 5 * * *`), registrar en `lib/inngest/functions/index.ts`. Bucle compañías ACTIVE × sucursales activas (cf. `inventory-checks.ts:11-45`). **No** tocar `checkInventoryAlerts`. *Size S. Deps: T8.*
- [ ] **T10** `tests/snapshot-idempotente.spec.ts` (new) — correr `buildSnapshot` 2× el mismo día no duplica y actualiza. *Size S. Deps: T9.*

### Checkpoint 2 (T7–T10)
- [ ] `pnpm run build` limpio; `pnpm db:generate` sólo `CREATE TABLE inventory_snapshots`
- [ ] `pnpm test:e2e -- snapshot-idempotente.spec.ts` verde
- [ ] Manual: tras un conteo, `variance` del día = contado − calculado

## Phase 3 — Merma manual y automática

- [ ] **T11** (a) `mermaVarianceThresholdPct` en `tenantOperatingConfig` (`schema.ts:2603`) + `TenantOperatingConfigInput` (`tenant-operating-config-service.ts:9`), default 5. (b) `lib/services/merma-from-workflow.ts` (new) → inserta en `inventory_waste`. Mapeo: `caducidad→EXPIRED`, `caida→SPILLAGE`, `error_cocina→QUALITY`. ⚠️ **`cortesia` no tiene equivalente — resolver OQ-1 antes de empezar.** *Files: + `lib/db/schema.ts`, `lib/services/workflow-execution-service.ts` (edit), `drizzle/0039_*.sql`. Size M. Deps: T2.*
- [ ] **T12** Merma automática — en T4: si `ABS(variancePercent) > umbral` **y** varianza negativa (faltante), insertar en `inventory_waste` con `reason='OTHER'` + `notes` `origen=diferencia_conteo`. Sobrante no genera merma. *Files: `lib/services/stock-count-from-workflow.ts` (edit). Size S. Deps: T11.*
- [ ] **T13** `tests/merma-manual.spec.ts` + `tests/merma-automatica.spec.ts` (new) — manual exige motivo+foto y rechaza sin evidencia; automática crea fila sobre el umbral y **no** crea bajo el umbral. *Size M. Deps: T12.*

### Checkpoint 3 (T11–T13)
- [ ] `pnpm run build` limpio
- [ ] Ambos specs de merma verdes
- [ ] `app/api/inventory/dashboard` + reporte ejecutivo siguen sumando merma bien (filas nuevas entran por `inventory_waste`, no por tabla paralela)
- [ ] 🛑 **Revisar con humano antes de Phase 4** (fase de mayor riesgo)

## Phase 4 — Producción diaria y consumo FEFO

- [ ] **T14** `lib/services/fefo-allocator.ts` (new) — extraer de `deductItemFIFO` (`theoretical-consumption-service.ts:52-88`) un `allocateFEFO(tx, itemId, branchId, qty)` que **devuelve** `[{batchId, qty, unitCost}]` sin escribir, con `FOR UPDATE` (**R-3**). `deductItemFIFO` pasa a usarlo. Renombrar FIFO→FEFO en comentarios (ya ordena por `expirationDate`). *Files: + `lib/services/theoretical-consumption-service.ts` (edit). Size M. Deps: None.*
- [ ] **T15** `lib/services/production-from-workflow.ts` (new) — lee step dinámico `entity:'recipe'` (tag `receta_activa`), expande `recipe_items` con recursión de sub-recetas (cf. `theoretical-consumption-service.ts:22`), `allocateFEFO` por insumo, llama `ProductionService.recordProduction` (`production-service.ts:50`) con un `ingredients[]` por par (item, lote) → sin doble descuento (**R-4**). Enganchar en `workflow-execution-service.ts`. *Size M. Deps: T2, T14.*
- [ ] **T16** Lote insuficiente — `production-service.ts:86` hoy hace `if (batch && batch.currentQuantity >= ing.actualQuantity)` y **omite el descuento sin avisar**. Descontar lo disponible y devolver el faltante; T15 lo inserta en `inventory_waste` con `notes` `motivo=lote_insuficiente`. *Files: `lib/services/production-service.ts` (edit), `lib/services/production-from-workflow.ts` (edit). Size S. Deps: T15.*
- [ ] **T17a** `tests/produccion-diaria.spec.ts` (new) — producir descuenta insumos según `recipe_items` y escribe `production_results` + `production_ingredients`. *Size M. Deps: T16.*
- [ ] **T17b** `tests/consumo-fefo.spec.ts` + `tests/lote-insuficiente.spec.ts` (new) — con 2 lotes donde el recibido **después** caduca **antes**, consume ese primero (FEFO real, no FIFO por recepción); exceso genera merma `lote_insuficiente` en vez de omitir. *Size M. Deps: T16.*

### Checkpoint 4 — Completo (T14–T17b)
- [ ] `pnpm run build` limpio, `pnpm lint` limpio
- [ ] `pnpm test:e2e` completo verde (7 specs previos + 6 nuevos)
- [ ] Ciclo manual end-to-end: recibir → contar → producir → snapshot nocturno → varianza cuadra y merma aparece en el dashboard
- [ ] Ninguna migración generada contiene `DROP`
- [ ] Listo para review

## Open Questions — resolver antes de la fase indicada

- [ ] **OQ-1** (antes de T11) `cortesia` no existe en `inventory_waste_reason` (`schema.ts:1011`). Recomendación: añadir `COURTESY` con el mismo trato que `STAFF` (movimiento `USAGE`, cf. `app/api/inventory/waste/route.ts:163`) para no inflar el % de merma.
- [ ] **OQ-2** (deuda técnica, fuera de alcance) ¿Migrar `inventory_batches.currentQuantity` de `integer` a `numeric`? Resolvería **R-2** de raíz pero toca 5 servicios.
- [x] **OQ-5** (NUEVA, destapada al probar T6) — **RESUELTA**. `lib/db/index.ts` usaba el driver
  **`neon-http`, que no soporta `db.transaction`**: cualquier llamada lanzaba `No transactions support
  in neon-http driver` en tiempo de ejecución (no en compilación). Eso dejaba **14 llamadas rotas**,
  entre ellas `WorkflowExecutionService.createExecution` (todo `POST /api/workflows/execute` daba 500)
  e `InventoryService.recordMovement` — de la que depende `applyStockCountAdjustments`, es decir,
  aplicar los ajustes de un conteo fallaba en producción.
  **Arreglo:** migrado el cliente a `drizzle-orm/neon-serverless` (Pool sobre WebSocket, `ws` ya era
  dependencia). Las 14 llamadas funcionan sin tocarse; los 317 archivos que importan `db` no cambian
  porque la API de drizzle es idéntica. `createExecution` volvió a `db.transaction` (el `db.batch`
  provisional se revirtió; `batch` sólo existe en el driver HTTP).
  **Detalles que importan:** `allowExitOnIdle: true` para que los scripts de `tsx` (seeds, backfills)
  no queden colgados con el pool abierto — verificado, un script sin `process.exit` termina solo;
  y pool en `globalThis` para que el hot-reload de `next dev` no acumule pools hasta agotar Neon.
  **Verificado:** commit con lectura intermedia dentro de la tx (lo que `db.batch` no permite),
  rollback real que deshace el insert, y `recordAdjustment` descontando del lote + escribiendo el
  movimiento. Suite E2E: 11 pasan / 3 fallan (antes 10/4), sin regresiones.
- [ ] **OQ-3** (antes de T1) ¿Gate por tag `perecedero` o basta con captura condicional de `fecha_caducidad` en recepción? Recomendación: lo segundo — `inventory_batches` ya se llena para todo item y `checkExpiringBatches` ya filtra por `expirationDate IS NOT NULL`.
- [ ] **OQ-4** (antes de T8) `stock_calculado` no debe re-restar el consumo teórico por ventas: `TheoreticalConsumptionService.consume` ya lo descuenta de lotes en tiempo real. Recomendación: `buildSnapshot` lee el estado resultante de `inventory_batches`, no recalcula la fórmula por términos.

## Notas de ejecución

- Migraciones con `pnpm db:generate`, **nunca** `db:push`. Última actual: `0035_gaps-avanzados.sql`.
- Una tabla por migración (patrón `feat/capa-dinero`). Revisar cada SQL: si contiene `DROP`, no aplicar.
- E2E: `pnpm test:e2e -- <spec>` · Build: `pnpm run build` · Lint: `pnpm lint`
