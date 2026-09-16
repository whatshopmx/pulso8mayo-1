/**
 * Reglas de liquidación de partidas de una corrida de pago — **puras**.
 *
 * Por qué es un módulo aparte y no métodos de `TreasuryService`: las reglas que
 * deciden si un pago se puede confirmar, si un rechazo conserva la deuda y si
 * una corrida se puede cerrar son exactamente las que un test tiene que poder
 * ejercer sin base de datos. Cuando esas reglas vivieron dentro de métodos que
 * empiezan con una consulta, lo que se acabó probando fueron copias locales de
 * las reglas escritas en el propio archivo de test — y una copia no comprueba
 * nada sobre el código que corre en producción.
 *
 * `TreasuryService.settlePaymentRunItem` y `TreasuryService.updatePaymentRunStatus`
 * consumen estas funciones, así que los tests de `payment-run-settlement.test.ts`
 * ejercen las reglas reales.
 *
 * Estado de una partida (`payment_run_item_settlement`):
 *  - `PENDING`   — la corrida salió, nadie sabe si el dinero llegó.
 *  - `CONFIRMED` — hay comprobante/referencia: el dinero llegó.
 *  - `FAILED`    — el banco la rechazó: la deuda sigue viva.
 */

export type PaymentRunItemSettlement = "PENDING" | "CONFIRMED" | "FAILED";

/** Lo mínimo que estas reglas necesitan saber de una partida. */
export interface SettlementItemLike {
  itemType: string;
  amountCents: number;
  settlementStatus?: PaymentRunItemSettlement | string | null;
}

/**
 * Estados de corrida en los que se puede liquidar una partida.
 *
 * `DRAFT`/`PENDING_APPROVAL` quedan fuera porque nadie firmó todavía: liquidar
 * antes de la firma deja que quien arma el lote cierre el ciclo solo.
 * `COMPLETED`/`CANCELLED` son terminales: una corrida cerrada ya no recibe
 * confirmaciones nuevas.
 */
export const ESTADOS_LIQUIDABLES: readonly string[] = ["APPROVED", "PROCESSING"];

export function puedeLiquidarCorrida(status: string): boolean {
  return ESTADOS_LIQUIDABLES.includes(status);
}

/** Mensaje para cuando el estado de la corrida no admite liquidar partidas. */
export function motivoNoLiquidable(status: string): string {
  if (status === "COMPLETED") {
    return "Esta corrida ya está cerrada (pagada). Una liquidación nueva no se aplica a una corrida terminada.";
  }
  if (status === "CANCELLED") {
    return "Esta corrida está cancelada: sus partidas ya no se pagan ni se liquidan.";
  }
  return "La corrida todavía no está autorizada. Una partida no se confirma antes de que alguien firme la corrida.";
}

/**
 * Tipos de partida cuyo documento de origen se marca pagado al confirmar.
 *
 * Sólo facturas y gastos operativos: en los demás (nómina, impuestos, caja
 * chica) el pago no salda el documento de la misma forma —una corrida de nómina
 * tiene su propio ciclo de timbrado/cierre— y el sistema no debe afirmar algo
 * que no verifica. La partida se marca igual; lo que no se toca es el documento.
 */
export function aplicaEspejoDocumento(itemType: string): boolean {
  return itemType === "INVOICE" || itemType === "OPERATING_EXPENSE";
}

export type AccionLiquidacion = "CONFIRMAR" | "RECHAZAR" | "SIN_CAMBIO";

export type DecisionLiquidacion =
  | { ok: true; accion: AccionLiquidacion; motivo: string }
  | { ok: false; motivo: string };

/**
 * Qué hacer cuando alguien pide liquidar una partida que ya tiene estado.
 *
 * Tres reglas que el modelo anterior no podía expresar, porque no existía el
 * estado por partida:
 *
 *  1. **Repetir una confirmación no duplica efectos.** Confirmar lo ya
 *     confirmado es un doble clic, no un segundo pago; se responde `SIN_CAMBIO`
 *     y quien llama no vuelve a escribir nada.
 *  2. **Una confirmación no se deshace.** Pasar de `CONFIRMED` a `FAILED`
 *     exigiría des-pagar el documento —el dinero ya salió según el sistema— y
 *     es la vía para que la misma deuda se pague otra vez. Se rechaza con
 *     instrucción explícita.
 *  3. **Un rechazo sí se puede corregir a confirmación.** El caso real es al
 *     revés del anterior: el banco marcó la transferencia como rechazada y al
 *     día siguiente el depósito aparece (o el rechazo fue de otro renglón del
 *     lote). `FAILED → CONFIRMED` se permite, con el comprobante como
 *     evidencia.
 */
export function decidirLiquidacion(
  actual: PaymentRunItemSettlement | string | null | undefined,
  solicitada: Exclude<PaymentRunItemSettlement, "PENDING">
): DecisionLiquidacion {
  const estado: PaymentRunItemSettlement = (actual ?? "PENDING") as PaymentRunItemSettlement;

  if (estado === solicitada) {
    return {
      ok: true,
      accion: "SIN_CAMBIO",
      motivo:
        solicitada === "CONFIRMED"
          ? "La partida ya estaba confirmada; no se vuelve a aplicar."
          : "La partida ya estaba marcada como rechazada; no se vuelve a aplicar.",
    };
  }

  if (estado === "CONFIRMED" && solicitada === "FAILED") {
    return {
      ok: false,
      motivo:
        "Esta partida ya se confirmó como pagada, así que no se puede marcar como rechazada: el documento ya quedó saldado y revertirlo es la forma de pagar dos veces. Si el dinero no llegó, reabre el pago con el comprobante del banco y cancela la corrida.",
    };
  }

  return {
    ok: true,
    accion: solicitada === "CONFIRMED" ? "CONFIRMAR" : "RECHAZAR",
    motivo:
      estado === "FAILED"
        ? "Se corrige el rechazo anterior a pago confirmado."
        : solicitada === "CONFIRMED"
          ? "Se registra el pago con su comprobante."
          : "Se registra el rechazo del banco y la deuda sigue viva.",
  };
}

export interface ResumenLiquidacion {
  totalPartidas: number;
  totalCents: number;
  confirmadas: number;
  confirmadasCents: number;
  rechazadas: number;
  rechazadasCents: number;
  pendientes: number;
  pendientesCents: number;
  /** Todas las partidas tienen un desenlace. Requisito para cerrar la corrida. */
  liquidada: boolean;
}

/**
 * Totales por desenlace. El total de la corrida y el importe confirmado son
 * números distintos desde que existe el rechazo bancario, y presentarlos como
 * uno solo es lo que hacía que un lote parcialmente liquidado pareciera pagado.
 */
export function resumenLiquidacion(items: SettlementItemLike[]): ResumenLiquidacion {
  const resumen: ResumenLiquidacion = {
    totalPartidas: items.length,
    totalCents: 0,
    confirmadas: 0,
    confirmadasCents: 0,
    rechazadas: 0,
    rechazadasCents: 0,
    pendientes: 0,
    pendientesCents: 0,
    liquidada: true,
  };

  for (const item of items) {
    const monto = item.amountCents ?? 0;
    resumen.totalCents += monto;

    const estado = item.settlementStatus ?? "PENDING";
    if (estado === "CONFIRMED") {
      resumen.confirmadas += 1;
      resumen.confirmadasCents += monto;
    } else if (estado === "FAILED") {
      resumen.rechazadas += 1;
      resumen.rechazadasCents += monto;
    } else {
      resumen.pendientes += 1;
      resumen.pendientesCents += monto;
    }
  }

  resumen.liquidada = resumen.pendientes === 0;
  return resumen;
}

/** Monto en pesos para un mensaje: centavos son ilegibles en un aviso. */
export function formatearPesos(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export type RevisionCierre =
  | { ok: true; pendientes?: undefined; pendientesCents?: undefined; mensaje?: undefined }
  | { ok: false; pendientes: number; pendientesCents: number; mensaje: string };

/**
 * ¿Se puede cerrar la corrida?
 *
 * Antes, cerrar marcaba como pagado **todo** lo que estuviera en el lote, con
 * un solo estado para la corrida entera. Un cierre con partidas sin resolver
 * era entonces indistinguible de uno con todo confirmado: el libro afirmaba
 * que se había pagado lo que nadie verificó. Ahora el cierre requiere que cada
 * partida tenga desenlace, y las rechazadas conservan su deuda.
 */
export function revisarCierreCorrida(items: SettlementItemLike[]): RevisionCierre {
  const { pendientes, pendientesCents } = resumenLiquidacion(items);

  if (pendientes === 0) return { ok: true };

  return {
    ok: false,
    pendientes,
    pendientesCents,
    mensaje: `No se puede cerrar la corrida: ${pendientes} partida${
      pendientes === 1 ? "" : "s"
    } por ${formatearPesos(pendientesCents)} siguen sin liquidar. Confirma cada pago con su comprobante o registra el rechazo del banco antes de cerrarla.`,
  };
}

/**
 * Por qué una partida ya liquidada no debe volver a viajar en un archivo de
 * dispersión. `null` cuando sí debe incluirse (sigue pendiente).
 *
 * Confirmada: volver a mandarla al banco sería pagar dos veces.
 * Rechazada: el archivo ya la incluyó una vez y el banco la devolvió; reintentar
 * el mismo lote tal cual volvería a fallar. Se declara en la respuesta en vez de
 * descontarla en silencio, para que el total del archivo cuadre con el de la
 * corrida y la diferencia tenga nombre.
 */
export function motivoExclusionPorLiquidacion(item: SettlementItemLike): string | null {
  const estado = item.settlementStatus ?? "PENDING";

  if (estado === "CONFIRMED") {
    return "Esta partida ya se confirmó como pagada con comprobante. Volver a incluirla dispersaría el mismo dinero dos veces.";
  }
  if (estado === "FAILED") {
    return "El banco rechazó esta partida. Corrige el dato y prográmala en una corrida nueva; la deuda sigue registrada.";
  }
  return null;
}

/**
 * ¿La confirmación trae la evidencia mínima?
 *
 * Se exige referencia para confirmar y motivo para rechazar porque ambos son el
 * mismo tipo de dato: lo único que después permite contrastar la afirmación
 * contra el estado de cuenta. Una confirmación sin referencia deja el libro
 * saldado sin nada que lo respalde.
 */
export type ValidacionEvidencia =
  | { ok: true; motivo?: undefined }
  | { ok: false; motivo: string };

export function validarEvidenciaLiquidacion(input: {
  settlement: Exclude<PaymentRunItemSettlement, "PENDING">;
  reference?: string | null;
  failureReason?: string | null;
}): ValidacionEvidencia {
  if (input.settlement === "CONFIRMED") {
    if (!(input.reference ?? "").trim()) {
      return {
        ok: false,
        motivo:
          "Para confirmar el pago captura la referencia, folio o número de rastreo del comprobante: es lo que permite contrastarlo contra el estado de cuenta.",
      };
    }
    return { ok: true };
  }

  if (!(input.failureReason ?? "").trim()) {
    return {
      ok: false,
      motivo:
        "Para marcar el rechazo indica por qué lo devolvió el banco (cuenta inexistente, importe excedido, CLABE bloqueada...): sin motivo la partida no se puede corregir ni reprogramar.",
    };
  }

  return { ok: true };
}
