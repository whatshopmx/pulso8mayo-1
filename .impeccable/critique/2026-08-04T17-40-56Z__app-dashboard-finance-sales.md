---
target: app/dashboard/finance + app/dashboard/sales
total_score: 27
p0_count: 1
p1_count: 3
timestamp: 2026-08-04T17-40-56Z
slug: app-dashboard-finance-sales
---
# Critique: app/dashboard/finance + app/dashboard/sales

Method: ⚠️ DEGRADED: single-context (no sub-agent tool exposed in this session)

Targets: `app/dashboard/sales/page.tsx`, `app/dashboard/sales/mapping/page.tsx`, `app/dashboard/finance/cash-flow/page.tsx`, `app/dashboard/finance/expenses/page.tsx`, `app/dashboard/finance/petty-cash/page.tsx` + their feature components (`components/sales/*`, `components/finance/*`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Every page has loading/error/empty states and toasts, but spinners instead of skeletons, and the KPI card never states *which period* it summarizes |
| 2 | Match System / Real World | 3 | Native HORECA Spanish throughout, but internal codes leak: "(M13)" in the Sales page title, raw enums "SALON"/"DELIVERY" in channel badges |
| 3 | User Control and Freedom | 2 | Expenses can be approved but never rejected (REJECTED status unreachable); no edit/delete for registered cuts; petty-cash register button disappears in consolidated view |
| 4 | Consistency and Standards | 3 | Strong shared scaffold (header + branch select + states triad); divergent "ALL" labels across pages, Title Case toast titles, one emoji icon ("⚡ Pico") among Lucide icons |
| 5 | Error Prevention | 3 | AlertDialog gates on irreversible actions, required-field validation; but manual cut entry allows Efectivo+Tarjeta+Otros > Venta Total silently, and date ranges accept end < start |
| 6 | Recognition Rather Than Recall | 3 | Filters visible everywhere; icon-only trash button on mapping page has no accessible label; KPI period must be remembered from another tab |
| 7 | Flexibility and Efficiency | 2 | No bulk approval for pending expenses, no pagination on cuts table, no date presets ("últimos 7 días"), filters lost on refresh (not in URL) |
| 8 | Aesthetic and Minimalist Design | 3 | Distilled surfaces (petty-cash card is genuinely good); cuts-table cells stack 3 lines of payment text + validation notes → ragged dense rows |
| 9 | Error Recovery | 3 | Error EmptyStates with "Reintentar" on every page, server error text surfaced; "Reintentar" button shows a static spinner icon even when not loading |
| 10 | Help and Documentation | 2 | Empty states teach next actions; no tooltips/definitions for Food Cost % / Costo Primo beyond a 3-word hint, no help entry point |
| **Total** | | **27/40** | **Acceptable** |

## Anti-Patterns Verdict

**LLM assessment**: This does **not** look AI-generated. It reads as a committed design system executed with discipline: flat cards with 1px borders (no ghost-card shadows), a tonal badge grammar (`bg-{semantic}/10 text-{semantic} border-{semantic}/20`) repeated verbatim across all five pages, tables that follow DESIGN.md (no vertical rules, muted headers, hover rows), and restrained use of Operational Red. No gradient text, no eyebrows, no glass, no side-stripe borders, no identical-card-grid marketing reflexes. The one cliché adjacency is the KPI ratio strip, but it lives inside a single summary card rather than as four hero-metric cards, which keeps it honest. The product register's bar — "would a Linear/Stripe-fluent user trust this?" — is mostly met; the trust breaks at the hardcoded KPI numbers (see P0) and the small-text contrast failures.

**Deterministic scan**: `detect.mjs --json` ran clean (exit 0, 0 findings) over both page directories and both component directories. Caveat: the rule engine parses HTML/CSS, and these surfaces are pure TSX/JSX, so the clean result is "no HTML-level anti-patterns detected," not "fully audited." A synthetic HTML probe confirmed the detector fires correctly, so the TSX gap — not detector failure — explains the zero. The LLM review above compensates.

**Visual overlays**: Not available. `agent-browser` is not installed in this environment (doctor output: "agent-browser is required but was not found on PATH"), so no `[Human]` overlay, no live screenshots, no console inspection. Fallback signal: static code review of all page + component sources only.

## Overall Impression

The bones are good — genuinely. Five finance/sales surfaces share one coherent scaffold, real Spanish operational copy, sensible empty/error/loading handling, and even thoughtful touches (sr-only data tables behind every Recharts chart, threshold-marked balance bars, confirmation gates on irreversible money actions). The biggest opportunity is **truth**: the analytics tab presents invented cost percentages as live metrics, and the approval chain is one-directional. Fix data honesty + the approval loop and this module jumps from "acceptable" to a trustworthy command center.

## What's Working

1. **The petty-cash status card** (`petty-cash/page.tsx`) is the module's best surface: one prominent figure, an inline threshold bar with a visible threshold mark, movements demoted to a single audit line — exactly the "distilled status surface" the product register asks for, and it dodges the hero-metric template by refusing supporting-stat clutter.
2. **States triad everywhere.** Every page handles loading → error → empty → data, and every error state carries a concrete "Reintentar" action. Empty states teach ("Sube un archivo exportado del POS o recibe cortes por WhatsApp…") instead of saying "nothing here."
3. **Screen-reader parity for charts.** Each Recharts chart has `role="img"` + `aria-label` *and* a mirrored `sr-only` table — rare, correct, and consistent across sales and cash-flow.

## Priority Issues

1. **[P0] Fake financial KPIs rendered as live data.** `components/sales/financial-kpi-cards.tsx` hardcodes `foodCostPct = 28.5` and `laborCostPct = 26.2` ("placeholder teóricos hasta que el backend exponga costos reales") and displays them with green "Óptimo" status badges, a derived Costo Primo, and Margen Restante.
   - **Why it matters**: This is the product's own "One platform, one truth" principle violated at the most trust-sensitive point — money. A chain owner sizing food-cost decisions off a confident 28.5% is being lied to by their dashboard. One screenshot of this into a client demo and credibility is gone.
   - **Fix**: Until the cost backend exists, render the ratio strip as explicit estimates ("Estimado teórico" badge, muted values, one footnote: "Cálculo real disponible cuando conectes tus costos") or hide the strip and show a single setup CTA. Never show a status badge on invented data.
   - **Suggested command**: `$impeccable harden`
2. **[P1] Sub-4.5:1 semantic text color at 12px.** `text-warning` (oklch 0.72 0.15 80 ≈ 2.2:1 on white) and `text-success` (oklch 0.60 0.16 150 ≈ 3.1:1) are used for small text all over: expense status badges ("Pendiente"), sales status rows ("Observación", "Validado"), petty-cash OUT amounts, "Aprobar" button label.
   - **Why it matters**: These are exactly the states an owner scans for — pending approvals, low funds. They fail AA for normal text and are hard to read on tinted backgrounds, which is the #1 way dashboards feel "cheap" without anyone naming why.
   - **Fix**: Introduce text-level semantic tokens (e.g. `--success-text` ≈ L 0.45, `--warning-text` ≈ L 0.55, same hues) and use the bright hues only for fills/borders. Update the badge grammar from `text-success` → `text-success-text` etc.
   - **Suggested command**: `$impeccable audit`
3. **[P1] The approval chain is one-directional.** Expenses can be approved (with a hardcoded note "Aprobado por administración") but the `REJECTED` status has no reachable path, the confirmation dialog offers no place to type approval/rejection notes, and approval is declared irreversible in the dialog yet has no undo or audit trail surfaced in the UI.
   - **Why it matters**: "Autorizaciones" is half the page's promise — a gerente who needs to reject an over-budget expense has no button, so the feature reads as broken, not minimal.
   - **Fix**: Add "Rechazar" beside "Aprobar" (both behind confirmation), move the notes input into the confirmation dialog, and show `approvalNotes` in the table once set.
   - **Suggested command**: `$impeccable clarify` (flow + copy)
4. **[P1] Fragmented filter model.** On the Sales page the branch selector is duplicated inside two tabs with different wording ("Todas las sucursales (consolidado)" vs "Todas las sucursales"), petty-cash calls it "Vista consolidada (todas)", and the analytics tab claims a "período" it can't set: the date-range inputs exist only in the cuts tab (yet mutate the shared branch state), and KPIs/charts silently use the API's default window. Filters also live in React state, so a refresh resets everything.
   - **Why it matters**: The owner's core question is "how did last week look?" — currently unanswerable from the analytics tab without a memory bridge to the cuts tab. Inconsistent consolidation wording makes the same control feel like three different ones.
   - **Fix**: One filter bar per page (branch + date range with presets: Hoy, 7 días, Mes), identical "Consolidado (todas)" label across the module, filters synced to URL params.
   - **Suggested command**: `$impeccable layout`
5. **[P2] Data-table scale and polish gaps.** The cuts table has no pagination or totals footer and renders every row (15 branches × 2 shifts × 30 days ≈ 900 rows); payment methods stack three text lines per row while validation notes wrap at 200px, producing ragged row heights; the dropzone promises "Selecciona o arrastra" but has no drag-and-drop handlers; the channel badge prints raw enums ("SALON") while the shift column is nicely lowercased.
   - **Why it matters**: Each is small; together they're the difference between "built for my operation" and "beta." The fake drag-and-drop promise is a stress-tester trap.
   - **Fix**: Paginate (or virtualize) with a totals row, collapse payments to "Efectivo 62% · Tarjeta 38%" with a tooltip for amounts, wire real `onDrop`, map enums to display names.
   - **Suggested command**: `$impeccable polish`

## Persona Red Flags

**Alex (Power User)** — approving a week of expenses: must open a confirmation dialog once per pending row (no bulk approve, no row selection), no keyboard accelerators anywhere, filter state evaporates on refresh, cuts list won't paginate. Alex builds a spreadsheet workaround within a week.

**Sam (Accessibility-dependent)** — the trash button on `sales/mapping` is icon-only with no `aria-label`; `text-warning`/`text-success` 12px text misses AA contrast (see P1). Credit where due: every chart ships an sr-only data table and dialogs use proper AlertDialog/Dialog primitives, so the SR flow is structurally sound — it's color and labeling that fail.

**Marisol (Gerente, project-specific — runs one branch on a tablet during the evening rush)** — registering the day's cut: the dialog defaults shift to "MATUTINO" (wrong default for the end-of-day ritual), typing five money fields on a tablet with `type="number"` is tolerable, but if Efectivo+Tarjeta exceeds Venta Total she gets no warning — the cut saves and someone upstream discovers the discrepancy days later. The confirmation-first cut (WhatsApp parity) is exactly her mental model, though.

## Minor Observations

- "Ventas y POS (M13)" — internal module code in a user-facing H1. Drop "(M13)".
- Cash-flow alert card uses `text-warning-foreground` (dark amber, oklch 0.20) which happens to be correct on `bg-warning/5` — but relying on a *-foreground token for body text on a tinted surface is fragile; verify dark mode.
- "Reintentar" buttons render a static `<Loader2>` icon even when idle — reads as mid-loading.
- The cash-flow 30-day grid renders full `$1,234,567.89` strings in ~100px cells at `text-xs`; long amounts will wrap awkwardly. Compact formatting (`$1.2M` / thousands-only) at small sizes.
- "⚡ Pico" badge is the only emoji in a Lucide-only icon system.
- Toast titles mix casing: "Error de Carga", "Error de Ingesta" vs sentence-case elsewhere.
- Petty-cash consolidated view fires `branches × 2` fetches client-side (30 requests for 15 branches) on every selector change — needs a consolidated API endpoint.
- Mapping page back-link placement (above the H1) is fine, but the page has no visible affordance to *edit* a template — delete-only.

## Questions to Consider

- If the analytics tab can't yet compute real Food Cost, what does a *confident* "not ready" look like — an honest estimate with visible methodology, or a locked card that sells the upcoming connection?
- Approve/Reject is a money decision with a stated audit log: why is the note field invisible at the exact moment the decision happens?
- What would this module look like if the branch+date filter bar were one shared component, identical on all five pages?
