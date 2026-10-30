import { hasPermission, type Action, type Resource, type Role } from '@/lib/permissions';

/** Identidad construida por el servidor desde sesión, nunca desde el body. */
export interface ScopeActor {
  userId: string;
  role: Role;
  companyId?: string | null;
  branchId?: string | null;
}

export type ResourceScope =
  | { kind: 'NONE' }
  | { kind: 'OWN'; companyId: string; userId: string; branchId?: string }
  | { kind: 'BRANCH'; companyId: string; branchId: string }
  | { kind: 'COMPANY'; companyId: string };

/** Catálogo cargado en servidor; companyId permite rechazar una FK cruzada. */
export interface ScopeBranch { id: string; companyId: string }

/**
 * Límite máximo del recurso. Clasificación, franquicia, estado y elegibilidad
 * se aplican después y solo reducen este alcance. OWN requiere filtrar dueño
 * antes de agregar/paginar; no se convierte a BRANCH al construir una query.
 */
export function resolveResourceScope(
  actor: ScopeActor,
  resource: Resource,
  action: Action,
  branches: readonly ScopeBranch[],
  requestedBranchId?: string | null,
): ResourceScope {
  const { userId, role, companyId, branchId } = actor;
  if (!userId || !companyId || !hasPermission(role, resource, action)) return { kind: 'NONE' };
  if (resource === 'profile') return { kind: 'OWN', companyId, userId };

  const branchAllowed = (id: string) => branches.some(b => b.id === id && b.companyId === companyId);
  if (role === 'SUPER_ADMIN' || role === 'OWNER' || role === 'ADMIN') {
    if (!requestedBranchId) return { kind: 'COMPANY', companyId };
    return branchAllowed(requestedBranchId)
      ? { kind: 'BRANCH', companyId, branchId: requestedBranchId }
      : { kind: 'NONE' };
  }
  if (!branchId || !branchAllowed(branchId)) return { kind: 'NONE' };
  return role === 'EMPLEADO'
    ? { kind: 'OWN', companyId, branchId, userId }
    : { kind: 'BRANCH', companyId, branchId };
}

/** Validación de un objetivo cargado en servidor; sin metadatos falla cerrado. */
export function targetInScope(
  scope: ResourceScope,
  target: { companyId?: string | null; branchId?: string | null; userId?: string | null },
): boolean {
  if (scope.kind === 'NONE' || scope.companyId !== target.companyId) return false;
  if (scope.kind === 'COMPANY') return true;
  if (scope.kind === 'BRANCH') return scope.branchId === target.branchId;
  return scope.userId === target.userId && (!scope.branchId || scope.branchId === target.branchId);
}
