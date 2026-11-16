import "dotenv/config";
import { db } from "@/lib/db";
import {
  dailySalesCuts, salesCutCashiers, channelCommissionRates, aggregatorSettlements,
  payrollRuns, payrollPayslips, propinas, propinaAsignaciones, financialPeriods,
  paymentRuns, paymentRunItems, operatingExpenses, payees, payeeBankAccounts,
  tenantOperatingConfig, imssFiles, imssMovements,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { localDateString } from "@/lib/workflows/today";
import { freezePnLPeriod } from "@/lib/services/pnl-snapshot-service";
import { computeClabeCheckDigit, validateClabe } from "@/lib/banking/clabe";
import { DekService } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { createHash, createHmac } from "node:crypto";
import { calculateEmployeePayroll } from "@/lib/services/payroll-service";
import {
  COMPANY_ID, BRANCH_CONDESA, DEMO_BRANCHES,
  USER_ADMIN, USER_SUPER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
} from "./seed-constants";

export async function main() {
  console.log("=== Phase 15: Conciliación, propinas, nómina, IMSS y P&L ===");
  const now = new Date();
  const end = localDateString(new Date(now.getTime() - 86400000), "America/Mexico_City");
  const start = localDateString(new Date(now.getTime() - 7 * 86400000), "America/Mexico_City");

  await db.delete(imssMovements).where(eq(imssMovements.companyId, COMPANY_ID));
  await db.delete(imssFiles).where(eq(imssFiles.companyId, COMPANY_ID));

  await db
    .insert(tenantOperatingConfig)
    .values({
      companyId: COMPANY_ID,
      laborBurdenFactorPercent: "28.00",
      payrollStateTaxPercent: "4.00",
      vatRatePercent: "16.00",
    })
    .onConflictDoUpdate({
      target: tenantOperatingConfig.companyId,
      set: {
        laborBurdenFactorPercent: "28.00",
        payrollStateTaxPercent: "4.00",
        vatRatePercent: "16.00",
        updatedAt: now,
      },
    });

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
    const payrollCalc = await calculateEmployeePayroll(branch.operatorId, start, end);
    await db.insert(payrollPayslips).values({
      runId: payroll.id, userId: branch.operatorId,
      baseSalaryCents: payrollCalc.baseSalaryCents,
      propinasCents: payrollCalc.propinasCents, holidayPayCents: payrollCalc.holidayPayCents,
      overtimePayCents: payrollCalc.overtimePayCents,
      totalPercepcionesCents: payrollCalc.totalPercepcionesCents,
      totalDeduccionesCents: payrollCalc.totalDeduccionesCents, cfdiStatus: "PENDIENTE",
    });
    const gross = Number((cut.aggregatorSales as Record<string, number> | null)?.rappi ?? 0);
    const commission = Math.round(gross * (index === 1 ? 0.25 : 0.275) * 1.16);
    await db.insert(aggregatorSettlements).values({
      companyId: COMPANY_ID, branchId: branch.id, channel: "rappi", periodStart: end, periodEnd: end,
      grossSalesCents: gross, commissionCents: commission, netDepositedCents: gross - commission,
      posSalesCents: gross, varianceCents: 0, status: "RECONCILED",
    });
  }

  for (const extraUserId of [USER_SUPERVISOR, USER_GERENTE]) {
    const payrollCalc = await calculateEmployeePayroll(extraUserId, start, end);
    await db.insert(payrollPayslips).values({
      runId: payroll.id,
      userId: extraUserId,
      baseSalaryCents: payrollCalc.baseSalaryCents,
      propinasCents: payrollCalc.propinasCents,
      holidayPayCents: payrollCalc.holidayPayCents,
      overtimePayCents: payrollCalc.overtimePayCents,
      totalPercepcionesCents: payrollCalc.totalPercepcionesCents,
      totalDeduccionesCents: payrollCalc.totalDeduccionesCents,
      cfdiStatus: "PENDIENTE",
    });
  }

  const [idseFile] = await db.insert(imssFiles).values({
    companyId: COMPANY_ID,
    branchId: BRANCH_CONDESA,
    layout: "IDSE",
    layoutVersion: "IDSE_2025_v1",
    movementType: "ALTA",
    fechaMovimiento: start,
    fileName: `IDSE_ALTA_${start}.txt`,
    contentSha256: createHash("sha256").update(`IDSE-DEMO-${COMPANY_ID}-${start}`).digest("hex"),
    lineCount: 3,
    status: "ACEPTADO",
    acuseFolio: "IDSE-2026-994812",
    acuseReceivedAt: now,
    contentUnavailable: true,
    generatedBy: USER_ADMIN,
  }).returning();

  await db.insert(imssMovements).values([
    {
      companyId: COMPANY_ID,
      userId: USER_EMPLEADO_1,
      fileId: idseFile.id,
      movementType: "ALTA",
      movementCode: "08",
      effectiveDate: "2024-01-15",
      registroPatronal: "Y60-12345-10-9",
      baseSalaryCents: 35000,
      sdiCents: 36726,
      status: "CONFIRMADO",
      confirmedAt: now,
    },
    {
      companyId: COMPANY_ID,
      userId: USER_EMPLEADO_2,
      fileId: idseFile.id,
      movementType: "ALTA",
      movementCode: "08",
      effectiveDate: "2024-03-01",
      registroPatronal: "Y60-12345-10-9",
      baseSalaryCents: 32000,
      sdiCents: 33578,
      status: "CONFIRMADO",
      confirmedAt: now,
    },
    {
      companyId: COMPANY_ID,
      userId: USER_EMPLEADO_3,
      fileId: idseFile.id,
      movementType: "ALTA",
      movementCode: "08",
      effectiveDate: "2024-06-10",
      registroPatronal: "Y60-12345-10-9",
      baseSalaryCents: 28000,
      sdiCents: 29380,
      status: "CONFIRMADO",
      confirmedAt: now,
    },
    {
      companyId: COMPANY_ID,
      userId: USER_SUPERVISOR,
      movementType: "MOD_SALARIO",
      movementCode: "07",
      effectiveDate: start,
      registroPatronal: "Y60-12345-10-9",
      baseSalaryCents: 60000,
      sdiCents: 62958,
      status: "PENDIENTE",
    },
  ]);

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
