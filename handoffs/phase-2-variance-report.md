# Handoff: Phase 2 — Costeo Avanzado (Variance Report)

## Contexto

Phase 2 del módulo de inventario (Dashboard Ejecutivo e Ingeniería de Menú) está completa **excepto** el reporte de variación de costeo. `CostingService.getVarianceReport()` es un stub que siempre retorna `variance: 0`.

## Lo que existe

| Archivo | Propósito | Estado |
|---|---|---|
| `lib/services/costing-service.ts` | `CostingService` con CRUD de método por sucursal, `getRecipeCostDetail()`, y stub `getVarianceReport()` | Stub en línea 154 |
| `app/api/inventory/costing/config/route.ts` | GET (list configs) y PATCH (update/reset method) | ✅ |
| `app/dashboard/inventory/costing/page.tsx` | UI de configuración de método por sucursal | ✅ (solo per-branch, sin company-level default) |
| `app/api/inventory/costing/recipe/[id]/route.ts` | GET recipe cost detail (requiere `branchId`) | ✅ |

## Lo que falta

### 1. `CostingService.getVarianceReport()` — Arreglar stub

**Archivo:** `lib/services/costing-service.ts:154`

**Problema:** Actualmente itera recetas, llama `getRecipeCostDetail()` con el método de la sucursal, y asigna `avgCostPercent: lastCostDetail.foodCostPercent` y `variance: 0`.

**Lo que debe hacer:**
- Calcular el costo de cada receta con **ambos métodos** (`LAST_COST` y `AVERAGE_COST`)
- Reportar la variación real entre ellos
- Opcionalmente comparar contra `recipes.calculatedCost` (costo estándar) si existe

**Firma sugerida:**
```ts
static async getVarianceReport(
  companyId: string,
  branchId: string
): Promise<VarianceReportItem[]>

interface VarianceReportItem {
  recipeId: string;
  recipeName: string;
  lastCostPercent: number;   // Food cost % usando método LAST_COST
  avgCostPercent: number;     // Food cost % usando método AVERAGE_COST
  variance: number;           // Diferencia en puntos porcentuales
  currentMethod: 'LAST_COST' | 'AVERAGE_COST';
  sellingPrice: number;
  unitCostLastCost: number;
  unitCostAvgCost: number;
}
```

**Implementación:** Llamar `getRecipeCostDetail()` dos veces — una forzando `LAST_COST`, otra forzando `AVERAGE_COST`. Restar los food cost % para obtener `variance`.

### 2. API endpoint `/api/inventory/costing/variance`

Crear `app/api/inventory/costing/variance/route.ts`:

```ts
// GET /api/inventory/costing/variance?branchId=xxx
// Auth: requireTenant + requireAuth + hasPermission('inventory', 'read')
// Returns { items: VarianceReportItem[], generatedAt }
```

**Patrón a seguir:** `app/api/inventory/costing/config/route.ts`

### 3. UI de reporte de variación

Crear página en `app/dashboard/inventory/costing/variance/page.tsx` que:

- Muestre una tabla con todas las recetas
- Columnas: Receta, Last Cost %, Avg Cost %, Variación (pp), Precio Venta, Costo Unitario (LAST), Costo Unitario (AVG)
- Resalte en rojo las variaciones > 5 puntos porcentuales
- Selector de sucursal (usar `useBranch()`)
- Botón de refrescar
- La variación puede ser positiva o negativa (indicador visual)

**Patrón a seguir:** `app/dashboard/inventory/costing/page.tsx`

### 4. Company-level default method UI (opcional)

Agregar a `app/dashboard/inventory/costing/page.tsx` un selector para cambiar el método por defecto de la compañía. Actualmente:

- Tabla `companies` tiene `costingMethod` con default `'LAST_PRICE'` (schema/core.ts:14)
- `CostingService.getBranchMethod()` ya resuelve: branch override > company default
- No hay endpoint ni UI para cambiar el company-level default

**Endpoint sugerido:** Agregar a `app/api/inventory/costing/config/route.ts` un PATCH cuando no se envía `branchId` (solo `method`):
```ts
if (!branchId && method) {
  // Actualizar company default
  await db.update(companies)
    .set({ costingMethod: method })
    .where(eq(companies.id, tenant.id));
}
```

**UI:** Agregar una Card al inicio de `app/dashboard/inventory/costing/page.tsx` con selector del método global y un badge "Predeterminado para todas las sucursales".

## Dependencias

- Ninguna. Todo depende solo de `lib/db/schema/core.ts` (tablas `companies`, `branches`, `recipes`, `recipeItems`, `inventoryItems`) y `CostingService` existente.

## Verificación

```bash
pnpm run build   # Sin errores
```

Flujo manual:
1. Navegar a `/dashboard/inventory/costing/variance`
2. Seleccionar sucursal
3. Ver tabla con variación real entre LAST_COST y AVERAGE_COST
4. Verificar que recetas con precios distintos entre `lastCost` y `averageCost` muestran variance ≠ 0
