# Phase 8.1: Analytics & Reporting — Lo que REALMENTE falta

> **Basado en:** investigación del codebase al 19-Jul-2026
> **Investigación previa:** `PHASE8_ANALYTICS_INVESTIGATION.md` (Mayo 2026 — desactualizada, ~10+ hallazgos ya no aplican)
> **Estado real estimado:** ~60-65% completo

---

## Resumen ejecutivo

El reporte de investigación de mayo 2026 está significativamente desactualizado. La mayoría de la infraestructura crítica (motor KPI, APIs, tablas, componentes) ya está construida. Lo que falta son piezas acotadas y trabajo de integración/pulido.

---

## ✅ Ya implementado (contrario al doc anterior)

| Pieza | Dónde |
|---|---|
| Motor KPI con queries reales a DB | `lib/services/kpi-calculator.ts` |
| Tabla `temperature_logs` | `lib/db/schema.ts:641` |
| Tabla `costRecords` | `lib/db/schema.ts:661` |
| API de monitoreo de temperatura | `app/api/analytics/temperature-monitoring/route.ts` |
| API de rendimiento por sucursal | `app/api/analytics/branch-performance/route.ts` |
| API de resumen ejecutivo | `app/api/analytics/executive-summary/route.ts` |
| API de estadísticas de reports | `app/api/reports/stats/route.ts` |
| Dashboard de sucursales | `app/dashboard/branches/page.tsx` |
| Componente monitor de temperatura | `components/dashboard/operations/temperature-monitor.tsx` |
| Gráfico comparativo de sucursales | `components/analytics/branch-comparison-chart.tsx` |
| Tabla de ranking de sucursales | `components/analytics/branch-ranking-table.tsx` |
| API de movimientos de inventario | `app/api/analytics/inventory/activity/route.ts` |
| Feed de actividad de inventario | `components/dashboard/operations/inventory-activity-feed.tsx` |
| API de distribución de alertas | `app/api/analytics/alert-distribution/route.ts` |
| Gráfico de distribución de alertas | `components/dashboard/alert-distribution-chart.tsx` |
| Cron jobs en vercel.json | Ambos `scheduled-reports` y `compliance-alerts` registrados |
| Filtro companyId en compliance | Sí, indirecto vía branches |
| branchId en employees API | Sí, usado en la mayoría de queries |

---

## ❌ Lo que realmente falta (priorizado)

### 🔴 PARTE A — APIs faltantes (1 tarea)

#### A1. Crear API `app/api/analytics/workflow-completion-trend/route.ts`

Endpoint que devuelva la tasa de completitud de workflows en el tiempo (línea de tendencia diaria con completion rate). El componente `CompletionRateChart` ya existe y fetch de `/api/reports/stats`, pero el executive dashboard necesita su propio endpoint de tendencia.

```typescript
GET /api/analytics/workflow-completion-trend?period=30d&branchId=xxx
Response: { trend: [{ date: "Jul 01", rate: 85.3 }, ...] }
```

**Archivos:**
- Crear: `app/api/analytics/workflow-completion-trend/route.ts`

---

### 🟡 PARTE B — Componentes de UI faltantes (3 tareas)

#### B1. Crear `components/analytics/branch-performance-score-card.tsx`

Score card compuesto tipo "Overall Rating" para el branch performance dashboard, mostrando:
- Performance index con gauge/radial
- Breakdown de puntuación por dimensión (workflows, compliance, labor, temp, inventory)
- Trend vs periodo anterior

#### B2. Integrar `AlertDistributionChart` en executive dashboard

El componente existe (`components/dashboard/alert-distribution-chart.tsx`) pero no está importado en `app/dashboard/page.tsx`. Agregarlo al grid de charts.

#### B3. Integrar `InventoryActivityFeed` en operations overview tab

El componente existe (`components/dashboard/operations/inventory-activity-feed.tsx`) pero no está importado en `components/dashboard/operations/overview-tab.tsx`.

---

### 🟠 PARTE C — Funcionalidad incompleta (4 tareas)

#### C1. Implementar stubs de temperatura en `KpiCalculator`

**Archivo:** `lib/services/kpi-calculator.ts:133-139`

```typescript
// Actual: return 0;
// Debe: consultar temperature_logs
private async countTotalTempReadings(companyId: string, branchId?: string): Promise<number> {
  const conditions = [];
  if (branchId && branchId !== 'all') conditions.push(eq(temperatureLogs.branchId, branchId));
  const [result] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(temperatureLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return Number(result?.count || 0);
}
```

Lo mismo para `countCompliantTempReadings` agregando `eq(temperatureLogs.isCompliant, true)`.

#### C2. Agregar breakdown de costos por sucursal

El API `branch-performance` ya importa `costRecords` pero no lo consulta. Agregar query de costos por categoría a cada branch en `app/api/analytics/branch-performance/route.ts` y mostrarlo en el detalle expandido de `app/dashboard/branches/page.tsx`.

#### C3. Agregar drill-down funcional en analytics page

**Archivo:** `app/dashboard/analytics/page.tsx:243-248`

El `handleDrillDown` actualmente solo muestra un toast. Implementar navegación a una vista de detalle con histórico del KPI y breakdown por sucursal.

#### C4. Agregar valuación de stock (stock value)

No existe lógica de valuación de stock (`cantidad * costo_unitario`). El schema `inventoryBatches` tiene `unitCost` — agregar query agregada.

---

### 🔵 PARTE D — Integraciones y pulido (5 tareas)

#### D1. Conectar OverviewTab al branchId/period filters

`overview-tab.tsx` no recibe `branchId` ni `period`, por lo que los componentes hijos (`CompletionRateChart`, `ActiveWorkflowsList`, `EmployeeLeaderboard`) no filtran. Pasar props desde `operations-tabs.tsx` → `overview-tab.tsx`.

#### D2. Agregar cálculo de "avg task duration by type"

No existe desglose por tipo de tarea. Agregar query en `KpiCalculator` o un endpoint separado que agrupe `workflowAssignments.duration` por `workflowTemplates.complianceType` o similar.

#### D3. Agregar "avg resolution time" para alertas

No existe tracking de resolución. Agregar campo `resolvedAt` a `kpiAlerts`/`incidents` y calcular diff.

#### D4. Reemplazar polling con actualización en tiempo real

El analytics page usa `setInterval` para polling. Evaluar SSE o WebSocket para updates push.

#### D5. Date range picker reutilizable

Actualmente `DashboardFilters` tiene date range UI pero no hay un componente de date range picker standalone y reutilizable.

---

## 📋 Resumen de archivos a crear/modificar

### Crear (2 archivos)
| Archivo | Tarea |
|---|---|
| `app/api/analytics/workflow-completion-trend/route.ts` | A1 |
| `components/analytics/branch-performance-score-card.tsx` | B1 |

### Modificar (9 archivos)
| Archivo | Tarea |
|---|---|
| `app/dashboard/page.tsx` | B2 — importar AlertDistributionChart |
| `components/dashboard/operations/overview-tab.tsx` | B3, D1 — agregar InventoryActivityFeed + props |
| `lib/services/kpi-calculator.ts` | C1 — implementar stubs temperatura |
| `app/api/analytics/branch-performance/route.ts` | C2 — agregar costos por sucursal |
| `app/dashboard/branches/page.tsx` | C2 — mostrar costos en detalle |
| `app/dashboard/analytics/page.tsx` | C3 — drill-down funcional |
| N/A (nuevo service o endpoint) | C4 — stock valuation |
| N/A (nuevo endpoint o KPI calc) | C2 — avg task duration by type |
| Depende de schema change | C3 — avg resolution time |

---

## ⏱ Estimación de esfuerzo

| Prioridad | Tareas | Esfuerzo estimado |
|---|---|---|
| 🔴 Parte A | 1 API | ~30 min |
| 🟡 Parte B | 2 componentes + 2 integraciones | ~2 h |
| 🟠 Parte C | 4 funcionalidades | ~4 h |
| 🔵 Parte D | 5 mejoras/pulido | ~4 h |
| **Total** | **~12 tareas** | **~10-11 h** |
