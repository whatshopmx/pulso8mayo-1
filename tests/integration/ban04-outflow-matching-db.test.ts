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
import { confirmMatch, unmatchTransaction } from "@/lib/services/bank-statement-service";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "company_bank_accounts",
    "bank_transactions",
    "payment_runs",
    "payment_run_items",
  ]);
});

function loadMigration0167(): string[] {
  return readFileSync("drizzle/0167_sec05_tesoreria_rls.sql", "utf8")
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

it("BAN-04 V2 (RLS pulso_app): confirmar, repetir, deshacer sin alterar liquidación manual y aislar empresas", async () => {
  assertTestDbIsIsolated();

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = `u-ban04-a-${randomUUID()}`;
  const userB = `u-ban04-b-${randomUUID()}`;

  const rollback = new Error("BAN-04 rollback");
  const stmts = loadMigration0167();

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }

      await tx.insert(companies).values([
        { id: companyA, name: "Ban04 Co A" },
        { id: companyB, name: "Ban04 Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Branch A" },
        { id: branchB, companyId: companyB, name: "Branch B" },
      ]);
      await tx.insert(users).values([
        { id: userA, name: "Admin A", email: `${userA}@ban04.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@ban04.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);

      const [acctA] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyA,
          label: "BBVA A",
          accountNumber: "enc-a",
          accountLastFour: "1111",
          accountFingerprint: `fp-ban04-acct-a-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          registeredBy: userA,
        })
        .returning({ id: companyBankAccounts.id });

      const [runA] = await tx
        .insert(paymentRuns)
        .values({
          companyId: companyA,
          branchId: branchA,
          title: "Corrida BAN-04",
          runDate: new Date("2026-06-10"),
          status: "PROCESSING",
          sourceAccount: "BBVA ****1111",
          sourceBankAccountId: acctA.id,
          preparedBy: userA,
        })
        .returning({ id: paymentRuns.id });

      // Partida 1: PENDING (aún sin confirmación manual)
      const [pendingItem] = await tx
        .insert(paymentRunItems)
        .values({
          paymentRunId: runA.id,
          itemType: "INVOICE",
          referenceId: randomUUID(),
          amountCents: 150_000,
          settlementStatus: "PENDING",
        })
        .returning({ id: paymentRunItems.id });

      // Partida 2: CONFIRMED (confirmación manual con comprobante, distinta de conciliación bancaria)
      const [confirmedItem] = await tx
        .insert(paymentRunItems)
        .values({
          paymentRunId: runA.id,
          itemType: "INVOICE",
          referenceId: randomUUID(),
          amountCents: 150_000,
          settlementStatus: "CONFIRMED",
          settledAt: new Date("2026-06-10T15:00:00Z"),
          settledBy: userA,
          settlementReference: "SPEI-MANUAL-100",
        })
        .returning({ id: paymentRunItems.id });

      const [tx1, tx2] = await tx
        .insert(bankTransactions)
        .values([
          {
            companyId: companyA,
            sourceBankAccountId: acctA.id,
            valueDate: "2026-06-10",
            description: "SPEI PROVEEDOR 1",
            reference: "BANCO-REF-1",
            amountCents: -150_000,
            fingerprint: `fp-ban04-tx1-${randomUUID()}`,
            importedBy: userA,
          },
          {
            companyId: companyA,
            sourceBankAccountId: acctA.id,
            valueDate: "2026-06-11",
            description: "SPEI PROVEEDOR 2",
            reference: "BANCO-REF-2",
            amountCents: -150_000,
            fingerprint: `fp-ban04-tx2-${randomUUID()}`,
            importedBy: userA,
          },
        ])
        .returning({ id: bankTransactions.id });

      // Bajar a rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await setTenantContext(tx, { companyId: companyA, branchId: branchA });

      // 1. Partida PENDING no puede conciliarse contra banco (400)
      await expect(
        confirmMatch(
          { companyId: companyA, transactionId: tx1.id, paymentRunItemId: pendingItem.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      // 2. Confirmar cruce bancario sobre partida CONFIRMED -> MATCHED
      await confirmMatch(
        {
          companyId: companyA,
          transactionId: tx1.id,
          paymentRunItemId: confirmedItem.id,
          userId: userA,
          notes: "Cruce SPEI exacto",
        },
        tx
      );

      const [afterMatch] = await tx
        .select({
          matchStatus: bankTransactions.matchStatus,
          matchedPaymentRunItemId: bankTransactions.matchedPaymentRunItemId,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, tx1.id));
      expect(afterMatch).toEqual({
        matchStatus: "MATCHED",
        matchedPaymentRunItemId: confirmedItem.id,
      });

      // 3. Repetir cruce sobre mismo movimiento o sobre la misma partida con otro movimiento -> 409 Conflict
      await expect(
        confirmMatch(
          { companyId: companyA, transactionId: tx1.id, paymentRunItemId: confirmedItem.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 409 });
      await expect(
        confirmMatch(
          { companyId: companyA, transactionId: tx2.id, paymentRunItemId: confirmedItem.id, userId: userA },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      // 4. Deshacer cruce -> banco vuelve a UNMATCHED, pero liquidación manual en payment_run_items se conserva intacta
      await unmatchTransaction({ companyId: companyA, transactionId: tx1.id }, tx);

      const [afterUnmatchTx] = await tx
        .select({
          matchStatus: bankTransactions.matchStatus,
          matchedPaymentRunItemId: bankTransactions.matchedPaymentRunItemId,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, tx1.id));
      expect(afterUnmatchTx).toEqual({
        matchStatus: "UNMATCHED",
        matchedPaymentRunItemId: null,
      });

      const [itemAfterUnmatch] = await tx
        .select({
          settlementStatus: paymentRunItems.settlementStatus,
          settlementReference: paymentRunItems.settlementReference,
          amountCents: paymentRunItems.amountCents,
        })
        .from(paymentRunItems)
        .where(eq(paymentRunItems.id, confirmedItem.id));
      expect(itemAfterUnmatch).toEqual({
        settlementStatus: "CONFIRMED",
        settlementReference: "SPEI-MANUAL-100",
        amountCents: 150_000,
      });

      // Repetir deshacer falla con 409
      await expect(
        unmatchTransaction({ companyId: companyA, transactionId: tx1.id }, tx)
      ).rejects.toMatchObject({ statusCode: 409 });

      // 5. Aislamiento RLS: Empresa B no puede cruzar ni deshacer movimientos de Empresa A
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      await expect(
        confirmMatch(
          { companyId: companyB, transactionId: tx1.id, paymentRunItemId: confirmedItem.id, userId: userB },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 404 });

      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }

  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
});

it("BAN-04 V2 (carrera concurrente real en PostgreSQL): dos conexiones simultáneas producen 1 ganador y 1 conflicto 409", async () => {
  assertTestDbIsIsolated();

  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = `u-ban04-race-${randomUUID()}`;

  let acctId = "";
  let runId = "";
  let itemId = "";
  let tx1Id = "";
  let tx2Id = "";

  try {
    await db.insert(companies).values({ id: companyId, name: "Ban04 Race Co" });
    await db.insert(branches).values({ id: branchId, companyId, name: "Branch Race" });
    await db.insert(users).values({
      id: userId,
      name: "Admin Race",
      email: `${userId}@ban04.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
      companyId,
    });

    const [acct] = await db
      .insert(companyBankAccounts)
      .values({
        companyId,
        label: "BBVA Race",
        accountNumber: "enc-race",
        accountLastFour: "9999",
        accountFingerprint: `fp-race-acct-${randomUUID()}`,
        bankCode: "012",
        bankName: "BBVA",
        registeredBy: userId,
      })
      .returning({ id: companyBankAccounts.id });
    acctId = acct.id;

    const [run] = await db
      .insert(paymentRuns)
      .values({
        companyId,
        branchId,
        title: "Corrida Race",
        runDate: new Date("2026-06-12"),
        status: "PROCESSING",
        sourceAccount: "BBVA ****9999",
        sourceBankAccountId: acctId,
        preparedBy: userId,
      })
      .returning({ id: paymentRuns.id });
    runId = run.id;

    const [item] = await db
      .insert(paymentRunItems)
      .values({
        paymentRunId: runId,
        itemType: "INVOICE",
        referenceId: randomUUID(),
        amountCents: 250_000,
        settlementStatus: "CONFIRMED",
        settledAt: new Date("2026-06-12T12:00:00Z"),
        settledBy: userId,
        settlementReference: "SPEI-RACE-250",
      })
      .returning({ id: paymentRunItems.id });
    itemId = item.id;

    const [t1, t2] = await db
      .insert(bankTransactions)
      .values([
        {
          companyId,
          sourceBankAccountId: acctId,
          valueDate: "2026-06-12",
          description: "SPEI RACE 1",
          reference: "RACE-1",
          amountCents: -250_000,
          fingerprint: `fp-race-t1-${randomUUID()}`,
          importedBy: userId,
        },
        {
          companyId,
          sourceBankAccountId: acctId,
          valueDate: "2026-06-12",
          description: "SPEI RACE 2",
          reference: "RACE-2",
          amountCents: -250_000,
          fingerprint: `fp-race-t2-${randomUUID()}`,
          importedBy: userId,
        },
      ])
      .returning({ id: bankTransactions.id });
    tx1Id = t1.id;
    tx2Id = t2.id;

    // Carrera 1: dos movimientos compiten simultáneamente por la misma partida CONFIRMED
    const matchRace = await Promise.allSettled([
      confirmMatch({ companyId, transactionId: tx1Id, paymentRunItemId: itemId, userId }),
      confirmMatch({ companyId, transactionId: tx2Id, paymentRunItemId: itemId, userId }),
    ]);

    const matchWins = matchRace.filter((r) => r.status === "fulfilled");
    const matchLosses = matchRace.filter((r) => r.status === "rejected");
    expect(matchWins).toHaveLength(1);
    expect(matchLosses).toHaveLength(1);
    expect((matchLosses[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

    const matchedRows = await db
      .select({ id: bankTransactions.id, matchStatus: bankTransactions.matchStatus })
      .from(bankTransactions)
      .where(eq(bankTransactions.matchedPaymentRunItemId, itemId));
    expect(matchedRows).toHaveLength(1);
    const winnerTxId = matchedRows[0].id;

    // Carrera 2: dos deshacer simultáneos sobre el ganador -> 1 éxito y 1 conflicto 409
    const unmatchRace = await Promise.allSettled([
      unmatchTransaction({ companyId, transactionId: winnerTxId }),
      unmatchTransaction({ companyId, transactionId: winnerTxId }),
    ]);
    expect(unmatchRace.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(unmatchRace.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((unmatchRace.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
    });
  } finally {
    if (tx1Id || tx2Id) {
      await db.delete(bankTransactions).where(eq(bankTransactions.companyId, companyId));
    }
    if (runId) {
      await db.delete(paymentRunItems).where(eq(paymentRunItems.paymentRunId, runId));
      await db.delete(paymentRuns).where(eq(paymentRuns.id, runId));
    }
    if (acctId) {
      await db.delete(companyBankAccounts).where(eq(companyBankAccounts.id, acctId));
    }
    await db.delete(users).where(eq(users.companyId, companyId));
    await db.delete(branches).where(eq(branches.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId))).toEqual([]);
  }
});
