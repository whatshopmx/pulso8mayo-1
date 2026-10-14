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

  // Excepción ejecutiva: SUPER_ADMIN y OWNER pueden autorizar sus propios gastos.
  const isExecutive = actorRole === "SUPER_ADMIN" || actorRole === "OWNER";

  // Sin `actorId` no se puede descartar la auto-resolución: se niega.
  if (!actorId) return "SELF";
  if (!isExecutive && actorId === requestedBy) return "SELF";

  return null;
}

export function canResolveExpense(check: ExpenseResolutionCheck): boolean {
  return denyExpenseResolution(check) === null;
}


export type ManagerAutonomyLevel = "ALTA" | "MEDIA" | "BAJA";

/**
 * Los umbrales y la política de autonomía que la empresa configura.
 *
 * Viven en `tenant_operating_config` y se editan desde Organización →
 * "Umbrales Financieros y Políticas de Aprobación" y "Modelo Operativo".
 * `null` significa **sin tope**, que es como el schema documenta el campo vacío.
 */
export interface UmbralesAutorizacion {
  /** Hasta este monto, un GERENTE tiene autoridad en autonomía MEDIA. `null` = sin tope. */
  managerAuthLimitCents: number | null;
  /** Desde este monto, la autoridad sube al dueño. `null` = sin tope. */
  doubleApprovalThresholdCents: number | null;
  /**
   * Nivel de autonomía del gerente de sucursal (C20):
   * - `BAJA`: Visto bueno corporativo obligatorio. Todo gasto exige al menos `ADMIN`,
   *   escalando a `OWNER` desde `doubleApprovalThresholdCents`. El gerente no resuelve gastos.
   * - `MEDIA` (default): Sujeto a límite monetario. El gerente resuelve hasta `managerAuthLimitCents`;
   *   desde ese tope escala a `ADMIN`, y al dueño desde `doubleApprovalThresholdCents`.
   * - `ALTA`: Decide el gerente. El gerente de sucursal resuelve gastos ordinarios hasta el
   *   umbral de Dirección General (`doubleApprovalThresholdCents`), sin requerir visto bueno
   *   intermedio de `ADMIN`.
   */
  managerAutonomy?: ManagerAutonomyLevel | string | null;
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
 * La escalera sale de los umbrales y la dimensión de autonomía que la empresa
 * ya configura (`tenant-config-service.ts`, C20).
 *
 * No implementa doble firma: el sistema no tiene dos aprobadores por gasto.
 * `doubleApprovalThresholdCents` se lee como "de aquí para arriba decide el
 * dueño", que es la traducción honesta de la intención con lo que hay hoy.
 */
export function rolExigidoPorMonto(
  amountCents: number,
  umbrales: UmbralesAutorizacion
): string {
  const { managerAuthLimitCents, doubleApprovalThresholdCents, managerAutonomy } = umbrales;

  // El umbral del dueño es prioritario e inclusivo en todos los niveles de autonomía:
  // en el tope ya decide él.
  const alcanzaAlDueno =
    doubleApprovalThresholdCents !== null && amountCents >= doubleApprovalThresholdCents;
  if (alcanzaAlDueno) return "OWNER";

  const nivelAutonomia = managerAutonomy || "MEDIA";

  if (nivelAutonomia === "BAJA") {
    // Visto bueno corporativo: el gerente no autoriza gastos por su cuenta,
    // incluso para montos chicos o sin tope definido.
    return "ADMIN";
  }

  if (nivelAutonomia === "ALTA") {
    // Decide el gerente: facultado para resolver gastos ordinarios de sucursal
    // hasta el umbral del dueño, sin la escalada intermedia a ADMIN.
    return "GERENTE";
  }

  // MEDIA (default): sujeto al límite monetario capturado.
  // Sin tope de gerente, el gerente alcanza para todo lo que no llegue al
  // umbral del dueño.
  const dentroDeAutonomiaGerente =
    managerAuthLimitCents === null || amountCents < managerAuthLimitCents;

  if (dentroDeAutonomiaGerente) return "GERENTE";
  return "ADMIN";
}
