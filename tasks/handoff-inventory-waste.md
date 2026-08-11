# Handoff — Registro de Mermas (plan-inventory-waste)

**Fecha:** 2026-08-11 · **Plan:** `tasks/plan-inventory-waste.md` · **TODO:** `tasks/todo-inventory-waste.md`
**Crítica fuente:** `.impeccable/critique/2026-08-11T17-12-38Z__app-dashboard-inventory-waste.md`

Regla estricta del plan: **nada de la Fase 2 en adelante arranca antes de que pase el Checkpoint 0.**

---

## 1. Estado global

| Fase | Tarea | Estado |
|---|---|---|
| 0 | **T1** Migrar columnas a `numeric(12,4)` | ✅ Commiteado `df764fd` |
| 0 | **T2** Barrer rutas de escritura + marcadores AD-6 | ✅ Commiteado `0989fec` |
| 0 | **T3** Barrer agregaciones | ✅ Commiteado `72362e5` |
| 0 | **T4** Barrer lecturas API/UI | 🔶 **EN CURSO** — 2 archivos editados, SIN commit |
| 0 | **Checkpoint 0** (build + e2e + round-trip) | ⛔ Pendiente |
| 1 | T5–T6 (waste route tenancy + input fraccionario) | Pendiente |
| 2–6 | T7–T21 | Pendientes (requieren Checkpoint 0) |

**Working tree ahora mismo:** solo `app/api/inventory/batches/route.ts` y `app/api/inventory/expirations/route.ts` modificados (fix `gte(currentQuantity, '0')`). `tsc --noEmit`: **LIMPIO (0 errores)**.

**Atención:** otro stream (workflow-review-bitacora, migración 0050) se commiteó en paralelo como `5d345f3` a mitad de sesión. Antes de cada commit, re-chequear `git status` por trabajo ajeno entrelazado.

---

## 2. Lo ya implementado (resumen por commit)

### `df764fd` — T1: migración a `numeric(12,4)`
- **4 columnas en 3 tablas** (scope deliberado del plan):
  - `inventory_waste.quantity`
  - `inventory_movements.quantity_change`
  - `inventory_batches.initial_quantity` + `current_quantity` *(la crítica la omitía; sin esto una merma fraccionaria redondea el stock restante)*
- Migración `drizzle/0051_merma-decimal-quantities.sql` **mano-nombrada**, con `USING <col>::numeric` y cabecera con la reversión en papel. Aplicada (id 53 en `drizzle.__drizzle_migrations`).
- Comentario en schema (`lib/db/schema.ts`, sobre `inventoryBatches`) registra la respuesta a la pregunta abierta del plan: **drizzle-orm 0.45.2 tipa `numeric` como `string`** (`PgNumericBuilder` → `dataType: 'string'`; `mode: 'number'` existe pero el repo no lo usa, verificado en node_modules). Toda lectura se coacciona con `Number()`, toda escritura con `String()`.
- Verificado: `db:generate` sin drift ("No schema changes"), `db:migrate` limpio, filas existentes sobreviven como `N.0000` (8 waste / 104 movimientos / 76 lotes), `check-migration-drift.ts` limpio.

### `0989fec` — T2: rutas de escritura decimal-safe
- Coerción `String()` en la frontera DB: `inventory-service.ts` (7 sitios), `receiving-service.ts`, `app/actions/inventory-transactions.ts`, `theoretical-consumption-service.ts` (dummy batch).
- **Marcadores AD-6 removidos** (la fracción se conserva): `merma-from-workflow.ts`, `stock-count-from-workflow.ts`, `production-from-workflow.ts` (waste), `stock-count-service.applyStockCountAdjustments` (varianza fraccionaria se aplica íntegra).
- `app/api/inventory/waste/route.ts`: solo coerción mecánica (`Number()`/`String()`) para mantener el build — **la T5 la reescribe entera** (tenancy, envelope, decimal-safe).
- Round-trip probado contra DB real (script temporal, ya borrado): lote 2.5 − 0.4 → `2.1000`; merma 0.4 → `0.4000`; `sum()` SQL → `-0.4000` (string).

### `72362e5` — T3: agregaciones
- Postgres devuelve numeric sums como **string**: los sitios que operaban con el valor crudo **concatenaban** (`"5"+"3"="53"`) o producían NaN. Coerción `Number()` en la frontera de consumo:
  - `knowledge-service.ts` (8 sitios): el más crítico — `dailyTotals.reduce((a,b)=>a+b,0)` con strings → NaN en el knowledge graph (bug pre-existente, ahora corregido); `eq(currentQuantity,'0')`.
  - `executive-report-service.ts` (3): `calcRevenue/EndStockValue/WasteTotal` devolvían string → concat en `totalConsumed` → shrinkage % corrupto.
  - `stock-alert-service.ts`: **`parseInt(stock.currentStock)` trunca 2.5→2 → alerta de stock bajo FALSA**; ahora `Number()`.
  - `operational-twin-engine`, `kpi-calculator`, `suggested-order-service`, `advanced-alert-service`, `app/api/reports/generate/route.ts`.
- Ya coercionaban bien (solo verificado): `food-cost-service.ts` (`pick()` con `Number()`), `cross-branch-service`, `predictive-scoring-service`, `period-service`.
- Verificado: `getFoodCostByBranch` real → números, sin NaN, 3 sucursales.

---

## 3. Decisiones y desviaciones del plan (leer antes de continuar)

1. **`production_ingredients.actual_quantity` NO se migró.** El plan lista `production-from-workflow.ts:216/222` como marcador AD-6 a remover, pero la columna destino sigue `integer` (el scope de T1 fue deliberadamente 4 columnas). Resolución: el `Math.round` se **quitó del extractor** (el descuento del lote —columna migrada— ahora es exacto) y el redondeo **explícito** se movió al insert en `production-service.ts` (~línea 143), con comentario. Si se quiere producción 100% decimal, es una **migración nueva (0052+)** con su propio barrido de lecturas/escrituras de producción — NO hacerlo dentro de este plan sin decisión.
2. **El plan menciona `tests/stock-count.spec.ts`, que no existe.** Los specs reales: `tests/merma-automatica.spec.ts`, `merma-manual.spec.ts`, `conteo-alto-valor.spec.ts`, `conteo-dinamico.spec.ts`, `lote-insuficiente.spec.ts`, etc.
3. **T2 fue 9 archivos, no 8** (se agregó `production-service.ts`, justificado por la desviación 1).
4. **`totalLoss` (cents, integer) se mantiene redondeado a centavo** — es correcto, no es un marcador AD-6.
5. `api/analytics/trends` hace `cast(sum(...) as integer)` en SQL → ya devuelve number por diseño; no tocar salvo que se quiera tendencia fraccionaria.

---

## 4. T4 restante — lista exacta de sitios (sin empezar)

Los 2 fixes de rutas ya hechos (`'0'` en `gte` de batches/expirations). Falta:

1. **`app/api/inventory/movements/route.ts:66`** — `quantityChange: Number(inventoryMovements.quantityChange)` (hoy devuelve `"5.0000"` en JSON).
2. **`app/api/analytics/inventory/activity/route.ts:37` y `:67`** — `Number(...)` (idem; alimenta `inventory-activity-feed`).
3. **`lib/services/inventory-service.ts` `getStockLevel` (~:263)** — `return Number(result[0]?.total || 0)` (hoy string; alimenta `totalStock` de stock-manager). `getMovements` (:266) devuelve filas crudas → el consumidor formatea.
4. **Crear `formatQty` en `lib/utils.ts`** (no existe ninguno): `parseFloat(n.toFixed(4))` en string — `"2.5000"→"2.5"`, `"10.0000"→"10"`, `"-0.4000"→"-0.4"`, nunca `"5.0000"`.
5. **`components/inventory/stock-manager.tsx:125, 176, 221-222`** — render con `formatQty` (`{b.currentQuantity}`, `{batch.currentQuantity}`, `{mov.quantityChange}`).
6. **`components/dashboard/operations/inventory-activity-feed.tsx:72-73`** — `formatQty(m.quantityChange)`; nota: la interfaz declara `quantityChange: number` (mentira hoy — con el fix de API #2 se vuelve verdad).
7. **`app/dashboard/inventory/movements/movements-client.tsx:81-82, 207-208`** — CSV (`String(m.quantityChange)`) y render `{m.quantityChange}`.
8. **`hooks/queries/use-inventory.ts` `useMovements`** — verificar que el tipo fluye del API (con el fix #1 queda bien; el hook es query genérica).
9. Commit T4 → **Checkpoint 0**.

*`app/dashboard/inventory/[id]/page.tsx` pasa `batches`/`movements` de `InventoryService` (strings) a StockManager — los formatQty del punto 5 cubren la UI; si se prefiere limpiar en la API/servicio, es equivalente.*

---

## 5. Checkpoint 0 — la puerta (después de commitear T4)

- [ ] `pnpm run build` limpio — ⚠️ **tarda 7+ min con Turbopack** (compila ~6.5 min + type-check). Usar `tsc --noEmit` (2.5 min) como gate por slice; `next build` solo aquí. El primer intento con `timeout 300`/`700` se mató; dar ≥900s.
- [ ] `pnpm test:e2e` — el `webServer` de Playwright usa `npm run dev` por defecto; el plan exige contra **build** (`PLAYWRIGHT_WEB_SERVER_CMD='npm run build && npm start'` o similar) porque `next dev` y `next start` comparten `.next`.
- [ ] Round-trip fraccionario por **ambas puertas** (workflow y form): 0.5 kg → `0.5000` en todo el camino.
- [ ] Merma % y food-cost **idénticos a pre-migración** sobre datos enteros históricos.
- [ ] **Revisión humana** — es la parte irreversible.

---

## 6. Fase 1 en adelante (resumen para no releer el plan)

- **T5** — Reescribir `app/api/inventory/waste/route.ts`: `withTenantAuth`, `branchId` por `enforceBranchScope`, lookup de lote **scopeado al tenant** (hoy filtra solo por id — fuga cross-tenant, `:105`), envelope `{success, data|error}` vía `ApiHandler`, matemática decimal-safe, error estable para la forma. + nuevo `tests/inventory-waste.spec.ts`.
- **T6** — Input fraccionario (`step="0.001"`, `inputMode="decimal"`, quitar `min="1"`), zod `.positive()` + `.max(maxQuantity)` antes del diálogo destructivo, `aria-describedby`, `humanizeWasteError` con códigos.
- **Checkpoint 1**: 0.5 kg end-to-end.
- **Fase 2 (T7–9)**: botón muerto `Cancelar`→`Limpiar`; matar `key={refreshKey}` (remount) + TanStack Query para catálogo; flujo "Guardar y registrar otra" + tira "Registradas hoy".
- **Fase 3 (T10–12)**: migración `0052_merma-evidencia-anulacion.sql` (evidence_url/voided_* en waste, `merma_photo_required_above_cents` en tenant_operating_config — precedente `mermaVarianceThresholdPct`); persistir `evidenceUrl` en `merma-from-workflow.ts` (hoy lo parsea y lo tira); endpoint `POST /api/inventory/waste/[id]/void` en transacción (repo usa driver WS `neon-serverless` justamente por eso), `requireRoleApi`, nunca borra, excluir anuladas de agregaciones, `AuditService`.
- **Fase 4 (T13–15, 21)**: columna única, `waste-reasons.ts` compartido (inverso de `REASON_MAP` — mover desde `merma-from-workflow.ts:39`, sin migrar el enum), tokens `bg-warning/...`, honestidad de audiencia + reciprocidad (T21, **enviar completa, nunca la línea de copy sola**).
- **Fase 5 (T16–17)**: `Intl.NumberFormat('es-MX')`, deep-link `?item={id}`, `lot-selector.tsx`.
- **Fase 6 (T18–20)**: pestaña "Por vencer" + batch submit en una transacción reusando la validación de T5.

---

## 7. Gotchas operativos

- **NUNCA `pnpm db:push`** — dropea tablas. Solo `db:generate` + `db:migrate`.
- `pnpm db:generate` con `--name foo` produce `005X_foo.sql` + snapshot + journal. Re-ejecutarlo sin nombre debe decir "No schema changes" — eso confirma cero drift.
- El 0051 se aplicó a la DB real de desarrollo; la migración 0050 del otro stream ya estaba aplicada (id 52).
- Scripts temporales: créalos en `scripts/tmp-*.ts` con `import "dotenv/config"` **primero** (lib/db lee `process.env.DATABASE_URL` en evaluación de módulo) y bórralos al terminar.
- Para tocar la DB desde scripts: `pg` + `connectionString` (ver `scripts/check-migration-drift.ts`).
- El build en background con `nohup ... &` **muere al cerrar la sesión bash** — correr en foreground con timeout largo.
- `lib/db` usa el driver WS `neon-serverless` (no HTTP) — `db.transaction` disponible; los specs E2E comparten la DB real con tag `[E2E]` y limpian vía `tests/support/db.ts`.
- El otro stream (workflow-review) tocó `lib/services/stock-count-service.ts` y `tests/support/db.ts` — al editar esos archivos, revisar `git diff` por cambios ajenos no commiteados.
