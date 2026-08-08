# Implementation Plan: Conteo dinámico, producción diaria y merma vía workflow engine

## Overview

Cerrar el ciclo **conteo físico → stock calculado → consumo por producción → merma** sobre el motor de
workflows existente, de forma que el stock de un SKU de alto valor sea auditable día a día y las
diferencias se conviertan en registros de merma en vez de desaparecer.

Este plan es la versión **corregida** del spec original (`Spec: Conteo dinámico, producción diaria y
merma vía workflow engine`). La investigación del código encontró que el spec propone reconstruir
infraestructura que ya existe. Concretamente:

| El spec propone | Realidad en el repo |
|---|---|
| Inventar step type `dynamic_item_capture` | La resolución dinámica ya existe: `workflow-execution-service.ts:22-30` → `StockCountService.generateStockCountSteps` (`stock-count-service.ts:111`), ya persiste los sub-pasos resueltos (`stock-count-service.ts:231-246`) |
| Tabla `lotes` | `inventory_batches` (`schema.ts:741`) — `lotNumber`, `expirationDate`, `initialQuantity`, `currentQuantity`, `unitCost`, `status` |
| Tabla `lote_consumos` | `inventory_movements` (`schema.ts:759`) + `production_ingredients` (`schema.ts:307`) |
| Tabla `daily_production` | `production_results` (`schema.ts:291`) + `production_orders` (`schema.ts:275`) |
| Tabla `merma_records` | `inventory_waste` (`schema.ts:1077`) con enum `inventory_waste_reason` (`schema.ts:1011`) |
| Función `consumirFEFO()` | `TheoreticalConsumptionService.deductItemFIFO` (`theoretical-consumption-service.ts:52`) — ya ordena por `expirationDate, createdAt`, o sea ya es FEFO |
| Crear `lib/cron/inventory-checks.ts` | Ya existe (125 líneas), ya hace stock bajo + lotes por vencer (`inventory-checks.ts:66-125`) |
| Crons vía QStash | Los crons corren por **Inngest** (`lib/inngest/functions/cron-inventory-checks.ts`) |
| `tenant_id` → `tenants` / `sucursales` | No existen. El proyecto usa `company_id` → `companies` y `branch_id` → `branches` (0 ocurrencias de `tenantId` en `schema.ts`, 69 de `companyId`) |
| `recipe_ingredients` | Se llama `recipe_items` (`schema.ts:2330`) |

**Sólo faltan dos tablas de verdad:** `stock_counts` (hoy los resultados del conteo viven como blob
JSON en `workflow_instances.data.results`, `stock-count-service.ts:311-323`) e `inventory_snapshots`
(hoy el stock se deriva en vivo con `SUM(inventory_batches.currentQuantity WHERE status='AVAILABLE')`,
`stock-count-service.ts:97-103`).

El resto del trabajo es **generalizar, endurecer y conectar** lo que ya está construido.

## Architecture Decisions

- **AD-1 — Multi-tenancy: `companyId` + `branchId`, nunca `tenantId`/`sucursalId`.** Todas las tablas
  nuevas siguen la convención del repo. *Rationale:* las FKs del spec no compilan; `tenants` y
  `sucursales` no existen.

- **AD-2 — Reusar tablas existentes; sólo 2 tablas nuevas.** Producción → `production_results` +
  `production_ingredients`. Merma → `inventory_waste`. Lotes → `inventory_batches`. Trazabilidad de
  consumo → `production_ingredients.batchId` + `inventory_movements.referenceId`. Nuevas:
  `stock_counts`, `inventory_snapshots`. *Rationale:* crear `merma_records` junto a `inventory_waste`
  parte la analítica de merma en dos (`executive-report-service`, `cross-branch-service`,
  `predictive-scoring-service` y `app/api/inventory/dashboard` ya leen `inventory_waste`).

- **AD-3 — El step dinámico se declara en `metadata`, NO como miembro nuevo de `WorkflowStepType`.**
  Un step de plantilla lleva `metadata.dynamicSource = { entity, filter }`; el resolver lo expande a N
  sub-pasos de tipos **ya existentes** (`NUMBER`, `SELECT`, `PHOTO`). *Rationale:* `WorkflowStep` está
  definido **7 veces** en el repo (`lib/types/workflow.ts:49`, `components/builder/builder-context.tsx:85`,
  `components/execution/workflow-stepper.tsx:22`, `components/workflow/workflow-executor.tsx:121`,
  `components/workflow/workflow-template-builder.tsx:16`, `lib/services/incident-engine.ts:18`,
  `lib/whatsapp/workflow-conversation-handler-fixed.ts:1`). Añadir `dynamic_item_capture` a la unión
  cerrada obliga a tocar los 7 + todos los renderers + el handler de WhatsApp. `metadata` ya existe
  como `Record<string, any>` y los sub-pasos generados son tipos que todos los renderers ya saben pintar.
  Coste: 1 archivo nuevo en vez de ~10 editados.

- **AD-4 — Idempotencia por columna con índice único, no por `ilike` sobre `notes`.** El extractor
  existente detecta duplicados con `ilike(receivingReports.notes, '%instance:${id}%')`
  (`receiving-from-workflow.ts:83-87`). Las tablas nuevas llevan `workflow_instance_id` con índice
  único parcial. *Rationale:* replicar ese hack en 3 extractores más multiplica deuda; un reintento de
  Inngest con notas editadas duplicaría filas.

- **AD-5 — Cron por Inngest, extendiendo el existente.** `checkInventoryAlerts` ya corre cada 6h
  (`cron-inventory-checks.ts:7`). El snapshot nocturno es una **función Inngest separada** (cron diario
  distinto) que llama a un servicio nuevo; las alertas siguen donde están. *Rationale:* mezclar un job
  de escritura idempotente por sucursal con un job de notificación de 6h complica el retry.

- **AD-6 — Cantidades nuevas en `numeric(12,4)`, no `integer`.** `inventory_batches.currentQuantity`
  es `integer` pero `recipe_items.quantity` es `numeric(10,4)`: el consumo por receta es
  intrínsecamente fraccionario (0.35 kg de queso). Las tablas nuevas usan `numeric(12,4)` y la
  conversión a `integer` ocurre sólo en la frontera con `inventory_batches`. Ver Riesgo R-2.

- **AD-7 — El umbral de varianza vive en `tenant_operating_config`.** Ya es la tabla de umbrales por
  compañía (`schema.ts:2603`, con `managerAuthLimitCents`, `doubleApprovalThresholdCents`,
  `pettyCashLimitCents`). Se añade `mermaVarianceThresholdPct`. *Rationale:* no crear una segunda
  superficie de configuración por compañía.

## Dependency Graph

```
T1 inventory_items.tags (jsonb)
T2 resolver dinámico genérico  ─────────┐
      (metadata.dynamicSource)          │
                                        │
T3 stock_counts ──► T4 extractor conteo ─┤──► T6 E2E conteo
      T5 fix parseInt (fracciones) ──────┘
                                        │
T7 inventory_snapshots ──► T8 snapshot writer ──► T9 cron Inngest ──► T10 E2E idempotencia
                                        │
T11 umbral + merma manual ──► T12 merma automática por varianza ──► T13 E2E merma
                                        │
T14 FEFO allocator (FOR UPDATE) ──► T15 extractor producción ──► T16 lote insuficiente ──► T17 E2E producción/FEFO
```

## Task List

### Phase 0 — Base: tags + resolver dinámico genérico

- [ ] **T1 — `inventory_items.tags`.** Añadir `tags: jsonb("tags").default(sql`'[]'::jsonb`)` a
  `inventoryItems` (`lib/db/schema.ts:679`). **jsonb, no `text[]`+GIN**: es la convención del repo
  (`workflowTemplates.tags`, `schema.ts:121`). `is_high_value` se mantiene intacto.
  *Files: `lib/db/schema.ts`, `drizzle/0036_*.sql` (generado). Size XS. Deps: None.*

- [ ] **T2 — Resolver dinámico genérico.** Nuevo `lib/workflows/dynamic-steps.ts` con
  `resolveDynamicSteps(steps, ctx)`: para cada step con `metadata.dynamicSource = { entity:
  'inventory_item'|'recipe', filter }`, corre la query **una sola vez** y lo reemplaza por N sub-pasos
  (`{parentId}-{entityId}`) con `metadata.entityId` embebido, siguiendo la forma que ya produce
  `generateStockCountSteps` (`stock-count-service.ts:111-174`). Refactorizar
  `WorkflowExecutionService.createExecution` (`workflow-execution-service.ts:22-30`) para llamar al
  resolver **además de** la rama `STOCK_COUNT_TEMPLATE_NAME`, que se conserva sin cambios de
  comportamiento. Filtros soportados: `isHighValue`, `category`, `tags` (contiene), `active`.
  *Files: `lib/workflows/dynamic-steps.ts` (new), `lib/services/workflow-execution-service.ts` (edit),
  `lib/types/workflow.ts` (edit: tipar `metadata.dynamicSource`). Size M. Deps: T1.*

### Checkpoint 0 (T1–T2)
- [ ] `pnpm run build` limpio
- [ ] `pnpm db:generate` produce SÓLO `ALTER TABLE inventory_items ADD COLUMN tags` (sin DROP)
- [ ] `pnpm test:e2e -- conteo-alto-valor.spec.ts limite-30-skus.spec.ts` pasan sin cambios → el
      refactor de `createExecution` no rompió el conteo actual
- [ ] Manual: un template con `metadata.dynamicSource` genera N sub-pasos visibles en el stepper

### Phase 1 — Conteo: sacar los resultados del blob JSON

- [ ] **T3 — Tabla `stock_counts`.** `companyId`, `branchId`, `itemId`, `workflowInstanceId`,
  `countedQuantity numeric(12,4)`, `systemQuantity numeric(12,4)`, `evidenceUrl`, `countedBy`,
  `countDate date`, `createdAt`. Índice `(branchId, countDate DESC)` + único parcial
  `(workflowInstanceId, itemId)` para idempotencia (AD-4).
  *Files: `lib/db/schema.ts` (edit), `drizzle/0037_*.sql`. Size S. Deps: None.*

- [ ] **T4 — Extractor `processStockCountFromWorkflow`.** Nuevo
  `lib/services/stock-count-from-workflow.ts` siguiendo el patrón de `receiving-from-workflow.ts`:
  descarta si `status !== 'COMPLETED'`, idempotente vía el único de T3, lee los sub-pasos
  `count-{itemId}` e inserta una fila por item. Enganchar en
  `workflow-execution-service.ts:446-463` junto al de recepción. **No** duplica la lógica de ajuste:
  `applyStockCountAdjustments` (`stock-count-service.ts:373`) sigue siendo el único que mueve stock.
  *Files: `lib/services/stock-count-from-workflow.ts` (new), `lib/services/workflow-execution-service.ts`
  (edit). Size M. Deps: T2, T3.*

- [ ] **T5 — Corregir truncamiento de cantidades fraccionarias.** `stock-count-service.ts:295` hace
  `parseInt(String(stepData.inputValue), 10)`: contar 2.5 kg registra 2. Cambiar a `parseFloat` y
  propagar el tipo por `results[]`, `variance`, `variancePercent`.
  `InventoryService.recordAdjustment` recibe `integer` — redondear **sólo** en esa frontera y dejar el
  valor exacto en `stock_counts` (AD-6).
  *Files: `lib/services/stock-count-service.ts` (edit). Size S. Deps: T3.*

- [ ] **T6 — E2E `conteo-dinamico.spec.ts`.** Patrón `tests/` existente (workers: 1, datos `[E2E]`,
  limpieza en `tests/support/db.ts`): el workflow genera N sub-pasos según `isHighValue=true`; al
  completar, `stock_counts` tiene N filas; completar dos veces no duplica. Helpers nuevos en
  `tests/support/db.ts`: `findStockCountsForInstance`, `cleanupStockCounts`.
  *Files: `tests/conteo-dinamico.spec.ts` (new), `tests/support/db.ts` (edit). Size M. Deps: T4, T5.*

### Checkpoint 1 (T3–T6)
- [ ] `pnpm run build` limpio; `pnpm db:generate` sólo `CREATE TABLE stock_counts`
- [ ] `pnpm test:e2e -- conteo-dinamico.spec.ts` verde
- [ ] `pnpm test:e2e -- conteo-alto-valor.spec.ts` sigue verde (no regresión)
- [ ] Manual: contar 2.5 kg guarda `2.5000`, no `2`
- [ ] **Revisar con humano antes de Phase 2**

### Phase 2 — Snapshots de stock

- [ ] **T7 — Tabla `inventory_snapshots`.** `companyId`, `branchId`, `itemId`, `snapshotDate date`,
  `calculatedStock numeric(12,4)`, `countedStock numeric(12,4)` (nullable), `variance` como columna
  generada `STORED`, `createdAt`. Único `(companyId, branchId, itemId, snapshotDate)` + índice
  `(branchId, snapshotDate DESC)`.
  *Files: `lib/db/schema.ts` (edit), `drizzle/0038_*.sql`. Size S. Deps: None.*

- [ ] **T8 — `InventorySnapshotService`.** Nuevo `lib/services/inventory-snapshot-service.ts`:
  `buildSnapshot(companyId, branchId, date)` calcula `calculatedStock` desde
  `inventory_batches` + `inventory_movements` del día, cruza el último `stock_counts` de esa fecha, y
  escribe con `ON CONFLICT (...) DO UPDATE`. Sólo sobre items `isHighValue = true` (reutiliza el filtro
  80/20, no barre el catálogo completo).
  *Files: `lib/services/inventory-snapshot-service.ts` (new). Size M. Deps: T3, T7.*

- [ ] **T9 — Cron nocturno Inngest.** Nuevo `lib/inngest/functions/cron-inventory-snapshot.ts`
  (cron diario, p.ej. `0 5 * * *`), registrado en `lib/inngest/functions/index.ts`. Itera compañías
  `ACTIVE` × sucursales activas (mismo bucle que `inventory-checks.ts:11-45`) y llama a
  `buildSnapshot`. **No** tocar `checkInventoryAlerts` (AD-5).
  *Files: `lib/inngest/functions/cron-inventory-snapshot.ts` (new), `lib/inngest/functions/index.ts`
  (edit). Size S. Deps: T8.*

- [ ] **T10 — E2E `snapshot-idempotente.spec.ts`.** Correr `buildSnapshot` dos veces el mismo día no
  duplica filas y actualiza `calculatedStock`.
  *Files: `tests/snapshot-idempotente.spec.ts` (new), `tests/support/db.ts` (edit). Size S. Deps: T9.*

### Checkpoint 2 (T7–T10)
- [ ] `pnpm run build` limpio; `pnpm db:generate` sólo `CREATE TABLE inventory_snapshots`
- [ ] `pnpm test:e2e -- snapshot-idempotente.spec.ts` verde
- [ ] Manual: tras un conteo, `inventory_snapshots.variance` del día refleja contado − calculado

### Phase 3 — Merma manual y automática

- [ ] **T11 — Umbral + extractor de merma manual.** (a) Añadir `mermaVarianceThresholdPct` a
  `tenantOperatingConfig` (`schema.ts:2603`) + a `TenantOperatingConfigInput`
  (`tenant-operating-config-service.ts:9`), default 5. (b) Nuevo
  `lib/services/merma-from-workflow.ts`: lee el step dinámico de merma e inserta en `inventory_waste`
  con `reason` mapeado, `recordedBy`, `notes` con `instance:{id}`. Motivo y evidencia obligatorios.
  Mapeo: `caducidad→EXPIRED`, `caida→SPILLAGE`, `error_cocina→QUALITY`, `cortesia→`**gap** (ver
  Open Question OQ-1). Enganchar en `workflow-execution-service.ts`.
  *Files: `lib/db/schema.ts` (edit), `lib/services/tenant-operating-config-service.ts` (edit),
  `lib/services/merma-from-workflow.ts` (new), `lib/services/workflow-execution-service.ts` (edit),
  `drizzle/0039_*.sql`. Size M. Deps: T2.*

- [ ] **T12 — Merma automática por varianza de conteo.** En el extractor de T4: si
  `ABS(variancePercent) > mermaVarianceThresholdPct` **y** la varianza es negativa (faltante), insertar
  en `inventory_waste` con `reason = 'OTHER'` y `notes` marcando `origen=diferencia_conteo`. Sobrante
  no genera merma. Idempotente por `instance:{id}` en notes + chequeo previo.
  *Files: `lib/services/stock-count-from-workflow.ts` (edit). Size S. Deps: T11.*

- [ ] **T13 — E2E `merma-manual.spec.ts` + `merma-automatica.spec.ts`.** Manual: el step exige motivo
  + foto, rechaza envío sin evidencia. Automática: varianza sobre el umbral crea la fila sin
  intervención; varianza bajo el umbral no crea nada.
  *Files: `tests/merma-manual.spec.ts` (new), `tests/merma-automatica.spec.ts` (new),
  `tests/support/db.ts` (edit). Size M. Deps: T12.*

### Checkpoint 3 (T11–T13)
- [ ] `pnpm run build` limpio
- [ ] Ambos specs de merma verdes
- [ ] `app/api/inventory/dashboard` y el reporte ejecutivo siguen sumando merma correctamente
      (las filas nuevas entran por `inventory_waste`, no por una tabla paralela)
- [ ] **Revisar con humano antes de Phase 4** — Phase 4 es la de mayor riesgo

### Phase 4 — Producción diaria y consumo FEFO

- [ ] **T14 — Extraer y endurecer el allocator FEFO.** Sacar de
  `TheoreticalConsumptionService.deductItemFIFO` (`theoretical-consumption-service.ts:52-88`) un
  `allocateFEFO(tx, itemId, branchId, qty)` que **devuelve** el desglose `[{batchId, qty, unitCost}]`
  sin escribir, con `FOR UPDATE` sobre los lotes (evita doble consumo si dos workflows de producción
  corren a la vez en la misma sucursal). `deductItemFIFO` pasa a usarlo — comportamiento idéntico,
  ahora con lock. Renombrar a FEFO en comentarios (ya ordena por `expirationDate`, el nombre FIFO
  miente).
  *Files: `lib/services/fefo-allocator.ts` (new), `lib/services/theoretical-consumption-service.ts`
  (edit). Size M. Deps: None.*

- [ ] **T15 — Extractor `processProductionFromWorkflow`.** Nuevo
  `lib/services/production-from-workflow.ts`: lee el step dinámico de recetas (`entity: 'recipe'`,
  filtro por tag `receta_activa`), expande cada receta vía `recipe_items` (incluida recursión de
  sub-recetas, igual que `deductRecipeIngredients`, `theoretical-consumption-service.ts:22`), corre
  `allocateFEFO` por insumo, y llama a `ProductionService.recordProduction`
  (`production-service.ts:50`) con un `ingredients[]` por par (item, lote) — así `recordProduction`
  descuenta cada lote y **no** hay doble descuento. Enganchar en `workflow-execution-service.ts`.
  Idempotente vía `production_results` + `orderId`/notes con `instance:{id}`.
  *Files: `lib/services/production-from-workflow.ts` (new),
  `lib/services/workflow-execution-service.ts` (edit). Size M. Deps: T2, T14.*

- [ ] **T16 — Lote insuficiente → merma, no fallo silencioso.** `ProductionService.recordProduction`
  hoy hace `if (batch && batch.currentQuantity >= ing.actualQuantity)` (`production-service.ts:86`):
  si no alcanza, **omite el descuento sin avisar**. Cambiar a descontar lo disponible y devolver el
  faltante; el extractor de T15 inserta el remanente en `inventory_waste` con `reason = 'OTHER'` y
  `notes` marcando `motivo=lote_insuficiente`. Señal de auditoría (recepción no registrada o merma no
  capturada aguas arriba).
  *Files: `lib/services/production-service.ts` (edit), `lib/services/production-from-workflow.ts`
  (edit). Size S. Deps: T15.*

- [ ] **T17 — E2E `produccion-diaria.spec.ts` + `consumo-fefo.spec.ts` + `lote-insuficiente.spec.ts`.**
  (a) Producir una receta descuenta insumos según `recipe_items` y escribe `production_results` +
  `production_ingredients`. (b) Con dos lotes donde el recibido **después** caduca **antes**, el
  consumo toma ese primero (FEFO real, no FIFO por recepción). (c) Producción que excede lo disponible
  genera merma `lote_insuficiente` en vez de omitir silenciosamente.
  *Files: `tests/produccion-diaria.spec.ts` (new), `tests/consumo-fefo.spec.ts` (new),
  `tests/lote-insuficiente.spec.ts` (new), `tests/support/db.ts` (edit). Size L → partir en T17a
  (producción) / T17b (FEFO + insuficiente). Deps: T16.*

### Checkpoint 4 — Completo (T14–T17)
- [ ] `pnpm run build` limpio, `pnpm lint` limpio
- [ ] Suite completa `pnpm test:e2e` verde (7 specs previos + 6 nuevos)
- [ ] Ciclo end-to-end manual: recibir → contar → producir → snapshot nocturno → la varianza del día
      cuadra y la merma aparece en el dashboard de inventario
- [ ] Ninguna migración generada contiene `DROP`
- [ ] Listo para review

## Risks and Mitigations

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R-1 | El refactor de `createExecution` (T2) rompe el conteo 80/20 que ya está en producción | **Alto** | La rama `STOCK_COUNT_TEMPLATE_NAME` se conserva intacta; el resolver genérico es aditivo. Checkpoint 0 exige que `conteo-alto-valor.spec.ts` y `limite-30-skus.spec.ts` sigan verdes antes de continuar |
| R-2 | Mezcla `integer` (`inventory_batches.currentQuantity`) con `numeric` (tablas nuevas, `recipe_items.quantity`) produce deriva por redondeo acumulado | **Alto** | AD-6: redondear sólo en la frontera con `inventory_batches`, guardar el valor exacto en `stock_counts`/`inventory_snapshots`. El snapshot expone la deriva en vez de esconderla. Ver OQ-2 |
| R-3 | Doble consumo de lotes si dos workflows de producción corren simultáneos en la misma sucursal | Medio | T14 añade `FOR UPDATE` dentro de transacción |
| R-4 | Doble descuento de inventario: `deductItemFIFO` (por ventas) y el extractor de producción descuentan el mismo insumo | **Alto** | T15 usa exclusivamente `recordProduction` para escribir. El consumo teórico por ventas y el consumo real por producción son caminos distintos — validar en el ciclo manual del Checkpoint 4 que no se suman |
| R-5 | Los extractores son fire-and-forget (`void`, `receiving-from-workflow.ts` patrón): un fallo se pierde en un `console.error` | Medio | Aceptado para paridad con el patrón existente; la idempotencia por índice único (AD-4) permite reprocesar. Registrar el gap para una fase posterior de observabilidad |
| R-6 | Los specs E2E comparten la base de desarrollo (`playwright.config.ts`: `workers: 1`, `fullyParallel: false`) y se pisan entre sí | Bajo | Seguir el patrón `[E2E]` + limpieza en `tests/support/db.ts`; los conteos activos por sucursal ya obligan a serie |

## Open Questions

- **OQ-1 — `cortesia` no tiene equivalente en `inventory_waste_reason`.** El enum actual es
  `EXPIRED | DAMAGED | QUALITY | SPILLAGE | OTHER | STAFF` (`schema.ts:1011`). Tres de los cuatro
  motivos del spec mapean limpio; `cortesia` (producto regalado a un cliente) no es merma real — es
  costo de marketing. Opciones: (a) añadir `COURTESY` al enum, (b) mapear a `STAFF` (que ya se trata
  distinto: `app/api/inventory/waste/route.ts:163` lo registra como `USAGE`, no `WASTE`), (c) mapear a
  `OTHER`. **Recomendación: (a)**, con el mismo trato que `STAFF` (movimiento `USAGE`), para no inflar
  el % de merma con cortesías. Requiere decisión antes de T11.

- **OQ-2 — ¿Migrar `inventory_batches.currentQuantity` a `numeric`?** Resolvería R-2 de raíz, pero
  toca `inventory-service`, `production-service`, `theoretical-consumption-service`,
  `stock-alert-service` y `stock-count-service`. Fuera del alcance de este plan; decidir si se agenda
  como deuda técnica separada.

- **OQ-3 — Seguimiento de lote sólo para items con tag `perecedero`.** El spec lo pide, pero
  `inventory_batches` ya se llena para todo item recibido y `checkExpiringBatches`
  (`inventory-checks.ts:66`) ya filtra por `expirationDate IS NOT NULL`. ¿Hace falta el gate por tag, o
  basta con que la captura de `fecha_caducidad` en recepción sea condicional al tag? **Recomendación:**
  lo segundo — cero cambios de esquema, la fricción de captura se evita igual.

- **OQ-4 — Alcance de `stock_calculado`.** La fórmula del spec incluye "consumo teórico por ventas del
  día (recipe × ventas)". Eso ya lo hace `TheoreticalConsumptionService.consume` descontando de lotes
  en tiempo real. Si el snapshot lo vuelve a restar, se cuenta doble. **Recomendación:** `buildSnapshot`
  (T8) lee el estado resultante de `inventory_batches`, no recalcula la fórmula por términos. Confirmar
  antes de T8.

## Notas de ejecución

- Migraciones con `pnpm db:generate`, **nunca** `db:push`. Última migración actual: `0035_gaps-avanzados.sql`.
- Una tabla por migración, igual que en `feat/capa-dinero`.
- Revisar cada SQL generado antes de aplicar: si contiene `DROP`, no aplicar.
- E2E: `pnpm test:e2e -- <spec>`. Build: `pnpm run build`. Lint: `pnpm lint`.
