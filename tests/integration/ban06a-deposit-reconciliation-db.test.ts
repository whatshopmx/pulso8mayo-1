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
  gatewayTransactions,
  users,
} from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  confirmDepositMatch,
  suggestDepositMatches,
} from "@/lib/services/bank-statement-service";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "company_bank_accounts",
    "bank_transactions",
    "gateway_transactions",
  ]);
});

function loadMigration(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertTestDbIsIsolated() {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );
}

it("BAN-06.a V2 (pulso_app): sugerir no confirma, valida destino/neto/empresa, depósito agrupado queda pendiente y repetición da 409", async () => {
  assertTestDbIsIsolated();

  const prevAccounting = process.env.ACCOUNTING_POSTING_ENABLED;
  process.env.ACCOUNTING_POSTING_ENABLED = "false";

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = `u-ban06a-a-${randomUUID()}`;
  const userB = `u-ban06a-b-${randomUUID()}`;

  const rollback = new Error("BAN-06.a rollback");
  const stmts = [
    ...loadMigration("drizzle/0167_sec05_tesoreria_rls.sql"),
    ...loadMigration("drizzle/0169_ban05_expected_income_identity.sql"),
  ];

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }

      await tx.insert(companies).values([
        { id: companyA, name: "Ban06a Co A" },
        { id: companyB, name: "Ban06a Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Suc A" },
        { id: branchB, companyId: companyB, name: "Suc B" },
      ]);
      await tx.insert(users).values([
        { id: userA, name: "Admin A", email: `${userA}@ban06a.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@ban06a.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);

      const [acctA1, acctA2] = await tx
        .insert(companyBankAccounts)
        .values([
          {
            companyId: companyA,
            label: "BBVA Recepción 1",
            accountNumber: "enc-a1",
            accountLastFour: "1001",
            accountFingerprint: `fp-ban06a-a1-${randomUUID()}`,
            bankCode: "012",
            bankName: "BBVA",
            purpose: "RECEPCION",
            registeredBy: userA,
          },
          {
            companyId: companyA,
            label: "HSBC Recepción 2",
            accountNumber: "enc-a2",
            accountLastFour: "2002",
            accountFingerprint: `fp-ban06a-a2-${randomUUID()}`,
            bankCode: "021",
            bankName: "HSBC",
            purpose: "RECEPCION",
            registeredBy: userA,
          },
        ])
        .returning({ id: companyBankAccounts.id });

      const [gwExact, gwWrongAcct, gwWrongNet, gwGroup1, gwGroup2] = await tx
        .insert(gatewayTransactions)
        .values([
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `ext-ok-${randomUUID()}`,
            transactionDate: new Date("2026-07-10T18:00:00Z"),
            settlementDate: "2026-07-11",
            grossAmountCents: 100_000,
            feeAmountCents: 3_600,
            feeVatCents: 576,
            netAmountCents: 95_824,
            destinationBankAccountId: acctA1.id,
            importedBy: userA,
          },
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `ext-wrong-acct-${randomUUID()}`,
            transactionDate: new Date("2026-07-10T18:10:00Z"),
            settlementDate: "2026-07-11",
            grossAmountCents: 100_000,
            feeAmountCents: 3_600,
            feeVatCents: 576,
            netAmountCents: 95_824,
            destinationBankAccountId: acctA2.id, // otra cuenta
            importedBy: userA,
          },
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `ext-wrong-net-${randomUUID()}`,
            transactionDate: new Date("2026-07-10T18:20:00Z"),
            settlementDate: "2026-07-11",
            grossAmountCents: 99_000,
            feeAmountCents: 3_564,
            feeVatCents: 570,
            netAmountCents: 94_866, // otro neto
            destinationBankAccountId: acctA1.id,
            importedBy: userA,
          },
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `ext-grp1-${randomUUID()}`,
            transactionDate: new Date("2026-07-15T12:00:00Z"),
            settlementDate: "2026-07-16",
            grossAmountCents: 42_000,
            feeAmountCents: 1_724,
            feeVatCents: 276,
            netAmountCents: 40_000,
            destinationBankAccountId: acctA2.id,
            importedBy: userA,
          },
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `ext-grp2-${randomUUID()}`,
            transactionDate: new Date("2026-07-15T13:00:00Z"),
            settlementDate: "2026-07-16",
            grossAmountCents: 63_000,
            feeAmountCents: 2_586,
            feeVatCents: 414,
            netAmountCents: 60_000,
            destinationBankAccountId: acctA2.id,
            importedBy: userA,
          },
        ])
        .returning({ id: gatewayTransactions.id });

      const [txExact, txGrouped] = await tx
        .insert(bankTransactions)
        .values([
          {
            companyId: companyA,
            sourceBankAccountId: acctA1.id,
            valueDate: "2026-07-11",
            description: "ABONO CLIP EXACTO",
            reference: "CLIP-1",
            amountCents: 95_824,
            fingerprint: `fp-ban06a-tx1-${randomUUID()}`,
            importedBy: userA,
          },
          {
            companyId: companyA,
            sourceBankAccountId: acctA2.id,
            valueDate: "2026-07-16",
            description: "ABONO AGRUPADO MP (40k + 60k)",
            reference: "MP-GRP-1",
            amountCents: 100_000,
            fingerprint: `fp-ban06a-tx2-${randomUUID()}`,
            importedBy: userA,
          },
        ])
        .returning({ id: bankTransactions.id });

      // Bajar a rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await setTenantContext(tx, { companyId: companyA, branchId: branchA });

      // 1. Sugerir NO confirma y marca explícitamente el depósito agrupado como GROUPED_DEPOSIT_UNSUPPORTED
      const suggestions = await suggestDepositMatches({ companyId: companyA }, tx);
      const exactSugg = suggestions.find((s) => s.transactionId === txExact.id)!;
      const groupedSugg = suggestions.find((s) => s.transactionId === txGrouped.id)!;

      expect(exactSugg.candidates.map((c) => c.gatewayTransactionId)).toEqual([gwExact.id]);
      expect(groupedSugg.candidates).toEqual([]);
      expect(groupedSugg.pendingReason).toBe("GROUPED_DEPOSIT_UNSUPPORTED");

      // Confirmar que sugerir no mutó ninguna fila
      const [stillUnmatched] = await tx
        .select({ matchStatus: bankTransactions.matchStatus })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, txExact.id));
      expect(stillUnmatched.matchStatus).toBe("UNMATCHED");

      // 2. Validaciones de cuenta destino y neto exacto (400)
      await expect(
        confirmDepositMatch(
          { companyId: companyA, transactionId: txExact.id, gatewayTransactionId: gwWrongAcct.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        confirmDepositMatch(
          { companyId: companyA, transactionId: txExact.id, gatewayTransactionId: gwWrongNet.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      // Intentar cruzar depósito agrupado contra una sola fila gateway -> 400 monto no exacto
      await expect(
        confirmDepositMatch(
          { companyId: companyA, transactionId: txGrouped.id, gatewayTransactionId: gwGroup1.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });
      void gwGroup2;

      // 3. Confirmación válida -> MATCHED y repetición devuelve 409 sin corromper
      await confirmDepositMatch(
        { companyId: companyA, transactionId: txExact.id, gatewayTransactionId: gwExact.id, userId: userA },
        tx
      );
      const [afterConfirm] = await tx
        .select({
          matchStatus: bankTransactions.matchStatus,
          matchedGatewayTransactionId: bankTransactions.matchedGatewayTransactionId,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, txExact.id));
      expect(afterConfirm).toEqual({
        matchStatus: "MATCHED",
        matchedGatewayTransactionId: gwExact.id,
      });

      await expect(
        confirmDepositMatch(
          { companyId: companyA, transactionId: txExact.id, gatewayTransactionId: gwExact.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      // El depósito agrupado sigue UNMATCHED explícitamente
      const [groupedStillPending] = await tx
        .select({ matchStatus: bankTransactions.matchStatus })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, txGrouped.id));
      expect(groupedStillPending.matchStatus).toBe("UNMATCHED");

      // 4. Aislamiento RLS: Empresa B no puede confirmar depósito de Empresa A (404)
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      await expect(
        confirmDepositMatch(
          { companyId: companyB, transactionId: txGrouped.id, gatewayTransactionId: gwGroup1.id, userId: userB },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 404 });

      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    if (prevAccounting === undefined) delete process.env.ACCOUNTING_POSTING_ENABLED;
    else process.env.ACCOUNTING_POSTING_ENABLED = prevAccounting;
  }

  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
});

it("BAN-06.a V2 (carrera concurrente real en PostgreSQL): dos depósitos simultáneos sobre la misma pasarela producen 1 ganador y 1 conflicto 409", async () => {
  assertTestDbIsIsolated();

  const prevAccounting = process.env.ACCOUNTING_POSTING_ENABLED;
  process.env.ACCOUNTING_POSTING_ENABLED = "false";

  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = `u-ban06a-race-${randomUUID()}`;
  let acctId = "";
  let gwId = "";
  let tx1Id = "";
  let tx2Id = "";

  try {
    await db.insert(companies).values({ id: companyId, name: "Ban06a Race Co" });
    await db.insert(branches).values({ id: branchId, companyId, name: "Branch Race" });
    await db.insert(users).values({
      id: userId,
      name: "Admin Race",
      email: `${userId}@ban06a.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
      companyId,
    });

    const [acct] = await db
      .insert(companyBankAccounts)
      .values({
        companyId,
        label: "BBVA Race Dep",
        accountNumber: "enc-race-dep",
        accountLastFour: "8888",
        accountFingerprint: `fp-race-dep-acct-${randomUUID()}`,
        bankCode: "012",
        bankName: "BBVA",
        purpose: "RECEPCION",
        registeredBy: userId,
      })
      .returning({ id: companyBankAccounts.id });
    acctId = acct.id;

    const [gw] = await db
      .insert(gatewayTransactions)
      .values({
        companyId,
        branchId,
        acquirer: "CLIP",
        externalId: `ext-race-${randomUUID()}`,
        transactionDate: new Date("2026-07-20T18:00:00Z"),
        settlementDate: "2026-07-21",
        grossAmountCents: 100_000,
        feeAmountCents: 3_600,
        feeVatCents: 576,
        netAmountCents: 95_824,
        destinationBankAccountId: acctId,
        importedBy: userId,
      })
      .returning({ id: gatewayTransactions.id });
    gwId = gw.id;

    const [t1, t2] = await db
      .insert(bankTransactions)
      .values([
        {
          companyId,
          sourceBankAccountId: acctId,
          valueDate: "2026-07-21",
          description: "ABONO RACE 1",
          reference: "RACE-DEP-1",
          amountCents: 95_824,
          fingerprint: `fp-race-dep1-${randomUUID()}`,
          importedBy: userId,
        },
        {
          companyId,
          sourceBankAccountId: acctId,
          valueDate: "2026-07-21",
          description: "ABONO RACE 2",
          reference: "RACE-DEP-2",
          amountCents: 95_824,
          fingerprint: `fp-race-dep2-${randomUUID()}`,
          importedBy: userId,
        },
      ])
      .returning({ id: bankTransactions.id });
    tx1Id = t1.id;
    tx2Id = t2.id;

    const race = await Promise.allSettled([
      confirmDepositMatch({ companyId, transactionId: tx1Id, gatewayTransactionId: gwId, userId }),
      confirmDepositMatch({ companyId, transactionId: tx2Id, gatewayTransactionId: gwId, userId }),
    ]);

    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = race.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ statusCode: 409 });

    const matched = await db
      .select({ id: bankTransactions.id })
      .from(bankTransactions)
      .where(eq(bankTransactions.matchedGatewayTransactionId, gwId));
    expect(matched).toHaveLength(1);
  } finally {
    if (prevAccounting === undefined) delete process.env.ACCOUNTING_POSTING_ENABLED;
    else process.env.ACCOUNTING_POSTING_ENABLED = prevAccounting;
    if (tx1Id || tx2Id) await db.delete(bankTransactions).where(eq(bankTransactions.companyId, companyId));
    if (gwId) await db.delete(gatewayTransactions).where(eq(gatewayTransactions.companyId, companyId));
    if (acctId) await db.delete(companyBankAccounts).where(eq(companyBankAccounts.id, acctId));
    await db.delete(users).where(eq(users.companyId, companyId));
    await db.delete(branches).where(eq(branches.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId))).toEqual([]);
  }
});
