// KPIs gerenciales de Control OC/OS (finzasordenes.md §7, Task 10).
//
// Lee; no escribe. Cada KPI declara su base de cálculo para que la UI nunca
// tenga que adivinar si un número es medido o estimado (mismo criterio que
// `financial-kpi-service` con `LineSource`).
//
// Mes de atribución = mes de `created_at` del documento, igual que
// `budget-service.getCommitted` — no la fecha de aprobación ni la de pago.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { branchBudgets, branches, costCenters, purchaseOrders, serviceOrders } from "@/lib/db/schema";
import {
  OC_COMMITTING_STATUSES,
  OS_COMMITTING_STATUSES,
  getCommittedByPair,
} from "@/lib/services/budget-service";
import {
  aggregateBudgetExecution,
  computeBudgetExecution,
  computeEmergencyShare,
  DEFAULT_CONTROL_TARGETS,
  type BudgetExecutionRow,
  type ControlReportResult,
  type ControlTargets,
} from "@/lib/services/control-kpi-types";

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes del documento. Misma expresión que `budget-service`. */
const monthExpr = sql<string>`to_char(created_at, 'YYYY-MM')`;

export interface ControlReportFilter {
  companyId: string;
  /** "YYYY-MM". */
  month: string;
  /** Acota a una sucursal; `null`/ausente = toda la empresa. */
  branchId?: string | null;
}

interface CommitmentTotals {
  totalCents: number;
  totalCount: number;
  emergencyCents: number;
  emergencyCount: number;
}

const EMPTY_TOTALS: CommitmentTotals = {
  totalCents: 0,
  totalCount: 0,
  emergencyCents: 0,
  emergencyCount: 0,
};

/**
 * Comprometido del mes con su porción de emergencia, en DOS consultas
 * (una por tipo de documento). A diferencia de `getCommittedByPair`, aquí
 * NO se descartan los documentos sin centro de costo: el denominador del
 * % de emergencias es todo el gasto comprometido, esté atribuido o no.
 */
async function getCommitmentTotals(
  branchIds: string[],
  month: string,
): Promise<CommitmentTotals> {
  if (branchIds.length === 0) return EMPTY_TOTALS;

  const [osRows, ocRows] = await Promise.all([
    db
      .select({
        totalCents: sql<number>`coalesce(sum(${serviceOrders.amount}), 0)::int`,
        totalCount: sql<number>`count(*)::int`,
        emergencyCents: sql<number>`coalesce(sum(${serviceOrders.amount}) filter (where ${serviceOrders.urgency} = 'EMERGENCIA'), 0)::int`,
        emergencyCount: sql<number>`count(*) filter (where ${serviceOrders.urgency} = 'EMERGENCIA')::int`,
      })
      .from(serviceOrders)
      .where(
        and(
          inArray(serviceOrders.branchId, branchIds),
          inArray(serviceOrders.status, [...OS_COMMITTING_STATUSES]),
          sql`${monthExpr} = ${month}`,
        ),
      ),
    db
      .select({
        totalCents: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}), 0)::int`,
        totalCount: sql<number>`count(*)::int`,
        emergencyCents: sql<number>`coalesce(sum(${purchaseOrders.totalAmount}) filter (where ${purchaseOrders.purchaseType} = 'EMERGENCIA'), 0)::int`,
        emergencyCount: sql<number>`count(*) filter (where ${purchaseOrders.purchaseType} = 'EMERGENCIA')::int`,
      })
      .from(purchaseOrders)
      .where(
        and(
          inArray(purchaseOrders.branchId, branchIds),
          inArray(purchaseOrders.status, [...OC_COMMITTING_STATUSES]),
          sql`${monthExpr} = ${month}`,
        ),
      ),
  ]);

  const sum = (key: keyof CommitmentTotals) =>
    Number(osRows[0]?.[key] ?? 0) + Number(ocRows[0]?.[key] ?? 0);

  return {
    totalCents: sum("totalCents"),
    totalCount: sum("totalCount"),
    emergencyCents: sum("emergencyCents"),
    emergencyCount: sum("emergencyCount"),
  };
}

/**
 * Reporte de control del mes: ejecución presupuestal por sucursal×centro y
 * porcentaje de compras de emergencia.
 *
 * El alcance de sucursal ya viene resuelto por el llamador (la ruta aplica el
 * pin de GERENTE/SUPERVISOR): aquí `branchId` se respeta tal cual.
 */
export async function getControlReport(
  filter: ControlReportFilter,
  targets: ControlTargets = DEFAULT_CONTROL_TARGETS,
): Promise<ControlReportResult> {
  const { companyId, month } = filter;
  const branchId = filter.branchId ?? null;

  const branchConditions = [eq(branches.companyId, companyId), eq(branches.active, true)];
  if (branchId) branchConditions.push(eq(branches.id, branchId));

  const [branchRows, ccRows] = await Promise.all([
    db
      .select({ id: branches.id, name: branches.name, code: branches.code })
      .from(branches)
      .where(and(...branchConditions))
      .orderBy(asc(branches.name)),
    db
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.companyId, companyId), eq(costCenters.active, true)))
      .orderBy(asc(costCenters.code)),
  ]);

  const branchIds = branchRows.map((b) => b.id);

  const [budgetRows, committedByPair, commitmentTotals] = await Promise.all([
    branchIds.length
      ? db
          .select({
            branchId: branchBudgets.branchId,
            costCenterId: branchBudgets.costCenterId,
            amount: branchBudgets.amount,
          })
          .from(branchBudgets)
          .where(and(inArray(branchBudgets.branchId, branchIds), eq(branchBudgets.month, month)))
      : Promise.resolve([]),
    getCommittedByPair(branchIds, month),
    getCommitmentTotals(branchIds, month),
  ]);

  const budgetByKey = new Map(
    budgetRows.map((r) => [`${r.branchId}:${r.costCenterId}`, r.amount]),
  );

  const rows: BudgetExecutionRow[] = branchRows.flatMap((b) =>
    ccRows.map((cc) => {
      const key = `${b.id}:${cc.id}`;
      const execution = computeBudgetExecution(
        budgetByKey.get(key) ?? null,
        committedByPair.get(key) ?? 0,
        targets,
      );
      return {
        branchId: b.id,
        branchName: b.name,
        branchCode: b.code,
        costCenterId: cc.id,
        costCenterCode: cc.code,
        costCenterName: cc.name,
        accountingLine: cc.accountingLine,
        ...execution,
      };
    }),
  );

  return {
    month,
    branchId,
    budgetExecution: {
      rows,
      totals: aggregateBudgetExecution(rows, targets),
    },
    emergencyShare: computeEmergencyShare(commitmentTotals, targets),
    targets,
  };
}
