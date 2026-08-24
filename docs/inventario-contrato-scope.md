# Contrato de alcance por sucursal — Módulo de Inventario

> Task 1 de `tasks/plan-inventario-desconexion.md`. Auditoría del 2026-08-23 sobre
> 32 archivos en `app/dashboard/inventory` y 50 rutas en `app/api/inventory`.

## Las 3 reglas canónicas (AD-1)

1. **Cliente:** la única fuente de "¿de qué sucursal estoy viendo?" es `useBranch()`
   (`lib/branch-context.tsx`). Ninguna página de inventario define su propio `<select>`
   de sucursal ni lee `session.user.branchId` para decidir alcance de vista.
   `selectedBranchId === null` significa **"Todas"** (rollup), no "sin elegir".
2. **Servidor:** las rutas API aceptan `branchId` explícito (query o body) y lo validan
   con `resolveBranchScope` / `enforceBranchScope` (`lib/branch-scope.ts`). El fijado de
   GERENTE/SUPERVISOR a su sucursal de sesión vive **dentro** de esos helpers — nunca como
   `?? session.user.branchId` suelto, que para un rol corporativo falla abierto.
3. **"Todas" distribuye, no mezcla** (AD-2): todo agregado chain-wide muestra atribución
   por sucursal (top contribuyentes), porque la pregunta es *"¿cuál sucursal me sangra?"*.

La autorización (qué puede tocar cada rol) es territorio de
`tasks/plan-branch-scope-fail-closed.md`; este contrato solo unifica el contexto de vista.

## Tabla — Páginas (`app/dashboard/inventory`)

| Página | Mecanismo actual | ¿Infringe? |
|---|---|---|
| `page.tsx` (hub) | `useBranch()` → `activeBranchId` → `useDashboard` | ✅ canónico |
| `products/page.tsx` | `useBranch()` → prop `activeBranchId` | ✅ |
| `transfers/page.tsx` | `useBranch()` → `TransferList` | ✅ |
| `movements/movements-client.tsx` | `useBranch()` → param de query | ✅ |
| `purchase-orders/page.tsx` | `useBranch()` (×2 hooks) | ✅ |
| `stock-count/page.tsx` | Server: cookie del header + validación contra tenant; scoped → lockea, sin scope → select propio **del form** (necesario: crear conteo exige sucursal) | ✅ (Task 3 ya implementada) |
| `waste/page.tsx` | Server: cookie del header + `enforceBranchScope` → prop fija a `WasteClient`. Sin alcance → pide elegir sucursal | ✅ coherente (Task 4: sin cambios reales necesarios) |
| `alerts/page.tsx` | Sin resolución propia (company-scoped) | — |
| `audit/page.tsx` | Sin resolución propia | — |
| `claims/page.tsx` | Sin resolución propia | 🟠 ver ruta claims |
| `costing/page.tsx` | Tabla de config de **todas** las sucursales (legítimo: pantalla de configuración) | — |
| `expirations/page.tsx` | Sin resolución propia | 🟠 |
| `invoices/page.tsx` | Sin resolución propia | — |
| `locations/page.tsx` | Sin resolución propia | — |
| `[id]/page.tsx` (detalle ítem) | `session.user.branchId` directo para lotes/stock/movimientos | 🔴 infractor residual |
| `[id]/edit/page.tsx` | Sin resolución propia (form de ítem company-scoped) | — |
| `new/page.tsx` | Sin resolución propia | — |
| `production/page.tsx` | `session.user.branchId` directo; bloquea si es null | 🔴 infractor |
| `recipes/page.tsx` | Sin resolución propia | — |
| `reports/page.tsx` | Sin resolución propia | — |
| `reports/executive/page.tsx` | Cáscara (D4) | — (Task 13 la oculta) |
| `menu-engineering/page.tsx` | Cáscara (D4) | — (Task 13) |
| `intelligence/page.tsx` | Cáscara (D4) | — (Task 13) |
| `receiving/page.tsx` | Recibe lista de sucursales; escritura vía ruta que usa `session.user.branchId` | 🟠 ver ruta receiving |
| `suggested-orders/page.tsx` | Sin resolución propia | 🟠 ver ruta suggested-orders |
| `suppliers/page.tsx` | Sin resolución propia | — |
| `stock-count/[id]/results/*` | Muestra la sucursal del conteo (dato histórico, correcto) | — |

## Tabla — Rutas API (`app/api/inventory`)

Mecanismos: **Q** = query param explícito · **S** = `session.user.branchId` ·
**T** = `tenant.branchId` · **H** = helper de scope (`resolve/enforceBranchScope`)

| Ruta | Mecanismo | ¿Infringe? |
|---|---|---|
| `waste` (GET/POST) | H (ambos verbos) | ✅ patrón servidor canónico |
| `high-value` | Q validado contra tenant | ✅ (Task 2 ya implementada) |
| `dashboard` | Q \|\| T | ✅ aceptable (T es el default del tenant, no de sesión) |
| `movements`, `products`, `audit`, `batches`, `expirations`, `periods`, `stock-count`, `purchase-orders`, `costing/recipe/[id]`, `reports/executive`, `menu-engineering`, `alerts*` | Q (o Q \|\| T) | ✅ |
| `low-stock` | Q \|\| **S** | 🔴 fallback S suelto |
| `production` (GET) | Q \|\| **S** | 🔴 fallback S suelto |
| `production` (POST) | escribe **S** | 🔴 ignora alcance elegido |
| `production/suggestions` | Q \|\| **S** | 🔴 fallback S suelto |
| `storage-locations` (GET/POST) | Q \|\| **S** / escribe **S** | 🔴 |
| `receiving` (POST) | escribe **S** y filtra lotes por **S!** | 🔴 recepción ignora el alcance del header |
| `sales-entry` | exige **S** | 🔴 (D1 — se rediseña completo en Phase 2) |
| `suggested-orders` | solo **S** | 🔴 rompe para corporativo sin sucursal |
| `transfers` (POST) | `fromBranchId` = **S** | 🔴 |
| `reports/variance` | usa **S** | 🔴 |
| `suppliers` (POST/PATCH) | escribe **S \|\| ''** | 🟠 cadena vacía como branchId |
| `suppliers/[id]/items` | escribe **S \|\| ''** | 🟠 |
| `claims` (POST) | escribe **S \|\| ''** | 🟠 |
| `invoices/upload` | escribe **S \|\| null** | 🟠 |

> Nota: los 🔴 de *autorización* (NONE ≠ ALL, falla abierta) pertenecen al plan
> fail-closed. Aquí se listan porque violan también la regla 2 de contexto:
> un ADMIN con "Polanco" seleccionado en el header sigue operando sobre
> `session.user.branchId` (null) en vez de Polanco.

## Estado de Tasks 2–5 contra este inventario

| Task | Estado al auditar |
|---|---|
| T2 HighValueSkusSection | **Ya implementado**: componente thread-ea `branchId` y `/api/inventory/high-value` lo valida y filtra. Pendiente: verificación manual con ambos scopes |
| T3 stock-count | **Ya implementado**: cookie del header → preselecciona/lockea; select solo sin scope. Pendiente: verificación manual |
| T4 waste | Coherente hoy: server resuelve cookie+`enforceBranchScope`, client recibe prop. El AC original ("usar `useBranch()`") queda satisfecho en espíritu; cambio cosmético descartado (Rule 0: nada que ganar) |
| T5 Rollup "Todas" | **Parcial**: `QuickAlerts` tiene `showBranchAttribution` pero como micro-línea truncada, no clicable ni prominente. `DashboardKpis` no atribuye nada. Es el único trabajo real pendiente de Phase 1 |
| Residual nuevo | `production/page.tsx`, `[id]/page.tsx` y las rutas 🔴 de arriba quedan como entrada de una tarea posterior (fuera de Phase 1 tal como fue definida) |

## Verificación de Checkpoint 1 (ajustada)

- [ ] `npx tsc --noEmit` limpio
- [ ] Manual: scope "Polanco" → KPIs, conteo, merma y alto valor muestran Polanco;
      "Todas" → KPIs con top sucursales contribuyentes, alertas con atribución prominente
- [ ] Grep: ningún componente bajo `app/dashboard/inventory` define selector propio
      (los selects restantes son forms de acción que exigen sucursal cuando no hay scope)
