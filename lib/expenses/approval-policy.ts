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


/**
 * Los dos umbrales de autorización que la empresa ya configura.
 *
 * Viven en `tenant_operating_config` y se editan desde Organización →
 * "Umbrales Financieros y Políticas de Aprobación". `null` significa **sin
 * tope**, que es como el schema documenta el campo vacío.
 */
export interface UmbralesAutorizacion {
  /** Hasta este monto, un GERENTE tiene autoridad. `null` = sin tope. */
  managerAuthLimitCents: number | null;
  /** Desde este monto, la autoridad sube al dueño. `null` = sin tope. */
  doubleApprovalThresholdCents: number | null;
}

/**
 * Qué rol se necesita para resolver un gasto de este monto, **cuando la empresa
 * no tiene una regla explícita** que lo cubra.
 *
 * Antes esto era la constante `"OWNER"`, y ahí estaba el atasco: sin reglas
 * sembradas —que es como nace toda empresa— el rol exigido era `OWNER` para
 * *cualquier monto*. Con la segregación de funciones de A16 encima, el
 * resultado es que en un grupo con un solo dueño **nadie puede aprobar nada**:
 * los gerentes no alcanzan el rol y el dueño no puede firmar lo suyo. Los
 * gastos se quedan en `PENDING_APPROVAL` para siempre y no llegan nunca a
 * Cuentas por Pagar, que sólo lista lo autorizado.
 *
 * La escalera sale de los umbrales que la empresa **ya configura y que nadie
 * leía**: `tenant-config-service.ts` los anota como "M16 expense authorization
 * (future)". Esto es conectar lo que el producto ya prometía en su pantalla de
 * Organización, no una política nueva.
 *
 * No implementa doble firma: el sistema no tiene dos aprobadores por gasto.
 * `doubleApprovalThresholdCents` se lee como "de aquí para arriba decide el
 * dueño", que es la traducción honesta de la intención con lo que hay hoy.
 */
export function rolExigidoPorMonto(
  amountCents: number,
  umbrales: UmbralesAutorizacion
): string {
  const { managerAuthLimitCents, doubleApprovalThresholdCents } = umbrales;

  // Sin tope de gerente, el gerente alcanza para todo lo que no llegue al
  // umbral del dueño. Es la lectura literal de "sin tope", y es una decisión
  // que un administrador tomó a propósito al vaciar el campo.
  const dentroDeAutonomiaGerente =
    managerAuthLimitCents === null || amountCents < managerAuthLimitCents;

  const alcanzaAlDueno =
    doubleApprovalThresholdCents !== null && amountCents >= doubleApprovalThresholdCents;

  if (alcanzaAlDueno) return "OWNER";
  if (dentroDeAutonomiaGerente) return "GERENTE";
  return "ADMIN";
}
