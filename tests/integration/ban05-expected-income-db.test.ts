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
  dailySalesCuts,
  gatewayTransactions,
  users,
} from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import { createAndReconcileAggregatorSettlement } from "@/lib/services/aggregator-settlement-service";
import { listExpectedIncomes } from "@/lib/services/expected-income-service";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "company_bank_accounts",
    "bank_transactions",
    "daily_sales_cuts",
    "gateway_transactions",
    "aggregator_settlements",
  ]);
});

function loadMigration(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

it("BAN-05 V2 (pulso_app): corte, terminal y agregador conservan identidad/cuenta destino, separan SALE/SETTLEMENT/DEPOSIT y dejan ambigüedad pendiente", async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = `u-ban05-a-${randomUUID()}`;
  const userB = `u-ban05-b-${randomUUID()}`;

  const rollback = new Error("BAN-05 rollback");
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
        { id: companyA, name: "Ban05 Co A" },
        { id: companyB, name: "Ban05 Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Sucursal A" },
        { id: branchB, companyId: companyB, name: "Sucursal B" },
      ]);
      await tx.insert(users).values([
        { id: userA, name: "Admin A", email: `${userA}@ban05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@ban05.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);

      const [acctA] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyA,
          label: "BBVA Recepción A",
          accountNumber: "enc-ban05-a",
          accountLastFour: "5555",
          accountFingerprint: `fp-ban05-a-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          purpose: "RECEPCION",
          registeredBy: userA,
        })
        .returning({ id: companyBankAccounts.id });

      const [acctB] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyB,
          label: "BBVA Recepción B",
          accountNumber: "enc-ban05-b",
          accountLastFour: "6666",
          accountFingerprint: `fp-ban05-b-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          purpose: "RECEPCION",
          registeredBy: userB,
        })
        .returning({ id: companyBankAccounts.id });

      // 1. Corte POS (SALE)
      await tx.insert(dailySalesCuts).values({
        companyId: companyA,
        branchId: branchA,
        businessDate: "2026-07-10",
        shift: "COMPLETO",
        channel: "DELIVERY",
        source: "MANUAL_FORM",
        totalSales: "200000",
        cashSales: "0",
        cardSales: "0",
        aggregatorSales: { rappi: 200_000 },
        receivedBy: userA,
      });

      // 2. Terminal (SETTLEMENT -> una confirmada como DEPOSIT y dos empatadas ambiguas)
      const [gwMatched, gwTie1, gwTie2] = await tx
        .insert(gatewayTransactions)
        .values([
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `clip-ok-${randomUUID()}`,
            transactionDate: new Date("2026-07-10T18:00:00Z"),
            settlementDate: "2026-07-11",
            grossAmountCents: 100_000,
            feeAmountCents: 3_600,
            feeVatCents: 576,
            netAmountCents: 95_824,
            destinationBankAccountId: acctA.id,
            importedBy: userA,
          },
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `clip-tie1-${randomUUID()}`,
            transactionDate: new Date("2026-07-10T19:00:00Z"),
            settlementDate: "2026-07-11",
            grossAmountCents: 50_000,
            feeAmountCents: 1_800,
            feeVatCents: 288,
            netAmountCents: 47_912,
            destinationBankAccountId: acctA.id,
            importedBy: userA,
          },
          {
            companyId: companyA,
            branchId: branchA,
            acquirer: "CLIP",
            externalId: `clip-tie2-${randomUUID()}`,
            transactionDate: new Date("2026-07-10T19:05:00Z"),
            settlementDate: "2026-07-11",
            grossAmountCents: 50_000,
            feeAmountCents: 1_800,
            feeVatCents: 288,
            netAmountCents: 47_912,
            destinationBankAccountId: acctA.id,
            importedBy: userA,
          },
        ])
        .returning({ id: gatewayTransactions.id });

      // Depósito confirmado para gwMatched y depósito ambiguo para gwTie1/gwTie2
      await tx.insert(bankTransactions).values([
        {
          companyId: companyA,
          sourceBankAccountId: acctA.id,
          valueDate: "2026-07-11",
          description: "ABONO CLIP CONFIRMADO",
          reference: "CLIP-DEP-1",
          amountCents: 95_824,
          fingerprint: `fp-ban05-dep1-${randomUUID()}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwMatched.id,
          importedBy: userA,
        },
        {
          companyId: companyA,
          sourceBankAccountId: acctA.id,
          valueDate: "2026-07-11",
          description: "ABONO CLIP EMPATADO",
          reference: "CLIP-DEP-TIE",
          amountCents: 47_912,
          fingerprint: `fp-ban05-dep2-${randomUUID()}`,
          matchStatus: "UNMATCHED",
          importedBy: userA,
        },
      ]);

      // Bajar a rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (
        await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      await setTenantContext(tx, { companyId: companyA, branchId: branchA });

      // 3. Agregador con cuenta destino ajena (Empresa B) -> rechazado con 400
      await expect(
        createAndReconcileAggregatorSettlement(
          {
            companyId: companyA,
            branchId: branchA,
            channel: "Rappi",
            periodStart: "2026-07-10",
            periodEnd: "2026-07-10",
            grossSalesCents: 200_000,
            commissionCents: 50_000,
            netDepositedCents: 150_000,
            destinationBankAccountId: acctB.id,
          },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      // Agregador válido con cuenta destino propia
      const agg = await createAndReconcileAggregatorSettlement(
        {
          companyId: companyA,
          branchId: branchA,
          channel: "Rappi",
          periodStart: "2026-07-10",
          periodEnd: "2026-07-10",
          grossSalesCents: 200_000,
          commissionCents: 50_000,
          netDepositedCents: 150_000,
          destinationBankAccountId: acctA.id,
        },
        tx
      );
      expect(agg.destinationBankAccountId).toBe(acctA.id);

      // 4. Lectura unificada BAN-05
      const { records, depositEvaluations } = await listExpectedIncomes(
        { companyId: companyA, branchId: branchA, startDate: "2026-07-10", endDate: "2026-07-11" },
        tx
      );

      const cutRec = records.find((r) => r.sourceType === "SALES_CUT")!;
      const aggRec = records.find((r) => r.sourceType === "AGGREGATOR_SETTLEMENT")!;
      const depositedRec = records.find((r) => r.sourceId === gwMatched.id)!;
      const tieRec1 = records.find((r) => r.sourceId === gwTie1.id)!;
      const tieRec2 = records.find((r) => r.sourceId === gwTie2.id)!;

      expect(cutRec).toMatchObject({
        stage: "SALE",
        grossAmountCents: 200_000,
        readiness: "PENDING_SETTLEMENT",
      });
      expect(aggRec).toMatchObject({
        stage: "SETTLEMENT",
        sourceChannel: "rappi",
        grossAmountCents: 200_000,
        commissionCents: 50_000,
        expectedNetCents: 150_000,
        destinationBankAccountId: acctA.id,
        readiness: "READY",
      });
      expect(depositedRec).toMatchObject({
        stage: "DEPOSIT",
        expectedNetCents: 95_824,
        destinationBankAccountId: acctA.id,
        readiness: "DEPOSITED",
      });
      expect(tieRec1.readiness).toBe("AMBIGUOUS");
      expect(tieRec2.readiness).toBe("AMBIGUOUS");
      expect(depositEvaluations).toEqual([
        expect.objectContaining({ status: "AMBIGUOUS", reason: "MULTIPLE_EXPECTED_CANDIDATES" }),
      ]);

      // 5. Aislamiento RLS: Empresa B no ve ingresos esperados de Empresa A
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      const bRes = await listExpectedIncomes({ companyId: companyB }, tx);
      expect(bRes.records).toEqual([]);

      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }

  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
});
