# TODO: Unificación de KPI Cards

> Plan: `tasks/plan-kpi-cards-unificados.md`
> **Bloqueantes**: resolver OQ-1 (font-mono), OQ-2 (título), OQ-3 (layout icono) antes de Task 1. El componente canónico fija el look de ~100 cards.

## Phase 1: Fundación

- [x] **Task 1 (M)**: Crear `components/ui/metric-card.tsx` (MetricCard + MetricGrid + MetricCardSkeleton)
  - Props: `label, value, icon?, tone?, delta?, subtitle?, href?, progress?, loading?, className?`
  - Grid 2/3/4/5 col; sin sombras; tokens semánticos; dark mode; variante clickeable con focus ring
  - Verificación: eslint 0 · tsc --noEmit 0 errores · next compile OK (visual demo pendiente: browser no disponible)

## Checkpoint: Fundación · review humana de OQ-1..3 antes de migrar

## Phase 2: Gemelos compartidos

- [x] **Task 2 (M)**: Migrar 4 consumidores de `StatCard` → MetricCard y borrar `components/ui/stat-card.tsx`
  - `app/dashboard/audit/page.tsx`
  - `components/assignments/assignment-stats.tsx`
  - `components/dashboard/compliance-metrics.tsx`
  - `components/schedules/schedule-stats.tsx`
- [x] **Task 3 (M)**: Migrar 5 consumidores de `shared/kpi-card` → MetricCard/MetricGrid y borrar `components/shared/kpi-card.tsx`
  - `app/dashboard/civil-protection/page.tsx` ✅ (3 cards; tones warning/destructive)
  - `app/dashboard/inventory/alerts/page.tsx` ✅ (5 cards; tones destructive/info/success; skeleton→MetricCardSkeleton)
  - `components/analytics/kpi-templates.tsx` ⛔ **excluido**: NO importa `shared/kpi-card`; su `KpiCard`/`KpiGrid` local es un catálogo de plantillas (botón +, badges, benchmark) — no una card de métrica. Verificado por grep. Decisión: no forzar MetricCard (espíritu "casos especiales NO se fuerza").
  - `components/inventory/expiration-report.tsx` ✅ (4 cards; tones warning/destructive)
  - `components/inventory/stock-alerts.tsx` ✅ (4 cards; tones warning/destructive; skeleton→MetricCardSkeleton)
  - Borrado `components/shared/kpi-card.tsx` + re-export en `shared/index.ts` ✅ (grep global 0 referencias)

## Checkpoint: gemelos eliminados · grep limpio · build + lint

## Phase 3: Tablero principal

- [x] **Task 4 (M)**: Migrar `components/dashboard/kpi-summary-cards.tsx` (preservar barra de meta vía `progress`) y `components/dashboard/executive-summary.tsx` (5 cards alert strip)
  - kpi-summary-cards: status→tone (NORMAL→success, WARNING→warning, CRITICAL→destructive); barra de meta→`progress` con caption "Meta: Xunit Y%" (extensión `progress.label`); skeleton→MetricCardSkeleton
  - executive-summary: 4 cards alert strip → MetricCard (⚠️ el strip tiene 4, no 5 — verificado en analytics-service); tone condicional count>0 ? semántico : neutral; Lotes por Vencer usa nuevo tone `primary` (conserva bg-primary/10 original)
  - Extensión canónica aprobada: tone `primary` (bg-primary/10 text-primary) + `progress.label` optativo
  - dashboard/page.tsx + loading.tsx: KpiCardsSkeleton → MetricCardSkeleton

## Checkpoint: `/dashboard` consistente · review humana

## Phase 4: Módulos con cards inline

- [x] **Task 5 (M)**: `app/dashboard/labor/page.tsx` (4 KPI) · `components/performance/performance-dashboard.tsx` (4, no 3: hay también Completion Rate) · `components/compliance/compliance-dashboard.tsx` (4) · `components/compliance/corporate-compliance-grid.tsx` (4 KPI; el 4to "Desviaciones y Alertas" también es card de métrica → migrado; tabular = chart comparación, fuera)
  - Extensión canónica: prop `children` (fila extra bajo delta/progress — necesaria para best/worst branch, y en Task 6 para tooltips/"Ver detalle")
- [ ] **Task 6 (M)**: `components/inventory/dashboard-kpis.tsx` (4; preservar href/tooltips/dot) · `components/inventory/executive-dashboard.tsx` (KPICard inline)
- [ ] **Task 7 (M)**: `components/equipment/equipment-stats.tsx` (5; tones semánticos, eliminar bg crudo sin dark) · `components/dashboard/executive/kpi-hero-cards.tsx` (HeroCard)

## Checkpoint: módulos consistentes · sin `bg-blue-50|bg-green-50|bg-purple-50` en KPI · verificación visual dark

## Phase 5: Casos especiales

- [ ] **Task 8 (S)**: `components/analytics/kpi-card.tsx` — alinear layout base, conservar drill-down/dropdown/badges. `components/sales/financial-kpi-cards.tsx` — verificar alineación (probablemente sin cambios)

## Checkpoint: Completo

- [ ] Acceptance criteria de Tasks 1-8 cumplidos
- [ ] `pnpm run build` + `pnpm run lint` en verde
- [ ] `pnpm test:e2e` sin regresiones
- [ ] Review humana final · listo para merge

## Verification rápida al final

```bash
grep -rn "StatCard\|stat-card" app components --include="*.tsx"   # 0 resultados (salvo metric-card)
grep -rn "from \"@/components/shared/kpi-card\"" app components --include="*.tsx"  # 0 resultados
pnpm run build && pnpm run lint
```