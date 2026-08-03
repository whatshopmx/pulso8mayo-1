# Implementation Plan: Recipes/Costeo (BOM) — Hardening & Precisión

## Overview

Fortalecer el módulo de recetas (`app/dashboard/inventory/recipes` + `app/api/inventory/recipes/*` + `lib/services/recipe-service.ts`) en cinco frentes: **corrección crítica** (ciclos infinitos, falta de transacciones, POST que ignora ingredientes), **motor de costeo por lotes** (eliminar N+1 con carga en grafo + memoización), **frescura de costos** (recálculo automático vía Inngest cuando cambia `lastCost`/`averageCost` en recepción), **precisión de costeo** (`yield_percent`/merma, conversión de unidades, umbral de food cost configurable, guarda de borrado) y **calidad** (contratos compartidos, tests). Cierra las 5 observaciones de riesgo detectadas en la auditoría y aprovecha infraestructura existente pero desconectada (`UnitConversionService`, `db.transaction`, campo `yield_percent`, config de `CostingService`).

## Architecture Decisions

**AD-1 — Defensa anti-ciclos en dos capas.**
Capa lectura: los tres recorridos recursivos de `RecipeService` (`calculateRecipeCost`, `recipeUsesItem`, `calculateSimulatedCost`) reciben un `visited: Set<string>`; al detectar un ciclo se lanza `RecipeCycleError` (costeo) o se corta la rama (detección de uso). Capa escritura: el PUT valida el grafo nuevo con un DFS desde la receta editada antes de persistir y rechaza con 409 si la receta queda alcanzable desde sí misma.
*Rationale:* la UI solo filtra la auto-referencia directa (A→A); ciclos indirectos (A→B→A) cuelgan el servidor hoy. La validación en escritura protege el dato; el visited-set protege al servidor ante datos ya corruptos.

**AD-2 — Motor de costeo como grafo en memoria, API pública intacta.**
Reescribir el interior de `RecipeService` para cargar en una sola pasada: todos los `recipeItems` del tenant, todas las `recipes`, todos los `inventoryItems` afectados, y construir un mapa de adyacencia. El costeo se resuelve con DFS memoizado (sub-recetas calculadas una sola vez). Las firmas públicas (`calculateRecipeCost`, `simulateIngredientCostChange`) no cambian: ningún consumidor se entera.
*Rationale:* hoy cada línea de ingrediente y cada nivel de sub-receta hacen 1–2 `SELECT` (N+1 severo en simulación, que itera todas las recetas del tenant). La recursión con memoización también resuelve gratis el visited-set de AD-1.

**AD-3 — Recálculo asíncrono vía Inngest, nunca en el hot-path de recepción.**
`InventoryService.registerMovement` (rama `RECEIVING`, líneas ~131-160) emite tras el commit un evento `inventory/item.cost-changed` (fire-and-forget con try/catch). Una función durable nueva en `lib/inngest/functions/` recibe el evento, localiza las recetas afectadas (directas + descendientes vía sub-recetas) y recalcula con el motor de AD-2. `INNGEST_DEV=1` en local, signing keys en prod (ya documentado en AGENTS.md).
*Rationale:* recalcular síncronamente dentro de la transacción de recepción la alarga y acopla inventario a costeo; el proyecto ya opera 11 cron jobs en Inngest, es el canal establecido. El evento incluye `companyId` + `itemId`; la deduplicación de eventos la da el `id` del evento (ventana 24h de Inngest).

**AD-4 — Precisión de costeo como datos por línea, no heurística global.**
`yield_percent` (ya existe en `recipe_items`, default 100 = comportamiento actual) pasa a dividir el costo efectivo de la línea: `costo = qty × unitCost ÷ (yield/100)`. La conversión de unidades usa `UnitConversionService.convert()` cuando la unidad de la línea difiera de la unidad de compra del insumo; conversiones precargadas en lote (sin N+1) y *fallback* seguro: si no hay conversión registrada, se conserva el comportamiento actual y se registra un warning.
*Rationale:* comprar por KG y recetar en Gramos hoy costea mal en silencio; la infraestructura de conversión existe (`unit-conversion-service.ts`, seeds HORECA) pero nunca se conectó al costeo. Default 100% y fallback nulo garantizan cero regresión en datos existentes.

## Task List

### Phase 1: Corrección crítica

- [ ] **T1 — RecipeService a prueba de ciclos.** Añadir `visited: Set<string>` a los tres recorridos recursivos; nueva `RecipeCycleError`; en `recipeUsesItem` cortar la rama visitada en vez de colgar. *Files: `lib/services/recipe-service.ts`.* **S**.
- [ ] **T2 — Validación anti-ciclo en escritura + schemas compartidos.** Extraer los zod de ambas rutas a `lib/validators/recipes.ts` (create/update, con `items`); en el PUT, antes de persistir, DFS sobre el grafo propuesto (recetas + items del tenant) y `409` con mensaje claro si hay ciclo. *Files: `lib/validators/recipes.ts` (nuevo), `app/api/inventory/recipes/[id]/route.ts`, `lib/services/recipe-service.ts` (helper `wouldCreateCycle`).* **S**.
- [ ] **T3 — Transacciones reales en PUT y DELETE.** Sustituir `const tx = db` por `db.transaction(async (tx) => …)` (patrón ya usado en `inventory-service.ts:106`, `purchase-order-service.ts:103`); el recálculo de costo queda **después** del commit. *Files: `app/api/inventory/recipes/[id]/route.ts`.* **XS**.
- [ ] **T4 — POST acepta items y calcula costo inicial.** Reusar el schema de `lib/validators/recipes.ts`; insertar items dentro de transacción; correr la misma validación anti-ciclo; calcular costo tras el commit. El frontend ya envía `items` — cero cambios de UI. *Files: `app/api/inventory/recipes/route.ts`.* **S**.

### Checkpoint A — T1–T4
- [ ] `pnpm run build` y `pnpm run lint` limpios
- [ ] Manual: crear A→B, intentar B→A ⇒ 409 con mensaje; crear ciclo A→B→C→A en datos semilla ⇒ el costeo lanza error controlado, no cuelga
- [ ] PUT que falle a mitad (forzar error) deja los ingredientes anteriores intactos (rollback)
- [ ] POST con 2 ingredientes crea receta con `calculatedCost > 0` sin editarla después

### Phase 2: Motor de costeo por lotes

- [ ] **T5 — Refactor interno a grafo + memoización (API pública intacta).** Carga en lote por tenant (`recipes`, `recipeItems`, `inventoryItems` afectados), mapa de adyacencia, DFS memoizado; conserva visited-set de T1 y redondeo por línea actual; `simulateIngredientCostChange` reutiliza el mismo grafo (una sola carga para todas las recetas). *Files: `lib/services/recipe-service.ts`.* **M**.
- [ ] **T6 — Índices de soporte.** Migración drizzle: `recipe_items(recipe_id)`, `recipe_items(item_id)`, `recipes(company_id)`. *Files: `lib/db/schema.ts`, migración generada con `pnpm db:generate`.* **XS**. *Paralelizable con T5.*

### Checkpoint B — T5–T6
- [ ] Build limpio
- [ ] **Paridad**: sobre datos semilla, `calculatedCost` y resultados de simulación idénticos antes/después del refactor (script de comparación `scripts/compare-recipe-costs.ts` o verificación manual por receta)
- [ ] Simulación sobre tenant semilla corre en una fracción del tiempo previo (conteo de queries antes/después en logs)

### Phase 3: Frescura de costos

- [ ] **T7 — Función Inngest `recalculate-recipes-on-cost-change`.** Trigger evento `inventory/item.cost-changed`; payload `{ companyId, itemId }`; localiza recetas afectadas (directas + descendientes) y recalcula con el motor T5; concurrencia/throttle por tenant. *Files: `lib/inngest/functions/recalculate-recipe-costs.ts` (nuevo), `lib/inngest/functions/index.ts` o registro equivalente, `app/api/inngest/route.ts`.* **M**.
- [ ] **T8 — Emitir el evento desde recepción.** En `InventoryService.registerMovement`, tras el commit de la rama `RECEIVING` que actualiza `lastCost`/`averageCost`, emitir con try/catch (nunca romper la recepción si Inngest cae). *Files: `lib/services/inventory-service.ts`.* **S**.

### Checkpoint C — T7–T8
- [ ] Build limpio; Inngest dev server levanta con la nueva función registrada
- [ ] E2E manual: registrar recepción con costo nuevo ⇒ la corrida aparece en Inngest dev UI y las recetas afectadas actualizan `calculatedCost`/`foodCostPercentage` en segundos
- [ ] Recetas NO afectadas conservan su costo (sin recálculo masivo)

### Phase 4: Precisión de costeo y features

- [ ] **T9 — `yield_percent` (merma) en costo y UI.** Motor: `costo_línea = qty × unitCost ÷ (yield/100)` (default 100). API: schema acepta `yieldPercent` opcional. UI: columna "% Merma" por fila de ingrediente en el diálogo; estimador en cliente replica la fórmula. *Files: `lib/services/recipe-service.ts`, `lib/validators/recipes.ts`, `app/dashboard/inventory/recipes/page.tsx`.* **M**.
- [ ] **T10 — Conversión de unidades en el costeo.** Precargar conversiones del tenant en lote; si la unidad de la línea ≠ unidad base del insumo, `UnitConversionService.convert()`; sin conversión registrada ⇒ comportamiento actual + `console.warn`. *Files: `lib/services/recipe-service.ts` (integración), posiblemente `lib/services/unit-conversion-service.ts` (método batch).* **M**.
- [ ] **T11 — Umbral de food cost configurable (opcional).** Extender config de `CostingService` con `targetFoodCostPct` (default 35); el badge y el estimador de `page.tsx` lo leen vía API en vez del literal 35. *Files: `lib/services/costing-service.ts`, `app/api/inventory/costing/config/route.ts`, `app/dashboard/inventory/recipes/page.tsx`.* **S**. *Decisión Q4.*
- [ ] **T12 — Guarda de borrado.** DELETE devuelve `409` con conteo de referencias si la receta tiene `salesEntries` u órdenes de producción; UI muestra el motivo en el toast. *Files: `app/api/inventory/recipes/[id]/route.ts`, `app/dashboard/inventory/recipes/page.tsx`.* **S**.

### Checkpoint D — T9–T12
- [ ] Build limpio
- [ ] Receta con 10% de merma en un ingrediente costea más que la misma sin merma
- [ ] Línea en Gramos contra insumo comprado por KG costea correctamente; sin conversión registrada se mantiene el costo actual y aparece el warning
- [ ] Borrar receta con ventas registradas ⇒ 409 + toast explicativo; receta sin referencias se borra normal

### Phase 5: Calidad

- [ ] **T13 — Cliente sobre contratos compartidos.** `page.tsx` importa tipos desde el módulo de contratos (derivados de los zod de T2) y elimina las interfaces locales duplicadas; alinear las interfaces `Recipe` de `production-client.tsx` y `reports/page.tsx` si es trivial (si no, se documenta como deuda). *Files: `app/dashboard/inventory/recipes/page.tsx`, `lib/validators/recipes.ts`.* **S**.
- [ ] **T14 — Tests.** Spec Playwright `tests/e2e/recipes.spec.ts`: CRUD completo, rechazo de ciclo (409), simulación con resultado esperado, guarda de borrado. Opcional (Q3): vitest para el motor de costeo como funciones puras (ciclo, memoización, merma, conversión). *Files: `tests/e2e/recipes.spec.ts` (nuevo), opcionalmente `vitest.config.ts` + tests de servicio.* **M**.

### Checkpoint E — Complete
- [ ] `pnpm test:e2e` pasa con la nueva spec; build y lint limpios
- [ ] Las 5 observaciones de riesgo de la auditoría tienen fix mergeado
- [ ] Script one-off `scripts/recalculate-recipe-costs.ts` ejecutado en el entorno destino para refrescar costos históricos con merma/conversión (post-deploy)
- [ ] Listo para revisión humana

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| El motor T5 cambia valores por orden de redondeo distinto al actual | High | Conservar `Math.round` por línea exactamente como hoy; Checkpoint B exige paridad sobre datos semilla antes de continuar |
| Tormenta de recálculos en recepciones masivas (muchas líneas a la vez) | Medium | Un evento por item (dedupe 24h por id de evento) + concurrencia limitada por tenant en la función Inngest; la recepción nunca espera al recálculo |
| Falta de conversión registrada para un par de unidades | Medium | Fallback = comportamiento actual + warning; nunca bloquear el costeo. T10 documenta en la respuesta qué líneas quedaron sin convertir |
| Inngest caído o sin keys en prod | Medium | Emisión fire-and-forget con try/catch en T8; el costo queda "viejo" (estado actual), nunca rompe recepción. Re-ejecutable con el script one-off |
| T9/T10 cambian costos de recetas existentes al recalcular | Medium | Defaults neutros (`yield_percent=100`, sin conversión ⇒ igual que hoy). Script one-off de recálculo post-deploy + aviso al usuario antes de correrlo |
| La guarda de borrado rompe flujos que asumen delete libre | Low | Solo bloquea con referencias reales (`salesEntries`, producción); mensaje 409 con conteo; recetas sin uso se borran igual |
| Vitest como dependencia nueva | Low | Q3: si no se quiere la dependencia, T14 se queda solo con Playwright E2E |

## Open Questions

- **Q1 (método de costeo):** el PUT hardcodea `'LAST_COST'`, pero `CostingService` ya tiene método configurable **por sucursal** y las recetas son de **empresa** (sin branch). ¿El costeo de recetas debe leer un default de empresa, o se deja `LAST_COST` fijo? (Recomendación: leer config de empresa con fallback `LAST_COST`.)
- **Q2 (alcance del trigger):** ¿el recálculo se dispara solo en `RECEIVING` de `registerMovement`, o también cuando `invoices/upload` (OCR) actualice costos? (Recomendación: ambos, mismo evento.)
- **Q3 (tests):** ¿introducir vitest para unit tests del motor (dependencia nueva) o cubrir solo con Playwright E2E?
- **Q4 (umbral):** ¿el 35% de food cost se vuelve configurable por empresa (T11) o se mantiene como constante?
- **Q5 (borrado):** ante recetas con historial, ¿bloqueo duro (409, recomendación) o soft-delete con flag `archivedAt`?

## Estimated total

14 tareas en 5 fases, 5 checkpoints. Tamaños XS–M (ninguna L). Fase 1 (T1–T4) son fixes críticos de bajo riesgo y alto valor inmediato; Fase 2 (T5–T6) es la inversión de arquitectura; Fases 3–4 añaden frescura y precisión sobre esa base; Fase 5 cierra con calidad. T5 y T6 paralelizables; T11 y T12 independientes entre sí una vez cerrada la Fase 3.
