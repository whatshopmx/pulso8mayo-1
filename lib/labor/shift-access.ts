/**
 * Alcance autorizado para turnos planificados.
 *
 * `lib/branch-scope.ts` resuelve el alcance de sucursal de toda la aplicación y
 * `lib/rbac/permissions.ts` declara qué roles entran a `/dashboard/labor/shifts`.
 * Este módulo es el adaptador de ambos para el módulo de Turnos: traduce "quién
 * es" y "qué sucursal pide" en las dos decisiones que el servicio necesita —
 * qué filas puede listar y a qué recurso puede escribir— sin volver a decidir la
 * regla.
 *
 * Existe por un agujero concreto (H01): las acciones de servidor de
 * `app/actions/shifts.ts` llamaban al servicio sin sesión, sin rol y sin
 * empresa, y `getPlannedShifts` aceptaba filtros vacíos. Bastaba con pedir la
 * lista sin filtros para recibir los turnos de todas las empresas, y con mandar
 * un `companyId` propio en el cuerpo para escribir filas cruzadas. La llave
 * foránea no lo impide: el turno existe, sólo que no es tuyo.
 *
 * Vive aquí, y no dentro de `shift-service-extended.ts`, porque es lógica pura:
 * se prueba sin base de datos y el servicio sólo la consume. Es la misma razón
 * por la que existe `lib/equipment/scope.ts`.
 */

import { ApiError } from "@/lib/api/error";
import { resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import type { UserRole } from "@/lib/rbac/permissions";

/**
 * Quién puede ver y escribir el planificador de turnos.
 *
 * Misma lista que la entrada `/dashboard/labor/shifts` de `ROUTE_PERMISSIONS`
 * (`lib/rbac/permissions.ts:152`): la gerencia de la operación y sus
 * supervisores. `EMPLEADO` y `READONLY` quedan fuera — el primero recibe su
 * turno ya asignado, el segundo existe para consultar, no para planificar.
 *
 * Cerrar sólo la pantalla del dashboard no basta: un `fetch` a la acción de
 * servidor no pasa por el mismo camino que el navegador.
 */
export const ROLES_TURNOS: readonly UserRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
] as const;

/**
 * Identidad derivada de la sesión. El constructor de estos valores es
 * `requireAuth()` de `lib/tenant-context.ts`; **nadie** los construye a partir
 * del cuerpo de una petición. `companyId` no es un filtro que el cliente pueda
 * ampliar: es la empresa de la sesión.
 */
export interface ShiftActor {
  userId: string;
  role: Role;
  companyId: string;
  branchId: string | null;
}

/**
 * Puerta de entrada al módulo de turnos: sesión con empresa y rol con permiso.
 *
 * Falla cerrado en los dos sentidos. Sin `companyId` no hay contra qué acotar una
 * consulta, así que la respuesta es 403 y no un `[]` ambiguo. Un rol sin permiso
 * es 403 aunque su `branchId` apunte a una sucursal real: tener sucursal no
 * concede acceso al planificador.
 */
export function assertCanAccessShifts(actor: ShiftActor): void {
  if (!actor.companyId) {
    throw ApiError.forbidden(
      "Tu usuario no tiene una empresa asignada. Completa el onboarding antes de operar turnos."
    );
  }

  if (!ROLES_TURNOS.includes(actor.role as UserRole)) {
    throw ApiError.forbidden(
      "Tu rol no tiene acceso al planificador de turnos."
    );
  }
}

/**
 * Alcance de sucursal del actor sobre el planificador.
 *
 * `requestedBranchId` es una **intención**, nunca una autorización: a GERENTE y
 * SUPERVISOR los fija su sesión y se ignora lo que pidan; a los demás roles les
 * vale la sucursal pedida o "Todas". Un rol acotado sin sucursal asignada
 * devuelve `NONE`, que el consumidor traduce a cero filas — nunca a "sin filtro".
 *
 * El `trim` no es cosmético: un `branchId=" "` llegaba como cadena no vacía y se
 * colaba por la rama "sin filtro" del consumidor.
 */
export function resolveShiftScope(
  actor: ShiftActor,
  requestedBranchId?: string | null
): BranchScope {
  assertCanAccessShifts(actor);
  const pedida = requestedBranchId?.trim() || null;
  return resolveBranchScope(actor.role, actor.branchId, pedida);
}

/** ¿Este alcance incluye esa sucursal? Predicado puro, sin lanzar. */
export function shiftScopeCoversBranch(
  scope: BranchScope,
  branchId: string | null | undefined
): boolean {
  if (scope.kind === "ALL") return true;
  if (scope.kind === "NONE") return false;
  return branchId === scope.branchId;
}

/**
 * Puerta de un turno concreto para un alcance resuelto.
 *
 * El filtro de sucursal en el listado no protege las rutas por ID: quien tenga el
 * `shiftId` en la mano entraba igual a un turno de otra sucursal, y incluso de
 * otra empresa, porque el servicio consultaba sólo por `id`. Listar es distinto
 * de alcanzar, y esta guarda cubre lo segundo.
 *
 * `NONE` niega en vez de dejar pasar: es el caso para el que existe
 * `resolveBranchScope`. El mensaje de ese caso explica la causa; el de sucursal
 * ajena no distingue "no es tuya" de "no existe", para no confirmarle a quien
 * prueba ids qué turnos tienen las demás sucursales.
 */
export function assertShiftScopeCoversBranch(
  scope: BranchScope,
  branchId: string | null | undefined
): void {
  if (scope.kind === "ALL") return;

  if (scope.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede ver ni modificar turnos. Pide que te asignen una."
    );
  }

  if (branchId !== scope.branchId) {
    throw ApiError.forbidden("No puedes ver ni modificar un turno de otra sucursal.");
  }
}