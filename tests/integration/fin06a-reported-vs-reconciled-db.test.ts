/**
 * FIN-06.a — Verificación V2 contra PostgreSQL/Neon bajo rol `pulso_app` (NOBYPASSRLS).
 *
 * Verifica en transacción aislada con rollback:
 * 1. Separación explícita entre importe reportado (`GATEWAY_REPORTED` / `PENDING`) y
 *    conciliado en banco (`BANK_RECONCILED` / `CONFIRMED`).
 * 2. Detección de discrepancia bancaria (`DISCREPANT`) con `discrepancyCents` exacto
 *    sin contabilizar la comisión como conciliada/confirmada.
 * 3. Comisión documentada cero (`DOCUMENTED_ZERO`) distinguida de dato faltante (`NO_DATA`)
 *    tanto en `getCommissionsByBranch` (API) como en `buildPnlCommissionPresentation` (P&L).
 * 4. Liquidaciones de agregadores (`AGGREGATOR_REPORTED`) con estado `CONFIRMED` coherente.
 * 5. Aislamiento multi-tenant bajo `pulso_app` (empresa B no ve filas de empresa A).
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  aggregatorSettlements,
  bankTransactions,
  branches,
  companies,
  companyBankAccounts,
  dailySalesCuts,
  gatewayTransactions,
  users,
} from "@/lib/db/schema";
import { getCommissionsByBranch } from "@/lib/services/commission-service";
import { buildPnlCommissionPresentation } from "@/lib/services/pnl-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const describeDb = TEST_DB_URL ? describe : describe.skip;

class RollbackSignal extends Error {
  constructor() {
    super("ROLLBACK_TEST_TX");
  }
}

describeDb("FIN-06.a — Separar importe reportado y conciliado (V2 Neon / pulso_app)", () => {
  it("distingue pendiente, discrepante, confirmado, cero documentado y sin datos en API y P&L bajo RLS", async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    const client = await pool.connect();

    const suffix = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    const userA = `fin06a-user-a-${suffix}`;
    const userB = `fin06a-user-b-${suffix}`;

    const branchPending = crypto.randomUUID();
    const branchConfirmed = crypto.randomUUID();
    const branchDiscrepant = crypto.randomUUID();
    const branchDocZero = crypto.randomUUID();
    const branchMissing = crypto.randomUUID();
    const branchAggregator = crypto.randomUUID();
    const branchB = crypto.randomUUID();

    const bankAccountA = crypto.randomUUID();

    const sec05Sql = fs.readFileSync(
      path.join(process.cwd(), "drizzle", "0167_sec05_tesoreria_rls.sql"),
      "utf8",
    );
    const ban05Sql = fs.readFileSync(
      path.join(process.cwd(), "drizzle", "0169_ban05_expected_income_identity.sql"),
      "utf8",
    );

    try {
      await client.query("BEGIN");
      const txDb = drizzle(client, { schema });

      // Aplicar migraciones candidatas dentro de la transacción de prueba (rollback al final)
      await client.query(sec05Sql);
      await client.query(ban05Sql);
      await client.query(`
        ALTER TABLE "daily_sales_cuts" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "channel_commission_rates" ENABLE ROW LEVEL SECURITY;
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
            GRANT SELECT ON "channel_commission_rates" TO "pulso_app";
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'daily_sales_cuts' AND policyname = 'daily_sales_cut_tenant'
          ) THEN
            CREATE POLICY "daily_sales_cut_tenant" ON "daily_sales_cuts"
              USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
              WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'channel_commission_rates' AND policyname = 'channel_commission_rates_tenant_isolation'
          ) THEN
            CREATE POLICY "channel_commission_rates_tenant_isolation" ON "channel_commission_rates"
              USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
              WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
          END IF;
        END $$;
      `);

      // Seed de compañías, usuarios, sucursales y cuenta bancaria propia
      await txDb.insert(companies).values([
        { id: companyA, name: `FIN06A Co A ${suffix}` },
        { id: companyB, name: `FIN06A Co B ${suffix}` },
      ]);

      const now = new Date();
      await txDb.insert(users).values([
        {
          id: userA,
          email: `fin06a-a-${suffix}@test.local`,
          name: "FIN06A Tester A",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: "ADMIN",
          companyId: companyA,
        },
        {
          id: userB,
          email: `fin06a-b-${suffix}@test.local`,
          name: "FIN06A Tester B",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: "ADMIN",
          companyId: companyB,
        },
      ]);

      await txDb.insert(branches).values([
        { id: branchPending, companyId: companyA, name: "Suc Pendiente" },
        { id: branchConfirmed, companyId: companyA, name: "Suc Confirmada" },
        { id: branchDiscrepant, companyId: companyA, name: "Suc Discrepante" },
        { id: branchDocZero, companyId: companyA, name: "Suc Cero Doc" },
        { id: branchMissing, companyId: companyA, name: "Suc Sin Datos" },
        { id: branchAggregator, companyId: companyA, name: "Suc Agregador" },
        { id: branchB, companyId: companyB, name: "Suc Empresa B" },
      ]);

      await txDb.insert(companyBankAccounts).values({
        id: bankAccountA,
        companyId: companyA,
        label: "BBVA Recepción FIN06A",
        accountNumber: `enc-fin06a-${suffix}`,
        accountLastFour: "4321",
        accountFingerprint: `fp-fin06a-${suffix}`,
        bankCode: "012",
        bankName: "BBVA",
        currency: "MXN",
        purpose: "RECEPCION",
        active: true,
        registeredBy: userA,
      });

      const periodDate = "2026-10-15";
      const txTimestamp = new Date("2026-10-15T15:00:00Z");

      // Cortes base por sucursal
      await txDb.insert(dailySalesCuts).values([
        {
          companyId: companyA,
          branchId: branchPending,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 100_000,
          cashSales: 0,
          cardSales: 100_000,
        },
        {
          companyId: companyA,
          branchId: branchConfirmed,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 100_000,
          cashSales: 0,
          cardSales: 100_000,
        },
        {
          companyId: companyA,
          branchId: branchDiscrepant,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 100_000,
          cashSales: 0,
          cardSales: 100_000,
        },
        {
          companyId: companyA,
          branchId: branchDocZero,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 50_000,
          cashSales: 0,
          cardSales: 50_000,
        },
        {
          companyId: companyA,
          branchId: branchMissing,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 80_000,
          cashSales: 0,
          cardSales: 80_000,
        },
        {
          companyId: companyA,
          branchId: branchAggregator,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 50_000,
          cashSales: 0,
          cardSales: 0,
          aggregatorSales: { rappi: 50_000 },
        },
      ]);

      // Transacciones de pasarela
      const gwPendingId = crypto.randomUUID();
      const gwConfirmedId = crypto.randomUUID();
      const gwDiscrepantId = crypto.randomUUID();
      const gwDocZeroId = crypto.randomUUID();

      await txDb.insert(gatewayTransactions).values([
        {
          id: gwPendingId,
          companyId: companyA,
          branchId: branchPending,
          acquirer: "CLIP",
          externalId: `gw-pend-${suffix}`,
          transactionDate: txTimestamp,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-10-16",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
        {
          id: gwConfirmedId,
          companyId: companyA,
          branchId: branchConfirmed,
          acquirer: "CLIP",
          externalId: `gw-conf-${suffix}`,
          transactionDate: txTimestamp,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-10-16",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
        {
          id: gwDiscrepantId,
          companyId: companyA,
          branchId: branchDiscrepant,
          acquirer: "CLIP",
          externalId: `gw-disc-${suffix}`,
          transactionDate: txTimestamp,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-10-16",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
        {
          id: gwDocZeroId,
          companyId: companyA,
          branchId: branchDocZero,
          acquirer: "CLIP",
          externalId: `gw-zero-${suffix}`,
          transactionDate: txTimestamp,
          grossAmountCents: 50_000,
          feeAmountCents: 0,
          feeVatCents: 0,
          netAmountCents: 50_000,
          settlementDate: "2026-10-16",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
      ]);

      // Abonos bancarios conciliados (exacto para branchConfirmed & branchDocZero; con diferencia -$6 para branchDiscrepant)
      await txDb.insert(bankTransactions).values([
        {
          companyId: companyA,
          sourceBankAccountId: bankAccountA,
          valueDate: "2026-10-16",
          description: "ABONO CLIP CONFIRMADO",
          reference: `ref-conf-${suffix}`,
          amountCents: 97_100,
          fingerprint: `bk-conf-${suffix}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwConfirmedId,
          matchedBy: userA,
          importedBy: userA,
        },
        {
          companyId: companyA,
          sourceBankAccountId: bankAccountA,
          valueDate: "2026-10-16",
          description: "ABONO CLIP DISCREPANTE",
          reference: `ref-disc-${suffix}`,
          amountCents: 96_500,
          fingerprint: `bk-disc-${suffix}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwDiscrepantId,
          matchedBy: userA,
          importedBy: userA,
        },
        {
          companyId: companyA,
          sourceBankAccountId: bankAccountA,
          valueDate: "2026-10-16",
          description: "ABONO CLIP CERO DOC",
          reference: `ref-zero-${suffix}`,
          amountCents: 50_000,
          fingerprint: `bk-zero-${suffix}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwDocZeroId,
          matchedBy: userA,
          importedBy: userA,
        },
      ]);

      // Liquidación de agregador conciliada
      await txDb.insert(aggregatorSettlements).values({
        companyId: companyA,
        branchId: branchAggregator,
        channel: "rappi",
        periodStart: "2026-10-14",
        periodEnd: "2026-10-16",
        grossSalesCents: 50_000,
        commissionCents: 15_000,
        netDepositedCents: 35_000,
        destinationBankAccountId: bankAccountA,
        posSalesCents: 50_000,
        varianceCents: 0,
        status: "RECONCILED",
      });

      // Bajar privilegios a rol de aplicación sujeto a RLS (`pulso_app`)
      await txDb.execute(sql`SET LOCAL ROLE pulso_app`);
      const roleCheck = await txDb.execute(
        sql`SELECT current_user AS u, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
      );
      expect(roleCheck.rows[0]).toMatchObject({
        u: "pulso_app",
        rolbypassrls: false,
        rolsuper: false,
      });

      // Contexto Empresa A
      await txDb.execute(sql`SELECT set_config('app.current_company_id', ${companyA}, true)`);

      const commsA = await getCommissionsByBranch(companyA, "2026-10-01", "2026-10-31", txDb);
      const byBranch = new Map(commsA.map((c) => [c.branchId, c]));

      // 1. Pendiente (reportada por pasarela, sin abono conciliado)
      const pend = byBranch.get(branchPending)!;
      expect(pend.amountSource).toBe("GATEWAY_REPORTED");
      expect(pend.reconciliationStatus).toBe("PENDING");
      expect(pend.reportedCommissionCents).toBe(2_900);
      expect(pend.reconciledCommissionCents).toBe(0);
      expect(pend.documentedZero).toBe(false);
      const pendPnl = buildPnlCommissionPresentation(pend, 100_000);
      expect(pendPnl.commissionsLine.source).toBe("DERIVED");
      expect(pendPnl.commissionsLine.amountSourceLabel).toBe(pend.amountSourceLabel);
      expect(pendPnl.commissionsLine.reconciliationStatusLabel).toBe(
        pend.reconciliationStatusLabel,
      );

      // 2. Confirmada (conciliada en banco exacto)
      const conf = byBranch.get(branchConfirmed)!;
      expect(conf.amountSource).toBe("BANK_RECONCILED");
      expect(conf.reconciliationStatus).toBe("CONFIRMED");
      expect(conf.reportedCommissionCents).toBe(0);
      expect(conf.reconciledCommissionCents).toBe(2_900);
      expect(conf.discrepancyCents).toBe(0);
      const confPnl = buildPnlCommissionPresentation(conf, 100_000);
      expect(confPnl.commissionsLine.source).toBe("MEASURED");
      expect(confPnl.commissionsLine.amountSourceLabel).toBe("Conciliada en banco");
      expect(confPnl.commissionsLine.reconciliationStatusLabel).toBe("Confirmada");

      // 3. Discrepante (abono bancario -$6 vs neto reportado)
      const disc = byBranch.get(branchDiscrepant)!;
      expect(disc.amountSource).toBe("GATEWAY_REPORTED");
      expect(disc.reconciliationStatus).toBe("DISCREPANT");
      expect(disc.discrepancyCents).toBe(-600);
      expect(disc.reportedCommissionCents).toBe(2_900);
      expect(disc.reconciledCommissionCents).toBe(0);
      const discPnl = buildPnlCommissionPresentation(disc, 100_000);
      expect(discPnl.commissionsLine.source).toBe("DERIVED");
      expect(discPnl.commissionsLine.reconciliationStatus).toBe("DISCREPANT");
      expect(discPnl.commissionsLine.reconciliationStatusLabel).toBe("Discrepante");

      // 4. Comisión documentada cero confirmada
      const zero = byBranch.get(branchDocZero)!;
      expect(zero.amountSource).toBe("DOCUMENTED_ZERO");
      expect(zero.reconciliationStatus).toBe("CONFIRMED");
      expect(zero.documentedZero).toBe(true);
      expect(zero.totalCommissionCents).toBe(0);
      const zeroPnl = buildPnlCommissionPresentation(zero, 50_000);
      expect(zeroPnl.commissionsLine.source).toBe("MEASURED");
      expect(zeroPnl.commissionsLine.documentedZero).toBe(true);
      expect(zeroPnl.commissionsLine.amountSourceLabel).toBe("Comisión documentada cero");
      expect(zeroPnl.commissionsLine.reconciliationStatusLabel).toBe("Confirmada");

      // 5. Sin datos (venta con tarjeta sin tarifa ni reporte -> NO es cero documentado)
      const miss = byBranch.get(branchMissing)!;
      expect(miss.source).toBe("NO_DATA");
      expect(miss.amountSource).toBe("NO_DATA");
      expect(miss.reconciliationStatus).toBe("PENDING");
      expect(miss.documentedZero).toBe(false);
      expect(miss.uncoveredSalesCents).toBe(80_000);
      const missPnl = buildPnlCommissionPresentation(miss, 80_000);
      expect(missPnl.commissionsLine.source).toBe("NO_DATA");
      expect(missPnl.commissionsLine.documentedZero).toBe(false);

      // 6. Agregador conciliado
      const agg = byBranch.get(branchAggregator)!;
      expect(agg.amountSource).toBe("AGGREGATOR_REPORTED");
      expect(agg.reconciliationStatus).toBe("CONFIRMED");
      expect(agg.reconciledCommissionCents).toBe(15_000);
      expect(agg.reportedCommissionCents).toBe(0);
      const aggPnl = buildPnlCommissionPresentation(agg, 50_000);
      expect(aggPnl.commissionsLine.source).toBe("MEASURED");
      expect(aggPnl.commissionsLine.amountSourceLabel).toBe("Reportada por agregador");

      // 7. Aislamiento RLS: Empresa B no puede leer comisiones de Empresa A
      await txDb.execute(sql`SELECT set_config('app.current_company_id', ${companyB}, true)`);
      const commsBFromA = await getCommissionsByBranch(companyA, "2026-10-01", "2026-10-31", txDb);
      expect(commsBFromA).toHaveLength(0);

      throw new RollbackSignal();
    } catch (err) {
      await client.query("ROLLBACK");
      if (!(err instanceof RollbackSignal)) throw err;
    } finally {
      client.release();
      await pool.end();
    }
  });
});
