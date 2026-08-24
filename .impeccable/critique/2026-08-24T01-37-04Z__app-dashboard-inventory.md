---
target: app/dashboard/inventory
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-08-24T01-37-04Z
slug: app-dashboard-inventory
---
# Critique — `app/dashboard/inventory` (Inventory hub + sub-pages)

Mode: Operate · Surface: Inventory command center (hub + 28 sub-sections)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good skeletons/timestamps, but `HighValueSkusSection` fails silently to null (`high-value-skus-section.tsx:47`) |
| 2 | Match System / Real World | 3 | Excellent kitchen-register Spanish, but enum leaks ("Se dieron de baja 3 UNIT", `waste-form.tsx:294`) |
| 3 | User Control and Freedom | 2 | PO dialog discards all entered lines on Cancel (`purchase-orders/page.tsx:775`); "En progreso" counts are dead ends |
| 4 | Consistency and Standards | 2 | Three meanings of "Actualizar"; two different product pickers; raw Tailwind colors vs OKLCH tokens |
| 5 | Error Prevention | 3 | Waste validates before confirm (excellent); company-wide blind-count toggle flips instantly with no confirmation |
| 6 | Recognition Rather Than Recall | 2 | Header branch scope ignored by stock-count page; errors arrive via `?error=` redirect with no field highlighting |
| 7 | Flexibility and Efficiency | 2 | No bulk resolve in alerts, filters don't persist to URL, no command palette across 28 sub-pages |
| 8 | Aesthetic and Minimalist Design | 3 | Hub is clean and narratively ordered; alerts page buries its table under 5 redundant summary cards |
| 9 | Error Recovery | 3 | `humanizeWasteError` is model-quality; alerts errors are toast-only with no inline retry |
| 10 | Help and Documentation | 2 | Two excellent KPI tooltips; blind-count implications and empty states are dead ends |
| **Total** | | **25/40** | Acceptable — significant improvements needed |

Cognitive load: **5 of 8 checklist items failed** (high). Decision points exceeding 4 options: alerts summary grid (5), alert status dialog (5), status/type filters (6 each), waste reason select (6), PO status filter (9).

## Design Specificity Verdict

**LLM assessment:** The copy and domain logic are authentically Pulso — "merma," "Conteo Físico Ciego," IVA/IEPS line items, three-way match reconciliation, and the waste form's kitchen-language error translation could not ship unchanged at a generic SaaS. The visual language is interchangeable: the hub opens with the exact 4-icon metric-card row DESIGN.md bans as a default (hero-metric template), followed by standard card grids and an icon link strip. Nothing on screen says "restaurant group" — a hotel maintenance tool could reuse every pixel. Missed character opportunities: zero WhatsApp presence despite PRODUCT.md declaring it a first-class interface, and no branch-dimension visualization for the stated primary persona.

**Deterministic scan:** 32 files scanned; 1 advisory finding — `design-system-color`: literal `#e2e8f0` at `purchase-orders/[id]/page.tsx:178`, outside the DESIGN.md palette. Likely a slate-200-style divider gray; map it to the nearest OKLCH border token. Notably, the detector did NOT catch the widespread raw Tailwind palette classes (`bg-red-500`, `amber-*`, `emerald-700`, `slate-50`) — those are semantic-token violations the LLM review caught and the scanner structurally misses.

**Visual overlays:** Browser visualization skipped — no browser automation tool available in this session; no user-visible overlay exists.

## Overall Impression

The bones are good and the operational copy is genuinely excellent — this reads like software built by people who have run restaurants. But trust is the product's currency ("one platform, one truth"), and the surface quietly breaks it: branch scope means something different on every page, colors bypass the design system, and the alerts page — the room the hub sends people to first — is its weakest. The single biggest opportunity: make Mariana's multi-branch morning brief real instead of a blended number she has to decompose herself.

## What's Working

1. **WasteForm's two-step destructive flow** — validate-before-confirm against live batch limits plus code-stable error humanization (`waste-form.tsx:98-120`, `57-83`). This is the craft bar the rest of the surface should meet.
2. **Hub narrative structure** — estado → qué necesita atención → dónde empiezo, with the 4-item "Empezar el día" strip at 56px touch targets and descriptions on every action.
3. **DashboardKpis' defensive honesty** — never rendering fake zeros for failed fetches, persistent non-hover "Ver detalle" affordance, explanatory tooltips on the least-obvious metrics.

## Priority Issues

1. **[P0] Branch scope is schizophrenic.** Header `BranchScopeControl` sets "Todas"/a branch, but stock-count presents its own sucursal `<select>` with no inheritance, and `HighValueSkusSection` fetches `/api/inventory/high-value` with no branch parameter at all while sitting under scoped KPIs. A gerente scoped to "Polanco" sees Polanco KPIs, then data that means something else. Violates PRODUCT.md principle 4 and corrupts trust in every number. **Fix:** thread `activeBranchId` into the high-value fetch; preselect/lock stock-count's branch when scoped; when scoped, hide the redundant select. Waste page hard-depends on `session.user.branchId` — a third branch-resolution mechanism on one surface.
   *Suggested command:* `$impeccable shape`
2. **[P1] The alerts page is the weakest room — and the hub sends people there.** Five hero-metric cards including a contentless "Total" (banned template), a lone refresh button floating in a CardHeader, no bulk resolve, 8-column unsorted table, and an update dialog offering nonsensical transitions (Activa → Vista) among 5 statuses. **Fix:** kill "Total"/"Descartadas" cards, sort by severity, add multi-select "Resolver seleccionadas," reduce dialog statuses to En Proceso/Resuelta/Descartada.
   *Suggested command:* `$impeccable distill`
3. **[P1] Hand-rolled combobox in CreatePODialog fails keyboard and screen readers.** Plain input + button list, no combobox/listbox semantics, no arrow-key navigation (`purchase-orders/page.tsx:634-690`), duplicating the Radix Select pattern used nearby. Sam cannot create a PO, period. **Fix:** replace with a shared cmdk-based Combobox used by both pickers.
   *Suggested command:* `$impeccable audit` then `$impeccable polish`
4. **[P1] Color token drift muddles the One Voice Rule.** Raw Tailwind palettes across `alerts/page.tsx:172-187`, `quick-alerts.tsx:55-113`, `high-value-skus-section.tsx:60-61`, `waste-form.tsx:547`, `purchase-orders/page.tsx:723-769`. Semantic warning/destructive/success OKLCH tokens exist unused. Green "Total Estimado" implies endorsement of plain arithmetic. **Fix:** sweep to tokens; reserve red for genuinely critical states.
   *Suggested command:* `$impeccable colorize` (token alignment pass)
5. **[P2] Silent failures and dead ends around stock counting.** `HighValueSkusSection` returns null on fetch error (section vanishes — user concludes there are no SKUs); "En progreso" history entries are unclickable with no resume path; count errors arrive as query-param banners with no field-level recovery; PO Cancel discards entered lines without warning.
   *Suggested command:* `$impeccable harden`

## Persona Red Flags

**Alex (impatient power user):** 28 sibling sub-pages, no command palette, no recents/favorites — every task is a sidebar hunt. Filters don't persist to URLs; back-button loses his place. Alert resolution is strictly one-dialog-per-alert. No "create PO from low-stock alerts" fast path even though the hub already knows what's low. Stock-count forces category-by-category initiation with no queue.

**Sam (keyboard/screen-reader):** PO table sort headers are clickable `<div>`s with `onClick` — no tabIndex, no role, no aria-sort (`purchase-orders/page.tsx:244-280`): sorting is mouse-only. Custom combobox unusable without sight. Alerts loading swaps the page for a skeleton with no `aria-busy`/live region; status changes announce only via toast. The "Actualizado · hace X" element is a `<button>` whose only behavior is a tooltip — a focus stop announcing no purpose.

**Mariana (multi-branch owner, morning brief — project persona):** The "Todas" rollup answers none of her actual questions: one blended "$1.2M inventario" with no distribution — which branch ties up capital? Which drives merma? QuickAlerts demotes branch name to a truncated muted micro-line (`quick-alerts.tsx:74-76`); clicking jumps into item detail, losing brief context. No branch-comparison view anywhere. Worst: the celebratory badge "**X sucursales con stock**" (`page.tsx:67`) implies some branches may have zero stock yet presents it as a neutral stat — that should be a fire alarm, not a badge. Her realistic morning brief today is still Excel export.

## Minor Observations

- `page.tsx:87` uses a `-mt-3` negative-margin hack to tuck the timestamp under the header — fragile spacing.
- `quick-alerts.tsx:114` calls `toLocaleDateString()` without `es-MX` — inconsistent date format.
- Alerts loading skeleton uses bare `p-6` wrapper instead of `PageContainer` — layout shift on load.
- STATUS_LABELS: SENT and APPROVED share identical badge variant — status color semantics muddled.
- CreatePODialog fires `handlePriceCheck` per line on supplier change, no debounce/cancellation (`purchase-orders/page.tsx:457-463`).
- Alerts empty state offers no explanation of what generates alerts or how thresholds are configured.

## Questions to Consider

1. If WhatsApp is "the field terminal," why can't a gerente push tonight's count sheet to their team's WhatsApp from the stock-count page in one tap?
2. Should "sucursales con stock" ever render as a calm outline badge — what does it mean about your operation when a chain of 15 shows "11 sucursales con stock"?
3. What decision does "Facturas Conciliadas %" enable at 7:00 AM — and if the answer is "none, it's just impressive," is it earning its quarter of the hero strip?
