# Handoff — Mermas: Historial con detalle por registro (plan-mermas-historial)

**Actualizado:** sesión 2026-02 (Task 1–3 implementadas, verificación pendiente) · **Plan:** `tasks/plan-mermas-historial.md` · **TODO:** `tasks/todo-mermas-historial.md`

> ⚠️ No confundir con `tasks/handoff-inventory-waste.md` (plan anterior de UX del
> formulario, cuyo Phase 3 nunca aterrizó — este plan retoma su "history action").
> Tampoco tocar `tasks/plan.md` / `tasks/todo.md`: pertenecen al plan activo de
> estrategia de pruebas (esas modificaciones en `git status` NO son de esta sesión:
> `package.json`, `pnpm-lock.yaml`, `tests/api/`, `vitest.config.ts`).

---

## 1. El plan en 60 segundos

`/dashboard/inventory/waste` era SOLO un formulario: cero visibilidad del historial.
El hallazgo clave: **el backend ya existía y estaba huérfano** — `GET /api/inventory/waste`
devolvía historial con join a ítem/lote y scope por rol, pero ningún componente lo
consumía (solo tests). Además, dato rico invisible en BD (`origin`,
`workflowInstanceId`, `totalLoss`) y un bug real: el template de merma por workflow
**exige foto por SKU pero `extractMermaFromInstance()` descartaba la URL de evidencia**
(NOM-251).

Solución: página invertida a dos acciones — **Historial de Mermas** (default, con
resumen server-side, filtros, detalle en Sheet) + **Registrar Merma** (mismo form,
en dialog). Decisiones del humano: dialog ✓ y filtro default = mes en curso ✓.

## 2. Estado de implementación

| Task | Alcance | Estado |
|---|---|---|
| 1 · GET con filtros/resumen | API | ✅ código listo · ⏳ verificar build+E2E |
| 2 · Labels + WasteHistoryClient | UI | ✅ código listo · ⏳ verificar build+E2E |
| 3 · Inversión de página + Sheet | UI | ✅ código listo · ⏳ verificar build+E2E |
| 4 · Evidencia fotográfica (migración+extractor+backfill) | BD/servicio | ❌ no iniciado |
| 5 · KPI clickeable → historial | UI | ❌ no iniciado |
| 6 · Movimientos WASTE → link | UI | ❌ no iniciado |

### Archivos tocados (los de ESTA sesión)

```
M  app/api/inventory/waste/route.ts          ← Task 1 (GET reescrito)
D  app/dashboard/inventory/waste/waste-client.tsx      ← eliminado (era form+tayetas)
M  app/dashboard/inventory/waste/page.tsx              ← Task 3 (inversión)
?? app/dashboard/inventory/waste/waste-history-client.tsx   ← Task 2
?? app/dashboard/inventory/waste/waste-detail-sheet.tsx     ← Task 2/3
?? app/dashboard/inventory/waste/registrar-merma-dialog.tsx ← Task 3
?? lib/inventory/waste-labels.ts                            ← Task 2
M  hooks/queries/use-inventory.ts              ← useWasteHistory (Task 2)
M  hooks/queries/index.ts                      ← re-export
M  tests/inventory-waste.spec.ts               ← T5/T6 adaptados al dialog + 7 tests nuevos
?? tasks/plan-mermas-historial.md, tasks/todo-mermas-historial.md
```

## 3. Contratos y decisiones que el próximo agente debe respetar

1. **Forma del GET**: `{ waste, total, limit, offset, summary }` donde
   `summary = { count, trueWasteLossCents, totalLossCents, byReason[] }`.
   `trueWasteLossCents` excluye STAFF/COURTESY (criterio OQ-1, igual que
   `inventory-reports-service`). Los totales se computan en SQL con los MISMOS
   filtros que la lista → no cambian al paginar. La rama `NONE` de scope también
   devuelve esta forma (no `{ waste: [] }` pelado).
2. **Filtros**: `from`/`to` (YYYY-MM-DD; `to` inclusivo vía `setHours(23,59,59,999)`,
   convenio de `/api/inventory/movements`), `reason` (enum validado, inválido→400),
   `category`, `q` (ILIKE name/sku), `limit` (default 50, máx 200), `offset`.
   **`origin=manual` significa `IS NULL`** (sentinel acordado API↔UI; los otros
   valores son los literales de los extractores: `workflow_merma`,
   `diferencia_conteo`, `lote_insuficiente`).
3. **Labels centralizados** en `lib/inventory/waste-labels.ts`. La variante de badge
   se deriva con `VariantProps<typeof badgeVariants>` — **NO existe `BadgeProps`
   exportado** en `components/ui/badge.tsx` (el primer build falló por eso).
4. **Dialog sin `useEffect`**: el auto-open por deep-link (`?item=X` o `?registrar=1`)
   usa estado derivado (`(wantsDeepLink && !deepLinkDismissed) || userOpen`). El linter
   `react-hooks/set-state-in-effect` rechaza setState síncrono en effects.
5. **Ambigüedad de botones**: con el dialog abierto hay DOS botones "Registrar
   Merma" (header trigger + submit del form). En tests, scoper con
   `page.getByRole("dialog").getByRole("button", ...)`.
6. El form (`components/inventory/waste-form.tsx`) **no se tocó** — mismo componente
   dentro del dialog, flujo de captura intacto (decisión del plan).

## 4. Verificación pendiente (HACER PRIMERO en la nueva sesión)

```bash
pnpm run build          # ← estaba corriendo al cortar la sesión (fase TypeScript);
                        #    el compile pasó ✓ (12.5min), falta el resultado final
pnpm test:e2e -- tests/inventory-waste.spec.ts   # suite completa si hay tiempo
pnpm run lint           # ya pasó limpio en archivos nuevos (warning pre-existente E2E_TAG)
```

Checks manuales rápidos (con `pnpm run dev`):
- `/dashboard/inventory/waste` muestra historial del mes en curso con resumen
- Click en fila abre Sheet con notas/lote/origen; manual → sin link a workflow
- Botón "Registrar Merma" abre dialog; al guardar, la fila aparece sin reload
- Filtros: motivo/origen/categoría/búsqueda resetean a página 0

Si algo falla, los sospechosos por orden: (a) tipos del GET (`sql<number>` vs string
de pg — ya se hace `Number()`), (b) el `Select` de shadcn dentro del toolbar,
(c) roles ARIA del Sheet vs Dialog en tests.

## 5. Próximos pasos sugeridos (orden)

1. **Cerrar Checkpoint Phase 1** (verificación de arriba) y marcar Tasks 1–3 en
   `tasks/todo-mermas-historial.md`.
2. **Task 4 — Evidencia fotográfica** (bug fix NOM-251, valor alto e independiente):
   - Migración: columna nullable `evidence_url text` en `inventory_waste`
     (`pnpm db:generate`; pasar `scripts/check-migration-drift.ts` antes/después).
   - `lib/services/merma-from-workflow.ts`: guardar `evidenceUrl ?? null` en las rows
     (ya viene parseado en `ParsedMerma`, hoy se descarta ~línea 200).
   - Backfill idempotente `scripts/backfill-waste-evidence.ts`: para rows con
     `origin='workflow_merma'` y `evidence_url IS NULL`, re-parsear
     `workflow_instance_steps` con `parseMermaSteps` y UPDATE solo si sigue NULL.
   - UI ya está lista: `waste-detail-sheet.tsx` renderiza la foto si `evidenceUrl`
     llega, y muestra nota "sin evidencia guardada" para workflows viejos.
   - Test: patrón de `tests/merma-automatica.spec.ts` + caso del backfill ×2.
3. **Tasks 5–6** (paralelizables): KPI "Pérdida por Merma" en
   `components/inventory/dashboard-kpis.tsx` → Link a
   `/dashboard/inventory/waste?from=<inicioDeMes>&to=<hoy>`; filas WASTE en
   `movements-client.tsx` → `/dashboard/inventory/waste?q={itemName}`. El historial
   YA inicializa desde la URL? **No** — hoy ignora query params de filtros: agregar
   `useSearchParams` como estado inicial en `waste-history-client.tsx` es prerrequisito
   de ambas tasks.
4. **Checkpoint Complete** → recorrido dashboard → KPI → historial → detalle → alta.

## 6. Riesgos vivos

- **Build largo**: ~13–16 min solo compilando; no matar el proceso por impaciencia.
- Playwright corre contra la DB dev compartida, workers=1, serial. Los asserts de
  summary/paginación usan **deltas** contra lectura previa para tolerar datos ajenos;
  mantener ese patrón en tests nuevos.
- `numeric` llega como string desde pg y `strict:false` no lo calla: todo número que
  cruce la frontera API pasa por `Number()` explícito (ya así en route.ts).
- Si se toca `inventoryWaste.origin` en el futuro, recordar el sentinel `manual`.

## 7. Mapa rápido

| Quiero… | Archivo |
|---|---|
| Cambiar filtros/columnas del historial | `app/dashboard/inventory/waste/waste-history-client.tsx` |
| Cambiar el detalle de fila | `app/dashboard/inventory/waste/waste-detail-sheet.tsx` |
| Cambiar labels de motivo/origen | `lib/inventory/waste-labels.ts` |
| Cambiar el contrato del GET | `app/api/inventory/waste/route.ts` (GET) |
| Hook de datos | `hooks/queries/use-inventory.ts` → `useWasteHistory` |
| Formulario de alta | `components/inventory/waste-form.tsx` (intacto) |
| Tests | `tests/inventory-waste.spec.ts` (describes T5, T6, "Task 1", "Task 2-3") |
