/**
 * Alcance autorizado para equipos.
 *
 * `lib/branch-scope.ts` resuelve el alcance de sucursal de toda la aplicación.
 * Este módulo es su adaptador para Equipos: traduce ese alcance a las dos
 * decisiones que el módulo necesita —qué filas puede listar el usuario y si
 * puede ver o tocar un equipo concreto— sin volver a decidir la regla.
 *
 * Existe por un agujero real: `GET /api/equipment` tomaba el `branchId` del
 * query tal cual y `getEquipmentByBranch` filtraba sólo por sucursal, nunca por
 * empresa. Adivinar el `branchId` de otra empresa bastaba para leer su
 * inventario, porque la llave foránea no lo impide: la sucursal existe, sólo
 * que no es tuya.
 *
 * Vive aquí, y no dentro de `equipment-service.ts`, porque es lógica pura: se
 * prueba sin base de datos y el servicio sólo lo consume.
 */

import { ApiError } from "@/lib/api/error";
import { resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";

/**
 * Alcance de sucursal aplicado a Equipos.
 *
 * `requestedBranchId` es una **intención**, nunca una autorización: a GERENTE y
 * SUPERVISOR los fija su sesión y se ignora lo que pidan; a los demás roles les
 * vale la sucursal pedida o "Todas". Un rol acotado sin sucursal asignada
 * devuelve `NONE`, que este módulo traduce a cero filas — nunca a "sin filtro".
 *
 * El `trim` no es cosmético: `?branchId=%20` llegaba como cadena con espacios,
 * no coincidía con ninguna sucursal y el resultado era un vacío silencioso que
 * parecía "no hay equipos".
 */
export function resolveEquipmentScope(
  userRole: Role,
  userBranchId: string | null | undefined,
  requestedBranchId?: string | null
): BranchScope {
  const pedida = requestedBranchId?.trim() || null;
  return resolveBranchScope(userRole, userBranchId, pedida);
}

/** ¿Este alcance incluye esa sucursal? Predicado puro, sin lanzar. */
export function scopeCoversBranch(
  scope: BranchScope,
  branchId: string | null | undefined
): boolean {
  if (scope.kind === "ALL") return true;
  if (scope.kind === "NONE") return false;
  return branchId === scope.branchId;
}

/**
 * Puerta de un equipo concreto para un alcance resuelto.
 *
 * El filtro de sucursal en el listado no protege las rutas por ID: quien tenga
 * el `equipmentId` en la mano entraba igual a un equipo de otra sucursal, e
 * incluso de otra empresa, porque los servicios por ID consultaban sólo por
 * `id`. Listar es distinto de alcanzar, y esta guarda cubre lo segundo.
 *
 * `NONE` niega en vez de dejar pasar: es el caso para el que existe
 * `resolveBranchScope`. Un rol acotado a sucursal sin ninguna asignada no debe
 * caer en el mismo `null` que significa "ve toda la empresa".
 *
 * El mensaje para el caso `NONE` explica la causa; el de sucursal ajena no
 * distingue "no es tuya" de "no existe", para no confirmarle a quien prueba ids
 * qué equipos tienen las demás sucursales.
 */
export function assertScopeCoversBranch(
  scope: BranchScope,
  branchId: string | null | undefined
): void {
  if (scope.kind === "ALL") return;

  if (scope.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede ver ni modificar equipos. Pide que te asignen una."
    );
  }

  if (branchId !== scope.branchId) {
    throw ApiError.forbidden(
      "No puedes ver ni modificar un equipo de otra sucursal."
    );
  }
}