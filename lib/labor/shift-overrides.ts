/**
 * Excepciones de política por turno (C09).
 *
 * Pegamento entre `lib/labor/shift-rules.ts` —pura, sin base— y
 * `lib/security/policy-overrides.ts` —la tabla con su rastro—. La política
 * decide qué reglas se incumplen; aquí se resuelve cuáles están excusadas para
 * ese turno y en ese día.
 *
 * ## Por qué el recurso es "empleado y día" y no el id del turno
 *
 * En la creación el turno todavía no existe: no hay fila a la que colgarle una
 * excepción. La unidad real de la regla es *un empleado, una fecha de negocio*:
 * "este empleado puede trabajar más de 8 horas ese día". Con esa clave el mismo
 * motivo cubre la creación, la edición posterior y la vista previa del editor,
 * y una excepción concedida para el día sigue sirviendo cuando se corrige el
 * horario del mismo turno.
 *
 * El downside es que perdonar un turno de 9 h perdona también el segundo turno
 * de 9 h de ese empleado ese día. Aceptado a cambio de que la operación pueda
 * hacerse sin una migración más; queda anotado por si el negocio lo nota.
 */

import { hayExcepcionVigente } from "@/lib/security/policy-overrides";
import type { ReglaDeTurno, ResultadoValidacion } from "@/lib/labor/shift-rules";
import { aplicarExcepciones } from "@/lib/labor/shift-rules";

/** Recurso lógico de la excepción: empleado + fecha de negocio. */
export type ShiftOverrideResource = string;

/** Tipo de recurso declarado en la tabla, para no repetir el literal. */
export const RECURSO_TURNO = "employee_day";

/** Reglas de turnos que hoy admiten excepción. */
export const REGLAS_EXCEPCIONABLES: ReglaDeTurno[] = ["MAX_DAILY_HOURS"];

/** Clave estable: `userId:AAAA-MM-DD`. */
export function recursoDeTurno(userId: string, shiftDate: string): ShiftOverrideResource {
  return `${userId}:${shiftDate}`;
}

/**
 * Reglas excusadas para ese empleado y ese día, con su motivo.
 *
 * Se devuelve un `Map` y no una lista porque `aplicarExcepciones` decide por
 * regla: la excepción de la jornada perdona la jornada y sólo la jornada.
 *
 * Una excepción vencida o revocada no aparece en el mapa, así que el turno se
 * vuelve a bloquear sin que nadie tenga que limpiar nada.
 */
export async function excepcionesDeTurno(
  companyId: string,
  userId: string,
  shiftDate: string
): Promise<Map<ReglaDeTurno, string>> {
  const resourceId = recursoDeTurno(userId, shiftDate);
  const concedidas = new Map<ReglaDeTurno, string>();

  for (const regla of REGLAS_EXCEPCIONABLES) {
    const vigente = await hayExcepcionVigente(companyId, {
      domain: "SHIFT_VALIDATION",
      rule: "MAX_DAILY_HOURS",
      resourceType: RECURSO_TURNO,
      resourceId,
    });

    if (vigente) {
      concedidas.set(regla, await motivoDeExcepcion(companyId, regla, resourceId));
    }
  }

  return concedidas;
}

/**
 * Motivo de la excepción, para que el turno guardado diga por qué se salvó.
 *
 * La fila ya existe y está vigente —eso lo acaba de resolver
 * `hayExcepcionVigente`—, así que aquí sólo se lee su explicación. Si el motivo
 * no se puede leer se devuelve un texto honesto en vez de uno inventado.
 */
async function motivoDeExcepcion(
  companyId: string,
  regla: ReglaDeTurno,
  resourceId: string
): Promise<string> {
  const { historialDeExcepcion } = await import("@/lib/security/policy-overrides");

  const historial = await historialDeExcepcion(companyId, {
    domain: "SHIFT_VALIDATION",
    rule: "MAX_DAILY_HOURS",
    resourceType: RECURSO_TURNO,
    resourceId,
  });

  const vigente = [...historial]
    .reverse()
    .find((fila) => !fila.revokedAt && (!fila.expiresAt || fila.expiresAt > new Date()));

  return vigente?.reason ?? "excepción autorizada";
}

/**
 * Veredicto final del turno: política primero, excepciones después.
 *
 * Es la única forma de resolver un turno en los caminos de escritura, para que
 * la acción, la API y el servicio no consulten la tabla cada uno por su cuenta.
 */
export async function veredictoDeTurno(
  companyId: string,
  resultado: ResultadoValidacion,
  userId: string,
  shiftDate: string
): Promise<ResultadoValidacion> {
  if (resultado.valido) return resultado;

  const concedidas = await excepcionesDeTurno(companyId, userId, shiftDate);
  return aplicarExcepciones(resultado, concedidas);
}