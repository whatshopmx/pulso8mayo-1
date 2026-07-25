---
target: app/dashboard/analytics
total_score: 21
p0_count: 0
p1_count: 2
timestamp: 2026-07-22T01-20-36Z
slug: app-dashboard-analytics
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Auto-refresh with spin animation, loading skeletons on some pages, but employee page uses a centered spinner with no progress indication |
| 2 | Match System / Real World | 2 | Mix of Spanish and English across pages — main dashboard in Spanish, employees page entirely in English, alerts dialog in English |
| 3 | User Control and Freedom | 3 | Filter resets are easy, drill-down has back button, but auto-refresh can't be fully disabled per-session |
| 4 | Consistency and Standards | 1 | KPI cards use status colors from Tailwind palette (red-500/green-500/yellow-500) instead of design tokens (success/warning/destructive). Hardcoded Recharts colors (blue-500, #10b981, #ef4444) clash with Operational Red palette. Employees page doesn't use PageContainer/PageHeader |
| 5 | Error Prevention | 2 | No confirmation before PDF export, no guardrails on filter selections, but API errors are caught |
| 6 | Recognition Rather Than Recall | 3 | Tooltips on status icons, filter labels visible, but "Drill Down" and "View Details" in dropdown are ambiguous — what's the difference? |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts for common actions (refresh, export), no bulk actions on alerts, no saved filter presets |
| 8 | Aesthetic and Minimalist Design | 2 | Filters section in a full Card with header is heavy for 3 dropdowns. Summary stats card is redundant with KPI cards below. Multiple cards stacked with no visual breathing room |
| 9 | Error Recovery | 2 | Toast notifications on errors, but no retry mechanism. Failed fetch on employees page shows a centered spinner indefinitely |
| 10 | Help and Documentation | 1 | No contextual help anywhere. KPI descriptions are truncated to one line with no way to expand. No tooltips explaining what metrics mean |
| **Total** | | **21/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**Does this look AI-generated?** Partially. The structure is clean and functional, but several tells emerge:

**LLM assessment**: The summary stats card (lines 361-392 in page.tsx) is a classic hero-metric variant — four big numbers with small labels, repeated identically on the trends page (lines 185-228). The filter section uses a full Card wrapper with header for three dropdowns — heavy scaffolding. The KPI card grid (4 columns of identical cards) is close to the "identical card grids" ban but saved by the drill-down interaction. The hardcoded color values across components (Tailwind reds/greens/yellows instead of semantic tokens) create a visual disconnect from the design system.

**Deterministic scan**: Clean scan — no automated issues detected by the detector rules.

**Visual overlays**: Overlay server started but no browser client connected.

## Overall Impression

This is a functional analytics dashboard that handles a lot of data well. The filtering and drill-down mechanics are solid. But it feels like three different pages stitched together rather than one cohesive analytics experience — the employees page doesn't use the shared layout components, colors are inconsistent across pages, and the information hierarchy doesn't guide the eye. The biggest opportunity: unify the visual language and make the data actually tell a story rather than just being presented.

## What's Working

1. **Drill-down interaction pattern** — clicking a KPI card to see its history and detail is intuitive and well-implemented. The back button and highlighted card state provide clear wayfinding.

2. **Loading skeletons on trends page** — using animated pulse placeholders instead of spinners keeps the layout stable during data fetches. This is the right pattern.

3. **Alert system with acknowledge/resolve flow** — the alert cards are well-structured with clear severity differentiation and actionable buttons. The resolve dialog with notes is a good operational touch.

## Priority Issues

### P1: Language Inconsistency Across Pages
- **What**: The main analytics page and trends page are in Spanish. The employees page is entirely in English (headers, labels, tab names, filter options). The alerts dialog is in English.
- **Why it matters**: For a product targeting Mexican restaurant owners, seeing "Employee Analytics" and "Gender Distribution" next to "Tablero de Analíticas" breaks trust. It signals the product isn't finished.
- **Fix**: Translate all employee page strings to Spanish. Standardize the alerts dialog to Spanish. Audit all analytics sub-pages for language consistency.
- **Suggested command**: `/impeccable clarify`

### P1: Hardcoded Colors Bypass Design Tokens
- **What**: Status colors in KpiCard use raw Tailwind classes (`bg-red-500`, `text-green-600`, `text-yellow-600`). Recharts charts use hardcoded hex values (`#10b981`, `#ef4444`, `#3b82f6`, `#8884d8`). The employees page COLORS array is `['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d']`.
- **Why it matters**: The design system defines semantic tokens (success, warning, destructive) in OKLCH. Hardcoded colors create visual inconsistency — the green in one chart won't match the green in another. Dark mode will break entirely.
- **Fix**: Replace all hardcoded colors with CSS variable references or design tokens. Create a chart color utility that pulls from the design system palette.
- **Suggested command**: `/impeccable colorize`

### P2: Employee Page Doesn't Use Shared Layout
- **What**: The employees page uses `container mx-auto py-6 space-y-6` instead of `PageContainer` and `PageHeader`. It has a custom header with inline styles instead of the shared component.
- **Why it matters**: Inconsistent page structure means different padding, different responsive behavior, and a jarring transition between pages. It also means any layout improvements to PageContainer won't propagate.
- **Fix**: Refactor employees page to use PageContainer and PageHeader. Add the period filter to the header actions area like other pages.
- **Suggested command**: `/impeccable layout`

### P2: Summary Stats Card Redundancy
- **What**: The main analytics page has a "Resumen" card showing total KPIs, normal, warnings, critical counts. Below it, the KPI card grid shows the same data visually with status badges and trend indicators.
- **Why it matters**: Two representations of the same data compete for attention and waste vertical space. The KPI cards are more informative (they include trends and drill-down). The summary card adds nothing the cards don't already convey better.
- **Fix**: Remove the summary stats card. If the counts are needed, add them as a compact row above the KPI cards or integrate into the page header.
- **Suggested command**: `/impeccable distill`

### P3: Filter Section Overweight
- **What**: The filter section uses a full Card with CardHeader ("Filtros" with Filter icon) and CardContent for three dropdown selectors.
- **Why it matters**: A card wrapper adds visual weight and suggests the filters are a primary content section. They're utility controls — they should be lighter.
- **Fix**: Use a more compact filter bar — a single row with inline labels and dropdowns, no card wrapper. Or use a collapsible filter section that defaults to closed on mobile.
- **Suggested command**: `/impeccable layout`

## Persona Red Flags

### Alex (Power User — Restaurant Owner Overseeing 15 Branches)
- No keyboard shortcuts for refresh (R), export (Ctrl+E), or filter toggle
- Auto-refresh pauses on user activity but there's no way to manually trigger a single refresh without the button
- "Drill Down" vs "View Details" in the KPI card dropdown — what's the difference? Alex will click both to find out, wasting time

### Jordan (First-Timer — New Operations Manager)
- "Drill Down" is jargon. A restaurant manager might not know what this means in context
- The KPI card shows a status icon but the tooltip just says "Status: WARNING" — no explanation of what the warning means or what to do about it
- Tab labels ("Tendencias", "Comparativa") don't explain what's inside — Jordan has to click each one to find the right view

### Sam (Accessibility-Dependent User)
- The KPI status badge uses color + icon, which is good, but the badge text says "TARGET" or "CRITICAL" without clear screen reader context
- The auto-refresh toggle is a small ghost button (h-6 px-2) — tiny tap target
- Charts have no text alternative — screen reader users get nothing from the Recharts visualizations
- Focus indicators not visible in the code — no `focus-visible` ring styles defined

## Minor Observations

- The `restaurant-kpi-dashboard` import on line 4 of page.tsx is imported but never used — dead code
- The `KpiTemplates` import is also unused in the main page
- The employees page imports PieChart, Pie, Cell, BarChart, Bar, LineChart, Line directly from recharts — should use the KpiChart wrapper for consistency
- The trends page has a Filter icon in the header actions area but it's purely decorative (no onClick handler)
- The auto-refresh interval (5 minutes) is quite long for a "real-time" dashboard — consider 60 seconds with a visual countdown
- The drill-down card uses `border-primary/20 bg-primary/5` which violates the flat-by-default rule — adds a tinted background to a content section

## Questions to Consider

- Should the analytics section have a unified navigation scheme (sub-tabs or sidebar) instead of separate routes? Right now you have to go back to the sidebar to switch between trends, branches, employees.
- What would a restaurant owner actually DO after seeing a KPI in critical state? The current flow stops at "view the data" — should there be a direct action button (assign a task, send a WhatsApp alert)?
- Does the employees page belong in analytics, or should it be its own section? The data model is different (HR/workforce vs. operational KPIs) and the visual treatment is already divergent.
