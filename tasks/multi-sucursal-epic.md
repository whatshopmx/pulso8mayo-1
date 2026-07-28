# Epic: Multi-Sucursal Dashboard Mode (follow-up to Task 9)

**Trigger:** Task 9 of the 2026-07-28 critique plan. `branchesWithStock` is returned by
the API but dropped in the UI — evidence the multi-sucursal "morning brief" (Mariana
persona, 8 branches: "which of my N branches needs me today?") was half-built. The team
chose to build a proper tenant-level rollup rather than surface a cheap badge.

**Scope:** Make the inventory dashboard meaningful when viewing **all branches at once**
(aggregate KPIs + per-branch exception attribution), without touching the global
BranchContext / `switchBranch` server action that every other page depends on.

## Architecture Decisions

- **Local branch filter, not global context.** Follow the `executive-dashboard` precedent:
  a per-page `branchFilter` state (`"all" | branchId`) with a "Todas las sucursales" Select
  item. The global `BranchContext` stays single-branch + persisted (used by every other
  page). The inventory dashboard's default becomes "all" for multi-branch users — that
  *is* the morning brief. Single-branch users (GERENTE/SUPERVISOR locked to one branch)
  get the filter hidden and default to their branch.
- **API tenant-level rollup when `branchId` is absent.** Drop the `branchId ?` guards.
  Tenant-scope the branch-only tables via JOINs:
  - `inventoryBatches` / `inventoryMovements` → join `branches` (has `companyId`).
  - `inventoryAlerts` / `inventoryWaste` already have `companyId` → drop the branch guard.
  - `inventoryItems`, `invoices`, `stockByCategory` already tenant-scoped → unchanged.
- **Per-branch attribution in exception lists.** In all-branches mode, `topLowStock` and
  `topExpiring` carry `branchId` + `branchName` (join `branches`) so Mariana sees *which*
  branch needs her — not just "something is low somewhere."
- **`branchesWithStock` = distinct branches with available stock, tenant-scoped.** Counted
  via `inventoryBatches` distinct `branchId` joined to `branches.companyId`. Drives the
  PageHeader badge.
- **No DB schema change.** All rollups are query-time JOINs on existing columns.

## Task List

### Slice E1: API tenant-level rollup (foundation, riskiest — SQL correctness) ✅
- [x] E1.1: `totalStockValue` — when no `branchId`, sum across all tenant branches
      (join `inventoryBatches` → `branches` on `companyId`).
- [x] E1.2: `activeAlertsCount` — drop `branchId` guard, keep `companyId` (table has it).
- [x] E1.3: `branchesWithStock` — distinct `branchId` count with available stock,
      tenant-scoped via `branches.companyId` (works in both modes).
- [x] E1.4: `recentMovements` — when no `branchId`, join `inventoryMovements` → `branches`
      on `companyId` for tenant scoping.
- [x] E1.5: `wasteLossTotal` / `wasteLossRatio` — drop `branchId` guard, keep `companyId`.
- [x] E1.6: `topLowStock` — when no `branchId`, include `branchId` + `branchName`
      (join `branches`); aggregate per item-per-branch so each row is actionable.
- [x] E1.7: `topExpiring` — when no `branchId`, include `branchId` + `branchName`.
**Verify:** `tsc --noEmit`; manual `curl` without `branchId` returns tenant-wide numbers
(not zeros); with `branchId` returns single-branch numbers (unchanged).

### Slice E2: Hook — remove `enabled: !!branchId`, add branch-attribution types ✅
- [x] E2.1: `useDashboard` — remove `enabled: !!branchId` so it fires in all-branches mode.
- [x] E2.2: `InventoryDashboardData` — add optional `branchId`/`branchName` to
      `topLowStock` and `topExpiring` item shapes.
**Verify:** `tsc --noEmit`; existing single-branch consumers compile unchanged.

### Slice E3: UI — local branch filter ("Todas las sucursales" + per-branch Select) ✅
- [x] E3.1: Add `branchFilter` state (`"all" | branchId`), default `"all"` for multi-branch
      users, single-branch users default to their branch (filter hidden).
- [x] E3.2: Pass `branchId` to `useDashboard`/`useInventory` only when not `"all"`.
- [x] E3.3: Render the Select (following `executive-dashboard` pattern) in the PageHeader
      actions area; hide when only one branch is accessible.
**Verify:** `tsc --noEmit` + build; switching filter refetches with the right scope.

### Slice E4: UI — "X sucursales con stock" badge + branch attribution in exceptions ✅
- [x] E4.1: PageHeader `badge` shows "{n} sucursales con stock" when in all-branches mode;
      hidden in single-branch mode.
- [x] E4.2: `QuickAlerts` — when items carry `branchName`, render it in each row (so the
      "which branch" signal is visible); hide attribution in single-branch mode.
**Verify:** build; badge appears in all-branches mode, hidden in single-branch;
exception rows show branch name only in all-branches mode.

### Slice E5: KPI meaning in all-branches mode (honest aggregate scope) ✅
- [x] E5.1: KPI subtitles / descriptions adapt to scope ("en todas las sucursales" vs the
      branch name) so aggregate numbers aren't misread as one branch's.
- [x] E5.2: Recency indicator tooltip already says "refresco de datos" — no change needed.
**Verify:** build; manual read — aggregate scope is unambiguous.

## Risks

| Risk | Mitigation |
|------|------------|
| Tenant-scope JOINs are slower on large catalogs | These are dashboard aggregates, already behind the same 30s staleTime; add indexes only if measured slow |
| `inventoryBatches` has no `companyId` — wrong JOIN leaks cross-tenant data | Always scope the JOIN on `branches.companyId = tenant.id`; verify with a multi-tenant fixture |
| Removing `enabled: !!branchId` makes the dashboard fire before a branch is chosen | That's intended now — all-branches is the default mode, not a gap |
| Per-branch `topLowStock` could return >5 rows across N branches | Keep `.limit()` but raise it in all-branches mode (e.g. 10) so one branch's lows don't crowd out others |

## Open Questions

- Should all-branches `topLowStock` cap at N-per-branch (fairness) or just global top-N?
  Plan: global top-N raised to 10 for E1.6; revisit if one branch dominates.
