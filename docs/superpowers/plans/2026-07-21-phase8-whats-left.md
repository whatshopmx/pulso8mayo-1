# Phase 8: Analytics & Reporting — Lo Faltante

> Basado en análisis del codebase al 21-Jul-2026. Ver `prd.md` sección 8 para los requisitos originales.

---

## Estado Actual vs PRD

| Sección | PRD Subtotales | Implementado | Pendiente |
|---------|---------------|--------------|-----------|
| **8.1.1 Executive Dashboard** | 6 subtareas | ~4 parciales | Export, filtros fecha reales |
| **8.1.2 Operations Dashboard** | 5 subtareas | 4 implementadas | Temperature charts reales |
| **8.1.3 Branch Performance** | 5 subtareas | 0 — API y componentes existen, página no | **TODO** |
| **8.2.1 Scheduled Reports** | 6 subtareas | 0 — Cron de Inngest existe pero no genera/distribuye | **TODO** |
| **8.2.2 Trend Analysis** | 5 subtareas | 0 — APIs de tendencia parciales pero no página unificada | **TODO** |
| **8.2.3 Custom Report Builder** | 6 subtareas | 2 — UI existe pero sin backend real | **TODO** |
| **8.3.1 KPI Definition & Goals** | 5 subtareas | 4 implementadas | Falta goal achievement alerts |
| **8.3.2 KPI Snapshots** | 5 subtareas | 0 | **TODO** |

---

## Lote A: Branch Performance Dashboard (Prioridad: Alta)

### A1 — Crear página Branch Performance

**Archivos:**
- Crear: `app/dashboard/analytics/branches/page.tsx`

**Qué hace:**
Página cliente que usa los 3 componentes existentes:
- `BranchComparisonChart` (gráfico de barras comparativo)
- `BranchRankingTable` (ranking con medallas)
- `BranchPerformanceScoreCard` (tarjetas con donut chart)

Filtros: selector de período (7d/30d/90d/YTD).

### A2 — Crear drill-down por sucursal

**Archivos:**
- Crear: `app/dashboard/analytics/branches/[id]/page.tsx`

**Qué hace:**
Página servidor que recibe `branchId` como params, consulta DB directamente para:
- Score card de performance
- Workflows recientes (tabla)
- Métricas detalladas (asistencia, temperatura, inventario, costos)

### A3 — Agregar link en sidebar

**Archivos:**
- Modificar: `components/app-sidebar.tsx`

**Qué hace:**
Agregar item "Performance por Sucursal" con icono `BarChart3` en la sección de Analítica, debajo del link existente.

### A4 — Hacer clickeables los score cards

**Archivos:**
- Modificar: `components/analytics/branch-performance-score-card.tsx`

**Qué hace:**
Agregar `branchId` a `ScoreCardProps`, envolver el card en `<Link href={/dashboard/analytics/branches/${branchId}}>`.

---

## Lote B: Reportes Programados (Prioridad: Media)

### B1 — API de programación de reportes

**Archivos:**
- Crear: `app/api/reports/scheduled/route.ts`

**Qué hace:**
CRUD completo para `reportTemplates` con tipo SCHEDULED:
- `GET` — listar reportes programados del company
- `POST` — crear nuevo schedule (reportId, frequency, time, format, recipients, branchId)
- `PUT /:id` — actualizar schedule
- `DELETE /:id` — eliminar schedule

### B2 — UI de "Programar Nuevo Reporte"

**Archivos:**
- Crear: `app/dashboard/reports/schedule/page.tsx`
- Modificar: `app/dashboard/reports/page.tsx`

**Qué hace:**
- Modal o página nueva con formulario: seleccionar tipo de reporte, frecuencia (diaria/semanal/mensual), hora, formato (PDF/Excel), método de envío (email/WhatsApp), sucursal(es)
- Conectar botón "Programar Nuevo Reporte" en `page.tsx`

### B3 — Conectar cron Inngest con generación real

**Archivos:**
- Modificar: `lib/inngest/functions/cron-scheduled-reports.ts`

**Qué hace:**
El cron existe y itera `reportTemplates` con `nextRunAt <= now`, pero no genera el archivo ni lo envía. Agregar:
- Llamar a `/api/reports/generate` para crear el PDF/Excel
- Enviar por email (Resend API) y/o WhatsApp (Wasender)
- Almacenar en R2 para historial

---

## Lote C: Trend Analysis & Forecasting (Prioridad: Media)

### C1 — API de tendencias unificada

**Archivos:**
- Crear: `app/api/analytics/trends/route.ts`

**Qué hace:**
Endpoint GET con parámetros:
- `metric`: workflow_completion | inventory_consumption | labor_hours | costs | alert_frequency
- `period`: 7d | 30d | 90d | 1y
- `branchId`: opcional
- `compareWith`: previous_period | same_period_last_year

Devuelve serie temporal + metadatos de comparación (% cambio).

Ya existen APIs de tendencia parciales (`workflow-completion-trend`, `temperature-monitoring`, `compliance/trends`). Esta API las unifica bajo un solo endpoint.

### C2 — Componente TrendChart

**Archivos:**
- Crear: `components/analytics/trend-chart.tsx`

**Qué hace:**
Componente Recharts que acepta:
- `data`: serie temporal
- `metricType`: percentage | number | currency
- `showComparison`: boolean (muestra línea del período anterior)
- `chartType`: line | area

### C3 — Página de Trend Analysis

**Archivos:**
- Crear: `app/dashboard/analytics/trends/page.tsx`
- Modificar: `components/app-sidebar.tsx` (link)

**Qué hace:**
Dashboard con:
- Selector de métrica principal
- Selector de período y período comparativo
- Trend chart grande
- Grid de métricas comparativas (this period vs previous, % change)
- Tabla de datos subyacentes

---

## Lote D: KPI Snapshots (Prioridad: Baja)

### D1 — Tabla KPI snapshots

**Archivos:**
- Modificar: `lib/db/schema.ts`

**Qué hace:**
Nueva tabla `kpiSnapshotLogs`:
```typescript
kpiSnapshotLogs: pgTable("kpi_snapshot_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  branchId: uuid("branch_id"),
  snapshotType: text("snapshot_type").notNull(), // DAILY | WEEKLY | MONTHLY
  snapshotDate: timestamp("snapshot_date").notNull(),
  metrics: jsonb("metrics").notNull(), // { kpiId: value, ... }
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  createdAt: timestamp("created_at").defaultNow(),
})
```

### D2 — Inngest function para snapshots

**Archivos:**
- Crear: `lib/inngest/functions/cron-kpi-snapshots.ts`
- Modificar: `lib/inngest/functions/index.ts`

**Qué hace:**
Tres triggers cron:
- Daily: `0 23 * * *` — snapshot de KPIs al cierre del día
- Weekly: `0 22 * * 0` — rollup semanal
- Monthly: `0 21 28-31 * *` — summary mensual (día 28-31)

Usa `KpiCalculator` para calcular todos los KPIs activos del company y guarda el snapshot.

### D3 — API y UI de snapshots

**Archivos:**
- Crear: `app/api/kpi/snapshots/route.ts`
- Crear: `components/analytics/kpi-snapshot-comparison.tsx`

**Qué hace:**
- API: GET con `companyId`, `snapshotType`, `from`, `to` — devuelve snapshots para comparación
- Componente: tabla comparativa mostrando valor de cada KPI en diferentes snapshots (ayer/hoy, esta semana/semana pasada, este mes/mes pasado)

---

## Lote E: Custom Report Builder (Prioridad: Baja)

### E1 — Ruta para guardar templates

**Archivos:**
- Crear: `app/api/reports/templates/route.ts`

**Qué hace:**
CRUD para `reportTemplates` con tipo CUSTOM:
- `POST` — guardar template con nombre, descripción, dataSource, fields, filters, dateRange
- `GET` — listar templates guardados
- `GET /:id` — obtener template
- `PUT /:id` — actualizar
- `DELETE /:id` — eliminar

### E2 — Ruta para ejecutar reporte custom

**Archivos:**
- Crear: `app/api/reports/execute/route.ts`

**Qué hace:**
Endpoint POST que recibe `dataSource`, `fields`, `filters`, `dateRange` y:
1. Construye query dinámica según dataSource (employees | contracts | documents)
2. Aplica filtros
3. Aplica date range
4. Devuelve resultados como JSON (o CSV si format=csv)

### E3 — Enlace a custom builder

**Archivos:**
- Modificar: `app/dashboard/reports/page.tsx`
- Opcional: crear ruta `app/dashboard/reports/custom/page.tsx` y mover `custom-builder.tsx`

**Qué hace:**
Agregar un botón/tab en la página de reportes que lleve al custom builder. El builder (`custom-builder.tsx`) ya existe en `app/dashboard/reports/custom-builder.tsx` pero no tiene reta pública.

---

## Resumen de Archivos

| Acción | Cantidad |
|--------|----------|
| Crear archivos | ~16 |
| Modificar archivos | ~7 |
| Tiempo estimado total | ~40 horas |

## Orden de Implementación Recomendado

```
Semana 1: A1 → A2 → A3 → A4   (Branch Performance)
Semana 2: B1 → B2 → B3          (Scheduled Reports)
Semana 3: C1 → C2 → C3          (Trend Analysis)
Semana 4: D1 → D2 → D3          (KPI Snapshots)
Semana 5: E1 → E2 → E3          (Custom Reports)
```

No hay dependencias entre lotes — se pueden paralelizar.
