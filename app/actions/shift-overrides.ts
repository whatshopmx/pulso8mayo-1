"use server";

/**
 * Excepciones a la jornada de 8 horas.
 *
 * La jornada bloquea (`lib/labor/shift-rules.ts`, decisión del negocio del 10 de
 * octubre de 2026) y esta es la puerta para levantarla. Como la de auto-revisión,
 * deja rastro: motivo obligatorio,"Who puede" es `OWNER` o `SUPER_ADMIN`, y se
 * revoca sin borrar la fila.
 *
 * El recurso es el **empleado y el día de negocio** (`usuario:AAAA-MM-DD`), no
 * el turno: en el momento en que hace falta la excepción el turno todavía no
 * existe, y la regla habla de una persona trabajando un día, no de un registro.
 *
 * Se comprueba que el empleado sea de esta empresa antes de conceder nada: sin
 * ese chequeo, un dueño podría abrir una excepción sobre un empleado ajeno
 * —inofensiva hoy porque ningún turno local coincidiría, pero un error de
 * autorización esperando a que exista la fila que sí coincida.
 */

import { requireTenantAuth } from "@/lib/api/with-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  assertPuedeConcederExcepcion,
  concederExcepcion,
  historialDeExcepcion,
  puedeConcederExcepcion,
  revocarExcepcion,
} from "@/lib/security/policy-overrides";
import { RECURSO_TURNO, recursoDeTurno } from "@/lib/labor/shift-overrides";
import { ApiError } from "@/lib/api/error";

const objetivoSchema = z.object({
  /** `users.id` — texto, no uuid: es el mismo id con el que se guarda el turno. */
  userId: z.string().min(1, "Elige a qué empleado aplica la excepción."),
  /** Fecha de negocio `YYYY-MM-DD`. */
  shiftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no tiene el formato AAAA-MM-DD."),
});

const concederSchema = objetivoSchema.extend({
  reason: z.string().trim().min(10, "Escribe el motivo: queda como evidencia."),
  /** Sin caducidad por defecto: una excepción permanente es política disfrazada. */
  expiresInDays: z.number().int().positive().max(365).optional(),
});

const revocarSchema = objetivoSchema.extend({
  reason: z.string().trim().min(10, "Escribe el motivo de la revocación."),
});

/** El empleado tiene que ser de esta empresa. */
async function assertEmpleadoDeEmpresa(companyId: string, userId: string) {
  const [empleado] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)))
    .limit(1);

  if (!empleado) {
    // Mismo mensaje que "no existe": distinguirlos confirmaría qué empleados hay
    // en las demás empresas.
    throw ApiError.notFound("Ese empleado no pertenece a esta empresa.");
  }
}

/**
 * ¿Este usuario puede autorizar excepciones?
 *
 * Se consulta para que la pantalla no ofrezca un botón que va a recibir un 403.
 * Un botón que promete una acción y devuelve un rechazo no es un control de
 * acceso: es una trampa con texto.
 */
export async function puedeAutorizarExcepciones(): Promise<boolean> {
  const { user } = await requireTenantAuth();
  return puedeConcederExcepcion(user.role);
}

/** Autoriza a un empleado a trabajar más de 8 horas en una fecha concreta. */
export async function concederExcepcionJornada(
  input: z.infer<typeof concederSchema>
) {
  const { user, tenantId } = await requireTenantAuth();
  assertPuedeConcederExcepcion(user.role);

  const datos = concederSchema.parse(input);
  await assertEmpleadoDeEmpresa(tenantId, datos.userId);

  return concederExcepcion({
    companyId: tenantId,
    grantedBy: user.id,
    reason: datos.reason,
    expiresAt: datos.expiresInDays
      ? new Date(Date.now() + datos.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
    domain: "SHIFT_VALIDATION",
    rule: "MAX_DAILY_HOURS",
    resourceType: RECURSO_TURNO,
    resourceId: recursoDeTurno(datos.userId, datos.shiftDate),
  });
}

/** Retira la excepción de ese empleado y ese día, sin borrar el registro. */
export async function revocarExcepcionJornada(input: z.infer<typeof revocarSchema>) {
  const { user, tenantId } = await requireTenantAuth();
  assertPuedeConcederExcepcion(user.role);

  const datos = revocarSchema.parse(input);
  await assertEmpleadoDeEmpresa(tenantId, datos.userId);

  await revocarExcepcion(
    tenantId,
    {
      domain: "SHIFT_VALIDATION",
      rule: "MAX_DAILY_HOURS",
      resourceType: RECURSO_TURNO,
      resourceId: recursoDeTurno(datos.userId, datos.shiftDate),
    },
    user.id,
    datos.reason
  );

  return { success: true };
}

/**
 * Historial de la excepción de ese empleado y ese día.
 *
 * Lo puede leer cualquiera con sesión en el módulo: el motivo no es un secreto,
 * es la explicación que necesita quien ve un turno de 10 horas en el historial.
 */
export async function historialDeExcepcionJornada(input: z.infer<typeof objetivoSchema>) {
  const { tenantId } = await requireTenantAuth();
  const datos = objetivoSchema.parse(input);

  return historialDeExcepcion(tenantId, {
    domain: "SHIFT_VALIDATION",
    rule: "MAX_DAILY_HOURS",
    resourceType: RECURSO_TURNO,
    resourceId: recursoDeTurno(datos.userId, datos.shiftDate),
  });
}