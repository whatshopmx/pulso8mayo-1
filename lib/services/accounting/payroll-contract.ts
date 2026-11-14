import { assertCents, sumCents, type JournalSideLine } from "./amounts";

export type PayrollPlanInput =
  | { kind: "RECOGNITION"; baseSalaryCents: number; holidayPayCents: number;
      overtimePayCents: number; aguinaldoCents: number; propinasCents: number;
      totalPercepcionesCents: number; totalDeduccionesCents: number }
  | { kind: "PAYMENT"; amountCents: number; netCents: number; paidCents: number };

export type PayrollRole = "PAYROLL_EXPENSE" | "TIPS_PAYABLE" | "PAYROLL_PAYABLE"
  | "PAYROLL_DEDUCTIONS" | "PAYMENT_SOURCE";

/** Never infer zero deductions from an absent amount. */
export function payrollNetCents(receipt: { totalPercepcionesCents: number; totalDeduccionesCents: number }): number {
  const gross = assertCents(receipt.totalPercepcionesCents), deductions = assertCents(receipt.totalDeduccionesCents);
  if (deductions > gross) throw new RangeError("Las deducciones exceden las percepciones documentadas.");
  return gross - deductions;
}

/** Amounts only: adapters must verify confirmation, source ownership and frozen obligations.
 * Employer charges estimated by labor-cost-service are not documented payroll amounts.
 */
export function payrollPlan(input: PayrollPlanInput): (JournalSideLine & { role: PayrollRole })[] {
  const lines: (JournalSideLine & { role: PayrollRole })[] = [];
  const add = (role: PayrollRole, amount: number, debit: boolean) => {
    if (amount) lines.push({ role, debitCents: debit ? amount : 0, creditCents: debit ? 0 : amount });
  };
  if (input.kind === "PAYMENT") {
    const amount = assertCents(input.amountCents), net = assertCents(input.netCents);
    const paid = assertCents(input.paidCents);
    if (!amount) throw new RangeError("El pago debe ser positivo.");
    if (paid > net || amount > net - paid) throw new RangeError("El pago excede el saldo de nómina reconocido.");
    add("PAYROLL_PAYABLE", amount, true);
    add("PAYMENT_SOURCE", amount, false);
    return lines;
  }
  const salary = sumCents([input.baseSalaryCents, input.holidayPayCents, input.overtimePayCents, input.aguinaldoCents]);
  const tips = assertCents(input.propinasCents), gross = assertCents(input.totalPercepcionesCents);
  const net = payrollNetCents(input), deductions = input.totalDeduccionesCents;
  if (!gross || sumCents([salary, tips]) !== gross) {
    throw new RangeError("Las percepciones documentadas no coinciden con sus componentes.");
  }
  add("PAYROLL_EXPENSE", salary, true);
  // Sales already credited this liability. Paying assigned tips must not create labor expense.
  add("TIPS_PAYABLE", tips, true);
  add("PAYROLL_PAYABLE", net, false);
  add("PAYROLL_DEDUCTIONS", deductions, false);
  return lines;
}
