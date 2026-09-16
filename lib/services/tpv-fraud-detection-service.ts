import { db } from "@/lib/db";
import {
  branches,
  branchTerminals,
  dailySalesCuts,
  tpvShiftBatches,
  gatewayTransactions,
} from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";

export type TpvFraudType =
  | "TPV_VOID_AFTER_CHARGE"
  | "TPV_EXCESSIVE_TIP"
  | "TPV_GHOST_TERMINAL";

export interface TpvFraudFinding {
  id: string;
  type: TpvFraudType;
  severity: "HIGH" | "MEDIUM";
  branchId: string;
  branchName: string;
  category: string;
  amountCents: number;
  description: string;
  detail: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CancelledTicketInput {
  ticketId: string;
  amountCents: number;
  cancelledAt: Date;
  branchId: string;
  branchName?: string;
}

export interface GatewayTransactionComparisonItem {
  id: string;
  grossAmountCents: number;
  transactionDate: Date;
  acquirer: string;
  authorizationCode?: string | null;
  externalId?: string | null;
  branchId: string;
  branchName?: string;
}

/**
 * Regla 1: Alerta de ticket cancelado en POS con cobro exitoso en terminal (±20 min).
 *
 * Evalúa si un ticket anulado en el punto de venta coincide en monto (±$1.00 MXN por redondeo)
 * y en tiempo (dentro de ±20 minutos) con un cobro exitoso registrado en pasarela o terminal.
 */
export function matchCancelledTicketWithGateway(
  ticket: CancelledTicketInput,
  transactions: GatewayTransactionComparisonItem[]
): TpvFraudFinding | null {
  const ticketTime = ticket.cancelledAt.getTime();
  const WINDOW_MS = 20 * 60 * 1000; // ±20 minutos

  for (const tx of transactions) {
    if (tx.branchId !== ticket.branchId) continue;

    const txTime = tx.transactionDate.getTime();
    const timeDelta = Math.abs(txTime - ticketTime);
    const amountDelta = Math.abs(tx.grossAmountCents - ticket.amountCents);

    // Mismo monto dentro de ±$1 MXN y dentro de ventana de 20 minutos
    if (timeDelta <= WINDOW_MS && amountDelta <= 100) {
      const auth = tx.authorizationCode ? `Aut: ${tx.authorizationCode}` : tx.externalId || "—";
      const minutesDiff = Math.round(timeDelta / 60000);

      return {
        id: `void-charge-${ticket.ticketId}-${tx.id}`,
        type: "TPV_VOID_AFTER_CHARGE",
        severity: "HIGH",
        branchId: ticket.branchId,
        branchName: ticket.branchName || "Sucursal",
        category: "Fraude TPV",
        amountCents: tx.grossAmountCents,
        description: `Posible cobro retenido con ticket cancelado (Ticket #${ticket.ticketId})`,
        detail:
          `El ticket #${ticket.ticketId} fue cancelado en el POS por $${(ticket.amountCents / 100).toFixed(2)} MXN, ` +
          `pero existe un cobro exitoso en ${tx.acquirer} (${auth}) por $${(tx.grossAmountCents / 100).toFixed(2)} MXN ` +
          `con solo ${minutesDiff} minuto(s) de diferencia. Verifica si el cliente pagó y el cajero anuló la comanda.`,
        createdAt: ticket.cancelledAt,
        metadata: {
          ticketId: ticket.ticketId,
          transactionId: tx.id,
          acquirer: tx.acquirer,
          authorizationCode: tx.authorizationCode,
          timeDeltaMs: timeDelta,
        },
      };
    }
  }

  return null;
}

/**
 * Escanea la operación de la empresa en busca de anomalías de fraude operativo TPV:
 * 1. Cancelaciones sospechosas post-cobro (tickets anulados vs. transacciones pasarela).
 * 2. Propinas desproporcionadas (>20% del consumo o sin venta en tarjeta).
 * 3. Terminales fantasma / no autorizadas (ventas en tarjeta sin terminal o que exceden lotes físicos).
 */
export async function detectTpvFraudFindings(
  companyId: string,
  branchId?: string,
  opts: { sinceDays?: number } = {}
): Promise<TpvFraudFinding[]> {
  const findings: TpvFraudFinding[] = [];
  const sinceDays = Math.max(1, opts.sinceDays ?? 30);
  const now = new Date();
  const desde = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const desdeStr = desde.toISOString().slice(0, 10);

  // 1. Obtener sucursales y terminales autorizadas
  const [terminalsList, cutsList, batchesList, gatewayList] = await Promise.all([
    db
      .select({
        id: branchTerminals.id,
        branchId: branchTerminals.branchId,
        alias: branchTerminals.alias,
        serialNumber: branchTerminals.serialNumber,
        acquirer: branchTerminals.acquirer,
        isActive: branchTerminals.active,
      })
      .from(branchTerminals)
      .where(
        and(
          eq(branchTerminals.companyId, companyId),
          branchId ? eq(branchTerminals.branchId, branchId) : undefined
        )
      ),

    db
      .select({
        id: dailySalesCuts.id,
        branchId: dailySalesCuts.branchId,
        branchName: branches.name,
        businessDate: dailySalesCuts.businessDate,
        shift: dailySalesCuts.shift,
        cardSales: dailySalesCuts.cardSales,
        totalSales: dailySalesCuts.totalSales,
        validationNotes: dailySalesCuts.validationNotes,
        createdAt: dailySalesCuts.createdAt,
      })
      .from(dailySalesCuts)
      .innerJoin(branches, eq(dailySalesCuts.branchId, branches.id))
      .where(
        and(
          eq(dailySalesCuts.companyId, companyId),
          gte(dailySalesCuts.businessDate, desdeStr),
          branchId ? eq(dailySalesCuts.branchId, branchId) : undefined
        )
      )
      .orderBy(desc(dailySalesCuts.businessDate)),

    db
      .select({
        id: tpvShiftBatches.id,
        salesCutId: tpvShiftBatches.salesCutId,
        branchId: tpvShiftBatches.branchId,
        branchName: branches.name,
        terminalId: tpvShiftBatches.terminalId,
        terminalAlias: branchTerminals.alias,
        batchNumber: tpvShiftBatches.batchNumber,
        cardAmountCents: tpvShiftBatches.cardAmountCents,
        tipsCents: tpvShiftBatches.tipAmountCents,
        voucherImageUrl: tpvShiftBatches.voucherPhotoUrl,
        capturedAt: tpvShiftBatches.createdAt,
        notes: tpvShiftBatches.notes,
      })
      .from(tpvShiftBatches)
      .innerJoin(branches, eq(tpvShiftBatches.branchId, branches.id))
      .leftJoin(branchTerminals, eq(tpvShiftBatches.terminalId, branchTerminals.id))
      .where(
        and(
          eq(tpvShiftBatches.companyId, companyId),
          gte(tpvShiftBatches.createdAt, desde),
          branchId ? eq(tpvShiftBatches.branchId, branchId) : undefined
        )
      )
      .orderBy(desc(tpvShiftBatches.createdAt)),

    db
      .select({
        id: gatewayTransactions.id,
        branchId: gatewayTransactions.branchId,
        branchName: branches.name,
        acquirer: gatewayTransactions.acquirer,
        externalId: gatewayTransactions.externalId,
        authorizationCode: gatewayTransactions.authorizationCode,
        grossAmountCents: gatewayTransactions.grossAmountCents,
        transactionDate: gatewayTransactions.transactionDate,
        status: gatewayTransactions.status,
      })
      .from(gatewayTransactions)
      .innerJoin(branches, eq(gatewayTransactions.branchId, branches.id))
      .where(
        and(
          eq(gatewayTransactions.companyId, companyId),
          gte(gatewayTransactions.transactionDate, desde),
          branchId ? eq(gatewayTransactions.branchId, branchId) : undefined
        )
      )
      .orderBy(desc(gatewayTransactions.transactionDate)),
  ]);

  // Terminales activas por sucursal
  const activeTerminalsByBranch = new Map<string, typeof terminalsList>();
  for (const t of terminalsList) {
    if (!t.isActive) continue;
    const list = activeTerminalsByBranch.get(t.branchId) ?? [];
    list.push(t);
    activeTerminalsByBranch.set(t.branchId, list);
  }

  // Lotes por corte
  const batchesByCut = new Map<string, typeof batchesList>();
  for (const b of batchesList) {
    const list = batchesByCut.get(b.salesCutId) ?? [];
    list.push(b);
    batchesByCut.set(b.salesCutId, list);
  }

  // -------------------------------------------------------------------------
  // REGLA 2: Propinas desproporcionadas en lotes físicos (>20% del consumo)
  // -------------------------------------------------------------------------
  for (const batch of batchesList) {
    const cardSales = batch.cardAmountCents;
    const tips = batch.tipsCents ?? 0;

    if (cardSales === 0 && tips > 0) {
      findings.push({
        id: `tip-no-sale-${batch.id}`,
        type: "TPV_EXCESSIVE_TIP",
        severity: "HIGH",
        branchId: batch.branchId,
        branchName: batch.branchName,
        category: "Propinas",
        amountCents: tips,
        description: `Propina registrada sin venta con tarjeta (Terminal: ${batch.terminalAlias || "Desconocida"})`,
        detail:
          `El lote ${batch.batchNumber} de la terminal ${batch.terminalAlias || "TPV"} registra ` +
          `$${(tips / 100).toFixed(2)} MXN en propinas sin reportar ningún monto de consumo en tarjeta ($0.00). ` +
          `Inconsistencia crítica en el cierre del lote.`,
        createdAt: batch.capturedAt,
        metadata: {
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          voucherImageUrl: batch.voucherImageUrl,
        },
      });
    } else if (cardSales > 0 && tips > 0) {
      const tipPercent = (tips / cardSales) * 100;
      if (tipPercent > 20) {
        findings.push({
          id: `tip-excess-${batch.id}`,
          type: "TPV_EXCESSIVE_TIP",
          severity: tipPercent > 35 ? "HIGH" : "MEDIUM",
          branchId: batch.branchId,
          branchName: batch.branchName,
          category: "Propinas",
          amountCents: tips,
          description: `Propina desproporcionada del ${tipPercent.toFixed(1)}% (Terminal: ${batch.terminalAlias || "Desconocida"})`,
          detail:
            `El lote ${batch.batchNumber} de la terminal ${batch.terminalAlias || "TPV"} registró ` +
            `$${(tips / 100).toFixed(2)} MXN en propinas para un consumo con tarjeta de $${(cardSales / 100).toFixed(2)} MXN ` +
            `(${tipPercent.toFixed(1)}% del consumo, superando el umbral normal del 20%). ` +
            `Verifica el voucher físico para descartar alteración de propina o jineteo de efectivo.`,
          createdAt: batch.capturedAt,
          metadata: {
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            cardSalesCents: cardSales,
            tipsCents: tips,
            tipPercent,
            voucherImageUrl: batch.voucherImageUrl,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // REGLA 3: Terminal fantasma / Cobros no respaldados por terminales del catálogo
  // -------------------------------------------------------------------------
  for (const cut of cutsList) {
    const cardSales = cut.cardSales ?? 0;
    if (cardSales <= 0) continue;

    const branchTerminalsActive = activeTerminalsByBranch.get(cut.branchId) ?? [];

    // Sub-caso A: La sucursal no tiene terminales autorizadas en el catálogo
    if (branchTerminalsActive.length === 0) {
      findings.push({
        id: `ghost-no-terminals-${cut.id}`,
        type: "TPV_GHOST_TERMINAL",
        severity: "HIGH",
        branchId: cut.branchId,
        branchName: cut.branchName,
        category: "Terminales Fantasma",
        amountCents: cardSales,
        description: `Venta con tarjeta sin terminales autorizadas en el catálogo`,
        detail:
          `El corte del ${cut.businessDate} (${cut.shift}) reportó $${(cardSales / 100).toFixed(2)} MXN en tarjeta, ` +
          `pero la sucursal ${cut.branchName} no tiene terminales físicas activas registradas en el catálogo. ` +
          `Posible uso de terminal personal o externa no autorizada.`,
        createdAt: cut.createdAt,
        metadata: {
          cutId: cut.id,
          businessDate: cut.businessDate,
          shift: cut.shift,
          cardSalesCents: cardSales,
        },
      });
      continue;
    }

    // Sub-caso B: Comparación contra lotes físicos capturados en el corte
    const batches = batchesByCut.get(cut.id) ?? [];
    const sumBatches = batches.reduce((s, b) => s + b.cardAmountCents, 0);

    if (batches.length === 0) {
      findings.push({
        id: `ghost-no-batches-${cut.id}`,
        type: "TPV_GHOST_TERMINAL",
        severity: "HIGH",
        branchId: cut.branchId,
        branchName: cut.branchName,
        category: "Terminales Fantasma",
        amountCents: cardSales,
        description: `Venta con tarjeta en POS sin vouchers de lote registrados`,
        detail:
          `El corte del ${cut.businessDate} (${cut.shift}) reporta $${(cardSales / 100).toFixed(2)} MXN con tarjeta, ` +
          `pero el gerente no capturó ningún voucher de cierre de lote físico. ` +
          `No hay respaldo de las terminales autorizadas para este turno.`,
        createdAt: cut.createdAt,
        metadata: {
          cutId: cut.id,
          businessDate: cut.businessDate,
          shift: cut.shift,
          cardSalesCents: cardSales,
        },
      });
    } else if (cardSales - sumBatches > 10000) {
      // Venta POS excede los lotes físicos por más de $100.00 MXN
      const diffCents = cardSales - sumBatches;
      findings.push({
        id: `ghost-variance-${cut.id}`,
        type: "TPV_GHOST_TERMINAL",
        severity: "HIGH",
        branchId: cut.branchId,
        branchName: cut.branchName,
        category: "Terminales Fantasma",
        amountCents: diffCents,
        description: `Venta POS excede en $${(diffCents / 100).toFixed(2)} MXN los lotes autorizados`,
        detail:
          `En el corte del ${cut.businessDate} (${cut.shift}), la venta con tarjeta en POS ($${(cardSales / 100).toFixed(2)} MXN) ` +
          `supera la suma de los lotes físicos autorizados ($${(sumBatches / 100).toFixed(2)} MXN). ` +
          `Faltante de $${(diffCents / 100).toFixed(2)} MXN sin voucher. Sospecha de cobros en terminal no autorizada.`,
        createdAt: cut.createdAt,
        metadata: {
          cutId: cut.id,
          businessDate: cut.businessDate,
          shift: cut.shift,
          posCardSalesCents: cardSales,
          batchesSumCents: sumBatches,
          differenceCents: diffCents,
        },
      });
    }
  }

  // Ordenar por severidad y fecha
  const severityOrder = { HIGH: 0, MEDIUM: 1 };
  findings.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );

  return findings;
}
