import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  companies,
  payrollAdjustments,
  payrollLoanInstallments,
  payrollLoans,
  users,
} from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  isDraftInvalidatedByAdjustments,
  resolvePayrollAdjustmentsForPeriod,
} from "@/lib/services/payroll-adjustments-service";
import { resolvePayrollLoansForPeriod } from "@/lib/services/payroll-loans-service";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fixtures = { company: [string, string]; branch: [string, string]; user: [string, string] };

const MIGRATION_0165 = readFileSync("drizzle/0165_nom02_adjustments_and_loans.sql", "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

beforeAll(async () => {
  await provisionRuntimeRole(["companies", "branches", "users", "payroll_runs"]);
});

async function runWith0165(
  setup: (tx: Tx, f: Fixtures) => Promise<void>,
  check: (tx: Tx, f: Fixtures) => Promise<void>
) {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const f: Fixtures = {
    company: [randomUUID(), randomUUID()],
    branch: [randomUUID(), randomUUID()],
    user: [`u-${randomUUID()}`, `u-${randomUUID()}`],
  };
  const rollback = new Error("NOM-02.c2/d3 fixture rollback");

  try {
    await db.transaction(async (tx) => {
      for (const stmt of MIGRATION_0165) {
        await tx.execute(sql.raw(stmt));
      }
      await tx
        .insert(companies)
        .values(f.company.map((id) => ({ id, name: "Synthetic NOM-02.c2/d3 company" })));
      await tx
        .insert(branches)
        .values(f.branch.map((id, i) => ({ id, companyId: f.company[i], name: "Synthetic branch" })));
      await tx.insert(users).values(
        f.user.map((id, i) => ({
          id,
          name: "Synthetic employee",
          email: `${id}@nom02c2d3.test`,
          createdAt: new Date(),
          updatedAt: new Date(),
          companyId: f.company[i],
        }))
      );

      await setup(tx, f);

      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (
        await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      await check(tx, f);
      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }

  for (const id of f.company) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
}

it("NOM-02.c2 V2: bonos/incidencias aprobadas con RLS, idempotencia y cambio que invalida borrador", async () => {
  await runWith0165(
    async (tx, f) => {
      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      await tx.insert(payrollAdjustments).values([
        {
          companyId: f.company[0],
          branchId: f.branch[0],
          userId: f.user[0],
          periodStart: "2026-05-01",
          periodEnd: "2026-05-15",
          kind: "BONUS",
          conceptCode: "010",
          conceptName: "Premio puntualidad",
          amountCents: 100_000,
          taxTreatment: "FULLY_TAXABLE",
          exemptAmountCents: 0,
          status: "APPROVED",
          version: 1,
          idempotencyKey: "bono-mayo-1",
          approvedBy: f.user[0],
        },
        {
          companyId: f.company[0],
          branchId: f.branch[0],
          userId: f.user[0],
          periodStart: "2026-05-01",
          periodEnd: "2026-05-15",
          kind: "BONUS",
          conceptCode: "010",
          conceptName: "Bono pendiente",
          amountCents: 50_000,
          taxTreatment: "FULLY_TAXABLE",
          exemptAmountCents: 0,
          status: "PENDING",
          version: 1,
          idempotencyKey: "bono-mayo-pend",
        },
      ]);

      // Empresa 1 inserta bono propio (no debe ser visible para empresa 0)
      await setTenantContext(tx, { companyId: f.company[1], branchId: f.branch[1] });
      await tx.insert(payrollAdjustments).values({
        companyId: f.company[1],
        branchId: f.branch[1],
        userId: f.user[1],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        kind: "BONUS",
        conceptCode: "010",
        conceptName: "Bono ajeno",
        amountCents: 999_999,
        taxTreatment: "FULLY_TAXABLE",
        exemptAmountCents: 0,
        status: "APPROVED",
        version: 1,
        idempotencyKey: "bono-ajeno-1",
      });
    },
    async (tx, f) => {
      const first = await resolvePayrollAdjustmentsForPeriod({
        companyId: f.company[0],
        userId: f.user[0],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        dbInstance: tx,
      });
      expect(first.status).toBe("AVAILABLE");
      expect(first.approvedCount).toBe(1);
      expect(first.totalBonusAndEarningCents).toBe(100_000);
      expect(first.ignoredNonApprovedCount).toBe(1);

      // Empresa 0 no puede leer registros de empresa 1
      const cross = await resolvePayrollAdjustmentsForPeriod({
        companyId: f.company[1],
        userId: f.user[1],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        dbInstance: tx,
      });
      expect(cross.approvedCount).toBe(0);

      // Cambio posterior (actualización de versión e importe) invalida borrador
      await tx
        .update(payrollAdjustments)
        .set({ amountCents: 125_000, version: 2 })
        .where(eq(payrollAdjustments.idempotencyKey, "bono-mayo-1"));
      const afterEdit = await resolvePayrollAdjustmentsForPeriod({
        companyId: f.company[0],
        userId: f.user[0],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        dbInstance: tx,
      });
      expect(afterEdit.totalBonusAndEarningCents).toBe(125_000);
      expect(isDraftInvalidatedByAdjustments(first.fingerprint, afterEdit.fingerprint)).toBe(true);
    }
  );
});

it("NOM-02.d3 V2: préstamos con saldo, límite LFT 30%, bloqueo DB de doble cobro y aislamiento RLS", async () => {
  let loanIdA = "";
  await runWith0165(
    async (tx, f) => {
      await setTenantContext(tx, { companyId: f.company[0], branchId: f.branch[0] });
      const [loan] = await tx
        .insert(payrollLoans)
        .values({
          companyId: f.company[0],
          userId: f.user[0],
          loanType: "COMPANY_LOAN",
          satDeductionCode: "004",
          conceptName: "Préstamo autorizado",
          principalCents: 300_000,
          remainingBalanceCents: 200_000,
          installmentCents: 50_000,
          maxDeductionPct: 30,
          status: "ACTIVE",
          authorizedBy: f.user[0],
          reason: "Convenio firmado",
        })
        .returning({ id: payrollLoans.id });
      loanIdA = loan.id;

      await setTenantContext(tx, { companyId: f.company[1], branchId: f.branch[1] });
      await tx.insert(payrollLoans).values({
        companyId: f.company[1],
        userId: f.user[1],
        loanType: "COMPANY_LOAN",
        satDeductionCode: "004",
        conceptName: "Préstamo empresa 1",
        principalCents: 100_000,
        remainingBalanceCents: 100_000,
        installmentCents: 25_000,
        maxDeductionPct: 30,
        status: "ACTIVE",
        authorizedBy: f.user[1],
        reason: "Convenio empresa 1",
      });
    },
    async (tx, f) => {
      // 1. Primera lectura planea cuota de 50,000¢ (saldo 200,000 -> 150,000)
      const planned = await resolvePayrollLoansForPeriod({
        companyId: f.company[0],
        userId: f.user[0],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        periodGrossPayCents: 1_000_000,
        periodMinimumWageCents: 472_560,
        dbInstance: tx,
      });
      expect(planned.status).toBe("AVAILABLE");
      expect(planned.totalLoanDeductionsCents).toBe(50_000);
      expect(planned.deductions[0].balanceAfterCents).toBe(150_000);

      // 2. Registrar cuota APPLIED y comprobar que índice único impide doble cobro en DB
      await tx.insert(payrollLoanInstallments).values({
        companyId: f.company[0],
        loanId: loanIdA,
        userId: f.user[0],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        scheduledCents: 50_000,
        appliedCents: 50_000,
        balanceBeforeCents: 200_000,
        balanceAfterCents: 150_000,
        status: "APPLIED",
      });

      await tx.execute(sql.raw("SAVEPOINT dup_loan_installment"));
      let dupCode: string | undefined;
      try {
        await tx.insert(payrollLoanInstallments).values({
          companyId: f.company[0],
          loanId: loanIdA,
          userId: f.user[0],
          periodStart: "2026-05-01",
          periodEnd: "2026-05-15",
          scheduledCents: 50_000,
          appliedCents: 50_000,
          balanceBeforeCents: 150_000,
          balanceAfterCents: 100_000,
          status: "APPLIED",
        });
      } catch (err: unknown) {
        const e = err as { code?: string; cause?: { code?: string } };
        dupCode = e.code ?? e.cause?.code;
        await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT dup_loan_installment"));
      }
      expect(dupCode).toBe("23505");

      // 3. Re-evaluar el mismo período devuelve 0 y marca skippedAlreadyChargedCount = 1
      const repeated = await resolvePayrollLoansForPeriod({
        companyId: f.company[0],
        userId: f.user[0],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        periodGrossPayCents: 1_000_000,
        periodMinimumWageCents: 472_560,
        dbInstance: tx,
      });
      expect(repeated.totalLoanDeductionsCents).toBe(0);
      expect(repeated.skippedAlreadyChargedCount).toBe(1);

      // 4. Aislamiento RLS: empresa 0 no ve préstamos de empresa 1
      const cross = await resolvePayrollLoansForPeriod({
        companyId: f.company[1],
        userId: f.user[1],
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        periodGrossPayCents: 1_000_000,
        periodMinimumWageCents: 472_560,
        dbInstance: tx,
      });
      expect(cross.activeLoansCount).toBe(0);
    }
  );
});
