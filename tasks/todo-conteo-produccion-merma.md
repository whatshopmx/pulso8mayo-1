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

- [x] **T7** Tabla `inventory_snapshots` — `companyId`, `branchId`, `itemId`, `snapshotDate date`, `calculatedStock numeric(12,4)`, `countedStock numeric(12,4)` nullable, `variance` GENERATED STORED. Único `(companyId, branchId, itemId, snapshotDate)` + índice `(branchId, snapshotDate DESC)`. *Files: `lib/db/schema.ts`, `drizzle/0047_same_jack_power.sql`. Size S.* ✅
- [x] **T8** `lib/services/inventory-snapshot-service.ts` (new) — `buildSnapshot(companyId, branchId, date)`: `calculatedStock` = SUM de lotes AVAILABLE (OQ-4: estado resultante, sin doble resta), cruza último `stock_counts` del día, `ON CONFLICT DO UPDATE`. Sólo `isHighValue=true`. ✅
- [x] **T9** `lib/inngest/functions/cron-inventory-snapshot.ts` (new) — cron diario `0 5 * * *` + registro en `lib/inngest/functions/index.ts`. ✅
- [x] **T10** `tests/snapshot-idempotente.spec.ts` (new) — `buildSnapshot` 2× el mismo día no duplica y actualiza. 2/2 verde. ✅

### Checkpoint 2 (T7–T10) — ✅ COMPLETADO
- [x] `pnpm run build` limpio; `pnpm db:generate` sólo `CREATE TABLE inventory_snapshots` (0 DROP)
- [x] `pnpm test:e2e -- snapshot-idempotente.spec.ts` verde
- [x] Manual: tras un conteo, `variance` del día = contado − calculado (cubierto por el spec: 2ª corrida refleja lotes actualizados)

## Phase 3 — Merma manual y automática

- [x] **T11** (a) `mermaVarianceThresholdPct` en `tenantOperatingConfig` + default 5.00, zod en `operating-config/route.ts`, migración `0048`. (b) `lib/services/merma-from-workflow.ts` — pasos `merma-qty/merma-reason/merma-evidence-{itemId}` → `inventory_waste`, idempotente por `instance:{id}` en notes. Mapeo normaliza acentos/espacios: `caducidad→EXPIRED`, `caida/derrame→SPILLAGE`, `error_cocina→QUALITY`, `cortesia→COURTESY` (OQ-1). Hook tras completar instancia. ✅
- [x] **T12** Merma automática — en `stock-count-from-workflow.ts`: `ABS(variancePercent) > umbral` **y** faltante → `inventory_waste` `reason='OTHER'` + `origen=diferencia_conteo`. Sobrante no genera. ✅
- [x] **T13** `tests/merma-manual.spec.ts` + `tests/merma-automatica.spec.ts` — manual exige motivo+foto (sin evidencia no cierra), cortesía → `COURTESY` + movimiento `USAGE`; automática crea fila sobre umbral y no bajo él. 5/5 verde. ✅ (helper `restoreMermaThreshold` en `tests/support/db.ts`)

### Checkpoint 3 (T11–T13) — ✅ COMPLETADO
- [x] `pnpm run build` limpio
- [x] Ambos specs de merma verdes
- [x] Dashboard + reporte ejecutivo + predictive-scoring + knowledge-service excluyen `STAFF`/`COURTESY` de las 4 métricas de merma (whitelist `IN ('EXPIRED','DAMAGED','QUALITY','SPILLAGE','OTHER')`); `COURTESY` rutea a movimiento `USAGE`
- [x] Revisión humana completada (autorización previa a Phase 4)

## Phase 4 — Producción diaria y consumo FEFO

- [x] **T14** `lib/services/fefo-allocator.ts` (new) — `allocateFEFO(executor, itemId, branchId, qty)` devuelve `[{batchId, quantity, unitCost}]`, orden `expirationDate ASC NULLS LAST, createdAt ASC`, `FOR UPDATE` (R-3). `deductItemFIFO` (`theoretical-consumption-service.ts`) ahora corre dentro de `db.transaction` pasando el tx a `InventoryService.recordMovement` (evita deadlock con los lotes bloqueados). Comentarios FIFO→FEFO. Tipo `DbExecutor` derivado de `db.transaction` (sin `any`). ✅
- [x] **T15** `lib/services/production-from-workflow.ts` (new) — paso dinámico `prod-qty` (entity `recipe`, tag `receta_activa`) → pasos `prod-qty-{recipeId}`; expande `recipe_items` con recursión de sub-recetas **y** `yieldPercent` (100/yield); `allocateFEFO` por insumo DENTRO de la misma tx de escritura; `recordProduction` con `ingredients[]` por par (item,lote) → descuento único (R-4); idempotente por `instance:{id}` en `production_results.notes`. Hook en `workflow-execution-service.ts`. ✅
- [x] **T16** Lote insuficiente — `recordProduction` ahora descuenta `min(available, actualQuantity)`, devuelve `shortfalls[]` y **nunca omite en silencio**; el extractor convierte cada faltante en `inventory_waste` `reason=OTHER` + `motivo=lote_insuficiente` (y agrega la producción aunque no haya lotes: merma = 100% del insumo). ✅
- [x] **T17a** `tests/produccion-diaria.spec.ts` — 3 porciones descuentan 2×3 y 1×3 según `recipe_items`, escribe result + ingredients por par (item,lote), cierre duplicado no duplica. 2/2 verde. ✅
- [x] **T17b** `tests/consumo-fefo.spec.ts` — el lote recibido después con caducidad anterior se consume primero, y el segundo ciclo agota el resto de ese lote antes de tocar al otro (FEFO real). `tests/lote-insuficiente.spec.ts` — 3 de 4 kg → descuento parcial + merma 1 kg `lote_insuficiente`. 3/3 verde. ✅

### Checkpoint 4 — ✅ COMPLETADO (T14–T17b)
- [x] `pnpm run build` limpio (`✓ Compiled successfully`); lint de archivos nuevos limpio (baseline del repo: 1085 errores preexistentes, 0 aportados por este plan)
- [x] `pnpm test:e2e` completo: **37/37 verde** (6 specs nuevos + 31 previos, sin regresiones)
- [ ] Ciclo manual end-to-end: recibir → contar → producir → snapshot nocturno → varianza cuadra y merma aparece en el dashboard (pendiente operador; cubierto por specs)
- [x] Ninguna migración generada (0047/0048/0049) contiene `DROP`
- [x] Templates de catálogo: `registro-merma-v1.json` + `produccion-diaria-v1.json` registrados en `templateLibrary`
- [x] Listo para review

## Open Questions — resolver antes de la fase indicada

- [x] **OQ-1** (antes de T11) — **DECIDIDO (2025-06-15): opción (a) `COURTESY` + filtro en métricos.**
  - Enum `inventory_waste_reason` está en `schema.ts:1163` (no `:1011`) = `EXPIRED | DAMAGED | QUALITY | SPILLAGE | OTHER | STAFF`. Se añade `COURTESY`.
  - Write path: `app/api/inventory/waste/route.ts:163` → `type: reason === 'STAFF' ? 'USAGE' : 'WASTE'` se convierte en `['STAFF','COURTESY'].includes(reason) ? 'USAGE' : 'WASTE'` y la razón del movimiento `'Consumo de Personal'` → branch por reason.
  - ⚠️ **Corrección al mecanismo del plan:** el movimiento `USAGE` por sí solo NO evita inflar el % de merma. Los 6 lectores de `inventory_waste` suman `totalLoss`/`quantity` **sin filtro por reason**: `executive-report-service.calcWasteTotal` (sin filtro), `app/api/inventory/dashboard/route.ts:191` (`wasteLossRatio`), `predictive-scoring-service` (score de riesgo), `knowledge-service` (wasteTrend). `STAFF` ya infla el % hoy (quirk preexistente).
  - **Acción con T11:** excluir `COURTESY` y `STAFF` del % en los 4 métricos (`reason NOT IN ('STAFF','COURTESY')`, o whitelist `IN ('EXPIRED','DAMAGED','QUALITY','SPILLAGE','OTHER')`). `cross-branch-service` agrupa por reason y no necesita filtro (la cortesía sale como categoría propia). Excluir `STAFF` **cambia** el número actual de % de merma en reportes existentes — es la corrección buscada, documentarla en T11/commits.
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
- [x] **OQ-4** (antes de T8) — **DECIDIDO: confirmada la recomendación.**
  - Verificado: `TheoreticalConsumptionService.consume` (`theoretical-consumption-service.ts:8`) descuenta ventas en tiempo real vía `deductItemFIFO` (`:52`), que ordena `inventory_batches` por `expirationDate, createdAt` (FEFO) y escribe movimiento + decrementa `currentQuantity` (incl. `currentQuantity: 0` al agotar, `:129`).
  - `buildSnapshot` (T8) lee el **estado resultante** de `inventory_batches`: `SUM(currentQuantity) WHERE status='AVAILABLE'` —misma forma que `stock-count-service.ts:97-103`—, cruza con el último `stock_counts` de la fecha, y `variance = countedStock - calculatedStock` captura toda la deriva real (merma, robos, errores) **sin** doble resta del consumo por ventas.

## Notas de ejecución

- Migraciones con `pnpm db:generate`, **nunca** `db:push`. Última actual: `0049_organic_puck.sql` (recipes.tags).
- Una tabla por migración (patrón `feat/capa-dinero`). Revisar cada SQL: si contiene `DROP`, no aplicar (0047–0049: sin DROP).
- E2E: `pnpm test:e2e -- <spec>` · Build: `pnpm run build` · Lint: `pnpm lint`
- Frontera AD-6 (R-2): `inventory_batches.currentQuantity` y `production_results`/`production_ingredients` son `integer`; las fracciones viven en numeric 12,4 (stock_counts, snapshots, recipe_items) y se redondean al entrar a la frontera entera. Documentado como riesgo aceptado.
