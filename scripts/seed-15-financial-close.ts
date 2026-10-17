import "dotenv/config";
import { db } from "@/lib/db";
import {
  dailySalesCuts, salesCutCashiers, channelCommissionRates, aggregatorSettlements,
  payrollRuns, payrollPayslips, propinas, propinaAsignaciones, financialPeriods,
  paymentRuns, paymentRunItems, operatingExpenses, payees, payeeBankAccounts,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { localDateString } from "@/lib/workflows/today";
import { freezePnLPeriod } from "@/lib/services/pnl-snapshot-service";
import { computeClabeCheckDigit, validateClabe } from "@/lib/banking/clabe";
import { DekService } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { createHmac } from "node:crypto";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN, USER_SUPER_ADMIN } from "./seed-constants";

export async function main() {
  console.log("=== Phase 15: Conciliación, propinas, nómina y P&L ===");
  const now = new Date();
  const end = localDateString(new Date(now.getTime() - 86400000), "America/Mexico_City");
  const start = localDateString(new Date(now.getTime() - 7 * 86400000), "America/Mexico_City");
  await db.insert(channelCommissionRates).values([
    { companyId: COMPANY_ID, channel: "tpv", rateBps: 250, vatBps: 1600, effectiveFrom: start },
    { companyId: COMPANY_ID, channel: "rappi", rateBps: 2750, vatBps: 1600, effectiveFrom: start },
    { companyId: COMPANY_ID, branchId: DEMO_BRANCHES[1].id, channel: "rappi", rateBps: 2500, vatBps: 1600, effectiveFrom: start },
  ]);
  const [payroll] = await db.insert(payrollRuns).values({
    companyId: COMPANY_ID, periodStart: start, periodEnd: end, status: "DRAFT",
  }).returning();
  for (const [index, branch] of DEMO_BRANCHES.entries()) {
    const cuts = await db.select().from(dailySalesCuts).where(and(
      eq(dailySalesCuts.companyId, COMPANY_ID), eq(dailySalesCuts.branchId, branch.id),
    ));
    const cut = cuts.find((row) => row.businessDate === end);
    if (!cut) throw new Error("Falta el corte de ayer: ejecuta la fase 12.");
    const shortage = index === 0 ? 25000 : 0;
    const counted = Math.max(0, (cut.cashSales ?? 0) - shortage);
    await db.update(dailySalesCuts).set({
      cashCountedCents: counted, depositedCents: counted,
      status: shortage ? "PENDING_REVIEW" : "VALIDATED",
      validationNotes: shortage ? "Faltante de $250 pendiente de aclaración" : "Arqueo conciliado",
    }).where(eq(dailySalesCuts.id, cut.id));
    await db.insert(salesCutCashiers).values({
      salesCutId: cut.id, cashierName: "Responsable de turno", cashierUserId: branch.operatorId,
      declaredCashCents: counted, expectedCashCents: cut.cashSales, varianceCents: counted - (cut.cashSales ?? 0),
    });
    const poolCents = 18000;
    const [pool] = await db.insert(propinas).values({
      companyId: COMPANY_ID, branchId: branch.id, businessDate: end, shift: "COMPLETO",
      totalPoolCents: poolCents, distributedCents: poolCents, registeredBy: USER_ADMIN,
    }).returning();
    await db.insert(propinaAsignaciones).values({
      propinaId: pool.id, userId: branch.operatorId, hoursWorked: "8", points: "1",
      assignedAmountCents: poolCents,
    });
    await db.insert(payrollPayslips).values({
      runId: payroll.id, userId: branch.operatorId, baseSalaryCents: 350000,
      propinasCents: poolCents, totalPercepcionesCents: 368000, totalDeduccionesCents: 0,
    });
    const gross = Number((cut.aggregatorSales as Record<string, number> | null)?.rappi ?? 0);
    const commission = Math.round(gross * (index === 1 ? 0.25 : 0.275) * 1.16);
    await db.insert(aggregatorSettlements).values({
      companyId: COMPANY_ID, branchId: branch.id, channel: "rappi", periodStart: end, periodEnd: end,
      grossSalesCents: gross, commissionCents: commission, netDepositedCents: gross - commission,
      posSalesCents: gross, varianceCents: 0, status: "RECONCILED",
    });
  }
  await db.insert(financialPeriods).values({
    companyId: COMPANY_ID, year: Number(end.slice(0, 4)), month: Number(end.slice(5, 7)), status: "OPEN",
  });
  // Borrador para revisar; no afirma que el banco haya pagado ni crea CFDI.
  const expenses = await db.select().from(operatingExpenses).where(and(
    eq(operatingExpenses.companyId, COMPANY_ID), eq(operatingExpenses.status, "APPROVED"),
  ));
  const counterparties = await db.select().from(payees).where(eq(payees.companyId, COMPANY_ID));
  const dek = await DekService.getDek(COMPANY_ID);
  for (const [index, payee] of counterparties.entries()) {
    const first17 = `012180${String(index + 1).padStart(11, "0")}`;
    const clabe = first17 + computeClabeCheckDigit(first17);
    const validation = validateClabe(clabe);
    if (!validation.ok) throw new Error("CLABE sintética demo inválida");
    await db.insert(payeeBankAccounts).values({
      companyId: COMPANY_ID, payeeId: payee.id, clabe: encryptColumnWithDek(clabe, dek),
      clabeLast4: validation.last4, clabeFingerprint: createHmac("sha256", dek).update(clabe).digest("hex"),
      bankCode: validation.bankCode, bankName: validation.bankName, accountHolderName: payee.name,
      status: "VERIFIED", registeredBy: USER_ADMIN, verifiedBy: USER_SUPER_ADMIN,
      verifiedAt: now, verificationMethod: "DEMO_SYNTHETIC",
      notes: "Cuenta sintética de demostración, sin verificación ni conexión bancaria real.",
    });
  }
  const [run] = await db.insert(paymentRuns).values({
    companyId: COMPANY_ID, title: "Corrida demo por revisar", runDate: now,
    totalAmountCents: expenses.reduce((sum, row) => sum + row.amount, 0), preparedBy: USER_ADMIN,
  }).returning();
  if (expenses.length) await db.insert(paymentRunItems).values(expenses.map((expense) => ({
    paymentRunId: run.id, itemType: "OPERATING_EXPENSE" as const, referenceId: expense.id,
    amountCents: expense.amount, settlementStatus: "PENDING" as const,
  })));
  await freezePnLPeriod(COMPANY_ID, start, end, USER_ADMIN);
}
