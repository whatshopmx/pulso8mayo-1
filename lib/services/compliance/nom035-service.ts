import { db } from '@/lib/db';
import { nom035ActionPlans, workflowInstances, workflowTemplates } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export interface ActionPlanInput {
  companyId: string;
  branchId?: string;
  title: string;
  description?: string;
  riskCategory: string;
  priority: string;
  status: string;
  assignedTo?: string;
  dueDate?: Date;
  remediationMeasures?: any[];
  evidenceUrl?: string;
}

export class NOM035Service {
  /**
   * Get all action plans for a company with optional filters
   */
  static async getActionPlans(companyId: string, filters?: { branchId?: string; status?: string; priority?: string }) {
    try {
      const conditions = [eq(nom035ActionPlans.companyId, companyId)];
      
      if (filters?.branchId) {
        conditions.push(eq(nom035ActionPlans.branchId, filters.branchId));
      }
      if (filters?.status) {
        conditions.push(eq(nom035ActionPlans.status, filters.status));
      }
      if (filters?.priority) {
        conditions.push(eq(nom035ActionPlans.priority, filters.priority));
      }

      return await db.query.nom035ActionPlans.findMany({
        where: and(...conditions),
        orderBy: (plans, { desc }) => [desc(plans.createdAt)],
      });
    } catch (error) {
      console.error('[NOM035Service] Error fetching action plans:', error);
      throw error;
    }
  }

  /**
   * Get action plan by ID
   */
  static async getActionPlanById(id: string) {
    try {
      return await db.query.nom035ActionPlans.findFirst({
        where: eq(nom035ActionPlans.id, id),
      });
    } catch (error) {
      console.error('[NOM035Service] Error fetching action plan:', error);
      throw error;
    }
  }

  /**
   * Create a new action plan
   */
  static async createActionPlan(input: ActionPlanInput) {
    try {
      const [newPlan] = await db
        .insert(nom035ActionPlans)
        .values({
          companyId: input.companyId,
          branchId: input.branchId || null,
          title: input.title,
          description: input.description || null,
          riskCategory: input.riskCategory || 'GENERAL',
          priority: input.priority || 'MEDIUM',
          status: input.status || 'PENDING',
          assignedTo: input.assignedTo || null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          remediationMeasures: input.remediationMeasures || [],
          evidenceUrl: input.evidenceUrl || null,
        })
        .returning();
      
      console.log(`[NOM035Service] Created action plan: ${newPlan.id}`);
      return newPlan;
    } catch (error) {
      console.error('[NOM035Service] Error creating action plan:', error);
      throw error;
    }
  }

  /**
   * Update an existing action plan
   */
  static async updateActionPlan(id: string, updates: Partial<ActionPlanInput>) {
    try {
      const [updatedPlan] = await db
        .update(nom035ActionPlans)
        .set({
          ...updates,
          dueDate: updates.dueDate ? new Date(updates.dueDate) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(nom035ActionPlans.id, id))
        .returning();

      console.log(`[NOM035Service] Updated action plan: ${id}`);
      return updatedPlan;
    } catch (error) {
      console.error('[NOM035Service] Error updating action plan:', error);
      throw error;
    }
  }

  /**
   * Delete an action plan
   */
  static async deleteActionPlan(id: string) {
    try {
      await db.delete(nom035ActionPlans).where(eq(nom035ActionPlans.id, id));
      console.log(`[NOM035Service] Deleted action plan: ${id}`);
      return true;
    } catch (error) {
      console.error('[NOM035Service] Error deleting action plan:', error);
      throw error;
    }
  }

  /**
   * Auto-generate a NOM-035/NOM-251 action plan from a failed workflow rule
   */
  static async createActionPlanFromWorkflow(
    instanceId: string,
    ruleId: string,
    message: string,
    userId: string
  ) {
    try {
      console.log(`[NOM035Service] Auto-generating action plan from workflow ${instanceId}, rule: ${ruleId}`);
      
      const instance = await db.query.workflowInstances.findFirst({
        where: eq(workflowInstances.id, instanceId),
      });

      if (!instance) {
        console.warn(`[NOM035Service] Workflow instance not found: ${instanceId}`);
        return null;
      }

      const template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, instance.workflowTemplateId),
      });

      const templateName = template?.name || 'Workflow';
      const category = template?.category || 'GENERAL';
      const isNom035 = template?.complianceType?.includes('035') || templateName.toLowerCase().includes('035');

      const title = `Plan Remedial: Desviación en ${templateName}`;
      const description = `Plan de acción generado automáticamente tras registrarse un hallazgo crítico durante la ejecución de la auditoría/workflow.
Detalle del hallazgo: ${message}
ID Instancia: ${instanceId}
Regla Activada: ${ruleId}`;

      const companyId = template?.companyId || instanceDataCompanyId(instance) || '';
      if (!companyId) {
        console.warn(`[NOM035Service] Could not resolve companyId for instance: ${instanceId}`);
        return null;
      }

      // Create a default remediation measure based on the rule trigger
      const defaultMeasure = {
        id: crypto.randomUUID(),
        title: "Investigación y Medida Correctiva",
        description: message,
        status: "PENDING",
        assignedTo: userId,
        completedAt: null
      };

      // Set due date 7 days from now
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      const planInput: ActionPlanInput = {
        companyId,
        branchId: instance.branchId,
        title,
        description,
        riskCategory: isNom035 ? 'PSICOSOCIAL' : 'NOM-251_HIGIENE',
        priority: 'HIGH',
        status: 'PENDING',
        assignedTo: userId,
        dueDate,
        remediationMeasures: [defaultMeasure],
      };

      return await this.createActionPlan(planInput);
    } catch (error) {
      console.error('[NOM035Service] Error auto-generating action plan:', error);
      return null;
    }
  }
}

// Heuristics to extract company ID from instance structure if not directly stored
function instanceDataCompanyId(instance: any): string | null {
  const data = (instance.data as Record<string, any>) || {};
  return data.companyId || data.tenantId || null;
}
