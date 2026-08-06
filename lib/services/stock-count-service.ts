// lib/services/stock-count-service.ts
import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, inventoryMovements, workflowTemplates, workflowInstances, workflowInstanceSteps, users } from "@/lib/db/schema";
import { eq, and, sql, desc, inArray, isNotNull } from "drizzle-orm";
import { InventoryService } from "./inventory-service";
import { NotificationDispatcher } from "./notification-dispatcher";
import { templateLibrary } from "@/templates";
import { CATEGORIES } from "@/lib/inventory/constants";

export const STOCK_COUNT_TEMPLATE_NAME = "Conteo de Inventario";

export const DEFAULT_CATEGORIES = CATEGORIES.map((c) => ({
  id: c.value.toLowerCase().replace(/\s+\//g, "").replace(/\s+/g, "-"),
  name: c.label,
  value: c.value,
}));

export class StockCountService {
  static getCategoryName(categoryValue: string): string {
    const cat = DEFAULT_CATEGORIES.find(c => c.value === categoryValue);
    return cat?.name || categoryValue;
  }

  static async getOrCreateTemplate(companyId: string) {
    const existing = await db.select()
      .from(workflowTemplates)
      .where(and(
        eq(workflowTemplates.companyId, companyId),
        eq(workflowTemplates.name, STOCK_COUNT_TEMPLATE_NAME),
        eq(workflowTemplates.active, true)
      ))
      .limit(1);

    if (existing.length > 0) return existing[0];

    const staticTemplate = templateLibrary['conteo-inventario-v1'];

    const [template] = await db.insert(workflowTemplates).values({
      companyId,
      name: staticTemplate?.title || STOCK_COUNT_TEMPLATE_NAME,
      description: staticTemplate?.description || "Conteo físico de inventario por categoría",
      category: staticTemplate?.category || "INVENTORY",
      steps: staticTemplate
        ? JSON.stringify(staticTemplate.steps)
        : JSON.stringify(DEFAULT_CATEGORIES.map(cat => ({
            id: `cat-${cat.id}`,
            type: "multiple_choice",
            title: "¿Qué área vas a contar?",
            options: DEFAULT_CATEGORIES.map(c => c.name),
            required: true,
          }))),
      active: true,
    }).returning();

    return template;
  }

    static async getProductsByCategory(companyId: string, categoryValue: string) {
        return db.select({
            id: inventoryItems.id,
            name: inventoryItems.name,
            sku: inventoryItems.sku,
            category: inventoryItems.category,
            unit: inventoryItems.unit,
        })
            .from(inventoryItems)
            .where(and(
                eq(inventoryItems.companyId, companyId),
                eq(inventoryItems.category, categoryValue),
                eq(inventoryItems.active, true)
            ));
    }

    static async getProductsWithStock(companyId: string, branchId: string, categoryValue?: string, highOnlyValue?: boolean) {
        const conditions = [
            eq(inventoryItems.companyId, companyId),
            eq(inventoryItems.active, true),
        ];

        // Fase 4: por defecto solo se cuentan los SKUs de alto valor (80/20).
        // Pasa false para "ver todos".
        if (highOnlyValue !== false) {
            conditions.push(eq(inventoryItems.isHighValue, true));
        }

        if (categoryValue) {
            conditions.push(eq(inventoryItems.category, categoryValue));
        }

        const items = await db.select({
            id: inventoryItems.id,
            name: inventoryItems.name,
            sku: inventoryItems.sku,
            category: inventoryItems.category,
            unit: inventoryItems.unit,
            isHighValue: inventoryItems.isHighValue,
            currentStock: sql<number>`COALESCE((
                SELECT sum(${inventoryBatches.currentQuantity})
                FROM ${inventoryBatches}
                WHERE ${inventoryBatches.itemId} = ${inventoryItems.id}
                AND ${inventoryBatches.branchId} = ${branchId}
                AND ${inventoryBatches.status} = 'AVAILABLE'
            ), 0)`,
        })
            .from(inventoryItems)
            .where(and(...conditions));

        return items;
    }

  static generateStockCountSteps(
    templateSteps: any[],
    products: Array<{ id: string; name: string; sku: string; currentStock: number; unit: string }>,
    categoryValue?: string
  ): any[] {
    const confirmStepIndex = templateSteps.findIndex((s: any) => s.id === "confirm-count");

    const dynamicProductSteps = products.map(p => ({
      id: `count-${p.id}`,
      type: "NUMBER" as const,
      title: `${p.name} (SKU: ${p.sku})`,
      description: `Cantidad en sistema: ${p.currentStock || 0} ${p.unit}. Ingresa la cantidad física encontrada:`,
      required: true,
      unit: p.unit,
      systemQuantity: p.currentStock || 0,
      itemId: p.id,
    }));

    const confirmCountStep: any = {
      id: "confirm-count",
      type: "SELECT" as const,
      title: "¿Confirmas que el conteo está correcto?",
      description: "Una vez confirmado, se generarán los ajustes automáticamente",
      required: true,
      options: [
        { value: "yes", label: "Sí, confirmar y generar ajustes" },
        { value: "no", label: "No, revisar conteo" },
      ],
    };

    if (confirmStepIndex >= 0) {
      const baseSteps = templateSteps.map((s: any) => {
        if (s.id === "category-select") {
          return { ...s, value: categoryValue };
        }
        if (s.id === "confirm-count") {
          return confirmCountStep;
        }
        return s;
      });

      return [
        ...baseSteps.slice(0, confirmStepIndex),
        ...dynamicProductSteps,
        ...baseSteps.slice(confirmStepIndex),
      ];
    }

    return [
      {
        id: "category-select",
        type: "SELECT" as const,
        title: "¿Qué área vas a contar?",
        description: "Selecciona la categoría de productos a contar",
        required: true,
        config: {
          options: DEFAULT_CATEGORIES.map(c => ({ value: c.value, label: c.name })),
        },
        ...(categoryValue ? { value: categoryValue } : {}),
      },
      ...dynamicProductSteps,
      confirmCountStep,
    ];
  }

  static async getActiveCountForBranch(branchId: string) {
    const active = await db.select({ id: workflowInstances.id })
      .from(workflowInstances)
      .innerJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, workflowTemplates.id))
      .where(and(
        eq(workflowInstances.branchId, branchId),
        eq(workflowInstances.status, "IN_PROGRESS"),
        eq(workflowTemplates.name, STOCK_COUNT_TEMPLATE_NAME),
      ))
      .limit(1);

    return active.length > 0 ? active[0] : null;
  }

  static async createStockCountInstance(data: {
    companyId: string;
    branchId: string;
    assigneeId: string;
    categoryValue: string;
    highOnlyValue?: boolean; // Fase 4: por defecto true (solo alto valor)
  }) {
    const activeCount = await this.getActiveCountForBranch(data.branchId);
    if (activeCount) {
      throw new Error(`Ya existe un conteo activo para esta sucursal. ID: ${activeCount.id}`);
    }

    const template = await this.getOrCreateTemplate(data.companyId);
    const products = await this.getProductsWithStock(data.companyId, data.branchId, data.categoryValue, data.highOnlyValue);

        if (products.length === 0) {
            throw new Error("No products found for selected category");
        }

        const templateSteps = typeof template.steps === 'string' ? JSON.parse(template.steps) : template.steps;
        const steps = StockCountService.generateStockCountSteps(templateSteps, products, data.categoryValue);

        const staticTemplate = templateLibrary['conteo-inventario-v1'];

        const [instance] = await db.insert(workflowInstances).values({
            workflowTemplateId: template.id,
            branchId: data.branchId,
            assigneeId: data.assigneeId,
            status: "IN_PROGRESS",
            startedAt: new Date(),
            data: {
                category: data.categoryValue,
                productCount: products.length,
                highValueOnly: data.highOnlyValue !== false, // Fase 4
                startTime: new Date().toISOString(),
                ...(staticTemplate?.aiConfig ? { aiConfig: staticTemplate.aiConfig } : {}),
                ...(staticTemplate?.complianceConfig ? { complianceConfig: staticTemplate.complianceConfig } : {}),
                ...(staticTemplate?.completionActions ? { completionActions: staticTemplate.completionActions } : {}),
            },
        }).returning();

        for (const step of steps) {
            const stepData = 'systemQuantity' in step 
                ? JSON.stringify({ 
                    systemQuantity: (step as { systemQuantity: number }).systemQuantity, 
                    itemId: (step as { itemId: string }).itemId,
                    inputValue: 'value' in step ? (step as { value: string }).value ?? null : null 
                })
                : ('value' in step ? (step as { value: string }).value ?? null : null);
            
            await db.insert(workflowInstanceSteps).values({
                instanceId: instance.id,
                stepId: step.id,
                status: "PENDING",
                value: stepData,
            });
        }

        return { instance, template, products, steps };
    }

    static async completeStockCount(instanceId: string, userId: string) {
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (!instance) throw new Error("Instance not found");
        if (instance.status === "COMPLETED") throw new Error("Already completed");

        const steps = await db.select()
            .from(workflowInstanceSteps)
            .where(eq(workflowInstanceSteps.instanceId, instanceId));

        const instanceData = instance.data as Record<string, unknown> || {};

        const confirmStep = steps.find(s => s.stepId === "confirm-count" || s.stepId === "paso-10");
        const confirmValue = confirmStep?.value as string | null;
        if (!confirmValue) {
            throw new Error("Count not confirmed");
        }
        const isConfirmed = confirmValue === "yes"
            || confirmValue === '{"value":"yes"}'
            || (() => {
                const lowerVal = String(confirmValue).toLowerCase();
                return lowerVal.includes("yes") || lowerVal.includes("sí") || lowerVal.includes("si") || lowerVal.includes("confirmar");
            })();
        if (!isConfirmed) {
            throw new Error("Count not confirmed");
        }

  const results: Array<{
    itemId: string;
    systemQuantity: number;
    physicalQuantity: number;
    variance: number;
    variancePercent: number;
    isAlert: boolean;
  }> = [];

        for (const step of steps) {
            if (step.stepId.startsWith("count-")) {
                const stepValue = step.value as string | null;
                const stepData = stepValue ? JSON.parse(stepValue) : {};
                const itemId = stepData.itemId as string;
                const systemQty = stepData.systemQuantity as number || 0;
                const physicalQty = stepData.inputValue ? parseInt(String(stepData.inputValue), 10) : 0;
                const variance = physicalQty - systemQty;

  const variancePercent = systemQty > 0 ? Math.abs(variance) / systemQty * 100 : (physicalQty > 0 ? 100 : 0);

        results.push({
          itemId,
          systemQuantity: systemQty,
          physicalQuantity: physicalQty,
          variance,
          variancePercent: Math.round(variancePercent * 100) / 100,
          isAlert: variancePercent > 10,
        });
            }
        }

    await db.update(workflowInstances)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        score: 100,
        data: {
          ...instanceData,
          results,
          // Adjustments are NOT applied here: they require explicit approval
          // from the results page (see applyStockCountAdjustments).
          adjustmentsStatus: results.some(r => r.variance !== 0) ? "PENDING" : "NONE",
          completedAt: new Date().toISOString(),
        },
      })
      .where(eq(workflowInstances.id, instanceId));

    const alertItems = results.filter(r => r.isAlert);
    if (alertItems.length > 0) {
      try {
        const category = (instanceData as Record<string, unknown>)?.category as string || "";
        const categoryLabel = this.getCategoryName(category);

        const template = await db.query.workflowTemplates.findFirst({
          where: eq(workflowTemplates.id, instance.workflowTemplateId),
        });
        const companyId = template?.companyId || "";

        if (companyId) {
          const managers = await db.query.users.findMany({
            where: and(
              eq(users.companyId, companyId),
              sql`${users.role} IN ('ADMIN', 'GERENTE', 'SUPERVISOR')`
            )
          });

          await Promise.allSettled(
            managers.map(manager =>
              NotificationDispatcher.sendStockCountVarianceAlert({
                userId: manager.id,
                data: {
                  branchId: instance.branchId,
                  category: categoryLabel,
                  alertCount: alertItems.length,
                  totalProducts: results.length,
                  instanceId,
                },
              })
            )
          );
        }
      } catch (error) {
        console.error("[StockCount] Error sending variance alerts:", error);
      }
    }

    return { instanceId, results };
    }

    /**
     * Applies the pending stock adjustments for a completed count.
     * Idempotent: no-ops if adjustments were already applied or there is nothing to apply.
     */
    static async applyStockCountAdjustments(instanceId: string, userId: string) {
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (!instance) throw new Error("Instance not found");
        if (instance.status !== "COMPLETED") throw new Error("Count not completed");

        const instanceData = instance.data as Record<string, any> || {};
        const adjustmentsStatus = instanceData.adjustmentsStatus as string | undefined;

        // Legacy counts (completed before approval flow) already had adjustments applied.
        if (adjustmentsStatus === "APPLIED" || adjustmentsStatus === "NONE" || adjustmentsStatus === undefined) {
            return { instanceId, applied: 0, alreadyApplied: true };
        }

        const results = (instanceData.results || []) as Array<{
            itemId: string;
            systemQuantity: number;
            physicalQuantity: number;
            variance: number;
        }>;

        let applied = 0;
        for (const r of results) {
            if (r.variance !== 0) {
                await InventoryService.recordAdjustment({
                    branchId: instance.branchId,
                    itemId: r.itemId,
                    quantityChange: r.variance,
                    reason: `Stock count variance: sistema=${r.systemQuantity}, físico=${r.physicalQuantity}`,
                    performedBy: userId,
                    referenceId: instanceId,
                    metadata: { systemQuantity: r.systemQuantity, physicalQuantity: r.physicalQuantity },
                });
                applied++;
            }
        }

        await db.update(workflowInstances)
            .set({
                data: {
                    ...instanceData,
                    adjustmentsStatus: "APPLIED",
                    adjustmentsAppliedAt: new Date().toISOString(),
                    adjustmentsAppliedBy: userId,
                },
            })
            .where(eq(workflowInstances.id, instanceId));

        return { instanceId, applied, alreadyApplied: false };
    }

  static async getStockCountHistory(companyId: string, branchId?: string) {
    const conditions: any[] = [
      sql`${workflowTemplates.name} = ${STOCK_COUNT_TEMPLATE_NAME}`,
    ];

    if (branchId) {
      conditions.push(eq(workflowInstances.branchId, branchId));
    }

    const history = await db.select({
      id: workflowInstances.id,
      branchId: workflowInstances.branchId,
      status: workflowInstances.status,
      data: workflowInstances.data,
      createdAt: workflowInstances.createdAt,
      completedAt: workflowInstances.completedAt,
    })
      .from(workflowInstances)
      .innerJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, workflowTemplates.id))
      .where(and(...conditions))
      .orderBy(desc(workflowInstances.completedAt));

    return history;
  }

  static async getStockCountResults(instanceId: string) {
    const instance = await db.query.workflowInstances.findFirst({
      where: eq(workflowInstances.id, instanceId),
    });

    if (!instance) throw new Error("Instance not found");

    const steps = await db.select()
      .from(workflowInstanceSteps)
      .where(eq(workflowInstanceSteps.instanceId, instanceId));

    const template = await db.query.workflowTemplates.findFirst({
      where: eq(workflowTemplates.id, instance.workflowTemplateId),
    });

    const instanceData = instance.data as Record<string, any> || {};
    const results = (instanceData.results || []) as Array<{
      itemId: string;
      systemQuantity: number;
      physicalQuantity: number;
      variance: number;
      variancePercent?: number;
      isAlert?: boolean;
    }>;

    const itemIds = results.map(r => r.itemId).filter(Boolean);
    const items = itemIds.length > 0 ? await db.select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      sku: inventoryItems.sku,
      unit: inventoryItems.unit,
    })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, itemIds)) : [];

    const itemMap = new Map(items.map(i => [i.id, i]));

    const enrichedResults = results.map(r => {
      const item = itemMap.get(r.itemId);
      const variancePercent = r.variancePercent ?? (r.systemQuantity > 0 ? Math.round(Math.abs(r.variance) / r.systemQuantity * 10000) / 100 : (r.physicalQuantity > 0 ? 100 : 0));
      const isAlert = r.isAlert ?? variancePercent > 10;

      return {
        itemId: r.itemId,
        itemName: item?.name || r.itemId,
        sku: item?.sku || "",
        unit: item?.unit || "",
        systemQuantity: r.systemQuantity,
        physicalQuantity: r.physicalQuantity,
        variance: r.variance,
        variancePercent,
        isAlert,
      };
    });

    const totalProducts = enrichedResults.length;
    const alertCount = enrichedResults.filter(r => r.isAlert).length;
    const totalAdjustments = enrichedResults.filter(r => r.variance !== 0).length;

    // Legacy counts completed before the approval flow applied adjustments immediately.
    const rawStatus = instanceData.adjustmentsStatus as string | undefined;
    const adjustmentsStatus = rawStatus ?? (totalAdjustments > 0 ? "APPLIED" : "NONE");

    return {
      instanceId: instance.id,
      status: instance.status,
      branchId: instance.branchId,
      category: instanceData.category || "",
      productCount: instanceData.productCount || totalProducts,
      completedAt: instance.completedAt,
      createdAt: instance.createdAt,
      templateName: template?.name || "",
      results: enrichedResults,
      summary: { totalProducts, alertCount, totalAdjustments },
      adjustmentsStatus,
    };
  }
}