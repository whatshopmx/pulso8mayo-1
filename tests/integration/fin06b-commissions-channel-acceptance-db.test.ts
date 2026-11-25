/**
 * FIN-06.b — Aceptación V2 en Neon bajo rol `pulso_app` (NOBYPASSRLS).
 *
 * Verifica en transacción aislada con rollback:
 * 1. Distinción explícita entre tarifa estimada (`RATE_ESTIMATE`), comisión reportada
 *    (`GATEWAY_REPORTED` / `AGGREGATOR_REPORTED`) y comisión conciliada en banco (`BANK_RECONCILED`).
 * 2. Cuadre aritmético neto / bruto / IVA / diferencia según fuente:
 *    - Tarifa estimada (`rappi` 27.50% + 16% IVA): `base - feeBase - feeVat === expectedNet`.
 *    - Pasarela conciliada (`CLIP` matched): `gross - fee - vat === expectedNet === bankMatched`, `discrepancy === 0`.
 *    - Pasarela reportada sin abono (`CLIP` unmatched): visible en `getPlatformCrossReport` con `bankMatched = 0` y `bankDifference = -net`.
 *    - Discrepancia bancaria (`-$5.00`) + liberación tras corrección (`BAN-06.b` compatibility): regresa limpiamente a `PENDING` sin doble conteo.
 * 3. Dato faltante total (`NO_DATA`) y parcial (sucursal con TPV conciliado + Uber sin tarifa ni liquidación):
 *    nunca se presenta como costo firme (`MEASURED`) ni como cero documentado.
 * 4. Aislamiento multi-tenant bajo `pulso_app` en `getCommissionsByBranch` y `GatewayReportService.getPlatformCrossReport`.
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  bankTransactions,
  branches,
  channelCommissionRates,
  companies,
  companyBankAccounts,
  dailySalesCuts,
  gatewayTransactions,
  users,
} from "@/lib/db/schema";
import { getCommissionsByBranch } from "@/lib/services/commission-service";
import { GatewayReportService } from "@/lib/services/gateway-report-service";
import { buildPnlCommissionPresentation } from "@/lib/services/pnl-service";

const TEST_DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = TEST_DB_URL ? describe : describe.skip;

class RollbackSignal extends Error {
  constructor() {
    super("ROLLBACK_TEST_TX");
  }
}

describeDb("FIN-06.b — Aceptación comisiones e ingresos por canal (V2 Neon / pulso_app)", () => {
  it("cuadra bruto/neto/IVA/diferencia por fuente, distingue estimada/reportada/conciliada y no presenta faltantes como costo firme", async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    const client = await pool.connect();

    const suffix = crypto.randomBytes(4).toString("hex");
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    const userA = `fin06b-user-a-${suffix}`;
    const userB = `fin06b-user-b-${suffix}`;

    const branchEstimate = crypto.randomUUID();
    const branchReported = crypto.randomUUID();
    const branchReconciled = crypto.randomUUID();
    const branchDiscrepant = crypto.randomUUID();
    const branchPartialMissing = crypto.randomUUID();
    const branchTotalMissing = crypto.randomUUID();
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

      const now = new Date();
      await txDb.insert(companies).values([
        { id: companyA, name: `FIN06B Co A ${suffix}` },
        { id: companyB, name: `FIN06B Co B ${suffix}` },
      ]);

      await txDb.insert(users).values([
        {
          id: userA,
          email: `fin06b-a-${suffix}@test.local`,
          name: "FIN06B Admin A",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: "ADMIN",
          companyId: companyA,
        },
        {
          id: userB,
          email: `fin06b-b-${suffix}@test.local`,
          name: "FIN06B Admin B",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: "ADMIN",
          companyId: companyB,
        },
      ]);

      await txDb.insert(branches).values([
        { id: branchEstimate, companyId: companyA, name: "Suc Tarifa Estimada" },
        { id: branchReported, companyId: companyA, name: "Suc Pasarela Reportada" },
        { id: branchReconciled, companyId: companyA, name: "Suc Banco Conciliado" },
        { id: branchDiscrepant, companyId: companyA, name: "Suc Discrepante" },
        { id: branchPartialMissing, companyId: companyA, name: "Suc Cobertura Parcial" },
        { id: branchTotalMissing, companyId: companyA, name: "Suc Sin Datos" },
        { id: branchB, companyId: companyB, name: "Suc Empresa B" },
      ]);

      await txDb.insert(companyBankAccounts).values({
        id: bankAccountA,
        companyId: companyA,
        label: "BBVA Recepción FIN06B",
        accountNumber: `enc-fin06b-${suffix}`,
        accountLastFour: "8899",
        accountFingerprint: `fp-fin06b-${suffix}`,
        bankCode: "012",
        bankName: "BBVA",
        currency: "MXN",
        purpose: "RECEPCION",
        active: true,
        registeredBy: userA,
      });

      // Tarifa configurada sólo para Rappi (27.50% + 16% IVA); Uber queda sin tarifa a propósito
      await txDb.insert(channelCommissionRates).values({
        companyId: companyA,
        branchId: null,
        channel: "rappi",
        rateBps: 2750,
        vatBps: 1600,
        effectiveFrom: "2026-01-01",
        createdBy: userA,
      });

      const periodDate = "2026-11-10";
      const txTs = new Date("2026-11-10T16:00:00Z");

      await txDb.insert(dailySalesCuts).values([
        {
          companyId: companyA,
          branchId: branchEstimate,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 100_000,
          cashSales: 0,
          cardSales: 0,
          aggregatorSales: { rappi: 100_000 },
        },
        {
          companyId: companyA,
          branchId: branchReported,
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
          branchId: branchReconciled,
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
          branchId: branchPartialMissing,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 140_000,
          cashSales: 0,
          cardSales: 100_000,
          aggregatorSales: { uber: 40_000 }, // Sin tarifa ni liquidación
        },
        {
          companyId: companyA,
          branchId: branchTotalMissing,
          businessDate: periodDate,
          shift: "COMPLETO",
          source: "MANUAL_FORM",
          receivedBy: userA,
          totalSales: 40_000,
          cashSales: 0,
          cardSales: 0,
          aggregatorSales: { uber: 40_000 },
        },
      ]);

      const gwRepId = crypto.randomUUID();
      const gwRecId = crypto.randomUUID();
      const gwDiscId = crypto.randomUUID();
      const gwPartialId = crypto.randomUUID();

      await txDb.insert(gatewayTransactions).values([
        {
          id: gwRepId,
          companyId: companyA,
          branchId: branchReported,
          acquirer: "CLIP",
          externalId: `fin06b-rep-${suffix}`,
          transactionDate: txTs,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-11-11",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
        {
          id: gwRecId,
          companyId: companyA,
          branchId: branchReconciled,
          acquirer: "CLIP",
          externalId: `fin06b-rec-${suffix}`,
          transactionDate: txTs,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-11-11",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
        {
          id: gwDiscId,
          companyId: companyA,
          branchId: branchDiscrepant,
          acquirer: "BBVA",
          externalId: `fin06b-disc-${suffix}`,
          transactionDate: txTs,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-11-11",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
        {
          id: gwPartialId,
          companyId: companyA,
          branchId: branchPartialMissing,
          acquirer: "SANTANDER",
          externalId: `fin06b-part-${suffix}`,
          transactionDate: txTs,
          grossAmountCents: 100_000,
          feeAmountCents: 2_500,
          feeVatCents: 400,
          netAmountCents: 97_100,
          settlementDate: "2026-11-11",
          destinationBankAccountId: bankAccountA,
          importedBy: userA,
        },
      ]);

      const bankDiscId = crypto.randomUUID();
      await txDb.insert(bankTransactions).values([
        {
          companyId: companyA,
          sourceBankAccountId: bankAccountA,
          valueDate: "2026-11-11",
          description: "ABONO CLIP EXACTO",
          reference: `fin06b-bk-rec-${suffix}`,
          amountCents: 97_100,
          fingerprint: `fin06b-fp-rec-${suffix}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwRecId,
          matchedBy: userA,
          importedBy: userA,
        },
        {
          id: bankDiscId,
          companyId: companyA,
          sourceBankAccountId: bankAccountA,
          valueDate: "2026-11-11",
          description: "ABONO BBVA CON FALTANTE $5",
          reference: `fin06b-bk-disc-${suffix}`,
          amountCents: 96_600,
          fingerprint: `fin06b-fp-disc-${suffix}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwDiscId,
          matchedBy: userA,
          importedBy: userA,
        },
        {
          companyId: companyA,
          sourceBankAccountId: bankAccountA,
          valueDate: "2026-11-11",
          description: "ABONO SANTANDER EXACTO",
          reference: `fin06b-bk-part-${suffix}`,
          amountCents: 97_100,
          fingerprint: `fin06b-fp-part-${suffix}`,
          matchStatus: "MATCHED",
          matchedGatewayTransactionId: gwPartialId,
          matchedBy: userA,
          importedBy: userA,
        },
      ]);

      // Cambiar a rol de aplicación sujeto a RLS (`pulso_app`)
      await txDb.execute(sql`SET LOCAL ROLE pulso_app`);
      const roleCheck = await txDb.execute(
        sql`SELECT current_user AS u, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
      );
      expect(roleCheck.rows[0]).toMatchObject({
        u: "pulso_app",
        rolbypassrls: false,
        rolsuper: false,
      });

      await txDb.execute(sql`SELECT set_config('app.current_company_id', ${companyA}, true)`);

      const comms = await getCommissionsByBranch(companyA, "2026-11-01", "2026-11-30", txDb);
      const byBranch = new Map(comms.map((c) => [c.branchId, c]));

      // 1. Tarifa estimada (Rappi 27.50% + 16% IVA): neto/bruto/IVA cuadran exacto
      const est = byBranch.get(branchEstimate)!;
      expect(est.amountSource).toBe("RATE_ESTIMATE");
      expect(est.reconciliationStatus).toBe("PENDING");
      expect(est.totalFeeBaseCents).toBe(27_500);
      expect(est.totalFeeVatCents).toBe(4_400);
      expect(est.totalCommissionCents).toBe(31_900);
      expect(est.totalExpectedNetCents).toBe(68_100);
      expect(est.totalBankMatchedCents).toBe(0);
      expect(est.coveredSalesCents - est.totalFeeBaseCents - est.totalFeeVatCents).toBe(
        est.totalExpectedNetCents,
      );
      expect(buildPnlCommissionPresentation(est, 100_000).commissionsLine.source).toBe("ESTIMATED");

      // 2. Comisión reportada en pasarela (sin abono bancario)
      const rep = byBranch.get(branchReported)!;
      expect(rep.amountSource).toBe("GATEWAY_REPORTED");
      expect(rep.reconciliationStatus).toBe("PENDING");
      expect(rep.totalFeeBaseCents).toBe(2_500);
      expect(rep.totalFeeVatCents).toBe(400);
      expect(rep.totalExpectedNetCents).toBe(97_100);
      expect(rep.totalBankMatchedCents).toBe(0);
      expect(rep.reportedCommissionCents).toBe(2_900);
      expect(rep.reconciledCommissionCents).toBe(0);
      expect(buildPnlCommissionPresentation(rep, 100_000).commissionsLine.source).toBe("DERIVED");

      // 3. Comisión conciliada en banco (abono exacto)
      const rec = byBranch.get(branchReconciled)!;
      expect(rec.amountSource).toBe("BANK_RECONCILED");
      expect(rec.reconciliationStatus).toBe("CONFIRMED");
      expect(rec.totalFeeBaseCents).toBe(2_500);
      expect(rec.totalFeeVatCents).toBe(400);
      expect(rec.totalExpectedNetCents).toBe(97_100);
      expect(rec.totalBankMatchedCents).toBe(97_100);
      expect(rec.reconciledCommissionCents).toBe(2_900);
      expect(rec.reportedCommissionCents).toBe(0);
      expect(rec.discrepancyCents).toBe(0);
      expect(buildPnlCommissionPresentation(rec, 100_000).commissionsLine.source).toBe("MEASURED");

      // 4. Reporte de cruce de plataforma: muestra tanto conciliadas como pendientes y discrepantes
      const cross = await GatewayReportService.getPlatformCrossReport(
        { companyId: companyA, startDate: "2026-11-01", endDate: "2026-11-30" },
        txDb,
      );
      const byAcquirer = new Map(cross.map((r: { acquirer: string }) => [r.acquirer, r]));

      // CLIP tiene 1 conciliada + 1 pendiente -> hueco visible (-97,100)
      const clipCross = byAcquirer.get("CLIP") as {
        transactionCount: number;
        matchedCount: number;
        unmatchedCount: number;
        grossCents: number;
        feeCents: number;
        feeVatCents: number;
        netCents: number;
        bankMatchedCents: number;
        bankDifferenceCents: number;
        arithmeticDifferenceCents: number;
        reconciliationStatus: string;
      };
      expect(clipCross).toMatchObject({
        transactionCount: 2,
        matchedCount: 1,
        unmatchedCount: 1,
        grossCents: 200_000,
        feeCents: 5_000,
        feeVatCents: 800,
        netCents: 194_200,
        bankMatchedCents: 97_100,
        bankDifferenceCents: -97_100,
        arithmeticDifferenceCents: 0,
        reconciliationStatus: "PENDING",
      });

      // BBVA tiene 1 matched con faltante -$5.00 -> DISCREPANT
      const bbvaCross = byAcquirer.get("BBVA") as {
        bankDifferenceCents: number;
        reconciliationStatus: string;
      };
      expect(bbvaCross.bankDifferenceCents).toBe(-500);
      expect(bbvaCross.reconciliationStatus).toBe("DISCREPANT");

      // SANTANDER tiene 1 matched exacto -> CONFIRMED
      const santCross = byAcquirer.get("SANTANDER") as {
        bankDifferenceCents: number;
        reconciliationStatus: string;
        amountSource: string;
      };
      expect(santCross.bankDifferenceCents).toBe(0);
      expect(santCross.reconciliationStatus).toBe("CONFIRMED");
      expect(santCross.amountSource).toBe("BANK_RECONCILED");

      // 5. Discrepancia + liberación post-corrección (BAN-06.b): vuelve a PENDING sin duplicar
      const discBefore = byBranch.get(branchDiscrepant)!;
      expect(discBefore.reconciliationStatus).toBe("DISCREPANT");
      expect(discBefore.discrepancyCents).toBe(-500);
      expect(discBefore.totalBankMatchedCents - discBefore.totalExpectedNetCents).toBe(-500);

      await txDb
        .update(bankTransactions)
        .set({ matchStatus: "UNMATCHED", matchedGatewayTransactionId: null })
        .where(eq(bankTransactions.id, bankDiscId));

      const commsAfterRelease = await getCommissionsByBranch(
        companyA,
        "2026-11-01",
        "2026-11-30",
        txDb,
      );
      const discAfter = commsAfterRelease.find((c) => c.branchId === branchDiscrepant)!;
      expect(discAfter.amountSource).toBe("GATEWAY_REPORTED");
      expect(discAfter.reconciliationStatus).toBe("PENDING");
      expect(discAfter.totalBankMatchedCents).toBe(0);
      expect(discAfter.reconciledCommissionCents).toBe(0);
      expect(discAfter.reportedCommissionCents).toBe(2_900);
      expect(discAfter.discrepancyCents).toBe(0);

      // 6. Dato faltante parcial y total: nunca se presenta como costo firme (MEASURED)
      const partial = byBranch.get(branchPartialMissing)!;
      expect(partial.uncoveredSalesCents).toBe(40_000);
      expect(partial.coveragePercent).toBeLessThan(100);
      expect(partial.reconciliationStatus).toBe("PENDING");
      const partialPnl = buildPnlCommissionPresentation(partial, 140_000);
      expect(partialPnl.commissionsLine.source).toBe("DERIVED");
      expect(partialPnl.commissionsLine.source).not.toBe("MEASURED");

      const totalMissing = byBranch.get(branchTotalMissing)!;
      expect(totalMissing.source).toBe("NO_DATA");
      expect(totalMissing.amountSource).toBe("NO_DATA");
      expect(totalMissing.documentedZero).toBe(false);
      expect(buildPnlCommissionPresentation(totalMissing, 40_000).commissionsLine.source).toBe(
        "NO_DATA",
      );

      // 7. Aislamiento RLS bajo pulso_app
      await txDb.execute(sql`SELECT set_config('app.current_company_id', ${companyB}, true)`);
      const commsOtherTenant = await getCommissionsByBranch(
        companyA,
        "2026-11-01",
        "2026-11-30",
        txDb,
      );
      const crossOtherTenant = await GatewayReportService.getPlatformCrossReport(
        { companyId: companyA, startDate: "2026-11-01", endDate: "2026-11-30" },
        txDb,
      );
      expect(commsOtherTenant).toHaveLength(0);
      expect(crossOtherTenant).toHaveLength(0);

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
