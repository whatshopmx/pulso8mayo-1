/**
 * Matemática pura del reparto de propinas — extraída de
 * `lib/services/propinas-service.ts` para poder property-testearla sin DB.
 *
 * ⚠️ COMPORTAMIENTO CONGELADO (hallazgo Task 9, 2026-08-24):
 * el reparto usa `Math.floor(pool / n)` y reporta
 * `distributed = perStaff × n`, así que el residuo `pool % n` se EVAPORA:
 * con pool=100 y n=3 reparte 99 y el header guarda distributedCents(99) ≠
 * totalPoolCents(100). Al ser dinero, la corrección (repartir el residuo
 * entre los primeros `pool % n` empleados) requiere aprobación humana — ver
 * tasks/todo.md y propinas-distribution.test.ts.
 */

/** Asignación individual resultado del reparto. */
export interface PropinaAsignacionCalculada {
  userId: string;
  assignedAmountCents: number;
}

/** Resultado completo del reparto equitativo en centavos. */
export interface PropinasReparto {
  /** Monto que recibe cada integrante (floor del cociente). */
  perStaffAmountCents: number;
  /** Suma realmente asignada (= perStaff × n). */
  totalDistributedCents: number;
  /** Una asignación por integrante, todas por el mismo monto. */
  asignaciones: PropinaAsignacionCalculada[];
}

/**
 * Reparte `totalPoolCents` en partes IGUALES entre `staffIds`.
 *
 * Espejo exacto de la aritmética histórica del servicio (Math.floor), con
 * una salvaguarda nueva: lista vacía lanza RangeError (el servicio ya lo
 * validaba antes de llegar aquí).
 */
export function distributeEqualCents(
  totalPoolCents: number,
  staffIds: readonly string[]
): PropinasReparto {
  if (staffIds.length === 0) {
    throw new RangeError(
      "No hay empleados registrados en esta sucursal para distribuir propinas."
    );
  }

  const perStaffAmountCents = Math.floor(totalPoolCents / staffIds.length);
  const totalDistributedCents = perStaffAmountCents * staffIds.length;

  return {
    perStaffAmountCents,
    totalDistributedCents,
    asignaciones: staffIds.map((userId) => ({
      userId,
      assignedAmountCents: perStaffAmountCents,
    })),
  };
}
