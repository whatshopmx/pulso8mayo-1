# Implementation Plan: Mermas — Historial con detalle por registro

Source investigation: sesión 2026 (ver hallazgos abajo) · Complementa/supersede la parte no
implementada del "Phase 3 — Evidence and anulación" de `tasks/plan-inventory-waste.md`
(Tasks 10–12 de ese plan: history action, evidencia persistida, anulación endpoint).

## Hallazgos que motivan este plan

1. `/dashboard/inventory/waste` es SOLO formulario (`waste-client.tsx`): tarjetas estáticas
   + form. No existe ninguna vista del historial de mermas.
2. `GET /api/inventory/waste` ya devuelve historial con join a ítem y lote, scopeado por rol
   (`enforceBranchScope`), pero **nadie la consume** (solo `tests/inventory-waste.spec.ts`).
3. El dato rico existe en BD y es invisible: `origin` (`workflow_merma` |
   `diferencia_conteo` | `lote_insuficiente`), `workflowInstanceId`, `totalLoss`,
   `costPerUnit`, `notes`.
4. **Bug:** el template `registro-merma-v1.json` exige foto por SKU;
   `parseMermaSteps()` parsea `evidenceUrl` pero `extractMermaFromInstance()`
   (`lib/services/merma-from-workflow.ts`) **nunca la guarda** en `inventory_waste`. La
   evidencia NOM-251 obligatoria se descarta.
5. Lo poco visible es agregado: KPI "% Pérdida por Merma" con tooltip, tablas byReason/byItem
   en reportes operacionales (sin drill-down), líneas `WASTE:` en movimientos sin link.
6. `inventoryItems.category` existe pero no viene en ningún join de merma.
7. Receta/platillo: sin FK directa; solo derivable vía `productionResults.recipeId`
   (origin=`lote_insumiciente`) o `recipeItems` (qué platillos usan el insumo). Queda como
   backlog (Phase 4), no bloquea el valor principal.

## Overview

Convertir la página de mermas de "un INSERT con etiquetas" en dos acciones claras:
**Historial de Mermas** (default: tabla filtrable con resumen, detalle por fila en Sheet,
trazabilidad de origen y lote) y **Registrar Merma** (el formulario actual). De paso se
repara la fuga de evidencia fotográfica del extractor y se conectan los puntos donde hoy la
merma solo aparece como tooltip o agregado.

## Architecture Decisions

- **La página invierte su layout, no borra nada.** Historia arriba/default; el form actual
  queda intacto detrás de un botón/dialog. Riesgo cero para el flujo de captura que ya opera
  el personal (decisión análoga ya tomada en `plan-inventory-waste.md` §Product decisions #1).
- **Extender el GET existente, no crear ruta nueva.** `GET /api/inventory/waste` ya resuelve
  tenancy + branch scope correctamente (incluye el caso NONE → `[]`). Agregar filtros es
  incremental; una ruta paralela duplicaría la guardia de seguridad.
- **Resumen server-side, no client-side.** Con paginación, computar totales en el cliente
  da números que cambian al paginar. Un aggregate SQL extra devuelve `total`,
  `trueWasteLossCents` (excluye STAFF/COURTESY según OQ-1) y `byReason` estables.
- **Merma real vs consumo interno separados desde el historial**, mismo criterio que el
  reporte operacional (`inventory-reports-service.ts`: STAFF/COURTESY = consumo, no merma).
  Coherencia > sorpresa: el % de merma del dashboard no debe contradecir al historial.
- **Evidencia: columna `evidence_url text` en `inventory_waste`.** Una URL por fila es lo
  que el extractor produce (una foto por SKU); jsonb sería schema-less sin necesidad.
  Backfill desde `workflow_instance_steps` para instancias pasadas (los pasos siguen ahí).
- **Labels compartidos en un módulo único** (`lib/inventory/waste-labels.ts`): motivo y
  origen → texto ES + variante de Badge. Sirve a historial, detalle y futuros links desde
  movimientos/reportes; evita el drift motivo-form vs motivo-historial.
- **Rechazado: receta/platillo ahora.** Requiere decidir entre estampar `recipeId` (migración
  + tocar extractor de producción) o derivarlo en lectura (join costoso y ambiguo con
  sub-recetas). El valor principal (historial + trazabilidad origen/lote/evidencia) no lo
  necesita. Queda documentado como Phase 4/backlog con sus dos opciones.

## Task List

### Phase 1 — Historial visible (valor principal)

- [ ] **Task 1: Extender GET /api/inventory/waste — filtros, categoría, quién registró, resumen** (M)

  Añadir query params: `from`/`to` (ISO date sobre `recordedAt`), `reason`, `category`,
  `origin`, `q` (búsqueda case-insensitive sobre item name/sku), `limit` (default 50),
  `offset`. Join adicional a `inventoryItems.category` y a `users` (nombre de quien registró).
  Respuesta enriquecida: `{ waste, total, summary }` donde `summary = { count,
  trueWasteLossCents, totalLossCents, byReason: [{reason, entries, lossCents}] }` vía un
  aggregate SQL aparte con los mismos filtros. Los filtros pasan por la misma validación de
  scope que ya tiene la ruta (branch ajeno → 404; NONE → vacío).

  **Acceptance criteria:**
  - [ ] `?from=&to=` filtra por `recordedAt` inclusive en huso del servidor (fechas ISO)
  - [ ] `?reason=EXPIRED&origin=workflow_merma&category=CARNES` filtran exactamente
  - [ ] `?q=tomate` matchea name o sku del ítem, case-insensitive
  - [ ] `limit`/`offset` paganinan; `total` refleja el conteo CON filtros, sin límite
  - [ ] GERENTE de sucursal A pidiendo `branchId=B` sigue en 404 (regresión cubierta por specs existentes)
  - [ ] `summary.trueWasteLossCents` excluye STAFF/COURTESY; `totalLossCents` no

  **Verification:** extender `tests/inventory-waste.spec.ts` (o spec nuevo `waste-history-api`)
  con casos de filtro+paginación+summary · `pnpm run build`

  **Files:** `app/api/inventory/waste/route.ts`, `tests/inventory-waste.spec.ts`

- [ ] **Task 2: Labels compartidos + WasteHistoryClient (tabla + resumen + filtros)** (M)

  Nuevo `lib/inventory/waste-labels.ts`: mapas `REASON_LABELS` / `ORIGIN_LABELS`
  (texto ES + badge variant) y helper `isInternalConsumption(reason)`. Nuevo
  `app/dashboard/inventory/waste/waste-history-client.tsx` siguiendo el patrón de
  `movements-client.tsx` (filtros locales + fetch paginado): strip de resumen (registros,
  pérdida real, consumo interno, top motivo), tabla fecha | ítem (+SKU+categoría) |
  cantidad/unidad | motivo 🏷️ | origen 🏷️ | pérdida $ | lote | quien, filtros periodo/motivo/
  origen/categoría/búsqueda, export CSV con `useExportCsv`.

  **Acceptance criteria:**
  - [ ] La tabla renderiza registros reales con badges legibles (no enums crudos)
  - [ ] STAFF/COURTESY muestran badge distinto ("Consumo interno") y NO suman a pérdida real
  - [ ] Cambiar cualquier filtro resetea a página 0 y refetch
  - [ ] Estado vacío con CTA al formulario de registro
  - [ ] CSV exporta lo filtrado visible

  **Verification:** `pnpm run build` + revisión manual contra datos seed
  (`scripts/seed-demo-data.ts` si genera mermas)

  **Files:** `lib/inventory/waste-labels.ts`, `app/dashboard/inventory/waste/waste-history-client.tsx`

- [ ] **Task 3: Inversión de página + Sheet de detalle por registro** (M)

  `page.tsx` pasa a header con dos acciones: "Registrar Merma" (abre Dialog con el
  `WasteForm` actual, o toggle a vista form) e historial como contenido default. Nueva
  `WasteDetailSheet` (componente `sheet.tsx`): cantidad/costo/pérdida formateada MXN,
  motivo+origen, ítem completo, lote (lotNumber, caducidad), notas, link
  `/dashboard/workflows/{workflowInstanceId}` cuando `workflowInstanceId` no sea null, y
  slot para evidencia fotográfica (se activa con Task 4). Tras registrar merma con éxito,
  el historial se refresca (mismo `refreshKey`/refetch pattern actual).

  **Acceptance criteria:**
  - [ ] Landing muestra historial; el form es accesible en ≤2 clicks y funciona igual que hoy
  - [ ] Click en fila abre Sheet con todos los campos del registro, incluidos notes y lote
  - [ ] Registro con `workflowInstanceId` muestra link funcional al detalle del workflow
  - [ ] Registrar una merma desde el dialog refresca el historial sin recargar la página

  **Verification:** `pnpm run build` · manual: registrar→ver aparecer en historial→abrir detalle

  **Files:** `app/dashboard/inventory/waste/page.tsx`, `waste-client.tsx` (refactor a dialog),
  nuevo `waste-detail-sheet.tsx`

### Checkpoint: Phase 1
- [ ] `pnpm run build` + `pnpm run lint` limpios
- [ ] `pnpm test:e2e` verde (specs existentes de waste no rotos)
- [ ] Flujo manual E2E: entrar a /dashboard/inventory/waste → ver historial → filtrar por
      motivo → abrir detalle → registrar nueva → verla en la lista

### Phase 2 — Evidencia fotográfica (bug fix)

- [ ] **Task 4: Persistir evidenceUrl en el extractor + backfill** (M)

  Migración Drizzle: columna nullable `evidence_url text` en `inventory_waste`
  (`pnpm db:generate`; verificar drift con `scripts/check-migration-drift.ts` antes/después).
  `extractMermaFromInstance()` guarda `evidenceUrl ?? null` en cada fila (el dato ya viene
  parseado en `ParsedMerma`). Script idempotente `scripts/backfill-waste-evidence.ts`:
  para rows con `origin='workflow_merma'` y `evidence_url IS NULL`, re-parsear
  `workflow_instance_steps` con `parseMermaSteps` y actualizar. `WasteDetailSheet` muestra
  la imagen (thumbnail → click abre full) cuando existe; oculto si no.

  **Acceptance criteria:**
  - [ ] Merma nueva via workflow guarda la URL de la foto del paso `merma-evidence-{itemId}`
  - [ ] Backfill corre 2 veces sin duplicar ni sobreescribir valores no-null
  - [ ] Formulario manual (sin workflow) deja la columna NULL sin errores
  - [ ] Sheet muestra la foto cuando existe

  **Verification:** extender spec del extractor (patrón `tests/merma-automatica.spec.ts`) ·
  backfill contra dev DB · `pnpm run build`

  **Files:** migración generada, `lib/db/schema.ts`, `lib/services/merma-from-workflow.ts`,
  `scripts/backfill-waste-evidence.ts`, `waste-detail-sheet.tsx`

### Checkpoint: Phase 2
- [ ] Migración aplicada sin drift; `pnpm db:migrate` en dev OK
- [ ] Spec del extractor verde; build limpio

### Phase 3 — Conectar los puntos (tooltips → detalle)

- [ ] **Task 5: KPI "Pérdida por Merma" clickeable → historial del mes** (S)

  En `components/inventory/dashboard-kpis.tsx`, la MetricCard de merma envuelve su contenido
  en Link a `/dashboard/inventory/waste?from=<inicio de mes>&to=<hoy>` (+ `branchId` cuando
  hay scope activo). `waste-history-client.tsx` inicializa filtros desde `useSearchParams`.

  **Acceptance criteria:**
  - [ ] Click en el KPI abre el historial ya filtrado al mes en curso y al scope del header
  - [ ] Deep-link directo con query params produce los mismos filtros (compartible)

  **Files:** `dashboard-kpis.tsx`, `waste-history-client.tsx`

- [ ] **Task 6: Movimientos WASTE → link al registro de merma** (S)

  En `movements-client.tsx`, las filas tipo WASTE ganan acción "Ver merma" que navega a
  `/dashboard/inventory/waste?q={itemName}&from=-30d` (búsqueda por ítem es suficiente y no
  requiere nuevo endpoint de lookup movement→waste-id).

  **Acceptance criteria:**
  - [ ] Filas WASTE abren el historial pre-filtrado al ítem
  - [ ] Filas USAGE/RECEIVING no cambian

  **Files:** `app/dashboard/inventory/movements/movements-client.tsx`

### Checkpoint: Complete
- [ ] Todos los acceptance criteria marcados · build/lint/E2E verdes
- [ ] Recorrido manual: dashboard → KPI → historial → detalle → (foto si aplica) → form

### Phase 4 — Backlog (explícitamente fuera de este plan)
- Trazabilidad receta/platillo: (a) estampar `recipe_id` nullable en `inventory_waste`
  resolviendo vía `production_results.workflowInstanceId` en el extractor de
  `lote_insuficiente`, o (b) vista derivada con `recipeItems` ("esta merma impacta estos
  platillos"). Decidir con datos de uso del historial.
- Anulación con restauración de stock (Tasks 12 del plan anterior; requiere política de
  conflictos con lotes que ya se movieron).
- Umbral de foto obligatoria por monto (decisión ya tomada en el plan anterior, nunca
  implementada).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `numeric` llega como string y `strict:false` lo calla (suma `"5"+"3"`) | High — resumen mentiroso | Task 1 mapea `quantity: Number(...)` como ya hace la ruta; summary se computa en SQL, no en JS |
| Filtros nuevos abren hueco de scope (branch de otro tenant vía query param) | High — fuga cross-tenant | Reusar la guardia existente tal cual; specs existentes de 404 deben seguir verdes |
| Migración con drift de journal (problema recurrente en este repo) | Medium | `check-migration-drift.ts` antes y después de `db:push/generate` |
| Inversión de página rompe el flujo de captura rápido en tablet | Medium | El form no se reescribe: mismo componente en dialog/toggle; spec e2e de captura debe pasar sin cambios |
| Backfill pisa evidencias futuras | Low | Solo UPDATE where `evidence_url IS NULL`; idempotente por diseño |
| KPI clickeable rompe el tooltip/hover existente | Low | Link envuelve la card, tooltip queda dentro; verificación visual |

## Parallelization

- **Secuencial:** Task 1 → 2 → 3 (contrato API primero, luego UI, luego integración página).
- **Paralelizable tras Task 1:** Task 4 (toca extractor+migración, archivos distintos a UI).
- **Tasks 5–6** independientes entre sí, después de Task 2 (necesitan deep-links que funcione).

## Open Questions

Ninguna bloqueante. Resueltas por el humano (2026): "Registrar Merma" como **dialog** y
filtro default del historial = **mes en curso** (alineado con el KPI mensual).
