// Fase 4 — Contrato compartido de comisiones por canal.
//
// Sin dependencias de runtime (ni `db`, ni Drizzle), por la misma razón que
// `pnl-types.ts`: la tabla de comisiones y el panel de tarifas son componentes
// de cliente y necesitan los tipos y las etiquetas sin arrastrar el ORM al
// bundle del navegador.

/**
 * Canales sobre los que se puede configurar una tarifa de comisión.
 *
 * Las llaves de agregador son exactamente las que produce `matchAggregatorLabel`
 * (`lib/services/pos-column-aliases.ts`) y las que escribe el smart link de
 * corte de caja: si divergen, la tarifa se configura para un canal que ningún
 * corte usa y la comisión sale en cero sin decir por qué.
 *
 * `mostrador` y `tpv` no salen del JSONB de agregadores sino de las columnas
 * `cash_sales` y `card_sales` del corte.
 */
export const COMMISSION_CHANNELS = [
  "mostrador",
  "tpv",
  "rappi",
  "uber",
  "didi",
  "pedidosya",
  "justo",
  "sindelantal",
  "mercadopago",
] as const;

export type CommissionChannel = (typeof COMMISSION_CHANNELS)[number];

export const COMMISSION_CHANNEL_LABELS: Record<string, string> = {
  mostrador: "Mostrador (efectivo)",
  tpv: "TPV (tarjeta)",
  rappi: "Rappi",
  uber: "Uber Eats",
  didi: "DiDi Food",
  pedidosya: "PedidosYa",
  justo: "Justo",
  sindelantal: "Sin Delantal",
  mercadopago: "Mercado Pago",
};

/** Etiqueta legible de un canal; si es desconocido se muestra la llave cruda. */
export function commissionChannelLabel(channel: string): string {
  return COMMISSION_CHANNEL_LABELS[channel] ?? channel;
}

export function isCommissionChannel(value: string): value is CommissionChannel {
  return (COMMISSION_CHANNELS as readonly string[]).includes(value);
}

/**
 * Tope de la tarifa: 10,000 bps = 100%.
 *
 * No es paranoia de validación. La tarifa se multiplica por el volumen del mes,
 * así que un `2750` tecleado como `27500` no produce un error visible — produce
 * un renglón de comisiones diez veces mayor que se lee como una operación en
 * quiebra. Se rechaza en la captura, que es donde todavía hay un humano mirando.
 */
export const MAX_RATE_BPS = 10_000;

/** Una versión de tarifa tal como se captura y se lee. */
export interface CommissionRate {
  id: string;
  channel: string;
  /**
   * Sucursal a la que aplica, o `null` para la tarifa del grupo (A6.1).
   *
   * La resolución prefiere la de la sucursal y cae a la del grupo. Sin esto,
   * un grupo que abrió su sucursal 12 con una tarifa de arranque distinta
   * —lo normal cuando el agregador quiere entrar a una plaza nueva— no la podía
   * representar, y esa sucursal salía valuada con la tarifa de las otras once.
   */
  branchId: string | null;
  /** Nombre de la sucursal, para la tabla. `null` en la tarifa del grupo. */
  branchName?: string | null;
  /** Puntos base: 2750 = 27.50%. */
  rateBps: number;
  /** IVA sobre la comisión, en bps. `1600` = 16%; `0` = no causa IVA. */
  vatBps: number;
  /** Primer día de negocio al que aplica (inclusive), `YYYY-MM-DD`. */
  effectiveFrom: string;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
}

/**
 * Procedencia del importe de comisión de un canal (compatibilidad con P&L Fase 4).
 *
 * - `MEASURED`  — salió de un importe documentado (corte, pasarela, agregador o
 *                 conciliación bancaria) y no de una tarifa estimada.
 * - `ESTIMATED` — se calculó con la tarifa vigente. Es un cálculo, no una
 *                 medición, y así debe presentarse siempre.
 */
export type CommissionSource = "MEASURED" | "ESTIMATED";

/**
 * FIN-06.a — Procedencia explícita del importe de comisión, separada del estado
 * de conciliación bancaria/liquidación.
 */
export type CommissionAmountSource =
  | "RATE_ESTIMATE"
  | "CUT_REPORTED"
  | "GATEWAY_REPORTED"
  | "AGGREGATOR_REPORTED"
  | "BANK_RECONCILED"
  | "DOCUMENTED_ZERO"
  | "NO_DATA";

/**
 * FIN-06.a — Estado de conciliación de la comisión, independiente de la
 * procedencia del importe.
 */
export type CommissionReconciliationStatus =
  | "PENDING"
  | "DISCREPANT"
  | "CONFIRMED"
  | "NOT_APPLICABLE";

export const COMMISSION_AMOUNT_SOURCE_LABELS: Record<CommissionAmountSource, string> = {
  RATE_ESTIMATE: "Tarifa estimada",
  CUT_REPORTED: "Reportada en corte",
  GATEWAY_REPORTED: "Reportada por pasarela",
  AGGREGATOR_REPORTED: "Reportada por agregador",
  BANK_RECONCILED: "Conciliada en banco",
  DOCUMENTED_ZERO: "Comisión documentada cero",
  NO_DATA: "Sin datos",
};

export const COMMISSION_RECONCILIATION_STATUS_LABELS: Record<
  CommissionReconciliationStatus,
  string
> = {
  PENDING: "Pendiente de conciliar",
  DISCREPANT: "Discrepante",
  CONFIRMED: "Confirmada",
  NOT_APPLICABLE: "No aplica",
};

export function commissionAmountSourceLabel(source: CommissionAmountSource): string {
  return COMMISSION_AMOUNT_SOURCE_LABELS[source];
}

export function commissionReconciliationStatusLabel(
  status: CommissionReconciliationStatus,
): string {
  return COMMISSION_RECONCILIATION_STATUS_LABELS[status];
}

/**
 * Etiqueta coherente para API, P&L y UI combinando procedencia + estado de conciliación.
 * Nunca etiqueta como "conciliada" un importe solo reportado o pendiente.
 */
export function formatCommissionProvenanceTag(
  amountSource: CommissionAmountSource,
  reconciliationStatus: CommissionReconciliationStatus,
): string {
  const sourceLabel = commissionAmountSourceLabel(amountSource);
  if (reconciliationStatus === "NOT_APPLICABLE") {
    return sourceLabel;
  }
  return `${sourceLabel} · ${commissionReconciliationStatusLabel(reconciliationStatus)}`;
}

/** Prioridad conservadora del estado de conciliación al agregar múltiples canales/filas. */
export function aggregateReconciliationStatus(
  statuses: readonly CommissionReconciliationStatus[],
): CommissionReconciliationStatus {
  if (statuses.length === 0) return "NOT_APPLICABLE";
  if (statuses.includes("DISCREPANT")) return "DISCREPANT";
  if (statuses.includes("PENDING")) return "PENDING";
  if (statuses.includes("CONFIRMED")) return "CONFIRMED";
  return "NOT_APPLICABLE";
}

/** Prioridad conservadora de la procedencia del importe al agregar canales de una sucursal. */
export function aggregateAmountSource(
  sources: readonly CommissionAmountSource[],
  hasUncoveredSales: boolean,
): CommissionAmountSource {
  if (sources.length === 0) {
    return hasUncoveredSales ? "NO_DATA" : "DOCUMENTED_ZERO";
  }
  if (sources.includes("NO_DATA")) return "NO_DATA";
  if (sources.includes("RATE_ESTIMATE")) return "RATE_ESTIMATE";
  if (sources.every((s) => s === "DOCUMENTED_ZERO")) return "DOCUMENTED_ZERO";
  const nonZero = sources.filter((s) => s !== "DOCUMENTED_ZERO");
  if (nonZero.every((s) => s === "BANK_RECONCILED")) return "BANK_RECONCILED";
  if (nonZero.includes("GATEWAY_REPORTED")) return "GATEWAY_REPORTED";
  if (nonZero.includes("AGGREGATOR_REPORTED")) return "AGGREGATOR_REPORTED";
  if (nonZero.includes("CUT_REPORTED")) return "CUT_REPORTED";
  return "BANK_RECONCILED";
}

export interface ChannelCommission {
  channel: string;
  /** Venta bruta del canal en el período (la base sobre la que se aplica la tarifa). */
  baseSalesCents: number;
  /** `estimatedCents + reportedCents + reconciledCents` (`measuredCents + estimatedCents`). */
  commissionCents: number;
  /** FIN-06.b: comisión base sin IVA según fuente (`feeBaseCents + feeVatCents === commissionCents`). */
  feeBaseCents: number;
  /** FIN-06.b: IVA sobre comisión según fuente. */
  feeVatCents: number;
  /** FIN-06.b: neto esperado según fuente (`bruto - comisión - IVA`, o neto reportado). */
  expectedNetCents: number;
  /** FIN-06.b: abono efectivamente conciliado en banco (`0` si no hay cruce bancario). */
  bankMatchedCents: number;
  /** Parte documentada (reportada + conciliada en banco). */
  measuredCents: number;
  /** Parte reportada (corte/pasarela/agregador) aún pendiente o discrepante de conciliación. */
  reportedCents: number;
  /** Parte confirmada mediante conciliación bancaria o liquidación conciliada sin discrepancia. */
  reconciledCents: number;
  /** Parte calculada con la tarifa vigente. */
  estimatedCents: number;
  /** Diferencia detectada en centavos frente a banco o cuadre aritmético (0 si no hay discrepancia). */
  discrepancyCents: number;
  /**
   * Tarifa aplicada, o `null` cuando el rango abarcó varias vigencias (o cuando
   * todo el importe fue documentado). Un solo número no puede representar dos
   * tarifas distintas y devolver la última sería atribuirle al mes entero una
   * tasa que sólo rigió parte de él.
   */
  rateBps: number | null;
  /**
   * IVA aplicado sobre la comisión, en bps (A6.1). `null` con el mismo criterio
   * que `rateBps`: varias vigencias en el rango, o importe documentado.
   *
   * Existe porque el agregador cobra el IVA **sobre** su comisión: una tarifa
   * del 27.5% le cuesta al restaurante 31.9% de la venta, y `commissionCents`
   * ya lo incluye. Publicarlo permite verificar el importe a mano desde la
   * pantalla, que es el punto de publicar también `rateBps` y `baseSalesCents`.
   */
  vatBps: number | null;
  source: CommissionSource;
  /** FIN-06.a: procedencia explícita del importe, separada de conciliación. */
  amountSource: CommissionAmountSource;
  /** FIN-06.a: estado explícito de conciliación, separado de la procedencia. */
  reconciliationStatus: CommissionReconciliationStatus;
  amountSourceLabel: string;
  reconciliationStatusLabel: string;
  /** `true` cuando el importe $0 está documentado explícitamente (nunca dato faltante). */
  documentedZero: boolean;
  /** Cortes del período que aportaron venta a este canal. */
  cutsCount: number;
}

export interface BranchCommissions {
  branchId: string;
  channels: ChannelCommission[];
  totalCommissionCents: number;
  /** FIN-06.b: suma de comisión base sin IVA de los canales valuados. */
  totalFeeBaseCents: number;
  /** FIN-06.b: suma de IVA de comisión de los canales valuados. */
  totalFeeVatCents: number;
  /** FIN-06.b: suma de neto esperado de los canales valuados. */
  totalExpectedNetCents: number;
  /** FIN-06.b: suma de abonos efectivamente conciliados en banco. */
  totalBankMatchedCents: number;
  /** Total de comisiones reportadas (pendientes o discrepantes, no confirmadas en banco). */
  reportedCommissionCents: number;
  /** Total de comisiones confirmadas con conciliación. */
  reconciledCommissionCents: number;
  /** Total de comisiones calculadas por tarifa configurada. */
  estimatedCommissionCents: number;
  /** Suma de discrepancias detectadas en el período. */
  discrepancyCents: number;
  /** Venta de canales con tarifa configurada (o con comisión documentada). */
  coveredSalesCents: number;
  /**
   * Venta de canales SIN tarifa configurada ni reporte. No se estimó nada sobre
   * ella: el renglón del P&L está incompleto por ese monto, y decirlo es la
   * diferencia entre "no pagamos comisiones" y "no sabemos cuánto pagamos".
   */
  uncoveredSalesCents: number;
  /**
   * `MEASURED` sólo si todo el importe vino documentado; `ESTIMATED` si algo se
   * calculó con tarifa; `NO_DATA` si hay venta por canales con comisión y
   * ninguna tarifa ni reporte configurado.
   */
  source: CommissionSource | "NO_DATA";
  /** FIN-06.a: procedencia agregada del importe de la sucursal. */
  amountSource: CommissionAmountSource;
  /** FIN-06.a: estado agregado de conciliación de la sucursal. */
  reconciliationStatus: CommissionReconciliationStatus;
  amountSourceLabel: string;
  reconciliationStatusLabel: string;
  documentedZero: boolean;
  /** % de la venta con canal comisionable que sí tiene tarifa o reporte (0-100). */
  coveragePercent: number;
  note: string;
}

/** Comisión de un monto a una tarifa en bps, redondeada al centavo. */
export function commissionOf(baseCents: number, rateBps: number): number {
  return Math.round((baseCents * rateBps) / 10_000);
}

/**
 * Comisión **con IVA**: lo que el agregador de verdad le descuenta al
 * restaurante (A6.1 / F14).
 *
 * El agregador cobra el IVA **sobre** su comisión, no dentro: una tarifa del
 * 27.5% le cuesta al restaurante 31.9% de la venta. El cálculo anterior sólo
 * modelaba la tarifa, así que el renglón de comisiones del P&L venía corto
 * exactamente en 16% — justo en el canal que decide si el delivery gana o
 * pierde dinero.
 *
 * `vatBps` es por vigencia y no constante de módulo: hay contraprestaciones que
 * no causan IVA y hay tenants en franja fronteriza. `0` significa "sin IVA",
 * que es distinto de "no configurado".
 */
export function commissionWithVatOf(
  baseCents: number,
  rateBps: number,
  vatBps: number,
): number {
  const comision = commissionOf(baseCents, rateBps);
  return comision + Math.round((comision * vatBps) / 10_000);
}

/** `2750` → `"27.50%"`. Para etiquetas; nunca para recalcular. */
export function formatRateBps(rateBps: number): string {
  return `${(rateBps / 100).toFixed(2)}%`;
}
