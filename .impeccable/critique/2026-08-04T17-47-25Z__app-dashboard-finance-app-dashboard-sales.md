---
target: app/dashboard/finance,app/dashboard/sales
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-08-04T17-47-25Z
slug: app-dashboard-finance-app-dashboard-sales
---
# Design Critique: Finance & Sales Dashboards

**Target:** `app/dashboard/finance/*` + `app/dashboard/sales/*`
**Date:** 2025-08-04

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Loading/error/empty states solid; missing upload progress for POS files |
| 2 | Match System / Real World | 3 | Spanish-first, HORECA-appropriate. Minor EN leakage ("Food Cost %") |
| 3 | User Control and Freedom | 3 | Back nav, cancel dialogs, clearable filters. No undo |
| 4 | Consistency and Standards | 4 | Strongest axis. Identical vocabulary, layout, and tone across all 5 pages |
| 5 | Error Prevention | 2 | Confirmation dialogs for destructive actions, but no smart defaults or inline validation |
| 6 | Recognition Rather Than Recall | 3 | Labeled icons, visible actions. Actions always visible (good) |
| 7 | Flexibility and Efficiency | 2 | Branch filter + date range but no keyboard shortcuts, bulk ops, or favorites |
| 8 | Aesthetic and Minimalist Design | 4 | Clean, purposeful. Follows DESIGN.md faithfully. No banned patterns detected |
| 9 | Error Recovery | 2 | Retry buttons on failures, toast on actions. No undo on approvals |
| 10 | Help and Documentation | 1 | Weakest axis. No tooltips, contextual help, or onboarding cues |
| **Total** | | **27/40** | **Good — solid foundation, addressable gaps** |

## Anti-Patterns Verdict

**Does this look AI-generated? No.** The surfaces across finance and sales are consistently tuned to the Pulso DESIGN.md system. The Geist family, the OKLCH palette anchored on Operational Red, the flat tonal layering, and the restraint in color application are all deliberate and consistent across every file.

**Deterministic scan:** Zero findings. The codebase is structurally clean: no gradient text, no ghost-card patterns, no glassmorphism, no 32px+ radius cards, no side-stripe borders, no sketchy SVGs.

**Visual overlays:** Not available — browser injection could not be performed.

## Overall Impression

These five pages form a coherent, production-grade financial operations module. The consistency is the standout. The Petty Cash page's threshold bar + balance display is the strongest individual surface; the Expenses page's approval flow with confirmation dialog is the most complete interaction pattern.

The single biggest opportunity: the KPIs show hardcoded placeholder data (Food Cost = 28.5%, Labor Cost = 26.2%) with no indication they're not real.

## What's Working

1. Cross-surface consistency. All five pages share identical patterns: same heading composition, same filter layout, same table styling. The visual vocabulary is locked in.
2. The Petty Cash balance card. The threshold bar inside the card body, inline with the balance number, is the right level of visual hierarchy. No nested cards, no separate widget.
3. Error and empty state vocabulary. Every component uses the shared EmptyState pattern consistently. Loading states are uniform. Error states have retry buttons.

## Priority Issues

### [P1] Hardcoded placeholder data shown as real KPIs
FinancialKpiCards displays foodCostPct: 28.5 and laborCostPct: 26.2 with status badges as if computed from real data. Replace with an explicit "datos no disponibles" state when the backend doesn't return real values.
**Suggested:** `$impeccable harden app/dashboard/sales`

### [P1] No contextual help for domain-specific terms
"Food Cost %", "Labor Cost %", "Costo Primo", "Margen Restante" used without explanation. Add tooltips with one-sentence definitions.
**Suggested:** `$impeccable clarify app/dashboard/sales`

### [P2] Inline ternary chains for badge variants
RatioCell and getSourceBadge use fragile 10-line ternary chains to build badge classes instead of leveraging Badge's existing variant system.
**Suggested:** `$impeccable extract components/ui/badge`

### [P2] Calendar grid uses emoji as icon
CashFlowCalendar uses raw Unicode ⚡ instead of the Lucide Zap icon already available.
**Suggested:** `$impeccable polish app/dashboard/finance/cash-flow`

### [P3] Date filters lack smart defaults
Sales date filters start empty with no "last 7 days" or "this month" shortcuts.
**Suggested:** `$impeccable layout app/dashboard/sales`

## Persona Red Flags

### Alex (Power User — Restaurant Group Owner)
- No keyboard shortcuts. Must mouse-click every approval individually.
- 6 pending expenses = 12 clicks (approve button + confirm dialog each). No bulk approve.
- Branch selector resets to ALL when navigating between finance sub-pages instead of persisting.

### Jordan (First-Timer — New Operations Manager)
- "Food Cost %" and "Costo Primo" unexplained. Sees numbers with confidence badges but doesn't know what they mean.
- "Registro de Cortes" tab assumes knowledge of POS file formats. No example file or format guide.
- Mapping templates page is fully technical — "reglas de autodetección y mapeo de archivos" without explanation of what mapping is or why it matters.

### Sam (Accessibility-Dependent)
- Chart alternatives exist via sr-only data tables (excellent and rare).
- Status conveyed by color + icon + text (good).
- Threshold bar and cash-vs-card proportion bar use color alone with no text alternatives.

## Minor Observations

1. TabsList max-w-md leaves empty space on wide screens. Consider w-fit.
2. chart-1 through chart-5 colors are well-chosen for financial data.
3. The "sin caja chica" empty state has the best copy in the module.
4. Dashboard layout's bg-muted/20 wrapper reinforces tonal layering system cleanly.

## Questions to Consider

1. What would a unified financial overview look like across Sales, Expenses, Petty Cash, and Cash Flow?
2. Should the branch selector persist across the finance module instead of resetting to ALL?
3. Are the hardcoded Food Cost / Labor Cost placeholders signaling an imminent backend integration or a distant one?
