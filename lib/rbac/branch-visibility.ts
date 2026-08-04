/**
 * Pilar 4 — Branch visibility filter for cross-branch aggregation.
 *
 * Source: docs/pulso-executive-os-security.md §8.4.
 *
 * `branchVisibilityFilter` returns the subset of branches an actor may see,
 * given their `AccessContext` and the branches' ownership metadata. It is the
 * single chokepoint that every cross-branch aggregator (CrossBranchService's 8
 * aggregators, ExecutiveTwinEngine.recalculate) must call before aggregating —
 * otherwise a franchise manager can read sales/payroll/margins of other
 * franchises or of the group's owned branches.
 *
 * Sprint 1: ExecutiveTwinEngine.recalculate uses this for the optional scoped
 * (per-actor) recalculation; CrossBranchService adoption is Sprints 2/4 per
 * §10. The repo-cache key for those aggregators should include
 * `companyId + ownershipScope` (not just `companyId`) once adopted.
 */
import type { AccessContext, BranchOwnership } from "./abac";

/** Minimal branch projection the filter needs. */
export interface BranchOwnershipInfo {
  id: string;
  ownershipType: BranchOwnership;
  /** If FRANCHISE, the userId of the franchisee who owns the branch. */
  franchiseeUserId?: string | null;
}

/**
 * Return the ids of branches visible to `ctx`.
 *
 * Rules (docs §8.3 matrix):
 *   - OWNER / SUPER_ADMIN / ADMIN: all branches.
 *   - READONLY: owned branches only (no franchise detail) — per §8.3 HR row;
 *     READONLY mirrors compliance-only visibility, kept conservative.
 *   - GERENTE / SUPERVISOR / EMPLEADO: only their own branch (owned or their
 *     own franchise). Step enforce via ctx.ownershipScope + userBranchId.
 */
export function branchVisibilityFilter(
  ctx: AccessContext,
  branches: BranchOwnershipInfo[],
): string[] {
  const { userRole, userId, userBranchId, ownershipScope } = ctx;

  if (userRole === "OWNER" || userRole === "SUPER_ADMIN" || userRole === "ADMIN") {
    return branches.map((b) => b.id);
  }

  return branches
    .filter((b) => {
      // Owned branches: visible only if the actor's scope allows owned.
      if (b.ownershipType === "OWNED") {
        if (!ownershipScope.canSeeOwned) return false;
        // Branch-scoped roles only see their own branch.
        if (userRole === "GERENTE" || userRole === "SUPERVISOR" || userRole === "EMPLEADO") {
          return b.id === userBranchId;
        }
        return true; // READONLY etc.
      }

      // Franchise branches: gated by the franchise visibility scope.
      if (b.ownershipType === "FRANCHISE") {
        if (ownershipScope.canSeeFranchise === "NONE") return false;
        if (ownershipScope.canSeeFranchise === "ALL") return true;
        // OWN_BRANCH_ONLY: the franchise must belong to this actor.
        return !!b.franchiseeUserId && b.franchiseeUserId === userId;
      }

      return false;
    })
    .map((b) => b.id);
}

/** Convenience: does `ctx` see branch `bId` at all? */
export function canSeeBranch(
  ctx: AccessContext,
  branches: BranchOwnershipInfo[],
  bId: string,
): boolean {
  return branchVisibilityFilter(ctx, branches).includes(bId);
}