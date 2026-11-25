import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bankTransactions,
  branches,
  companies,
  companyBankAccounts,
  paymentRunItems,
  paymentRuns,
  users,
} from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  approvePayrollSnapshot,
  createPayrollDraftSnapshot,
  stampApprovedPayrollSnapshot,
  type OrdinaryPayrollPayslipSnapshot,
} from "@/lib/services/payroll-snapshot-service";
import {
  listPayrollObligations,
  recordPayrollObligationPayment,
  syncPayrollObligationsFromApprovedSnapshot,
} from "@/lib/services/payroll-treasury-service";
import { confirmMatch, unmatchTransaction } from "@/lib/services/bank-statement-service";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "payroll_runs",
    "payroll_payslips",
    "cfdi_nomina_timbrados",
    "company_bank_accounts",
    "bank_transactions",
    "payment_runs",
    "payment_run_items",
  ]);
});

function loadMigration(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

function makePayslip(userId: string, name: string, rfc: string, netPayCents: number): OrdinaryPayrollPayslipSnapshot {
  const isr = 71_000;
  const imss = 20_500;
  const deducciones = isr + imss;
  const percepciones = netPayCents + deducciones;
  return {
    userId,
    employeeNumber: `EMP-${userId.slice(-4)}`,
    employeeName: name,
    rfc,
    curp: "FUNK671228MDFRRL01",
    nss: "12345678901",
    dailySalaryCents: 50_000,
    payableDays: 15,
    baseSalaryCents: percepciones,
    propinasCents: 0,
    holidayPayCents: 0,
    overtimePayCents: 0,
    vacationPrimeCents: 0,
    bonusesAndIncidencesCents: 0,
    isrRetenidoCents: isr,
    imssObreroCents: imss,
    loanDeductionsCents: 0,
    incidenceDeductionsCents: 0,
    totalPercepcionesCents: percepciones,
    totalDeduccionesCents: deducciones,
    netPayCents,
    employerSocialSecurityCents: 215_000,
    desglosePercepciones: [
      {
        earningTypeCode: "001",
        code: "001",
        concept: "Sueldos y salarios",
        taxedAmount: percepciones,
        exemptAmount: 0,
      },
    ],
    desgloseDeducciones: [
      { deductionTypeCode: "002", code: "002", concept: "ISR retenido", amount: isr },
      { deductionTypeCode: "001", code: "001", concept: "IMSS obrero", amount: imss },
    ],
    completeness: { canApprove: true, canStamp: true, blockingIssues: [], zeroJustifications: [] },
  };
}

it("NOM-05 V2 (pulso_app): obligación única por empleado/período, pago parcial, repetición idempotente, conciliación BAN-04 e independencia CFDI↔pago", async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const prevApiKey = process.env.FISCALAPI_API_KEY;
  process.env.FISCALAPI_API_KEY = prevApiKey || "nom05-sandbox-key";

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const emp1 = `u-nom05-1-${randomUUID()}`;
  const emp2 = `u-nom05-2-${randomUUID()}`;
  const userB = `u-nom05-b-${randomUUID()}`;

  const rollback = new Error("NOM-05 rollback");
  const stmts = [
    ...loadMigration("drizzle/0166_nom03_payroll_snapshot.sql"),
    ...loadMigration("drizzle/0167_sec05_tesoreria_rls.sql"),
    ...loadMigration("drizzle/0168_nom05_payroll_obligations.sql"),
  ];

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }

      await tx.insert(companies).values([
        { id: companyA, name: "Nom05 Co A" },
        { id: companyB, name: "Nom05 Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Branch A" },
        { id: branchB, companyId: companyB, name: "Branch B" },
      ]);
      await tx.insert(users).values([
        { id: emp1, name: "Ana Nómina", email: `${emp1}@nom05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: emp2, name: "Luis Nómina", email: `${emp2}@nom05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@nom05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);

      const [acctA] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyA,
          label: "BBVA Nómina A",
          accountNumber: "enc-nom05-a",
          accountLastFour: "4444",
          accountFingerprint: `fp-nom05-acct-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          registeredBy: emp1,
        })
        .returning({ id: companyBankAccounts.id });

      const [payRun1] = await tx
        .insert(paymentRuns)
        .values({
          companyId: companyA,
          branchId: branchA,
          title: "Dispersión Parcial 1",
          runDate: new Date("2026-07-15"),
          status: "PROCESSING",
          sourceAccount: "BBVA ****4444",
          sourceBankAccountId: acctA.id,
          preparedBy: emp1,
        })
        .returning({ id: paymentRuns.id });

      const [payItem1, payItem2] = await tx
        .insert(paymentRunItems)
        .values([
          {
            paymentRunId: payRun1.id,
            itemType: "PAYROLL",
            referenceId: emp1,
            amountCents: 300_000,
            settlementStatus: "CONFIRMED",
            settledAt: new Date("2026-07-15T12:00:00Z"),
            settledBy: emp1,
            settlementReference: "SPEI-NOM-P1",
          },
          {
            paymentRunId: payRun1.id,
            itemType: "PAYROLL",
            referenceId: emp1,
            amountCents: 358_500,
            settlementStatus: "CONFIRMED",
            settledAt: new Date("2026-07-16T12:00:00Z"),
            settledBy: emp1,
            settlementReference: "SPEI-NOM-P2",
          },
        ])
        .returning({ id: paymentRunItems.id });

      const [bankTx1, bankTx2] = await tx
        .insert(bankTransactions)
        .values([
          {
            companyId: companyA,
            sourceBankAccountId: acctA.id,
            valueDate: "2026-07-15",
            description: "SPEI NOMINA PARCIAL 1",
            reference: "SPEI-NOM-P1",
            amountCents: -300_000,
            fingerprint: `fp-nom05-bt1-${randomUUID()}`,
            importedBy: emp1,
          },
          {
            companyId: companyA,
            sourceBankAccountId: acctA.id,
            valueDate: "2026-07-16",
            description: "SPEI NOMINA PARCIAL 2",
            reference: "SPEI-NOM-P2",
            amountCents: -358_500,
            fingerprint: `fp-nom05-bt2-${randomUUID()}`,
            importedBy: emp1,
          },
        ])
        .returning({ id: bankTransactions.id });

      // Bajar a rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (
        await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      await setTenantContext(tx, { companyId: companyA, branchId: branchA });

      // 1. Crear y aprobar snapshot ordinario (sin timbrar CFDI todavía)
      const draft = await createPayrollDraftSnapshot(
        {
          companyId: companyA,
          periodStart: "2026-07-01",
          periodEnd: "2026-07-15",
          ruleVersions: {
            isrTableVersion: "RMF_2026_ANEXO_8_ART_96",
            imssRuleVersion: "LSS_2026_OBRERO_V1",
            umaDailyCents: 11_731,
          },
          payslips: [
            makePayslip(emp1, "Ana Nómina", "FUNK671228PH6", 658_500),
            makePayslip(emp2, "Luis Nómina", "GODE561231GR8", 500_000),
          ],
        },
        tx
      );

      // Borrador sin aprobar no genera obligaciones (409)
      await expect(
        syncPayrollObligationsFromApprovedSnapshot({ companyId: companyA, runId: draft.runId, createdBy: emp1 }, tx)
      ).rejects.toMatchObject({ statusCode: 409 });

      await approvePayrollSnapshot(
        {
          companyId: companyA,
          runId: draft.runId,
          approvedBy: emp1,
          expectedVersion: draft.snapshotVersion,
          currentFingerprint: draft.inputFingerprint,
        },
        tx
      );

      // 2. Sincronizar obligaciones desde snapshot aprobado -> 1 por empleado/período, sin exigir CFDI
      const firstSync = await syncPayrollObligationsFromApprovedSnapshot(
        { companyId: companyA, runId: draft.runId, createdBy: emp1 },
        tx
      );
      expect(firstSync.createdCount).toBe(2);
      expect(firstSync.existingCount).toBe(0);
      expect(firstSync.obligations).toHaveLength(2);

      // Repetir sincronización no duplica obligaciones
      const secondSync = await syncPayrollObligationsFromApprovedSnapshot(
        { companyId: companyA, runId: draft.runId, createdBy: emp1 },
        tx
      );
      expect(secondSync.createdCount).toBe(0);
      expect(secondSync.existingCount).toBe(2);

      const oblEmp1 = firstSync.obligations.find((o) => o.userId === emp1)!;
      expect(oblEmp1).toMatchObject({
        netAmountCents: 658_500,
        paidAmountCents: 0,
        remainingAmountCents: 658_500,
        paymentStatus: "OPEN",
        cfdiStatus: null,
        bankReconciledCents: 0,
        bankReconciliationStatus: "UNMATCHED",
      });

      // 3. Pago parcial de 300,000 centavos (CFDI sigue sin timbrar -> estados independientes)
      const partial = await recordPayrollObligationPayment(
        {
          companyId: companyA,
          obligationId: oblEmp1.id,
          paymentRunItemId: payItem1.id,
          amountCents: 300_000,
          idempotencyKey: "nom05-pay-1",
          actorId: emp1,
        },
        tx
      );
      expect(partial.idempotent).toBe(false);
      expect(partial.obligation).toMatchObject({
        netAmountCents: 658_500,
        paidAmountCents: 300_000,
        remainingAmountCents: 358_500,
        paymentStatus: "PARTIALLY_PAID",
        cfdiStatus: null,
      });

      // 4. Repetición idempotente del pago parcial conserva saldo exacto
      const repeated = await recordPayrollObligationPayment(
        {
          companyId: companyA,
          obligationId: oblEmp1.id,
          paymentRunItemId: payItem1.id,
          amountCents: 300_000,
          idempotencyKey: "nom05-pay-1",
          actorId: emp1,
        },
        tx
      );
      expect(repeated.idempotent).toBe(true);
      expect(repeated.obligation.paidAmountCents).toBe(300_000);
      expect(repeated.obligation.remainingAmountCents).toBe(358_500);

      // Sobrepago rechazado con 409
      await expect(
        recordPayrollObligationPayment(
          {
            companyId: companyA,
            obligationId: oblEmp1.id,
            paymentRunItemId: payItem2.id,
            amountCents: 400_000,
            idempotencyKey: "nom05-overpay",
            actorId: emp1,
          },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      // 5. Conciliación bancaria BAN-04 del primer pago parcial
      await confirmMatch(
        { companyId: companyA, transactionId: bankTx1.id, paymentRunItemId: payItem1.id, userId: emp1 },
        tx
      );
      const [afterPartialMatch] = await listPayrollObligations(
        { companyId: companyA, obligationId: oblEmp1.id },
        tx
      );
      expect(afterPartialMatch).toMatchObject({
        netAmountCents: 658_500,
        paidAmountCents: 300_000,
        remainingAmountCents: 358_500,
        paymentStatus: "PARTIALLY_PAID",
        bankReconciledCents: 300_000,
        bankReconciliationStatus: "PARTIALLY_RECONCILED",
        cfdiStatus: null,
      });

      // 6. Independencia CFDI ↔ pago: timbrar CFDI después del pago parcial no altera saldo ni estado de pago
      const cfdiUuid = "11111111-2222-4333-8444-555555555555";
      const okPacFetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          succeeded: true,
          data: { id: "inv-1", uuid: cfdiUuid, total: 6585, seal: "SELLO-NOM05", fechaTimbrado: "2026-07-16T10:00:00Z" },
        }),
        text: async () => "",
      })) as unknown as typeof fetch;

      await stampApprovedPayrollSnapshot(
        { companyId: companyA, runId: draft.runId, userId: emp1, performedBy: emp1 },
        { dbInstance: tx, fetchImpl: okPacFetch }
      );

      // Liquidar saldo restante (358,500) y conciliar contra banco
      const finalPay = await recordPayrollObligationPayment(
        {
          companyId: companyA,
          obligationId: oblEmp1.id,
          paymentRunItemId: payItem2.id,
          amountCents: 358_500,
          idempotencyKey: "nom05-pay-2",
          actorId: emp1,
        },
        tx
      );
      expect(finalPay.obligation).toMatchObject({
        netAmountCents: 658_500,
        paidAmountCents: 658_500,
        remainingAmountCents: 0,
        paymentStatus: "PAID",
        cfdiStatus: "TIMBRADO",
        cfdiUuid,
      });

      await confirmMatch(
        { companyId: companyA, transactionId: bankTx2.id, paymentRunItemId: payItem2.id, userId: emp1 },
        tx
      );
      const [fullyReconciled] = await listPayrollObligations(
        { companyId: companyA, obligationId: oblEmp1.id },
        tx
      );
      expect(fullyReconciled).toMatchObject({
        paymentStatus: "PAID",
        bankReconciledCents: 658_500,
        bankReconciliationStatus: "RECONCILED",
        cfdiStatus: "TIMBRADO",
        cfdiUuid,
      });

      // Deshacer conciliación del segundo movimiento bancario conserva pago PAID y CFDI TIMBRADO
      await unmatchTransaction({ companyId: companyA, transactionId: bankTx2.id }, tx);
      const [afterUnmatch] = await listPayrollObligations(
        { companyId: companyA, obligationId: oblEmp1.id },
        tx
      );
      expect(afterUnmatch).toMatchObject({
        paymentStatus: "PAID",
        paidAmountCents: 658_500,
        remainingAmountCents: 0,
        bankReconciledCents: 300_000,
        bankReconciliationStatus: "PARTIALLY_RECONCILED",
        cfdiStatus: "TIMBRADO",
        cfdiUuid,
      });

      // 7. Aislamiento RLS: Empresa B no ve ni puede pagar obligaciones de Empresa A
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      expect(await listPayrollObligations({ companyId: companyB, runId: draft.runId }, tx)).toEqual([]);
      await expect(
        recordPayrollObligationPayment(
          {
            companyId: companyB,
            obligationId: oblEmp1.id,
            paymentRunItemId: payItem1.id,
            amountCents: 1000,
            idempotencyKey: "cross-tenant-pay",
            actorId: userB,
          },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 404 });

      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    if (prevApiKey === undefined) delete process.env.FISCALAPI_API_KEY;
    else process.env.FISCALAPI_API_KEY = prevApiKey;
  }

  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
});
