import type { Role } from "./permissions";

const BRANCH_SCOPED_ROLES: Role[] = ["GERENTE", "SUPERVISOR"];

export function isBranchScopedRole(role: Role): boolean {
  return BRANCH_SCOPED_ROLES.includes(role);
}

export function canAccessAllBranches(role: Role): boolean {
  return !BRANCH_SCOPED_ROLES.includes(role);
}

export function enforceBranchScope(
  userRole: Role,
  userBranchId: string | null | undefined,
  requestedBranchId?: string | null
): string | null {
  if (!isBranchScopedRole(userRole)) {
    return requestedBranchId || null;
  }

  return userBranchId || null;
}

export function getAccessibleBranchIds(
  userRole: Role,
  userBranchId: string | null | undefined,
  allBranchIds: string[]
): string[] {
  if (!isBranchScopedRole(userRole)) {
    return allBranchIds;
  }

  if (userBranchId && allBranchIds.includes(userBranchId)) {
    return [userBranchId];
  }

  return userBranchId ? [userBranchId] : [];
}

/**
 * Alcance de sucursal resuelto de forma explícita.
 *
 * `enforceBranchScope` colapsa dos situaciones distintas en el mismo `null`:
 * "este rol ve toda la empresa" y "este rol está acotado a una sucursal, pero
 * no tiene ninguna asignada". Quien lo llama interpreta ese `null` como "no
 * filtres por sucursal", así que un GERENTE sin `branchId` termina viendo el
 * grupo entero: falla abierto justo en el caso que el helper existe para cerrar.
 *
 * Este tipo separa los tres casos para que el que consulta no pueda confundirlos.
 */
export type BranchScope =
  | { kind: "ALL" }
  | { kind: "BRANCH"; branchId: string }
  | { kind: "NONE" };

/**
 * Versión fail-closed de `enforceBranchScope`.
 *
 * Un rol acotado a sucursal sin `branchId` asignado devuelve `NONE`, y quien
 * consulta debe traducirlo a "cero resultados" / 404, nunca a "sin filtro".
 * `users.branch_id` es nullable en el esquema, así que ese usuario es
 * representable aunque hoy no exista ninguno.
 *
 * `enforceBranchScope` se mantiene como está: tiene ~15 call sites y cambiarle
 * la semántica en silencio es peor que migrarlos uno a uno.
 */
export function resolveBranchScope(
  userRole: Role,
  userBranchId: string | null | undefined,
  requestedBranchId?: string | null
): BranchScope {
  if (!isBranchScopedRole(userRole)) {
    return requestedBranchId ? { kind: "BRANCH", branchId: requestedBranchId } : { kind: "ALL" };
  }

  return userBranchId ? { kind: "BRANCH", branchId: userBranchId } : { kind: "NONE" };
}

/**
 * Comprueba que un usuario quede en un estado de alcance coherente.
 *
 * Cerrar los consumidores evita el daño; impedir el estado evita el bug. Un
 * `GERENTE`/`SUPERVISOR` sin sucursal no debería existir: no puede ver nada
 * (todos los consumidores fail-closed le devuelven vacío) y antes de este
 * trabajo veía de más. `users.branch_id` seguirá siendo nullable porque ADMIN y
 * SUPER_ADMIN legítimamente no tienen sucursal, así que la garantía va aquí.
 *
 * Lanza con un mensaje en español apto para mostrar en la UI de usuarios.
 */
export function assertBranchAssignment(
  role: Role,
  branchId: string | null | undefined
): void {
  if (isBranchScopedRole(role) && !branchId) {
    throw new Error(
      `El rol ${role} requiere una sucursal asignada. Selecciona una sucursal antes de guardar.`
    );
  }
}
