import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, vacationRequests } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { hasPermission, type Role } from "@/lib/permissions";
import { resolveResourceScope, type ResourceScope } from "@/lib/rbac/resource-scope";

export interface VacationActor {
  id: string;
  role?: string | null;
  companyId?: string | null;
  branchId?: string | null;
}
export type VacationScope = Exclude<ResourceScope, { kind: "NONE" }>;

/** El body nunca concede empresa, sucursal ni autoridad sobre otro empleado. */
export async function resolveVacationScope(user: VacationActor, action: "read" | "write" | "decide", requestedBranchId?: string | null): Promise<VacationScope> {
  const role = user.role as Role;
  if (!user.companyId || !hasPermission(role, "users", "read") ||
    (action === "write" && !hasPermission(role, "profile", "update")) ||
    (action === "decide" && !hasPermission(role, "users", "update"))) {
    throw ApiError.forbidden("No tienes permiso para esta operación de vacaciones");
  }
  const ids = [...new Set([user.branchId, requestedBranchId].filter((id): id is string => Boolean(id)))];
  const branchRows = ids.length ? await db.select({ id: branches.id, companyId: branches.companyId })
    .from(branches).where(and(eq(branches.companyId, user.companyId), inArray(branches.id, ids))) : [];
  const scope = resolveResourceScope({ userId: user.id, role, companyId: user.companyId, branchId: user.branchId }, "users", "read", branchRows, requestedBranchId);
  if (scope.kind === "NONE" || (requestedBranchId && scope.kind !== "COMPANY" && scope.branchId !== requestedBranchId)) {
    throw ApiError.forbidden("Sucursal fuera de tu alcance");
  }
  return scope;
}

export function vacationScopeCondition(scope: VacationScope, runtime = false): SQL {
  return and(eq(vacationRequests.companyId, scope.companyId),
    scope.kind !== "COMPANY" && scope.branchId ? eq(vacationRequests.branchId, scope.branchId) : undefined,
    scope.kind === "OWN" ? eq(vacationRequests.userId, scope.userId) : undefined,
    // Las FKs legacy garantizan existencia, no que empleado/sucursal pertenezcan
    // a la empresa de la solicitud. No exponer ni notificar referencias cruzadas.
    // The dedicated role has no catalog SELECT: its verified RLS predicate
    // enforces these FK checks through a narrow SECURITY DEFINER function.
    runtime ? undefined : sql`EXISTS (SELECT 1 FROM public.users AS vacation_subject
      WHERE vacation_subject.id = ${vacationRequests.userId} AND vacation_subject.company_id = ${scope.companyId})`,
    runtime ? undefined : sql`(${vacationRequests.branchId} IS NULL OR EXISTS (SELECT 1 FROM public.branches AS vacation_branch
      WHERE vacation_branch.id = ${vacationRequests.branchId} AND vacation_branch.company_id = ${scope.companyId}))`)!;
}

export function assertVacationUserPermission(actor: VacationActor, targetUserId: string): void {
  if (actor.id !== targetUserId && !hasPermission(actor.role as Role, "users", "update")) {
    throw ApiError.forbidden("Solo puedes modificar tus propias solicitudes");
  }
}
