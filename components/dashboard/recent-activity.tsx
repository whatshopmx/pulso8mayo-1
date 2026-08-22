import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, users } from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { RecentWorkflowsTable } from "./recent-workflows-table";

interface RecentActivityProps {
  companyId: string;
  branchId?: string;
}

/**
 * Server Component under the AD-2 floor: owns its own DB query so it can
 * suspend independently inside the page's <Suspense> boundary and stream
 * after the shell paints.
 */
export async function RecentActivity({ companyId, branchId }: RecentActivityProps) {
  const t = await getTranslations("dashboard.executive");

  const conditions = [eq(workflowTemplates.companyId, companyId)];
  if (branchId && branchId !== 'all') {
    conditions.push(eq(workflowInstances.branchId, branchId));
  }

  const recentWorkflows = await db.select({
    id: workflowInstances.id,
    templateName: workflowTemplates.name,
    status: workflowInstances.status,
    score: workflowInstances.score,
    assigneeName: users.name,
    updatedAt: workflowInstances.updatedAt
  })
    .from(workflowInstances)
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
    .where(and(...conditions))
    .orderBy(desc(workflowInstances.updatedAt))
    .limit(10);

  const formattedWorkflows = recentWorkflows.map(workflow => ({
    ...workflow,
    templateName: workflow.templateName || t("noName"),
    assigneeName: workflow.assigneeName || t("unassigned")
  }));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b bg-muted/30">
        <h3 className="text-lg font-bold">{t("recentActivity")}</h3>
      </div>
      <RecentWorkflowsTable workflows={formattedWorkflows} />
    </div>
  );
}
