# Implementation Plan: Inventory Dashboard — 2026-07-28 Critique (26/40)

## Overview

Address the design audit at `.impeccable/critique/2026-07-28T19-07-38Z__app-dashboard-inventory.md`
(score **26/40**, 0 P0 / 3 P1 / 3 P2). The page `app/dashboard/inventory/page.tsx` is a competent,
on-brand command center that tries to be four surfaces at once and silently masks fetch failures as
reassuring zeros. Work is split into 3 phases: **truthfulness & hardening** (P1 safety, no IA change),
**affordance & a11y polish** (P2), and **power + distill** (P1 cognitive load + P2 table power).
The distill is gated behind a human-review checkpoint because it changes the page's identity.

This plan supersedes the prior `tasks/plan.md` (which targeted the older 21/40 audit and is largely
complete — e.g. chart gradients are already solid fills).

## Architecture Decisions

- **Query state tri-state:** Use React Query's `isLoading` / `isError` / `isSuccess` from the existing
  `useInventory` / `useDashboard` hooks. No new data-fetching layer. Render explicit error states with a
  retry (`refetch`) — never let `undefined` render as `0` for decision-driving metrics.
- **Recency source:** Add `generatedAt: new Date().toISOString()` to the `/api/inventory/dashboard`
  response and thread it through `useDashboard`'s typed return. Render as a relative "Actualizado · X"
  via a small `useRelativeTime` helper. No DB schema change — it's the response time, not row freshness.
- **Error state component:** Add one reusable `ErrorState` to `components/shared/` (icon + message + retry
  button) so KPIs, charts, alerts, and the table share one pattern and one a11y baseline.
- **Color-blindness:** Differentiate low-stock vs expiring by **shape + text label**, color as
  reinforcement only. Use the existing `warning` badge variant (already in `badge.tsx`).
- **Chart colors:** Replace hardcoded OKLCH literals in `dashboard-charts.tsx` with `var(--chart-1..5)`
  CSS vars so dark mode stays consistent.
- **Page identity is decided: STATUS BOARD.** Confirmed by code inspection — the sidebar
  (`components/app-sidebar.tsx` L96–192) already exposes the same 21 inventory links with the same
  4 grouping (Operar/Comprar/Analizar/Configurar) in a `Collapsible`. The dashboard sitemap is an exact
  duplicate, not compensation for a weak sidebar. So the launchpad job is already covered, and the
  dashboard's reason to exist is the thing the sidebar cannot be: a branch- and time-conditional state view.
- **Distill is no longer gated.** The human-review gate was precautionary; the sidebar inspection resolves
  it. Task 11 proceeds as a distill (deletions + restructure), not as an identity decision.
- **Multi-branch rollup is an elevated product decision, not a minor task.** `branchesWithStock` being
  returned by the API but dropped in the UI is evidence the multi-sucursal "morning brief" was the original
  intent and got half-built. Task 9 surfaces the signal as a badge (cheap, honest), but whether a full
  cross-branch rollup view is the north star is a product question that may spawn a follow-up epic.
- **Multi-branch thread:** `branchesWithStock` is returned by the API but never rendered. We will
  surface it as a PageHeader badge ("X sucursales con stock") in Phase 2 rather than drop it, so
  Mariana's cross-branch signal lives somewhere. Full rollup is out of scope (open question).

## Task List

### Phase 1: Truthfulness & Hardening (P1 safety)

- [ ] Task 1: Add `generatedAt` to dashboard API + thread through `useDashboard`
- [ ] Task 2: Add reusable `ErrorState` to `components/shared/`
- [ ] Task 3: Tri-state KPI block — error/loading/success, no `?? 0` on success-critical metrics
- [ ] Task 4: Tri-state QuickAlerts + DashboardCharts + product table — error branches with retry

### Checkpoint: Foundation — Truthfulness
- [ ] `pnpm run build` succeeds
- [ ] With API forced to 500, the page shows error states (not "$0.00 / 0 alertas / sin incidencias")
- [ ] With API healthy, existing numbers render unchanged
- [ ] No metric can render a hard-coded `0` from an `undefined` payload

### Phase 2: Affordance, A11y & Polish (P2)

- [ ] Task 5: Data-recency indicator ("Actualizado · {relative time}")
- [ ] Task 6: KPI clickable affordance + a11y (chevron, "Ver detalle →", alert-dot aria-label, Info aria-labels)
- [ ] Task 7: Color-blindness — shape+label for low-stock/expiring; "Sin stock" badge → warning
- [ ] Task 8: Minor polish bundle (ChevronRight `sm:opacity-0`, numeral `text-xl`, drop `text-balance`
      on cells, dedupe alert footer links, charts → `var(--chart-*)`)
- [ ] Task 9: Surface `branchesWithStock` in PageHeader

### Checkpoint: Polish
- [ ] `pnpm run build` succeeds
- [ ] Keyboard-only: focusable KPI card is identifiable without hover; alert dot announced
- [ ] Color-blind simulation: low-stock vs expiring distinguishable without hue
- [ ] Dark mode: charts use theme tokens (no washed-out hardcoded OKLCH)

### Phase 3: Power + Distill (P1 cognitive load, P2 table power)

- [ ] Task 10: Product table — sortable headers, "low stock first" default sort, pagination, row count
- [ ] Task 11: Distill page IA — remove 21-link sitemap, demote daily-actions, merge alerts into
      exception list, target ≤4 sections above the fold (status board identity confirmed; gate removed)

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] `pnpm run build` + `pnpm run lint` clean
- [ ] Above-the-fold section count ≤4
- [ ] Ready for review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Distill removes a navigation path users rely on | Low | Sidebar (`app-sidebar.tsx` L96–192) already exposes the same 21 links grouped identically — removal loses no route. Gate removed; verified against code |
| Error state changes layout height, causing CLS | Med | Match skeleton/error block heights to the success-state block (reuse `KpiCardsSkeleton` sizing) |
| `generatedAt` is response time, not true data freshness | Med | Label honestly as "Actualizado" (last dashboard fetch), not "último conteo". Document in tooltip |
| Table sort/pagination adds client cost on huge catalogs | Low | Reuse existing `Table` primitives; paginate at 50 rows; data is already client-side filtered |
| Multi-branch `branchesWithStock` misleads when filtered to one branch | Low | Only render the badge in cross-branch/no-branch context; hide when a single branch is selected |

## Decisions Resolved

- **Page identity: STATUS BOARD.** Confirmed by code, not opinion. The sidebar already contains the same
  21 inventory links with the same 4-group IA (`components/app-sidebar.tsx` L96–192), so the dashboard's
  21-link sitemap is a duplicate, not compensation for a weak sidebar. The launchpad job is covered; the
  dashboard's job is the conditional state view the sidebar cannot be. Task 11 proceeds as a distill.
- **Sidebar health: verified healthy.** The "fix the sidebar instead" hypothesis from the critique does
  not hold against the code. No sidebar work is in scope or blocking.

## Open Questions (need product input)

- **Can a failed load ever be allowed to look like `0`?** Phase 1 assumes *no*. Confirm this is the
  team's contract for null vs error in dashboard queries.
- **Full multi-branch rollup (Mariana persona):** Is "which of my N branches needs me today?" the north
  star for this page, or a separate executive view? Evidence: `branchesWithStock` is returned by the API
  but dropped in the UI — suggests the multi-branch "morning brief" was the original intent and got
  half-built. Task 9 surfaces the signal cheaply as a badge; if the answer is "rollup is the north star",
  that spawns a follow-up epic (cross-branch exception view) beyond this plan.
- **Why was the sitemap added originally?** Not blocking (we remove it regardless — it duplicates the
  sidebar), but worth asking the team: was the sidebar collapsed on mobile by default? Did the author
  not know the sidebar existed? May reveal a real mobile-nav problem worth a separate task.
