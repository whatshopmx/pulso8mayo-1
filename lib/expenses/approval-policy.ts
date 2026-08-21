/**
 * A16 — La política de resolución de gastos, en un solo lugar.
 *
 * Antes vivía dos veces y las dos versiones no decían lo mismo:
 * `createOperatingExpense` auto-aprobaba en silencio cuando el rol de quien
 * registraba alcanzaba el exigido por la regla, `approveOperatingExpense` sólo
 * bloqueaba la auto-resolución si la regla tenía umbral (`minAmount > 0`), y la
 * pantalla escondía siempre el botón de aprobar lo propio. El sistema *decía*
 * que había segregación de funciones y no la había.
 *
 * Decidido con David (2026-08-21): **gana la segregación de funciones**. Un
 * gasto nace siempre PENDING_APPROVAL y lo resuelve alguien distinto de quien
 * lo registró, sin importar el monto ni el rol. Es lo que la UI ya afirmaba.
 *
 * Este módulo es puro a propósito —sin `db`, sin schema— para que el servicio y
 * el componente cliente deriven la condición de la misma función en vez de
 * mantener dos copias que se separan con el tiempo.
 */

import { roleIsAtLeast } from "@/lib/permissions";

export interface ExpenseResolutionCheck {
  /** Rol de quien intenta aprobar o rechazar. */
  actorRole: string | null | undefined;
  /** Id de quien intenta aprobar o rechazar. */
  actorId: string | null | undefined;
  /** Rol exigido por la regla de autorización aplicable (default: OWNER). */
  requiredApproverRole: string | null | undefined;
  /** Id de quien registró el gasto. */
  requestedBy: string | null | undefined;
}

/**
 * `ROLE` — la autoridad no alcanza para la regla.
 * `SELF` — alcanza, pero es su propio gasto.
 *
 * Se distinguen porque la pantalla dice cosas distintas: "requiere GERENTE" a
 * quien no puede, y "lo registraste tú" a quien sí podría pero no debe. Con un
 * solo booleano, el segundo caso se leía como falta de permisos.
 */
export type ExpenseResolutionDenial = "ROLE" | "SELF";

export function denyExpenseResolution({
  actorRole,
  actorId,
  requiredApproverRole,
  requestedBy,
}: ExpenseResolutionCheck): ExpenseResolutionDenial | null {
  const required = requiredApproverRole || "OWNER";

  if (!actorRole || !roleIsAtLeast(actorRole, required)) return "ROLE";

  // Sin `actorId` no se puede descartar la auto-resolución: se niega.
  if (!actorId || actorId === requestedBy) return "SELF";

  return null;
}

export function canResolveExpense(check: ExpenseResolutionCheck): boolean {
  return denyExpenseResolution(check) === null;
}
