import "dotenv/config";
import { db } from "@/lib/db";
import { salesEntries, dailySalesCuts, recipes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
} from "./seed-constants";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function main() {
  console.log("=== Phase 12: Sales POS & Daily Cuts (30 Days) ===");
  console.log("Cleaning up previous sales entries...");

  await db.delete(salesEntries).where(eq(salesEntries.companyId, COMPANY_ID));
  await db.delete(dailySalesCuts).where(eq(dailySalesCuts.companyId, COMPANY_ID));

  const allRecipes = await db.select().from(recipes).where(eq(recipes.companyId, COMPANY_ID));
  if (allRecipes.length === 0) {
    console.warn("No recipes found to seed sales. Run Phase 4 first.");
    return;
  }

  // Filtrar solo las recetas de venta (las que tienen priceSelling > 0)
  const sellableRecipes = allRecipes.filter(r => r.priceSelling > 0);
  console.log(`Found ${sellableRecipes.length} sellable menu recipes.`);

  const branches = [BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA];
  const now = new Date();

  console.log("Generating 30 days of sales entries and daily cuts per branch...");

  const salesEntryValues: any[] = [];
  const cutValues: any[] = [];

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

      // Corte diario consolidado (COMPLETO)
      cutValues.push({
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
    }
  }

  console.log(`Inserting ${salesEntryValues.length} sales entries...`);
  await db.insert(salesEntries).values(salesEntryValues);

  console.log(`Inserting ${cutValues.length} daily sales cuts...`);
  await db.insert(dailySalesCuts).values(cutValues);

  console.log("Phase 12 complete!");
}
