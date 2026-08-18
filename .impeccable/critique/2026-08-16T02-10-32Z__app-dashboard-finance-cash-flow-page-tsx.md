---
target: app/dashboard/finance/cash-flow
total_score: 16
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-16T02-10-32Z
slug: app-dashboard-finance-cash-flow-page-tsx
---
Method: dual-agent (A: a6386e8bad8d285f9 · B: a8d1e0420f6fa9c64)

**Target:** `app/dashboard/finance/cash-flow/page.tsx` → the real surface is `components/finance/cash-flow-calendar.tsx` (800 lines), fed by `lib/services/cash-flow-service.ts`. Mode: **Operate**.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Loading/error handled (`page.tsx:67-81`), but no as-of time, no disclosure that the opening balance is an assumption, and switching branches changes nothing while looking like it did. |
| 2 | Match System / Real World | 2 | "¿Me alcanza?" and the refusal of "runway" (`:371-372`) are right; "Tesorería", "concentración de pagos", "ventana de proyección" (`:404`), "emp" (`:431`) and the voseo "Prepará" (`:581`) are not. |
| 3 | User Control and Freedom | 1 | `days=30` hardcoded at `page.tsx:28`. No horizon control, no filter, no sort, no drill-down. Only escape is the back button. |
| 4 | Consistency and Standards | 2 | Local `formatMXN` (`:145`) duplicates `formatCents`, whose docstring exists to kill exactly these copies; zero `tabular-nums` while both sibling finance screens use it; `text-warning` (`:354`) violates the rule the repo documents at `globals.css:90-94`. |
| 5 | Error Prevention | 1 | A branch selector that silently reports group-wide numbers makes a wrong-scope decision not just possible but likely, with no guardrail anywhere. |
| 6 | Recognition Rather Than Recall | 2 | Week labels and category maps are good; overdue rows are truncated text with no supplier and no branch, so identifying "Renta" requires recall. |
| 7 | Flexibility and Efficiency | 1 | One power feature (Exportar CSV, `:718-726`), below the fold, fixed filename, exports only the day series — not the overdue items, categories, or weeks. |
| 8 | Aesthetic and Minimalist Design | 2 | Four stacked hero-metric blocks — the pattern DESIGN.md bans as a default layout — and a red budget 3–4× the One Voice ceiling. |
| 9 | Error Recovery | 2 | App errors recover well (specific Spanish copy, `Reintentar`). Business errors get nothing, and the legacy-array fallback silently deletes four of six sections with no message. |
| 10 | Help and Documentation | 1 | Four load-bearing assumptions (fake opening balance, PO dates estimated +14d, payroll assumed on 15/30, flat historical inflow) are presented as facts with no tooltip and no "cómo se calcula". |
| **Total** | | **16/40** | **Poor — major UX overhaul required** |

## Design Specificity Verdict

**LLM assessment.** Strip the Spanish and this ships unchanged in any B2B SaaS. Three KPI tiles in `md:grid-cols-3`, a red alert card, two side-by-side cards, a 4-up tile grid, a summary strip, a Recharts grouped bar chart, an Export CSV. Rename `Egresos` → `MRR Churn` and nothing else changes.

The authored parts are real but they are *sentences*, not structure: the four questions in the subtitle (`page.tsx:61`), "¿En qué gasto?" (`:528`), and the comment at `:371-372` refusing "runway" as venture-capital vocabulary a taquería owner doesn't use. That comment is the best thing in the file. Then the H1 four lines away reads **"Panel de Alerta Temprana de Tesorería"** — Banxico-bulletin Spanish, landing exactly on the anti-reference PRODUCT.md forbids. The feature argues with itself inside one screen.

The damning part: **the service is far more HORECA-specific than the UI.** `cash-flow-service.ts` knows CFDI folios and `nombreEmisor`, knows quincena lands on the 15th and 30th, knows supplier credit days feed `due_date`, knows OC statuses. The component receives all of it and flattens it to "categorías", "compromisos", "egresos" — generic accounting nouns. `supplierName` is in the payload (`:54`) and never rendered. `isPayroll` is in the payload (`:51`) and never used. The domain knowledge is computed and then discarded at the render boundary.

**Deterministic scan.** `detect.mjs` on both files: **exit 0, zero findings.** Weight that lightly — Assessment B canary-tested the detector with a file containing `shadow-lg`, `text-[10px]`, raw hex and a "Click here" label; in TSX regex mode only `bounce-easing` fired. The clean run is genuine but the rules that would police this file's risk areas don't fire on TSX. Static verification carried the weight instead:

- **Tokens: PASS.** Every `var(--chart-N)`, `--info`, `--success`, `--warning`, `--destructive` resolves in both light and dark (`globals.css:19-46, 74-102, 129-154`).
- **Label-floor: PASS.** Zero sub-`text-xs` sizes.
- **Flat-by-default: PASS.** Zero `shadow-` classes.
- **Contrast: FAIL, twice.** `text-warning` `oklch(0.72 0.15 80)` on white = **2.52:1**, and 2.42:1 against the actual `bg-warning/5` composite it sits on at `:354` — that fails even the 3:1 large-text bar at `text-2xl font-bold`. `text-success` on white = **3.68:1**, which passes large text at `:399` but **fails 4.5:1 at `:691` and `:710`** where it's `text-xs`. Computed via OKLCH→sRGB with both naive clipping and CSS Color 4 chroma reduction; both agree.
- **The repo already fixed this and this file didn't adopt it.** `globals.css:90-94` defines `--warning-text` with the comment *"`--warning` es un ámbar pensado para rellenos… daba ~2.3:1 — por debajo de AA"*. Nine files use `text-warning-text`, including the sibling `cash-flow-summary-card.tsx:166`. This one uses `text-warning`.
- **Dark-mode collision.** `--info` (`globals.css:147`) and `--chart-4` (`:153`) are byte-identical in `.dark`. The "OC" and "Factura" badges render the same color; only the text label distinguishes them.

**Visual overlays.** None. No user-visible overlay exists. Browser evidence was skipped: nothing listening on :3000 (curl exit 7), and no browser-automation tool is exposed in this session. Playwright binaries and a still-valid `tests/.auth/admin.json` session (~5.6 days left) are both present — the only blocker was the absent dev server.

## Overall Impression

This is a screen that tells a business owner she may not make payroll, using numbers it made up. Everything above the fold is arithmetic on `INITIAL_BALANCE = 2000000` — a hardcoded $20,000 MXN identical for a 3-branch café and a 15-branch hotel group (`cash-flow-service.ts:81`). The only control on the page is discarded by the API. And after the fear, the last thing on the page is a download button.

The craft floor is genuinely respected — flat surfaces, real tokens, no sub-12px type, a proper `sr-only` data table. The problem isn't finish. It's that an "alerta temprana" whose two inputs are a constant and a flat average is not an early-warning system; it's a shape. **The single biggest opportunity: make the numbers true and make one thing on this page clickable.**

## What's Working

**1. The sr-only data table (`:776-794`).** A real `<table className="sr-only">` with a `<caption>`, placed as a sibling of the `role="img"` container rather than nested inside it, mirroring exactly the series rendered. Correctly scoped and above what most production dashboards ship.

**2. The question-shaped voice, where it survives.** "¿En qué gasto?" (`:528`), the four-question subtitle (`page.tsx:61`), and the comment at `:371-372` rejecting "runway" for "Te alcanza para". An authorial decision about a specific reader, made in code, with the reasoning preserved.

**3. Token discipline in the color layer, with the reasoning kept.** `CATEGORY_COLORS` moved to `var(--chart-N)` with the note at `:111-113` explaining the theme-desync bug it fixed. Every surface flat, no shadows, Flat-By-Default honored without exception. Verified by both the detector and manual grep.

## Priority Issues

### [P0] The branch selector is wired to nothing

`page.tsx:29-31` sets `url.searchParams.set("branchId", selectedBranch)`. `route.ts:23-27` reads only `days` and calls `getCashFlowProjection(ctx.userCompanyId, days)`. The service signature is `(companyId, days)` — every query filters on `companyId` alone. **Verified directly.**

**Why it matters:** an owner switching to "Polanco" sees the whole group's numbers labeled as one branch, and will act on them. This is worse than a missing feature — it's a wrong number presented confidently on the one surface whose name promises alerting.

**Fix:** read `branchId` in `route.ts:23`, thread it through `getCashFlowProjection`, filter `operatingExpenses`, `purchaseOrders`, `invoices` and the payroll contract query. Until that lands, suppress the header selector on this route and print the scope in the header.

**Suggested command:** `/impeccable harden`

### [P0] Every headline number is arithmetic on invented inputs

Three confirmed defects compounding:

1. `INITIAL_BALANCE = 2000000` (`cash-flow-service.ts:81`) — a constant $20,000 MXN for every tenant, rendered at `text-2xl font-bold` as "Saldo inicial proyectado" (`:326-330`) and seeding `runningBalance` (`:343`). "Saldo mínimo", the color bands, and "Te alcanza para N días" all inherit it.
2. `avgDailyInflowCents` (`:104-107`) is one all-time average applied flat to all 30 days, so the "Entradas" series is a straight line by construction — half the chart's ink carries zero information. And the `1500000` fallback is **unreachable**: `Number(daysCount || 1)` never yields 0, so a tenant with no `dailySalesCuts` gets **$0/day inflow** and a fully red screen on first login.
3. **Payroll is double-counted.** Verified at `cash-flow-service.ts:349-373`: `dayOutflows` is a *reference* into `outflowsByDate`; line 360 increments its count, `addItem` (`:241-249`) then adds the same amount and count again, then `:373` computes `dayOutflows.amount + payrollExtra`. On any 15th/30th that shares a date with another expense, `projectedOutflowCents` counts payroll twice and `outflowItemsCount` once too many — inflating exactly the days most likely to turn red, and tripping `hasHighConcentration` (`count >= 3`) spuriously. Consequence on screen: the chart's "Salidas" bar, the weekly card total, and the "Total egresos" line will disagree with each other.

**Why it matters:** the first false alarm kills trust in all of them, and this one is guaranteed.

**Fix:** source the opening balance from a real ledger (último corte / caja chica), or relabel the card "Supuesto: saldo inicial" with an inline editable input. Add an assumptions line beneath the hero row naming all three estimates. Read `dayOutflows` *after* `addItem`, or drop the manual `+= 1`. Apply weekday seasonality to inflow.

**Suggested command:** `/impeccable harden`

### [P1] Every finding is a dead end

Assessment B's inventory: **4 interactive elements, 0 that navigate.** Two local-state toggles, one CSV download, one retry. The overdue rows (`:457-491`) and upcoming rows (`:587-613`) are plain `<div>`s — no `onClick`, no `href`, no `Link` anywhere in either file. `supplierName` and `isPayroll` are in the payload and never rendered, so the user can't even identify the counterparty. She learns she has 6 overdue invoices, then must leave, open `/dashboard/finance/expenses`, and search by truncated description.

Worse: `:302` returns `<Card>Sin datos de proyección disponibles</Card>` **before** the overdue card renders at `:442`. A tenant with overdue invoices but no projection days sees none of them.

**Why it matters:** three cognitive-load items fail on this alone. A panel that produces findings but no actions produces WhatsApp screenshots — in a product where WhatsApp is a declared first-class interface and this screen has no hook into it. The sibling `payables/page.tsx:183-191` at least *says out loud* that it's read-only and explains why.

**Fix:** wrap each row in a `Link` to its source record; render `supplierName`; add "Reprogramar" / "Marcar pagado" where RBAC allows; add a footer link to Cuentas por Pagar. Move the overdue card above the `!days.length` guard.

**Suggested command:** `/impeccable shape`

### [P1] Red is ~4× the One Voice ceiling, and one usage fails contrast

Simultaneously red in a bad month: hero card 2 (border+bg+value), hero card 3 (border+bg+value+date), the nómina badge (`:430`), the entire overdue card plus every row amount and status badge, the `NOMINA` bar at `var(--destructive)` and the `RENTA` bar at `var(--chart-1)` = `oklch(0.58 0.18 25)` (hue 25, essentially Operational Red), up to 5 weekly cards, the summary strip's Salidas and Flujo neto, and all 14 "Salidas" bars at `var(--chart-5)` = `oklch(0.56 0.15 0)`, a crimson. Plus four `text-primary` icons. DESIGN.md caps this at 10–15%.

It also can't rank: `daysUntilNegative` truthy paints the card destructive whether the date is 2 days out or 29 (`:385-395`), so "fine, barely" and "in trouble Thursday" look identical.

And the amber alternative is broken where it's used: `text-warning` at `:354` computes to **2.52:1**, failing even large-text AA, while the repo's own `--warning-text` token (6.61:1) exists for exactly this case and is used by the sibling card.

**Fix:** one red owner per screen — the overdue card. Heavy weeks → warning tint plus the literal words "Semana pesada". "Salidas" bars → `var(--chart-4)`. Summary figures → foreground with a minus sign. Hero card 3 red only at ≤7 days, amber to 14, neutral beyond. Swap `text-warning` → `text-warning-text` at `:354`, and `text-success` → a darker token at `:691`/`:710`.

**Suggested command:** `/impeccable quieter`

### [P2] Copy that is factually wrong, not merely off-register

- `"Prepará la tesorería"` (`:581`) — Rioplatense voseo in an es-MX product.
- `"Facturas y gastos vencidos"` (`:450`) — never contains a factura; `overdueItems` is built exclusively from `operatingExpenses` (`cash-flow-service.ts:330-339`).
- `"la concentración de pagos supera el promedio"` (`:636`) — the code uses **median × 1.5** (`:443`).
- `"Sin riesgo de saldo negativo"` (`:404`) — an absolute guarantee built on a fake baseline.
- `"{days.length}+ días"` (`:400`) — invents knowledge past the horizon.
- `"emp"` (`:431`) — not an abbreviation any Spanish speaker uses.
- `metrics.minBalance < 50000` (`:339, :353`) — **$500 MXN**, verified as cents. The amber band is functionally unreachable for any real group. If $50,000 was intended, the constant is off by 100×.
- `"1 días"` — `:388` has no plural handling.

**Suggested command:** `/impeccable clarify`

## Cognitive Load

**5 of 8 items fail → critical band.**

| Item | Verdict | Evidence |
|---|---|---|
| Single focus | **FAIL** | Header declares four questions (`page.tsx:61`); body answers five+. No primary answer. |
| Chunking ≤4 | **FAIL** | Six top-level blocks; the weekly grid renders 5 cards into `lg:grid-cols-4`; overdue expands unbounded. |
| Grouping | pass (marginal) | "¿En qué gasto?" (categories) is paired with "Próximos 7 días" (a time list) for layout, not meaning. |
| Visual hierarchy | **FAIL** | Four `text-2xl` values at equal weight (`:328, :350, :387, :399`); ~85% of data text is `text-xs`. `text-sm` appears twice in 800 lines. |
| One thing at a time | **FAIL** | One unsequenced scroll; no path from "¿estoy bien?" to "¿qué hago?". |
| Minimal choices ≤4 | pass (hollow) | Passes because there are almost no actions, not because choices were curated. |
| Working memory | **FAIL** | To act, the user carries the min-balance date, the heavy week, the overdue descriptions and the category mix *off this page* and searches by name, because nothing links. |
| Progressive disclosure | pass (marginal) | Two collapses exist; disclosure means "more rows of the same". |

## Emotional Journey

The peak is fear and the end is a download button. This screen's entire emotional vocabulary is red tint, and it can neither rank urgency nor calibrate severity. After the fear it offers nothing. The one sentence of care in this feature lives on the *other* screen — `cash-flow-summary-card.tsx:159`, *"Revisa el calendario para anticipar cobranza o reprogramar pagos"* — and it points here, to the screen where the care stops. The overview promises counsel; the destination delivers a wall.

## Persona Red Flags

**Alex (impatient power user).** `days=30` hardcoded at `page.tsx:28` — he wants 7 or 60, and editing the URL does nothing because the page builds its own. Exportar CSV is parked bottom-left below the fold, writes a fixed `flujo-efectivo-30d.csv` with no date or branch, and exports **only the day series** — not the overdue items, categories, or weeks he'd actually want in Excel. Nothing is deep-linkable: he can't send "mira la semana 3" to his contador. Both collapse states are local `useState` (`:194-195`), so every branch switch re-renders and he re-expands the overdue list by hand.

**Sam (accessibility-dependent).** The `AlertTriangle` at `:657` is the only non-color marker for a heavy week and has no accessible name — "which weeks are bad" is color-only, as is the destructive tint on the hero and weekly cards. Both collapse buttons (`:494-509`, `:544-559`) lack `aria-expanded`/`aria-controls`: he hears "Ver todos (12), botón" and gets no state announcement. `text-warning` at `:354` sits at 2.42:1 against its own tint. The chart `Tooltip` passes `""` as the series name (`:757-760`), so a hovered value has no label. At 200% zoom the source `<Badge>` is nested *inside* the `truncate` paragraph (`:466-472`), so `overflow:hidden` slices the pill mid-shape — the marker that says OC vs. Factura is the first thing cut. And in dark mode those two badges are the same color anyway.

**Doña Marisol (owns six taquerías, iPad in the kitchen, phone between branches).** She reads "Panel de Alerta Temprana de Tesorería" and does not recognize her business in it. She switches to "Sucursal Centro" to see if that one is bleeding, gets identical numbers, and believes them. The verdict "negativo el 27" rests on a $20,000 constant with no relationship to her bank. At arm's length in a loud kitchen, **everything she needs to read** — every overdue invoice, every upcoming payment, every category amount, every summary figure — is at `text-xs`, sharing that size with decorative labels. Nothing is `tabular-nums`, so the four weekly amounts she wants to compare don't align (contrast `payables/page.tsx:152,164,173`). She can't tap an overdue item, can't mark it paid, can't see the supplier. On the phone, "Fuentes de egresos" (`:415`, `flex` with no `flex-wrap`, `shrink-0` badges) runs off the right edge with no scroll container. She screenshots it and sends it to WhatsApp — the product's own first-class channel, which this screen does not touch.

## Minor Observations

- **Week 5 is an artifact that generates false alarms.** The grid is `lg:grid-cols-4` (`:640`) but the service emits **5** weeks (`floor(i/7)+1` for i=0..29), so there's always an orphan card — and week 5 covers 2 real days while printing a full 7-day label. That near-zero stub drags the median down (`:440-441`), flagging *more* weeks as `isHeavy`.
- **`procurementCommitments` can exceed the categories total.** `cash-flow-service.ts:462-467` sums *all* committed POs and pending invoices including those outside the window; the projection only admits in-window items. Two numbers on one screen, both claiming to describe the same projection.
- **UTC date boundary.** `toISOString().slice(0,10)` (`:91, :347`) — in UTC-6, after 6pm local (the hour an owner checks money) "today" becomes tomorrow, shifting the window and flipping items between "vencido" and "próximo".
- **The legacy-array fallback degrades silently.** `isProjection` (`:156-158`) tests only `"categorySummary" in obj`; the fallback (`:198-208`) empties four arrays, and every section is gated on `.length > 0`, so four of six sections vanish with no message. A degraded state indistinguishable from a healthy one.
- The component's own empty branch (`:302-310`) renders bare muted `text-xs` instead of `EmptyState`, which the page itself imports and uses for errors.
- `weeklyChartData` (`:270-274`) is computed on every render and **never used anywhere in the codebase** — verified by grep. Dead code carrying a `Presión: "Alta"|"Normal"` field that would have been the text alternative the weekly cards need.
- Five `justify-between` currency rows have no `min-w-0`/`shrink-0` on the numeric side (`:173-180, :562-568, :686-694, :695-703, :704-715`) — and the summary card holding four of them is `lg:col-span-1` of a 4-column grid. The overdue and upcoming rows (`:460, :590`) *are* correctly built; the pattern exists in the file and wasn't applied.
- Chart: `.toFixed(2)` **strings** as bar values, no `YAxis tickFormatter` (ticks read "1500000"), `left: 0` margin clips them, no `interval` or scroll wrapper for 28 bars at 320px, fixed `h-72`.
- `CardDescription` overridden to `text-xs` four times against its `text-sm` default; `CardContent` is `p-4` on five cards and default `p-6` elsewhere — two internal paddings against DESIGN.md's 24px.
- `Math.max(widthPct, 2)` (`:184`) floors every bar at 2%, making 0% and 2% visually identical. Category percentages are independently rounded (`:407`) and need not sum to 100.
- `key={week.weekLabel}` (`:642`) and `key={d.fecha}` (`:787`) use formatted display strings as React keys.
- Local `formatMXN` (`:145`) duplicates `formatCents` in `lib/utils.ts`, whose docstring says it exists to replace exactly these copies.
- Three horizons on one screen — 14-day chart and summary, 30-day categories and weeks, 30-day CSV — and only the chart states its own.
- Title Case in `:735` against sentence case in every other title.

## Questions to Consider

1. If the opening balance is a hardcoded constant, what is this panel alerting on? After the first false alarm, does the owner ever open the second one?
2. The header selector is the only control on the screen and the API throws it away. Which is the smaller lie: leaving a filter that does nothing, or removing it and admitting this surface is group-level only?
3. Name the single action this screen exists to produce. If it's "reprogramar un pago", why can't it be started here? If the answer is "none, it's read-only", why does `payables/page.tsx:183-191` say that out loud and this screen doesn't?
4. On a bad month, red covers most of this page. What should the owner look at first? If answering requires reading, red has stopped being a signal and become a texture.
5. The "Entradas" series is a flat line by construction. Is a chart whose most dominant element carries zero information better or worse than no chart?
6. WhatsApp is a first-class interface in this product. Why does the screen that says "te quedas sin dinero el 27" offer a CSV download instead of a way to send that sentence to the contador?
7. Every section is gated on `.length > 0`. What does the owner conclude when four sections quietly disappear — that things are calm, or that something broke? Which did you design for?
