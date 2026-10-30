import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { branches, costCenters, dailySalesCuts, operatingExpenses, pettyCashFunds, pettyCashTransactions } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import type { BranchScope } from "@/lib/branch-scope";
import { resolvePnlPeriod } from "./pnl-service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  // JavaScript accepts year 0000; PostgreSQL date does not.
  return value >= "0001-01-01" && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Fecha inválida.");
export const pnlDetailQuerySchema = z.object({
  branchId: z.uuid(), line: z.enum(["sales", "operatingExpenses", "pettyCash"]),
  startDate: day.optional(), endDate: day.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).refine(value => {
  const period = resolvePnlPeriod(value.startDate, value.endDate);
  return period.startDate <= period.endDate;
}, "El inicio no puede ser posterior al fin del periodo.");

type Input = z.input<typeof pnlDetailQuerySchema> & { companyId: string; scope: BranchScope };
type DetailRow = {
  total_count: number; total_cents: string; days: number;
  id: string | null; date: string; cents: string; label: string; status: string;
  cost_center: { id: string; code: string; name: string; accountingLine: string | null } | null;
};
function exactCents(value: string | number) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) throw ApiError.conflict("El importe excede el rango de centavos exactos.");
  return cents;
}

/** Read-only operational detail. No evidence URLs, payee data or bank numbers. */
export async function getPnlDetail(input: Input) {
  const p = pnlDetailQuerySchema.parse(input);
  if (input.scope.kind === "NONE" || (input.scope.kind === "BRANCH" && input.scope.branchId !== p.branchId)) {
    throw ApiError.forbidden("No tienes acceso a esta sucursal.");
  }
  const companyId = z.uuid().parse(input.companyId);
  const period = resolvePnlPeriod(p.startDate, p.endDate);
  const { startDate: from, endDate: to } = period;
  const costCenter = sql`CASE WHEN ${costCenters.id} IS NULL THEN NULL ELSE jsonb_build_object(
    'id', ${costCenters.id}, 'code', ${costCenters.code}, 'name', ${costCenters.name},
    'accountingLine', ${costCenters.accountingLine}) END`;
  const expenseDate = sql`COALESCE(${operatingExpenses.businessDate}, ${operatingExpenses.paidAt}::date,
    ${operatingExpenses.dueDate}, ${operatingExpenses.createdAt}::date)`;
  // Keep the exact eligibility/date base of getPnLByBranch, including pending cuts/expenses.
  const source = p.line === "sales" ? sql`
    SELECT ${dailySalesCuts.id}::text id, ${dailySalesCuts.businessDate}::text date,
      ${dailySalesCuts.totalSales}::bigint cents, concat('Corte · ', ${dailySalesCuts.shift}, ' · ', ${dailySalesCuts.channel}) label,
      ${dailySalesCuts.status}::text status, NULL::jsonb cost_center
    FROM ${dailySalesCuts} WHERE ${dailySalesCuts.companyId} = ${companyId} AND ${dailySalesCuts.branchId} = ${p.branchId}
      AND ${dailySalesCuts.businessDate} BETWEEN ${from}::date AND ${to}::date`
    : p.line === "operatingExpenses" ? sql`
    SELECT ${operatingExpenses.id}::text id, (${expenseDate})::text date, ${operatingExpenses.amount}::bigint cents,
      concat('Gasto · ', ${operatingExpenses.category}) label, ${operatingExpenses.status}::text status, ${costCenter} cost_center
    FROM ${operatingExpenses} LEFT JOIN ${costCenters} ON ${costCenters.id} = ${operatingExpenses.costCenterId}
      AND ${costCenters.companyId} = ${companyId}
    WHERE ${operatingExpenses.companyId} = ${companyId} AND ${operatingExpenses.branchId} = ${p.branchId}
      AND ${operatingExpenses.status} <> 'REJECTED' AND ${expenseDate} BETWEEN ${from}::date AND ${to}::date`
    : sql`
    SELECT ${pettyCashTransactions.id}::text id, ${pettyCashTransactions.createdAt}::date::text date,
      ${pettyCashTransactions.amount}::bigint cents, 'Salida de caja chica'::text label,
      ${pettyCashTransactions.type}::text status, ${costCenter} cost_center
    FROM ${pettyCashTransactions} INNER JOIN ${pettyCashFunds} ON ${pettyCashTransactions.fundId} = ${pettyCashFunds.id}
    LEFT JOIN ${costCenters} ON ${costCenters.id} = ${pettyCashTransactions.costCenterId} AND ${costCenters.companyId} = ${companyId}
    WHERE ${pettyCashFunds.companyId} = ${companyId} AND ${pettyCashFunds.branchId} = ${p.branchId}
      AND ${pettyCashTransactions.type} = 'OUT' AND ${pettyCashTransactions.createdAt}::date BETWEEN ${from}::date AND ${to}::date`;
  // One statement/snapshot for the full total and bounded page, even after the last page.
  const result = await db.execute<DetailRow>(sql`WITH source AS (${source}), totals AS (
    SELECT count(*)::int total_count, COALESCE(sum(cents), 0)::text total_cents, count(DISTINCT date)::int days FROM source
  ) SELECT totals.*, page.* FROM totals LEFT JOIN LATERAL (
    SELECT * FROM source ORDER BY date DESC, id DESC LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}
  ) page ON true WHERE EXISTS (
    SELECT 1 FROM ${branches} WHERE ${branches.id} = ${p.branchId} AND ${branches.companyId} = ${companyId}
  )`);
  const row = result.rows[0];
  if (!row) throw ApiError.notFound("Sucursal no encontrada.");
  const totalCount = Number(row.total_count);
  return {
    branchId: p.branchId, line: p.line, period, page: p.page, pageSize: p.pageSize,
    totalCount, totalCents: exactCents(row.total_cents), hasMore: p.page * p.pageSize < totalCount,
    source: totalCount > 0 ? "MEASURED" as const : "NO_DATA" as const,
    coveragePercent: totalCount === 0 ? 0 : p.line === "sales" ? Math.min(100, Math.round(Number(row.days) / period.days * 100)) : 100,
    items: result.rows.filter(item => item.id !== null).map(item => ({
      id: item.id!, date: item.date, cents: exactCents(item.cents), label: item.label,
      status: item.status, costCenter: item.cost_center,
    })),
  };
}
