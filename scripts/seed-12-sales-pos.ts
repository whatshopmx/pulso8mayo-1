import { seedRandom } from "./seed-scenarios";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  salesEntries,
  salesConsumptionIdentities,
  salesConsumptionRevisions,
  dailySalesCuts,
  salesCutCashiers,
  aggregatorSettlements,
  recipes,
  branchTerminals,
  tpvShiftBatches,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { localDateString } from "@/lib/workflows/today";
import { applySaleConsumption } from "@/lib/services/sale-consumption-service";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  DEMO_BRANCHES,
} from "./seed-constants";

function randomInt(min: number, max: number): number {
  return Math.floor(seedRandom("12-sales-pos") * (max - min + 1)) + min;
}

export async function main() {
  console.log("=== Phase 12: Sales POS & Daily Cuts (30 Days) ===");
  console.log("Cleaning up previous sales entries, cuts, batches, and terminals...");

  await db.delete(salesCutCashiers).where(
    eq(salesCutCashiers.cashierUserId, DEMO_BRANCHES[0].operatorId)
  ).catch(() => {});
  await db.delete(aggregatorSettlements).where(eq(aggregatorSettlements.companyId, COMPANY_ID));
  await db.delete(tpvShiftBatches).where(eq(tpvShiftBatches.companyId, COMPANY_ID));
  await db.delete(salesConsumptionRevisions).where(eq(salesConsumptionRevisions.companyId, COMPANY_ID));
  await db.delete(salesConsumptionIdentities).where(eq(salesConsumptionIdentities.companyId, COMPANY_ID));
  await db.delete(salesEntries).where(eq(salesEntries.companyId, COMPANY_ID));
  await db.delete(dailySalesCuts).where(eq(dailySalesCuts.companyId, COMPANY_ID));
  await db.delete(branchTerminals).where(eq(branchTerminals.companyId, COMPANY_ID));

  const allRecipes = await db.select().from(recipes).where(eq(recipes.companyId, COMPANY_ID));
  if (allRecipes.length === 0) {
    console.warn("No recipes found to seed sales. Run Phase 4 first.");
    return;
  }

  // Seed branch terminals catalog
  console.log("Seeding authorized branch terminals...");
  const terminalDefinitions = [
    { id: "f1000001-0000-4000-8000-000000000001", companyId: COMPANY_ID, branchId: BRANCH_CONDESA, serialNumber: "CL-CND-01", alias: "Caja Principal - Clip", acquirer: "CLIP" as const, active: true },
    { id: "f1000001-0000-4000-8000-000000000002", companyId: COMPANY_ID, branchId: BRANCH_CONDESA, serialNumber: "BB-CND-02", alias: "Barra - BBVA", acquirer: "BBVA" as const, active: true },
    { id: "f1000001-0000-4000-8000-000000000003", companyId: COMPANY_ID, branchId: BRANCH_POLANCO, serialNumber: "BB-POL-01", alias: "Caja Principal - BBVA", acquirer: "BBVA" as const, active: true },
    { id: "f1000001-0000-4000-8000-000000000004", companyId: COMPANY_ID, branchId: BRANCH_POLANCO, serialNumber: "ST-POL-02", alias: "Terraza - Santander", acquirer: "SANTANDER" as const, active: true },
    { id: "f1000001-0000-4000-8000-000000000005", companyId: COMPANY_ID, branchId: BRANCH_ROMA, serialNumber: "MP-ROM-01", alias: "Caja Principal - Mercado Pago", acquirer: "MERCADO_PAGO" as const, active: true },
    { id: "f1000001-0000-4000-8000-000000000006", companyId: COMPANY_ID, branchId: BRANCH_ROMA, serialNumber: "CL-ROM-02", alias: "Salon - Clip", acquirer: "CLIP" as const, active: true },
  ];

  await db.insert(branchTerminals).values(terminalDefinitions);

  const terminalsByBranch = new Map<string, typeof terminalDefinitions>();
  for (const term of terminalDefinitions) {
    const list = terminalsByBranch.get(term.branchId) ?? [];
    list.push(term);
    terminalsByBranch.set(term.branchId, list);
  }

  // Filtrar solo las recetas de venta (las que tienen priceSelling > 0)
  const sellableRecipes = allRecipes.filter(r => r.priceSelling > 0);
  console.log(`Found ${sellableRecipes.length} sellable menu recipes.`);

  const branches = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
  const now = new Date();

  console.log("Generating 30 days of sales entries, daily cuts, and TPV batches...");

  const historicalSalesEntryValues: any[] = [];
  const recentSaleInputs: Parameters<typeof applySaleConsumption>[0][] = [];
  const cutValues: any[] = [];
  const batchValues: any[] = [];
  const cashierValues: any[] = [];

  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const businessDateStr = localDateString(new Date(now.getTime() - daysAgo * 86400000), "America/Mexico_City");
    const saleMidnightDate = new Date(`${businessDateStr}T00:00:00.000Z`);
    const targetDate = new Date(`${businessDateStr}T18:00:00Z`);

    for (const branchId of branches) {
      let branchDailySalesTotal = 0;
      let totalTickets = 0;
      const branchMeta = DEMO_BRANCHES.find((branch) => branch.id === branchId)!;

      for (const recipe of sellableRecipes) {
        const qtySold = daysAgo <= 1 ? randomInt(4, 10) : randomInt(8, 35);
        const revenue = qtySold * recipe.priceSelling;
        branchDailySalesTotal += revenue;

        if (daysAgo <= 1) {
          recentSaleInputs.push({
            companyId: COMPANY_ID,
            branchId,
            source: "manual",
            productKey: recipe.id,
            saleDay: businessDateStr,
            recipeId: recipe.id,
            quantitySold: String(qtySold),
            totalRevenueCents: revenue,
            userId: branchMeta.operatorId,
          });
        } else {
          historicalSalesEntryValues.push({
            companyId: COMPANY_ID,
            branchId,
            recipeId: recipe.id,
            quantitySold: String(qtySold),
            saleDate: saleMidnightDate,
            totalRevenue: revenue,
          });
        }
      }

      const tickets = randomInt(40, 110);
      totalTickets += tickets;

      const cashSales = Math.round(branchDailySalesTotal * 0.35);
      const cardSales = Math.round(branchDailySalesTotal * 0.55);
      const otherPayments = branchDailySalesTotal - cashSales - cardSales;
      const rappiSales = Math.round(otherPayments * 0.55);
      const uberSales = Math.round(otherPayments * 0.30);
      const didiSales = otherPayments - rappiSales - uberSales;

      const commissionCents = Math.round(cardSales * 0.029);
      const isTpvVarianceDemo = daysAgo === 4 && branchId === BRANCH_ROMA;
      const tpvDepositCents = daysAgo >= 2
        ? cardSales - commissionCents - (isTpvVarianceDemo ? 18500 : 0)
        : null;

      const isCashVarianceDemo = daysAgo === 2 && branchId === BRANCH_POLANCO;
      const cashCountedCents = isCashVarianceDemo ? cashSales - 12500 : cashSales;

      const cutId = randomUUID();

      // Corte diario consolidado (COMPLETO)
      cutValues.push({
        id: cutId,
        companyId: COMPANY_ID,
        branchId,
        businessDate: businessDateStr,
        shift: "COMPLETO" as const,
        channel: "TOTAL" as const,
        totalSales: branchDailySalesTotal,
        cashSales,
        cardSales,
        otherPayments,
        aggregatorSales: { rappi: rappiSales, ubereats: uberSales, didi: didiSales },
        taxAmount: branchDailySalesTotal - Math.round(branchDailySalesTotal / 1.16),
        cashCountedCents,
        depositedCents: cashCountedCents,
        commissionCents,
        tpvDepositCents,
        ticketCount: tickets,
        avgTicket: tickets > 0 ? Math.round(branchDailySalesTotal / tickets) : 0,
        source: "MANUAL_FORM" as const,
        status: "VALIDATED" as const,
        validationNotes: isTpvVarianceDemo
          ? "Diferencia en liquidación TPV detectada contra lote de cierre"
          : "Cierre de turno validado automáticamente por POS",
        receivedBy: branchMeta.operatorId,
        receivedAt: targetDate,
        createdAt: targetDate,
      });

      if (daysAgo <= 6) {
        cashierValues.push({
          salesCutId: cutId,
          cashierName: `Cajero Turno ${DEMO_BRANCHES.indexOf(branchMeta) + 1}`,
          cashierUserId: branchMeta.operatorId,
          declaredCashCents: cashCountedCents,
          expectedCashCents: cashSales,
          varianceCents: cashCountedCents - cashSales,
          notes: isCashVarianceDemo ? "Faltante de $125.00 MXN en arqueo de turno vespertino" : "Arqueo cuadrado sin diferencias",
          createdAt: targetDate,
        });
      }

      // Generar lotes TPV de respaldo para las terminales autorizadas de esta sucursal
      const branchTerms = terminalsByBranch.get(branchId) ?? [];
      if (branchTerms.length >= 2 && cardSales > 0) {
        const term1Amount = Math.round(cardSales * 0.6);
        const term2Amount = cardSales - term1Amount;

        const tip1 = Math.round(term1Amount * 0.12);
        const tip2 = Math.round(term2Amount * 0.10);

        const batchNum1 = String(1000 + daysAgo * 2 + 1);
        const batchNum2 = String(1000 + daysAgo * 2 + 2);

        batchValues.push({
          companyId: COMPANY_ID,
          branchId,
          salesCutId: cutId,
          terminalId: branchTerms[0].id,
          batchNumber: batchNum1,
          cardAmountCents: term1Amount,
          tipAmountCents: tip1,
          capturedBy: branchMeta.operatorId,
          createdAt: targetDate,
        });

        batchValues.push({
          companyId: COMPANY_ID,
          branchId,
          salesCutId: cutId,
          terminalId: branchTerms[1].id,
          batchNumber: batchNum2,
          cardAmountCents: term2Amount,
          tipAmountCents: tip2,
          capturedBy: branchMeta.operatorId,
          createdAt: targetDate,
        });
      }
    }
  }

  console.log(`Inserting ${historicalSalesEntryValues.length} historical sales entries...`);
  if (historicalSalesEntryValues.length > 0) {
    await db.insert(salesEntries).values(historicalSalesEntryValues);
  }

  console.log(`Applying ${recentSaleInputs.length} recent sales entries with FEFO consumption & revisions...`);
  for (const saleInput of recentSaleInputs) {
    await applySaleConsumption(saleInput);
  }

  console.log(`Inserting ${cutValues.length} daily sales cuts...`);
  await db.insert(dailySalesCuts).values(cutValues);

  if (cashierValues.length > 0) {
    await db.insert(salesCutCashiers).values(cashierValues);
  }

  console.log(`Inserting ${batchValues.length} TPV shift batches...`);
  await db.insert(tpvShiftBatches).values(batchValues);

  console.log("Inserting aggregator settlements (Rappi, UberEats, DiDi)...");
  const periodStartStr = localDateString(new Date(now.getTime() - 14 * 86400000), "America/Mexico_City");
  const periodEndStr = localDateString(new Date(now.getTime() - 7 * 86400000), "America/Mexico_City");
  const recentStartStr = localDateString(new Date(now.getTime() - 6 * 86400000), "America/Mexico_City");
  const recentEndStr = localDateString(now, "America/Mexico_City");

  await db.insert(aggregatorSettlements).values([
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      channel: "rappi",
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      grossSalesCents: 1850000,
      commissionCents: 370000,
      netDepositedCents: 1480000,
      posSalesCents: 1850000,
      varianceCents: 0,
      status: "RECONCILED",
      notes: "Liquidación semanal Rappi Condesa conciliada al 100%",
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
      channel: "ubereats",
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      grossSalesCents: 2100000,
      commissionCents: 462000,
      netDepositedCents: 1593000,
      posSalesCents: 2100000,
      varianceCents: -45000,
      status: "DISCREPANCY",
      notes: "Retención adicional de $450.00 MXN por contracargos promocionales en revisión",
    },
    {
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      channel: "didi",
      periodStart: recentStartStr,
      periodEnd: recentEndStr,
      grossSalesCents: 1240000,
      commissionCents: 248000,
      netDepositedCents: 992000,
      posSalesCents: 1240000,
      varianceCents: 0,
      status: "PENDING",
      notes: "Semana en curso pendiente de dispersión bancaria",
    },
  ]);

  console.log("Phase 12 complete!");
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error("Error in Phase 12:", err);
    process.exit(1);
  });
}
