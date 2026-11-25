import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountingAccounts,
  accountingEvents,
  accountingJournalLines,
  accountingJournals,
  accountingRuleEntries,
  accountingRules,
  bankTransactions,
  branches,
  companies,
  companyBankAccounts,
  configChangeLogs,
  gatewayTransactions,
  users,
} from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  correctAccountedDepositMatch,
  unmatchDepositTransaction,
} from "@/lib/services/bank-statement-service";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "company_bank_accounts",
    "bank_transactions",
    "gateway_transactions",
    "accounting_accounts",
    "accounting_events",
    "accounting_journals",
    "accounting_journal_lines",
    "accounting_rules",
    "accounting_rule_entries",
    "accounting_openings",
    "accounting_opening_documents",
    "financial_periods",
    "config_change_logs",
  ]);
});

function loadMigration(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

it("BAN-06.b V2 (pulso_app): corrección auditada revierte póliza FC-12 con AUD-02, preserva hecho contable y jamás libera saldo dos veces", async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = `u-ban06b-a-${randomUUID()}`;
  const userB = `u-ban06b-b-${randomUUID()}`;

  const rollback = new Error("BAN-06.b rollback");
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
        { id: companyA, name: "Ban06b Co A" },
        { id: companyB, name: "Ban06b Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Suc A" },
        { id: branchB, companyId: companyB, name: "Suc B" },
      ]);
      await tx.insert(users).values([
        { id: userA, name: "Admin A", email: `${userA}@ban06b.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@ban06b.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);

      const [acctA] = await tx
        .insert(companyBankAccounts)
        .values({
          companyId: companyA,
          label: "BBVA Recepción A",
          accountNumber: "enc-ban06b-a",
          accountLastFour: "7777",
          accountFingerprint: `fp-ban06b-acct-${randomUUID()}`,
          bankCode: "012",
          bankName: "BBVA",
          purpose: "RECEPCION",
          registeredBy: userA,
        })
        .returning({ id: companyBankAccounts.id });

      const [gw] = await tx
        .insert(gatewayTransactions)
        .values({
          companyId: companyA,
          branchId: branchA,
          acquirer: "CLIP",
          externalId: `ext-ban06b-${randomUUID()}`,
          transactionDate: new Date("2026-07-10T18:00:00Z"),
          settlementDate: "2026-07-11",
          grossAmountCents: 100_000,
          feeAmountCents: 3_600,
          feeVatCents: 576,
          netAmountCents: 95_824,
          destinationBankAccountId: acctA.id,
          importedBy: userA,
        })
        .returning({ id: gatewayTransactions.id });

      const [bankTx] = await tx
        .insert(bankTransactions)
        .values({
          companyId: companyA,
          sourceBankAccountId: acctA.id,
          valueDate: "2026-07-11",
          description: "ABONO CLIP CONTABILIZADO",
          reference: "CLIP-ACCT-1",
          amountCents: 95_824,
          fingerprint: `fp-ban06b-tx-${randomUUID()}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gw.id,
          matchedAt: new Date("2026-07-11T15:00:00Z"),
          matchedBy: userA,
          importedBy: userA,
        })
        .returning({ id: bankTransactions.id });

      // Cuentas contables, corte de venta FC-11, hecho FC-12 y póliza POSTED original
      const [bankAcct, feeAcct, recAcct, salesAcct] = await tx
        .insert(accountingAccounts)
        .values([
          {
            companyId: companyA,
            code: "1020-01",
            name: "Bancos BBVA",
            kind: "ASSET",
            normalBalance: "DEBIT",
            postable: true,
            validFrom: "2026-01-01",
            createdBy: userA,
            updatedBy: userA,
          },
          {
            companyId: companyA,
            code: "5201-01",
            name: "Comisiones pasarela",
            kind: "EXPENSE",
            normalBalance: "DEBIT",
            postable: true,
            validFrom: "2026-01-01",
            createdBy: userA,
            updatedBy: userA,
          },
          {
            companyId: companyA,
            code: "1105-01",
            name: "Por liquidar tarjetas",
            kind: "ASSET",
            normalBalance: "DEBIT",
            postable: true,
            validFrom: "2026-01-01",
            createdBy: userA,
            updatedBy: userA,
          },
          {
            companyId: companyA,
            code: "4010-01",
            name: "Ventas tarjeta",
            kind: "INCOME",
            normalBalance: "CREDIT",
            postable: true,
            validFrom: "2026-01-01",
            createdBy: userA,
            updatedBy: userA,
          },
        ])
        .returning({ id: accountingAccounts.id });

      const [saleRule, rule] = await tx
        .insert(accountingRules)
        .values([
          {
            companyId: companyA,
            code: "SALE_RULE_1",
            name: "Regla venta tarjeta",
            eventType: "SALE_RECOGNIZED",
            version: 1,
            effectiveFrom: "2026-01-01",
            createdBy: userA,
            updatedBy: userA,
          },
          {
            companyId: companyA,
            code: "SETTLEMENT_RULE_1",
            name: "Regla liquidación pasarela",
            eventType: "SETTLEMENT_RECOGNIZED",
            version: 1,
            effectiveFrom: "2026-01-01",
            createdBy: userA,
            updatedBy: userA,
          },
        ])
        .returning({ id: accountingRules.id });

      await tx.insert(accountingRuleEntries).values([
        { companyId: companyA, ruleId: saleRule.id, role: "CARD_RECEIVABLE", accountId: recAcct.id, required: true },
        { companyId: companyA, ruleId: saleRule.id, role: "SALES_REVENUE", accountId: salesAcct.id, required: true },
        { companyId: companyA, ruleId: rule.id, role: "CARD_RECEIVABLE", accountId: recAcct.id, required: true },
        { companyId: companyA, ruleId: rule.id, role: "RECEPTION_SOURCE", accountId: bankAcct.id, required: true },
        { companyId: companyA, ruleId: rule.id, role: "COMMISSION_EXPENSE", accountId: feeAcct.id, required: true },
      ]);

      // Póliza FC-11 de corte de venta que alimenta la cuenta por liquidar (100,000)
      const [saleDraft] = await tx
        .insert(accountingJournals)
        .values({
          companyId: companyA,
          accountingDate: "2026-07-10",
          businessDate: "2026-07-10",
          branchId: branchA,
          description: "Corte de ventas tarjeta",
          currency: "MXN",
          status: "DRAFT",
          sourceType: "DAILY_SALES_CUT",
          sourceId: randomUUID(),
          sourceVersion: 1,
          eventType: "SALE_RECOGNIZED",
          ruleId: saleRule.id,
          ruleVersion: 1,
          createdBy: userA,
          updatedBy: userA,
        })
        .returning();

      await tx.insert(accountingJournalLines).values([
        {
          companyId: companyA,
          journalId: saleDraft.id,
          lineNumber: 1,
          accountId: recAcct.id,
          debitCents: 100_000,
          creditCents: 0,
          memo: "SALE:CARD_RECEIVABLE",
        },
        {
          companyId: companyA,
          journalId: saleDraft.id,
          lineNumber: 2,
          accountId: salesAcct.id,
          debitCents: 0,
          creditCents: 100_000,
          memo: "SALE:REVENUE",
        },
      ]);

      await tx
        .update(accountingJournals)
        .set({
          status: "POSTED",
          number: 1,
          version: 2,
          postingReason: "Venta registrada por corte",
          postedBy: userA,
          postedAt: new Date("2026-07-10T23:00:00Z"),
        })
        .where(eq(accountingJournals.id, saleDraft.id));

      const [draftJournal] = await tx
        .insert(accountingJournals)
        .values({
          companyId: companyA,
          accountingDate: "2026-07-11",
          businessDate: "2026-07-10",
          branchId: branchA,
          description: "Liquidación CLIP contabilizada",
          currency: "MXN",
          status: "DRAFT",
          sourceType: "GATEWAY_SETTLEMENT",
          sourceId: gw.id,
          sourceVersion: 1,
          eventType: "SETTLEMENT_RECOGNIZED",
          ruleId: rule.id,
          ruleVersion: 1,
          createdBy: userA,
          updatedBy: userA,
        })
        .returning();

      await tx.insert(accountingJournalLines).values([
        {
          companyId: companyA,
          journalId: draftJournal.id,
          lineNumber: 1,
          accountId: bankAcct.id,
          debitCents: 95_824,
          creditCents: 0,
          memo: "SETTLEMENT:NET",
        },
        {
          companyId: companyA,
          journalId: draftJournal.id,
          lineNumber: 2,
          accountId: feeAcct.id,
          debitCents: 4_176,
          creditCents: 0,
          memo: "SETTLEMENT:COMMISSION",
        },
        {
          companyId: companyA,
          journalId: draftJournal.id,
          lineNumber: 3,
          accountId: recAcct.id,
          debitCents: 0,
          creditCents: 100_000,
          memo: "SETTLEMENT:RECEIVABLE",
        },
      ]);

      const [origJournal] = await tx
        .update(accountingJournals)
        .set({
          status: "POSTED",
          number: 2,
          version: 2,
          postingReason: "Liquidación contabilizada al confirmar depósito",
          postedBy: userA,
          postedAt: new Date("2026-07-11T16:00:00Z"),
        })
        .where(eq(accountingJournals.id, draftJournal.id))
        .returning();

      const [eventRow] = await tx
        .insert(accountingEvents)
        .values({
          companyId: companyA,
          branchId: branchA,
          sourceType: "GATEWAY_SETTLEMENT",
          sourceId: gw.id,
          eventType: "SETTLEMENT_RECOGNIZED",
          sourceVersion: 1,
          actorId: userA,
          accountingDate: "2026-07-11",
          status: "POSTED",
          journalId: origJournal.id,
        })
        .returning({ id: accountingEvents.id });

      // Bajar a rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      await setTenantContext(tx, { companyId: companyA, branchId: branchA });

      // 1. Deshacer ingenuo queda bloqueado con 409 porque respalda hecho contable
      await expect(
        unmatchDepositTransaction({ companyId: companyA, transactionId: bankTx.id }, tx)
      ).rejects.toMatchObject({ statusCode: 409 });

      // 2. Motivo inválido (400) y versión incorrecta (409)
      await expect(
        correctAccountedDepositMatch(
          { companyId: companyA, transactionId: bankTx.id, actorId: userA, reason: "no" },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        correctAccountedDepositMatch(
          {
            companyId: companyA,
            transactionId: bankTx.id,
            actorId: userA,
            reason: "Cruce incorrecto de depósito contabilizado",
            expectedVersion: 99,
          },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      // 3. Corrección auditada válida: genera reversa FC-12, preserva hecho/póliza, libera banco y registra AUD-02
      const correction = await correctAccountedDepositMatch(
        {
          companyId: companyA,
          transactionId: bankTx.id,
          actorId: userA,
          reason: "Cruce incorrecto contra lote Clip equivocado; se revierte póliza",
          accountingDate: "2026-07-12",
          expectedVersion: 2,
        },
        tx
      );
      expect(correction.originalJournalId).toBe(origJournal.id);
      expect(correction.originalJournalVersion).toBe(2);
      expect(correction.reversalJournalId).toBeTruthy();
      expect(correction.auditLogId).toBeTruthy();
      expect(correction.preservedAccountingEventIds).toEqual([eventRow.id]);

      // Verificar que el hecho contable y la póliza original JAMÁS se borraron
      const preservedEvents = await tx
        .select({ id: accountingEvents.id })
        .from(accountingEvents)
        .where(eq(accountingEvents.id, eventRow.id));
      expect(preservedEvents).toHaveLength(1);

      const journals = await tx
        .select({
          id: accountingJournals.id,
          status: accountingJournals.status,
          reversalOfId: accountingJournals.reversalOfId,
        })
        .from(accountingJournals)
        .where(eq(accountingJournals.companyId, companyA));
      expect(journals).toHaveLength(3);
      const rev = journals.find((j) => j.id === correction.reversalJournalId)!;
      expect(rev).toMatchObject({ status: "POSTED", reversalOfId: origJournal.id });

      // Verificar líneas invertidas de la reversa (saldo neto = 0 en cuentas afectadas)
      const revLines = await tx
        .select({
          accountId: accountingJournalLines.accountId,
          debitCents: accountingJournalLines.debitCents,
          creditCents: accountingJournalLines.creditCents,
        })
        .from(accountingJournalLines)
        .where(eq(accountingJournalLines.journalId, rev.id));
      expect(revLines).toEqual(
        expect.arrayContaining([
          { accountId: bankAcct.id, debitCents: 0, creditCents: 95_824 },
          { accountId: feeAcct.id, debitCents: 0, creditCents: 4_176 },
          { accountId: recAcct.id, debitCents: 100_000, creditCents: 0 },
        ])
      );

      // Verificar auditoría AUD-02 en config_change_logs
      const auditRows = await tx
        .select({
          id: configChangeLogs.id,
          fieldName: configChangeLogs.fieldName,
          userId: configChangeLogs.userId,
        })
        .from(configChangeLogs)
        .where(eq(configChangeLogs.id, correction.auditLogId));
      expect(auditRows).toEqual([
        { id: correction.auditLogId, fieldName: "DEPOSIT_CORRECTION", userId: userA },
      ]);

      // Verificar banco liberado a UNMATCHED
      const [releasedTx] = await tx
        .select({
          matchStatus: bankTransactions.matchStatus,
          matchedGatewayTransactionId: bankTransactions.matchedGatewayTransactionId,
        })
        .from(bankTransactions)
        .where(eq(bankTransactions.id, bankTx.id));
      expect(releasedTx).toEqual({
        matchStatus: "UNMATCHED",
        matchedGatewayTransactionId: null,
      });

      // 4. Repetir corrección rechaza con 409 (nunca libera saldo dos veces)
      await expect(
        correctAccountedDepositMatch(
          {
            companyId: companyA,
            transactionId: bankTx.id,
            actorId: userA,
            reason: "Segundo intento no debe liberar saldo otra vez",
          },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 409 });

      // 5. Aislamiento RLS: Empresa B recibe 404
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      await expect(
        correctAccountedDepositMatch(
          {
            companyId: companyB,
            transactionId: bankTx.id,
            actorId: userB,
            reason: "Intento cruzado de empresa ajena",
          },
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
