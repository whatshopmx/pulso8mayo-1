import { db } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import {
  dailySalesCuts,
  branchTerminals,
  tpvShiftBatches,
  users,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";

export interface TpvBatchInput {
  terminalId: string;
  batchNumber: string;
  cardAmountCents: number;
  tipAmountCents?: number;
  voucherPhotoUrl?: string | null;
  notes?: string | null;
}

export interface TpvBatchWithTerminal {
  id: string;
  companyId: string;
  branchId: string;
  salesCutId: string;
  terminalId: string;
  batchNumber: string;
  cardAmountCents: number;
  tipAmountCents: number;
  voucherPhotoUrl: string | null;
  notes: string | null;
  capturedBy: string | null;
  capturedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  terminal: {
    id: string;
    alias: string;
    serialNumber: string;
    acquirer: string;
    active: boolean;
  };
}

export interface TpvShiftReconciliation {
  salesCutId: string;
  businessDate: string;
  shift: string;
  branchId: string;
  posCardSalesCents: number;
  batchesTotalCardCents: number;
  batchesTotalTipCents: number;
  /** Diferencia: batchesTotalCardCents - posCardSalesCents. */
  varianceCents: number;
  /** "cuadrado" | "faltante" (en vouchers de terminal) | "sobrante" (en vouchers de terminal) */
  direction: "cuadrado" | "faltante" | "sobrante";
  isBalanced: boolean;
  activeTerminalsCount: number;
  capturedBatchesCount: number;
  hasMissingTerminals: boolean;
  missingTerminals: Array<{
    id: string;
    alias: string;
    serialNumber: string;
    acquirer: string;
  }>;
}

export interface GetShiftBatchesResult {
  cut: {
    id: string;
    companyId: string;
    branchId: string;
    businessDate: string;
    shift: string;
    totalSales: number;
    cardSales: number | null;
    status: string;
  };
  batches: TpvBatchWithTerminal[];
  terminals: Array<{
    id: string;
    alias: string;
    serialNumber: string;
    acquirer: string;
    active: boolean;
  }>;
  reconciliation: TpvShiftReconciliation;
}

export class TpvBatchService {
  /**
   * Obtiene los lotes registrados para un corte de venta junto con las terminales
   * activas de la sucursal y el resumen de cuadre contra la venta con tarjeta del POS.
   */
  static async getBatchesForCut(
    companyId: string,
    salesCutId: string
  ): Promise<GetShiftBatchesResult> {
    // 1. Obtener el corte de ventas
    const [cut] = await db
      .select({
        id: dailySalesCuts.id,
        companyId: dailySalesCuts.companyId,
        branchId: dailySalesCuts.branchId,
        businessDate: dailySalesCuts.businessDate,
        shift: dailySalesCuts.shift,
        totalSales: dailySalesCuts.totalSales,
        cardSales: dailySalesCuts.cardSales,
        status: dailySalesCuts.status,
      })
      .from(dailySalesCuts)
      .where(
        and(
          eq(dailySalesCuts.id, salesCutId),
          eq(dailySalesCuts.companyId, companyId)
        )
      )
      .limit(1);

    if (!cut) {
      throw ApiError.notFound("Corte de venta no encontrado.");
    }

    // 2. Obtener las terminales activas de la sucursal
    const terminals = await db
      .select({
        id: branchTerminals.id,
        alias: branchTerminals.alias,
        serialNumber: branchTerminals.serialNumber,
        acquirer: branchTerminals.acquirer,
        active: branchTerminals.active,
      })
      .from(branchTerminals)
      .where(
        and(
          eq(branchTerminals.companyId, companyId),
          eq(branchTerminals.branchId, cut.branchId),
          eq(branchTerminals.active, true)
        )
      );

    // 3. Obtener los lotes capturados para este corte
    const rawBatches = await db
      .select({
        id: tpvShiftBatches.id,
        companyId: tpvShiftBatches.companyId,
        branchId: tpvShiftBatches.branchId,
        salesCutId: tpvShiftBatches.salesCutId,
        terminalId: tpvShiftBatches.terminalId,
        batchNumber: tpvShiftBatches.batchNumber,
        cardAmountCents: tpvShiftBatches.cardAmountCents,
        tipAmountCents: tpvShiftBatches.tipAmountCents,
        voucherPhotoUrl: tpvShiftBatches.voucherPhotoUrl,
        notes: tpvShiftBatches.notes,
        capturedBy: tpvShiftBatches.capturedBy,
        capturedByName: users.name,
        createdAt: tpvShiftBatches.createdAt,
        updatedAt: tpvShiftBatches.updatedAt,
        terminalAlias: branchTerminals.alias,
        terminalSerial: branchTerminals.serialNumber,
        terminalAcquirer: branchTerminals.acquirer,
        terminalActive: branchTerminals.active,
      })
      .from(tpvShiftBatches)
      .innerJoin(
        branchTerminals,
        eq(tpvShiftBatches.terminalId, branchTerminals.id)
      )
      .leftJoin(users, eq(tpvShiftBatches.capturedBy, users.id))
      .where(
        and(
          eq(tpvShiftBatches.salesCutId, salesCutId),
          eq(tpvShiftBatches.companyId, companyId)
        )
      );

    const batches: TpvBatchWithTerminal[] = rawBatches.map((b) => ({
      id: b.id,
      companyId: b.companyId,
      branchId: b.branchId,
      salesCutId: b.salesCutId,
      terminalId: b.terminalId,
      batchNumber: b.batchNumber,
      cardAmountCents: b.cardAmountCents,
      tipAmountCents: b.tipAmountCents,
      voucherPhotoUrl: b.voucherPhotoUrl,
      notes: b.notes,
      capturedBy: b.capturedBy,
      capturedByName: b.capturedByName,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      terminal: {
        id: b.terminalId,
        alias: b.terminalAlias,
        serialNumber: b.terminalSerial,
        acquirer: b.terminalAcquirer,
        active: b.terminalActive,
      },
    }));

    // 4. Calcular reconciliación y terminales faltantes
    const posCardSalesCents = cut.cardSales ?? 0;
    const batchesTotalCardCents = batches.reduce(
      (sum, b) => sum + b.cardAmountCents,
      0
    );
    const batchesTotalTipCents = batches.reduce(
      (sum, b) => sum + b.tipAmountCents,
      0
    );
    const varianceCents = batchesTotalCardCents - posCardSalesCents;

    const direction: "cuadrado" | "faltante" | "sobrante" =
      varianceCents === 0
        ? "cuadrado"
        : varianceCents < 0
        ? "faltante"
        : "sobrante";

    const capturedTerminalIds = new Set(batches.map((b) => b.terminalId));
    const missingTerminals = terminals.filter(
      (t) => !capturedTerminalIds.has(t.id)
    );

    const reconciliation: TpvShiftReconciliation = {
      salesCutId: cut.id,
      businessDate: cut.businessDate,
      shift: cut.shift,
      branchId: cut.branchId,
      posCardSalesCents,
      batchesTotalCardCents,
      batchesTotalTipCents,
      varianceCents,
      direction,
      isBalanced: varianceCents === 0,
      activeTerminalsCount: terminals.length,
      capturedBatchesCount: batches.length,
      hasMissingTerminals: missingTerminals.length > 0,
      missingTerminals,
    };

    return {
      cut,
      batches,
      terminals,
      reconciliation,
    };
  }

  /**
   * Guarda o actualiza los lotes de terminales de un turno.
   * Valida pertenencia a la empresa/sucursal y realiza upsert por (salesCutId, terminalId).
   */
  static async saveBatches(params: {
    companyId: string;
    salesCutId: string;
    batches: TpvBatchInput[];
    userId: string;
  }): Promise<GetShiftBatchesResult> {
    const { companyId, salesCutId, batches, userId } = params;

    // 1. Obtener corte para verificar empresa y sucursal
    const [cut] = await db
      .select({
        id: dailySalesCuts.id,
        branchId: dailySalesCuts.branchId,
      })
      .from(dailySalesCuts)
      .where(
        and(
          eq(dailySalesCuts.id, salesCutId),
          eq(dailySalesCuts.companyId, companyId)
        )
      )
      .limit(1);

    if (!cut) {
      throw ApiError.notFound("Corte de venta no encontrado.");
    }

    if (!batches || batches.length === 0) {
      throw ApiError.badRequest("Debes proporcionar al menos un lote de terminal.");
    }

    // 2. Validar que cada terminal pertenece a esta sucursal y empresa
    for (const batch of batches) {
      if (!batch.terminalId) {
        throw ApiError.badRequest("El ID de la terminal es requerido.");
      }
      if (!batch.batchNumber || batch.batchNumber.trim() === "") {
        throw ApiError.badRequest("El folio/número de lote es requerido.");
      }
      if (batch.cardAmountCents === undefined || batch.cardAmountCents < 0) {
        throw ApiError.badRequest("El monto cobrado en tarjeta debe ser mayor o igual a cero.");
      }

      const [terminal] = await db
        .select({ id: branchTerminals.id })
        .from(branchTerminals)
        .where(
          and(
            eq(branchTerminals.id, batch.terminalId),
            eq(branchTerminals.companyId, companyId),
            eq(branchTerminals.branchId, cut.branchId)
          )
        )
        .limit(1);

      if (!terminal) {
        throw ApiError.badRequest(
          `La terminal ${batch.terminalId} no está autorizada para esta sucursal.`
        );
      }
    }

    // 3. Upsert de cada lote en transacción
    await db.transaction(async (tx) => {
      for (const b of batches) {
        const tipCents = b.tipAmountCents ?? 0;
        await tx
          .insert(tpvShiftBatches)
          .values({
            companyId,
            branchId: cut.branchId,
            salesCutId,
            terminalId: b.terminalId,
            batchNumber: b.batchNumber.trim(),
            cardAmountCents: Math.round(b.cardAmountCents),
            tipAmountCents: Math.round(tipCents),
            voucherPhotoUrl: b.voucherPhotoUrl || null,
            notes: b.notes?.trim() || null,
            capturedBy: userId,
          })
          .onConflictDoUpdate({
            target: [tpvShiftBatches.salesCutId, tpvShiftBatches.terminalId],
            set: {
              batchNumber: b.batchNumber.trim(),
              cardAmountCents: Math.round(b.cardAmountCents),
              tipAmountCents: Math.round(tipCents),
              voucherPhotoUrl: sql`coalesce(${b.voucherPhotoUrl ?? null}, ${tpvShiftBatches.voucherPhotoUrl})`,
              notes: b.notes !== undefined ? b.notes?.trim() || null : tpvShiftBatches.notes,
              capturedBy: userId,
              updatedAt: new Date(),
            },
          });
      }
    });

    // 4. Retornar el resultado recalculado
    return this.getBatchesForCut(companyId, salesCutId);
  }

  /**
   * Elimina un lote de terminal específico.
   */
  static async deleteBatch(
    companyId: string,
    salesCutId: string,
    batchId: string
  ): Promise<void> {
    const deleted = await db
      .delete(tpvShiftBatches)
      .where(
        and(
          eq(tpvShiftBatches.id, batchId),
          eq(tpvShiftBatches.salesCutId, salesCutId),
          eq(tpvShiftBatches.companyId, companyId)
        )
      )
      .returning({ id: tpvShiftBatches.id });

    if (deleted.length === 0) {
      throw ApiError.notFound("Lote de terminal no encontrado.");
    }
  }
}
