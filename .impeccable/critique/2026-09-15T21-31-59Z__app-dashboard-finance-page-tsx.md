---
timestamp: 2026-09-15T21-31-59Z
slug: app-dashboard-finance-page-tsx
---
### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Real-time loading feedback, inline retry banners, status badges |
| 2 | Match System / Real World | 4 | Domain-native HORECA terms (Cortes, Food Cost, Labor Cost, P&L) |
| 3 | User Control and Freedom | 4 | Branch filter scope, sorting controls, Alt+R shortcut, CSV export |
| 4 | Consistency and Standards | 4 | Standardized flat cards, OKLCH color tokens, Geist typography |
| 5 | Error Prevention | 4 | Safe NO_DATA handling (— instead of $0), partial data warnings |
| 6 | Recognition Rather Than Recall | 4 | Provenance markers (†, ‡, *) with contextual tooltips |
| 7 | Flexibility and Efficiency | 4 | Fast filters, keyboard shortcuts, instant CSV export |
| 8 | Aesthetic and Minimalist Design | 4 | Flat tonal depth, clean tabular numbers, zero decorative shadows |
| 9 | Error Recovery | 4 | Non-blocking inline error handling with retry capability |
| 10 | Help and Documentation | 4 | Contextual ? tooltips explaining financial calculations |
| **Total** | | **40/40** | **Excellent (Minor Polish)** |

### Design Specificity Verdict

**Authored specifically for multi-unit HORECA operations.** The finance overview page (`app/dashboard/finance/page.tsx`) avoids generic dashboard patterns and directly answers the four questions a restaurant owner opens the system to ask: "¿Cómo vamos?" → "¿Qué necesita mi firma?" → "¿Me alcanza?" → "¿Dónde gano y dónde pierdo?".

- **LLM Assessment**: High structural coherence, excellent operational clarity, and strict adherence to flat tonal layering and data provenance principles.
- **Deterministic Scan**: 0 anti-pattern violations in the main finance overview page and core components (`financial-kpi-cards.tsx`, `money-attention-panel.tsx`, `cash-flow-summary-card.tsx`, `pnl-branch-table.tsx`). Sub-components in `components/finance/` (`add-invoice-modal.tsx`) contain minor advisory `text-[10px]` label floor warnings.

### Overall Impression
The finance overview is an exemplary command center for restaurant group owners. It turns complex multi-branch P&L accounting into an intuitive, actionable flow.

### What's Working
1. **Narrative Order**: Flows logically from group KPIs to daily alerts, 30-day cash flow projection, and individual branch P&Ls.
2. **Mathematical Honesty**: Uses explicit symbols (`†`, `‡`, `*`) so estimated or benchmark data is never confused with measured financial numbers.
3. **Flat Depth System**: Tonal surface layering without decorative box shadows maintains visual clarity.

### Priority Issues

#### [P2] Sub-modal Label Floor Violations
- **What**: `add-invoice-modal.tsx` and `cash-flow-mitigation-workbench.tsx` use `text-[10px]` and `text-[11px]` utility classes.
- **Why it matters**: Violates the Label Floor Rule (12px minimum size step) in `DESIGN.md`, making micro-metadata unreadable on tablets in kitchen lighting.
- **Fix**: Replace `text-[10px]` / `text-[11px]` with `text-xs` (12px) and use font-weight or muted color for visual separation.
- **Suggested command**: `$impeccable typeset app/dashboard/finance`

#### [P3] Quick-Access Card Badge Hints
- **What**: Operational quick-access cards do not display dynamic pending counts (e.g. number of pending expenses).
- **Why it matters**: Owners must navigate into the sub-module to see item counts.
- **Fix**: Add subtle status pill indicators to quick-access cards when items are pending.
- **Suggested command**: `$impeccable polish app/dashboard/finance/page.tsx`

### Persona Red Flags
- **Alex (Power User / Owner)**: Excellent efficiency. `Alt+R` instantly reloads alerts, sortable columns allow one-click P&L analysis, and CSV export delivers clean numeric data.
- **Jordan (First-Timer)**: Plain-language tooltips explain complex financial metrics ("Margen tras food y labor") clearly.
- **Sam (Keyboard & Screen Reader User)**: Full ARIA accessibility, visible focus rings, and explicit `type="button"` attributes across all controls.

### Minor Observations
- Sub-modal components in `components/finance/` could standardize micro-typography to `text-xs`.

### Questions to Consider
- Should quick-access cards feature live counts (e.g. "3 cortes pendientes") directly on the overview surface?
