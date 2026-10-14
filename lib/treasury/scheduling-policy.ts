/**
 * C19 — qué obligaciones pueden entrar a una corrida de pago y con qué nombre.
 *
 * El módulo es puro: decide con lo que le pasen, sin base de datos. El servicio
 * pregunta y aplica. La razón de separarlos es la misma que en C18: la misma
 * regla tiene que poder leerse desde el servidor y desde la interfaz sin que
 * las dos copias diverjan.
 *
 * **Lo que este módulo evita.** Antes de C19, `assertCounterpartyPayable`
 * comprobaba que la factura existiera, fuera de la empresa, no estuviera en
 * discrepancia y tuviera proveedor con CLABE verificada — y nada más. La misma
 * factura se podía agregar dos veces a la misma corrida (el total la contaba dos
 * veces y el layout SPEI traía dos renglones), a dos corridas distintas (dos
 * archivos de dispersión con la misma transferencia) y aun después de estar
 * pagada. Y no era sólo un hueco de API: una factura agendada sigue
 * `PENDING`, así que el operador la veía otra vez en el listado de la corrida
 * siguiente y la agendaba también.
 */

/** Tipos de partida de `payment_run_items`. */
export type TipoPartida =
  | "INVOICE"
  | "PAYROLL"
  | "TAXES"
  | "PETTY_CASH_REIMBURSEMENT"
  | "OPERATING_EXPENSE"
  | "OTHER";

/**
 * Cómo se llama cada tipo cuando hay que nombrarlo en un rechazo.
 *
 * `label` va sin dato del documento porque el servidor lo compone: el folio de
 * una factura, la descripción de un gasto o el periodo de una nómina.
 */
export const ETIQUETA_TIPO: Record<TipoPartida, string> = {
  INVOICE: "La factura",
  PAYROLL: "La corrida de nómina",
  TAXES: "El pago de impuestos",
  PETTY_CASH_REIMBURSEMENT: "La reposición de caja chica",
  OPERATING_EXPENSE: "El gasto operativo",
  OTHER: "La partida",
};

/**
 * Estados del documento que ya **no** admiten agendarse, por tipo.
 *
 * La regla es «una obligación se agenda una vez y sólo mientras debe pagarse».
 * Una factura pagada o cancelada, o un gasto pagado, no vuelven a la cola: si
 * el pago se revertió, quien lo revierte deja la factura en `PENDING` y entonces
 * sí se puede volver a agendar. No hay un camino hoy que lo haga —y por eso no
 * se inventa uno— pero la regla no depende de que exista.
 */
const ESTADOS_NO_PAGABLES: Partial<Record<TipoPartida, readonly string[]>> = {
  INVOICE: ["PAID", "CANCELLED"],
  OPERATING_EXPENSE: ["PAID"],
};

/** Una corrida que retiene la obligación. Sólo importa si no está cancelada. */
export interface CorridaQueRetiene {
  id: string;
  title: string;
  status: string;
}

export interface ContextoAgendado {
  /** Estado actual del documento, si el tipo lo tiene. */
  estadoDocumento?: string | null;
  /** Corridas no canceladas que ya tienen esta obligación como partida. */
  retenidasPor?: CorridaQueRetiene[];
  /** Corrida en la que se está agregando, si ya la tiene como partida. */
  yaEnEstaCorrida?: boolean;
}

export interface VeredictoAgendado {
  permitido: boolean;
  motivo?: string;
}

/** Una corrida cancelada deja de retener: la obligación vuelve a estar libre. */
export function retieneObligacion(corrida: CorridaQueRetiene, tipo?: TipoPartida): boolean {
  if (corrida.status === "CANCELLED") return false;
  // El fondo se repone varias veces a lo largo de su vida: cerrar una reposición
  // no puede impedir las siguientes. Las facturas, gastos y nóminas son únicos.
  return tipo !== "PETTY_CASH_REIMBURSEMENT" || corrida.status !== "COMPLETED";
}

/**
 * ¿Se puede agendar esta obligación?
 *
 * El orden de las dos preguntas es el que evita el mensaje equivocado: primero
 * si el documento todavía debe dinero (si ya está pagado, ninguna corrida lo
 * retiene y aun así no se agenda), y después quién lo retiene.
 */
export function puedeAgendar(tipo: TipoPartida, ctx: ContextoAgendado): VeredictoAgendado {
  const nombre = ETIQUETA_TIPO[tipo] ?? "La partida";

  const noPagables = ESTADOS_NO_PAGABLES[tipo];
  if (ctx.estadoDocumento && noPagables?.includes(ctx.estadoDocumento)) {
    return {
      permitido: false,
      motivo:
        ctx.estadoDocumento === "PAID"
          ? `${nombre} ya está pagada: no se puede programar otra vez.`
          : `${nombre} está cancelada: no hay nada que pagar.`,
    };
  }

  if (ctx.yaEnEstaCorrida) {
    return {
      permitido: false,
      motivo: `${nombre} ya está en esta corrida. Revisa sus partidas antes de programar otro pago.`,
    };
  }

  const retenida = (ctx.retenidasPor ?? []).filter((corrida) => retieneObligacion(corrida, tipo));
  if (retenida.length > 0) {
    const [primera, ...resto] = retenida;
    const otras = resto.length > 0 ? ` y ${resto.length} más` : "";
    return {
      permitido: false,
      motivo:
        `${nombre} ya está programada en la corrida "${primera.title}" ` +
        `(estado "${primera.status}")${otras}. Revisa esa corrida antes de programar otro pago.`,
    };
  }

  return { permitido: true };
}

/**
 * Referencia de la partida tal como se guarda en `payment_run_items`.
 *
 * La clave de deduplicación es el par, no el id de la partida: dos partidas
 * distintas que apuntan al mismo documento son la misma obligación pagada dos
 * veces.
 */
export function claveObligacion(tipo: TipoPartida, referenceId: string): string {
  return `${tipo}:${referenceId}`;
}
