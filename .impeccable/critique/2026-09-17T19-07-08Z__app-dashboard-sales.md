---
target: app/dashboard/sales
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
p2_count: 6
p3_count: 9
timestamp: 2026-09-17T19-07-08Z
slug: app-dashboard-sales
---
# Critique: app/dashboard/sales

⚠️ DEGRADED: single-context (no sub-agent tool available in this harness — Assessments A and B ran sequentially inline; A was recorded before any detector output entered synthesis).

- **Date:** 2026-09-17
- **Target:** `app/dashboard/sales/` (page.tsx, mapping/page.tsx, upload/{page,client}.tsx) + `components/sales/` (financial-kpi-cards, sales-dashboard, sales-cut-upload, tpv-batch-entry-modal) + `lib/sales/cash-variance.ts`
- **Browser evidence:** authenticated Playwright pass against `http://localhost:3000/dashboard/sales` (1280×800 + 390×844, real seeded data: 93 cortes / $1.6M / 3 sucursales). Screenshots: `.impeccable/critique/shots/desktop-analytics.png`, `desktop-cuts.png`, `mobile-analytics.png`. Detector: static pass on `app/dashboard/sales` + `components/sales`.

## Scores

- **Nielsen heuristics: 29/40 — Good (72.5%)** (prior snapshot 2026-08-04: 23/40 → +6; the A7/A8/A20/token fixes landed and score)
- **Cognitive load: moderate (2 failures)** — 12-column table row scan; primary CTA (Registrar Corte) buried one tab deep.
- **Design specificity verdict:** The section is now two-authored. `page.tsx`, `cash-variance.ts` and `sales-cut-upload.tsx` are the most product-authored money code in the repo: arqueo vs TPV deliberately separated ("un faltante de caja se esconde tras una comisión bancaria"), "sin conciliar" ≠ $0.00, error ≠ empty (A7), scope read from what the API applied (A8), delete error inside the dialog (A20), session-scoped aggregator math with honest "no se guardan" disclosure, scientific-notation-proof money parsing. But the analytics tab it defaults to is where the section leaks: a chart that renders axes with no series, a semáforo that certifies data artifacts as "Saludable", and third-party color vocabulary (red E/T bar, 100%-red TOTAL bar) that breaks the Operational-Red budget. The registry half of the screen earns its 4s; the analytics half is where the P1s live.

## Findings

### P1 — Major (fix before anything else ships)

**1. The trend chart draws axes with no series (observed, both viewports).**
Screenshot: "Tendencia de Ventas Diarias" renders grid, dates 2026-08-18→2026-09-16, y-domain 0–80,000 — and no area. Above it the KPI card asserts $1,607,385 / 93 cortes, so data exists and the domain was computed from real values. Probable cause: `sales-dashboard.tsx:70-74` feeds `dataKey="Venta"` **strings** (`(pt.totalSalesCents / 100).toFixed(2)`) — recharts computes the axis domain but the monotone path goes NaN. The module's primary analytical visual is blank while the page claims the data is there.
**Fix:** pass numbers (`totalSalesCents / 100`), format in `Tooltip formatter` and y-axis `tickFormatter` (es-MX, `$` compact). Verify with one seeded week.

**2. The semáforo certifies data artifacts as health.**
Live: Food Cost **0.9%† "Saludable"** (objetivo <28%), Labor Cost **2.3% "Saludable"**, Margen **96.8% (+298.6 pts "Saludable")**, headline delta **"+2851.8% vs. período anterior"** in success green. Provenance discipline exists († DERIVED footnote — good), but the verdict layer has no data-sufficiency state: 0.9% food cost is not "healthy", it is "no consumption data behind this number", and a gerente who cross-checks once stops trusting every green badge on the platform. Code: `financial-kpi-cards.tsx:307-317` paints **any** `salesDeltaPercent >= 0` as `text-success`, magnitude-blind.
**Fix:** sufficiency/plausibility floor before the semáforo: DERIVED cost with sparse consumption rows → neutral "Sin datos de consumo suficientes" (no "Saludable"); |delta| beyond a sane bound (say >200%) → muted "sin comparativa fiable" with the number on hover. Same rule the inventory critique applied to "X sucursales con stock".

**3. Two silent default periods on one screen.**
Header scope says "Todo el período"; the KPI card self-selects a trailing **31-day** window ("93 cortes", "Periodo: 2026-08-18 a 2026-09-17") while the cuts tab applies **mes en curso** (~45 rows) under its own scope echo. The same noun — "cortes" — shows 93 and 45 on one URL, reconciled only by small print. Violates "one platform, one truth" at the point of the module that preaches it.
**Fix:** derive the KPI/analytics window from `cutsScope` (what the API actually applied) or echo the applied window in the KPI card's scope line; never let two components invent defaults from the same empty input.

### P2 — Minor (next pass)

**4. Cuts table: 12 columns, horizontal scroll at 1280, clipped truth.** Screenshot: right edge cuts "Cierre de turno validado automáticament…" mid-word; "Recibido por" is off-viewport entirely; no sort, no search, no pagination, no way to rank by variance — the banner says "2 cortes con diferencia" and then the user hand-scans 45 rows to find them (Alex persona dead end). No `aria-sort` anywhere.
**Fix:** collapse Formas de Pago + Arqueo + Terminal into one "Conciliación" group cell (the data already stacks vertically); `line-clamp` + Radix tooltip for `validationNotes`; sortable Fecha/Venta/Diferencia headers; keep the date column sticky on scroll.

**5. Semantic colors doing categorical work.** Live: 45 amber "Manual" badges (warning token), amber "Vespertino" shift badges, green "WhatsApp" origin badges, green "Diferencia: cuadrado" text on every row. When amber means "a shift" and green means "a source", they stop meaning caution/ok exactly where the module needs them to (the variance banners). DESIGN.md: red sparingly; the same reserve applies to the whole semaphore.
**Fix:** categorical badges → neutral/outline (`bg-muted text-muted-foreground` or plain outline); reserve success/warning/destructive for verdicts (cuadrado/faltante, validado/observación). "cuadrado" text → muted "✓ Cuadrado" chip; color only the exceptions.

**6. Operational Red spent on decoration.** The E/T proportion bar paints Efectivo **red** (`bg-chart-1`) and the channel breakdown paints a **100%-width red bar** (`bg-primary`) for a neutral TOTAL row — plus red `Coins`/`BarChart3` icons on three card titles. Red as category competes with red as alarm, and blows the 10-15% budget on the analytics tab.
**Fix:** cash/card bar → `bg-chart-3`/`bg-chart-4` (or muted/foreground); channel bars → chart palette per channel; card-title icons → `text-muted-foreground`.

**7. Analytics tab: two independent fetches, failures that ask for a page reload.** `SalesDashboard` and `FinancialKpiCards` fetch on their own (two spinners, staggered paint), and their failure EmptyStates say "recarga la página" with no action — while the cuts table below sets the standard with a proper Reintentar button. Also `title={tpvVarianceNote(tpv)}` at `page.tsx:569` is hover-only (keyboard/SR unreachable) — the exact anti-pattern the h1 `?` button comment says this module eradicated.
**Fix:** retry action in both failure states; consider one coordinated skeleton for the tab; swap the TPV `title` for the Radix tooltip pattern used two components over.

**8. Drag-and-drop promised, not implemented.** Dropzone copy "Selecciona o arrastra el reporte del POS" (`sales-cut-upload.tsx:337`, `upload/client.tsx:252`) with zero drag handlers — drag does nothing silently (Riley red flag in the module's core flow).
**Fix:** implement `onDragOver/onDrop` or change the copy to "Selecciona el reporte del POS".

**9. Orphaned duplicate ingestion UI.** `/dashboard/sales/upload` (full-page variant, nicer type scale) is linked from nowhere (only `HANDOFF-FASES-4-10.md` mentions it), and lacks the TPV conciliation fields the dialog has — two flows for the same job with divergent capability. Its icon circle also uses `shadow-sm` + `group-hover:scale-105` against flat-by-default.
### P3 — Polish

- **10.** Detector: `text-[11px]` off the type ramp — `tpv-batch-entry-modal.tsx:461` → `text-xs`.
- **11.** `receivedAt` renders bare time (`page.tsx:630-635`) — in a month-wide table "12:34" has no day context. Short date+time.
- **12.** Two toast systems in one module: `useToast` everywhere, `sonner` in `tpv-batch-entry-modal.tsx:28`.
- **13.** TPV empty-terminal state names a destination ("Finanzas → Configuración → Terminales TPV") without a Link.
- **14.** Aggregator empty state cites "Smart Link" jargon with no link or definition.
- **15.** Breadcrumb says "Sales" (segment leak) while the sidebar says "Cortes de Ventas" — `breadcrumb-dynamic` needs a label map.
- **16.** h1 contains the `?` help button — SRs announce the help text as part of the heading. Move it outside `h1` (keep the pattern).
- **17.** KPI margin row wraps awkwardly on mobile: the `?` bubble floats between delta and value (screenshot). Stack label+help / delta+value.
- **18.** Hydration mismatch error observed once on first load (1 of 2 runs): "server rendered HTML didn't match the client" — prime suspect is the `new Date().toLocaleDateString("en-CA", …)` default in the upload form or locale formatting during SSR. Intermittent; worth a targeted fix + re-test.

## Persona walk-through (2 project personas + Sam)

- **Alex (power user):** Registering a cut = switch tab → click CTA → dialog: 3 clicks, fine. Finding the biggest variance of the month: impossible without scanning (no sort/rank). Bulk TPV capture across days: absent. The "Ir a la sucursal" banner buttons are the best accelerator on the page — extend that thinking to the table.
- **Mariana (multi-branch owner, morning brief):** "How much did we sell?" — answered well. "Which branch needs me?" — only via banners when variance exists, then a scan. Fatal for trust: "Food Cost 0.9% Saludable" is contradicted by her P&L the moment she looks — finding #2 is a trust bug, not a style bug.
- **Sam (keyboard/SR):** Genuinely good bones: sr-only table captions enumerating columns, `role="img"` + sr-only data mirrors for both charts, focus-ringed `?` buttons, `aria-describedby` help text. Gaps: no sortable headers at all, one hover-only `title` tooltip on the TPV variance cell, help button inside `h1`, and the intermittent hydration error can break SR tree reuse.

## Heuristics table

| # | Heuristic | Score | Driver |
|---|---|---|---|
| 1 | Visibility of status | 3 | scope echo + truncated notice; −1 uncoordinated fetches, silent chart failure |
| 2 | Match real world | 3 | domain-true Spanish; −1 "Sales" breadcrumb, Smart Link jargon |
| 3 | User control | 3 | retry, session-data purge, cancelable dialogs; −1 analytics tab reload-only recovery |
| 4 | Consistency | 2 | 3 money formatters, 2 toast systems, semantic-as-categorical, dual ingestion UIs |
| 5 | Error prevention | 4 | live cuadre, arqueo required, 1e5-proof parsing, 409 duplicate handling |
| 6 | Recognition | 3 | scope echo, `?` pattern; −1 bare receivedAt, banner↔row distance |
| 7 | Flexibility | 2 | no sort/search/pagination/bulk; good branch-jump accelerator |
| 8 | Minimalist design | 2 | red dilution, amber/green wallpaper, 12-col density |
| 9 | Error recovery | 3 | error≠empty, in-dialog delete errors; −1 "recarga la página" pattern |
| 10 | Help & docs | 4 | contextual tooltips, provenance footnotes, field helper text |

## Deterministic evidence

- **Detector (static):** 1 finding — `components/sales/tpv-batch-entry-modal.tsx:461` `text-[11px]` off the DESIGN.md type ramp. (No raw-palette colors anywhere in the section — the August colorize plan is fully landed.)
- **Browser (authenticated, real data):** no horizontal overflow at 1280 or 390; no computed text <12px except the `†` provenance glyph (9px, mobile — mark, not copy); hydration error 1/2 runs; trend chart renders empty series (screenshot); cuts table clips at viewport right edge (screenshot).
