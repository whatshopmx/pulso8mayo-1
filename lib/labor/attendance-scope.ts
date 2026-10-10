/**
 * Alcance autorizado sobre sesiones de turno y descansos (H02).
 *
 * `GET /api/shift-sessions` llamaba a `requireTenant()` —que sí obtiene la
 * empresa de la sesión— y después **no la usaba en la consulta**: los filtros
 * opcionales (`branchId`, `userId`, fechas) se aplicaban tal cual y, sin
 * filtros, la respuesta eran las sesiones de todas las empresas. Lo mismo
 * hacía `GET /api/labor/breaks/status`, que ni siquiera pedía empresa.
 *
 * `shift_sessions` no tiene columna de empresa, igual que `workflow_instances`:
 * cuelga de `branch_id`. Por eso el filtro de empresa se traduce a "las
 * sucursales de esta empresa" en vez de inventarse una columna.
 *
 * Este módulo reutiliza la política de `lib/labor/shift-access.ts` en vez de
 * repetirla: es el mismo módulo de negocio —turnos y su asistencia— y una
 * segunda lista de roles sería una tercera copia que deriva sin avisar.
 */

import { db } from "@/lib/db";
import { branches, breakLogs, shiftSessions } from "@/lib/db/schema";
import { eq, inArray, type SQL } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { requireAuth } from "@/lib/tenant-context";
import {
  assertCanAccessShifts,
  resolveShiftScope,
  type ShiftActor,
} from "@/lib/labor/shift-access";

export type { ShiftActor };

/**
 * Identidad del actor de asistencia, tomada de la sesión.
 *
 * Sale de `requireAuth()` y no de `requireTenant()`: esta ruta no acepta
 * encabezado de tenant, y `companyId` es `session.user.companyId` en ambos
 * casos. Se conserva `branchId` de la sesión, no el del query.
 */
export async function requireAttendanceAccess(): Promise<ShiftActor> {
  const { user } = await requireAuth();

  const actor: ShiftActor = {
    userId: user.id,
    role: user.role,
    companyId: user.companyId ?? "",
    branchId: user.branchId ?? null,
  };

  assertCanAccessShifts(actor);
  return actor;
}

/**
 * Condición de alcance para listar sesiones.
 *
 * `ALL` no significa "sin filtro": significa "las sucursales de **esta**
 * empresa". Por eso devuelve siempre una condición — una lista sin `company_id`
 * en ninguna parte es exactamente el agujero que se está cerrando.
 *
 * `NONE` lanza en vez de devolver una condición vacía: un rol acotado sin
 * sucursal no ve "cero sesiones", ve un rechazo que explica por qué.
 */
export async function alcanceDeListado(
  actor: ShiftActor,
  requestedBranchId?: string | null
): Promise<SQL> {
  assertCanAccessShifts(actor);
  const alcance = resolveShiftScope(actor, requestedBranchId);

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede ver la asistencia. Pide que te asignen una."
    );
  }

  if (alcance.kind === "BRANCH") {
    // La sucursal pedida o la de la sesión tienen que existir en esta empresa:
    // `branch_id` no dice de quién es la fila.
    await assertBranchOfCompany(actor.companyId, alcance.branchId);
    return eq(shiftSessions.branchId, alcance.branchId);
  }

  return inArray(
    shiftSessions.branchId,
    db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, actor.companyId))
  );
}

/**
 * Puerta de escritura sobre una sesión concreta.
 *
 * Cargar por id no acota nada: quien tenga el id entraba igual a una sesión de
 * otra sucursal o de otra empresa, porque `PUT /api/shift-sessions` consultaba
 * `shiftSessions.id` y ya.
 */
export async function assertSesionOperable(
  actor: ShiftActor,
  sesion: { id: string; branchId: string }
): Promise<void> {
  assertCanAccessShifts(actor);
  const alcance = resolveShiftScope(actor, null);

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede modificar la asistencia. Pide que te asignen una."
    );
  }

  if (alcance.kind === "BRANCH" && sesion.branchId !== alcance.branchId) {
    throw ApiError.forbidden("No puedes modificar la asistencia de otra sucursal.");
  }

  await assertBranchOfCompany(actor.companyId, sesion.branchId);
}

/**
 * Puerta de la sucursal destino al abrir una sesión.
 *
 * El alcance responde "puedo operar aquí"; `assertBranchOfCompany` responde
 * "esa sucursal existe y es mía". Ninguna de las dos basta sola: un `ADMIN`
 * tiene alcance `ALL` y aun así no puede abrir sesión en la sucursal de otra
 * empresa.
 */
export async function assertSucursalDestino(
  actor: ShiftActor,
  branchId: string
): Promise<void> {
  assertCanAccessShifts(actor);
  const alcance = resolveShiftScope(actor, null);

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede registrar asistencia. Pide que te asignen una."
    );
  }

  if (alcance.kind === "BRANCH" && branchId !== alcance.branchId) {
    throw ApiError.forbidden("No puedes registrar asistencia en otra sucursal.");
  }

  await assertBranchOfCompany(actor.companyId, branchId);
}

/**
 * Condición para las consultas que cuelgan de una sesión (descansos).
 *
 * El estado de descansos pedía los breaks del día **enteros** y luego filtraba
 * en memoria por los ids de sesión ya acotados. No filtraba nada hacia el
 * cliente, pero leía los descansos de todas las empresas para descartar casi
 * todos. Acotar la consulta devuelve lo mismo con menos datos ajenos en memoria.
 *
 * La lista de ids ya viene acotada por `alcanceDeListado`: lo que no debe
 * cambiar es quién la decide, no el predicado que la consume.
 */
export function descansosDeSesiones(sessionIds: string[]): SQL {
  return inArray(breakLogs.sessionId, sessionIds);
}
