// lib/services/supplier-scorecard-service.ts
//
// Evaluación Integral y Scorecard Mensual de Proveedores (Módulo 0.3.3 / NOM-251).
// Ponderación de 3 pilares operativos:
//  1. Puntualidad (35%): fecha estimada de entrega (OC) vs fecha real de recepción.
//  2. Calidad y Cumplimiento (35%): tasa de entregas sin reclamos ni discrepancias de cantidad/daño.
//  3. Cadena de Frío NOM-251 (30%): tasa de lecturas de temperatura conformes en recepción.

import { db } from "@/lib/db";
import {
  suppliers,
  purchaseOrders,
  receivingReports,
  receivingReportItems,
  supplierClaims,
  temperatureLogs,
} from "@/lib/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { computeSupplierScorecard, type ScorecardTier } from "@/lib/inventory/supplier-scorecard";

export interface SupplierScorecardBreakdown {
  punctualityScore: number; // 0 - 100 (Weight: 35%)
  qualityScore: number;     // 0 - 100 (Weight: 35%)
  nom251ComplianceScore: number; // 0 - 100 (Weight: 30%)
  totalScore: number;       // 0 - 100
  tier: "EXCELENTE" | "ACEPTABLE" | "EN_RIESGO" | "CRITICO";
  stats: {
    totalOrders: number;
    onTimeDeliveries: number;
    lateDeliveries: number;
    punctualityRate: number; // %
    totalReceivings: number;
    flawlessReceivings: number;
    discrepancyCount: number;
    qualityRate: number; // %
    temperatureLogsCount: number;
    compliantTempCount: number;
    tempComplianceRate: number; // %
    totalClaimsCount: number;
  };
}

export class SupplierScorecardService {
  /**
   * Calcula el Scorecard del proveedor para una empresa en un rango de fechas.
   */
  static async calculateScorecard(
    companyId: string,
    supplierId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      branchId?: string;
    }
  ): Promise<SupplierScorecardBreakdown> {
    const startDate = options?.startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 días por default
    const endDate = options?.endDate ?? new Date();

    // 1. Órdenes de compra del proveedor
    const poConditions = [
      eq(purchaseOrders.companyId, companyId),
      eq(purchaseOrders.supplierId, supplierId),
      gte(purchaseOrders.createdAt, startDate),
      lte(purchaseOrders.createdAt, endDate),
    ];
    if (options?.branchId) {
      poConditions.push(eq(purchaseOrders.branchId, options.branchId));
    }

    const pos = await db
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
        dateOrdered: purchaseOrders.dateOrdered,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .where(and(...poConditions));

    // 2. Reportes de recepción del proveedor
    const receivingConditions = [
      eq(receivingReports.companyId, companyId),
      eq(receivingReports.supplierId, supplierId),
      gte(receivingReports.receivedAt, startDate),
      lte(receivingReports.receivedAt, endDate),
    ];
    if (options?.branchId) {
      receivingConditions.push(eq(receivingReports.branchId, options.branchId));
    }

    const receivings = await db
      .select({
        id: receivingReports.id,
        purchaseOrderId: receivingReports.purchaseOrderId,
        receivedAt: receivingReports.receivedAt,
      })
      .from(receivingReports)
      .where(and(...receivingConditions));

    // 3. Discrepancias en recepciones
    const receivingIds = receivings.map((r) => r.id);
    let discrepancyCount = 0;
    if (receivingIds.length > 0) {
      const discItems = await db
        .select({
          id: receivingReportItems.id,
          discrepancyType: receivingReportItems.discrepancyType,
        })
        .from(receivingReportItems)
        .where(
          and(
            sql`${receivingReportItems.receivingReportId} IN ${receivingIds}`,
            sql`${receivingReportItems.discrepancyType} <> 'NONE'`
          )
        );
      discrepancyCount = discItems.length;
    }

    // 4. Reclamos (Claims)
    const claimConditions = [
      eq(supplierClaims.companyId, companyId),
      eq(supplierClaims.supplierId, supplierId),
      gte(supplierClaims.createdAt, startDate),
      lte(supplierClaims.createdAt, endDate),
    ];
    if (options?.branchId) {
      claimConditions.push(eq(supplierClaims.branchId, options.branchId));
    }

    const claims = await db
      .select({
        id: supplierClaims.id,
        type: supplierClaims.type,
      })
      .from(supplierClaims)
      .where(and(...claimConditions));

    // 5. Lecturas de temperatura asociadas a las recepciones
    // Mapeadas por equipos o reportes en el rango
    const tempLogs = await db
      .select({
        id: temperatureLogs.id,
        isCompliant: temperatureLogs.isCompliant,
        readingValue: temperatureLogs.readingValue,
      })
      .from(temperatureLogs)
      .where(
        and(
          gte(temperatureLogs.timestamp, startDate),
          lte(temperatureLogs.timestamp, endDate),
          sql`${temperatureLogs.captureMethod} = 'RECEIVING' OR ${temperatureLogs.notes} LIKE ${'%' + supplierId + '%'}`
        )
      );

    // --- CÁLCULO DE PILARES ---
    let onTimeDeliveries = 0;
    let lateDeliveries = 0;

    for (const rec of receivings) {
      const matchingPo = pos.find((p) => p.id === rec.purchaseOrderId);
      if (matchingPo?.expectedDeliveryDate) {
        if (new Date(rec.receivedAt) <= new Date(matchingPo.expectedDeliveryDate)) {
          onTimeDeliveries++;
        } else {
          lateDeliveries++;
        }
      } else {
        onTimeDeliveries++;
      }
    }

    const totalFlaws = discrepancyCount + claims.length;
    const flawlessReceivings = Math.max(0, receivings.length - totalFlaws);
    const compliantTempCount = tempLogs.filter((t) => t.isCompliant).length;

    const scorecard = computeSupplierScorecard({
      onTimeDeliveries,
      totalDeliveries: onTimeDeliveries + lateDeliveries,
      flawlessReceivings,
      totalReceivings: receivings.length,
      claimsCount: claims.length,
      compliantTempReadings: compliantTempCount,
      totalTempReadings: tempLogs.length,
    });

    return {
      ...scorecard,
      stats: {
        totalOrders: pos.length,
        onTimeDeliveries,
        lateDeliveries,
        punctualityRate: scorecard.punctualityScore,
        totalReceivings: receivings.length,
        flawlessReceivings,
        discrepancyCount,
        qualityRate: scorecard.qualityScore,
        temperatureLogsCount: tempLogs.length,
        compliantTempCount,
        tempComplianceRate: scorecard.nom251ComplianceScore,
        totalClaimsCount: claims.length,
      },
    };
  }
}
