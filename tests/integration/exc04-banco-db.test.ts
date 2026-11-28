/**
 * EXC-04.banco — Verificación V2 en Neon PostgreSQL real (esquema efímero aislado).
 *
 * Comprueba sobre Postgres real:
 * 1. Pago pendiente (`BANK_OUTFLOW` + `PAYMENT_RUN_ITEM`), depósito agrupado
 *    (`GROUPED_DEPOSIT_UNSUPPORTED`), depósito pendiente (`BANK_DEPOSIT` +
 *    `GATEWAY_TRANSACTION`) y liquidación discrepante (`ARITHMETIC_NET_MISMATCH`)
 *    generan excepciones canónicas `bank_reconciliation` conservando fuente,
 *    `valueDate`, `ageDays`, `firstDetectedAt`, `ownerId` y `differenceCents`.
 * 2. Repetir `syncCompanyBankExceptions` (y `bankReconciliationAdapter.run`)
 *    nunca duplica, actualiza `ageDays` con reloj controlado y preserva
 *    `valueDate`, `firstDetectedAt`, `ownerId` y `differenceCents`.
 * 3. Conciliar egreso (`confirmMatch` BAN-04) cierra atómicamente las
 *    excepciones canónicas de `bank_tx:*` y `payment_item:*` en la misma
 *    transacción con `reconciliationTrace` exacto y auditoría `AUD-02`.
 * 4. Conciliar depósito exacto (`confirmDepositMatch` BAN-06.a) cierra
 *    atómicamente las excepciones de `bank_tx:*` y `gateway_tx:*` con traza y
 *    auditoría `AUD-02`.
 * 5. Intentar cerrar una liquidación discrepante (`differenceCents !== 0`) sin
 *    disposición explícita/motivo falla con `409 Conflict` y mantiene visible la
 *    diferencia; cerrar con disposición `EXPLAINED_FEE` + motivo conserva
 *    `differenceCents` en `reconciliationTrace` y `AUD-02`.
 * 6. Rollback atómico ante fallo de FK en `employee_audit_logs` (AUD-02) y
 *    aislamiento multi-tenant (empresa B recibe 404).
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  bankTransactions,
  branches,
  companies,
  companyBankAccounts,
  employeeAuditLogs,
  gatewayTransactions,
  paymentRunItems,
  paymentRuns,
  users,
} from "@/lib/db/schema";

const dbState = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof drizzle<typeof schema>>,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return dbState.db;
  },
}));

import {
  BANK_EXCEPTION_SUBJECT_TYPE,
  buildBankSubjectId,
} from "@/lib/services/bank-exception-rules";
import {
  listBankExceptions,
  resolveBankExceptionOnReconciliation,
  syncCompanyBankExceptions,
} from "@/lib/services/bank-exception-service";
import { bankReconciliationAdapter } from "@/lib/services/exception-adapters/bank-reconciliation";
import {
  confirmDepositMatch,
  confirmMatch,
} from "@/lib/services/bank-statement-service";
import { ExceptionService } from "@/lib/services/exception-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

describeDb("EXC-04.banco — Excepción bancaria con fuente, antigüedad y trazabilidad sin ocultar diferencias (V2 Neon)", () => {
  let pool: Pool;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  const suffix = crypto.randomBytes(4).toString("hex");
  const namespace = `exc04b_${suffix}`;
  let schemaCreated = false;

  const companyA = crypto.randomUUID();
  const companyB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const acctA = crypto.randomUUID();
  const adminA = `exc04b-adma-${suffix}`;
  const adminB = `exc04b-admb-${suffix}`;
  const prevAccounting = process.env.ACCOUNTING_POSTING_ENABLED;

  beforeAll(async () => {
    process.env.ACCOUNTING_POSTING_ENABLED = "false";

    const setupPool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
    try {
      await setupPool.query(`CREATE SCHEMA "${namespace}"`);
      schemaCreated = true;
      const tablesToClone = [
        "companies",
        "branches",
        "users",
        "company_bank_accounts",
        "bank_transactions",
        "payment_runs",
        "payment_run_items",
        "gateway_transactions",
        "accounting_events",
        "exceptions",
        "employee_audit_logs",
        "domain_events",
      ];
      for (const t of tablesToClone) {
        await setupPool.query(
          `CREATE TABLE "${namespace}"."${t}" (LIKE public."${t}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
        );
      }
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT exc04b_audit_user_fk FOREIGN KEY (user_id) REFERENCES "${namespace}".users(id)`,
      );
      await setupPool.query(
        `ALTER TABLE "${namespace}".employee_audit_logs ADD CONSTRAINT exc04b_audit_perf_fk FOREIGN KEY (performed_by) REFERENCES "${namespace}".users(id)`,
      );
    } finally {
      await setupPool.end();
    }

    pool = new Pool({
      connectionString: TEST_DB_URL,
      max: 6,
      options: `-c search_path=${namespace},public -c timezone=UTC`,
    });
    testDb = drizzle(pool, { schema });
    dbState.db = testDb;

    const now = new Date();
    await testDb.insert(companies).values([
      { id: companyA, name: `EXC04B Co A ${suffix}` },
      { id: companyB, name: `EXC04B Co B ${suffix}` },
    ]);
    await testDb.insert(branches).values({
      id: branchA,
      companyId: companyA,
      name: `Suc EXC04B ${suffix}`,
    });
    await testDb.insert(users).values([
      {
        id: adminA,
        email: `${adminA}@test.local`,
        name: "Admin Tesorería A",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyA,
        active: true,
      },
      {
        id: adminB,
        email: `${adminB}@test.local`,
        name: "Admin Empresa B",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        role: "ADMIN",
        companyId: companyB,
        active: true,
      },
    ]);
    await testDb.insert(companyBankAccounts).values({
      id: acctA,
      companyId: companyA,
      label: "BBVA Operativa",
      accountNumber: "enc-exc04b-1234",
      accountLastFour: "1234",
      accountFingerprint: `fp-acct-${suffix}`,
      bankCode: "012",
      bankName: "BBVA",
      currency: "MXN",
      registeredBy: adminA,
    });
  });

  afterAll(async () => {
    process.env.ACCOUNTING_POSTING_ENABLED = prevAccounting;
    try {
      await pool?.end();
    } finally {
      if (schemaCreated) {
        const dropPool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
        try {
          await dropPool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        } finally {
          await dropPool.end();
        }
      }
    }
  });

  it("conserva fuente y antigüedad, concilia BAN-04/BAN-06.a con trazabilidad AUD-02 y nunca oculta diferencias", async () => {
    const t0 = new Date("2026-11-20T12:00:00Z");
    const t1 = new Date("2026-11-25T12:00:00Z");

    // 1. Sembrar:
    // (a) Egreso bancario pendiente (-50,000c, 6d de antigüedad) + partida de corrida CONFIRMED (50,000c)
    const [runA] = await testDb
      .insert(paymentRuns)
      .values({
        companyId: companyA,
        branchId: branchA,
        title: "Corrida Semanal",
        runDate: new Date("2026-11-14"),
        status: "PROCESSING",
        sourceAccount: "BBVA ****1234",
        sourceBankAccountId: acctA,
        totalAmountCents: 50_000,
        preparedBy: adminA,
        createdAt: new Date("2026-11-14T10:00:00Z"),
      })
      .returning();

    const [payItem] = await testDb
      .insert(paymentRunItems)
      .values({
        paymentRunId: runA.id,
        itemType: "OPERATING_EXPENSE",
        referenceId: crypto.randomUUID(),
        amountCents: 50_000,
        settlementStatus: "CONFIRMED",
        settledAt: new Date("2026-11-14T12:00:00Z"),
        settledBy: adminA,
        settlementReference: "SPEI-001",
      })
      .returning();

    const [outflowTx] = await testDb
      .insert(bankTransactions)
      .values({
        companyId: companyA,
        sourceBankAccountId: acctA,
        valueDate: "2026-11-14",
        description: "SPEI Proveedor Hielo",
        reference: "SPEI-001",
        amountCents: -50_000,
        fingerprint: `fp-out-${suffix}`,
        matchStatus: "UNMATCHED",
        importedBy: adminA,
      })
      .returning();

    // (b) Depósito bancario pendiente exacto (+95,000c, 8d antigüedad) + gateway exacto (95,000c)
    const [gwExact] = await testDb
      .insert(gatewayTransactions)
      .values({
        companyId: companyA,
        branchId: branchA,
        acquirer: "CLIP",
        externalId: `CLIP-OK-${suffix}`,
        transactionDate: new Date("2026-11-12T18:00:00Z"),
        settlementDate: "2026-11-12",
        grossAmountCents: 100_000,
        feeAmountCents: 4_310,
        feeVatCents: 690,
        netAmountCents: 95_000,
        destinationBankAccountId: acctA,
      })
      .returning();

    const [depositTx] = await testDb
      .insert(bankTransactions)
      .values({
        companyId: companyA,
        sourceBankAccountId: acctA,
        valueDate: "2026-11-12",
        description: "DEPOSITO CLIP LOTE 12",
        reference: `CLIP-OK-${suffix}`,
        amountCents: 95_000,
        fingerprint: `fp-dep-${suffix}`,
        matchStatus: "UNMATCHED",
        importedBy: adminA,
      })
      .returning();

    // (c) Liquidación de pasarela con discrepancia aritmética (-1,500c: 100,000 - 4,310 - 690 = 95,000 != 93,500)
    const [gwDiscrepant] = await testDb
      .insert(gatewayTransactions)
      .values({
        companyId: companyA,
        branchId: branchA,
        acquirer: "CLIP",
        externalId: `CLIP-DIFF-${suffix}`,
        transactionDate: new Date("2026-11-15T18:00:00Z"),
        settlementDate: "2026-11-15",
        grossAmountCents: 100_000,
        feeAmountCents: 4_310,
        feeVatCents: 690,
        netAmountCents: 93_500, // diferencia -1,500 centavos
        destinationBankAccountId: acctA,
      })
      .returning();

    // 2. Primer barrido en t0 (2026-11-20)
    const s1 = await syncCompanyBankExceptions(
      { companyId: companyA, now: t0, pendingThresholdDays: 3 },
      testDb,
    );
    expect(s1.raised).toBe(5); // outflowTx, payItem, depositTx, gwExact, gwDiscrepant

    const listT0 = await listBankExceptions({ companyId: companyA }, testDb);
    expect(listT0).toHaveLength(5);

    const excOutflowT0 = listT0.find(
      (e) => e.sourceKind === "BANK_OUTFLOW" && e.sourceId === outflowTx.id,
    )!;
    expect(excOutflowT0.valueDate).toBe("2026-11-14");
    expect(excOutflowT0.ageDays).toBe(6);
    expect(excOutflowT0.ownerId).toBe(adminA);

    const excDiffT0 = listT0.find(
      (e) => e.sourceKind === "GATEWAY_TRANSACTION" && e.sourceId === gwDiscrepant.id,
    )!;
    expect(excDiffT0.discrepancyCode).toBe("ARITHMETIC_NET_MISMATCH");
    expect(excDiffT0.differenceCents).toBe(-1_500);
    expect(excDiffT0.valueDate).toBe("2026-11-15");
    expect(excDiffT0.ageDays).toBe(5);

    // 3. Repetir barrido en t1 (+5 días) + adaptador: NO duplica, actualiza antigüedad y conserva firstDetectedAt/valueDate/diff
    await syncCompanyBankExceptions(
      { companyId: companyA, now: t1, pendingThresholdDays: 3 },
      testDb,
    );
    await bankReconciliationAdapter.run({ companyId: companyA });

    const listT1 = await listBankExceptions({ companyId: companyA }, testDb);
    expect(listT1).toHaveLength(5);
    const excOutflowT1 = listT1.find((e) => e.id === excOutflowT0.id)!;
    expect(excOutflowT1.valueDate).toBe("2026-11-14");
    expect(excOutflowT1.firstDetectedAt).toBe(excOutflowT0.firstDetectedAt);
    expect(excOutflowT1.ageDays).toBeGreaterThanOrEqual(11);

    // 4. Conciliar egreso via confirmMatch (BAN-04): cierra atómicamente bank_tx + payment_item con traza y AUD-02
    await confirmMatch(
      {
        companyId: companyA,
        transactionId: outflowTx.id,
        paymentRunItemId: payItem.id,
        userId: adminA,
        notes: "SPEI-001 confirmado contra estado de cuenta BBVA",
      },
      testDb,
    );

    const excOutflowClosed = await ExceptionService.getBySubject(
      companyA,
      BANK_EXCEPTION_SUBJECT_TYPE,
      buildBankSubjectId("BANK_OUTFLOW", outflowTx.id),
      testDb,
    );
    const excPayItemClosed = await ExceptionService.getBySubject(
      companyA,
      BANK_EXCEPTION_SUBJECT_TYPE,
      buildBankSubjectId("PAYMENT_RUN_ITEM", payItem.id),
      testDb,
    );
    expect(excOutflowClosed!.status).toBe("CANCELLED");
    expect(excPayItemClosed!.status).toBe("CANCELLED");
    expect(
      (excOutflowClosed!.metadata as Record<string, unknown>).reconciliationTrace,
    ).toMatchObject({
      matchedTargetType: "PAYMENT_RUN_ITEM",
      matchedTargetId: payItem.id,
      differenceCents: 0,
      disposition: "EXACT_MATCH",
      reconciledBy: adminA,
    });

    // 5. Conciliar depósito exacto via confirmDepositMatch (BAN-06.a): cierra atómicamente bank_tx + gateway_tx
    await confirmDepositMatch(
      {
        companyId: companyA,
        transactionId: depositTx.id,
        gatewayTransactionId: gwExact.id,
        userId: adminA,
        notes: "Abono Clip lote 12 conciliado exacto",
      },
      testDb,
    );

    const excDepositClosed = await ExceptionService.getBySubject(
      companyA,
      BANK_EXCEPTION_SUBJECT_TYPE,
      buildBankSubjectId("BANK_DEPOSIT", depositTx.id),
      testDb,
    );
    const excGwExactClosed = await ExceptionService.getBySubject(
      companyA,
      BANK_EXCEPTION_SUBJECT_TYPE,
      buildBankSubjectId("GATEWAY_TRANSACTION", gwExact.id),
      testDb,
    );
    expect(excDepositClosed!.status).toBe("CANCELLED");
    expect(excGwExactClosed!.status).toBe("CANCELLED");
    expect(
      (excDepositClosed!.metadata as Record<string, unknown>).reconciliationTrace,
    ).toMatchObject({
      matchedTargetType: "GATEWAY_TRANSACTION",
      matchedTargetId: gwExact.id,
      differenceCents: 0,
      disposition: "EXACT_MATCH",
    });

    // 6. Discrepancia aritmética (-1,500c): prohibido cerrar ocultando la diferencia (409)
    await expect(
      resolveBankExceptionOnReconciliation(
        {
          companyId: companyA,
          sourceKind: "GATEWAY_TRANSACTION",
          sourceId: gwDiscrepant.id,
          matchedTargetType: "MANUAL_DISPOSITION",
          matchedTargetId: null,
          bankAmountCents: 93_500,
          targetAmountCents: 95_000,
          actorId: adminA,
          disposition: "EXACT_MATCH",
          notes: "Intento de ocultar diferencia",
          now: t1,
        },
        testDb,
      ),
    ).rejects.toThrow(/no puede ocultarse/i);

    const stillOpenDiff = await ExceptionService.getBySubject(
      companyA,
      BANK_EXCEPTION_SUBJECT_TYPE,
      buildBankSubjectId("GATEWAY_TRANSACTION", gwDiscrepant.id),
      testDb,
    );
    expect(stillOpenDiff!.status).toBe("OPEN");
    expect((stillOpenDiff!.metadata as Record<string, unknown>).differenceCents).toBe(-1_500);

    // 7. Aislamiento entre empresas (404) y rollback atómico ante fallo FK de AUD-02
    await expect(
      resolveBankExceptionOnReconciliation({
        companyId: companyB,
        sourceKind: "GATEWAY_TRANSACTION",
        sourceId: gwDiscrepant.id,
        matchedTargetType: "MANUAL_DISPOSITION",
        matchedTargetId: null,
        bankAmountCents: 93_500,
        targetAmountCents: 95_000,
        actorId: adminB,
        disposition: "EXPLAINED_FEE",
        notes: "Intento cross-tenant",
      }),
    ).rejects.toThrow(/no encontrada/i);

    await expect(
      resolveBankExceptionOnReconciliation({
        companyId: companyA,
        sourceKind: "GATEWAY_TRANSACTION",
        sourceId: gwDiscrepant.id,
        matchedTargetType: "MANUAL_DISPOSITION",
        matchedTargetId: null,
        bankAmountCents: 93_500,
        targetAmountCents: 95_000,
        actorId: "ghost-actor-fk-violation",
        disposition: "EXPLAINED_FEE",
        notes: "Debe revertir si falla AUD-02",
        now: t1,
      }),
    ).rejects.toThrow();

    const stillOpenAfterRollback = await ExceptionService.getBySubject(
      companyA,
      BANK_EXCEPTION_SUBJECT_TYPE,
      buildBankSubjectId("GATEWAY_TRANSACTION", gwDiscrepant.id),
      testDb,
    );
    expect(stillOpenAfterRollback!.status).toBe("OPEN");

    // 8. Cierre auditado CON disposición explícita conserva differenceCents = -1,500 en traza y AUD-02
    const resolvedDiff = await resolveBankExceptionOnReconciliation({
      companyId: companyA,
      sourceKind: "GATEWAY_TRANSACTION",
      sourceId: gwDiscrepant.id,
      matchedTargetType: "MANUAL_DISPOSITION",
      matchedTargetId: null,
      bankAmountCents: 93_500,
      targetAmountCents: 95_000,
      actorId: adminA,
      disposition: "EXPLAINED_FEE",
      notes: "Retención de comisión extraordinaria confirmada por MercadoPago",
      now: t1,
    });
    expect(resolvedDiff.closed).toBe(true);
    expect(resolvedDiff.differenceCents).toBe(-1_500);
    expect(resolvedDiff.exception!.status).toBe("CANCELLED");
    expect(resolvedDiff.trace).toMatchObject({
      differenceCents: -1_500,
      disposition: "EXPLAINED_FEE",
      reconciledBy: adminA,
    });

    const bankAudits = await testDb
      .select()
      .from(employeeAuditLogs)
      .where(
        and(
          eq(employeeAuditLogs.entityType, "BANK_RECONCILIATION"),
          eq(employeeAuditLogs.entityId, excDiffT0.id),
        ),
      );
    expect(bankAudits).toHaveLength(1);
    expect(bankAudits[0].performedBy).toBe(adminA);
    expect(bankAudits[0].reason).toContain("MercadoPago");
  });
});
