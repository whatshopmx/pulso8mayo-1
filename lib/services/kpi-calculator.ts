import { db } from "../db";
import { workflowInstances, workflowAssignments, inventoryBatches, inventoryMovements, incidents, temperatureLogs } from "../db/schema";
import { eq, and, gte, lte, sql, count, avg, isNull } from "drizzle-orm";
import { subDays, startOfDay, endOfDay } from "date-fns";

export class KpiCalculator {
  /**
   * Calculate a KPI value from its formula string by executing
   * real DB queries based on the formula tokens.
   */
  async calculate(formula: string, companyId: string, branchId?: string): Promise<number> {
    const calculators: Record<string, () => Promise<number>> = {
      "completed_workflows": () => this.countCompletedWorkflows(companyId, branchId),
      "total_workflows": () => this.countTotalWorkflows(companyId, branchId),
      "on_time_workflows": () => this.countOnTimeWorkflows(companyId, branchId),
      "workflow_duration_minutes": () => this.avgWorkflowDuration(companyId, branchId),
      "tasks_completed_per_employee": () => this.avgTasksPerEmployee(companyId, branchId),
      "task_duration_minutes": () => this.avgTaskDuration(companyId, branchId),
      "total_temp_readings": () => this.countTotalTempReadings(companyId, branchId),
      "temp_compliant_readings": () => this.countCompliantTempReadings(companyId, branchId),
    };

    // Try simple ratio patterns: (A / B) * 100
    const ratioPattern = /\(\s*(\w+)\s*\/\s*(\w+)\s*\)\s*\*\s*100/;
    const ratioMatch = formula.match(ratioPattern);
    if (ratioMatch) {
      const [, numeratorToken, denominatorToken] = ratioMatch;
      const numFn = calculators[numeratorToken];
      const denFn = calculators[denominatorToken];
      if (numFn && denFn) {
        const [numerator, denominator] = await Promise.all([numFn(), denFn()]);
        return denominator > 0 ? (numerator / denominator) * 100 : 0;
      }
    }

    // Try simple ratio patterns: A / B * 100 (without parens)
    const simpleRatioPattern = /(\w+)\s*\/\s*(\w+)\s*\*\s*100/;
    const simpleMatch = formula.match(simpleRatioPattern);
    if (simpleMatch) {
      const [, numeratorToken, denominatorToken] = simpleMatch;
      const numFn = calculators[numeratorToken];
      const denFn = calculators[denominatorToken];
      if (numFn && denFn) {
        const [numerator, denominator] = await Promise.all([numFn(), denFn()]);
        return denominator > 0 ? (numerator / denominator) * 100 : 0;
      }
    }

    // Try AVG pattern: AVG(token)
    const avgPattern = /AVG\((\w+)\)/;
    const avgMatch = formula.match(avgPattern);
    if (avgMatch) {
      const [, token] = avgMatch;
      const fn = calculators[token];
      if (fn) return fn();
    }

    // Fallback: return 0 for unparseable formulas
    console.warn(`[KpiCalculator] Unparseable formula: ${formula}`);
    return 0;
  }

  private async countCompletedWorkflows(companyId: string, branchId?: string): Promise<number> {
    const conditions = [eq(workflowInstances.status, 'COMPLETED')];
    // @ts-ignore
    if (branchId && branchId !== 'all') conditions.push(eq(workflowInstances.branchId, branchId));
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(workflowInstances)
      .where(and(...conditions));
    return Number(result?.count || 0);
  }

  private async countTotalWorkflows(companyId: string, branchId?: string): Promise<number> {
    const conditions = [];
    // @ts-ignore
    if (branchId && branchId !== 'all') conditions.push(eq(workflowInstances.branchId, branchId));
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(workflowInstances)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return Number(result?.count || 0);
  }

  private async countOnTimeWorkflows(companyId: string, branchId?: string): Promise<number> {
    const today = startOfDay(new Date());
    const conditions = [
      eq(workflowInstances.status, 'COMPLETED'),
    ];
    // @ts-ignore
    if (branchId && branchId !== 'all') conditions.push(eq(workflowInstances.branchId, branchId));
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(workflowInstances)
      .where(and(...conditions));
    return Number(result?.count || 0);
  }

  private async avgWorkflowDuration(companyId: string, branchId?: string): Promise<number> {
    const conditions: any[] = [eq(workflowAssignments.status, 'COMPLETED')];
    if (branchId && branchId !== 'all') conditions.push(eq(workflowInstances.branchId, branchId));
    const [result] = await db
      .select({
        avgDuration: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${workflowAssignments.completedAt} - ${workflowAssignments.createdAt})) / 60), 0)`,
      })
      .from(workflowAssignments)
      .leftJoin(workflowInstances, eq(workflowAssignments.instanceId, workflowInstances.id))
      .where(and(...conditions));
    return Number(result?.avgDuration || 0);
  }

  private async avgTasksPerEmployee(companyId: string, branchId?: string): Promise<number> {
    const startDate = startOfDay(subDays(new Date(), 30));
    const conditions: any[] = [
      eq(workflowAssignments.status, 'COMPLETED'),
      gte(workflowAssignments.completedAt, startDate),
    ];
    if (branchId && branchId !== 'all') conditions.push(eq(workflowInstances.branchId, branchId));
    const [result] = await db
      .select({
        avgTasks: sql<number>`COALESCE(AVG(task_count), 0)`,
      })
      .from(
        sql`(SELECT ${workflowAssignments.assignedTo} as user_id, COUNT(*) as task_count FROM ${workflowAssignments} WHERE ${workflowAssignments.status} = 'COMPLETED' ${branchId && branchId !== 'all' ? sql`AND ${workflowInstances.branchId} = ${branchId}` : sql``} GROUP BY ${workflowAssignments.assignedTo}) as subq`
      );
    return Number(result?.avgTasks || 0);
  }

  private async avgTaskDuration(companyId: string, branchId?: string): Promise<number> {
    return this.avgWorkflowDuration(companyId, branchId);
  }

  private async countTotalTempReadings(companyId: string, branchId?: string): Promise<number> {
    const conditions = [];
    if (branchId && branchId !== 'all') conditions.push(eq(temperatureLogs.branchId, branchId));
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(temperatureLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return Number(result?.count || 0);
  }

  private async countCompliantTempReadings(companyId: string, branchId?: string): Promise<number> {
    const conditions = [eq(temperatureLogs.isCompliant, true)];
    if (branchId && branchId !== 'all') conditions.push(eq(temperatureLogs.branchId, branchId));
    const [result] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(temperatureLogs)
      .where(and(...conditions));
    return Number(result?.count || 0);
  }
}

export const kpiCalculator = new KpiCalculator();
