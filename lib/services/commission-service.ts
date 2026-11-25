// Fase 4 (F4.2) — Comisiones por canal.
//
// Por qué esto se calcula y no se mide (decisión D1 del plan, opción (a)):
// el sistema no guarda ningún monto NETO de venta. `daily_sales_cuts.aggregator_sales`
// es un mapa canal→centavos BRUTOS y `card_sales` es lo que el POS declaró, no
// lo que la terminal depositó. Restar "neto menos bruto" era imposible porque el
// neto no existe en ninguna tabla. Así que la comisión se calcula con la tarifa
// negociada y el renglón se etiqueta `ESTIMATED` — nunca `MEASURED`.
//
// La única excepción es `daily_sales_cuts.commission_cents`: cuando alguien
// concilió la terminal y capturó lo que de verdad cobró, ese importe SÍ es una
// medición y desplaza a la estimación de TPV para ese corte. Un canal que mezcla
// las dos cosas se reporta como `ESTIMATED`, que es lo más fuerte que se puede
// afirmar de una suma con una parte calculada.
//
// Tres reglas que el plan pide explícitamente y que están implementadas aquí:
//
//  1. La tarifa se resuelve por la **fecha de negocio del corte**, no por la de
//     consulta. Recalcular marzo con la tarifa de junio mueve el histórico solo.
//  2. Un canal **sin tarifa configurada se omite**: no se inventa una tasa de
//     mercado. Su venta se acumula en `uncoveredSalesCents` para que el renglón
//     pueda decir de cuánta venta no sabe nada.
//  3. `mostrador` sólo aparece si alguien le configuró tarifa a propósito. El
//     efectivo no paga comisión, y contarlo como "sin cubrir" dejaría a todo
//     tenant en `NO_DATA` para siempre.

import { db } from "@/lib/db";
import {
  aggregatorSettlements,
  bankTransactions,
  branches,
  channelCommissionRates,
  dailySalesCuts,
  users,
  gatewayTransactions,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { normalizeSettlementChannel } from "@/lib/services/aggregator-settlement-rules";
import {
  COMMISSION_CHANNELS,
  MAX_RATE_BPS,
  aggregateAmountSource,
  aggregateReconciliationStatus,
  commissionAmountSourceLabel,
  commissionOf,
  commissionReconciliationStatusLabel,
  commissionWithVatOf,
  commissionChannelLabel,
  formatCommissionProvenanceTag,
  formatRateBps,
  isCommissionChannel,
} from "@/lib/services/commission-types";
import type {
  BranchCommissions,
  ChannelCommission,
  CommissionAmountSource,
  CommissionRate,
  CommissionReconciliationStatus,
  CommissionSource,
} from "@/lib/services/commission-types";

export type {
  BranchCommissions,
  ChannelCommission,
  CommissionAmountSource,
  CommissionRate,
  CommissionReconciliationStatus,
} from "@/lib/services/commission-types";

/**
 * Canales que pueden cobrar comisión. Es `COMMISSION_CHANNELS` menos
 * `mostrador`: la venta en efectivo sin tarifa configurada no es un hueco de
 * información, es un canal que no cobra.
 */
const COMMISSION_BEARING = COMMISSION_CHANNELS.filter((c) => c !== "mostrador");

// ---------------------------------------------------------------------------
// Tarifas
// ---------------------------------------------------------------------------

/** Todas las vigencias configuradas, de la más reciente a la más antigua. */
export async function listCommissionRates(companyId: string): Promise<CommissionRate[]> {
  const rows = await db
    .select({
      id: channelCommissionRates.id,
      channel: channelCommissionRates.channel,
      branchId: channelCommissionRates.branchId,
      branchName: branches.name,
      rateBps: channelCommissionRates.rateBps,
      vatBps: channelCommissionRates.vatBps,
      effectiveFrom: channelCommissionRates.effectiveFrom,
      notes: channelCommissionRates.notes,
      createdByName: users.name,
      createdAt: channelCommissionRates.createdAt,
    })
    .from(channelCommissionRates)
    .leftJoin(users, eq(channelCommissionRates.createdBy, users.id))
    .leftJoin(branches, eq(channelCommissionRates.branchId, branches.id))
    .where(eq(channelCommissionRates.companyId, companyId))
    .orderBy(asc(channelCommissionRates.channel), desc(channelCommissionRates.effectiveFrom));

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    branchId: r.branchId ?? null,
    branchName: r.branchName ?? null,
    rateBps: r.rateBps,
    vatBps: r.vatBps,
    effectiveFrom: r.effectiveFrom,
    notes: r.notes,
    createdByName: r.createdByName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface CreateRateInput {
  companyId: string;
  channel: string;
  /** `null` = tarifa del grupo. Con valor, sólo aplica a esa sucursal (A6.1). */
  branchId?: string | null;
  rateBps: number;
  /** IVA sobre la comisión en bps. Por omisión 16%, que es lo que cobra el agregador. */
  vatBps?: number;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
  notes?: string | null;
  createdBy: string | null;
}

/**
 * Alta (o corrección) de una vigencia.
 *
 * Re-capturar la misma (canal, fecha) **corrige** la tasa en vez de crear una
 * segunda verdad para el mismo día: dos filas con la misma vigencia y tasas
 * distintas harían que el importe del mes dependiera del orden del `ORDER BY`.
 */
export async function upsertCommissionRate(input: CreateRateInput): Promise<CommissionRate> {
  if (!isCommissionChannel(input.channel)) {
    throw ApiError.badRequest(
      `Canal desconocido: "${input.channel}". Los canales válidos son ${COMMISSION_CHANNELS.join(", ")}.`,
    );
  }
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > MAX_RATE_BPS) {
    throw ApiError.badRequest(
      `La tarifa debe estar entre 0% y 100% (0 y ${MAX_RATE_BPS} puntos base).`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    throw ApiError.badRequest("La fecha de vigencia debe tener formato YYYY-MM-DD.");
  }

  const vatBps = input.vatBps ?? 1600;
  if (!Number.isInteger(vatBps) || vatBps < 0 || vatBps > MAX_RATE_BPS) {
    throw ApiError.badRequest(
      `El IVA sobre la comisión debe estar entre 0% y 100% (0 y ${MAX_RATE_BPS} puntos base).`,
    );
  }

  const branchId = input.branchId ?? null;
  if (branchId) {
    // La sucursal tiene que ser de esta empresa: la llave foránea no lo detecta
    // —la sucursal de otra empresa **existe**— y dejaría una tarifa cruzada
    // entre inquilinos.
    await assertBranchOfCompany(input.companyId, branchId);
  }

  // Dos índices únicos parciales (uno para la tarifa de sucursal y otro para la
  // del grupo), porque Postgres trata los NULL como distintos entre sí. El
  // `onConflictDoUpdate` tiene que apuntar al que corresponde: no se puede
  // apuntar a los dos a la vez, y el parcial exige repetir su predicado.
  const [row] = await db
    .insert(channelCommissionRates)
    .values({
      companyId: input.companyId,
      channel: input.channel,
      branchId,
      rateBps: input.rateBps,
      vatBps,
      effectiveFrom: input.effectiveFrom,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: branchId
        ? [
            channelCommissionRates.companyId,
            channelCommissionRates.channel,
            channelCommissionRates.branchId,
            channelCommissionRates.effectiveFrom,
          ]
        : [
            channelCommissionRates.companyId,
            channelCommissionRates.channel,
            channelCommissionRates.effectiveFrom,
          ],
      targetWhere: branchId
        ? sql`${channelCommissionRates.branchId} IS NOT NULL`
        : sql`${channelCommissionRates.branchId} IS NULL`,
      set: {
        rateBps: input.rateBps,
        vatBps,
        notes: input.notes ?? null,
        createdBy: input.createdBy,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    id: row.id,
    channel: row.channel,
    branchId: row.branchId ?? null,
    branchName: null,
    rateBps: row.rateBps,
    vatBps: row.vatBps,
    effectiveFrom: row.effectiveFrom,
    notes: row.notes,
    createdByName: null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Borra una vigencia. El `companyId` va en el WHERE y no sólo el id: sin él,
 * un uuid adivinado borraría la tarifa de otra empresa.
 */
export async function deleteCommissionRate(companyId: string, rateId: string): Promise<void> {
  const deleted = await db
    .delete(channelCommissionRates)
    .where(
      and(eq(channelCommissionRates.companyId, companyId), eq(channelCommissionRates.id, rateId)),
    )
    .returning({ id: channelCommissionRates.id });

  if (deleted.length === 0) {
    throw ApiError.notFound("Esa tarifa de comisión no existe en tu empresa.");
  }
}

/**
 * Tarifa vigente para un canal en una fecha de negocio, o `null` si no hay
 * ninguna vigencia que la cubra.
 *
 * `rates` debe venir ordenado por `effectiveFrom` ascendente; se recorre al
 * revés y gana la primera vigencia que empezó en o antes de la fecha. Un corte
 * anterior a la primera vigencia configurada NO se valúa: la tarifa de hoy no
 * dice nada sobre lo que se cobraba antes de negociarla.
 */
export function resolveRateBps(
  rates: Array<{ effectiveFrom: string; rateBps: number }>,
  businessDate: string,
): number | null {
  return resolveRate(rates, businessDate)?.rateBps ?? null;
}

/** Una vigencia resuelta: tarifa e IVA aplicables a esa fecha. */
export interface VigenciaResuelta {
  rateBps: number;
  vatBps: number;
}

/**
 * La vigencia que aplica a una fecha, con su IVA (A6.1).
 *
 * Misma regla de siempre —gana la última vigencia que empezó en o antes de la
 * fecha— pero devolviendo también `vatBps`, porque el IVA se negocia con la
 * tarifa y cambia con ella.
 */
export function resolveRate(
  rates: Array<{ effectiveFrom: string; rateBps: number; vatBps?: number }>,
  businessDate: string,
): VigenciaResuelta | null {
  for (let i = rates.length - 1; i >= 0; i--) {
    if (rates[i].effectiveFrom <= businessDate) {
      return { rateBps: rates[i].rateBps, vatBps: rates[i].vatBps ?? 0 };
    }
  }
  return null;
}

/**
 * Llave del mapa de vigencias: la tarifa de una sucursal y la del grupo son
 * series distintas del mismo canal, y sólo se mezclarían mal.
 */
function llaveTarifa(channel: string, branchId: string | null): string {
  return `${branchId ?? "GRUPO"}::${channel}`;
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

/** Base de venta por canal que aporta un corte. */
function channelBases(cut: {
  cashSales: number | null;
  cardSales: number | null;
  aggregatorSales: unknown;
}): Map<string, number> {
  const bases = new Map<string, number>();
  if (cut.cashSales && cut.cashSales > 0) bases.set("mostrador", cut.cashSales);
  if (cut.cardSales && cut.cardSales > 0) bases.set("tpv", cut.cardSales);

  const agg = cut.aggregatorSales;
  if (agg && typeof agg === "object" && !Array.isArray(agg)) {
    for (const [key, value] of Object.entries(agg as Record<string, unknown>)) {
      const cents = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(cents) && cents > 0) {
        bases.set(key, (bases.get(key) ?? 0) + cents);
      }
    }
  }
  return bases;
}

interface ChannelAcc {
  /** Venta a la que SÍ se le pudo aplicar una tarifa (o documentar una comisión). */
  coveredBaseCents: number;
  /** Venta que quedó sin valuar por no haber tarifa vigente ni reporte en su fecha. */
  uncoveredBaseCents: number;
  feeBaseCents: number;
  feeVatCents: number;
  expectedNetCents: number;
  bankMatchedCents: number;
  reportedCents: number;
  reconciledCents: number;
  estimatedCents: number;
  discrepancyCents: number;
  cutReportedCount: number;
  ratesApplied: Set<number>;
  /** IVAs aplicados. Igual que `ratesApplied`: si hay más de uno, no se rotula. */
  vatApplied: Set<number>;
  cutsCount: number;
  amountSources: CommissionAmountSource[];
  reconciliationStatuses: CommissionReconciliationStatus[];
  documentedZero: boolean;
}

function emptyChannelAcc(): ChannelAcc {
  return {
    coveredBaseCents: 0,
    uncoveredBaseCents: 0,
    feeBaseCents: 0,
    feeVatCents: 0,
    expectedNetCents: 0,
    bankMatchedCents: 0,
    reportedCents: 0,
    reconciledCents: 0,
    estimatedCents: 0,
    discrepancyCents: 0,
    cutReportedCount: 0,
    ratesApplied: new Set<number>(),
    vatApplied: new Set<number>(),
    cutsCount: 0,
    amountSources: [],
    reconciliationStatuses: [],
    documentedZero: false,
  };
}

/**
 * Comisiones del período por sucursal y canal.
 *
 * FIN-06.a: separa explícitamente la procedencia del importe (`amountSource`:
 * tarifa estimada, reporte en corte/pasarela/agregador, conciliación bancaria o
 * cero documentado) del estado de conciliación (`reconciliationStatus`:
 * pendiente, discrepante, confirmado o no aplica).
 */
export async function getCommissionsByBranch(
  companyId: string,
  from: string,
  to: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance: any = db,
): Promise<BranchCommissions[]> {
  const startDay = from.slice(0, 10);
  const endDay = to.slice(0, 10);

  const ratesQuery = dbInstance
    .select({
      channel: channelCommissionRates.channel,
      branchId: channelCommissionRates.branchId,
      rateBps: channelCommissionRates.rateBps,
      vatBps: channelCommissionRates.vatBps,
      effectiveFrom: channelCommissionRates.effectiveFrom,
    })
    .from(channelCommissionRates)
    .where(eq(channelCommissionRates.companyId, companyId))
    .orderBy(asc(channelCommissionRates.effectiveFrom));

  const cutsQuery = dbInstance
    .select({
      branchId: dailySalesCuts.branchId,
      businessDate: dailySalesCuts.businessDate,
      cashSales: dailySalesCuts.cashSales,
      cardSales: dailySalesCuts.cardSales,
      aggregatorSales: dailySalesCuts.aggregatorSales,
      commissionCents: dailySalesCuts.commissionCents,
    })
    .from(dailySalesCuts)
    .where(
      and(
        eq(dailySalesCuts.companyId, companyId),
        gte(dailySalesCuts.businessDate, startDay),
        lte(dailySalesCuts.businessDate, endDay),
      ),
    );

  const gatewayQuery = dbInstance
    .select({
      id: gatewayTransactions.id,
      branchId: gatewayTransactions.branchId,
      grossAmountCents: gatewayTransactions.grossAmountCents,
      feeAmountCents: gatewayTransactions.feeAmountCents,
      feeVatCents: gatewayTransactions.feeVatCents,
      netAmountCents: gatewayTransactions.netAmountCents,
    })
    .from(gatewayTransactions)
    .where(
      and(
        eq(gatewayTransactions.companyId, companyId),
        gte(gatewayTransactions.transactionDate, new Date(startDay)),
        lte(gatewayTransactions.transactionDate, new Date(`${endDay}T23:59:59.999Z`)),
      ),
    );

  const bankMatchQuery = dbInstance.select({
    id: bankTransactions.id,
    matchedGatewayTransactionId: bankTransactions.matchedGatewayTransactionId,
    amountCents: bankTransactions.amountCents,
  });

  const settlementQuery = dbInstance.select({
    id: aggregatorSettlements.id,
    branchId: aggregatorSettlements.branchId,
    channel: aggregatorSettlements.channel,
    grossSalesCents: aggregatorSettlements.grossSalesCents,
    commissionCents: aggregatorSettlements.commissionCents,
    netDepositedCents: aggregatorSettlements.netDepositedCents,
    varianceCents: aggregatorSettlements.varianceCents,
    status: aggregatorSettlements.status,
  });

  const [rateRows, cuts, gatewayRows, bankMatchRows, settlementRows] = await Promise.all([
    ratesQuery,
    cutsQuery,
    gatewayQuery,
    bankMatchQuery && typeof bankMatchQuery.from === "function"
      ? bankMatchQuery
          .from(bankTransactions)
          .where(
            and(
              eq(bankTransactions.companyId, companyId),
              eq(bankTransactions.matchStatus, "MATCHED"),
              isNotNull(bankTransactions.matchedGatewayTransactionId),
            ),
          )
      : Promise.resolve([]),
    settlementQuery && typeof settlementQuery.from === "function"
      ? settlementQuery
          .from(aggregatorSettlements)
          .where(
            and(
              eq(aggregatorSettlements.companyId, companyId),
              lte(aggregatorSettlements.periodStart, endDay),
              gte(aggregatorSettlements.periodEnd, startDay),
            ),
          )
      : Promise.resolve([]),
  ]);

  // Vigencias por (sucursal, canal), ya ordenadas ascendente por la consulta.
  const ratesByKey = new Map<
    string,
    Array<{ effectiveFrom: string; rateBps: number; vatBps: number }>
  >();
  for (const r of rateRows) {
    const key = llaveTarifa(r.channel, r.branchId);
    const list = ratesByKey.get(key) ?? [];
    list.push({ effectiveFrom: r.effectiveFrom, rateBps: r.rateBps, vatBps: r.vatBps });
    ratesByKey.set(key, list);
  }

  /** Tarifa de la sucursal si la tiene; si no, la del grupo. */
  const vigenciaPara = (channel: string, branchId: string, businessDate: string) =>
    resolveRate(ratesByKey.get(llaveTarifa(channel, branchId)) ?? [], businessDate) ??
    resolveRate(ratesByKey.get(llaveTarifa(channel, null)) ?? [], businessDate);

  const byBranch = new Map<string, Map<string, ChannelAcc>>();

  for (const cut of cuts) {
    const channels = byBranch.get(cut.branchId) ?? new Map<string, ChannelAcc>();
    byBranch.set(cut.branchId, channels);

    const bases = channelBases(cut);

    // La comisión capturada es la de la TERMINAL, así que sólo puede desplazar
    // a la estimación del canal `tpv`. Se admite aunque el corte no declare
    // venta con tarjeta: una comisión cobrada sin venta declarada es una
    // inconsistencia que hay que ver, no que esconder.
    if (cut.commissionCents !== null && !bases.has("tpv")) bases.set("tpv", 0);

    for (const [channel, baseCents] of bases) {
      const acc = channels.get(channel) ?? emptyChannelAcc();
      acc.cutsCount += 1;

      if (channel === "tpv" && cut.commissionCents !== null) {
        acc.cutReportedCount += 1;
        acc.reportedCents += cut.commissionCents;
        acc.feeBaseCents += cut.commissionCents;
        acc.expectedNetCents += baseCents - cut.commissionCents;
        acc.coveredBaseCents += baseCents;
        acc.amountSources.push(cut.commissionCents === 0 ? "DOCUMENTED_ZERO" : "CUT_REPORTED");
        acc.reconciliationStatuses.push("PENDING");
        acc.documentedZero = acc.reportedCents === 0 && acc.estimatedCents === 0;
      } else {
        const vigencia = vigenciaPara(channel, cut.branchId, cut.businessDate);
        const rateBps = vigencia?.rateBps ?? null;
        if (vigencia === null || rateBps === null) {
          acc.uncoveredBaseCents += baseCents;
        } else {
          const feeBase = commissionOf(baseCents, rateBps);
          const totalWithVat = commissionWithVatOf(baseCents, rateBps, vigencia.vatBps);
          const feeVat = totalWithVat - feeBase;
          acc.estimatedCents += totalWithVat;
          acc.feeBaseCents += feeBase;
          acc.feeVatCents += feeVat;
          acc.expectedNetCents += baseCents - totalWithVat;
          acc.ratesApplied.add(rateBps);
          acc.vatApplied.add(vigencia.vatBps);
          acc.coveredBaseCents += baseCents;
          acc.amountSources.push("RATE_ESTIMATE");
          acc.reconciliationStatuses.push("PENDING");
          acc.documentedZero = false;
        }
      }

      channels.set(channel, acc);
    }
  }

  // Mapa de depósitos bancarios conciliados por transacción de pasarela.
  const bankByGatewayId = new Map<string, { id: string; amountCents: number }>();
  for (const b of bankMatchRows) {
    if (b.matchedGatewayTransactionId) {
      bankByGatewayId.set(b.matchedGatewayTransactionId, {
        id: b.id,
        amountCents: b.amountCents,
      });
    }
  }

  // Integrar transacciones documentadas de reportes de pasarelas (Clip, MP, bancos)
  // separando importe reportado vs conciliado en banco y estado de conciliación.
  const gatewayByBranch = new Map<
    string,
    {
      txCount: number;
      grossCents: number;
      feeBaseCents: number;
      feeVatCents: number;
      expectedNetCents: number;
      bankMatchedCents: number;
      reportedCents: number;
      reconciledCents: number;
      discrepancyCents: number;
      statuses: CommissionReconciliationStatus[];
      allZeroFee: boolean;
    }
  >();

  for (const g of gatewayRows) {
    const prev = gatewayByBranch.get(g.branchId) ?? {
      txCount: 0,
      grossCents: 0,
      feeBaseCents: 0,
      feeVatCents: 0,
      expectedNetCents: 0,
      bankMatchedCents: 0,
      reportedCents: 0,
      reconciledCents: 0,
      discrepancyCents: 0,
      statuses: [],
      allZeroFee: true,
    };

    const feeTotal = g.feeAmountCents + g.feeVatCents;
    const expectedNet = g.grossAmountCents - feeTotal;
    const reportedNet = typeof g.netAmountCents === "number" ? g.netAmountCents : expectedNet;
    const arithmeticDiff = reportedNet - expectedNet;
    const matchedBank = g.id ? bankByGatewayId.get(g.id) : undefined;

    prev.txCount += 1;
    prev.grossCents += g.grossAmountCents;
    prev.feeBaseCents += g.feeAmountCents;
    prev.feeVatCents += g.feeVatCents;
    prev.expectedNetCents += reportedNet;
    if (feeTotal !== 0) prev.allZeroFee = false;

    if (matchedBank) {
      prev.bankMatchedCents += matchedBank.amountCents;
      const bankDiff = matchedBank.amountCents - reportedNet;
      if (Math.abs(bankDiff) > 1 || Math.abs(arithmeticDiff) > 1) {
        prev.reportedCents += feeTotal;
        prev.discrepancyCents += Math.abs(bankDiff) > 1 ? bankDiff : arithmeticDiff;
        prev.statuses.push("DISCREPANT");
      } else {
        prev.reconciledCents += feeTotal;
        prev.statuses.push("CONFIRMED");
      }
    } else if (Math.abs(arithmeticDiff) > 1) {
      prev.reportedCents += feeTotal;
      prev.discrepancyCents += arithmeticDiff;
      prev.statuses.push("DISCREPANT");
    } else {
      prev.reportedCents += feeTotal;
      prev.statuses.push("PENDING");
    }

    gatewayByBranch.set(g.branchId, prev);
  }

  for (const [branchId, gw] of gatewayByBranch) {
    const channels = byBranch.get(branchId) ?? new Map<string, ChannelAcc>();
    byBranch.set(branchId, channels);

    // Una comisión documentada (incluido cero documentado) sustituye la estimación por tarifa.
    if (gw.grossCents > 0 || gw.txCount > 0) {
      const tpvAcc = channels.get("tpv") ?? emptyChannelAcc();
      const hasBankConfirmed = gw.statuses.includes("CONFIRMED");

      // Si no había comisión reportada manualmente en cortes (o si la pasarela ya fue
      // conciliada contra banco), el reporte/conciliación de pasarela toma prioridad.
      if (tpvAcc.cutReportedCount === 0 || hasBankConfirmed) {
        tpvAcc.feeBaseCents = gw.feeBaseCents;
        tpvAcc.feeVatCents = gw.feeVatCents;
        tpvAcc.expectedNetCents = gw.expectedNetCents;
        tpvAcc.bankMatchedCents = gw.bankMatchedCents;
        tpvAcc.reportedCents = gw.reportedCents;
        tpvAcc.reconciledCents = gw.reconciledCents;
        tpvAcc.discrepancyCents = gw.discrepancyCents;
        tpvAcc.coveredBaseCents = Math.max(tpvAcc.coveredBaseCents, gw.grossCents);
        tpvAcc.uncoveredBaseCents = 0;
        tpvAcc.estimatedCents = 0;
        tpvAcc.ratesApplied.clear();
        tpvAcc.vatApplied.clear();
        tpvAcc.documentedZero = gw.allZeroFee;

        const gwStatus = aggregateReconciliationStatus(gw.statuses);
        const gwAmountSource: CommissionAmountSource = gw.allZeroFee
          ? "DOCUMENTED_ZERO"
          : gwStatus === "CONFIRMED" && gw.reportedCents === 0
            ? "BANK_RECONCILED"
            : "GATEWAY_REPORTED";

        tpvAcc.amountSources = [gwAmountSource];
        tpvAcc.reconciliationStatuses = [gwStatus];
        channels.set("tpv", tpvAcc);
      }
    }
  }

  // Integrar liquidaciones documentadas de agregadores (`aggregator_settlements`).
  const settlementsByBranchChannel = new Map<
    string,
    {
      branchId: string;
      channel: string;
      grossCents: number;
      feeBaseCents: number;
      expectedNetCents: number;
      reportedCents: number;
      reconciledCents: number;
      discrepancyCents: number;
      statuses: CommissionReconciliationStatus[];
      allZeroFee: boolean;
    }
  >();

  for (const s of settlementRows) {
    const channel = normalizeSettlementChannel(s.channel);
    const key = `${s.branchId}::${channel}`;
    const prev = settlementsByBranchChannel.get(key) ?? {
      branchId: s.branchId,
      channel,
      grossCents: 0,
      feeBaseCents: 0,
      expectedNetCents: 0,
      reportedCents: 0,
      reconciledCents: 0,
      discrepancyCents: 0,
      statuses: [],
      allZeroFee: true,
    };

    const arithmeticDiff = s.grossSalesCents - s.commissionCents - s.netDepositedCents;
    const isDiscrepant = s.status === "DISCREPANCY" || Math.abs(arithmeticDiff) > 1;
    const isConfirmed = !isDiscrepant && s.status === "RECONCILED";

    prev.grossCents += s.grossSalesCents;
    prev.feeBaseCents += s.commissionCents;
    prev.expectedNetCents += s.netDepositedCents;
    if (s.commissionCents !== 0) prev.allZeroFee = false;

    if (isConfirmed) {
      prev.reconciledCents += s.commissionCents;
      prev.statuses.push("CONFIRMED");
    } else if (isDiscrepant) {
      prev.reportedCents += s.commissionCents;
      prev.discrepancyCents +=
        s.status === "DISCREPANCY" && typeof s.varianceCents === "number"
          ? s.varianceCents
          : arithmeticDiff;
      prev.statuses.push("DISCREPANT");
    } else {
      prev.reportedCents += s.commissionCents;
      prev.statuses.push("PENDING");
    }

    settlementsByBranchChannel.set(key, prev);
  }

  for (const agg of settlementsByBranchChannel.values()) {
    const channels = byBranch.get(agg.branchId) ?? new Map<string, ChannelAcc>();
    byBranch.set(agg.branchId, channels);

    const acc = channels.get(agg.channel) ?? emptyChannelAcc();
    acc.feeBaseCents = agg.feeBaseCents;
    acc.feeVatCents = 0;
    acc.expectedNetCents = agg.expectedNetCents;
    acc.bankMatchedCents = 0;
    acc.reportedCents = agg.reportedCents;
    acc.reconciledCents = agg.reconciledCents;
    acc.discrepancyCents = agg.discrepancyCents;
    acc.coveredBaseCents = Math.max(acc.coveredBaseCents, agg.grossCents);
    acc.uncoveredBaseCents = 0;
    acc.estimatedCents = 0;
    acc.ratesApplied.clear();
    acc.vatApplied.clear();
    acc.documentedZero = agg.allZeroFee;

    const aggStatus = aggregateReconciliationStatus(agg.statuses);
    const aggAmountSource: CommissionAmountSource = agg.allZeroFee
      ? "DOCUMENTED_ZERO"
      : "AGGREGATOR_REPORTED";

    acc.amountSources = [aggAmountSource];
    acc.reconciliationStatuses = [aggStatus];
    channels.set(agg.channel, acc);
  }

  const result: BranchCommissions[] = [];

  for (const [branchId, channels] of byBranch) {
    const lines: ChannelCommission[] = [];
    let coveredSalesCents = 0;
    let uncoveredSalesCents = 0;
    let anyEstimated = false;

    for (const [channel, acc] of channels) {
      // El efectivo sin tarifa no es un hueco de información: es un canal que
      // no cobra comisión. Sólo los canales comisionables cuentan como venta
      // sin cubrir.
      if ((COMMISSION_BEARING as readonly string[]).includes(channel)) {
        uncoveredSalesCents += acc.uncoveredBaseCents;
      }

      const measuredCents = acc.reportedCents + acc.reconciledCents;
      const valued = acc.coveredBaseCents > 0 || measuredCents !== 0 || acc.documentedZero;

      // Un canal sin tarifa y sin comisión documentada se OMITE del desglose: la
      // alternativa —listarlo en cero— se lee como "Rappi no nos cobró nada".
      if (!valued) continue;

      coveredSalesCents += acc.coveredBaseCents;

      const source: CommissionSource = acc.estimatedCents > 0 ? "ESTIMATED" : "MEASURED";
      if (source === "ESTIMATED") anyEstimated = true;

      const commissionCents = measuredCents + acc.estimatedCents;
      const documentedZero =
        commissionCents === 0 &&
        acc.uncoveredBaseCents === 0 &&
        (acc.documentedZero || acc.amountSources.every((s) => s === "DOCUMENTED_ZERO"));

      const amountSource: CommissionAmountSource = documentedZero
        ? "DOCUMENTED_ZERO"
        : aggregateAmountSource(acc.amountSources, acc.uncoveredBaseCents > 0);
      const reconciliationStatus: CommissionReconciliationStatus =
        acc.uncoveredBaseCents > 0 && !acc.reconciliationStatuses.includes("DISCREPANT")
          ? "PENDING"
          : aggregateReconciliationStatus(acc.reconciliationStatuses);

      lines.push({
        channel,
        // Sólo la venta valuada: así `comisión ≈ base × tarifa` se puede
        // verificar a mano desde la pantalla, que es el punto de publicarla.
        baseSalesCents: acc.coveredBaseCents,
        commissionCents,
        feeBaseCents: acc.feeBaseCents,
        feeVatCents: acc.feeVatCents,
        expectedNetCents: acc.expectedNetCents,
        bankMatchedCents: acc.bankMatchedCents,
        measuredCents,
        reportedCents: acc.reportedCents,
        reconciledCents: acc.reconciledCents,
        estimatedCents: acc.estimatedCents,
        discrepancyCents: acc.discrepancyCents,
        rateBps: acc.ratesApplied.size === 1 ? [...acc.ratesApplied][0] : null,
        vatBps: acc.vatApplied.size === 1 ? [...acc.vatApplied][0] : null,
        source,
        amountSource,
        reconciliationStatus,
        amountSourceLabel: commissionAmountSourceLabel(amountSource),
        reconciliationStatusLabel: commissionReconciliationStatusLabel(reconciliationStatus),
        documentedZero,
        cutsCount: acc.cutsCount,
      });
    }

    lines.sort((a, b) => b.commissionCents - a.commissionCents);

    const totalCommissionCents = lines.reduce((s, l) => s + l.commissionCents, 0);
    const totalFeeBaseCents = lines.reduce((s, l) => s + l.feeBaseCents, 0);
    const totalFeeVatCents = lines.reduce((s, l) => s + l.feeVatCents, 0);
    const totalExpectedNetCents = lines.reduce((s, l) => s + l.expectedNetCents, 0);
    const totalBankMatchedCents = lines.reduce((s, l) => s + l.bankMatchedCents, 0);
    const reportedCommissionCents = lines.reduce((s, l) => s + l.reportedCents, 0);
    const reconciledCommissionCents = lines.reduce((s, l) => s + l.reconciledCents, 0);
    const estimatedCommissionCents = lines.reduce((s, l) => s + l.estimatedCents, 0);
    const discrepancyCents = lines.reduce((s, l) => s + l.discrepancyCents, 0);
    const comisionable = coveredSalesCents + uncoveredSalesCents;
    const coveragePercent = comisionable > 0 ? (coveredSalesCents / comisionable) * 100 : 100;

    let source: BranchCommissions["source"];
    let amountSource: CommissionAmountSource;
    let reconciliationStatus: CommissionReconciliationStatus;
    let documentedZero: boolean;
    let note: string;

    if (lines.length === 0) {
      if (uncoveredSalesCents > 0) {
        source = "NO_DATA";
        amountSource = "NO_DATA";
        reconciliationStatus = "PENDING";
        documentedZero = false;
        note =
          "Sin datos · Pendiente de conciliar. Hay venta por canales que cobran comisión " +
          "(tarjeta o agregadores) y ninguna tarifa ni reporte configurado para el período.";
      } else {
        source = "MEASURED";
        amountSource = "DOCUMENTED_ZERO";
        reconciliationStatus = "NOT_APPLICABLE";
        documentedZero = true;
        note =
          "Comisión documentada cero: sin ventas por canales con comisión en el período (sólo mostrador).";
      }
    } else {
      source = anyEstimated ? "ESTIMATED" : "MEASURED";
      documentedZero =
        totalCommissionCents === 0 &&
        uncoveredSalesCents === 0 &&
        lines.every((l) => l.documentedZero);
      amountSource = documentedZero
        ? "DOCUMENTED_ZERO"
        : aggregateAmountSource(
            lines.map((l) => l.amountSource),
            uncoveredSalesCents > 0,
          );
      reconciliationStatus =
        uncoveredSalesCents > 0 && !lines.some((l) => l.reconciliationStatus === "DISCREPANT")
          ? "PENDING"
          : aggregateReconciliationStatus(lines.map((l) => l.reconciliationStatus));

      const provenanceTag = formatCommissionProvenanceTag(amountSource, reconciliationStatus);
      const detalle = lines
        .map(
          (l) =>
            `${commissionChannelLabel(l.channel)}${l.rateBps !== null ? ` ${formatRateBps(l.rateBps)}` : ""}`,
        )
        .join(", ");

      note =
        `${provenanceTag} (${detalle}).` +
        (discrepancyCents !== 0
          ? ` Diferencia detectada en conciliación: ${formatMXN(discrepancyCents)}.`
          : "") +
        (uncoveredSalesCents > 0
          ? ` No cubre ${formatMXN(uncoveredSalesCents)} de venta en canales sin tarifa ni reporte.`
          : "");
    }

    result.push({
      branchId,
      channels: lines,
      totalCommissionCents,
      totalFeeBaseCents,
      totalFeeVatCents,
      totalExpectedNetCents,
      totalBankMatchedCents,
      reportedCommissionCents,
      reconciledCommissionCents,
      estimatedCommissionCents,
      discrepancyCents,
      coveredSalesCents,
      uncoveredSalesCents,
      source,
      amountSource,
      reconciliationStatus,
      amountSourceLabel: commissionAmountSourceLabel(amountSource),
      reconciliationStatusLabel: commissionReconciliationStatusLabel(reconciliationStatus),
      documentedZero,
      coveragePercent: Math.max(0, Math.min(100, Math.round(coveragePercent))),
      note,
    });
  }

  return result;
}

function formatMXN(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

// ---------------------------------------------------------------------------
// Auditoría matemática de comisiones (Línea 214 propuesta finanzas)
// ---------------------------------------------------------------------------

export interface CommissionAuditDiscrepancy {
  transactionId: string;
  externalId: string | null;
  authorizationCode: string | null;
  transactionDate: Date;
  cardBrand: string | null;
  cardType: string | null;
  grossAmountCents: number;
  actualFeeCents: number;
  actualFeeVatCents: number;
  actualTotalFeeCents: number;
  expectedFeeCents: number;
  expectedFeeVatCents: number;
  expectedTotalFeeCents: number;
  differenceCents: number; // actual - expected (>0 = sobrecobro)
  rateBpsApplied: number;
  vatBpsApplied: number;
  type: "OVERCHARGED" | "UNDERCHARGED" | "OK";
}

export interface CommissionAuditResult {
  totalAudited: number;
  totalGrossCents: number;
  totalActualFeeCents: number;
  totalExpectedFeeCents: number;
  totalFeeVatCents: number;
  totalOverchargeCents: number;
  discrepanciesCount: number;
  effectiveAvgRateBps: number;
  discrepancies: CommissionAuditDiscrepancy[];
}

/**
 * Auditoría matemática de comisiones: compara la comisión retenida por la pasarela
 * contra las tarifas pactadas en channel_commission_rates (MDR bps + IVA 16%).
 */
export async function auditGatewayCommissions(params: {
  companyId: string;
  branchId?: string;
  acquirer?: string;
  startDate?: string;
  endDate?: string;
}): Promise<CommissionAuditResult> {
  const { companyId, branchId, acquirer, startDate, endDate } = params;

  const conditions = [eq(gatewayTransactions.companyId, companyId)];
  if (branchId && branchId !== "ALL") {
    conditions.push(eq(gatewayTransactions.branchId, branchId));
  }
  if (acquirer && acquirer !== "ALL") {
    conditions.push(eq(gatewayTransactions.acquirer, acquirer as any));
  }
  if (startDate) {
    conditions.push(gte(gatewayTransactions.transactionDate, new Date(startDate)));
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(gatewayTransactions.transactionDate, end));
  }

  const [transactions, rateRows] = await Promise.all([
    db
      .select({
        id: gatewayTransactions.id,
        branchId: gatewayTransactions.branchId,
        externalId: gatewayTransactions.externalId,
        authorizationCode: gatewayTransactions.authorizationCode,
        transactionDate: gatewayTransactions.transactionDate,
        cardBrand: gatewayTransactions.cardBrand,
        cardType: gatewayTransactions.cardType,
        grossAmountCents: gatewayTransactions.grossAmountCents,
        feeAmountCents: gatewayTransactions.feeAmountCents,
        feeVatCents: gatewayTransactions.feeVatCents,
      })
      .from(gatewayTransactions)
      .where(and(...conditions))
      .orderBy(desc(gatewayTransactions.transactionDate)),

    db
      .select({
        channel: channelCommissionRates.channel,
        branchId: channelCommissionRates.branchId,
        rateBps: channelCommissionRates.rateBps,
        vatBps: channelCommissionRates.vatBps,
        effectiveFrom: channelCommissionRates.effectiveFrom,
      })
      .from(channelCommissionRates)
      .where(eq(channelCommissionRates.companyId, companyId))
      .orderBy(asc(channelCommissionRates.effectiveFrom)),
  ]);

  const ratesByKey = new Map<
    string,
    Array<{ effectiveFrom: string; rateBps: number; vatBps: number }>
  >();
  for (const r of rateRows) {
    const key = llaveTarifa(r.channel, r.branchId);
    const list = ratesByKey.get(key) ?? [];
    list.push({ effectiveFrom: r.effectiveFrom, rateBps: r.rateBps, vatBps: r.vatBps });
    ratesByKey.set(key, list);
  }

  const vigenciaPara = (channel: string, bId: string, businessDate: string) =>
    resolveRate(ratesByKey.get(llaveTarifa(channel, bId)) ?? [], businessDate) ??
    resolveRate(ratesByKey.get(llaveTarifa(channel, null)) ?? [], businessDate);

  let totalGrossCents = 0;
  let totalActualFeeCents = 0;
  let totalExpectedFeeCents = 0;
  let totalFeeVatCents = 0;
  let totalOverchargeCents = 0;
  const discrepancies: CommissionAuditDiscrepancy[] = [];

  for (const tx of transactions) {
    const dateStr = tx.transactionDate.toISOString().slice(0, 10);
    // Buscar tarifa para 'tpv' en la sucursal o grupo
    const rate = vigenciaPara("tpv", tx.branchId, dateStr);

    const rateBps = rate?.rateBps ?? 250; // Default 2.50% si no está configurada
    const vatBps = rate?.vatBps ?? 1600; // Default 16% IVA

    const expectedFeeCents = Math.round((tx.grossAmountCents * rateBps) / 10000);
    const expectedFeeVatCents = Math.round((expectedFeeCents * vatBps) / 10000);
    const expectedTotalFeeCents = expectedFeeCents + expectedFeeVatCents;
    const actualTotalFeeCents = tx.feeAmountCents + tx.feeVatCents;
    const differenceCents = actualTotalFeeCents - expectedTotalFeeCents;

    totalGrossCents += tx.grossAmountCents;
    totalActualFeeCents += actualTotalFeeCents;
    totalExpectedFeeCents += expectedTotalFeeCents;
    totalFeeVatCents += tx.feeVatCents;

    let type: "OVERCHARGED" | "UNDERCHARGED" | "OK" = "OK";
    if (differenceCents > 50) {
      type = "OVERCHARGED";
      totalOverchargeCents += differenceCents;
      discrepancies.push({
        transactionId: tx.id,
        externalId: tx.externalId,
        authorizationCode: tx.authorizationCode,
        transactionDate: tx.transactionDate,
        cardBrand: tx.cardBrand,
        cardType: tx.cardType,
        grossAmountCents: tx.grossAmountCents,
        actualFeeCents: tx.feeAmountCents,
        actualFeeVatCents: tx.feeVatCents,
        actualTotalFeeCents,
        expectedFeeCents,
        expectedFeeVatCents,
        expectedTotalFeeCents,
        differenceCents,
        rateBpsApplied: rateBps,
        vatBpsApplied: vatBps,
        type,
      });
    } else if (differenceCents < -50) {
      type = "UNDERCHARGED";
      discrepancies.push({
        transactionId: tx.id,
        externalId: tx.externalId,
        authorizationCode: tx.authorizationCode,
        transactionDate: tx.transactionDate,
        cardBrand: tx.cardBrand,
        cardType: tx.cardType,
        grossAmountCents: tx.grossAmountCents,
        actualFeeCents: tx.feeAmountCents,
        actualFeeVatCents: tx.feeVatCents,
        actualTotalFeeCents,
        expectedFeeCents,
        expectedFeeVatCents,
        expectedTotalFeeCents,
        differenceCents,
        rateBpsApplied: rateBps,
        vatBpsApplied: vatBps,
        type,
      });
    }
  }

  const effectiveAvgRateBps =
    totalGrossCents > 0
      ? Math.round((totalActualFeeCents / totalGrossCents) * 10000)
      : 0;

  return {
    totalAudited: transactions.length,
    totalGrossCents,
    totalActualFeeCents,
    totalExpectedFeeCents,
    totalFeeVatCents,
    totalOverchargeCents,
    discrepanciesCount: discrepancies.length,
    effectiveAvgRateBps,
    discrepancies,
  };
}

