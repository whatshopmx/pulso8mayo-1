---
target: app/dashboard/sales
total_score: 23
p0_count: 0
p1_count: 2
timestamp: 2026-08-04T15-20-16Z
slug: app-dashboard-sales
---
# Critique — app/dashboard/sales (dashboard + mapping)

Method: ⚠️ DEGRADED: single-context (no sub-agent tool exposed in this session)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toast on fetch error, loading spinners, clearable filters — solid |
| 2 | Match System / Real World | 3 | Spanish + POS/HORECA terms (cortes, canal, food cost %) read native |
| 3 | User Control and Freedom | 3 | Filters clearable, tabs, "Volver a Ventas" back link, delete confirm |
| 4 | Consistency and Standards | 2 | Charts/status use hardcoded #10b981, #f43f5e, green-500, yellow-500 instead of OKLCH tokens; off-ramp 10/11px micro-type |
| 5 | Error Prevention | 2 | Delete confirm present, but date-range start>end not validated → silent empty |
| 6 | Recognition Rather Than Recall | 3 | Tabs labeled icon+text; mapping empty state teaches + offers CTA |
| 7 | Flexibility and Efficiency | 1 | No keyboard nav, no batch, no table sort/columns |
| 8 | Aesthetic and Minimalist Design | 2 | 8 stacked hero-metric KPI cards (FinancialKpiCards 4 + SalesDashboard 4) — banned pattern, visual monotony |
| 9 | Error Recovery | 3 | Toast names the problem + shows server message on cut fetch failure |
| 10 | Help and Documentation | 1 | No tooltips/contextual help; inline copy only |
| **Total** | | **23/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: The strongest slop tell is structural, not chromatic: the Analytics tab stacks two 4-up KPI card rows (`FinancialKpiCards` then `SalesDashboard`'s own KPI strip) — eight near-identical big-number cards in a vertical column. That is the hero-metric template at scale and DESIGN.md bans it. The mapping page's teaching empty state, by contrast, is genuinely good product craft.

**Deterministic scan**: 6 findings, all advisory `design-system-font-size` — off the DOCUMENTED type ramp:
- `app/dashboard/sales/mapping/page.tsx` lines 121, 149 (10px); 144, 156 (11px)
- `app/dashboard/sales/page.tsx` lines 321, 330 (10px)
No detector hits for gradient-text, side-stripes, glassmorphism, eyebrow kickers, or numbered scaffolding — the absolute bans are clean.

**Visual overlays**: No reliable user-visible overlay. These are authenticated dashboard routes requiring DATABASE_URL + better-auth session + seeded branches; dev server cannot be started reliably offline. Fallback signal: source-level review + detector only.

## Overall Impression
The best-teaching and worst-trending surface in the same module: mapping is a model empty-state page; the sales dashboard stacks KPI cliché on KPI cliché and ignores its own color tokens on the charts. Biggest opportunity: collapse the two KPI rows into one coherent financial summary and pull charts onto the documented OKLCH ramp.

## What's Working
- **Mapping empty state teaches**: icon + headline + one-line guidance + "Crear primera plantilla" CTA — exactly the "empty states that teach the interface" rule. The cuts empty state should learn from this.
- **Error visibility on cuts**: fetch failure → destructive toast with the server message. This is the error-recovery model the finance pages lack.
- **Filter hygiene**: branch + date range + a conditional "Limpiar" reset, all inline in the card header. Good control without a separate filter drawer.

## Priority Issues
- **[P1] Double hero-metric stack**: Analytics tab renders `FinancialKpiCards` (4 cards: Food Cost, Labor Cost, Prime Cost, Margin) immediately above `SalesDashboard`'s own 4 KPI cards (Venta Total, Ticket Promedio, Efectivo vs Tarjeta, Canal Principal) — 8 identical big-number cards in a single scroll. Banned by DESIGN.md Don'ts and the absolute bans; also a working-memory violation (>4 metrics at once).
  - Fix: merge into a single intentional financial summary — one primary number (Venta Total) + a compact ratio strip (Food/Labor/Prime %) + earnings/payments inline. Demote channel principal into the chart it already lives in.
  - Suggested command: `$impeccable distill`

- **[P1] Color drift off OKLCH tokens on charts + status**: SalesDashboard area/bar charts hardcode `#10b981` and `#f43f5e`; cut status uses raw Tailwind `green-500`/`yellow-500` for Validado/Observación. DESIGN.md defines `chart-1..5` and `success`/`warning`/`info`/`destructive` OKLCH tokens — none are used here.
  - Fix: bind charts to the chart-1..5 ramp via CSS vars; status Validado → `success`, Observación → `warning`. Align with cash-flow page so Entradas/Salidas share one ramp across the module.
  - Suggested command: `$impeccable colorize`

- **[P2] Off-ramp micro-type (detector)**: 10/11px in mapping (mapped-column pills, metadata) and 10px status notes in the cuts table — below the documented label floor (0.75rem = 12px) and hard to read at zoom.
  - Fix: bump everything ≥12px (label step); keep hierarchy via weight/opacity not sub-12px sizes.
  - Suggested command: `$impeccable typeset`

- **[P2] Date-range filter has no validation**: start date after end date silently yields an empty cuts table with "No se encontraron cortes" — indistinguishable from "no data."
  - Fix: validate start≤end inline; show an inline hint or disable the fetch while the range is invalid.
  - Suggested command: `$impeccable harden`

## Persona Red Flags

**Alex (Power User)**: No batch actions, no table sort, no keyboard nav between tabs/cuts, no column toggle on a 10-column cuts table — heavy data view with no power-user accelerators. `confirm()` native dialog on template delete breaks flow.

**Sam (Accessibility)**: Tabs have icon+text (good). But 10px validation/status notes and 10-11px mapping metadata fail low-vision + 200% zoom. Recharts charts (sales trend, channel bars) are SVG with no aria-label/role and keyboard-inaccessible. Status "Validado/Observación" uses color (green-500/yellow-500) plus an icon — color is redundant but the raw tailwind hues won't track dark mode tokens.

**Riley (Stress Tester)**: start>end date range → empty result with no error (silent). The `SalesDashboard` keeps its own branch selector independent of the page-level `FinancialKpiCards.branchId` — selecting a branch in the dashboard does NOT update the KPI cards above it (two disconnected `selectedBranch` states), a real consistency bug. `if (!summary) return null` renders blank with no empty state.

## Minor Observations
- Two separate branch selectors on one Analytics tab (page-level for KPI cards, dashboard-level for charts) operate independently — confusing.
- Cuts empty state is minimal ("No se encontraron cortes" + icon) vs mapping's rich teaching empty state — inconsistent empty-state vocabulary.
- "Efectivo vs Tarjeta" card uses two stacked rows of tiny text where a single ratio bar would carry more information in less space.

## Questions to Consider
- The Analytics tab shows 8 KPI cards. Which of those does an owner actually act on daily — and which could fold into a chart?
- Should the page-level branch selector drive both the KPI cards and the dashboard charts (single source of truth) instead of two independent selectors?
