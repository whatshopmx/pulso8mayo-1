import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { salesEntries, dailySalesCuts, recipes, branchTerminals, tpvShiftBatches } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
} from "./seed-constants";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function main() {
  console.log("=== Phase 12: Sales POS & Daily Cuts (30 Days) ===");
  console.log("Cleaning up previous sales entries, cuts, batches, and terminals...");

  await db.delete(tpvShiftBatches).where(eq(tpvShiftBatches.companyId, COMPANY_ID));
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

  const salesEntryValues: any[] = [];
  const cutValues: any[] = [];
  const batchValues: any[] = [];

  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - daysAgo);
    targetDate.setHours(0, 0, 0, 0); // Medianoche local

    const businessDateStr = targetDate.toISOString().slice(0, 10); // YYYY-MM-DD

    for (const branchId of branches) {
      let branchDailySalesTotal = 0;
      let totalTickets = 0;

      for (const recipe of sellableRecipes) {
        // Generar cantidad vendida diaria según sucursal y día
        const qtySold = randomInt(8, 35);
        const revenue = qtySold * recipe.priceSelling;
        branchDailySalesTotal += revenue;

        salesEntryValues.push({
          companyId: COMPANY_ID,
          branchId,
          recipeId: recipe.id,
          quantitySold: String(qtySold),
          saleDate: targetDate,
          totalRevenue: revenue,
        });
      }

      const tickets = randomInt(40, 110);
      totalTickets += tickets;

      const cashSales = Math.round(branchDailySalesTotal * 0.35);
      const cardSales = Math.round(branchDailySalesTotal * 0.55);
      const otherPayments = branchDailySalesTotal - cashSales - cardSales;

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
        cashCountedCents: cashSales,
        depositedCents: cashSales,
        ticketCount: tickets,
        avgTicket: tickets > 0 ? Math.round(branchDailySalesTotal / tickets) : 0,
        source: "MANUAL_FORM" as const,
        status: "VALIDATED" as const,
        validationNotes: "Cierre de turno validado automáticamente por POS",
      });

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
          capturedBy: USER_GERENTE,
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
          capturedBy: USER_GERENTE,
          createdAt: targetDate,
        });
      }
    }
  }

  console.log(`Inserting ${salesEntryValues.length} sales entries...`);
  await db.insert(salesEntries).values(salesEntryValues);

  console.log(`Inserting ${cutValues.length} daily sales cuts...`);
  await db.insert(dailySalesCuts).values(cutValues);

  console.log(`Inserting ${batchValues.length} TPV shift batches...`);
  await db.insert(tpvShiftBatches).values(batchValues);

  console.log("Phase 12 complete!");
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error("Error in Phase 12:", err);
    process.exit(1);
  });
}

