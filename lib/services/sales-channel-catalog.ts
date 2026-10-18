/**
 * Catálogo de canales de venta — derivación pura.
 *
 * El "mapa de canales" del grupo no es una tabla propia: un canal existe por dos
 * razones que ya viven en Pulso —
 *
 *  1. Está en el catálogo canónico (`COMMISSION_CHANNELS`), que es la misma
 *     llave que escribe la ingesta del POS (`matchAggregatorLabel`) y que usan
 *     las tarifas de comisión.
 *  2. Tiene al menos una tarifa capturada (`channel_commission_rates`). Configurar
 *     la tarifa **es** activar la plataforma: no hay un flag separado que pueda
 *     contradecir a la tarifa que el P&L ya usa para valuar el canal.
 *
 * Los canales de sistema (`mostrador`, `tpv`) siempre están activos: no se
 * negocian ni se liquidan por estado de cuenta.
 *
 * Sin Drizzle ni DB para poder probarse en milisegundos y para que la UI importe
 * los tipos sin arrastrar la capa de datos al bundle.
 */
import { COMMISSION_CHANNELS, commissionChannelLabel } from "./commission-types";

export type SalesChannelKind = "SYSTEM" | "AGGREGATOR";

export interface SalesChannelView {
  /** Clave canónica (la que guarda `aggregator_sales`). */
  key: string;
  label: string;
  kind: SalesChannelKind;
  /** Operable hoy: sistema, o agregador con tarifa capturada. */
  active: boolean;
  /** Tarifa del grupo vigente hoy, o `null` si no hay vigencia aplicable. */
  rateBps: number | null;
  vatBps: number | null;
  /** Fecha desde la que rige `rateBps`. */
  effectiveFrom: string | null;
  /** Hay alguna tarifa capturada (grupo o sucursal), aunque no esté vigente hoy. */
  configured: boolean;
}

/** Subconjunto de `CommissionRate` que necesita la derivación. */
export interface ChannelRateInput {
  channel: string;
  branchId: string | null;
  effectiveFrom: string;
  rateBps: number;
  vatBps: number;
}

/** Canales que no se negocian: efectivo y terminal. */
const SYSTEM_CHANNELS = ["mostrador", "tpv"] as const;
const SYSTEM_SET = new Set<string>(SYSTEM_CHANNELS);

export function isSystemChannel(channel: string): boolean {
  return SYSTEM_SET.has(channel);
}

function kindFor(channel: string): SalesChannelKind {
  return isSystemChannel(channel) ? "SYSTEM" : "AGGREGATOR";
}

/**
 * Tarifa **del grupo** vigente a `today`: la última que empezó en o antes de hoy.
 *
 * Las tarifas por sucursal (`branchId != null`) no cuentan como "la tarifa del
 * grupo": se resuelven por sucursal al valuar el corte. Aquí sólo se reporta la
 * del grupo, y se declara `null` si el grupo no tiene ninguna.
 */
function currentGroupRate(
  rates: ChannelRateInput[],
  channel: string,
  today: string,
): ChannelRateInput | null {
  let best: ChannelRateInput | null = null;
  for (const rate of rates) {
    if (rate.channel !== channel || rate.branchId !== null) continue;
    if (rate.effectiveFrom > today) continue;
    if (!best || rate.effectiveFrom > best.effectiveFrom) best = rate;
  }
  return best;
}

function toView(key: string, rates: ChannelRateInput[], today: string): SalesChannelView {
  const system = isSystemChannel(key);
  const configured = rates.some((rate) => rate.channel === key);
  const current = currentGroupRate(rates, key, today);

  return {
    key,
    label: commissionChannelLabel(key),
    kind: kindFor(key),
    // Sistema: siempre activo. Agregador: activo en cuanto tiene tarifa.
    active: system || configured,
    rateBps: current?.rateBps ?? null,
    vatBps: current?.vatBps ?? null,
    effectiveFrom: current?.effectiveFrom ?? null,
    configured,
  };
}

/**
 * Une el catálogo canónico con las tarifas capturadas.
 *
 * Los canales con tarifa que no están en el catálogo se anexan al final: un
 * agregador nuevo funciona en el corte sin esperar un deploy, y aquí se vuelve
 * visible en lugar de desaparecer.
 */
export function deriveSalesChannels(
  rates: ChannelRateInput[],
  today: string,
): SalesChannelView[] {
  const catalog = COMMISSION_CHANNELS.map((key) => toView(key, rates, today));
  const known = new Set<string>(COMMISSION_CHANNELS);

  const extras: SalesChannelView[] = [];
  for (const channel of new Set(rates.map((rate) => rate.channel))) {
    if (known.has(channel)) continue;
    extras.push(toView(channel, rates, today));
  }

  return [...catalog, ...extras];
}

/** Sólo los canales operables hoy. Es el contrato que consumen corte y workflow. */
export function activeSalesChannels(
  rates: ChannelRateInput[],
  today: string,
): SalesChannelView[] {
  return deriveSalesChannels(rates, today).filter((channel) => channel.active);
}
