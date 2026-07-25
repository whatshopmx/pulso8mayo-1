---
target: app/dashboard/reports Reports page
total_score: 23
p0_count: 1
p1_count: 3
timestamp: 2026-07-23T06-59-50Z
slug: app-dashboard-reports
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | 2/4 stats cards permanently `--`; loading shows `...` instead of skeleton |
| 2 | Match System / Real World | 3 | Spanish copy appropriate; "Constructor de Reportes" ambiguous |
| 3 | User Control and Freedom | 4 | Filters, tabs, downloads all give clear exit paths |
| 4 | Consistency and Standards | 1 | No shared `PageContainer`/`PageHeader` (orphan from 13+ other dashboard pages); 3 hardcoded semantic colors in 4 cards; blue-100/600 in scheduled section |
| 5 | Error Prevention | 3 | Coming-soon dimmed correctly; generation disabled during loading |
| 6 | Recognition Rather Than Recall | 2 | 8 tabs + 4-5 actions per card = high memory load; no search, no recent/favorites |
| 7 | Flexibility and Efficiency | 3 | Standard Radix keyboard accessibility; no power-user shortcuts or bulk actions |
| 8 | Aesthetic and Minimalist Design | 1 | 4 competing semantic colors in one row; 2 dead stats as permanent noise; ~40+ visible action points on load; 8 tabs for 9 reports |
| 9 | Error Recovery | 3 | Toast feedback on generate; silent `.catch(() => {})` on all fetch errors — user never sees failures |
| 10 | Help and Documentation | 1 | No tooltips, no help text for report types or NOM differentiation |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**Does this look AI-generated?** MODERATELY. The page is structurally sound but violates specific design system rules that an unguided generator would miss.

**Bans detected:**
- ❌ **Hero-metric template** — 4 quick stats cards are the exact banned pattern: big number + small label, no trend, no context (DESIGN.md §6 explicit ban)
- ❌ **Consistency orphan** — Reports page doesn't use `PageContainer`/`PageHeader` like every other dashboard page; custom `text-3xl` header is larger than the established pattern
- ❌ **Hardcoded palette** — Scheduled section uses `bg-blue-100`/`text-blue-600` instead of system `bg-primary/10`/`text-primary`
- ❌ **Production stubs** — `handleSendReport` fires `toast.info("Enviando...")` then nothing; TODO in production code

**Deterministic scan:** CLI detector found 0 issues across 3 `.tsx` files — expected, since Tailwind class-based components require rendered HTML or a live browser for meaningful analysis. No false positives.

**Browser visualization:** Skipped — no `chrome-devtools` MCP available, and the page requires authentication.

## Overall Impression

The reports page is functional but unfinished — it was built to a different standard than the rest of the dashboard. Two of four stats cards are permanently empty, the component vocabulary diverges from the project's shared patterns, and the primary grid of 9 reports feels overwhelmed by 8 category tabs. The scheduled reports section and per-card download UX show real thought; the rest of the page reads as placeholder quality. The single biggest opportunity is **aligning this page with the rest of the dashboard's component system** and removing or completing the dead features.

## What's Working

1. **Flat, tonal, shadow-free.** Cards use `border-border`, no `shadow-*`. Good adherence to the flat-by-default rule — the one system-level decision this page gets right.

2. **Per-card generation UX.** Downloading a report shows a spinner inside that card, not a global loader. Toast confirmation after success. Good granular feedback.

3. **Meaningful scheduled section empty state.** `Calendar` icon + "No hay reportes programados" + "Programa un reporte" + CTA button. Complete pattern: state, guidance, action. All empty states should follow this model.

## Priority Issues

### P0 — Two dead stats cards with no API integration
Lines 260-277: `Cumplimiento NOM` and `Incidentes` are hardcoded to `--`. No fetch call exists for either metric. They are permanent noise that erodes trust — every glance tells the user "this system is incomplete."
**Fix**: Wire the API endpoints and hydrate them, or remove them until ready.
**Suggested command**: `/impeccable polish`

### P1 — Hero-metric template (banned anti-pattern)
Lines 237-278: The 4-card stats row is the exact banned pattern — `text-3xl` big number + small label, no trend, no sparkline, no supporting context.
**Fix**: Replace with contextual mini-cards showing trend arrows, delta from last period, or secondary info (e.g., "vs. 78% last month").
**Suggested command**: `/impeccable layout`

### P1 — Shared component orphan
Reports page writes its own header instead of using `PageContainer`/`PageHeader` like every other dashboard page. Custom `text-3xl` is larger than pattern's `text-xl sm:text-2xl`.
**Fix**: Swap to `<PageContainer><PageHeader title="Reportes" description="..." ...>`.
**Suggested command**: `/impeccable polish`

### P1 — Stubbed send action (Email/WhatsApp)
Lines 206-209: `handleSendReport` shows a toast and does nothing. Users who click either button hit a dead end.
**Fix**: Either implement the send flow or hide the buttons with a `comingSoon` flag.
**Suggested command**: `/impeccable polish`

### P2 — Hardcoded blue palette in scheduled reports section
Lines 467-468: `bg-blue-100`/`text-blue-600` instead of system `bg-primary/10`/`text-primary`.
**Fix**: Use the same icon-container pattern as the report cards above.
**Suggested command**: `/impeccable polish`

### P2 — 8 category tabs for 9 reports
Three categories contain exactly 1 report each. The tab row adds significant cognitive load without proportional value.
**Fix**: Consolidate to 3-4 broader groupings (e.g., Operaciones, Cumplimiento, Personas) and add a search bar.
**Suggested command**: `/impeccable distill`

## Persona Red Flags

**Alex (Power User, ops manager, 7 branches):**
- Can't search or sort reports. No favorites/recently used. No bulk download.
- 8 tabs waste glance-and-go speed — 3 categories have only 1 report.
- No visual diff between report card categories after filtering.

**Sam (Accessibility, keyboard-only):**
- ~45 tab stops for 9 cards × 5 actions each. No skip-to-content, no fast-nav.
- `opacity-60` for coming-soon items may not be programmatically announced as disabled.
- No focus management after tab switch.

**Doña Carmen (Restaurant owner, 4 branches, low tech literacy):**
- "Constructor de Reportes" = construction metaphor, not "customize" or "create."
- "Cumplimiento NOM" — ¿cuál NOM? 251? 035? The compliance page distinguishes them.
- No sample/preview before downloading — trust the name only.

## Minor Observations

- **Imported but unused:** `es` locale from `date-fns` is imported on line 29 but never used (`<input type="date">` uses `yyyy-MM-dd` regardless of locale).
- **Dead state:** `setReportType` includes `"compliance"` but the value is never read back from state — only sent to the API payload.
- **Machine-readable filenames:** `handleGenerateReport` uses `reportId` (e.g. `"workflow-summary"`) as the download prefix. Users expect `"Resumen de Workflows"` instead.
- **Fragile badge condition:** Line 478 applies `text-green-600 border-green-600` but it's overridden when `variant="destructive"` fires — works but brittle.
- **Send buttons too prominent for stubs:** Ghost buttons with icons for Email/WhatsApp signal a working feature but deliver nothing.

## Questions to Consider

1. **If 8 categories contain 9 reports, do you need categories at all?** Three tabs have 1 report each. Is the tab row helping or hurting findability?
2. **What does a user actually *do* on this page?** Find and download one report → leave? If that's the primary flow, the 8-tab + 5-button-per-card model is the opposite of quick.
3. **Why does the reports page not use the shared layout components when every other major dashboard page does?** This suggests isolated development — what does that say about component governance?
4. **"Constructor de Reportes" — of what?** Drag-and-drop builder, template selector, or schedule configurator? Would "Crear Reporte Personalizado" be clearer?
