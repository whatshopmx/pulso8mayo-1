---
target: app/dashboard/finance
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-09-15T21-35-47Z
slug: app-dashboard-finance
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good loading states per card; no global "last refreshed" timestamp across the four async panels |
| 2 | Match System / Real World | 4 | Domain language is native HORECA Spanish — food cost, arqueo, P&L, corte POS, caja chica. Speaks the owner's language fluently. |
| 3 | User Control and Freedom | 2 | No way to change the period/date range on this overview; no undo after navigating into a sub-module; branch filter is global but non-obvious |
| 4 | Consistency and Standards | 3 | Component patterns (Card, badges, severity rings) are consistent; one inconsistency — KPI cards use CardDescription for the title while Attention and P&L use CardTitle |
| 5 | Error Prevention | 3 | Good partial-failure handling in MoneyAttentionPanel; explicit "this is not zero, this is no data" language. Minor: no confirmation before CSV export. |
| 6 | Recognition Rather Than Recall | 3 | Tooltips on source markers, formula explanation on margin. Missing: the section-link cards in the bottom grid don't indicate which sub-modules have pending actions |
| 7 | Flexibility and Efficiency | 2 | Alt+R shortcut for attention panel refresh is clever but undiscoverable on mobile; no keyboard shortcuts for sorting P&L; no way to pin/favorite a branch |
| 8 | Aesthetic and Minimalist Design | 3 | Flat, clean, DESIGN.md-compliant. But the page is long — four heavy cards then 12 nav tiles — and the visual rhythm between sections is uniform, making it hard to distinguish "analysis" blocks from "navigation" blocks |
| 9 | Error Recovery | 3 | Retry buttons on failed sources, human-readable error copy. P&L EmptyState could be more actionable (what data to enter to fix it). |
| 10 | Help and Documentation | 2 | Tooltip on KPI formula and P&L source markers is solid. No contextual help for first-time users; no "learn more" link for non-obvious concepts like Prime Cost |
| **Total** | | **28/40** | **Good** |

## Design Specificity Verdict

**LLM assessment**: This finance overview is strongly product-specific. The narrative arc — "¿Cómo vamos? → ¿Qué necesita mi firma? → ¿Me alcanza? → ¿Dónde gano y dónde pierdo?" — maps directly to how a Mexican HORECA chain owner actually thinks about money. The data provenance system (MEASURED / DERIVED / ESTIMATED / SECTOR_DEFAULT / NO_DATA with distinct markers) is unusually honest and domain-native; it acknowledges the messy reality of partial data in a restaurant group. The cash-vs-card proportion bar, the prime cost semaphore, and the "peor día del mes" alert all feel like they were designed by someone who has sat in a restaurant owner's Monday meeting. The page is definitively not category-interchangeable.

Missed opportunities for even stronger product character: (1) the "¿Cómo vamos?" section heading is the one deliberate narrative marker, but the other three sections rely on card titles alone — the owner's mental model has four questions, the visual only labels one; (2) the section-link grid at the bottom is competent but personality-free — it could carry urgency signals ("3 gastos sin autorizar") that connect the navigation to the live state of each sub-module.

**Deterministic scan**: `detect.mjs` returned 0 findings. Clean pass — no anti-pattern triggers in the markup.

## Overall Impression

A mature, structurally sound finance overview that respects the owner's actual decision flow and is unusually honest about data quality. The craft is evident in the P&L table's provenance system, the three-source attention panel, and the cash-flow worst-day alert. The biggest opportunity: the page currently reads as four stacked cards with a grid stapled at the bottom — it lacks a visual "chapter break" between the analytical top half and the navigational bottom half, so everything has the same visual weight.

## What's Working

1. **Data provenance is a genuine product differentiator.** The marker system (†, ‡, *, —) with accessible Radix tooltips makes every number trustworthy. The footnotes survive Ctrl+P, which is exactly what the accountant needs.

2. **MoneyAttentionPanel's partial-failure handling is exemplary.** Three independent data sources, graceful degradation with a yellow warning when one fails, and the explicit refusal to say "todo en orden" when a source is down. This is compliance-grade UI thinking.

3. **The P&L table is dense but honest.** Prime Cost semaphore, commission-by-channel breakdown in tooltips, waste tucked into the food cost tooltip, caja chica in the operating expenses tooltip — these are the right information design trade-offs for a 9-column table.

## Priority Issues

**[P1] The page is a single vertical scroll with no structural breaks.** Four analysis cards + three navigation groups = ~2500px on a 1440p screen. The transition from "analytical dashboard" to "module directory" is unmarked. The owner scrolls past the P&L table (the most valuable block) and lands in a navigation grid that looks like it could be a sidebar concern.
- **Why it matters**: Cognitive load violation #5 (Visual Noise Floor) — everything has the same visual weight. The P&L competes with the "Cortes de Ventas" link card for attention.
- **Fix**: Insert a visual divider or a secondary heading ("Accesos al módulo") with a different typographic treatment between PnlBranchTable and the section grid. Alternatively, collapse the navigation grid behind a disclosure or move it to a sidebar/bottom sheet.
- **Suggested command**: `$impeccable layout app/dashboard/finance`

**[P1] No date-range control on the overview.** The KPI cards and P&L show a fixed "current period" with no way to compare months, look at last week, or change the fiscal window. The period is displayed but not editable.
- **Why it matters**: The owner's first question after "¿cómo vamos?" is often "¿mejor o peor que el mes pasado?" — and while delta badges exist, the user can't explore time on their own. This is the single biggest functional gap for a finance command center.
- **Fix**: Add a date-range picker or period selector (this week / this month / last month / custom) at the page level, passing it to all four child components.
- **Suggested command**: `$impeccable shape app/dashboard/finance` (UX design for the date selector before code)

**[P2] Section-link cards are static — they don't carry live state.** The 12 navigation tiles show title + description but never say "3 gastos pendientes" or "2 cortes sin cuadrar." The attention panel aggregates this data, but the nav cards don't reflect it, so the owner who scrolls past the attention panel gets no signal.
- **Why it matters**: A finance module directory should behave like a triage index, not a static menu. The data to power this already exists in the attention panel's API calls.
- **Fix**: Add a badge count to cards where applicable (Gastos, Caja Chica, Cuentas por Pagar, Control Interno). Keep the current clean card layout; add a small pill badge to the right of the arrow.
- **Suggested command**: `$impeccable harden app/dashboard/finance`

**[P2] "Resumen Financiero" card title uses CardDescription instead of CardTitle.** This breaks the visual hierarchy pattern set by the other three cards (MoneyAttentionPanel, CashFlowSummaryCard, PnlBranchTable all use CardTitle for their primary heading). The result: the KPI card — the most prominent number on the page — has a visually weaker header than the attention panel below it.
- **Why it matters**: Consistency and Standards (H4). The owner's eye scans card headers for orientation; a quieter header on the first card undermines the narrative arc.
- **Fix**: Use `CardTitle` with the same `text-base font-bold` treatment. Move "Resumen Financiero" into CardTitle and the "?" tooltip into an inline suffix.
- **Suggested command**: `$impeccable layout app/dashboard/finance`

**[P3] Alt+R keyboard shortcut is undiscoverable on mobile and has no system-wide equivalent.** The `<kbd>` badge is `hidden sm:inline-flex`, so mobile users (tablet in kitchen) never see it. Other panels don't have refresh shortcuts, making this inconsistent.
- **Why it matters**: Flexibility and Efficiency (H7). A useful accelerator that exists in one card but not others creates an uneven power-user experience.
- **Fix**: Either extend the shortcut pattern to all four async cards (with a consistent visual cue), or remove the per-card shortcut and add a single page-level refresh.
- **Suggested command**: `$impeccable harden app/dashboard/finance`

## Persona Red Flags

**Alex (Power User)**: No keyboard shortcut to jump between sections on this long page. P&L table sort is mouse-only (the sort buttons are focusable but there's no shortcut key). CSV export works, but there's no "export all sections" or a way to schedule a daily email with this overview. For 15 branches, the P&L table pagination at 15 rows is adequate, but there's no column resizing or sticky header for horizontal scroll.

**Sam (Accessibility-Dependent User)**: Source markers (†, ‡, *) use `aria-hidden="true"` on the `<sup>` elements in the P&L table — the screen reader gets the tooltip text only if the user activates the Tooltip trigger, which uses `role="button"` and `tabIndex={0}`. This is correct but means the provenance information is "hidden behind an interaction" rather than inline. The severity `sr-only` text in MoneyAttentionPanel is good. The cash-flow bar chart uses `bg-chart-1` / `bg-chart-4` color-only encoding with no label inside the bar segments — meaning conveyed by color alone. Focus ring management is solid across all interactive elements.

**Casey (Distracted Mobile User)**: The page is ~2500px tall. Important data (P&L table) lives well below the fold. The section-link cards at the bottom are below all four analysis cards, forcing extensive scrolling. The P&L table requires horizontal scroll on mobile with 9 columns — `overflow-x-auto` is set, but there's no sticky first column, so the user loses track of which branch they're reading. Touch targets on tooltip triggers (the "?" buttons) meet the 28px minimum, which is good.

## Minor Observations

- The `Wallet` icon is reused for both "Caja Chica" and "Tesorería" in the section-link grid — two different modules sharing the same icon reduces scannability.
- The `Receipt` icon is reused for both "Gastos Operativos" and "Fiscal y Facturación."
- The cash-flow summary's "Sin capturar" label for initial balance could include a link to where to enter it.
- The P&L table's branch name is truncated at `max-w-[16ch]` — some Mexican branch names ("Sucursal Polanco Centro") exceed this and the truncation hides the discriminating word.
- `CashFlowSummaryCard` uses `lg:grid-cols-4` for its four stats, but `FinancialKpiCards` doesn't use a similar grid for its top-line numbers — the two cards parse differently at medium breakpoints.

## Questions to Consider

- "The owner opens this page every morning. What should they see in the first 400px that tells them whether today is normal or needs action — without scrolling?"
- "The P&L table is the crown jewel, but it sits fourth in the scroll order. What if the page opened with it, and the KPI summary folded into its header?"
- "Three of the four sections can fail independently. What does the page look like when all three APIs are slow (5+ seconds)? Is the staggered loading of four spinners useful or anxiety-inducing?"
