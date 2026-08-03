import "dotenv/config";

import { db } from "@/lib/db";
import { branches, companies, operationalTwins, corporateTwins, domainEvents } from "@/lib/db/schema";
import { emitDomainEvent } from "@/lib/services/domain-event-service";
import { recalculateTwin, recalculateCorporateTwin } from "@/lib/services/operational-twin-engine";
import { eq } from "drizzle-orm";

async function main() {
  console.log("=================================================");
  console.log("  Testing Operational Twin Engine & Projections  ");
  console.log("=================================================\n");

  // 1. Fetch branch and company from the database
  const branch = await db.query.branches.findFirst() as any;
  const company = await db.query.companies.findFirst() as any;

  if (!branch || !company) {
    console.error("❌ Error: No branches or companies found in the database. Please seed the database first.");
    process.exit(1);
  }

  console.log(`Using Company: ${company.name} (${company.id})`);
  console.log(`Using Branch:  ${branch.name} (${branch.id})\n`);

  // 2. Emit a simulated domain event
  console.log("Step 1: Emitting 'InventoryVarianceDetected' domain event...");
  const event = await emitDomainEvent({
    companyId: company.id,
    branchId: branch.id,
    eventType: "InventoryVarianceDetected",
    payload: {
      itemId: "simulated-item-id",
      itemName: "Simulated Premium Beef Patty",
      varianceQuantity: -10,
      estimatedCostCents: 4500, // $45.00 MXN
    },
  });

  console.log(`✅ Event emitted: ${event.eventType} (ID: ${event.id})`);
  console.log(`Logged to 'domain_events' table. Processed status: ${event.processed}\n`);

  // 3. Recalculate the Operational Twin for this branch
  console.log("Step 2: Recalculating Operational Twin projection...");
  const twin = await recalculateTwin(branch.id);
  console.log("✅ Twin recalculation completed successfully!");
  console.log(`- State:              ${twin.currentState}`);
  console.log(`- Health Score:       ${twin.healthScore}/100`);
  console.log(`- Drift Score:        ${twin.driftScore}/100`);
  console.log(`- Margin Leakage:     $${(twin.marginLeakageScore / 100).toFixed(2)} MXN`);
  console.log(`- Confidence Score:   ${twin.confidenceScore}/100`);
  console.log(`- Last Updated:       ${twin.lastUpdated}`);
  console.log("Sub-states (JSON):");
  console.log("  Execution State:", JSON.stringify(twin.executionState));
  console.log("  Inventory State:", JSON.stringify(twin.inventoryState));
  console.log("  Recipe State:   ", JSON.stringify(twin.recipeState));
  console.log("  Labor State:    ", JSON.stringify(twin.laborState));
  console.log("  Quality State:  ", JSON.stringify(twin.qualityState));
  console.log("  Finance State:  ", JSON.stringify(twin.financeState));
  console.log();

  // 4. Recalculate Corporate Twin for the company
  console.log("Step 3: Recalculating Corporate Twin projection...");
  const corpTwin = await recalculateCorporateTwin(company.id);
  if (corpTwin) {
    console.log("✅ Corporate Twin recalculation completed successfully!");
    console.log(`- Health Score:       ${corpTwin.healthScore}/100`);
    console.log(`- Drift Score:        ${corpTwin.driftScore}/100`);
    console.log(`- Total Net Leakage:  $${(corpTwin.marginLeakageScore / 100).toFixed(2)} MXN`);
    console.log("  Network State:", JSON.stringify(corpTwin.networkState));
  } else {
    console.error("❌ Corporate Twin calculation returned null.");
  }
  console.log("\n=================================================");
  console.log("  Test completed successfully!                  ");
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
