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
  payeeBankAccounts,
  payees,
  paymentRunItems,
  paymentRuns,
  recurringContracts,
  recurringPayables,
  supplierBankAccounts,
  suppliers,
  users,
} from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "suppliers",
    "payees",
    "company_bank_accounts",
    "supplier_bank_accounts",
    "payee_bank_accounts",
    "bank_transactions",
    "payment_runs",
    "payment_run_items",
    "recurring_contracts",
    "recurring_payables",
  ]);
});

function loadMigration0167(): string[] {
  return readFileSync("drizzle/0167_sec05_tesoreria_rls.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

it("SEC-05.tesoreria V2: RLS fail-closed y aislamiento de 2 empresas en las 8 tablas de tesorería bajo pulso_app", async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = `u-sec05-a-${randomUUID()}`;
  const userB = `u-sec05-b-${randomUUID()}`;
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const payeeA = randomUUID();
  const payeeB = randomUUID();

  const rollback = new Error("SEC-05.tesoreria rollback");
  const stmts = loadMigration0167();

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }

      // Seed 2 empresas bajo rol dueño antes de bajar a pulso_app
      await tx.insert(companies).values([
        { id: companyA, name: "Sec05 Co A" },
        { id: companyB, name: "Sec05 Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Branch A" },
        { id: branchB, companyId: companyB, name: "Branch B" },
      ]);
      await tx.insert(users).values([
        { id: userA, name: "Admin A", email: `${userA}@sec05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@sec05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);
      await tx.insert(suppliers).values([
        { id: supplierA, companyId: companyA, name: "Supplier A" },
        { id: supplierB, companyId: companyB, name: "Supplier B" },
      ]);
      await tx.insert(payees).values([
        { id: payeeA, companyId: companyA, name: "Payee A" },
        { id: payeeB, companyId: companyB, name: "Payee B" },
      ]);

      const [acctA] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyA,
          label: "BBVA A",
          accountNumber: "enc-a",
          accountLastFour: "1111",
          accountFingerprint: `fp-acct-a-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          registeredBy: userA,
        })
        .returning({ id: companyBankAccounts.id });

      const [acctB] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyB,
          label: "BBVA B",
          accountNumber: "enc-b",
          accountLastFour: "2222",
          accountFingerprint: `fp-acct-b-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          registeredBy: userB,
        })
        .returning({ id: companyBankAccounts.id });

      await tx.insert(supplierBankAccounts).values([
        {
          companyId: companyA,
          supplierId: supplierA,
          clabe: "enc-clabe-a",
          clabeLast4: "1111",
          clabeFingerprint: `fp-sup-a-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          accountHolderName: "Supplier A",
          registeredBy: userA,
        },
        {
          companyId: companyB,
          supplierId: supplierB,
          clabe: "enc-clabe-b",
          clabeLast4: "2222",
          clabeFingerprint: `fp-sup-b-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          accountHolderName: "Supplier B",
          registeredBy: userB,
        },
      ]);

      await tx.insert(payeeBankAccounts).values([
        {
          companyId: companyA,
          payeeId: payeeA,
          clabe: "enc-payee-a",
          clabeLast4: "1111",
          clabeFingerprint: `fp-pay-a-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          accountHolderName: "Payee A",
          registeredBy: userA,
        },
        {
          companyId: companyB,
          payeeId: payeeB,
          clabe: "enc-payee-b",
          clabeLast4: "2222",
          clabeFingerprint: `fp-pay-b-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          accountHolderName: "Payee B",
          registeredBy: userB,
        },
      ]);

      await tx.insert(bankTransactions).values([
        {
          companyId: companyA,
          sourceBankAccountId: acctA.id,
          valueDate: "2026-06-01",
          description: "Tx A",
          amountCents: -100_000,
          fingerprint: `fp-tx-a-${randomUUID()}`,
          importedBy: userA,
        },
        {
          companyId: companyB,
          sourceBankAccountId: acctB.id,
          valueDate: "2026-06-01",
          description: "Tx B",
          amountCents: -200_000,
          fingerprint: `fp-tx-b-${randomUUID()}`,
          importedBy: userB,
        },
      ]);

      const [runA] = await tx
        .insert(paymentRuns)
        .values({
          companyId: companyA,
          branchId: branchA,
          title: "Run A",
          runDate: new Date("2026-06-05"),
          sourceAccount: "BBVA ****1111",
          sourceBankAccountId: acctA.id,
          preparedBy: userA,
        })
        .returning({ id: paymentRuns.id });

      const [runB] = await tx
        .insert(paymentRuns)
        .values({
          companyId: companyB,
          branchId: branchB,
          title: "Run B",
          runDate: new Date("2026-06-05"),
          sourceAccount: "BBVA ****2222",
          sourceBankAccountId: acctB.id,
          preparedBy: userB,
        })
        .returning({ id: paymentRuns.id });

      await tx.insert(paymentRunItems).values([
        { paymentRunId: runA.id, itemType: "INVOICE", referenceId: randomUUID(), amountCents: 100_000 },
        { paymentRunId: runB.id, itemType: "INVOICE", referenceId: randomUUID(), amountCents: 200_000 },
      ]);

      const [contractA] = await tx
        .insert(recurringContracts)
        .values({
          companyId: companyA,
          branchId: branchA,
          supplierId: supplierA,
          contractType: "RENTA",
          title: "Renta A",
          startDate: new Date("2026-01-01"),
          baseAmountCents: 500_000,
          createdBy: userA,
        })
        .returning({ id: recurringContracts.id });

      const [contractB] = await tx
        .insert(recurringContracts)
        .values({
          companyId: companyB,
          branchId: branchB,
          supplierId: supplierB,
          contractType: "RENTA",
          title: "Renta B",
          startDate: new Date("2026-01-01"),
          baseAmountCents: 600_000,
          createdBy: userB,
        })
        .returning({ id: recurringContracts.id });

      await tx.insert(recurringPayables).values([
        {
          companyId: companyA,
          contractId: contractA.id,
          supplierId: supplierA,
          label: "Renta A Jun",
          contractType: "RENTA",
          periodKey: "2026-06",
          dueDate: "2026-06-01",
          estimatedAmountCents: 500_000,
        },
        {
          companyId: companyB,
          contractId: contractB.id,
          supplierId: supplierB,
          label: "Renta B Jun",
          contractType: "RENTA",
          periodKey: "2026-06",
          dueDate: "2026-06-01",
          estimatedAmountCents: 600_000,
        },
      ]);

      // Bajar al rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (
        await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      // 1. Fail-closed sin contexto de empresa -> 0 filas en todas las tablas
      await tx.execute(sql`SELECT set_config('app.current_company_id', '', true)`);
      expect(await tx.select().from(companyBankAccounts)).toEqual([]);
      expect(await tx.select().from(bankTransactions)).toEqual([]);
      expect(await tx.select().from(paymentRuns)).toEqual([]);
      expect(await tx.select().from(paymentRunItems)).toEqual([]);

      // 2. Contexto Empresa A -> solo ve sus filas en las 8 tablas
      await setTenantContext(tx, { companyId: companyA, branchId: branchA });
      expect((await tx.select().from(companyBankAccounts)).map((r) => r.companyId)).toEqual([companyA]);
      expect((await tx.select().from(supplierBankAccounts)).map((r) => r.companyId)).toEqual([companyA]);
      expect((await tx.select().from(payeeBankAccounts)).map((r) => r.companyId)).toEqual([companyA]);
      expect((await tx.select().from(bankTransactions)).map((r) => r.companyId)).toEqual([companyA]);
      expect((await tx.select().from(paymentRuns)).map((r) => r.companyId)).toEqual([companyA]);
      expect((await tx.select().from(paymentRunItems)).map((r) => r.paymentRunId)).toEqual([runA.id]);
      expect((await tx.select().from(recurringContracts)).map((r) => r.companyId)).toEqual([companyA]);
      expect((await tx.select().from(recurringPayables)).map((r) => r.companyId)).toEqual([companyA]);

      // 3. Escrituras cruzadas rechazadas por RLS (42501)
      await tx.execute(sql.raw("SAVEPOINT sp_cross_item"));
      await expect(
        tx.insert(paymentRunItems).values({
          paymentRunId: runB.id,
          itemType: "INVOICE",
          referenceId: randomUUID(),
          amountCents: 1000,
        })
      ).rejects.toThrow();
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT sp_cross_item"));

      await tx.execute(sql.raw("SAVEPOINT sp_cross_tx"));
      await expect(
        tx.insert(bankTransactions).values({
          companyId: companyA,
          sourceBankAccountId: acctB.id,
          valueDate: "2026-06-02",
          description: "Cross bank account",
          amountCents: -1000,
          fingerprint: `fp-cross-${randomUUID()}`,
          importedBy: userA,
        })
      ).rejects.toThrow();
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT sp_cross_tx"));

      // 4. Contexto Empresa B -> solo ve sus filas
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      expect((await tx.select().from(paymentRuns)).map((r) => r.companyId)).toEqual([companyB]);
      expect((await tx.select().from(paymentRunItems)).map((r) => r.paymentRunId)).toEqual([runB.id]);
      expect((await tx.select().from(bankTransactions)).map((r) => r.companyId)).toEqual([companyB]);

      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }

  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
});
