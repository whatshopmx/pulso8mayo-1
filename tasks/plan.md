# Implementation Plan: Dashboard UI Remediation

## Overview
Remediate the dashboard UI layout to fix disorganization, information overload, MetricCard redundancy, missing calculation contexts, and announcement height fatigue.

## Architecture Decisions
1. **Unified Tabbed KPI Control**: Group the 12 metric cards into four context tabs (Overview, Compliance, Inventory, Labor) with 4 top-level cards visible at rest.
2. **Standard Tooltip Support**: Add a `helpText` parameter to `MetricCard` to render clean, hoverable explanation bubbles.
3. **Collapsible Announcements Feed**: Allow collapsing the pinned announcements grid at the bottom to conserve mobile viewport scroll.
4. **Keyboard Accessibility**: Introduce global shortcut listeners to allow toggling tabs, focusing search fields, and resetting parameters.

## Task List

### Phase 1: Core Layout Consolidation ($impeccable layout & distill)
- [x] **Task 1**: Refactor `app/dashboard/page.tsx` and introduce `DashboardTabbedMetrics` to manage tabs and group the 12 KPI cards.
- [x] **Task 2**: Consolidate top cards to show only 4 high-level KPIs at rest.

### Checkpoint: Layout Consolidation
- [x] Grid visual clutter reduced.
- [x] Next.js page builds cleanly.

### Phase 2: Contextual Help & Tooltips ($impeccable clarify)
- [x] **Task 3**: Modify `MetricCard` to render tooltip info icon and feed translation formulas from `compliance-metrics.tsx` and `kpi-summary-cards.tsx`.

### Checkpoint: Tooltips
- [x] Hovering over a card displays calculation formulas.

### Phase 3: Announcements & Accessibility ($impeccable quieter & adapt)
- [x] **Task 4**: Make announcements grid collapsible or horizontal carousel.
- [x] **Task 5**: Bind keyboard shortcuts for filtering and table search.

### Checkpoint: Complete
- [x] Rerun critique verifies higher score (target 32+/40).
- [x] `pnpm run build` is clean.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Tab changes delay data load | Medium | Use lightweight local state toggling; fetch all metrics upfront or wrap in Suspense fallback skeletons. |
| Tooltip overflow cuts text on mobile | Low | Use Radix tooltip/popover positioning or simple CSS absolute placement. |
