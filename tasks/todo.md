# Dashboard Consistency & Architecture Pass — Task List

Source plan: `tasks/plan.md`. Critique baseline: `.impeccable/critique/2026-07-28T21-53-53Z__app-dashboard.md` (27/40, 3 P1, 7 P2). Target: ≥32/40, 0 P1.

Open questions (answer before starting — see `tasks/plan.md`):
- Q1: Server Component + Suspense (recommended) **vs** `useDashboard()` hook as the data-fetching floor? (decides T5–T7 direction)
- Q2: Pinned announcements → header bell or low section?
- Q3: All P1+P2 (T1–T13) or top-3 P1 only (T1–T7)?
- Q4: Is `app/dashboard/layout.tsx` open to change (T1/T3 touch it)?

---

## Phase 1 — Unified scope control

- [ ] **T1** Build `BranchScopeControl`, mount in layout header. *Files: `components/shared/branch-scope-control.tsx` (new), `app/dashboard/layout.tsx`. Size S.*
  - Acceptance: branch dropdown reads `useBranch()`, writes `pulso_selected_branch` cookie via `setSelectedBranchId`; date dropdown ports range logic from `dashboard-filters.tsx` to URL search params; `DashboardFilters` still coexists so the app builds.
  - Verify: `pnpm run build` clean; changing branch in header updates cookie; opening another section preserves selection.

- [ ] **T2** Migrate inventory page to header scope; delete local Select. *Files: `app/dashboard/inventory/page.tsx`. Size XS.*
  - Acceptance: no local `branchFilter` `useState`; reads `selectedBranchId` from `useBranch()`; `null` ⇒ "all" rollup; `badge` "N sucursales con stock" still computed.
  - Verify: build clean; scope flows from header to inventory without a page-local Select.

### Checkpoint A (after T1–T2)
- [ ] `pnpm run build` clean
- [ ] Header scope control drives inventory branch without a local Select
- [ ] Cookie survives cross-section navigation

---

## Phase 2 — Home remaster + filter retirement

- [ ] **T3** Remaster home: `PageContainer`+`PageHeader`, single padding owner, attention-queue lead. *Files: `app/dashboard/page.tsx`, `app/dashboard/layout.tsx`, maybe `components/dashboard/pending-actions.tsx`. Size M.*
  - Acceptance: bespoke executive header deleted; attention queue (`PendingRemediationActionsCard` + critical incidents, top-3 + "ver todo", **not** a hero-metric grid) is section #1; KPIs #2; layout double-padding removed (one padding owner).
  - Verify: build clean; home opens with the queue above the KPI grid.

- [ ] **T4** Retire `DashboardFilters`; delete dead code. *Files: `components/dashboard/dashboard-filters.tsx` (delete) + import sites. Size XS.*
  - Acceptance: no references remain; `grep -r "DashboardFilters"` empty.
  - Verify: build clean; grep empty.

### Checkpoint B (after T3–T4)
- [ ] `pnpm run build` clean
- [ ] Home leads with attention queue
- [ ] `grep -r "DashboardFilters"` empty in repo

---

## Phase 3 — Data-fetching standardization (AD-2)

- [ ] **T5** Migrate `ExecutiveSummary` to Server Component + Suspense (or to `useDashboard()` hook if Q1 chooses the hook). *Files: `components/dashboard/executive-summary.tsx`, `app/dashboard/page.tsx`, maybe `lib/services/analytics-service.ts`. Size M–L.*
  - Acceptance: no `useEffect`+`fetch`; loads via Suspense skeleton; error path renders `ErrorState` with retry (not silent null); `/api/analytics/executive-summary` consumers audited before swap.
  - Verify: build clean; `grep -n "setData(null)" components/dashboard/executive-summary.tsx` empty; simulate fetch failure → `ErrorState` shows.

- [ ] **T6** Migrate `compliance/page.tsx` off `useEffect`+`fetch` (Server Component preferred; `EmptyState`/`ErrorState` for broken/empty). *Files: `app/dashboard/compliance/page.tsx`. Size M.*
  - Acceptance: no client `/api/branches` fetch (uses layout-passed branches or server re-query); `EmptyState`/`ErrorState` wired.
  - Verify: build clean; no `useEffect`+`fetch` in this file.

- [ ] **T7** Standardize async error/loading/empty across section pages. *Files: `app/dashboard/labor/page.tsx`, others found in audit. Size M.*
  - Acceptance: every async section renders exactly one of `*Skeleton` / `EmptyState` / `ErrorState`+retry; labor "no company" state uses `EmptyState`.
  - Verify: build clean; manual scan of home, inventory, labor, compliance.

### Checkpoint C (after T5–T7)
- [ ] `pnpm run build` clean
- [ ] `grep -rn "useEffect" app/dashboard | grep fetch` empty
- [ ] `ExecutiveSummary` shows skeleton → error-state, never blank
- [ ] No client `/api/branches` re-fetch in `compliance/page.tsx`

---

## Phase 4 — Nav collapse + command palette *(parallelizable after T1)*

- [ ] **T8** Collapse Inventario nav to ~8 grouped sections; make `groupLabel` rows collapsible. *Files: `components/app-sidebar.tsx`, `components/nav-main.tsx`. Size M.*
  - Acceptance: ~8 visible groups, not 24 items; role-based filter still works for all 5 roles; `groupLabel` text raised to `text-xs` per T11.
  - Verify: build clean; expand/collapse each group; test EMPLEADO/READONLY/SUPERVISOR/GERENTE/ADMIN nav.

- [ ] **T9** Add `cmd+k` command palette (install `cmdk`; index nav leaves). *Files: `package.json`, `components/shared/command-palette.tsx`, `app/dashboard/layout.tsx`, `components/app-sidebar.tsx` (export `navMain`). Size M.*
  - Acceptance: `⌘K`/`Ctrl+K` opens; fuzzy over nav leaves; `Enter` navigates; `<Esc>` closes; `prefers-reduced-motion` instant; dynamic-imported so it never blocks initial load.
  - Verify: build clean; type "merma" → Enter → lands on Mermas page.

### Checkpoint D (after T8–T9)
- [ ] `pnpm run build` clean
- [ ] Inventario shows ~8 groups, not 24 items
- [ ] `⌘K` palette works end-to-end

---

## Phase 5 — Design-system polish (P2 sweep)

- [ ] **T10** Semantic color tokens in status badges + Badge variants. *Files: `components/ui/badge.tsx`, `components/dashboard/recent-workflows-table.tsx`, `app/dashboard/inventory/page.tsx`. Size S.*
  - Acceptance: `emerald-*`/`blue-*` → `success`/`info` tokens; `success`/`info`/`warning`/`destructive` Badge variants added; inventory dot → `bg-success`.
  - Verify: build clean; `grep -rn "emerald-500\|blue-500" components/dashboard app/dashboard` empty in badge contexts.

- [ ] **T11** Darken `--muted-foreground` to AA (≥4.5:1) + fix 10/11px type + `PageHeader` `text-wrap: balance`. *Files: `app/globals.css`, `app/dashboard/audit/page.tsx`, `app/dashboard/profile/onboarding/page.tsx`, `components/shared/page-header.tsx`. Size S.*
  - Acceptance: light `--muted-foreground` ~`oklch(0.45 0.012 85)`, dark ~`0.62`, measured ≥4.5:1 on each theme background; 10px/11px literals → `text-xs`; `PageHeader` `h1` has `text-wrap: balance`.
  - Verify: build clean; `detect.mjs --json app/dashboard` font-size findings == 0; contrast measured.

- [ ] **T12** Remove `border-b-2` accent borders (3 files) + compliance title l10n ("Compliance" → "Cumplimiento"). *Files: `ai-verifications/page.tsx`, `equipment/page.tsx`, `equipment/[id]/page.tsx`, `app/dashboard/compliance/page.tsx`. Size S.*
  - Acceptance: full border or bg tint replaces `border-b-2`; title localized.
  - Verify: build clean; `detect.mjs` `border-accent-on-rounded` findings == 0.

- [ ] **T13** Compliance IA: collapse 7 tabs to ≤4 primary + overflow/sub-nav. *Files: `app/dashboard/compliance/page.tsx`. Size S.*
  - Acceptance: ≤4 primary TabsTriggers visible; secondary in overflow or left sub-nav; existing `<Tabs>` component kept.
  - Verify: build clean; primary tabs ≤4; all 7 destinations still reachable.

### Checkpoint E (after T10–T13)
- [ ] `pnpm run build` clean
- [ ] `detect.mjs --json app/dashboard` → 0 findings (was 5)
- [ ] `--muted-foreground` ≥4.5:1 on both themes
- [ ] Compliance shows ≤4 primary tabs

---

## Phase 6 — Verify & polish

- [ ] **T14** Re-run `$impeccable critique app/dashboard/`; fix regressions. *Files: as surfaced. Size S.*
  - Acceptance: no `border-b-2`, no `useEffect`+`fetch` data fetch, no double padding reintroduced.
  - Verify: critique score ≥32, P1 == 0.

- [ ] **T15** Final `$impeccable polish app/dashboard/` (focus rings on card hovers, `aria-live` on attention queue, palette focus-visible). *Files: as surfaced. Size S.*
  - Acceptance: all surfaced polish items addressed.
  - Verify: build clean; manual keyboard pass on palette + attention queue.

### Checkpoint F (complete)
- [ ] Critique score ≥32 (was 27); P1 == 0; `detect.mjs` 0 findings
- [ ] All T1–T15 acceptance criteria met
- [ ] Ready for human review
- [ ] Re-run `$impeccable critique` after fixes to confirm the score

---

## Definition of Done (per-task, standing bar)

- [ ] `pnpm run build` exits 0
- [ ] `pnpm run lint` exits 0 (or pre-existing warning count unchanged)
- [ ] No new `detect.mjs` findings introduced
- [ ] Accessibility: interactions keyboard-reachable; new color ≥4.5:1; `prefers-reduced-motion` respected
- [ ] Multi-tenant: any new data access scoped by `companyId`/`tenantId`; no leaked cross-tenant reads
- [ ] i18n: new user-facing strings in Spanish via `next-intl`; no new English strings in `app/dashboard`
- [ ] No half-migrated state shipped — each task leaves the app building and a section fully done, never a hybrid mid-task