import { hasPermission, ROLES_HIERARCHY, type Role } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";

export const ALL_ROLES: readonly Role[] = [
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
  "EMPLEADO",
  "READONLY",
] as const;

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  OWNER: "Propietario",
  ADMIN: "Admin",
  GERENTE: "Gerente",
  SUPERVISOR: "Supervisor",
  EMPLEADO: "Empleado",
  READONLY: "Solo Lectura",
};

export interface TeamActor {
  id?: string | null;
  role: Role;
  branchId?: string | null;
}

export interface TeamTarget {
  id: string;
  role: Role;
  branchId?: string | null;
}

export function canActOnRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  return ROLES_HIERARCHY[actorRole] > ROLES_HIERARCHY[targetRole];
}

export function getAssignableRoles(actorRole: Role): Role[] {
  return ALL_ROLES.filter((r) => canActOnRole(actorRole, r));
}

export function canActorManageTarget(actor: TeamActor, target: TeamTarget): boolean {
  if (!hasPermission(actor.role, "users", "update")) return false;
  if (!canActOnRole(actor.role, target.role)) return false;

  const scope = resolveBranchScope(actor.role, actor.branchId, null);
  if (scope.kind === "NONE") return false;
  if (scope.kind === "BRANCH" && target.branchId !== scope.branchId) return false;
  return true;
}

export function canActorDeleteTarget(actor: TeamActor, target: TeamTarget): boolean {
  if (actor.id && actor.id === target.id) return false;
  if (!hasPermission(actor.role, "users", "delete")) return false;
  return canActorManageTarget(actor, target);
}
