# Recipes/Costeo (BOM) — Hardening & Precisión — Task List

Source plan: `tasks/recipes/plan.md`. Baseline: auditoría codegraph de `app/dashboard/inventory/recipes` (5 observaciones de riesgo: ciclos sin protección, PUT sin transacción, costos desactualizados, N+1, POST sin items).

Open questions — RESUELTAS (2026-07-28):
- Q1: Método de costeo de recetas ⇒ **config de empresa** (fallback `LAST_COST`).
- Q2: Trigger de recálculo ⇒ **ambos**: `RECEIVING` de `registerMovement` y `invoices/upload` (OCR), mismo evento.
- Q3: Tests ⇒ **solo Playwright E2E** (sin vitest; T14 sin dependencia nueva).
- Q4: Umbral food cost ⇒ **configurable por empresa** (T11 incluido, `targetFoodCostPct` default 35).
- Q5: Borrado con historial ⇒ **bloqueo 409** con conteo de referencias.

---

## Phase 1 — Corrección crítica

- [x] **T1** RecipeService a prueba de ciclos (visited-set en los 3 recorridos recursivos + `RecipeCycleError`). *Files: `lib/services/recipe-service.ts`. Size S.* *(verificado en código 2026-07-28: `RecipeCycleError`, `visited` en los 3 recorridos)*
  - Acceptance: `calculateRecipeCost`, `recipeUsesItem`, `calculateSimulatedCost` reciben `visited: Set<string>`; un ciclo A→B→A lanza error controlado (costeo) o corta rama (detección de uso); sin visited-set, comportamiento idéntico al actual.
  - Verify: build limpio; receta con ciclo en datos semilla ⇒ error en log/respuesta, servidor no cuelga.

- [x] **T2** Validación anti-ciclo en escritura + zod compartidos en `lib/validators/recipes.ts`. *Files: `lib/validators/recipes.ts` (nuevo), `app/api/inventory/recipes/[id]/route.ts`, `lib/services/recipe-service.ts` (helper `wouldCreateCycle`). Size S.* *(verificado en código 2026-07-28: `lib/validators/recipes.ts` + `wouldCreateCycle` existen)*
  - Acceptance: PUT ejecuta DFS sobre el grafo propuesto antes de persistir y devuelve `409` con mensaje claro si la receta queda alcanzable desde sí misma (cubre ciclos indirectos); schemas create/update (con `items`) viven en un solo módulo usado por ambas rutas.
  - Verify: build limpio; manual: crear A→B, intentar guardar B→A ⇒ 409.

- [x] **T3** Transacciones reales en PUT y DELETE (`db.transaction`, patrón de `inventory-service.ts:106`). *Files: `app/api/inventory/recipes/[id]/route.ts`. Size XS.*
  - Acceptance: update header + delete items + insert items dentro de una transacción; recálculo de costo después del commit; DELETE atómico (items + header).
  - Verify: build limpio; forzar error en insert de items ⇒ receta conserva ingredientes anteriores.

- [x] **T4** POST acepta `items` y calcula costo inicial. *Files: `app/api/inventory/recipes/route.ts`. Size S.*
  - Acceptance: usa el schema compartido de T2 (con `items`); inserta items en transacción; validación anti-ciclo; `calculateRecipeCost` tras commit; `calculatedCost > 0` al crear con ingredientes.
  - Verify: build limpio; crear receta con 2 ingredientes desde la UI ⇒ costo visible sin editar después.

### Checkpoint A (after T1–T4)
- [ ] `pnpm run build` + `pnpm run lint` limpios
- [ ] Ciclos rechazados en escritura y contenidos en lectura
- [ ] Rollback íntegro ante fallo de PUT
- [ ] POST con items costea desde el primer momento

---

## Phase 2 — Motor de costeo por lotes

- [ ] **T5** Refactor interno a grafo + memoización, API pública intacta. *Files: `lib/services/recipe-service.ts`. Size M.*
  - Acceptance: una carga en lote por tenant (`recipes`, `recipeItems`, `inventoryItems` afectados); mapa de adyacencia; DFS memoizado (cada sub-receta se calcula una vez); conserva visited-set (T1) y `Math.round` por línea; `simulateIngredientCostChange` reutiliza el mismo grafo con una sola carga.
  - Verify: build limpio; **paridad** de `calculatedCost` y resultados de simulación antes/después sobre datos semilla.

- [ ] **T6** Índices: `recipe_items(recipe_id)`, `recipe_items(item_id)`, `recipes(company_id)`. *Files: `lib/db/schema.ts` + migración `pnpm db:generate`. Size XS.* *(paralelizable con T5)*
  - Acceptance: migración generada y aplicada con `pnpm db:migrate` (NO `db:push`); índices visibles en la base.
  - Verify: build limpio; `\d recipe_items` muestra los índices.

### Checkpoint B (after T5–T6)
- [ ] Paridad de costos verificada (script de comparación o manual receta por receta)
- [ ] Simulación con una carga de datos por tenant (sin N+1; conteo de queries en logs)

---

## Phase 3 — Frescura de costos

- [ ] **T7** Función Inngest `recalculate-recipes-on-cost-change` (evento `inventory/item.cost-changed`). *Files: `lib/inngest/functions/recalculate-recipe-costs.ts` (nuevo), registro en `app/api/inngest/route.ts`. Size M.*
  - Acceptance: payload `{ companyId, itemId }`; localiza recetas afectadas (directas + descendientes por sub-recetas) y recalcula con el motor T5; límite de concurrencia por tenant; registrada en el serve de Inngest.
  - Verify: función visible en Inngest dev UI (`npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`).

- [ ] **T8** Emitir evento desde `InventoryService.registerMovement` (rama RECEIVING) tras commit, fire-and-forget. *Files: `lib/services/inventory-service.ts`. Size S.*
  - Acceptance: emisión con try/catch (recepción nunca falla por Inngest); un evento por item con costo actualizado.
  - Verify: recepción con costo nuevo ⇒ corrida en dev UI y recetas afectadas actualizadas en segundos; recetas no afectadas intactas.

### Checkpoint C (after T7–T8)
- [ ] Build limpio; función registrada en Inngest
- [ ] E2E manual recepción ⇒ recálculo asíncrono verificado en dev UI

---

## Phase 4 — Precisión de costeo y features

- [ ] **T9** `yield_percent` (merma) en motor + schema + UI. *Files: `lib/services/recipe-service.ts`, `lib/validators/recipes.ts`, `app/dashboard/inventory/recipes/page.tsx`. Size M.*
  - Acceptance: `costo_línea = qty × unitCost ÷ (yield/100)`, default 100 (= comportamiento actual); schema acepta `yieldPercent` opcional; diálogo con columna "% Merma"; estimador en cliente replica la fórmula.
  - Verify: receta con 10% merma en un ingrediente costea más que sin merma.

- [ ] **T10** Conversión de unidades en el costeo. *Files: `lib/services/recipe-service.ts`, posiblemente `lib/services/unit-conversion-service.ts` (método batch). Size M.*
  - Acceptance: conversiones del tenant precargadas en lote; unidad de línea ≠ unidad base del insumo ⇒ `UnitConversionService.convert()`; sin conversión ⇒ comportamiento actual + `console.warn` (nunca bloquea).
  - Verify: línea en Gramos con insumo comprado por KG costea correctamente; par de unidades sin conversión ⇒ costo actual + warning.

- [ ] **T11** Umbral de food cost configurable (opcional, Q4). *Files: `lib/services/costing-service.ts`, `app/api/inventory/costing/config/route.ts`, `app/dashboard/inventory/recipes/page.tsx`. Size S.*
  - Acceptance: `targetFoodCostPct` (default 35) en config; badge y estimador del UI lo consumen vía API; sin config ⇒ 35.
  - Verify: cambiar umbral ⇒ badge cambia de color en el valor nuevo.

- [ ] **T12** Guarda de borrado. *Files: `app/api/inventory/recipes/[id]/route.ts`, `app/dashboard/inventory/recipes/page.tsx`. Size S.*
  - Acceptance: DELETE con referencias en `salesEntries` u órdenes de producción ⇒ `409` + conteo; UI muestra el motivo en toast; sin referencias borra normal.
  - Verify: receta con ventas ⇒ 409 + toast; receta sin uso ⇒ se borra.

### Checkpoint D (after T9–T12)
- [ ] Build limpio
- [ ] Merma y conversión verificadas numéricamente; guarda de borrado verificada

---

## Phase 5 — Calidad

- [ ] **T13** Cliente sobre contratos compartidos. *Files: `app/dashboard/inventory/recipes/page.tsx`, `lib/validators/recipes.ts`. Size S.*
  - Acceptance: `page.tsx` importa tipos derivados de los zod (T2); interfaces locales duplicadas eliminadas; drift con `production-client.tsx`/`reports/page.tsx` alineado si es trivial, si no documentado como deuda.
  - Verify: build limpio; no quedan interfaces `Recipe`/`RecipeItem` locales en `recipes/page.tsx`.

- [ ] **T14** Tests. *Files: `tests/e2e/recipes.spec.ts` (nuevo); opcional (Q3): `vitest.config.ts` + unit tests del motor. Size M.*
  - Acceptance: spec Playwright cubre CRUD, 409 por ciclo, simulación con resultado esperado, guarda de borrado; opcionalmente unit tests del motor (ciclo, memo, merma, conversión) si Q3 aprueba vitest.
  - Verify: `pnpm test:e2e` pasa.

### Checkpoint E (complete)
- [ ] `pnpm test:e2e` + build + lint limpios
- [ ] Las 5 observaciones de la auditoría tienen fix mergeado
- [ ] Script one-off `scripts/recalculate-recipe-costs.ts` ejecutado en destino (refresca costos con merma/conversión)
- [ ] Listo para revisión humana

---

## Definition of Done (per-task, standing bar)

- [ ] `pnpm run build` exits 0
- [ ] `pnpm run lint` exits 0 (o warning count pre-existente sin cambios)
- [ ] Multi-tenant: todo acceso nuevo scoping por `companyId`; cero lecturas cross-tenant
- [ ] `RecipeService` conserva API pública (T5) y redondeo por línea; paridad exigida en Checkpoint B
- [ ] Recepción de mercancía nunca puede fallar por el recálculo (emisión fire-and-forget)
- [ ] Migraciones con `pnpm db:generate` + `pnpm db:migrate` (NUNCA `db:push` sin verificar `.env`)
- [ ] Sin estados a medias: cada tarea deja la app compilando y el sub-flujo completo
