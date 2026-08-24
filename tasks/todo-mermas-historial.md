# Todo: Mermas — Historial con detalle por registro

> Fuente: `tasks/plan-mermas-historial.md`. No tocar `tasks/todo.md` (plan de pruebas activo).

## Phase 1 — Historial visible

- [x] Task 1: Extender GET /api/inventory/waste — filtros, categoría, quien registró, resumen (`app/api/inventory/waste/route.ts`, `tests/inventory-waste.spec.ts`)
- [x] Task 2: Labels compartidos + WasteHistoryClient (tabla + resumen + filtros + CSV) (`lib/inventory/waste-labels.ts`, `waste-history-client.tsx`)
- [x] Task 3: Inversión de página (historial default / form en dialog) + Sheet de detalle (`page.tsx`, `waste-client.tsx`, `waste-detail-sheet.tsx`)

### Fixes de verificación (sesión siguiente al handoff)
- [x] **Bug real del GET**: `parseDateParam` con fechas sueltas `YYYY-MM-DD` parseaba como UTC y luego `setHours` anclaba a día LOCAL → en husos negativos `to=hoy` excluía la tarde. Ahora fecha suelta = día local.
- [x] **Bug del hook**: `useWasteHistory` devolvía el envelope `{success,data}` crudo; el cliente leía `data?.waste` → siempre vacío. Ahora desenvuelve `.data`.
- [x] Tests UI: cookie `pulso_selected_branch` en beforeEach (sin alcance la página muestra "Selecciona una Sucursal").
- [x] `deleteTestSkus` autónomo: borra filas dependientes (waste/movements/batches/alerts/counts/snapshots) de ítems tagged huérfanos de runs muertos.

## Checkpoint Phase 1
- [x] build + lint limpios · test:e2e verde (**14/14**, contra `next start`)
- [ ] Manual: historial → filtro motivo → detalle → registrar → aparece en lista

## Phase 2 — Evidencia fotográfica

- [x] Task 4: Migración `evidence_url` + guardar en `extractMermaFromInstance` + backfill script + foto en Sheet

## Checkpoint Phase 2
- [x] Migración sin drift (`0058_add-waste-evidence-url.sql`, una sola sentencia) · `pnpm db:migrate` en dev OK
- [x] Spec verde (`tests/merma-evidencia.spec.ts`): extractor guarda URL + backfill corrida 1 recupera fila pre-fix + corrida 2 "Nada que hacer" sin pisar no-null · regresión inventory-waste + extractor-idempotente 17/17

## Phase 3 — Conectar los puntos

- [ ] Task 5: KPI "Pérdida por Merma" clickeable → historial filtrado al mes/scope
- [ ] Task 6: Movimientos WASTE → link al historial pre-filtrado por ítem

## Checkpoint Complete
- [ ] Acceptance criteria completos · recorrido dashboard → KPI → historial → detalle → form
