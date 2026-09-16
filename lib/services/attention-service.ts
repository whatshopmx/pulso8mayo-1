import { db } from "@/lib/db";
import { branches, dailySalesCuts } from "@/lib/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { detectViolations, type Violation } from "@/lib/services/control-interno-service";
import { getOperatingExpenses } from "@/lib/services/expense-service";
import { computeCashVariance, computeTpvVariance } from "@/lib/sales/cash-variance";
import { checkBudgetAvailability } from "@/lib/services/budget-service";

export type AttentionSourceType = "expense" | "cut_cash" | "cut_tpv" | "violation";
export type AttentionSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface AttentionItem {
  id: string;
  rawId: string;
  sourceType: AttentionSourceType;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  amountCents: number | null;
  href: string;
  branchName?: string;
  branchId?: string;
  dateOrAge?: string;
  category?: string;
  notes?: string;
  evidenceUrl?: string;
  requiredRole?: string;
  payeeName?: string;
  costCenterName?: string;
  costCenterCode?: string;
  costCenterId?: string;
  requestedByName?: string;
  budgetContext?: {
    budgetedCents: number;
    committedCents: number;
    availableCents: number;
    ok: boolean;
  };
  cutVariance?: {
    direction: "faltante" | "sobrante";
    varianceCents: number;
    cashSalesCents?: number | null;
    cashCountedCents?: number | null;
    shift?: string;
    businessDate?: string;
  };
  tpvVariance?: {
    direction: "faltante" | "sobrante";
    varianceCents: number;
    cardSalesCents?: number | null;
    tpvDepositCents?: number | null;
    commissionCents?: number | null;
    commissionCaptured: boolean;
    businessDate?: string;
  };
  violationMeta?: {
    ruleCode?: string;
    description?: string;
    severity?: string;
  };
}

export interface AttentionSummary {
  items: AttentionItem[];
  counts: {
    total: number;
    high: number;
    medium: number;
    low: number;
    expense: number;
    cutCash: number;
    cutTpv: number;
    violation: number;
  };
  sourceStatuses: {
    violations: "available" | "unavailable";
    expenses: "available" | "unavailable";
    cuts: "available" | "unavailable";
  };
}

const SEVERITY_ORDER: Record<AttentionSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function daysSince(isoOrDate: string | Date): number {
  const ms = Date.now() - new Date(isoOrDate).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Consulta y unifica todos los pendientes de la operación financiera ("Hoy"):
 * 1. Excepciones activas de control interno.
 * 2. Gastos en espera de autorización (filtrados directamente en SQL).
 * 3. Arqueos de caja y conciliaciones de tarjeta (TPV) desfasados en los últimos 60 días,
 *    evaluados sobre el universo completo sin límite arbitrario de 100 registros.
 */
export async function getAttentionSummary(
  companyId: string,
  branchId?: string | null
): Promise<AttentionSummary> {
  const collected: AttentionItem[] = [];
  const sourceStatuses = {
    violations: "available" as "available" | "unavailable",
    expenses: "available" as "available" | "unavailable",
    cuts: "available" as "available" | "unavailable",
  };

  // 1. Excepciones de control interno
  try {
    const violations = await detectViolations(companyId, branchId ?? undefined, { sinceDays: 30 });
    for (const v of violations) {
      collected.push({
        id: `violation-${v.id}`,
        rawId: v.id,
        sourceType: "violation",
        severity: v.severity,
        title: v.description,
        detail: `${v.branchName} · ${v.detail}`,
        amountCents: v.amountCents ?? null,
        href: `/dashboard/finance/control-interno?focus=${v.id}`,
        branchName: v.branchName,
        dateOrAge: v.createdAt ? daysSince(v.createdAt) + "d" : undefined,
        violationMeta: {
          ruleCode: v.type,
          description: v.description,
          severity: v.severity,
        },
      });
    }
  } catch (err) {
    console.error("[AttentionService] Error fetching violations:", err);
    sourceStatuses.violations = "unavailable";
  }

  // 2. Gastos pendientes de autorización (directo por status)
  try {
    const { items: expenses } = await getOperatingExpenses(
      companyId,
      branchId ?? undefined,
      { status: "PENDING_APPROVAL" }
    );

    const currentMonth = new Date().toISOString().slice(0, 7);

    for (const e of expenses) {
      const age = daysSince(e.createdAt);

      let budgetContext: AttentionItem["budgetContext"];
      if (e.branchId && e.costCenterId) {
        try {
          const avail = await checkBudgetAvailability(
            e.branchId,
            e.costCenterId,
            currentMonth,
            e.amountCents
          );
          budgetContext = {
            budgetedCents: avail.budgeted,
            committedCents: avail.committed,
            availableCents: avail.available,
            ok: avail.ok,
          };
        } catch {
          // Si no se puede verificar el presupuesto, el expediente funciona con datos disponibles
        }
      }

      collected.push({
        id: `expense-${e.id}`,
        rawId: e.id,
        sourceType: "expense",
        severity: age >= 2 ? "HIGH" : "MEDIUM",
        title: "Gasto pendiente de autorización",
        detail:
          `${e.branchName} · ${e.category}` +
          (age > 0 ? ` · lleva ${age} día${age === 1 ? "" : "s"} esperando` : " · capturado hoy"),
        amountCents: e.amountCents,
        href: `/dashboard/finance/expenses?focus=${e.id}`,
        branchName: e.branchName,
        branchId: e.branchId,
        dateOrAge: age > 0 ? `Hace ${age} días` : "Hoy",
        category: e.category,
        notes: e.description,
        evidenceUrl: e.evidenceUrl || undefined,
        requiredRole: e.requiredApproverRole,
        payeeName: e.payeeName || undefined,
        costCenterName: e.costCenterName || undefined,
        costCenterCode: e.costCenterCode || undefined,
        costCenterId: e.costCenterId || undefined,
        requestedByName: e.requestedByName || undefined,
        budgetContext,
      });
    }
  } catch (err) {
    console.error("[AttentionService] Error fetching pending expenses:", err);
    sourceStatuses.expenses = "unavailable";
  }

  // 3. Cortes de venta con varianza de efectivo o TPV (evaluados en ventana de 60 días sin truncar)
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const cuts = await db
      .select({
        id: dailySalesCuts.id,
        branchId: dailySalesCuts.branchId,
        branchName: branches.name,
        businessDate: dailySalesCuts.businessDate,
        shift: dailySalesCuts.shift,
        cashSales: dailySalesCuts.cashSales,
        cashCountedCents: dailySalesCuts.cashCountedCents,
        cardSales: dailySalesCuts.cardSales,
        tpvDepositCents: dailySalesCuts.tpvDepositCents,
        commissionCents: dailySalesCuts.commissionCents,
      })
      .from(dailySalesCuts)
      .innerJoin(branches, eq(dailySalesCuts.branchId, branches.id))
      .where(
        and(
          eq(dailySalesCuts.companyId, companyId),
          gte(dailySalesCuts.businessDate, sixtyDaysAgo),
          ...(branchId ? [eq(dailySalesCuts.branchId, branchId)] : [])
        )
      )
      .orderBy(desc(dailySalesCuts.businessDate));

    for (const c of cuts) {
      // Diferencia de efectivo (arqueo físico)
      const cashVar = computeCashVariance({
        cashSales: c.cashSales,
        cashCountedCents: c.cashCountedCents,
      });

      if (cashVar && cashVar.direction !== "cuadrado") {
        collected.push({
          id: `cut-cash-${c.id}`,
          rawId: c.id,
          sourceType: "cut_cash",
          severity: cashVar.direction === "faltante" ? "HIGH" : "MEDIUM",
          title: `Arqueo con ${cashVar.direction}`,
          detail: `${c.branchName} · corte del ${c.businessDate} (${c.shift})`,
          amountCents: cashVar.varianceCents,
          href: `/dashboard/sales?focus=${c.id}`,
          branchName: c.branchName,
          dateOrAge: c.businessDate,
          cutVariance: {
            direction: cashVar.direction,
            varianceCents: cashVar.varianceCents,
            cashSalesCents: c.cashSales,
            cashCountedCents: c.cashCountedCents,
            shift: c.shift,
            businessDate: c.businessDate,
          },
        });
      }

      // Diferencia de tarjeta / pasarela (TPV)
      const tpvVar = computeTpvVariance({
        cardSales: c.cardSales,
        tpvDepositCents: c.tpvDepositCents,
        commissionCents: c.commissionCents,
      });

      if (tpvVar && tpvVar.direction !== "cuadrado") {
        collected.push({
          id: `cut-tpv-${c.id}`,
          rawId: c.id,
          sourceType: "cut_tpv",
          severity: tpvVar.direction === "faltante" ? "HIGH" : "MEDIUM",
          title: `Depósito TPV con ${tpvVar.direction}`,
          detail: `${c.branchName} · corte del ${c.businessDate} (${tpvVar.commissionCaptured ? "comisión auditada" : "sin comisión"})`,
          amountCents: tpvVar.varianceCents,
          href: `/dashboard/sales?focus=${c.id}`,
          branchName: c.branchName,
          dateOrAge: c.businessDate,
          tpvVariance: {
            direction: tpvVar.direction,
            varianceCents: tpvVar.varianceCents,
            cardSalesCents: c.cardSales,
            tpvDepositCents: c.tpvDepositCents,
            commissionCents: c.commissionCents,
            commissionCaptured: tpvVar.commissionCaptured,
            businessDate: c.businessDate,
          },
        });
      }
    }
  } catch (err) {
    console.error("[AttentionService] Error fetching sales cut variances:", err);
    sourceStatuses.cuts = "unavailable";
  }

  // Ordenar por severidad y luego por monto descendente
  collected.sort((a, b) => {
    const bySev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySev !== 0) return bySev;
    return Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0);
  });

  const counts = {
    total: collected.length,
    high: collected.filter((i) => i.severity === "HIGH").length,
    medium: collected.filter((i) => i.severity === "MEDIUM").length,
    low: collected.filter((i) => i.severity === "LOW").length,
    expense: collected.filter((i) => i.sourceType === "expense").length,
    cutCash: collected.filter((i) => i.sourceType === "cut_cash").length,
    cutTpv: collected.filter((i) => i.sourceType === "cut_tpv").length,
    violation: collected.filter((i) => i.sourceType === "violation").length,
  };

  return {
    items: collected,
    counts,
    sourceStatuses,
  };
}
