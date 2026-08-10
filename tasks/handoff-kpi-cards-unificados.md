# Handoff — Unificación de KPI Cards en dashboards (plan-kpi-cards-unificados)

> **Fuente de verdad** para continuar en una sesión nueva.
> Fecha: 2026-07-19 (sesión de creación del componente). Plan original: `tasks/plan-kpi-cards-unificados.md`.
> Checklist vivo: `tasks/todo-kpi-cards-unificados.md`.

## 1. Estado en una frase

**Tasks 1–2 completas y verificadas (eslint + `tsc --noEmit` 0 errores): componente canónico `MetricCard`/`MetricGrid`/`MetricCardSkeleton` creado, los 4 consumidores de `StatCard` migrados y `components/ui/stat-card.tsx` eliminado. Falta Task 3→8 (migrar ~16 sitios con cards inline/duplicados) y la verificación visual en navegador (el browser tool falló en esta sesión — ver §4.3).** No se ha commiteado nada de este plan aún; el árbol conserva trabajo ajeno de otro workstream — ver §5.

## 2. Decisiones de diseño YA tomadas (OQ-1..4 aprobadas por el humano)

| # | Decisión | Valor canónico |
|---|----------|----------------|
| OQ-1 | Valores numéricos en **`font-mono`** (DESIGN.md: mono = numeric data) | `text-2xl font-bold font-mono tracking-tight` |
| OQ-2 | Título del KPI sin uppercase ni tracking | `text-sm font-medium text-muted-foreground` + subtítulo `text-xs text-muted-foreground` |
| OQ-3 | **Icono en caja tonal** arriba-derecha (no ícono plano muted; no fondo full-color) | `h-8 w-8 rounded-lg` con `bg-<tone>/10 text-<tone>` |
| OQ-4 | `analytics/kpi-card.tsx`: alinear SOLO la base tipográfica, conservar drill-down/dropdown/badges. `financial-kpi-cards.tsx`: **fuera de alcance** (panel con barras, ya usa tokens; solo verificar) | — |

## 3. Estado por tarea

| Task | Estado | Notas |
|------|--------|-------|
| 1. Crear `metric-card.tsx` | ✅ Hecho | MetricCard + MetricGrid + MetricCardSkeleton. Ver specs §4.1. |
| 2. Migrar 4 consumidores de `StatCard` → MetricCard + borrar `stat-card.tsx` | ✅ Hecho | audit, assignment-stats, schedule-stats, compliance-metrics. Ver §4.2. |
| 3. Migrar 5 consumidores de `shared/kpi-card` → MetricCard + borrar | ⬜ Pendiente | civil-protection, inventory/alerts, kpi-templates, expiration-report, stock-alerts |
| 4. Tablero: `kpi-summary-cards` + `executive-summary` | ⬜ Pendiente | Preservar barra hacia meta → prop `progress` |
| 5. Inline módulos: labor / performance / compliance-dashboard / corporate-grid | ⬜ Pendiente | 4 archivos |
| 6. Inventario: `dashboard-kpis` + `executive-dashboard` (KPICard inline) | ⬜ Pendiente | Preservar `href`/tooltips/dot |
| 7. `equipment-stats` (tones, fix dark) + `kpi-hero-cards` (HeroCard→MetricCard) | ⬜ Pendiente | equipment hoy usa `bg-blue-50` crudo sin dark + círculo blanco con `shadow-sm` (viola no-shadows) |
| 8. Alinear base de `analytics/kpi-card`; verificar `financial-kpi-cards` | ⬜ Pendiente | |

## 4. Hallazgos críticos (lea antes de continuar)

### 4.1 Spec del componente canónico (`components/ui/metric-card.tsx`)
- **Server-safe**: NO lleva `"use client"` (usa `next/link` y nada de hooks). Mantenerlo así; si un consumidor client necesita lógica, que la tenga el consumidor.
- Props: `label: string`, `value: string | number`, `icon?: ReactNode` (**debe pasarse con `h-4 w-4`**), `tone?: "neutral" | "success" | "warning" | "destructive" | "info"` (default `neutral`), `subtitle?: ReactNode`, `delta?: { value: number; isPositive: boolean; label?: string }` (**isPositive es semántico**: el llamador decide si el movimiento es bueno, para lowerIsBetter pasar `isPositive: false`), `progress?: { value: number; max?: number }`, `href?: string` (envuelve en `Link` con focus ring), `loading?: boolean` (skeleton inline), `className?`.
- Tones (mismo criterio AA que `statusBadgeClasses` en `lib/utils.ts`): `neutral: bg-muted text-muted-foreground`, `success: bg-success/10 text-success`, **`warning: bg-warning/10 text-warning-text`** (¡no `text-warning`, no alcanza AA), `destructive: bg-destructive/10 text-destructive`, `info: bg-info/10 text-info`. Fill de progress: `neutral → bg-primary`, resto `bg-<tone>`.
- Delta: `TrendingUp/TrendingDown/Minus`; color `text-success`/`text-destructive` según `isPositive`; valor 0 → `text-muted-foreground` con `Minus`. Texto por defecto "vs. período anterior" (en español ya).
- `MetricGrid` columns `2|3|4|5`: 2→`sm:grid-cols-2`, 3→`sm:grid-cols-2 lg:grid-cols-3`, 4→`sm:grid-cols-2 lg:grid-cols-4`, 5→`md:grid-cols-3 lg:grid-cols-5`. En migraciones que ya tienen su propio grid (`md:grid-cols-4`, `lg:grid-cols-6`, etc.) se puede mantener el div grid existente y solo cambiar los cards — no es obligatorio usar MetricGrid.
- `MetricCardSkeleton({ count, className })` firma compatible con `KpiCardsSkeleton` de `shared/skeletons.tsx` (aún sin swap global; se hace en Tasks 3-4 donde viven los consumidores).

### 4.2 Lo aplicado en Task 2 (detalles de la migración)
- Mapeo `variant → tone`: `default→neutral`, `success→success`, `warning→warning`, `danger→destructive`.
- `trend → delta` (`{ value, isPositive }`); StatCard renderizaba `"+N%" from last period` → MetricCard renderiza `+N% vs. período anterior`.
- **En `compliance-metrics.tsx`** además de la migración se reemplazaron colores crudos por tokens: `text-emerald-500 → text-success`, `text-blue-500 → text-info`, `text-amber-500 → text-warning-text` (iconos de subtítulos).
- Se eliminaron imports muertos quedados tras la migración (`Loader2`, `TrendingUp`, `Badge` en compliance-metrics).
- **No traducir cadenas existentes** al migrar (p. ej. "All assignments" en assignment-stats quedó en inglés): mantener diff mínimo; la traducción sería otra tarea aparte.

### 4.3 ⚠️ Entorno / herramientas de la próxima sesión
- **`agent_browser` no funcionó** en esta sesión: falla del daemon "Managed-session policy ... live daemon restore" incluso con `sessionMode: fresh`. Si vuelve a fallar: probar `sessionMode=fresh` de nuevo o verificar visualmente con `pnpm run dev` + navegador del usuario. **La verificación visual pendiente** (demo MetricCard, dark mode, y cada módulo migrado) es el paso más importante que falta.
- **`tsc` con cygwin dio falsos negativos** por "Resource temporarily unavailable" (fork error) cuando el sistema está cargado: salida vacía + exit 1/127 que NO son errores de código. Remedio: limpiar nodes colgados (`tasklist | grep node`) y reintentar en background con retry. Cuando corre limpio tarda ~1-3 min y da exit 0.
- **`next build` tarda ~9 min** (8.7min solo compile). Usar timeout ≥ 900s si se corre en una sola llamada, o correr tsc por separado (más rápido y suficiente para validar).
- En Task 1 hice un `timeout 600 pnpm run build` que mató el proceso al llegar a "Running TypeScript" (exit 143) — el compile ya había pasado; no era un fallo del código.

### 4.4 Riesgos heredados para Tasks 3-8
- **No romper funcionalidad al migrar**: inventory `dashboard-kpis` tiene card clickeable (`href` → `/dashboard/inventory/alerts`), tooltips (`Info`), dot rojo de alerta y affordance "Ver detalle" con `ChevronRight`; heredar esos extras como props/children del MetricCard si hace falta (hoy MetricCard solo soporta `href`). `analytics/kpi-card` tiene dropdown + drill-down.
- **Equipment (`equipment-stats.tsx`)**: los 5 cards usan `bg-blue-50 border-blue-200` etc. crudos — sin variante dark. Al migrar a tones se arregla el dark de paso; el icono en círculo blanco con `shadow-sm` pasa a caja tonal (no-shadows del DESIGN.md).
- **Labor page**: usa `text-xs uppercase tracking-wide` en el título — el patrón que el canónico reemplaza (OQ-2).
- **`shared/kpi-card.tsx` NO borrarlo en Task 3** hasta verificar que `KpiCard`/`KpiGrid` no se re-exporten desde `components/shared/index.ts` (o re-export interno). Mismo chequeo que se hizo con StatCard (grep de ambos nombres de export).
- **Skeletons**: `KpiCardsSkeleton` se importa en `inventory/alerts`, `stock-alerts`, `executive/page`, `dashboard/page`, `dashboard/loading`, `dashboard-kpis` (desde `shared/skeletons`). No hay que borrarlo todavía; decidir en Task 3/4 si se apunta a `MetricCardSkeleton` o se deja (conveniencia).

## 5. Archivos (separar MI trabajo del ajeno)

### De este plan (KPI cards)
- `components/ui/metric-card.tsx` (nuevo) — Task 1.
- `app/dashboard/audit/page.tsx` — StatCard→MetricCard (2 errores eslint `any` pre-existentes en líneas 64/410: **no tocar**, no son de esta tarea).
- `components/assignments/assignment-stats.tsx` — 6 cards migrados.
- `components/schedules/schedule-stats.tsx` — 4 cards migrados.
- `components/dashboard/compliance-metrics.tsx` — 4 cards migrados + tokens semánticos en subtítulos.
- `components/ui/stat-card.tsx` — **ELIMINADO** (no reintroducir; grep global 0 referencias).
- `tasks/plan-kpi-cards-unificados.md`, `tasks/todo-kpi-cards-unificados.md` — plan + checklist (todo marca tasks 1-2 done).

### Ajenos (NO committear juntos — otro workstream, "workflow review critique")
- `app/api/workflows/history/route.ts`, `components/workflow/workflow-history-table.tsx`, `tasks/todo-workflow-review-critique.md`, `components/workflow/review-status-badge.tsx` (nuevo), `lib/utils/score.ts` (nuevo).
- Hay además un stash: `stash@{0}: On main: other-workstream-exec-summary`.

## 6. Próximos pasos sugeridos (orden exacto del plan)

1. **(Bloqueante) Verificación visual**: `pnpm run dev` y revisar en navegador (o arreglar agent_browser) el render de MetricCard en los 4 sitios migrados (audit, assignments, schedules, compliance en `/dashboard`), en light y dark. Confirmar OQ-1..3 en pantalla.
2. **Task 3**: migrar `app/dashboard/civil-protection/page.tsx`, `app/dashboard/inventory/alerts/page.tsx`, `components/analytics/kpi-templates.tsx`, `components/inventory/expiration-report.tsx`, `components/inventory/stock-alerts.tsx` (KpiCard→MetricCard, KpiGrid→MetricGrid). Chequear re-exports antes de borrar `components/shared/kpi-card.tsx`.
3. **Task 4**: `components/dashboard/kpi-summary-cards.tsx` (barra de meta → `progress`; hoy usa `h-1.5 bg-muted rounded-full` con fill `bg-emerald-500`/`bg-amber-500`/`bg-destructive` → mapear a tokens/tone) y `components/dashboard/executive-summary.tsx` (5 cards alert strip, ya casi canónico: icono en caja `p-2 rounded-md` → alinear a `h-8 w-8 rounded-lg` y tipografías).
4. **Task 5**: `app/dashboard/labor/page.tsx` (4 KPI del ribbon), `components/performance/performance-dashboard.tsx` (3), `components/compliance/compliance-dashboard.tsx` (4), `components/compliance/corporate-compliance-grid.tsx` (3 primeros cards; grid tabular fuera de alcance).
5. **Task 6**: `components/inventory/dashboard-kpis.tsx` (preservar href/tooltips/dot/"Ver detalle") y `components/inventory/executive-dashboard.tsx` (KPICard inline → MetricCard; mantener `font-mono` que ya usa).
6. **Task 7**: `components/equipment/equipment-stats.tsx` (5 cards → tones; arreglar dark; círculo blanco con shadow → caja tonal) y `components/dashboard/executive/kpi-hero-cards.tsx` (HeroCard → MetricCard + MetricGrid `xl:grid-cols-3`; conservar el delta badge opcional).
7. **Task 8**: `components/analytics/kpi-card.tsx` — solo alinear header/valor tipográfico, conservar el resto. `components/sales/financial-kpi-cards.tsx` — verificar (esperado: sin cambios).
8. **Cierre**: grep final `stat-card|shared/kpi-card` vacío; `pnpm run build` (timeout ≥900s) + `pnpm run lint` + `pnpm test:e2e`; commit por separado de MI trabajo (ver §5) y mark todo complete.

## 7. Comandos útiles

```bash
pnpm exec eslint <file>                 # lint rápido por archivo
pnpm exec tsc --noEmit                  # ~1-3 min; reintentar si sale vacío con exit≠0 (fork cygwin)
grep -rn "shared/kpi-card\|KpiGrid" app components --include="*.tsx"
git diff HEAD -- <file>                 # verificar que el diff es solo lo esperado
```