/**
 * Pilar 1 — Attribute-Based Access Control (ABAC).
 *
 * Source: docs/pulso-executive-os-security.md §5.1.
 *
 * Sprint 1 introduction (additive, NOT adopted across the 84 services yet —
 * adoption rolls out by domain in Sprints 2/4 per §5.2):
 *   - `EvaluateAccess` decides on 4 axes: role + branchId + ownershipType +
 *     dataClassification.
 *   - `requirePermissionApi` is the API-route guard that callers migrate to
 *     from `requireRoleApi` (it internally authenticates via `requireRoleApi`
 *     then runs `evaluateAccess`). Until a route migrates, behaviour is
 *     unchanged because `requireRoleApi` is still the only guard in place.
 *
 * Design notes:
 *   - `Role` and the `PERMISSIONS` matrix come from `lib/permissions.ts`.
 *   - Branch scoping applies to GERENTE/SUPERVISOR/EMPLEADO: they only see
 *     their own branch. OWNER/ADMIN/SUPER_ADMIN are not branch-scoped.
 *   - Data classification gate: SENSITIVE/FINANCIAL reads require a role with
 *     the gate (SUPER_ADMIN/OWNER/ADMIN — HR is Sprint 3 once the role enum
 *     gains 'HR'). See lib/db/schema/classification.ts SENSITIVE_GATE_ROLES.
 */
import type { Role, Resource, Action } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { SENSITIVE_GATE_ROLES } from "@/lib/db/schema/classification";
import type { DataClassification } from "@/lib/db/schema/classification";
import { requireRoleApi } from "@/lib/rbac/require-role";
import { ApiError } from "@/lib/api/error";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/** Ownership type of a branch resource (Pilar 4). */
export type BranchOwnership = "OWNED" | "FRANCHISE";

/** How much franchise data an actor is allowed to see. */
export type FranchiseVisibility = "NONE" | "OWN_BRANCH_ONLY" | "ALL";

/** AccessContext carried for the actor making a request. */
export interface AccessContext {
  userId: string;
  userRole: Role;
  userCompanyId: string;
  userBranchId?: string | null;
  ownershipScope: {
    canSeeOwned: boolean;
    canSeeFranchise: FranchiseVisibility;
  };
}

/** A target resource being accessed. */
export interface AccessTarget {
  branchId?: string;
  companyId?: string;
  ownershipType?: BranchOwnership;
  franchiseeUserId?: string | null;
  dataClassification?: DataClassification;
}

/** Result of an access decision. */
export interface AccessDecision {
  allowed: boolean;
  /** Fields to mask in the response even when read is allowed (Pilar 2). */
  redactFields?: string[];
  reason?: string;
}

/** Roles scoped to their own branch by default (Pilar 1 step 2). */
const BRANCH_SCOPED_ROLES: Role[] = ["GERENTE", "SUPERVISOR", "EMPLEADO"];

/**
 * Evaluate access on 4 axes (role ⊕ branch ⊕ classification ⊕ ownership).
 *
 * Returns a fully-populated AccessDecision. Callers should log the decision
 * (via `dataAccessLogs`, §9) regardless of outcome — denies are attack signals.
 */
export function evaluateAccess(
  resource: Resource,
  action: Action,
  ctx: AccessContext,
  target?: AccessTarget,
): AccessDecision {
  // 1. RBAC base matrix.
  if (!hasPermission(ctx.userRole, resource, action)) {
    return { allowed: false, reason: "role-not-permitted" };
  }

  // 2. Branch scoping — branch-scoped roles can only touch their own branch.
  if (
    BRANCH_SCOPED_ROLES.includes(ctx.userRole) &&
    target?.branchId &&
    target.branchId !== ctx.userBranchId
  ) {
    return { allowed: false, reason: "branch-out-of-scope" };
  }

  // 3. Data classification gate — SENSITIVE/FINANCIAL needs an elevated role.
  const classification: DataClassification | undefined =
    target?.dataClassification;
  if (classification === "SENSITIVE" || classification === "FINANCIAL") {
    if (!SENSITIVE_GATE_ROLES.has(ctx.userRole)) {
      return { allowed: false, reason: "insensitive-data-gate" };
    }
    // Lower roles that somehow pass the base matrix still get masked values.
    // (Masked fields are computed by lib/rbac/masking.ts in Sprint 2 — declared
    // here so the API layer can ask for them without recomputing the decision.)
    if (ctx.userRole === "ADMIN") {
      // ADMIN reads but financial PII is masked unless acting for the group.
      // Sprint 2 refines; Sprint 1 leaves ADMIN full read (no redaction yet).
    }
  }

  // 4. Franchise isolation (Pilar 4). Branch-scoped actors are already
  // confined by step 2; here we additionally ensure a GERENTE of an OWNED
  // branch cannot cross into a FRANCHISE branch (and vice-versa) unless the
  // scope explicitly grants it.
  if (target?.ownershipType === "FRANCHISE") {
    const canSee = ctx.ownershipScope.canSeeFranchise;
    if (canSee === "NONE") {
      return { allowed: false, reason: "franchise-not-visible" };
    }
    if (
      canSee === "OWN_BRANCH_ONLY" &&
      target.franchiseeUserId &&
      target.franchiseeUserId !== ctx.userId
    ) {
      return { allowed: false, reason: "franchise-not-owned-by-actor" };
    }
  }
  if (
    target?.ownershipType === "OWNED" &&
    !ctx.ownershipScope.canSeeOwned &&
    ctx.userRole !== "OWNER" &&
    ctx.userRole !== "SUPER_ADMIN"
  ) {
    return { allowed: false, reason: "owned-not-visible" };
  }

  return { allowed: true };
}

/**
 * Build the default ownership scope for a role (Pilar 4 §8.3 matrix).
 *
 * OWNER/SUPER_ADMIN/ADMIN see the whole group (owned + all franchises).
 * HR (Sprint 3) will get canSeeFranchise capped at compliance-only (no
 * margins) — out of scope here, default to NONE until the role exists.
 */
export function buildOwnershipScope(
  role: Role,
): AccessContext["ownershipScope"] {
  switch (role) {
    case "OWNER":
    case "SUPER_ADMIN":
    case "ADMIN":
      return { canSeeOwned: true, canSeeFranchise: "ALL" };
    case "GERENTE":
    case "SUPERVISOR":
    case "EMPLEADO":
      // Branch-scoped actors: they may see their own branch only (owned or
      // their own franchise). canSeeFranchise 'OWN_BRANCH_ONLY' + step 4
      // enforces that the franchise must belong to them.
      return { canSeeOwned: true, canSeeFranchise: "OWN_BRANCH_ONLY" };
    case "READONLY":
      return { canSeeOwned: true, canSeeFranchise: "NONE" };
    default:
      return { canSeeOwned: false, canSeeFranchise: "NONE" };
  }
}

// ---------------------------------------------------------------------------
// API route guard — the Sprint 2/4 migration target.
// ---------------------------------------------------------------------------

export interface RequirePermissionResult {
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
  user: {
    id: string;
    role: Role;
    companyId?: string | null;
    branchId?: string | null;
  };
  ctx: AccessContext;
  decision: AccessDecision;
}

/**
 * API-route guard that authenticates (reusing `requireRoleApi`) and runs an
 * ABAC `evaluateAccess` decision. Throws 403 with the deny reason on failure.
 *
 * Sprint 1: introduced but call-sites are 0 — routes still use `requireRoleApi`.
 * Sprint 2 migrates `/api/finance/*`, `/api/payroll/*` with classification
 * 'FINANCIAL'; Sprint 4 migrates `/api/executive/*`.
 */
export async function requirePermissionApi(
  resource: Resource,
  action: Action,
  opts?: {
    targetBranchId?: string;
    targetOwnershipType?: BranchOwnership;
    classification?: DataClassification;
    franchiseeUserId?: string | null;
  },
): Promise<RequirePermissionResult> {
  // Reuse the existing auth primitive so the auth path never diverges.
  const { session, userRole, user } = await requireRoleApi([]); // any authenticated role
  const companyId = user.companyId ?? "";

  const ctx: AccessContext = {
    userId: user.id,
    userRole,
    userCompanyId: companyId,
    userBranchId: user.branchId ?? null,
    ownershipScope: buildOwnershipScope(userRole),
  };

  const decision = evaluateAccess(resource, action, ctx, {
    branchId: opts?.targetBranchId,
    ownershipType: opts?.targetOwnershipType,
    franchiseeUserId: opts?.franchiseeUserId,
    dataClassification: opts?.classification,
    companyId,
  });

  if (!decision.allowed) {
    throw ApiError.forbidden(decision.reason ?? "access-denied");
  }

  return { session, user, ctx, decision };
}

/** Convenience: build an AccessContext from the current session. */
export async function buildAccessContext(): Promise<AccessContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as
    | { id: string; role?: Role; companyId?: string | null; branchId?: string | null }
    | undefined;
  if (!user) return null;
  const role = (user.role ?? "EMPLEADO") as Role;
  return {
    userId: user.id,
    userRole: role,
    userCompanyId: user.companyId ?? "",
    userBranchId: user.branchId ?? null,
    ownershipScope: buildOwnershipScope(role),
  };
}