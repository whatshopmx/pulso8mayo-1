// lib/services/workflow-action-runner.ts
import { db } from "@/lib/db";
import { 
  workflowInstances, 
  workflowInstanceSteps, 
  workflowTemplates, 
  users, 
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  incidents,
  branches,
  aggregatorSettlements
} from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import { InventoryService } from "./inventory-service";
import { StockCountService } from "./stock-count-service";
import { SupplierClaimService } from "./supplier-claim-service";
import { NotificationDispatcher } from "./notification-dispatcher";
import { ExceptionService } from "./exception-service";
import { createAndReconcileAggregatorSettlement } from "./aggregator-settlement-service";
import { extractAggregatorSettlement } from "./aggregator-settlement-extraction";
import { formatCents } from "@/lib/utils";
import { v4 as uuidv4 } from "uuid";

interface CompletionAction {
  type: string;
  condition?: string;
  message?: string;
  target?: string;
  channel?: string;
}

export class WorkflowActionRunner {
  
  static async runCompletionActions(
    instanceId: string, userId: string,
    tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<void> {
    try {
      console.log(`[WorkflowActionRunner] Starting completion actions for instance: ${instanceId}`);
      
      // 1. Fetch the workflow instance with its template
      const instance = await db.query.workflowInstances.findFirst({
        where: eq(workflowInstances.id, instanceId),
      });

      if (!instance) {
        console.error(`[WorkflowActionRunner] Instance not found: ${instanceId}`);
        return;
      }

      const template = await db.query.workflowTemplates.findFirst({
        where: eq(workflowTemplates.id, instance.workflowTemplateId),
      });

      if (!template) {
        console.error(`[WorkflowActionRunner] Template not found: ${instance.workflowTemplateId}`);
        return;
      }

      // Get steps and their values
      const steps = await db.query.workflowInstanceSteps.findMany({
        where: eq(workflowInstanceSteps.instanceId, instanceId),
      });

      // Parse completion actions from template or instance data
      let actions: CompletionAction[] = [];
      if (template.completionActions) {
        actions = typeof template.completionActions === "string"
          ? JSON.parse(template.completionActions)
          : (template.completionActions as CompletionAction[]);
      }

      const instanceData = (instance.data as Record<string, any>) || {};
      if (instanceData.completionActions) {
        actions = instanceData.completionActions;
      }

      if (!actions || actions.length === 0) {
        console.log(`[WorkflowActionRunner] No completion actions defined for instance ${instanceId}`);
        return;
      }

      console.log(`[WorkflowActionRunner] Found ${actions.length} completion action(s)`);

      // Run each action
      for (const action of actions) {
        try {
          await this.executeAction(action, instance, steps, userId, tx);
        } catch (actionError) {
          console.error(`[WorkflowActionRunner] Error executing action ${action.type}:`, actionError);
        }
      }
    } catch (error) {
      console.error("[WorkflowActionRunner] Error running completion actions:", error);
    }
  }

  private static async executeAction(
    action: CompletionAction,
    instance: any,
    steps: any[],
    userId: string,
    tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<void> {
    console.log(`[WorkflowActionRunner] Executing action: ${action.type}`);
    
    const instanceData = (instance.data as Record<string, any>) || {};
    
    switch (action.type) {
      case "UPDATE_INVENTORY":
        await this.handleUpdateInventory(instance, steps, userId, tx);
        break;
        
      case "CREATE_CLAIM":
        await this.handleCreateClaim(instance, steps, userId);
        break;
        
      case "SEND_NOTIFICATION":
        await this.handleSendNotification(action, instance, userId);
        break;

      case "CREATE_REMEDIATION_PLAN":
        await this.handleCreateRemediationPlan(action, instance, steps, userId);
        break;

      case "RECONCILE_AGGREGATOR_SETTLEMENTS":
        await this.handleReconcileAggregatorSettlements(instance, steps, userId);
        break;

      default:
        console.warn(`[WorkflowActionRunner] Unsupported action type: ${action.type}`);
    }
  }

  private static async handleCreateRemediationPlan(
    action: CompletionAction,
    instance: any,
    steps: any[],
    userId: string
  ): Promise<void> {
    try {
      console.log(`[WorkflowActionRunner] Triggering CREATE_REMEDIATION_PLAN completion action`);

      // Check if there are critical incident findings for this instance
      const matchedIncidents = await db.query.incidents.findMany({
        where: eq(incidents.instanceId, instance.id),
      });

      const hasCriticalIncidents = matchedIncidents.some(i => i.severity === 'CRITICAL');

      if (action.condition === "failed_critical" && !hasCriticalIncidents) {
        console.log(`[WorkflowActionRunner] Skipping remediation plan: no critical incidents found`);
        return;
      }

      const { NOM035Service } = await import('./compliance/nom035-service');
      await NOM035Service.createActionPlanFromWorkflow(
        instance.id,
        'completion-action',
        action.message || 'Hallazgo crítico en cierre de workflow',
        userId
      );
    } catch (error) {
      console.error("[WorkflowActionRunner] Error creating completion action remediation plan:", error);
    }
  }

  /**
   * Fase 4 — conciliación semanal de plataformas.
   *
   * La acción de cierre del workflow "Conciliación Semanal de Plataformas"
   * registra la liquidación capturada, la compara contra los cortes del periodo
   * (vía `createAndReconcileAggregatorSettlement`, que suma el canal correcto) y
   * abre una excepción canónica cuando el depósito no cuadra.
   */
  private static async handleReconcileAggregatorSettlements(
    instance: any,
    steps: any[],
    userId: string,
  ): Promise<void> {
    try {
      const extraida = extractAggregatorSettlement(
        (steps ?? []).map((s) => ({ stepId: s.stepId, value: s.value })),
      );
      if (!extraida) {
        console.warn(
          "[WorkflowActionRunner] Conciliación: faltan canal o periodo; no se registra liquidación.",
        );
        return;
      }

      const branch = await db.query.branches.findFirst({
        where: eq(branches.id, instance.branchId),
      });
      if (!branch) {
        console.warn(
          `[WorkflowActionRunner] Conciliación: sucursal ${instance.branchId} no encontrada.`,
        );
        return;
      }

      // Idempotencia: una liquidación por (sucursal, canal, periodo). Reejecutar
      // el workflow no debe crear una segunda verdad para la misma semana.
      const existente = await db.query.aggregatorSettlements.findFirst({
        where: and(
          eq(aggregatorSettlements.companyId, branch.companyId),
          eq(aggregatorSettlements.branchId, instance.branchId),
          eq(aggregatorSettlements.channel, extraida.channel),
          eq(aggregatorSettlements.periodStart, extraida.periodStart),
          eq(aggregatorSettlements.periodEnd, extraida.periodEnd),
        ),
      });
      if (existente) {
        console.log(
          `[WorkflowActionRunner] Conciliación: ya existe la liquidación ${existente.id} para ${extraida.channel}; se omite.`,
        );
        return;
      }

      const settlement = await createAndReconcileAggregatorSettlement({
        companyId: branch.companyId,
        branchId: instance.branchId,
        channel: extraida.channel,
        periodStart: extraida.periodStart,
        periodEnd: extraida.periodEnd,
        grossSalesCents: extraida.grossSalesCents,
        commissionCents: extraida.commissionCents,
        netDepositedCents: extraida.netDepositedCents,
        notes: extraida.notes,
      });

      if (settlement.status === "RECONCILED") {
        console.log(
          `[WorkflowActionRunner] Conciliación de ${extraida.channel} cuadrada (${formatCents(settlement.posSalesCents)}).`,
        );
        return;
      }

      const faltante = settlement.varianceCents < 0;
      await ExceptionService.raise({
        companyId: branch.companyId,
        branchId: instance.branchId,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "high",
        subjectType: "aggregator_settlement",
        subjectId: settlement.id,
        reason:
          `Liquidación de ${extraida.channel} no cuadra con el corte: ` +
          `${faltante ? "faltan" : "sobran"} ${formatCents(Math.abs(settlement.varianceCents))} ` +
          `(Pulso registró ${formatCents(settlement.posSalesCents)}, la plataforma pagará ` +
          `${formatCents(settlement.netDepositedCents + settlement.commissionCents)}).`,
        actorId: userId,
        actionMeta: {
          type: "RESOLVE_ALERT",
          label: "Revisar conciliación de plataformas",
          url: "/dashboard/finance/commissions",
        },
        metadata: {
          title: `Discrepancia en liquidación de ${extraida.channel}`,
          channel: extraida.channel,
          periodStart: extraida.periodStart,
          periodEnd: extraida.periodEnd,
          posSalesCents: settlement.posSalesCents,
          grossSalesCents: settlement.grossSalesCents,
          commissionCents: settlement.commissionCents,
          netDepositedCents: settlement.netDepositedCents,
          varianceCents: settlement.varianceCents,
          evidenceUrls: extraida.evidenceUrls,
          impact:
            "El depósito de la plataforma no coincide con la venta registrada en los cortes del periodo.",
        },
      });
    } catch (error) {
      console.error(
        "[WorkflowActionRunner] Error en la conciliación de plataformas:",
        error,
      );
    }
  }

  private static async handleUpdateInventory(
    instance: any, steps: any[], userId: string,
    tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<void> {
    const instanceData = (instance.data as Record<string, any>) || {};
    const templateId = instance.workflowTemplateId;

    // A. STOCK COUNT TEMPLATE
    if (templateId === "tpl-conteo-inventario-v1" || instanceData.productCount !== undefined) {
      console.log(`[WorkflowActionRunner] Triggering Stock Count complete flow`);
      // For stock counts, we trigger variance calculations. StockCountService will set status to PENDING approval.
      await StockCountService.completeStockCount(instance.id, userId, tx);
      return;
    }

    // B. RECEIVING / MERCHANDISE RECEPTION TEMPLATE
    if (templateId === "tpl-recepcion-mercancia-v2" || templateId.includes("recepcion")) {
      console.log(`[WorkflowActionRunner] Processing Merchandise Reception workflow execution`);

      // Parse fields from steps
      const decisionStep = steps.find(s => s.stepId === "paso-8");
      const decisionValue = decisionStep?.value ? String(decisionStep.value).replace(/"/g, "") : "Aceptar";
      const isRejected = decisionValue === "Rechazar";

      const tempStep = steps.find(s => s.stepId === "paso-3");
      const temperature = tempStep?.value ? Number(String(tempStep.value).replace(/"/g, "")) : undefined;

      const notesStep = steps.find(s => s.stepId === "paso-10");
      const notes = notesStep?.value ? String(notesStep.value).replace(/"/g, "") : "Recepción mediante Workflow";

      const supplierNameStep = steps.find(s => s.stepId === "paso-1");
      const supplierName = supplierNameStep?.value ? String(supplierNameStep.value).replace(/"/g, "") : null;

      // Find supplier by name if possible
      let supplierId = instanceData.supplierId || null;
      if (!supplierId && supplierName) {
        const foundSupplier = await db.query.suppliers.findFirst({
          where: ilike(suppliers.name, `%${supplierName}%`),
        });
        if (foundSupplier) {
          supplierId = foundSupplier.id;
        }
      }

      const purchaseOrderId = instanceData.purchaseOrderId || null;

      // If we don't have a linked Purchase Order, check if there's any dynamic item list
      let itemsToReceive = instanceData.items || [];

      // If no PO and no items list, fetch items from a linked PO or log error
      if (!purchaseOrderId && itemsToReceive.length === 0) {
        console.warn(`[WorkflowActionRunner] Cannot update inventory: No purchaseOrderId or items specified in instance data`);
        return;
      }

      // If PO exists, load its items if none are provided
      if (purchaseOrderId && itemsToReceive.length === 0) {
        const poItems = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, purchaseOrderId));
        itemsToReceive = poItems.map(item => ({
          itemId: item.itemId,
          quantity: item.orderedQuantity - (item.receivedQuantity || 0),
          unitCost: item.unitCost ? item.unitCost / 100 : undefined,
        }));
      }

      console.log(`[WorkflowActionRunner] Receiving ${itemsToReceive.length} items`);

      // Ensure open period
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      const companyId = user?.companyId || instanceData.companyId || "";
      const branchId = instance.branchId;

      await InventoryService.ensureOpenPeriod(companyId, branchId);

      // Process each item
      for (const item of itemsToReceive) {
        if (item.quantity <= 0) continue;

        // If overall workflow rejected, or temperature > 4°C, quarantine the batch
        const isQuarantined = isRejected || (temperature !== undefined && temperature > 4);

        // Convert cost to cents
        const unitCostCents = item.unitCost ? Math.round(item.unitCost * 100) : null;

        // Create batch + RECEIVING movement in one transaction; el movimiento es
        // el único dueño del incremento (evita el doble saldo de recepción).
        await InventoryService.createReceivingBatch({
          itemId: item.itemId,
          branchId,
          initialQuantity: item.quantity,
          lotNumber: item.batchNumber || `SC-WF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          expirationDate: item.expirationDate ? new Date(item.expirationDate) : undefined,
          supplierId,
          unitCost: unitCostCents,
          status: isQuarantined ? "QUARANTINED" : "AVAILABLE",
          supplierBatchInfo: {
            receivedBy: userId,
            receivedAt: new Date().toISOString(),
            notes: `Recibido vía Workflow: ${instance.id}. ${notes}`,
            temperature,
          }
        }, {
          branchId,
          itemId: item.itemId,
          type: "RECEIVING",
          quantityChange: item.quantity,
          reason: notes,
          performedBy: userId,
          referenceId: instance.id,
        });

        // Update PO received quantity
        if (purchaseOrderId) {
          const { PurchaseOrderService } = await import("./purchase-order-service");
          await PurchaseOrderService.recordReceivedQuantity(
            purchaseOrderId,
            item.itemId,
            item.quantity,
            userId
          );
        }

        // Trigger incident if high temperature
        if (temperature !== undefined && temperature > 4) {
          const itemDetails = await InventoryService.getItem(item.itemId);
          await db.insert(incidents).values({
            instanceId: uuidv4(),
            stepId: `WF_RECEIVING_QA_${item.itemId}`,
            branchId,
            severity: "WARNING",
            status: "DETECTED",
            title: `Rechazo de Calidad (Workflow): ${itemDetails?.name || 'Insumo'} por Alta Temperatura`,
            description: `El producto fue recibido con temperatura de ${temperature}°C en el workflow ${instance.id}. Lote en cuarentena.`,
            detectedBy: userId,
            metadata: {
              itemId: item.itemId,
              recordedTemperature: temperature,
              supplierId,
            }
          });
        }
      }

      console.log(`[WorkflowActionRunner] Inventory receiving from workflow execution complete`);
    }
  }

  private static async handleCreateClaim(instance: any, steps: any[], userId: string): Promise<void> {
    const instanceData = (instance.data as Record<string, any>) || {};
    
    // Parse fields from steps
    const decisionStep = steps.find(s => s.stepId === "paso-8");
    const decisionValue = decisionStep?.value ? String(decisionStep.value).replace(/"/g, "") : null;

    // Only create claim if decision was "Rechazar" or if explicitly required
    if (decisionValue === "Rechazar" || instanceData.forceClaim === true) {
      console.log(`[WorkflowActionRunner] Decision was 'Rechazar'. Creating Supplier Claim...`);

      const supplierNameStep = steps.find(s => s.stepId === "paso-1");
      const supplierName = supplierNameStep?.value ? String(supplierNameStep.value).replace(/"/g, "") : null;

      let supplierId = instanceData.supplierId || null;
      if (!supplierId && supplierName) {
        const foundSupplier = await db.query.suppliers.findFirst({
          where: ilike(suppliers.name, `%${supplierName}%`),
        });
        if (foundSupplier) {
          supplierId = foundSupplier.id;
        }
      }

      if (!supplierId) {
        console.warn(`[WorkflowActionRunner] Supplier not found, skipping claim creation`);
        return;
      }

      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      const companyId = user?.companyId || instanceData.companyId || "";
      const branchId = instance.branchId;

      await SupplierClaimService.createClaim({
        companyId,
        branchId,
        supplierId,
        type: "QUALITY",
        description: `Reclamo generado automáticamente por rechazo en el flujo de inspección de calidad/recepción ${instance.id}.`,
        notes: `Generado a partir del workflow ${instance.id} por el usuario ${userId}`,
      });

      console.log(`[WorkflowActionRunner] Supplier Claim created successfully`);
    }
  }

  private static async handleSendNotification(
    action: CompletionAction,
    instance: any,
    userId: string
  ): Promise<void> {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const companyId = user?.companyId || "";
    const branchId = instance.branchId;

    if (!companyId) return;

    // Find users with target roles (e.g. GERENTE, OWNER) in the same company
    const targetRoles = action.target ? action.target.split(",").map(r => r.trim().toUpperCase()) : ["GERENTE"];
    
    const targetUsers = await db.query.users.findMany({
      where: and(
        eq(users.companyId, companyId),
        eq(users.branchId, branchId)
      ),
    });

    const filteredUsers = targetUsers.filter(u => u.role && targetRoles.includes(u.role.toUpperCase()));

    if (filteredUsers.length === 0) {
      console.log(`[WorkflowActionRunner] No target users found with roles: ${targetRoles.join(", ")}`);
      return;
    }

    const title = `Flujo Completado: ${instance.id}`;
    const message = action.message || `El flujo de trabajo ha sido completado por ${user?.name || "un usuario"}.`;

    console.log(`[WorkflowActionRunner] Sending completion notifications to ${filteredUsers.length} users`);

    for (const targetUser of filteredUsers) {
      await NotificationDispatcher.sendNotification({
        userId: targetUser.id,
        title,
        message,
        type: "info",
        eventType: "workflow_assignment", // Using generic workflow assignment event template
        metadata: {
          workflowName: instance.id,
          userName: targetUser.name,
          dueDate: new Date().toLocaleDateString(),
        }
      });
    }
  }
}
