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
import { channelCommissionRates, dailySalesCuts, users } from "@/lib/db/schema";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import {
  COMMISSION_CHANNELS,
  MAX_RATE_BPS,
  commissionOf,
  commissionChannelLabel,
  formatRateBps,
  isCommissionChannel,
} from "@/lib/services/commission-types";
import type {
  BranchCommissions,
  ChannelCommission,
  CommissionRate,
  CommissionSource,
} from "@/lib/services/commission-types";

export type {
  BranchCommissions,
  ChannelCommission,
  CommissionRate,
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
      rateBps: channelCommissionRates.rateBps,
      effectiveFrom: channelCommissionRates.effectiveFrom,
      notes: channelCommissionRates.notes,
      createdByName: users.name,
      createdAt: channelCommissionRates.createdAt,
    })
    .from(channelCommissionRates)
    .leftJoin(users, eq(channelCommissionRates.createdBy, users.id))
    .where(eq(channelCommissionRates.companyId, companyId))
    .orderBy(asc(channelCommissionRates.channel), desc(channelCommissionRates.effectiveFrom));

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    rateBps: r.rateBps,
    effectiveFrom: r.effectiveFrom,
    notes: r.notes,
    createdByName: r.createdByName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface CreateRateInput {
  companyId: string;
  channel: string;
  rateBps: number;
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

  const [row] = await db
    .insert(channelCommissionRates)
    .values({
      companyId: input.companyId,
      channel: input.channel,
      rateBps: input.rateBps,
      effectiveFrom: input.effectiveFrom,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [
        channelCommissionRates.companyId,
        channelCommissionRates.channel,
        channelCommissionRates.effectiveFrom,
      ],
      set: {
        rateBps: input.rateBps,
        notes: input.notes ?? null,
        createdBy: input.createdBy,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    id: row.id,
    channel: row.channel,
    rateBps: row.rateBps,
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
  for (let i = rates.length - 1; i >= 0; i--) {
    if (rates[i].effectiveFrom <= businessDate) return rates[i].rateBps;
  }
  return null;
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
  /** Venta a la que SÍ se le pudo aplicar una tarifa (o conciliar una comisión). */
  coveredBaseCents: number;
  /** Venta que quedó sin valuar por no haber tarifa vigente en su fecha. */
  uncoveredBaseCents: number;
  measuredCents: number;
  estimatedCents: number;
  ratesApplied: Set<number>;
  cutsCount: number;
}

/**
 * Comisiones del período por sucursal y canal.
 *
 * Se resuelve en dos consultas (tarifas + cortes) y el cruce se hace en memoria:
 * la tarifa depende de la fecha de CADA corte, así que un `SUM` en SQL tendría
 * que unir por rango de vigencia y devolvería lo mismo con un plan peor. Para un
 * mes de una cadena de 15 sucursales son ~900 cortes.
 */
export async function getCommissionsByBranch(
  companyId: string,
  from: string,
  to: string,
): Promise<BranchCommissions[]> {
  const startDay = from.slice(0, 10);
  const endDay = to.slice(0, 10);

  const [rateRows, cuts] = await Promise.all([
    db
      .select({
        channel: channelCommissionRates.channel,
        rateBps: channelCommissionRates.rateBps,
        effectiveFrom: channelCommissionRates.effectiveFrom,
      })
      .from(channelCommissionRates)
      .where(eq(channelCommissionRates.companyId, companyId))
      .orderBy(asc(channelCommissionRates.effectiveFrom)),

    db
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
      ),
  ]);

  // Vigencias por canal, ya ordenadas ascendente por la consulta.
  const ratesByChannel = new Map<string, Array<{ effectiveFrom: string; rateBps: number }>>();
  for (const r of rateRows) {
    const list = ratesByChannel.get(r.channel) ?? [];
    list.push({ effectiveFrom: r.effectiveFrom, rateBps: r.rateBps });
    ratesByChannel.set(r.channel, list);
  }

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
      const acc = channels.get(channel) ?? {
        coveredBaseCents: 0,
        uncoveredBaseCents: 0,
        measuredCents: 0,
        estimatedCents: 0,
        ratesApplied: new Set<number>(),
        cutsCount: 0,
      };
      acc.cutsCount += 1;

      if (channel === "tpv" && cut.commissionCents !== null) {
        acc.measuredCents += cut.commissionCents;
        acc.coveredBaseCents += baseCents;
      } else {
        const rateBps = resolveRateBps(ratesByChannel.get(channel) ?? [], cut.businessDate);
        if (rateBps === null) {
          // Cubierto/no cubierto se acumula por CORTE y no por canal: una tarifa
          // que empieza a mitad del mes deja fuera sólo los cortes anteriores a
          // su vigencia, y marcar el canal entero como cubierto inflaría la
          // cobertura que el P&L usa para decidir si el renglón es confiable.
          acc.uncoveredBaseCents += baseCents;
        } else {
          acc.estimatedCents += commissionOf(baseCents, rateBps);
          acc.ratesApplied.add(rateBps);
          acc.coveredBaseCents += baseCents;
        }
      }

      channels.set(channel, acc);
    }
  }

  const result: BranchCommissions[] = [];

  for (const [branchId, channels] of byBranch) {
    const lines: ChannelCommission[] = [];
    let coveredSalesCents = 0;
    let uncoveredSalesCents = 0;
    let anyEstimated = false;
    let anyMeasured = false;

    for (const [channel, acc] of channels) {
      // El efectivo sin tarifa no es un hueco de información: es un canal que
      // no cobra comisión. Sólo los canales comisionables cuentan como venta
      // sin cubrir.
      if ((COMMISSION_BEARING as readonly string[]).includes(channel)) {
        uncoveredSalesCents += acc.uncoveredBaseCents;
      }

      const valued = acc.coveredBaseCents > 0 || acc.measuredCents !== 0;

      // Un canal sin tarifa y sin comisión capturada se OMITE del desglose: la
      // alternativa —listarlo en cero— se lee como "Rappi no nos cobró nada".
      if (!valued) continue;

      coveredSalesCents += acc.coveredBaseCents;

      const source: CommissionSource = acc.estimatedCents > 0 ? "ESTIMATED" : "MEASURED";
      if (source === "ESTIMATED") anyEstimated = true;
      else anyMeasured = true;

      lines.push({
        channel,
        // Sólo la venta valuada: así `comisión ≈ base × tarifa` se puede
        // verificar a mano desde la pantalla, que es el punto de publicarla.
        baseSalesCents: acc.coveredBaseCents,
        commissionCents: acc.measuredCents + acc.estimatedCents,
        measuredCents: acc.measuredCents,
        estimatedCents: acc.estimatedCents,
        rateBps: acc.ratesApplied.size === 1 ? [...acc.ratesApplied][0] : null,
        source,
        cutsCount: acc.cutsCount,
      });
    }

    lines.sort((a, b) => b.commissionCents - a.commissionCents);

    const totalCommissionCents = lines.reduce((s, l) => s + l.commissionCents, 0);
    const comisionable = coveredSalesCents + uncoveredSalesCents;
    const coveragePercent = comisionable > 0 ? (coveredSalesCents / comisionable) * 100 : 100;

    let source: BranchCommissions["source"];
    let note: string;

    if (lines.length === 0) {
      if (uncoveredSalesCents > 0) {
        source = "NO_DATA";
        note =
          "Hay venta por canales que cobran comisión (tarjeta o agregadores) y ninguna tarifa " +
          "configurada para el período. La comisión no se estima: configúrala en Comisiones por Canal.";
      } else {
        // Ni tarjeta ni agregadores en el período: no hay comisión que estimar
        // y decir NO_DATA aquí sería marcar como incompleto un renglón que está
        // completo en cero.
        source = "MEASURED";
        note = "Sin ventas por canales con comisión en el período (sólo mostrador).";
      }
    } else {
      source = anyEstimated ? "ESTIMATED" : "MEASURED";
      const detalle = lines
        .map(
          (l) =>
            `${commissionChannelLabel(l.channel)}${l.rateBps !== null ? ` ${formatRateBps(l.rateBps)}` : ""}`,
        )
        .join(", ");
      note =
        source === "MEASURED"
          ? `Comisión conciliada contra el depósito de la terminal en ${lines[0].cutsCount} corte(s).`
          : `Calculada con la tarifa vigente en la fecha de cada corte (${detalle}).` +
            (anyMeasured ? " Incluye comisiones ya conciliadas con la terminal." : "") +
            (uncoveredSalesCents > 0
              ? ` No cubre ${formatMXN(uncoveredSalesCents)} de venta en canales sin tarifa configurada.`
              : "");
    }

    result.push({
      branchId,
      channels: lines,
      totalCommissionCents,
      coveredSalesCents,
      uncoveredSalesCents,
      source,
      coveragePercent: Math.max(0, Math.min(100, Math.round(coveragePercent))),
      note,
    });
  }

  return result;
}

function formatMXN(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}
