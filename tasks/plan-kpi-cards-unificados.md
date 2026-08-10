# Plan: Unificación de KPI Cards en dashboards de módulos

## Overview

Hoy cada dashboard de módulo renderiza sus tarjetas de KPI con un componente distinto (12+ implementaciones: `StatCard`, `shared/kpi-card`, `KpiSummaryCards`, `HeroCard`, `DashboardKpis`, `KPICard` inline de inventario ejecutivo, cards inline de labor/performance/compliance/equipment/finance/analytics). El mismo dato — un número, un delta, un icono — se dibuja con tipografías, tamaños, fondos e iconos incompatibles entre módulos (p. ej. `font-mono text-xl` en inventario vs `sans text-2xl` en labor vs `text-3xl` en el hero ejecutivo, y `bg-blue-50` sin variante dark en equipment).

El objetivo: un componente canónico `MetricCard` + grid, alineado a los tokens de `DESIGN.md` (flat, sin sombras, capas tonales, Geist, semánticos success/warning/destructive/info), y migrar los ~20 sitios dependientes. Los paneles con función extra (drill-down de analytics, barras de financial) conservan su funcionalidad y adoptan solo el layout base visual.

## Architecture Decisions

- **Componente canónico único**: `components/ui/metric-card.tsx` exporta `MetricCard` y `MetricGrid`. Reemplaza a `StatCard` y `shared/kpi-card` (se eliminan esos dos archivos para no dejar gemelos).
- **Tokens, no colores crudos**: la paleta de acentos usa los tokens semánticos existentes (`succss/warning/destructive/info` con variantes `bg-*-10` y `text-*`). Se elimina el uso de `blue/green/yellow/purple` crudo de equipment (que no tiene variante dark). El proyecto ya demostró este patrón en `financial-kpi-cards.tsx` (`STATUS_COLORS` con `bg-success` + `statusBadgeClasses`).
- **Valores numéricos en `font-mono`**: `DESIGN.md` asigna mono a "numeric data". Es el único uso divergente que hoy tiene inventario; se propone generalizarlo. *Decisión abierta OQ-1.*
- **Título del KPI**: label token del sistema (`text-sm font-medium text-muted-foreground`), sin uppercase ni tracking (el uppercase de labor era el outlier). *Decisión abierta OQ-2.*
- **Icono**: caja tonal en la esquina superior derecha (`p-2 rounded-lg` con fondo `bg-muted` o `bg-<tone>/10` + `text-<tone>`), patrón del hero ejecutivo y del alert strip. *Decisión abierta OQ-3.*
- **Skeleton**: `MetricCardSkeleton` reemplaza a `KpiCardsSkeleton` (se mantiene el nombre de export `KpiCardsSkeleton` durante la migración para minimizar cambios, luego se depura).
- **Casos especiales NO se fuerza**: `analytics/kpi-card.tsx` (drill-down, dropdown, targets) y `financial-kpi-cards.tsx` (barras + semáforo + marcadores †/*) heredan el header/valor/icono canónico pero conservan sus extensiones funcionales. Financial ya usa tokens semánticos → tarea solo de alineación menor; se marca como excluida si el header se considera ya canónico.

## Task List

### Phase 1: Fundación

- [ ] **Task 1 (M)**: Crear `MetricCard` + `MetricGrid` + `MetricCardSkeleton` en `components/ui/metric-card.tsx`, con props: `label, value, icon?, tone? (default|success|warning|danger|info), delta? {value,label,direction}, subtitle?, href?, loading?, className?` y grid responsive (2/3/4/5 col). Incluye variante clickeable (`href`) con focus ring y affordance opcional (patrón inventory).
  - Verificación: `pnpm run build`; render manual en `/dashboard` temporalmente.

### Checkpoint: Fundación
- [ ] Build limpio, componente demo verificado visualmente contra DESIGN.md (sin sombras, tokens semánticos, dark mode OK)
- [ ] Revisión humana de OQ-1..OQ-3 ANTES de migrar (el componente canónico fija el look de ~100 cards)

### Phase 2: Gemelos compartidos (eliminar StatCard y shared/kpi-card)

- [ ] **Task 2 (M)**: Migrar los 4 consumidores de `StatCard` a `MetricCard` y **eliminar** `components/ui/stat-card.tsx`. Archivos: `app/dashboard/audit/page.tsx`, `components/assignments/assignment-stats.tsx`, `components/dashboard/compliance-metrics.tsx`, `components/schedules/schedule-stats.tsx`. Mapear `variant → tone`, traducir "from last period" → "vs. período anterior".
- [ ] **Task 3 (M)**: Migrar los 5 consumidores de `shared/kpi-card` a `MetricCard`/`MetricGrid` y **eliminar** `components/shared/kpi-card.tsx`. Archivos: `app/dashboard/civil-protection/page.tsx`, `app/dashboard/inventory/alerts/page.tsx`, `components/analytics/kpi-templates.tsx`, `components/inventory/expiration-report.tsx`, `components/inventory/stock-alerts.tsx`.

### Checkpoint: Gemelos eliminados
- [ ] `grep -r "stat-card\|shared/kpi-card" app components` sin resultados
- [ ] Build + lint limpios; páginas de audit/schedules/civil-protection/inventory-alerts renderizan igual de bien

### Phase 3: Tablero principal (3 estilos distintos en una página)

- [ ] **Task 4 (M)**: Migrar `components/dashboard/kpi-summary-cards.tsx` (mantener la barra de progreso hacia meta como prop `progress`) y `components/dashboard/executive-summary.tsx` (5 cards del alert strip → icono en caja tonal ya canónico, ajustar tamaños). `compliance-metrics` se cubrió en Task 2.

### Checkpoint: Tablero
- [ ] `/dashboard` muestra los 3 bloques de KPI con el mismo lenguaje visual
- [ ] Review humana del tablero (es la pantalla más visitada)

### Phase 4: Módulos con cards inline

- [ ] **Task 5 (M)**: Migrar cards inline de módulos de gestión: `app/dashboard/labor/page.tsx` (4 KPI del ribbon), `components/performance/performance-dashboard.tsx` (3), `components/compliance/compliance-dashboard.tsx` (4), `components/compliance/corporate-compliance-grid.tsx` (3 primeros cards KPI; el resto de la grid es tabular y queda fuera).
- [ ] **Task 6 (M)**: Migrar inventario: `components/inventory/dashboard-kpis.tsx` (4 cards; preservar la card clickeable `href` a alertas, los tooltips y el dot de alerta como extras opcionales del canónico) y `components/inventory/executive-dashboard.tsx` (KPICard inline → MetricCard con tone, mantener `font-mono` si OQ-1 lo confirma).
- [ ] **Task 7 (M)**: Migrar equipment y hero ejecutivo: `components/equipment/equipment-stats.tsx` (5 cards → tones semánticos, elimina `bg-*-50` crudo sin dark; el icono en círculo blanco con shadow pasa a caja tonal sin sombra) y `components/dashboard/executive/kpi-hero-cards.tsx` (HeroCard → MetricCard + MetricGrid; conserva delta badge opcional).

### Checkpoint: Módulos
- [ ] Labor, performance, compliance, inventory, equipment, executive compilan y se ven consistentes (verificación visual por módulo)
- [ ] No quedan clases `bg-blue-50|bg-green-50|bg-purple-50` crudas en componentes de KPI

### Phase 5: Casos especiales

- [ ] **Task 8 (S)**: Alinear el layout base de `components/analytics/kpi-card.tsx` al canónico (header/valor tipográfico) manteniendo drill-down, dropdown y badges de target/category. `components/sales/financial-kpi-cards.tsx`: verificar que el header ya sea canónico; solo ajustar si difiere (probablemente sin cambios).

### Checkpoint: Completo
- [ ] Todos los acceptance criteria de tasks 1-8 cumplidos
- [ ] `pnpm run build` + `pnpm run lint` en verde
- [ ] `pnpm test:e2e` sin regresiones
- [ ] Revisión humana final (listo para merge)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cambio visual brusco en equipment (fondo full-color → caja tonal) | Med | Preservar lectura semántica con border/iconos del tone; el patrón ya existe en hero y monitoring alert strip |
| `font-mono` generalizado en valores cambia percepción de todos los dashboards | Med | Es decisión OQ-1; si el usuario la rechaza, MetricCard mantiene `font-sans` y solo se iguala inventario |
| Perder funcionalidad al migrar (href de inventory, tooltips, drill-down de analytics) | Alto | MetricCard acepta `href`, `children`/extras y `onClick`; cada migración preserva los elementos funcionales como props |
| Eliminar archivos compartidos rompe imports no detectados por grep literal (exports re-exportados) | Alto | Antes de borrar, `grep -rn` por los nombres de export (`StatCard`, `KpiCard`, `KpiGrid`) en todo el repo; usar alias re-export temporal si algo queda |
| Regresión visual en dark mode por clases hardcode | Med | MetricCard construido 100% con tokens; checklist visual en `.dark` en cada checkpoint |
| Skeleton scaffolds (`KpiCardsSkeleton` usado en 7 sitios) | Bajo | `MetricCardSkeleton` hereda la misma firma (`count`, `className`) para swap sin tocar consumidores |

## Open Questions (resolver antes de Task 1..7)

1. **¿`font-mono` en los valores numéricos?** DESIGN.md asigna mono a "numeric data" y es lo que ya usa inventario; el resto usa `font-sans`. Unificar hacia mono (recomendado) o hacia sans.
2. **¿Título del KPI?** `text-sm font-medium text-muted-foreground` (frecuente hoy, recomendado) vs `text-xs uppercase tracking-wide` (patrón labor, único).
3. **¿Layout del icono?** Caja tonal arriba-derecha con color semántico (patrón hero/executive, recomendado para el "Command Center") vs icono plano muted sin fondo (patrón actual de la mayoría).
4. **Alcance de analytics/financial**: ¿se alinean solo visualmente conservando sus extensiones (drill-down/barras) — recomendado — o quedan fuera del alcance por ahora?