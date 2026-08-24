# Implementation Plan — Reconexión del Módulo de Inventario

> Origen: investigación profunda del módulo (2026-08-23). El diagnóstico completo vive en esta
> conversación; los hallazgos se resumen como D1–D9 abajo.
>
> Alcance acordado con David: **todo (P0–P3)**. Entrada de ventas: **ambos** (smart-link de cierre
> + pantalla corporativa de carga masiva).

## Overview

El módulo de inventario no está roto: está **descerrajado**. Tiene ~126 archivos (30+ rutas API,
28 páginas, 8 servicios) pero el ciclo operacional que promete — vender → consumir teórico →
varianza → food cost → comprar — está abierto en su eslabón central: **las ventas entran a mano**,
el alcance por sucursal se resuelve con **tres mecanismos distintos**, y el reporte estrella
(varianza) es un stub. Este plan cierra el ciclo en cinco fases ordenadas por impacto.

## Relación con planes existentes (NO duplicar)

| Plan existente | Cubre | Relación |
|---|---|---|
| `tasks/plan-costo-promedio.md` (CP1–CP12) | **D3 completo**: stub de varianza, `average_cost` vacío, costeo al momento | Este plan **no toca** costeo. Fase 3 solo ejecuta/prepara ese plan |
| `tasks/plan-branch-scope-fail-closed.md` (T1–T9) | Mitad de **D2**: autorización fail-closed (`NONE ≠ ALL`) | Complementario: ese plan es seguridad; este es coherencia de contexto UI/API. Correrlos en cualquier orden; este plan asume sus helpers (`resolveBranchScope`) |
| `tasks/plan-conteo-produccion-merma*.md` | Conteo/producción/merma | T14 debe leerlo antes de empezar; si ya cubre workflow+conteo, T14 se cancela o reduce |
| `tasks/plan-recepcion-workflow-v3.md` | Recepción vía workflow | No se toca aquí |

## Hallazgos (resumen del diagnóstico)

| ID | Hallazgo | Severidad |
|---|---|---|
| D1 | Ventas solo entran a mano (`sales-entry` exige `session.user.branchId`); cero integración POS | 🔴 P0 |
| D2 | 3 mecanismos de sucursal: header `BranchScopeControl`, selects por página, `session.user.branchId`; `HighValueSkusSection` ignora sucursal; rollup "Todas" sin distribución | 🔴 P0 |
| D3 | `getVarianceReport()` stub (`variance: 0`); costeo valorizado al momento del cálculo | 🔴 P1 → cubierto por `plan-costo-promedio` |
| D4 | Páginas cáscara de 4 líneas: menu-engineering, intelligence, reports/executive | 🟠 P1 |
| D5 | Dos motores de sugerencia de compra paralelos (`SuggestedOrderService` vs `procurement-engine`) | 🟠 P2 |
| D6 | Alertas por cron cada 6h + N+1 en `StockAlertService.checkStockLevels` | 🟠 P2 |
| D7 | WhatsApp/workflows (el diferenciador) casi no tocan inventario | 🟠 P2 |
| D8 | Escrituras de movimientos fragmentadas por ruta; `recordMovement` sin llamadores claros | 🟡 P3 |
| D9 | 28 sub-secciones para ~6 trabajos reales | 🟡 transversal |

## Architecture Decisions

- **AD-1 — Un solo mecanismo de sucursal en inventario: el header.** `useBranch()`
  (`lib/branch-context.tsx`) es la fuente de verdad. Ninguna página de inventario define su propio
  `<select>` de sucursal ni lee `session.user.branchId` para decidir alcance; cuando el usuario es
  gerente fijado a una sucursal, el header viene preseleccionado y las páginas heredan.
  La autorización sigue siendo trabajo de `resolveBranchScope` (plan fail-closed); este plan solo
  unifica el *contexto de vista*.

- **AD-2 — El rollup "Todas" distribuye, no mezcla.** Cuando el scope es todas las sucursales, cada
  KPI y alerta muestra atribución por sucursal (top contribuyentes), porque la pregunta real de
  Mariana (dueña multi-sucursal) es *"¿cuál me sangra?"*, no un total mezclado.

- **AD-3 — Las ventas son un ingest, no un form.** Un servicio único (`SalesIngestService`) acepta
  filas normalizadas `{branchId, saleDate, recipeRef, quantitySold, totalRevenue?}` desde dos vías:
  pantalla corporativa (CSV con mapeo de columnas) y smart-link de cierre (archivo del POS).
  Ambas comparten parser, validación e idempotencia. `POST /api/inventory/sales-entry` (unitario)
  queda como caso degenerado de una fila.

- **AD-4 — Idempotencia por `(companyId, branchId, saleDate, recipeId)`.** Reimportar el mismo CSV
  del corte no duplica ventas ni consumo teórico. Se implementa con unique index + upsert antes de
  tocar `TheoreticalConsumptionService`.

- **AD-5 — Las páginas cáscara se ocultan, no se borran.** Menu-engineering, intelligence y
  executive-report salen de la navegación hasta tener contenido real. Borrarlas destruye rutas ya
  referenciadas; dejarlas visibles es la sensación de "desconexión".

- **AD-6 — Costeo histórico NO se implementa aquí.** Es exactamente el alcance de
  `plan-costo-promedio.md`. La Fase 3 de este plan solo ejecuta ese plan y conecta su salida
  (reporte de varianza) a la navegación del módulo.

## Task List

### Phase 1 — Scope de sucursal coherente (P0, D2)

- [ ] **Task 1**: Auditoría y contrato: inventariar cada página/ruta de `/dashboard/inventory` y
      `/api/inventory` que resuelve sucursal; documentar el mecanismo canónico (AD-1) en
      `docs/inventario-contrato-scope.md` con la tabla de infracciones
- [ ] **Task 2**: `HighValueSkusSection` respeta el scope — thread `activeBranchId` a
      `/api/inventory/high-value`; la ruta filtra por él
- [ ] **Task 3**: `stock-count` hereda el scope del header — preselecciona/lockea la sucursal cuando
      hay scope; el `<select>` propio desaparece cuando hay scope activo
- [ ] **Task 4**: `waste-client`/`waste-form` usan `useBranch()` en vez de
      `session.user.branchId` como mecanismo de resolución visible
- [ ] **Task 5**: Rollup "Todas" distribuye: `DashboardKpis` y `QuickAlerts` muestran top
      sucursales contribuyentes por KPI/alerta con atribución clicable

### ✅ Checkpoint 1: una sola forma de preguntar "¿de qué sucursal?"
- [ ] `npx tsc --noEmit` limpio
- [ ] Manual: con scope "Polanco", KPIs, conteo, merma y alto valor muestran Polanco; con "Todas",
      todo muestra atribución por sucursal
- [ ] Ningún componente bajo `app/dashboard/inventory` define su propio selector de sucursal

### Phase 2 — Ingesta de ventas (P0, D1)

- [ ] **Task 6**: `SalesIngestService` — parser CSV configurable (mapeo columnas → campos),
      resolución `recipeRef` por SKU/código/nombre, normalización de fechas a día local de
      sucursal (mismo criterio que `inventory-snapshot-service.ts`)
- [ ] **Task 7**: Idempotencia — unique index `(company_id, branch_id, sale_date, recipe_id)` en
      `sales_entries` + upsert; migración Drizzle generada con `pnpm db:generate`
- [ ] **Task 8**: API bulk `POST /api/inventory/sales-entry/bulk` — acepta `branchId` explícito con
      chequeo de permiso corporativo (no depende de `session.user.branchId`), devuelve resumen
      `{inserted, skipped, errors[]}`
- [ ] **Task 9**: Pantalla corporativa de carga masiva — upload CSV, selección de mapeo, preview de
      primeras N filas, resultado con errores accionables por fila
- [ ] **Task 10**: Smart-link de cierre POS — extender `upload-pos` para parsear el archivo vía
      `SalesIngestService` y crear `salesEntries`, no solo guardarlo en R2

### ✅ Checkpoint 2: el ciclo vende→consume funciona end-to-end
- [ ] Cargar un CSV dos veces produce el mismo conteo de `salesEntries` (idempotente)
- [ ] Registrar ventas dispara descuento teórico verificable en `inventoryMovements` (USAGE)
- [ ] `npx tsc --noEmit` limpio

### Phase 3 — Food cost real (P1, D3+D4)

- [ ] **Task 11**: Ejecutar `tasks/plan-costo-promedio.md` (CP1–CP12) — ver su propio todo list;
      aquí solo se registra como tarea-paraguas de fase
- [ ] **Task 12**: Conectar el reporte de varianza resultante a la navegación de inventario
      (entrada desde `costing/page.tsx` y desde reports)
- [ ] **Task 13**: Ocultar cáscaras — menu-engineering, intelligence y executive fuera de la nav
      (redirect o flag), con nota de retorno cuando tengan contenido

### ✅ Checkpoint 3: la promesa central responde
- [ ] Reporte de varianza devuelve números distintos de cero con datos sembrados
- [ ] Ninguna página navegable del módulo es una cáscara vacía
- [ ] Revisión con David antes de Phase 4

### Phase 4 — Coherencia operacional (P2, D5–D7)

- [ ] **Task 14**: Verificar solape con `plan-conteo-produccion-merma*`; si el wiring
      workflow+WhatsApp del conteo 80/20 no está cubierto ahí, implementarlo; si sí, cerrar como
      duplicado
- [ ] **Task 15**: Un motor de compras — `procurement-engine` consume
      `SuggestedOrderService.calculate()` en vez de recalcular; borrar la lógica espejo
- [ ] **Task 16**: Alertas en el momento — evaluar low-stock inline al registrar recepción/merma/
      ajuste de conteo (misma transacción o evento Inngest) además del cron; arreglar el N+1 de
      `checkStockLevels` con un join ítem+nivel

### ✅ Checkpoint 4: un cerebro por decisión
- [ ] Una sola fuente de sugerencias de compra (grep: ninguna lógica de sugerencia duplicada)
- [ ] Merma de un lote crítico genera alerta visible sin esperar el cron
- [ ] `npx tsc --noEmit` limpio

### Phase 5 — Integridad de escrituras (P3, D8)

- [ ] **Task 17**: Unificar descuentos de lotes — migrar waste/receiving/transfers/production a un
      único punto de escritura (`InventoryService.recordMovement` o su sucesor), preservando los
      casos especiales documentados (STAFF/COURTESY→USAGE, shortfalls de producción)
- [ ] **Task 18**: `unitCost` en `inventory_movements` (schema + write paths) — **solo después** de
      CP de `plan-costo-promedio`; habilita valorización histórica

### ✅ Checkpoint 5: completo
- [ ] Todas las escrituras de stock pasan por un solo servicio
- [ ] Specs e2e existentes (`tests/inventory-waste.spec.ts`) en verde
- [ ] Todos los criterios marcados

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cambiar resolución de sucursal rompe al ADMIN viendo "Todas" | Alto | Task 1 audita antes de mover nada; cada task conserva el comportamiento ALL |
| `pnpm db:push` puede dropear tablas al aplicar la unique index de T7 | Alto | Solo `db:generate` + revisar SQL de la migración; nunca `db:push` sin verificar contra `.env` |
| Parser CSV: cada POS mexicano exporta distinto | Medio | Empezar con formato genérico + mapeo manual de columnas; formatos específicos (SoftRestaurant etc.) como configs posteriores |
| T7 (índice único) falla si ya hay duplicados históricos | Medio | Query de diagnóstico antes de la migración; decidir política de dedup (keep latest) |
| Build falla por fuentes de Google en este entorno | Bajo | Puerta de tipos: `npx tsc --noEmit`; build en CI (patrón ya establecido en otros planes) |
| Fase 4 toca flujos cubiertos por otros planes en progreso | Medio | T14 verifica solape primero; coordinar con `plan-conteo-produccion-merma` |

## Open Questions

1. **¿Qué POS exportan tus clientes hoy?** (SoftRestaurant, Bistrosoft, punto de venta propio…)
   Define qué configs de mapeo valen la pena en T6/T9 vs dejar el mapeo manual genérico.
2. **¿La varianza se calcula solo sobre SKUs alto valor (80/20)?** El snapshot diario así lo hace;
   si el reporte de varianza hereda eso, el copy debe decirlo para no prometer precisión total.
3. **¿Las alertas inline (T16) van por misma-transacción o evento Inngest?** Misma transacción es
   más simple y consistente; Inngest desacopla pero añade latencia/eventual. Propongo
   misma-transacción para low-stock, cron para lo demás.
4. **¿Quién ejecuta `plan-costo-promedio`?** Si corre en paralelo en otra sesión, T11/T12 solo
   conectan; si no, esta fase es la más larga del plan.

## Parallelization Opportunities

- **Safe to parallelize:** Phase 1 tasks 2–5 (una vez T1 defina el contrato); Phase 2 tasks 6–7 vs 9
  (contrato definido por T6/T8 primero); Task 13 es independiente.
- **Must be sequential:** T7→T8→T9→T10; T17 antes de T18; toda la Fase 3 depende del estado del
  plan de costo promedio.
- **Needs coordination:** T14 con quien esté ejecutando `plan-conteo-produccion-merma`.
