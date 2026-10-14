import type { Role } from "@/lib/permissions";

/**
 * C18 — quién puede ejecutar qué sobre una corrida de pago.
 *
 * La operación de tesorería del producto es la corrida: preparar, solicitar
 * autorización, firmarla, dispersarla, liquidar sus partidas, cerrarla y bajar
 * el archivo de dispersión. Todas esas acciones mueven o confirman dinero, y
 * hasta C18 el filtro de rol vivía **en la ruta** de los estados: el servicio
 * recibía `userId` y nada más, así que cualquier otra entrada al servicio —una
 * acción de servidor, un script, un workflow— saltaba el filtro.
 *
 * Aquí vive el filtro, y es un módulo puro a propósito: lo aplica el servicio
 * (que es donde se escribe) y lo calcula la pantalla (que es donde se ofrece).
 * Un botón que el servidor va a rechazar no debe existir.
 *
 * **La dimensión de modelo de tesorería no participa.** Es `descriptiva` desde
 * C15 y deducir de sus valores (`CUENTA_UNICA`/`CUENTA_POR_SUCURSAL`/`MIXTO`)
 * qué cuenta puede disbursar cada sucursal sería repetir H04 con otro nombre —
 * además, la prueba del catálogo falla si su nombre aparece aquí. Lo que falta
 * por decidir está escrito en el catálogo de políticas operativas; lo que se
 * decide aquí es qué roles mueven dinero del grupo, que no dependía de ella.
 */

/** Estados de `payment_run_status`. Se tipa local para no arrastrar el esquema. */
export type EstadoCorrida =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED";

/** Los siete pasos de la corrida. Cada uno tiene un estado y un rol. */
export const PASOS_CORRIDA = [
  "SOLICITAR",
  "APROBAR",
  "DISPERSAR",
  "LIQUIDAR",
  "CERRAR",
  "CANCELAR",
  "DESCARGAR",
] as const;

export type PasoCorrida = (typeof PASOS_CORRIDA)[number];

/**
 * Los roles que mueven dinero de la empresa.
 *
 * Es la misma lista que aplicaba `layout/route.ts` con `requireRoleApi`, escrita
 * una vez y con el motivo a la vista. `reports:update` ya la restringe en la
 * matriz de permisos (`manage` sólo lo tienen estos tres), así que esta lista
 * es la segunda red: si mañana alguien abre `reports` a un rol nuevo, el filtro
 * de tesorería sigue diciendo lo mismo.
 */
export const ROLES_TESORERIA: Role[] = ["SUPER_ADMIN", "OWNER", "ADMIN"];

export interface ContextoPaso {
  role: Role | null | undefined;
  status: EstadoCorrida;
  /** El actor es quien preparó la corrida: no puede firmarla. */
  esPreparador?: boolean;
  /** Partidas sin liquidar. Bloquea el cierre, no el resto. */
  pendientes?: number;
}

export interface Veredicto {
  permitido: boolean;
  /** Por qué no, en palabras que la pantalla pueda mostrar sin traducir nada. */
  motivo?: string;
}

/** Etiquetas de cada paso, tal como aparecen en la pantalla. */
export const ETIQUETA_PASO: Record<PasoCorrida, string> = {
  SOLICITAR: "Solicitar Aprobación",
  APROBAR: "Aprobar Corrida (Firma)",
  DISPERSAR: "Iniciar Dispersión",
  LIQUIDAR: "Liquidar partida",
  CERRAR: "Cerrar y Liquidar Corrida",
  CANCELAR: "Cancelar Corrida",
  DESCARGAR: "Descargar Layout SPEI",
};

const SIN_ROL = "Sólo un administrador de la empresa puede ejecutar esta operación de tesorería.";
const PREPARADOR = "Quien preparó la corrida no puede firmarla: la doble firma exige un segundo usuario.";

/**
 * Estado en el que cada paso tiene sentido. Es la misma máquina que valida
 * `assertPaymentRunTransition`, escrita por pasos para que la pantalla sepa
 * **qué** ofrecer y no sólo si puede ofrecerlo.
 */
const ESTADO_QUE_EXIGE: Record<PasoCorrida, EstadoCorrida[]> = {
  SOLICITAR: ["DRAFT"],
  APROBAR: ["PENDING_APPROVAL"],
  DISPERSAR: ["APPROVED"],
  LIQUIDAR: ["APPROVED", "PROCESSING"],
  CERRAR: ["PROCESSING"],
  CANCELAR: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],
  DESCARGAR: ["APPROVED", "PROCESSING", "COMPLETED"],
};

/** Estado al que lleva cada paso de la máquina. `LIQUIDAR` no cambia el estado. */
export const DESTINO_PASO: Partial<Record<PasoCorrida, EstadoCorrida>> = {
  SOLICITAR: "PENDING_APPROVAL",
  APROBAR: "APPROVED",
  DISPERSAR: "PROCESSING",
  CERRAR: "COMPLETED",
  CANCELAR: "CANCELLED",
};

/**
 * El filtro de rol de un paso, sin mirar el estado.
 *
 * Va separado a propósito. El servidor necesita responder en este orden —
 * primero quién eres, después si el estado lo permite— porque cada respuesta
 * tiene su mensaje: un 403 explica una falta de permisos y un 400 explica una
 * corrida que todavía no llegó. La pantalla, en cambio, quiere el veredicto
 * completo de golpe, y ese es `puedeEjecutarPaso`.
 */
export function filtroDeRol(
  paso: PasoCorrida,
  ctx: { role: Role | null | undefined; esPreparador?: boolean },
): Veredicto {
  if (!ctx.role || !ROLES_TESORERIA.includes(ctx.role)) {
    return { permitido: false, motivo: SIN_ROL };
  }

  if (paso === "APROBAR" && ctx.esPreparador) {
    return { permitido: false, motivo: PREPARADOR };
  }

  return { permitido: true };
}

/**
 * Veredicto de un paso sobre una corrida.
 *
 * El orden importa y es el que la pantalla cuenta igual que el servidor: estado,
 * después rol, y por último la regla propia del paso (las partidas pendientes
 * bloquean el cierre).
 */
export function puedeEjecutarPaso(paso: PasoCorrida, ctx: ContextoPaso): Veredicto {
  if (!ESTADO_QUE_EXIGE[paso].includes(ctx.status)) {
    return {
      permitido: false,
      motivo: `Una corrida en "${ctx.status}" no admite este paso.`,
    };
  }

  const porRol = filtroDeRol(paso, { role: ctx.role, esPreparador: ctx.esPreparador });
  if (!porRol.permitido) return porRol;

  if (paso === "CERRAR" && (ctx.pendientes ?? 0) > 0) {
    return {
      permitido: false,
      motivo: `Faltan ${ctx.pendientes} partidas por liquidar.`,
    };
  }

  return { permitido: true };
}

/**
 * Los pasos que la máquina admite sobre una corrida, con su veredicto.
 *
 * La pantalla usa esto para pintar botones: los que el servidor va a rechazar
 * aparecen **desactivados con el motivo**, no desaparecidos. Un operador que no
 * puede firmar tiene que poder leer por qué, igual que lo lee en el 403.
 */
export function pasosDeCorrida(
  status: EstadoCorrida,
  role: Role | null | undefined,
  extra: { esPreparador?: boolean; pendientes?: number } = {},
): Array<{ paso: PasoCorrida; etiqueta: string; permitido: boolean; motivo?: string }> {
  return PASOS_CORRIDA.filter((paso) => ESTADO_QUE_EXIGE[paso].includes(status)).map((paso) => {
    const veredicto = puedeEjecutarPaso(paso, { role, status, ...extra });
    return { paso, etiqueta: ETIQUETA_PASO[paso], ...veredicto };
  });
}

/**
 * Paso que corresponde a una transición de estado, o `null` si ese destino no
 * es un paso con nombre (ninguno lo es hoy, pero la lista manda).
 *
 * El servicio usa esto para aplicar el filtro a `updatePaymentRunStatus` sin
 * volver a enumerar la máquina: si el destino no corresponde a ningún paso, el
 * filtro no se pronuncia y manda `assertPaymentRunTransition`, que es quien
 * valida la máquina.
 */
export function pasoDeDestino(destino: EstadoCorrida): PasoCorrida | null {
  for (const [paso, estado] of Object.entries(DESTINO_PASO)) {
    if (estado === destino) return paso as PasoCorrida;
  }
  return null;
}