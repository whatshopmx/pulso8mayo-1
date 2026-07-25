import "dotenv/config";
import { db } from "../lib/db";
import { workflowInstances, workflowTemplates, branches, users, incidents } from "../lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

async function main() {
  const companyId = "c0849202-0c2f-4e01-9a7c-9b7e9ef20bb1"; // or a valid companyId from DB

  // Let's just find first user or branch
  const firstUser = await db.select().from(users).limit(1);
  if (firstUser.length === 0) {
    console.log("No users found");
    return;
  }
  const compId = firstUser[0].companyId;
  console.log("Using companyId:", compId);

  const workflowLogs = await db.select({
      id: workflowInstances.id,
      action: sql<string>`'WORKFLOW_' || ${workflowInstances.status}`,
      resource: workflowTemplates.name,
      resourceType: sql<string>`'WORKFLOW'`,
      createdAt: workflowInstances.createdAt,
  })
      .from(workflowInstances)
      .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
      .where(eq(workflowTemplates.companyId, compId))
      .limit(1);

  console.log("Workflow log sample:", workflowLogs);
}

main().catch(console.error);
