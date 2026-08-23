---
target: app/dashboard/finance
total_score: 33
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-23T22-11-27Z
slug: app-dashboard-finance-page-tsx
---
# Critique — Finanzas overview (app/dashboard/finance/page.tsx)

Method: dual-agent (A: design review · B: detector scan). Detector: 0 findings across app/dashboard/finance, components/finance, financial-kpi-cards.tsx. Browser evidence skipped: no browser automation exposed in session and dev server not running.

## Design Health Score: 33/40 (Good)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Four staggered spinners assemble the page with layout shift; no aria-live, no "as of" timestamp |
| 2 | Match System / Real World | 4 | Solid — faltante vs sobrante weighted differently, es-MX fiscal voice throughout |
| 3 | User Control and Freedom | 3 | Third sort click silently resets; attention overflow (>8) forces navigation |
| 4 | Consistency and Standards | 3 | Kickers split into two dialects (uppercase xs vs semibold sm); native `title` where Radix Tooltip is the documented rule |
| 5 | Error Prevention | 4 | Solid — provenance before number, ≈ partial sums, NO_DATA as dash never zero |
| 6 | Recognition Rather Than Recall | 4 | Legend lives in DOM under table (survives Ctrl+P); footnotes only for methods present |
| 7 | Flexibility and Efficiency | 3 | Sort/search/filter/CSV exist but pageSize=5 forces paging through ≤15 rows |
| 8 | Aesthetic and Minimalist Design | 3 | KPI card packs ~6 information units; page tail dilutes disciplined composition |
| 9 | Error Recovery | 2 | Generic connection-error copy; partial-failure silence renders incomplete risk list as complete |
| 10 | Help and Documentation | 4 | Solid — honest "?" tooltips ("NO es utilidad operativa"), printable provenance legend |

na_heuristics: none. Cognitive load: 2/8 failures (chunking in KPI card, marker-legend working memory).

## Design Specificity Verdict
Authored, not generic — more so than the previous run. The provenance regime († / * / ≈ / —) now survives end-to-end: KPI cells, P&L tooltips, print legend, AND the CSV export ("Procedencia del margen" column). The four-question narrative is visible as muted kickers and structures the page around the owner's interrogation sequence. The es-MX operational voice remains untransplantable. Weak spot unchanged: the 9-card link directory is category-interchangeable admin furniture.

## Resolution of Previous Run's Issues
- [RESOLVED] Nine undifferentiated cards → clustered into 3 labeled groups.
- [RESOLVED] Invisible 4-question narrative → visible kickers + escalated attention header band.
- [RESOLVED] P&L density anti-reference → 7 columns, dot confidence, merma in tooltip.
- [PARTIAL] Decorative red → muted glyphs fixed, but a NEW red-discipline violation appeared (see P1 below).
- [RESOLVED] No sorting → sortable Venta Neta/Utilidad with aria-sort; NO_DATA sinks.
- [NEW GAP] Period still absent on screen and CSV — now more damaging because the CSV exists and travels to the contador without it.

## Strengths
1. Provenance system is end-to-end including export — the page's identity survives Ctrl+P and CSV.
2. Severity triage is opinionated (faltante > sobrante, ≥48h expense escalation) with muted glyphs keeping Operational Red in budget while the header band carries the alarm.
3. Null-honesty in treasury ("Sin capturar"/"Sin estimar") refuses to fake certainty on a cash-position screen.

## Priority Issues
1. [P1] Negative utilidad sits on a success-tinted cell — ProfitCell applies bg-success/5 unconditionally; only text flips red. "Dónde pierdo" glows faintly green exactly when scanning for losses. Fix: condition tint on cents >= 0 or drop it. Cmd: $impeccable colorize
2. [P1] The central deliverable states no period — not in CardDescription, not in the CSV (only export date). The contador cannot file an undated artifact. Fix: render período in header, add to CSV header/filename. Requires backend to expose startDate/endDate (documented gap in tasks/todo-finance-critique-p2.md). Cmd: $impeccable harden
3. [P2] Partial-failure silence in MoneyAttentionPanel — one failed source renders an incomplete risk list as if complete, violating the page's own stated ethic ("nunca una afirmación de cumplimiento que nadie verificó"). Fix: per-source failure banner + retry. Cmd: $impeccable harden
4. [P2] Pagination (pageSize=5) breaks "verlas juntas" — owners of 6+ branches page through their own P&L; sort/filter resets page. Fix: raise to 15 or drop pagination below ~20 rows. Cmd: $impeccable distill
5. [P2] Kicker budget exceeded — four uppercase eyebrows + a fifth differently-styled group label; DESIGN.md caps tiny uppercase kickers at one deliberate use. Fix: keep one kicker, fold other questions into card titles. Cmd: $impeccable layout

## Persona Red Flags
- Alex (power user): pages 3×5 to find worst branch; >8 attention items become homework; third sort click invisible reset; four staggered spinners.
- Sam (a11y): DeltaBadge + truncated names use native title (invisible to SR/keyboard); NoteTip trigger is a mystery focus stop (tabIndex span, no role/aria); loading→loaded has no aria-live; confidence dot meaning is tooltip-only at magnification. Positive: aria-sort, sr-only severity, focus rings well done.
- Contador externo: CSV undated and unnamed by company/group; per-line provenance map lost (only weakestLine exported); tooltip-only content (merma amounts, method notes) doesn't survive print despite the legend.

## Minor Observations
display:flex on TOTAL GRUPO td can distort row height; worstDay.date rendered raw ISO (not es-MX); efectivo/tarjeta bar colors have no key; "Resumen Financiero" description redundant with kicker and subtitle; export/search buttons rely on self-start hacks; 16ch truncation aggressive with hover-only fallback.

## Questions to Consider
- If everything fails at once, does this page still obey the One Voice Rule — or does it need a "the one thing" mode?
- Should calm carry a timestamp the way estimates carry † — when did the three checks last run?
- Do the nine link cards still earn ~40% of the page now that Finanzas has a real narrative front door?
