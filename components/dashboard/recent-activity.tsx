import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, users } from "@/lib/db/schema";
import { eq, gte, lte, desc, and, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { RecentWorkflowsTable } from "./recent-workflows-table";
import { businessDayEnd, businessDayStart, parseCivilDate } from "@/lib/business-date";

interface RecentActivityProps {
  companyId: string;
  branchId?: string;
  /** Rango civil `YYYY-MM-DD` del selector del encabezado. */
  startDate?: string;
  endDate?: string;
  /** RBAC-01: READONLY no recibe enlaces de ejecución. */
  canExecute: boolean;
}

/**
 * Server Component under the AD-2 floor: owns its own DB query so it can
 * suspend independently inside the page's <Suspense> boundary and stream
 * after the shell paints.
 */
export async function RecentActivity({ companyId, branchId, startDate, endDate, canExecute }: RecentActivityProps) {
  const t = await getTranslations("dashboard.executive");

  const conditions = [eq(workflowTemplates.companyId, companyId)];
  if (branchId && branchId !== 'all') {
    conditions.push(eq(workflowInstances.branchId, branchId));
  }

  // F04: la bitácora sí es histórica. Antes el selector de fecha de la
  // cabecera no tocaba ningún panel del dashboard y parecía no hacer nada.
  if (startDate) {
    conditions.push(gte(workflowInstances.updatedAt, businessDayStart(parseCivilDate(startDate))));
  }
  if (endDate) {
    conditions.push(lte(workflowInstances.updatedAt, businessDayEnd(parseCivilDate(endDate))));
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
      <RecentWorkflowsTable workflows={formattedWorkflows} canExecute={canExecute} />
    </div>
  );
}
