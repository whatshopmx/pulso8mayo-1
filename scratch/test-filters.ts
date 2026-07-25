import "dotenv/config";
import { db } from "../lib/db";
import { users, branches, workflowInstances, incidents } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const companyId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  // Users that the filter dropdown shows
  const filterUsers = await db.select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.companyId, companyId));

  console.log("--- Filter dropdown users ---");
  filterUsers.forEach(u => console.log(`  ${u.id} = ${u.name}`));

  // Unique assignees in workflows (what's actually in the data)
  const wfAssignees = await db.selectDistinct({ assigneeId: workflowInstances.assigneeId })
    .from(workflowInstances);
  console.log("\n--- Workflow assigneeIds ---");
  wfAssignees.forEach(w => console.log(`  ${w.assigneeId}`));

  // Unique detectedBy in incidents
  const incDetectors = await db.selectDistinct({ detectedBy: incidents.detectedBy })
    .from(incidents);
  console.log("\n--- Incident detectedBy ---");
  incDetectors.forEach(i => console.log(`  ${i.detectedBy}`));

  // Check overlap
  const filterIds = new Set(filterUsers.map(u => u.id));
  const dataIds = new Set([
    ...wfAssignees.map(w => w.assigneeId),
    ...incDetectors.map(i => i.detectedBy),
  ]);
  
  console.log("\n--- Overlap analysis ---");
  console.log("Filter user IDs:", filterIds.size);
  console.log("Data user IDs:", dataIds.size);
  const overlap = [...dataIds].filter(id => filterIds.has(id!));
  const missing = [...dataIds].filter(id => !filterIds.has(id!));
  console.log("Matching:", overlap.length);
  console.log("In data but NOT in filter dropdown:", missing);

  // Branch overlap
  const filterBranches = await db.select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  const wfBranches = await db.selectDistinct({ branchId: workflowInstances.branchId })
    .from(workflowInstances);
  const incBranches = await db.selectDistinct({ branchId: incidents.branchId })
    .from(incidents);

  console.log("\n--- Branch filter dropdown ---");
  filterBranches.forEach(b => console.log(`  ${b.id} = ${b.name}`));
  
  console.log("\n--- Workflow branchIds ---");
  wfBranches.forEach(w => console.log(`  ${w.branchId}`));
  
  console.log("\n--- Incident branchIds ---");
  incBranches.forEach(i => console.log(`  ${i.branchId}`));

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
