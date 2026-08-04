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
import {
  SENSITIVE_GATE_ROLES,
  FINANCIAL_FIELDS,
} from "@/lib/db/schema/classification";
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
 * Roles that read FINANCIAL data masked (never plaintext) even when allowed.
 * Pilar 2 §6.2 — gate roles (SUPER_ADMIN/OWNER/ADMIN) see plaintext; everyone
 * else sees `redactFields` masked by lib/rbac/masking.ts (Sprint 2 Task 3).
 * SENSITIVE stays deny-by-default for these roles (strict; HR arrives Sprint 3).
 */
const FINANCIAL_MASKED_ROLES: Role[] = [
  "GERENTE",
  "SUPERVISOR",
  "EMPLEADO",
  "READONLY",
];

/**
 * Candidate field names to redact on a FINANCIAL read by a masked role.
 * Flattened from `FINANCIAL_FIELDS` so it stays data-driven (no hand-maintained
 * list to drift). `masking.ts` only redacts keys that actually appear in the
 * serialized response, so listing aggregate-shaped names (e.g.
 * `projected_cash_flow_cents`) is harmless for routes that don't return them.
 */
const FINANCIAL_REDACT_FIELDS: readonly string[] = Array.from(
  new Set(
    Object.values(FINANCIAL_FIELDS).flat(),
  ),
);

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

  // 3. Data classification gate (Pilar 2).
  //    SENSITIVE → deny for non-gate roles (strict; HR arrives Sprint 3).
  //    FINANCIAL → allow for masked roles with `redactFields` populated so
  //    masking.ts (Task 3) can redact PII; gate roles read plaintext. This keeps
  //    route migration (Track B Task 1) regression-free: a GERENTE who today
  //    reads an aggregate (cash-flow/pnl/kpis) keeps reading it (no PII to mask →
  //    plaintext-equivalent), and only PII-bearing routes (payroll/export) get
  //    redaction once Task 3 wires the maskers onto `decision.redactFields`.
  const classification: DataClassification | undefined =
    target?.dataClassification;
  if (classification === "SENSITIVE") {
    if (!SENSITIVE_GATE_ROLES.has(ctx.userRole)) {
      return { allowed: false, reason: "insensitive-data-gate" };
    }
  } else if (classification === "FINANCIAL") {
    if (!SENSITIVE_GATE_ROLES.has(ctx.userRole)) {
      // Non-gate role: allow the read, but flag every candidate FINANCIAL field
      // for redaction. masking.ts is a no-op until Task 3, so the interim is
      // plaintext-equivalent for routes with no PII fields (no regression);
      // PII-bearing routes must be migrated with SENSITIVE (deny) or wait for
      // Task 3 before relying on this allow+redact path.
      if (FINANCIAL_MASKED_ROLES.includes(ctx.userRole)) {
        return {
          allowed: true,
          redactFields: [...FINANCIAL_REDACT_FIELDS],
        };
      }
      // Role outside both gate and masked set (e.g. a future role) → deny.
      return { allowed: false, reason: "insensitive-data-gate" };
    }
    // Gate roles (SUPER_ADMIN/OWNER/ADMIN) read FINANCIAL plaintext.
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