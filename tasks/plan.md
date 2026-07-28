# Implementation Plan: Dashboard Consistency & Architecture Pass

## Overview

Unify Pulso's dashboard around one scope control, one data-fetching strategy, and one header/page vocabulary; remaster the home page to lead with a ranked attention queue; collapse the Inventario nav and add a `cmd+k` command palette; then sweep the design-system P2s (semantic color tokens, sub-floor type, error/loading standardization, `border-b-2` removal). Lands the four confirmed architectural decisions and closes the 3 P1 + 7 P2 issues from the `app/dashboard/` critique (27/40 → target ≥32).

## Architecture Decisions

**AD-1 — Single scope control in the layout header, cookie as truth.**
A `BranchScopeControl` component lives in `app/dashboard/layout.tsx`'s header (next to `ModeToggle`). Branch selection writes the `pulso_selected_branch` cookie via the existing `BranchProvider.setSelectedBranchId` — the mechanism is already wired. Date range stays **URL-encoded** (`?startDate=&endDate=`) so links are shareable and per-page, but branch is cookie-only so it propagates across tabs and survives navigation.
*Rationale:* the critique found two scope UIs fighting (`DashboardFilters` `?branch=` vs inventory's cookie Select) — both wrap `BranchProvider` already; the conflict is the duplication, not the mechanism. Cookie wins because open-in-new-tab and cross-section consistency matter for a 15-branch owner.

**AD-2 — Server Component + Suspense is the floor; client hook only for local re-fetch.**
Read-heavy operational dashboards default to Server Components querying `db` directly, streamed via `<Suspense fallback={<…Skeleton/>}>` (the home-page `ComplianceMetrics`/`DashboardCharts` pattern). The `useDashboard()`/`useInventory()` TanStack-query hook survives only where a component needs re-fetch on local interaction without a navigation round-trip (and where the header cookie change already invalidates the query).
*Rationale:* the `useEffect` + `fetch("/api/...")` pattern silently nulls on failure (`ExecutiveSummary`) and `console.error`s only (`compliance/page.tsx`) — Heuristics 9 & 1. Server Components inherit auth/tenant from the layout, stream for free, and remove duplicated client-side `/api/branches` fetching the layout already does. This is the larger refactor; flag for human before starting (see Open Questions).

**AD-3 — Home leads with a ranked attention queue, not a KPI grid.**
`PendingRemediationActionsCard` + critical incidents become section #1 on the home dashboard, rendered as a compact ranked list (top 3 visible, "ver todo" expansion), **not** a fourth hero-metric grid (banned template). KPI grid moves to #2; charts drop lower. Pinned announcements move below the queue or fold into a header bell.
*Rationale:* the Mariana persona (3–15 branch owner reading a morning brief) currently scrolls past announcements + KPIs before reaching the most owner-relevant block. The single-pane-of-glass promise is diluted by a long scroll. Act first, then measure.

**AD-4 — Collapse Inventario to ~8 groups + `cmd+k` fast path.**
Re-group the 24 Inventario leaf items into 8 collapsed nav groups, then add a `cmd+k` command palette (new `cmdk` dependency) indexed over every nav leaf so Alex can type "merma" and jump. Collapse lightens the nav; cmd+k is the fast lever that makes a calm nav viable.
*Rationale:* 24 vertical submenu items exceed the ≤5 working-memory ideal. A command palette is the Linear/Raycast affordance and the reason the nav can afford to stay calm.

## Task List

### Phase 1: Unified scope control

- [ ] **T1 — Build `BranchScopeControl`, mount in layout header.** New `components/shared/branch-scope-control.tsx`. Branch dropdown + date-range dropdown (port the date-range logic from `components/dashboard/dashboard-filters.tsx`). Reads `useBranch()` for branches + selected; writes cookie via `setSelectedBranchId`. Date range writes URL search params via `useRouter`. Mount in `app/dashboard/layout.tsx` header next to `ModeToggle`. Keep `DashboardFilters` coexisting for now (app still builds). *Files: `components/shared/branch-scope-control.tsx`, `app/dashboard/layout.tsx`.* **S**.
- [ ] **T2 — Migrate inventory page to header scope; delete local Select.** `app/dashboard/inventory/page.tsx`: remove the local `branchFilter` `useState` + `<Select>`; read `selectedBranchId` from `useBranch()` (`null` ⇒ "all" rollup). `dashboardData` query key stays branch-scoped. `badge` "N sucursales con stock" still computed from data. *Files: `app/dashboard/inventory/page.tsx`.* **XS**.

### Checkpoint A — T1–T2
- [ ] `pnpm run build` clean
- [ ] Header scope control changes branch on inventory page without a local Select
- [ ] Cookie survives navigation to another section and back
- [ ] Date range still shares via URL on the home dashboard (old `DashboardFilters` still wired there)

### Phase 2: Home remaster + filter retirement

- [ ] **T3 — Remaster home page: header scope + attention queue lead.** `app/dashboard/page.tsx`: (a) delete the inline `DashboardFilters` usage + the bespoke `border-b bg-card` executive header; adopt `PageContainer` + `PageHeader` with `actions={<BranchScopeControl/>}`-equivalent (header already mounts it, so `PageHeader.actions` may be empty or carry `ComplianceReportGenerator` only); remove the layout/header double-padding by making `PageContainer` the single padding owner. (b) Reorder sections: **#1 attention queue** (render `PendingRemediationActionsCard` + critical-incidents list, top 3 + "ver todo" expansion, no hero-metric grid), **#2** KPI metrics, **#3** executive summary, **#4** KPI summary, **#5** charts, **#6** alert distribution, **#7** recent activity; pinned announcements fold to a header bell or drop to a low section. *Files: `app/dashboard/page.tsx`, `app/dashboard/layout.tsx` (padding owner), maybe `components/dashboard/pending-actions.tsx` (expansion UI).* **M**.
- [ ] **T4 — Retire `DashboardFilters`; delete dead code.** Once T1+T3 land and no consumer references `DashboardFilters`, delete `components/dashboard/dashboard-filters.tsx` and its imports. *Files: `components/dashboard/dashboard-filters.tsx` (delete), any import sites.* **XS**.

### Checkpoint B — T3–T4
- [ ] `pnpm run build` clean
- [ ] Home opens with the attention queue above the KPI grid
- [ ] Branch + date scope flows from the single header control to every home section
- [ ] No references to `DashboardFilters` remain (`grep -r "DashboardFilters"` empty)

### Phase 3: Data-fetching standardization (AD-2)

- [ ] **T5 — Migrate `ExecutiveSummary` to Server Component + Suspense.** `components/dashboard/executive-summary.tsx`: convert from client `useEffect`+`fetch` to a server component fetcher (move the `/api/analytics/executive-summary` logic into a `lib/services/` function or `app/api/.../route.ts` server read, query `db` directly with tenant from session). Wrap in `<Suspense fallback={<ChartSkeleton/>}>` in the home page. Add an `ErrorState` with retry for the error path. Delete the silent `setData(null)` `return null`. *Files: `components/dashboard/executive-summary.tsx`, `app/dashboard/page.tsx`, maybe `lib/services/analytics-service.ts`.* **M–L**.
- [ ] **T6 — Migrate `compliance/page.tsx` off `useEffect`+`fetch`.** Convert the `/api/branches` client fetch + the compliance fetch to Server Components using `getCurrentTenant()` / `BranchService.listBranches` (layout already has branches; pass via props or re-query server-side). Wire `EmptyState`/`ErrorState` for the empty/broken cases. *Files: `app/dashboard/compliance/page.tsx`.* **M**.
- [ ] **T7 — Standardize error/loading/empty across async sections.** Audit every section page's async data path; each renders exactly one of `*Skeleton` (loading via Suspense), `EmptyState` (empty), `ErrorState` with retry (error). Confirm `components/shared/error-state.tsx` is the canonical error UI and wire it where missing (e.g., labor "no company" state should use `EmptyState`). *Files: `app/dashboard/labor/page.tsx`, `app/dashboard/compliance/page.tsx`, others found in audit.* **M**.

### Checkpoint C — T5–T7
- [ ] `pnpm run build` clean
- [ ] No `useEffect`+`fetch("/api/...")` data patterns remain in `app/dashboard/` (`grep -rn "useEffect" app/dashboard | grep fetch` empty)
- [ ] `ExecutiveSummary` renders a skeleton while loading, an `ErrorState` on failure (not a blank gap)
- [ ] `compliance/page.tsx` no longer re-fetches `/api/branches` client-side
- [ ] Every async section shows one of skeleton / empty / error

### Phase 4: Nav collapse + command palette

- [ ] **T8 — Collapse Inventario nav to ~8 grouped sections.** `components/app-sidebar.tsx` + `components/nav-main.tsx`: re-structure the 24 Inventario leaf items into 8 collapsed groups (e.g., Panel + Productos inside the top group; Operar / Comprar / Analizar / Configurar remain as group labels with their items). Make `groupLabel` rows collapsible so a group can be hidden. Keep `groupLabel` typographic treatment but raise the `text-[10px]` to `text-xs` (see T11). *Files: `components/app-sidebar.tsx`, `components/nav-main.tsx`.* **M**. *Can parallelize with T9 after T1.*
- [ ] **T9 — Add `cmd+k` command palette.** Install `cmdk`. New `components/shared/command-palette.tsx` (rendered in `app/dashboard/layout.tsx`, triggered by `⌘K`/`Ctrl+K`). Index over every nav leaf from the sidebar's `navMain` config (export it from `app-sidebar.tsx` so the palette reuses the same source of truth). Fuzzy search, `⌘ Enter` to navigate. `<Esc>` to close. *Files: `package.json`, `components/shared/command-palette.tsx`, `app/dashboard/layout.tsx`, `components/app-sidebar.tsx` (export `navMain`).* **M**. *Can parallelize with T8.*

### Checkpoint D — T8–T9
- [ ] `pnpm run build` clean
- [ ] Inventario submenu shows ~8 groups, not 24 items
- [ ] `⌘K` opens the palette, typing "merma" lands on the Mermas page, `Enter` navigates
- [ ] `prefers-reduced-motion` respected (palette open is instant under reduced motion)

### Phase 5: Design-system polish (the P2 sweep)

- [ ] **T10 — Semantic color tokens in status badges.** `components/dashboard/recent-workflows-table.tsx`: replace `emerald-500/600/400` → `success`/`success-foreground`, `blue-500/600/400` → `info`/`info-foreground`. Add `bg-success/10 text-success border-success/20` (and `info`, `warning`, `destructive`) Badge variants in `components/ui/badge.tsx`. Inventory "Actualizado" dot `bg-emerald-500` → `bg-success`. *Files: `components/ui/badge.tsx`, `components/dashboard/recent-workflows-table.tsx`, `app/dashboard/inventory/page.tsx`.* **S**.
- [ ] **T11 — Darken `--muted-foreground` to AA + fix sub-floor type.** `app/globals.css`: `--muted-foreground` light → `oklch(0.45 0.012 85)`, dark → `~0.62`; re-measure to ≥4.5:1 on `--background`. `audit/page.tsx:840` and `profile/onboarding/page.tsx:171` → `text-xs` (12px). `PageHeader` `h1` add `text-wrap: balance`. Re-run `node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard` and confirm the 2 font-size findings clear. *Files: `app/globals.css`, `app/dashboard/audit/page.tsx`, `app/dashboard/profile/onboarding/page.tsx`, `components/shared/page-header.tsx`.* **S**.
- [ ] **T12 — Remove `border-b-2` accent borders; compliance title l10n.** `ai-verifications/page.tsx:215`, `equipment/page.tsx:267`, `equipment/[id]/page.tsx:226`: replace `border-b-2` accent with a full border or background tint. `compliance/page.tsx` page title "Compliance" → "Cumplimiento". Re-run detect and confirm the 3 `border-accent-on-rounded` findings clear. *Files: 3 equipment/ai-verifications pages, `app/dashboard/compliance/page.tsx`.* **S**.
- [ ] **T13 — Compliance IA: collapse 7 tabs to ≤4 + overflow.** `app/dashboard/compliance/page.tsx`: group 7 tabs into 4 primary (Dashboard, NOM-251, NOM-035, IMSS/Nómina) and sink the rest into a "Más" overflow or a left sub-nav. Keep the existing `<Tabs>` component. *Files: `app/dashboard/compliance/page.tsx`.* **S**.

### Checkpoint E — T10–T13
- [ ] `pnpm run build` clean
- [ ] `detect.mjs` reports 0 findings (was 5)
- [ ] Status badges use semantic tokens; `grep -rn "emerald-500\|blue-500" components/dashboard app/dashboard` for badge contexts is empty
- [ ] `--muted-foreground` measures ≥4.5:1 on white and on dark `--background`
- [ ] Compliance page shows ≤4 primary tabs

### Phase 6: Verify & polish

- [ ] **T14 — Re-run critique; fix any regression.** `$impeccable critique app/dashboard/`. Address anything reintroduced. Confirm no `<div className="border-b-2">`, no `useEffect`+`fetch` data fetch, no double padding. *Files: as surfaced.* **S**.
- [ ] **T15 — Final `$impeccable polish app/dashboard/`.** Sweep any residual detail (focus rings on card hovers, `aria-live` on the attention queue, focus-visible on the palette). *Files: as surfaced.* **S**.

### Checkpoint F — Complete
- [ ] Critique score ≥32 (was 27); P1 count 0; `detect.mjs` 0 findings
- [ ] All acceptance criteria for T1–T15 met
- [ ] Ready for human review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **AD-2 fork**: the user may prefer the `useDashboard()` client-hook as floor rather than Server Component + Suspense, which inverts T5–T7. | High | Open Question Q1 below; confirm before T5. If flipped, T5/T6 migrate *to* the hook (with `isError`+`onRetry`) instead of to Server Components; the silent-error P1 still clears. |
| Cookie-vs-URL scope merge breaks deep links carrying `?branch=`. | Medium | T1 keeps `?startDate=&endDate=` URL-encoded (shareable). Branch moves to cookie only; add a one-time redirect/absorb of `?branch=` → cookie on first load in T1 so old links still work. |
| `cmdk` adds a dependency; bundle size on the dashboard. | Low | `cmdk` is ~7KB gzipped, dynamic-imported only after first `⌘K` ping so it never blocks initial load. |
| Server Component migration of `ExecutiveSummary` may need a server-side analytics service route refactor. | Medium | T5 explicitly allows extracting the logic to `lib/services/`; verify the `/api/analytics/executive-summary` route isn't called by other (cron/Inngest) consumers before swapping — `grep -rn "/api/analytics/executive-summary"`. |
| Home reorder shifts chart-loading order; Suspense streaming layout shift. | Low | Keep `ChartSkeleton` heights fixed; the attention queue is fully synchronous (server-fetched), so it paints first without layout shift. |
| Inventario re-grouping breaks role-based nav filter in `app-sidebar.tsx`. | Medium | T8 keeps the same `navMain` data shape (just reordered + grouped); the role filter only matches on `section.title` and `url.includes()` — re-test all 5 roles after T8. |
| Phase 3 touches many section pages; risk of shipping half-migrated state. | Medium | Checkpoints C and D gate forward progress; each task leaves the app building and a section fully migrated, never a hybrid mid-task. |

## Open Questions

- **Q1 (AD-2 fork — confirm before T5):** Server Component + Suspense as the floor (my recommendation: removes silent errors, inherits tenant, streams for free) **OR** keep the `useDashboard()` client-hook as the floor (familiar, has `isError`/`onRetry` already wired) and migrate *to* the hook instead? The silent-error P1 clears either way; the difference is which code style wins long-term.
- **Q2:** Does the home "pinned announcements" block fold into a header notification bell, or stay as a low-priority section below the attention queue? (Bell is more work; section is cheaper and still on-brand.)
- **Q3 (scope):** Does this pass cover **all P1 + P2** (7 issues, the plan above) or stop at **top 3 P1 only** (T1–T7 plus a polish pass)? The P2 sweep (T8–T13) is where the score moves from "Acceptable" to "Good."
- **Q4 (off-limits):** Is `app/dashboard/layout.tsx`'s header structure open to change (T1 adds a control; T3 changes padding ownership), or should the home page's executive header stay as a fixed anchor and only the section pages move to `PageContainer`?

## Estimated total

14 tasks across 6 phases, ~6 checkpoints. Mix of S/M with one M–L (T5). At S–M granularity each is a single focused session. Phases 1–2 (T1–T4) are the visible quick wins; Phase 3 (T5–T7) is the architecture investment; Phases 4–5 (T8–T13) are the nav + design-system polish. T8 and T9 can run in parallel after T1; T10/T11/T12 are independent of each other once T7 lands.