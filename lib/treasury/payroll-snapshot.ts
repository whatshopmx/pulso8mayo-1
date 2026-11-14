import { z } from "zod";
import { payrollNetCents, payrollPlan } from "@/lib/services/accounting/payroll-contract";
import { MAX_CENTS, sumCents } from "@/lib/services/accounting/amounts";

const cents = z.number().int().min(0).max(MAX_CENTS);
const day = z.iso.date().refine(value => value >= "0001-01-01");
const receiptSchema = z.object({
  payslipId: z.uuid(), employeeId: z.string().min(1).max(256), branchId: z.uuid().nullable(),
  cfdiUuid: z.uuid().transform(value => value.toLowerCase()), cfdiStatus: z.literal("TIMBRADO"),
  baseSalaryCents: cents, holidayPayCents: cents, overtimePayCents: cents,
  aguinaldoCents: cents, propinasCents: cents, totalPercepcionesCents: cents,
  totalDeduccionesCents: cents,
}).strict().superRefine((receipt, ctx) => {
  try { payrollPlan({ kind: "RECOGNITION", ...receipt }); }
  catch { ctx.addIssue({ code: "custom", message: "El recibo no tiene componentes documentados consistentes." }); }
});
export type PayrollSnapshotReceipt = z.infer<typeof receiptSchema>;
const snapshotSchema = z.object({
  version: z.literal(1), companyId: z.uuid(), payrollRunId: z.uuid(),
  periodStart: day, periodEnd: day, netCents: cents,
  receipts: z.array(receiptSchema).min(1).max(10000),
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.periodEnd < snapshot.periodStart) ctx.addIssue({ code: "custom", message: "Periodo de nómina inválido." });
  for (const key of ["payslipId", "employeeId", "cfdiUuid"] as const) {
    if (new Set(snapshot.receipts.map(receipt => receipt[key])).size !== snapshot.receipts.length) {
      ctx.addIssue({ code: "custom", message: "La nómina contiene recibos, empleados o comprobantes repetidos." });
    }
  }
  try {
    if (sumCents(snapshot.receipts.map(payrollNetCents)) !== snapshot.netCents) {
      ctx.addIssue({ code: "custom", message: "El neto declarado no coincide con el reparto documentado." });
    }
  } catch { ctx.addIssue({ code: "custom", message: "El neto excede el rango seguro." }); }
});
export type PayrollPaymentSnapshot = z.infer<typeof snapshotSchema>;

/** Canonical order makes comparison independent of database row order. */
export function parsePayrollSnapshot(input: unknown): PayrollPaymentSnapshot {
  const snapshot = snapshotSchema.parse(input);
  snapshot.receipts.sort((a, b) => a.payslipId.localeCompare(b.payslipId));
  return snapshot;
}

export function buildPayrollSnapshot(companyId: string,
  run: { id: string; periodStart: string; periodEnd: string; status: string },
  receipts: readonly (Omit<PayrollSnapshotReceipt, "cfdiStatus"> & { cfdiStatus: string })[]): PayrollPaymentSnapshot {
  if (run.status !== "COMPLETED") throw new RangeError("Solo una nómina completada sin errores puede programarse automáticamente.");
  return parsePayrollSnapshot({ version: 1, companyId, payrollRunId: run.id,
    periodStart: run.periodStart, periodEnd: run.periodEnd,
    netCents: sumCents(receipts.map(payrollNetCents)), receipts });
}

export function samePayrollSnapshot(left: unknown, right: unknown): boolean {
  return JSON.stringify(parsePayrollSnapshot(left)) === JSON.stringify(parsePayrollSnapshot(right));
}
