---
target: app/dashboard/inventory/
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-07-28T19-07-38Z
slug: app-dashboard-inventory
---
Method: ⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this session)

# Critique — `app/dashboard/inventory/` (Inventory command center)

**Target:** `app/dashboard/inventory/page.tsx` + supporting components (`dashboard-kpis`, `dashboard-charts`, `quick-alerts`, `page-header`, `empty-state`)
**Register:** product (dashboard / admin) · **Platform:** web

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Skeletons + alert dot are good, but no "as of" timestamp on inventory value/stock |
| 2 | Match System / Real World | 3 | Strong HORECA Spanish vocabulary; "Match 3-Way" jargon is tooltip-rescued |
| 3 | User Control and Freedom | 3 | Search clear, tab escape, drawer exit all present; branch filter is global, not page-local |
| 4 | Consistency and Standards | 2 | Two card vocabularies (daily-actions vs KPI cards); clickable KPI card indistinguishable from static ones |
| 5 | Error Prevention | 3 | Read-only surface; no-branch state handled with `—` |
| 6 | Recognition Rather Than Recall | 3 | Icons + labels everywhere; nav map aids discovery but duplicates sidebar |
| 7 | Flexibility and Efficiency | 2 | No sort, no pagination, no bulk, no keyboard shortcuts on a potentially huge product table |
| 8 | Aesthetic and Minimalist Design | 2 | Page is dashboard + launcher + catalog + 21-link sitemap stacked vertically — too much |
| 9 | Error Recovery | 2 | No error state for failed fetch; `data ?? 0` silently renders "0 / 0" as reassuring zeros |
| 10 | Help and Documentation | 3 | Contextual tooltips on KPIs with Info icon; nothing broader |
| **Total** | | **26/40** | **Acceptable — significant improvements needed before users are happy** |

---

## Anti-Patterns Verdict

**Does this look AI-generated?** No — this reads as a hand-built shadcn/Radix dashboard by someone who knows the domain. No gradient text, no glassmorphism, no ghost-card borders+shadows, no sketchy SVG, no stripe/repeating-gradient backgrounds, no 32px+ card radii (radius scale tops out at 0.625rem). Restraint is on-brand for the "Command Center" north star. The AI-slop test is **passed**.

**Deterministic scan:** `detect.mjs` on the 6 files → exit 0, **0 findings**. No banned patterns, no contrast tells, no ghost cards. The codebase is clean at the rule-engine level.

**Visual overlays:** Browser automation is not exposed in this session, so no `[Human]` overlay was injected. Fallback signal: static source review + deterministic CLI scan.

The problems here are **not** slop — they're **IA and cognitive-load** problems the detector can't see.

---

## Overall Impression

A competent, on-brand dashboard that tries to be four surfaces at once: a KPI command center, a daily-action launcher, a product catalog, and a full 21-link sitemap of the inventory module. Each individual section is well-built; stacked on one scroll they compete for attention and none wins. The single biggest opportunity: **decide what this page is for.** Right now it answers "what do I do today?" and "where is everything?" and "what's my stock worth?" simultaneously — a manager with 15 branches will scroll past the answer that matters.

---

## What's Working

1. **Domain-native vocabulary and IA grouping.** "Recepción / Conteo / Merma / Nueva OC" as daily actions, and the module map grouped into Operar / Comprar / Analizar / Configurar — this maps cleanly to how a HORECA operations manager thinks. It speaks the user's language (heuristic 2) without being bureaucratic, which is exactly the PRODUCT.md anti-reference avoided.
2. **Restraint on color and decoration.** Flat surfaces, tonal layering via `muted/40`, `accent/50`, single Operational Red accent on primary actions and the alert state. No shadows-as-decoration, no rounded-32, no gradient accents. This is the "Confidence without bureaucracy" principle executed correctly.
3. **Loading and empty states are real.** `KpiCardsSkeleton`, `DataTableSkeleton`, and a branching `EmptyState` that distinguishes "search returned nothing" (with a clear-search action) from "no products at all" (with an add-product action). Many dashboards skip this; this one didn't.

---

## Priority Issues

### [P1] The page does too much — cognitive overload
**What:** One vertical scroll stacks: PageHeader → 4 daily-action cards → 4 KPI cards → 2 charts → 2 quick-alert cards → product catalog table → a 21-link "Todas las herramientas" sitemap card. That's 8 distinct sections, ~35 interactive items.
**Why it matters:** Violates the cognitive-load checklist on single-focus, chunking (≤4/group), and visual hierarchy. A manager scanning 15 branches can't find the one decision that matters today; everything has near-equal weight. The "Command Center" north star demands one clear view, not eight.
**Fix:** Pick a primary job. Recommended: make this the **status board** (KPIs + QuickAlerts + exception table), and move the 21-link sitemap off this page entirely — it duplicates the sidebar. Demote daily-actions into a slim toolbar or merge "Alertas Críticas" into the exception list. Target ≤4 sections above the fold.
**Suggested command:** `$impeccable distill`

### [P1] Silent failure on data-fetch errors renders reassuring zeros
**What:** `const stockValue = data?.totalStockValue ?? 0;` and `activeAlerts = data?.activeAlertsCount ?? 0;`. If `useDashboard` rejects, the page shows "$0.00" inventory value, "0" alertas, "Operación sin incidencias" — the most dangerous possible state, because it looks like a clean bill of health.
**Why it matters:** A manager acting on "0 alertas" when the API 500'd is an operational failure hidden inside compliance software. This is the Riley persona's #1 red flag and a direct hit on heuristic 9.
**Fix:** Distinguish `isLoading`, `isError`, and `isSuccess` from the query. Render an explicit error state (with retry) for the KPI block and the table when `isError`. Never let `undefined` masquerade as `0` for metrics that drive decisions.
**Suggested command:** `$impeccable harden`

### [P1] No data-recency indicator on time-sensitive metrics
**What:** "Valor del Inventario" and stock levels are shown as hard numbers with no "actualizado hace X" or last-sync timestamp anywhere on the page.
**Why it matters:** Inventory value and stock counts are meaningless without a timestamp. A manager doesn't know if $X is from this morning's receiving or last week's count. Heuristic 1 (visibility of system status) is partially met for actions but missing for data freshness.
**Fix:** Add a subtle "Actualizado · {relative time}" line near the PageHeader or on each KPI card footer. Surface the `updatedAt` from the dashboard payload.
**Suggested command:** `$impeccable clarify`

### [P2] Clickable KPI card is indistinguishable from non-clickable ones
**What:** "Alertas Críticas" is a `<Link>` wrapping a `Card` with `hover:border-primary cursor-pointer`. The other three KPI cards ("Valor del Inventario", "Facturas Conciliadas", "Pérdida por Merma") are plain, non-clickable `Card`s. Same visual family, different affordance, no persistent signal.
**Why it matters:** Users will click the non-clickable cards and get no response (heuristic 4 + recognition). The only cue is a hover border, which doesn't exist on touch and is invisible to screen readers.
**Fix:** Either make all four KPI cards clickable to their detail views (consistent + useful), or give the clickable one a persistent affordance — a trailing chevron or a "Ver detalle →" text link inside the card footer. Don't rely on hover-only border change.
**Suggested command:** `$impeccable polish`

### [P2] Product table has no sort, pagination, or density control
**What:** "Productos en Almacén" table offers only a search box and a 2-tab filter (Todos / Sin stock). No column sort (notably by stock level — the thing a manager cares about), no pagination, no column visibility toggle, no row count.
**Why it matters:** A branch with hundreds of SKUs becomes an unsortable wall. The power-user persona has no efficient path to "show me what's lowest." Heuristic 7 (flexibility/efficiency) scores 2 for this reason.
**Fix:** Add sortable headers (stock, name, category), pagination or virtualization above ~50 rows, and a "low stock first" default sort. Reuse the existing `Table` primitives.
**Suggested command:** `$impeccable layout`

### [P2] Low-stock vs expiring states rely on adjacent hues (amber vs orange)
**What:** "Stock Bajo" = `amber-500`/`amber-600`. "Próximos a Vencer" = `orange-500`/`orange-600`. Table rows use an amber `AlertTriangle` + amber-600 bold text for low stock. The two semantic states are hue-adjacent and indistinguishable for deuteranopia/protanopia.
**Why it matters:** Meaning conveyed by color alone (heuristic 4 + a11y). The PRODUCT.md accessibility note asks for "general best practices for contrast" — this fails the color-blindness case.
**Fix:** Differentiate by **shape + label**, not hue: a triangle icon for low-stock, a clock icon for expiring (already true in QuickAlerts), and add a text badge ("Bajo", "Vence") in the table row instead of relying on amber text. Keep color as reinforcement, not the sole carrier.
**Suggested command:** `$impeccable audit`

---

## Persona Red Flags

**Alex (Power User):** No keyboard shortcuts, no command palette, no sort/pagination on the product table, no bulk row selection. The 4 daily-action cards are fixed shortcuts — fine — but he can't jump to "everything below min" without leaving the page. The table's only row action is "Ver". He'll route around this page within a week.

**Sam (A11y):** Low-stock state in the table row is carried by an amber `AlertTriangle` + amber-600 bold text — color carries meaning with no text badge alternative. The "Alertas Críticas" KPI has a `bg-red-500` 2×2px dot with no text label or `aria-label`. Clickable-card affordance is hover-only (`hover:border-primary`), invisible to keyboard/touch users (though focus-visible rings are present on the Links themselves — good). The `cursor-help` Info icons rely on Radix tooltip accessibility, which is fine, but the trigger has no `aria-label`.

**Riley (Stress Tester):** The `data ?? 0` pattern means a failed `useDashboard` or `useInventory` fetch renders "$0.00 / 0 alertas / Operación sin incidencias / No se encontraron productos" — a broken state that looks like a clean slate. There's no `isError` branch anywhere in the tree. She'd report this as "silently lying to the user." Also: refreshing mid-drawer-open — drawer state is local `useState`, so it resets (minor, acceptable).

**Mariana (owner, 8 branches, morning tablet check — project-specific):** The page is single-branch-scoped via `selectedBranchId`. There's no cross-branch rollup or "which of my 8 branches needs me today?" view. Notably, `branchesWithStock` exists in the `DashboardKpis` data type but is **never rendered** — a multi-branch signal was built in the API and dropped in the UI. Mariana has to switch branches one at a time to find the one with the stock problem.

---

## Minor Observations

- The `ChevronRight` on daily-action cards is `opacity-0 group-hover:opacity-100` — on touch/coarse-pointer devices the "this is a link" affordance never appears. Scope it `sm:opacity-0` so it's always visible on mobile, or always show at reduced opacity.
- KPI numerals use `font-mono` (Geist Mono) — consistent with DESIGN.md's `mono` token for data. Good. But the `text-2xl font-bold` on numbers next to `text-sm font-medium` labels is a 4-step jump; the scale-ratio guidance for product UI is 1.125–1.2. Consider `text-xl` numerals for a tighter, less shouty hierarchy.
- `text-balance` on product names in the table is a nice touch, but `text-wrap: balance` on single-line table cells is a no-op — save it for headings.
- The tab toggle's "Sin stock" badge uses `variant="destructive"` red for a non-destructive count. Red = Operational Red is brand-consistent, but `destructive` semantically overstates "out of stock" as an error. A `warning`/amber badge would be truer.
- `QuickAlerts` empty state links to `/dashboard/inventory/alerts` from both cards — duplicate "Ver todas las alertas" links. Fine, but consider one footer link per card.
- `DashboardCharts` colors are hardcoded OKLCH literals duplicating `--chart-1..5` tokens. Use the CSS vars (`var(--chart-1)`) so dark mode stays consistent.

---

## Questions to Consider

- **Is this page a launchpad or a status board?** Right now it's both and neither wins. The "Todas las herramientas" sitemap suggests users can't find things in the sidebar — if that's true, fix the sidebar, don't compensate on the dashboard.
- **What would a "morning brief" version look like?** One screen that tells a manager the 3 things needing attention today across all branches. That's the Command Center north star; the current page is a catalog of capabilities, not a brief.
- **Where did `branchesWithStock` go?** The API returns it, the UI dropped it. Is multi-branch rollup a deliberate non-goal for this page, or an unfinished thread?
- **Can a failed data load ever be allowed to look like "0"?** What's the team's contract for null vs error in dashboard queries?

---

*Trend and snapshot path appended after persistence.*
