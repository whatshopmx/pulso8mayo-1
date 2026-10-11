/**
 * Fachada de validación para la interfaz.
 *
 * Las reglas viven en `lib/labor/shift-rules.ts`, que comparten la interfaz,
 * la API y el servicio de persistencia (C09). Aquí no queda ninguna decisión:
 * sólo la traducción al tipo `ValidationResult` que ya consume
 * `useShiftValidation`.
 *
 * Mantener la fachada y reimplementar la lógica era el patrón que produjo tres
 * juegos de reglas discrepantes; este archivo delegaba, duplicaba, y la
 * pantalla acababa marcando en rojo turnos que el servidor aceptaba.
 */

import { Shift, ValidationResult, LFTViolation } from "@/lib/types/shifts";
import {
  SHIFT_RULES,
  aLftViolations,
  evaluarTurno,
  evaluarTurnos,
  type TurnoAValidar,
} from "@/lib/labor/shift-rules";

/**
 * Límites reexportados por compatibilidad: los imports públicos (`lib/services
 * /index.ts`) los siguen consumiendo desde aquí.
 *
 * `MAX_SHIFT_MINUTES` es la duración máxima bloqueante (12 h, la que aplicaba la
 * API); `MAX_DAILY_MINUTES` es la jornada de 8 h, que hoy es advertencia. Ver la
 * tabla de procedencia en `shift-rules.ts`.
 */
export const LFT_LIMITS = {
  MAX_SHIFT_MINUTES: SHIFT_RULES.MAX_SHIFT_MINUTES,
  DAILY_HOURS: SHIFT_RULES.MAX_DAILY_MINUTES,
  WEEKLY_HOURS: SHIFT_RULES.MAX_WEEKLY_MINUTES,
  REST_BETWEEN_SHIFTS: SHIFT_RULES.MIN_REST_MINUTES,
  MAX_CONSECUTIVE_DAYS: SHIFT_RULES.MAX_CONSECUTIVE_DAYS,
} as const;

/** Un `Shift` de la aplicación reducida a lo que la política mira. */
function aTurnoAValidar(turno: Shift): TurnoAValidar {
  return {
    id: turno.id,
    userId: turno.userId,
    shiftDate: turno.shiftDate,
    startTime: turno.startTime,
    endTime: turno.endTime,
    status: turno.status,
  };
}

function combinar(
  resultado: ReturnType<typeof aLftViolations>
): ValidationResult {
  return {
    isValid: resultado.isValid,
    errors: resultado.errors,
    warnings: resultado.warnings,
  };
}

export class ShiftValidationService {
  validateShift(shift: Shift, existingShifts: Shift[] = []): ValidationResult {
    return combinar(
      aLftViolations(
        evaluarTurno(
          aTurnoAValidar(shift),
          existingShifts.map(aTurnoAValidar)
        )
      )
    );
  }

  validateShifts(shifts: Shift[]): ValidationResult {
    const resultado = aLftViolations(evaluarTurnos(shifts.map(aTurnoAValidar)));
    return {
      isValid: resultado.isValid,
      // Los errores de días consecutivos llegan en `errors` y sólo existen
      // sobre el conjunto, así que el conjunto se reordena una vez para que
      // `errors` y `warnings` no pierdan ninguna.
      errors: [...resultado.errors],
      warnings: [...resultado.warnings],
    };
  }
}

export const shiftValidationService = new ShiftValidationService();

// Reexportado para los consumidores que ya importaban el tipo desde aquí.
export type { LFTViolation };
