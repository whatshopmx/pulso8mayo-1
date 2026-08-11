# Handoff — Registro de Mermas (plan-inventory-waste)

**Actualizado:** 2026-08-11 (sesión 2, tras Checkpoint 0) · **Plan:** `tasks/plan-inventory-waste.md` · **TODO:** `tasks/todo-inventory-waste.md`
**Crítica fuente:** `.impeccable/critique/2026-08-11T17-12-38Z__app-dashboard-inventory-waste.md` (18/40)

Regla estricta del plan: **nada de la Fase 2 en adelante arranca antes de que pase el Checkpoint 0.**
La revisión humana del Checkpoint 0 es la parte irreversible — recomendable ANTES de la Fase 1 (T5/T6), aunque literalmente la regla solo bloquea la Fase 2+.

---

## 1. El plan en 60 segundos

Dos clases de problema en `app/dashboard/inventory/waste/`: un **defecto de integridad de datos** (cantidades integer-only en una cocina de kg/L → todo número aguas abajo sale mal) y un **déficit de UX** (la página sirve para 1 entrada cuidadosa; la realidad es 4–8 por cierre de turno en tablet).

**Decisiones de producto (todas resueltas):**
1. Inversión **aditiva**: pestaña `Por vencer` convive con el form en blanco (derrame/rotura). Fase 6.
2. Foto **obligatoria por monto o motivo** ($500 configurable o `DAMAGED`/`QUALITY`); opcional en el resto. Fase 3.
3. Vocabulario de cocina, **enum SIN migrar**; un módulo compartido sirve ambas puertas. Fase 4.
4. Deshacer = **solo anulación** por gerente desde el historial; **no** undo de 30s en captura. Fase 3.
5. Audiencia dicha con verdad + reciprocidad: la dirección del grupo compara sucursales (`food-cost-service.ts:163-168`); el formulario lo dice, el gerente recibe su propio número vs meta, los reportes separan evitable/estructural. T21, Fase 4.

**Decisiones de arquitectura (bloqueantes):**
- `numeric(12,4)` siguiendo precedente existente (`stockCounts.countedQuantity` :3083, AD-6 :3128). **4 columnas en 3 tablas**: `inventory_waste.quantity`, `inventory_movements.quantity_change`, `inventory_batches.initial_quantity` + `current_quantity` *(la crítica omitía batches; sin eso una merma fraccionaria redondea el stock restante)*.
- **Drizzle 0.45.2 tipa `numeric` como `string`** (verificado en node_modules; `mode: 'number'` existe pero el repo no lo usa). Lectura → `Number()`, escritura → `String()`. Comentado en `lib/db/schema.ts` sobre `inventoryBatches`.
- Rechazada la alternativa de enteros escalados (milliunits) — consistencia con el precedente.

**Grafo de dependencias:**

```
Phase 0  Schema migration (numeric) ── sweeps: writes │ aggregations │ reads
             └── Checkpoint 0: numbers still correct        ← HOY AQUÍ (falta revisión humana)
Phase 1      └── Waste API (decimal + tenancy) ── Form fractional input   ← P0 closed
Phase 2           └── Trust: dead button │ remount │ receipt
Phase 3                └── Evidence migration ── photo capture
                                             └── anulación endpoint + history action
Phase 4                     └── Layout distill ── shared vocabulary ── tokens
Phase 5                          └── Polish: formatting/a11y │ deep-link + lot-selector
Phase 6                               └── "Por vencer": data ── checklist UI ── batch submit
```

---

## 2. Estado global

| Fase | Tarea | Estado |
|---|---|---|
| 0 | **T1** Migrar columnas a `numeric(12,4)` | ✅ `df764fd` |
| 0 | **T2** Barrer rutas de escritura + marcadores AD-6 | ✅ `0989fec` |
| 0 | **T3** Barrer agregaciones | ✅ `72362e5` |
| 0 | **T4** Barrer lecturas API/UI | ✅ `7a33da6` |
| 0 | **Checkpoint 0** (build + e2e + round-trip) | 🔶 Parcial — todo verde; **pendiente revisión humana** |
| 1 | **T5** Waste route (tenancy + decimal-safe) | Pendiente — deps: 1 |
| 1 | **T6** Input fraccionario validado pre-diálogo | Pendiente — deps: 1, 5 |
| 2 | **T7** Quitar `Cancelar` muerto | Pendiente — sin deps (paralelizable) |
| 2 | **T8** Matar remount + cache catálogo | Pendiente — sin deps (paralelizable) |
| 2 | **T9** Guardar y registrar otra + recibo | Pendiente — deps: 8 |
| 3 | **T10** Migración evidencia + anulación (`0052`) | Pendiente — deps: Checkpoint 0 |
| 3 | **T11** Persistir evidencia ambas puertas + foto en form | Pendiente — deps: 10 |
| 3 | **T12** Endpoint anulación + acción en historial | Pendiente — deps: 10 |
| 4 | **T13** Columna única; retirar glosario | Pendiente — deps: 9, 11 |
| 4 | **T14** Vocabulario compartido (`waste-reasons.ts`) | Pendiente — deps: 13 |
| 4 | **T15** Tokens warning + dark mode | Pendiente — deps: 13 |
| 4 | **T21** Audiencia honesta + reciprocidad | Pendiente — deps: 9, 14 · **enviar completa, nunca la línea de copy sola** |
| 5 | **T16** Formato/a11y/touch | Pendiente — deps: 13, 14, 15 |
| 5 | **T17** Deep-link `?item=` + `lot-selector` | Pendiente — deps: 13 |
| 6 | **T18** Datos "Por vencer" | Pendiente — deps: Checkpoint 4 |
| 6 | **T19** UI checklist + pestañas | Pendiente — deps: 18 |
| 6 | **T20** Envío en lote (transacción) | Pendiente — deps: 19, 11 |

**Working tree ahora mismo:** limpio. Rama `main`, sin pushes pendientes de esta sesión (3 commits locales sobre origin).

---

## 3. Fase 0 — lo implementado (detalle por commit)

### `df764fd` — T1: migración a `numeric(12,4)`
- **4 columnas en 3 tablas** (scope deliberado del plan): `inventory_waste.quantity`, `inventory_movements.quantity_change`, `inventory_batches.initial_quantity` + `current_quantity`.
- Migración `drizzle/0051_merma-decimal-quantities.sql` **mano-nombrada**, `USING <col>::numeric`, reversión documentada en papel. Aplicada (id 53 en `drizzle.__drizzle_migrations`). La 0050 del otro stream ya estaba aplicada (id 52).
- Comentario en `lib/db/schema.ts` sobre `inventoryBatches` registra la pregunta abierta del plan: **drizzle 0.45.2 tipa `numeric` como `string`** (verificado en node_modules).
- Verificado: `db:generate` sin drift ("No schema changes"), `db:migrate` limpio, filas sobreviven como `N.0000` (8 waste / 104 movimientos / 76 lotes), `check-migration-drift.ts` limpio.

### `0989fec` — T2: rutas de escritura decimal-safe
- Coerción `String()` en la frontera DB: `inventory-service.ts` (7 sitios), `receiving-service.ts`, `app/actions/inventory-transactions.ts`, `theoretical-consumption-service.ts` (dummy batch).
- **Marcadores AD-6 removidos** (la fracción se conserva): `merma-from-workflow.ts`, `stock-count-from-workflow.ts`, `production-from-workflow.ts` (waste), `stock-count-service.applyStockCountAdjustments` (varianza fraccionaria se aplica íntegra).
- `app/api/inventory/waste/route.ts`: solo coerción mecánica (`Number()`/`String()`) para mantener el build — **la T5 la reescribe entera**.
- Round-trip probado contra DB real (script temporal, borrado): lote 2.5 − 0.4 → `2.1000`; merma 0.4 → `0.4000`; `sum()` SQL → `-0.4000` (string).
- **⚠️ T2 fue 9 archivos, no 8** (se agregó `production-service.ts`, ver desviación 1).

### `72362e5` — T3: agregaciones
- Postgres devuelve numeric sums como **string**: los sitios que operaban con el valor crudo **concatenaban** (`"5"+"3"="53"`) o producían NaN. Coerción `Number()` en la frontera de consumo:
  - `knowledge-service.ts` (8 sitios) — el más crítico: `dailyTotals.reduce((a,b)=>a+b,0)` con strings → **NaN en el knowledge graph** (bug pre-existente corregido); `eq(currentQuantity,'0')`.
  - `executive-report-service.ts` (3): `calcRevenue/EndStockValue/WasteTotal` devolvían string → concat en `totalConsumed` → shrinkage % corrupto.
  - `stock-alert-service.ts`: `parseInt(stock.currentStock)` truncaba 2.5→2 → **alerta de stock bajo FALSA**; ahora `Number()`.
  - `operational-twin-engine`, `kpi-calculator`, `suggested-order-service`, `advanced-alert-service`, `app/api/reports/generate/route.ts`.
- Ya coercionaban bien (solo verificado): `food-cost-service.ts` (`pick()` con `Number()`), `cross-branch-service`, `predictive-scoring-service`, `period-service`.
- Verificado: `getFoodCostByBranch` real → números, sin NaN, 3 sucursales.

### `7a33da6` — T4: lecturas API/UI
- `app/api/inventory/movements/route.ts`: `quantityChange: Number(m.quantityChange)` vía `.map()` en la respuesta. **Ojo:** drizzle NO acepta `Number(col)` dentro del objeto de `db.select()` — la proyección debe quedar como columna pura y coercionar después de la query (error TS2322 si se intenta dentro).
- `app/api/analytics/inventory/activity/route.ts`: `Number(m.quantityChange)` en el map del response.
- `lib/services/inventory-service.ts` `getStockLevel`: `return Number(result[0]?.total || 0)` (alimenta `totalStock` de stock-manager).
- **Nuevo `formatQty` en `lib/utils.ts`**: `parseFloat(n.toFixed(4))` sobre string — `"2.5000"→"2.5"`, `"10.0000"→"10"`, `"-0.4000"→"-0.4"`, NaN-safe (`→ "0"`). No existía antes.
- UI consumidoras: `components/inventory/stock-manager.tsx` (3 renders: dropdown de lote, tabla de lotes, tabla de movimientos), `components/dashboard/operations/inventory-activity-feed.tsx` (la interfaz declara `quantityChange: number` — con el fix de API ya es verdad), `app/dashboard/inventory/movements/movements-client.tsx` (CSV + render).
- `hooks/queries/use-inventory.ts` `useMovements`: verificado, es query genérica `res.json()` — el tipo fluye del API.
- `app/api/inventory/batches/route.ts` + `expirations/route.ts`: fix `gte(currentQuantity, '0')` (string, no number).

### `412d3b1` — fixes e2e (fallout del Checkpoint 0)
- `tests/support/db.ts` `findWasteForInstance`: ahora coacciona `quantity` con `Number()` — tras 0051 Postgres devuelve `"1.0000"` y dos specs hacían `toBe(1)`/`toBe(2)` estricto (`lote-insuficiente.spec.ts:105`, `merma-automatica.spec.ts:128`). Donde el helper devuelve filas crudas, coerciona el helper, no cada assertion.
- `tests/merma-manual.spec.ts` (test cortesía): la API ordena pasos por `completedAt ASC NULLS LAST, id` (UUID aleatorio) → el índice de `qtySteps`/`reasonSteps` **NO** coincide con `itemIds` → flake ~1/6 (reasonByItem.get(itemIds[0]) era "EXPIRED"). Ahora parchea por stepId explícito (`merma-qty-{itemId}`/`merma-reason-{itemId}`). Verificado con `--repeat-each=3` (7/7 verdes).
- `merma-manual.spec.ts:143` puede fallar al correr specs sueltos por estado compartido de DB (cola de extractor fire-and-forget). En suite completa corre verde.

---

## 4. Checkpoint 0 — la puerta

| Ítem | Resultado |
|---|---|
| `pnpm run build` | ✅ exit 0 (~6.5 min Turbopack; timeout ≥900s, foreground — `nohup &` muere al cerrar la sesión bash) |
| `pnpm test:e2e` contra build (`PLAYWRIGHT_WEB_SERVER_CMD="npm run start" npx playwright test`) | ✅ **46/46 (5.9m)** |
| Round-trip fraccionario **puerta workflow** | ✅ `merma-manual.spec.ts` parchea 0.5 kg determinísticamente |
| Round-trip fraccionario **puerta form** | ✅ script `tmp-checkpoint0-roundtrip.ts` (borrado): POST real 0.5 → lote `2.0000`, merma `0.5000`, movimiento `-0.5000`; entero 1 → `1.0000` sin drift; `updatedStock` numérico |
| Integridad de columnas migradas | ✅ escaneo: 0 filas corruptas en las 4 columnas (regex `^-?\d+(\.\d{1,4})?$`) |
| Consistencia de agregación | ✅ `SUM(SQL)::numeric == Σ Number()` por sucursal (misma clase de bug que corrigió T3 — ojo: `count(*)` y `sum()` devuelven string) |
| Merma % / food-cost pre-migración | ✅ sin NaN ni concat (T3); datos enteros exactos (`N.0000`) |
| `tsc --noEmit` | ✅ 0 errores |
| `eslint` en archivos tocados | ✅ 0 issues nuevos — 15 errores `no-explicit-any` pre-existentes en líneas NO tocadas (verificado con stash→lint→pop) |
| **Revisión humana** | ⛔ **PENDIENTE — la parte irreversible** |

**Para la revisión humana:** `git diff df764fd~1..HEAD` — en orden: `drizzle/0051_*.sql` + `lib/db/schema.ts` (T1) → 9 archivos de escritura (T2) → 9 de agregaciones (T3) → 10 de lecturas/UI (T4). Verificar que ninguna quantity quede operándose sin coerción y que el scope de T1 (4 columnas) sea correcto. La desviación 1 (abajo) es la única decisión que se tomó fuera del plan.

---

## 5. Decisiones y desviaciones del plan (leer antes de continuar)

1. **`production_ingredients.actual_quantity` NO se migró.** El plan lista `production-from-workflow.ts:216/222` como marcador AD-6, pero la columna sigue `integer` (T1 fue deliberadamente 4 columnas). Resolución: `Math.round` **quitado del extractor** (el descuento del lote —columna migrada— ahora es exacto) y el redondeo **explícito** se movió al insert en `production-service.ts` (~:143), con comentario. Producción 100% decimal = **migración nueva (0052+)** con su propio barrido — NO hacerlo dentro de este plan sin decisión.
2. **`tests/stock-count.spec.ts` no existe** (lo menciona el plan). Specs reales: `merma-automatica.spec.ts`, `merma-manual.spec.ts`, `conteo-alto-valor.spec.ts`, `conteo-dinamico.spec.ts`, `lote-insuficiente.spec.ts`, `produccion-diaria.spec.ts`, `recepcion-workflow.spec.ts`, etc.
3. **`totalLoss` (cents, integer) se mantiene redondeado a centavo** — correcto, no es marcador AD-6. Idem `costPerUnit`.
4. `api/analytics/trends` hace `cast(sum(...) as integer)` en SQL → devuelve number por diseño; no tocar salvo que se quiera tendencia fraccionaria.
5. **`numeric` como string** rompe también `count(*)` (bigint → string). No se tocó en Fase 0 por scope; si un JSON devuelve `total: "50"`, es el mismo patrón — corregir cuando se toque esa ruta.

---

## 6. Próximos pasos sugeridos

### Paso 0 (ahora mismo): revisión humana del Checkpoint 0
Nada más escribe a la DB de verdad. Si la revisión encuentra algo, se corrige aquí antes de tocar la ruta.

### Fase 1 — T5 (primero, solo) luego T6

**T5 — Reescribir `app/api/inventory/waste/route.ts`** (hoy: `db` directo, `auth.api.getSession`, mira el lote con `eq(inventoryBatches.id, batchId)` **sin filtro de tenant** — fuga cross-tenant `:105`):
- `withTenantAuth` de `lib/api/with-auth.ts` (wrapper `AuthenticatedHandler`; `{ params, auth }`).
- `branchId` por `enforceBranchScope` de `lib/branch-scope.ts` (GERENTE/SUPERVISOR pinned a su sucursal).
- Lookup de lote scopeado al tenant → id cross-tenant = **404**, no 403.
- Matemática decimal-safe (la coerción mecánica de T2 ya está; mantenerla).
- Envelope `{ success, data|error }` vía `ApiHandler` de `lib/api/response.ts`.
- Error de sobre-cantidad con **código estable** para la T6 (no depender de substrings en inglés).
- **Nuevo `tests/inventory-waste.spec.ts`**: merma fraccionaria OK, sobre-cantidad rechazada, batch cross-tenant 404; post 0.4 kg → `0.4000` y decremento exacto del lote.

**T6 — `components/inventory/waste-form.tsx`**:
- `step="0.001"` + `inputMode="decimal"`; quitar `min="1"`.
- Zod `.positive()` + `.max(maxQuantity, 'Solo quedan {N} {unidad} en este lote')` fallando en `FormMessage` **antes** del AlertDialog.
- Error vía `aria-describedby`, no burbuja nativa.
- `humanizeWasteError` (ya vive en waste-form.tsx) con códigos estables.

**Checkpoint 1**: 0.5 kg end-to-end y todo aguas abajo refleja 0.5. El round-trip de form ya está probado (Fase 0), así que esto es cerrar el lazo UI+API.

### Luego — orden recomendado respetando dependencias y paralelización
- **Fase 2 (T7→9, en orden, T7 y T8 son paralelizables entre sí)** — P0 queda cerrado aquí (Checkpoint 1). T7: `Cancelar`→`Limpiar` (`waste-form.tsx:497`). T8: matar `key={refreshKey}` (`waste-client.tsx:23`), TanStack Query para el catálogo, `ErrorState` con retry. T9: "Guardar y registrar otra" conserva `itemId` y foco→Cantidad, tira "Registradas hoy: N · $X" desde el `GET /api/inventory/waste` (ya construido, sin consumidor UI), toast con unidad humana.
- **Fase 3 (T10→11→12)** — T10: migración `0052_merma-evidencia-anulacion.sql` (evidence_url/voided_* en waste; `merma_photo_required_above_cents` integer default 50000 en `tenant_operating_config`, precedente `mermaVarianceThresholdPct` :2831). T11: **persistir `evidenceUrl` en `merma-from-workflow.ts`** (hoy lo parsea y lo tira en el insert — la foto obligatoria del workflow se pierde); foto en form con el componente existente (hay `components/inventory/product-photo-upload.tsx` y `lib/r2-client.ts`; el plan nombra `camera-capture.tsx`/`use-photo-upload.ts` que NO existen con esos nombres — reusar lo que hay); exigencia también server-side. T12: `POST /api/inventory/waste/[id]/void` en **transacción** (el repo usa driver WS `neon-serverless` justamente para eso), `requireRoleApi` de `lib/rbac/require-role.ts`, **nunca borra**, excluir anuladas de las agregaciones de T3, `AuditService`.
- **Fase 4 (T13→14→15, T21 al final)** — T13 columna única; T14 nuevo `lib/inventory/waste-reasons.ts` (inverso de `REASON_MAP` en `merma-from-workflow.ts:39` — mover, no migrar el enum; cubrir los 7 valores incl. `STAFF`/`COURTESY`; etiquetas de cocina; `STAFF`/`COURTESY` como *consumo* suprimen "Pérdida Estimada"); T15 tokens `bg-warning/...` y `text-warning-text` (hoy `bg-amber-50 border-amber-200 text-amber-900` en `waste-form.tsx:468` y 4 iconos amber crudos). **T21 completa, nunca la línea de copy sola** — watch item crítico.
- **Fase 5 (T16→17)** — `Intl.NumberFormat('es-MX')`, deep-link `?item={id}` desde expiraciones, `components/inventory/lot-selector.tsx` (ya existe) + búsqueda con Popover+Input (sin `cmdk`).
- **Fase 6 (T18→19→20)** — pestaña "Por vencer" + batch submit en UNA transacción reusando la validación de T5 (una sola copia de las reglas).

### Riesgos vivos para el siguiente agente
- Fuga cross-tenant en la ruta de waste (T5) — el hallazgo más grave del plan.
- Foto obligatoria puede suprimir reporte (T11) — umbral configurable ayuda.
- T21 es una apuesta: disclosure sin reciprocidad = desconfianza. Enviar completa.
- Drift de migraciones: `check-migration-drift.ts` antes/después de cada `db:migrate`.
- Specs E2E comparten DB real en serie; tag `[E2E]` + `tests/support/db.ts`; contra build, no `next dev`.

---

## 7. Gotchas operativos

- **NUNCA `pnpm db:push`** — dropea tablas. Solo `db:generate` + `db:migrate`.
- `db:generate --name foo` produce `005X_foo.sql` + snapshot + journal; re-ejecutarlo sin nombre debe decir "No schema changes".
- Scripts temporales: `scripts/tmp-*.ts` con `import "dotenv/config"` **primero** (lib/db lee `process.env.DATABASE_URL` en evaluación de módulo); para DB directa, `pg` + `connectionString` (ver `scripts/check-migration-drift.ts`) o `neon` de `tests/support/db.ts`.
- Build: foreground, timeout ≥900s. `next dev` y `next start` comparten `.next` — apagar el dev server antes de construir.
- E2E: `PLAYWRIGHT_WEB_SERVER_CMD="npm run start" npx playwright test` (el webServer por defecto usa `next dev`). Setup crea `tests/.auth/admin.json` (cookie para peticiones autenticadas, útil en scripts).
- `formatQty` en `lib/utils.ts` para TODO render de cantidades — nunca interpolar el string crudo de la DB.
- El otro stream (workflow-review) tocó `lib/services/stock-count-service.ts` y `tests/support/db.ts` — al editar esos archivos revisar `git diff` por trabajo ajeno; antes de cada commit, `git status`.
- **Strict mode es `strict: false`** — `tsc --noEmit` no detecta concat de strings. La disciplina es coercer en la frontera y revisar agregaciones a mano.
- i18n: copy nuevo va a `messages/es.json` (next-intl), no hardcodeado en JSX.

---

## 8. Anclas de archivos (referencia rápida)

- Ruta a reescribir (T5): `app/api/inventory/waste/route.ts` · form (T6/7/11/13/14/15): `components/inventory/waste-form.tsx` · cliente (T8/9): `app/dashboard/inventory/waste/waste-client.tsx` · página (T15/17): `app/dashboard/inventory/waste/page.tsx`
- Helpers existentes: `lib/api/with-auth.ts` (`withTenantAuth`) · `lib/api/response.ts` (`ApiHandler`/`apiResponse`/`apiError`) · `lib/branch-scope.ts` (`enforceBranchScope`) · `lib/rbac/require-role.ts` (`requireRoleApi`) · `lib/r2-client.ts` · `components/inventory/product-photo-upload.tsx` · `components/inventory/lot-selector.tsx` · `lib/utils.ts` (`formatQty`)
- Extractores: `lib/services/merma-from-workflow.ts` (`REASON_MAP` :39 → T14; evidencia :233-246 → T11) · `lib/services/stock-count-from-workflow.ts` · `lib/services/production-from-workflow.ts` · `lib/services/production-service.ts` (~:143 redondeo explícito)
- Agregaciones ya barridas (T12 debe excluir anuladas aquí): `knowledge-service.ts`, `executive-report-service.ts`, `stock-alert-service.ts`, `operational-twin-engine.ts`, `kpi-calculator.ts`, `suggested-order-service.ts`, `advanced-alert-service.ts`, `food-cost-service.ts`, `app/api/reports/generate/route.ts`
- Specs existentes: `tests/merma-automatica.spec.ts`, `tests/merma-manual.spec.ts`, `tests/lote-insuficiente.spec.ts`, `tests/conteo-*.spec.ts`, `tests/produccion-diaria.spec.ts` (nuevo `tests/inventory-waste.spec.ts` para T5)

## 9. Vigilar después de Fase 4

Volumen de mermas reportadas por sucursal tras T21: una caída sostenida = señal de que la honestidad está suprimiendo el reporte; reconsiderar la mitad recíproca. Re-correr `/impeccable` en Checkpoint 5 — cualquier regresión cuenta como defecto.