import { and, eq } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { branches, payrollPayslips, payrollRuns, users } from "@/lib/db/schema";
import type { withCompanyContext } from "@/lib/db/tenant-context";
import { buildPayrollSnapshot } from "./payroll-snapshot";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];

/** Locks authoritative receipts in the caller's tenant transaction; never accepts client amounts. */
export async function loadPayrollPaymentSnapshot(tx: Tx, companyId: string, runId: string) {
  const [run] = await tx.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId))).for("update");
  if (!run) throw ApiError.notFound("Corrida de nómina no encontrada");
  const rows = await tx.select({
    payslipId: payrollPayslips.id, employeeId: payrollPayslips.userId,
    employeeCompanyId: users.companyId, branchId: users.branchId, matchedBranchId: branches.id,
    cfdiUuid: payrollPayslips.cfdiUuid, cfdiStatus: payrollPayslips.cfdiStatus,
    baseSalaryCents: payrollPayslips.baseSalaryCents, holidayPayCents: payrollPayslips.holidayPayCents,
    overtimePayCents: payrollPayslips.overtimePayCents, aguinaldoCents: payrollPayslips.aguinaldoCents,
    propinasCents: payrollPayslips.propinasCents, totalPercepcionesCents: payrollPayslips.totalPercepcionesCents,
    totalDeduccionesCents: payrollPayslips.totalDeduccionesCents,
  }).from(payrollPayslips).leftJoin(users, eq(users.id, payrollPayslips.userId))
    .leftJoin(branches, and(eq(branches.id, users.branchId), eq(branches.companyId, companyId)))
    .where(eq(payrollPayslips.runId, run.id)).for("update", { of: payrollPayslips });
  const receipts = rows.map(({ employeeCompanyId, matchedBranchId, ...receipt }) => {
    if (employeeCompanyId !== companyId || (receipt.branchId && !matchedBranchId)) {
      throw ApiError.badRequest("La nómina contiene empleados o sucursales fuera de esta empresa; revisa los recibos.");
    }
    return receipt;
  });
  try { return buildPayrollSnapshot(companyId, run, receipts); }
  catch { throw ApiError.badRequest("La nómina debe estar completada, con recibos timbrados únicos e importes documentados consistentes."); }
}
