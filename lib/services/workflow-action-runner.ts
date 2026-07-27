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
  incidents
} from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";
import { InventoryService } from "./inventory-service";
import { StockCountService } from "./stock-count-service";
import { SupplierClaimService } from "./supplier-claim-service";
import { NotificationDispatcher } from "./notification-dispatcher";
import { v4 as uuidv4 } from "uuid";

interface CompletionAction {
  type: string;
  condition?: string;
  message?: string;
  target?: string;
  channel?: string;
}

export class WorkflowActionRunner {
  
  static async runCompletionActions(instanceId: string, userId: string): Promise<void> {
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
          await this.executeAction(action, instance, steps, userId);
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
    userId: string
  ): Promise<void> {
    console.log(`[WorkflowActionRunner] Executing action: ${action.type}`);
    
    const instanceData = (instance.data as Record<string, any>) || {};
    
    switch (action.type) {
      case "UPDATE_INVENTORY":
        await this.handleUpdateInventory(instance, steps, userId);
        break;
        
      case "CREATE_CLAIM":
        await this.handleCreateClaim(instance, steps, userId);
        break;
        
      case "SEND_NOTIFICATION":
        await this.handleSendNotification(action, instance, userId);
        break;

      default:
        console.warn(`[WorkflowActionRunner] Unsupported action type: ${action.type}`);
    }
  }

  private static async handleUpdateInventory(instance: any, steps: any[], userId: string): Promise<void> {
    const instanceData = (instance.data as Record<string, any>) || {};
    const templateId = instance.workflowTemplateId;

    // A. STOCK COUNT TEMPLATE
    if (templateId === "tpl-conteo-inventario-v1" || instanceData.productCount !== undefined) {
      console.log(`[WorkflowActionRunner] Triggering Stock Count complete flow`);
      // For stock counts, we trigger variance calculations. StockCountService will set status to PENDING approval.
      await StockCountService.completeStockCount(instance.id, userId);
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

        // Create batch
        const batch = await InventoryService.createBatch({
          itemId: item.itemId,
          branchId,
          initialQuantity: item.quantity,
          currentQuantity: item.quantity,
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
        });

        // Record receiving movement
        await InventoryService.recordMovement({
          branchId,
          itemId: item.itemId,
          batchId: batch.id,
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
