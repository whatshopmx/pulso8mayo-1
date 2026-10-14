// lib/services/stock-count-service.ts
import { db } from "@/lib/db";
import { inventoryItems, inventoryBatches, workflowTemplates, workflowInstances, workflowInstanceSteps, users, branches } from "@/lib/db/schema";
import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { normalizeStockCount, stockCountTotals, stockCountRowKey, type StockCountRow } from "@/lib/workflows/stock-count-grid";
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

/**
 * Redondea a la escala de `stock_counts.counted_quantity` — numeric(12,4).
 * Devuelve 0 para valores no numéricos (un paso sin capturar, texto libre).
 */
export function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

export class StockCountService {
  static async getCountRows(companyId: string, branchId: string, category: string, highValueOnly = false): Promise<StockCountRow[]> {
    const branch = await db.query.branches.findFirst({
      where: and(eq(branches.id, branchId), eq(branches.companyId, companyId)),
      columns: { id: true },
    });
    if (!branch) throw ApiError.badRequest('La sucursal no pertenece a tu empresa.');
    const rows = await db.select({
      itemId: inventoryItems.id, name: inventoryItems.name, sku: inventoryItems.sku,
      unit: inventoryItems.unit, batchId: inventoryBatches.id,
      lotNumber: inventoryBatches.lotNumber, expirationDate: inventoryBatches.expirationDate,
      quantity: inventoryBatches.currentQuantity,
    }).from(inventoryItems).leftJoin(inventoryBatches, and(
      eq(inventoryBatches.itemId, inventoryItems.id), eq(inventoryBatches.branchId, branchId),
      eq(inventoryBatches.status, 'AVAILABLE'),
    )).where(and(
      eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, true),
      eq(inventoryItems.category, category),
      highValueOnly ? eq(inventoryItems.isHighValue, true) : undefined,
    )).orderBy(asc(inventoryItems.name), asc(inventoryBatches.expirationDate), asc(inventoryBatches.id));
    return rows.map(r => ({
      itemId: r.itemId, batchId: r.batchId, name: r.name, sku: r.sku || '', unit: r.unit || 'UNIT',
      lotNumber: r.lotNumber, expirationDate: r.expirationDate ? new Date(r.expirationDate).toISOString().slice(0, 10) : null,
      systemQuantity: roundQty(Number(r.quantity ?? 0)),
    }));
  }

  static async resolveCountSteps(steps: any[], companyId: string, branchId: string): Promise<any[]> {
    const seen = new Set<string>();
    const resolved = [];
    for (const step of steps) {
      if (step.type !== 'STOCK_COUNT') { resolved.push(step); continue; }
      const category = step.config?.category;
      if (typeof category !== 'string' || !category.trim()) throw ApiError.badRequest('Selecciona una categoría para el conteo.');
      const rows = await this.getCountRows(companyId, branchId, category, step.config?.highValueOnly === true);
      if (!rows.length) throw ApiError.badRequest(`No hay productos activos para contar en "${category}".`);
      for (const row of rows) {
        const key = stockCountRowKey(row);
        if (seen.has(key)) throw ApiError.badRequest('Las categorías del conteo incluyen productos y lotes repetidos.');
        seen.add(key);
      }
      resolved.push({ ...step, required: true, config: { ...step.config, rows } });
    }
    return resolved;
  }

  static getCategoryName(categoryValue: string): string {
    const cat = DEFAULT_CATEGORIES.find(c => c.value === categoryValue);
    return cat?.name || categoryValue;
  }

  static async getOrCreateTemplate(companyId: string) {
    const existing = await db.select()
      .from(workflowTemplates)
      .where(and(
        eq(workflowTemplates.companyId, companyId),
        inArray(workflowTemplates.name, [STOCK_COUNT_TEMPLATE_NAME, "📊 Conteo de Inventario"]),
        eq(workflowTemplates.active, true)
      ))
      .limit(1);

    if (existing.length > 0) return existing[0];

    const staticTemplate = templateLibrary['conteo-inventario-v1'];

    const [template] = await db.insert(workflowTemplates).values({
      companyId,
      name: STOCK_COUNT_TEMPLATE_NAME,
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

        // Fase 4: solo filtrar por alto valor si highOnlyValue es explícitamente true.
        // Si no se especifica o es false, devuelve todos los artículos activos de la categoría.
        if (highOnlyValue === true) {
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
        inArray(workflowTemplates.name, [STOCK_COUNT_TEMPLATE_NAME, "📊 Conteo de Inventario"]),
      ))
      .limit(1);

    return active.length > 0 ? active[0] : null;
  }

  static async createStockCountInstance(data: {
    companyId: string;
    branchId: string;
    assigneeId: string;
    categoryValue?: string;
    categories?: string[];
    highOnlyValue?: boolean;
  }) {
    const categories = [...new Set(data.categories ?? (data.categoryValue ? [data.categoryValue] : []))];
    if (!categories.length || categories.some(category => typeof category !== 'string' || !category.trim())) throw ApiError.badRequest('Selecciona al menos una categoría.');
    const activeCount = await this.getActiveCountForBranch(data.branchId);
    if (activeCount) throw ApiError.conflict('Ya existe un conteo activo para esta sucursal. ID: ' + activeCount.id);
    const isHighOnly = data.highOnlyValue === true;
    const steps = await this.resolveCountSteps(categories.map((category, index) => ({
      id: 'stock-count-' + index, type: 'STOCK_COUNT', title: 'Conteo · ' + category,
      description: 'Registra cada producto y lote. El conteo quedará pendiente de revisión.',
      required: true, config: { category, highValueOnly: isHighOnly },
    })), data.companyId, data.branchId);
    const productMap = new Map<string, { id: string; name: string; sku: string; unit: string; currentStock: number }>();
    for (const step of steps) for (const row of step.config.rows as StockCountRow[]) {
      const product = productMap.get(row.itemId) ?? { id: row.itemId, name: row.name, sku: row.sku, unit: row.unit, currentStock: 0 };
      product.currentStock = roundQty(product.currentStock + row.systemQuantity);
      productMap.set(row.itemId, product);
    }
    const products = [...productMap.values()];
    const template = await this.getOrCreateTemplate(data.companyId);
    const instance = await db.transaction(async tx => {
      const [created] = await tx.insert(workflowInstances).values({
        workflowTemplateId: template.id, branchId: data.branchId, assigneeId: data.assigneeId,
        status: 'IN_PROGRESS', startedAt: new Date(),
        data: { stockCountGrid: true, categories, category: categories.join(', '), productCount: products.length,
          highValueOnly: isHighOnly, startTime: new Date().toISOString() },
      }).returning();
      await tx.insert(workflowInstanceSteps).values(steps.map((step, index) => ({
        instanceId: created.id, stepId: step.id, status: 'PENDING' as const, value: null,
        stepOrder: index, title: step.title, type: step.type, definition: step,
      })));
      return created;
    });
    return { instance, template, products, steps };
  }

    static async completeStockCount(instanceId: string, userId: string) {
        const instance = await db.query.workflowInstances.findFirst({
            where: eq(workflowInstances.id, instanceId),
        });

        if (!instance) throw new Error("Instance not found");
        const instanceData = instance.data as Record<string, unknown> || {};
        if (instance.status === 'COMPLETED' && instanceData.stockCountGrid && instanceData.results) {
            return { instanceId, results: instanceData.results };
        }
        if (instance.status === "COMPLETED") throw new Error("Already completed");

        const steps = await db.select()
            .from(workflowInstanceSteps)
            .where(eq(workflowInstanceSteps.instanceId, instanceId));

        const gridSteps = steps.filter(s => (s.definition as { type?: string } | null)?.type === 'STOCK_COUNT');
        if (gridSteps.length && steps.some(s => s.status !== 'COMPLETED' && s.status !== 'SKIPPED')) {
            throw new Error('Hay pasos pendientes antes de enviar el conteo a revisión.');
        }
        const gridRows = gridSteps.flatMap(s => {
            const definition = s.definition as { config: { rows: StockCountRow[] } };
            return normalizeStockCount(definition.config.rows, s.value, true).rows;
        });

        if (!gridSteps.length) {
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
        }

  const results: Array<{
    itemId: string;
    systemQuantity: number;
    physicalQuantity: number;
    variance: number;
    variancePercent: number;
    isAlert: boolean;
  }> = [];

        for (const count of stockCountTotals({ kind: 'stock_count', rows: gridRows })) {
            const variance = roundQty(count.countedQuantity - count.systemQuantity);
            const variancePercent = count.systemQuantity > 0 ? Math.abs(variance) / count.systemQuantity * 100 : (count.countedQuantity > 0 ? 100 : 0);
            results.push({ itemId: count.itemId, systemQuantity: count.systemQuantity, physicalQuantity: count.countedQuantity,
                variance, variancePercent: Math.round(variancePercent * 100) / 100, isAlert: variancePercent > 10 });
        }
        for (const step of gridSteps.length ? [] : steps) {
            if (step.stepId.startsWith("count-")) {
                const stepValue = step.value as string | null;
                const stepData = stepValue ? JSON.parse(stepValue) : {};
                const itemId = stepData.itemId as string;
                const systemQty = stepData.systemQuantity as number || 0;
                // parseFloat, no parseInt: contar 2.5 kg debe registrar 2.5.
                // Se redondea a 4 decimales para no arrastrar ruido binario
                // (2.5 - 2.2 = 0.30000000000000004) hasta el blob de resultados.
                const physicalQty = roundQty(
                    stepData.inputValue ? parseFloat(String(stepData.inputValue)) : 0
                );
                const variance = roundQty(physicalQty - systemQty);

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

    const lotResults = gridRows.map(r => ({ ...r, physicalQuantity: r.countedQuantity!, variance: roundQty(r.countedQuantity! - r.systemQuantity) }));
    await db.update(workflowInstances)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        score: 100,
        data: {
          ...instanceData,
          results,
          ...(gridSteps.length ? { stockCountGrid: true, lotResults, productCount: results.length,
            category: gridSteps.map(s => (s.definition as { config: { category: string } }).config.category).join(', '),
          } : {}),
          // Adjustments are NOT applied here: they require explicit approval
          // from the results page (see applyStockCountAdjustments).
          adjustmentsStatus: (gridSteps.length ? lotResults : results).some(r => r.variance !== 0) ? "PENDING" : "NONE",
          completedAt: new Date().toISOString(),
        },
      })
      .where(eq(workflowInstances.id, instanceId));

    // Saca los resultados del blob a `stock_counts` (filas consultables por
    // ítem/fecha). Best-effort: un fallo aquí no invalida el conteo, que sigue
    // completo en `workflow_instances.data`.
    try {
      const { extractStockCountFromInstance } = await import("./stock-count-from-workflow");
      await extractStockCountFromInstance(instanceId);
    } catch (error) {
      console.error("[StockCount] Error persistiendo stock_counts:", error);
    }

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
        if (instanceData.stockCountGrid) return this.applyLotAdjustments(instanceId, userId);
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
                // `inventory_batches.currentQuantity` ya es numeric(12,4) (T1):
                // la varianza fraccionaria se aplica íntegra, sin redondear. La
                // exacta también queda en `results[]` y en `stock_counts`.
                const quantityChange = r.variance;
                await InventoryService.recordAdjustment({
                    branchId: instance.branchId,
                    itemId: r.itemId,
                    quantityChange,
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

  private static async applyLotAdjustments(instanceId: string, userId: string) {
    return db.transaction(async tx => {
      const [instance] = await tx.select().from(workflowInstances)
        .where(eq(workflowInstances.id, instanceId)).for('update');
      if (!instance || instance.status !== 'COMPLETED') throw ApiError.conflict('El conteo todavía no está completo.');
      const data = instance.data as { adjustmentsStatus: string; lotResults: (StockCountRow & { physicalQuantity: number; variance: number })[] };
      if (data.adjustmentsStatus !== 'PENDING') return { instanceId, applied: 0, alreadyApplied: true };
      const changes = data.lotResults.filter(r => r.variance !== 0);
      const batchIds = changes.map(r => r.batchId).filter((id): id is string => !!id);
      const batches = batchIds.length ? await tx.select().from(inventoryBatches).where(and(
        inArray(inventoryBatches.id, batchIds), eq(inventoryBatches.branchId, instance.branchId),
        eq(inventoryBatches.status, 'AVAILABLE'),
      )).for('update') : [];
      const byId = new Map(batches.map(b => [b.id, b]));
      // Validate every lot before any movement; the whole approval shares one transaction.
      for (const row of changes) {
        if (!row.batchId) continue;
        const batch = byId.get(row.batchId);
        if (!batch || batch.itemId !== row.itemId || Number(batch.currentQuantity) + row.variance < 0) {
          throw ApiError.conflict('Un lote contado cambió o ya no está disponible. Realiza un nuevo conteo antes de ajustar.');
        }
      }
      for (const row of changes) {
        let batchId = row.batchId;
        if (!batchId) {
          const [created] = await tx.insert(inventoryBatches).values({
            itemId: row.itemId, branchId: instance.branchId, currentQuantity: '0', initialQuantity: '0',
            status: 'AVAILABLE', lotNumber: `SC-${instanceId.slice(0, 8)}`, receivedAt: new Date(),
          }).returning();
          batchId = created.id;
        }
        await InventoryService.recordMovement({
          branchId: instance.branchId, itemId: row.itemId, batchId, type: 'ADJUSTMENT', quantityChange: row.variance,
          performedBy: userId, referenceId: instanceId,
          reason: `Conteo por lote: sistema=${row.systemQuantity}, físico=${row.physicalQuantity}`,
        }, tx);
      }
      await tx.update(workflowInstances).set({ data: {
        ...data, adjustmentsStatus: 'APPLIED', adjustmentsAppliedAt: new Date().toISOString(), adjustmentsAppliedBy: userId,
      } }).where(eq(workflowInstances.id, instanceId));
      return { instanceId, applied: changes.length, alreadyApplied: false };
    });
  }

  static async getStockCountHistory(companyId: string, branchId?: string) {
    const conditions: any[] = [
      eq(workflowTemplates.companyId, companyId),
      sql`(${workflowTemplates.name} = ${STOCK_COUNT_TEMPLATE_NAME} OR ${workflowInstances.data}->>'stockCountGrid' = 'true')`,
    ];

    if (branchId) {
      conditions.push(eq(workflowInstances.branchId, branchId));
    }

    const history = await db.select({
      id: workflowInstances.id,
      branchId: workflowInstances.branchId,
      assigneeId: workflowInstances.assigneeId,
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
    const lotResults = (instanceData.lotResults || []) as (StockCountRow & { physicalQuantity: number; variance: number })[];
    const totalAdjustments = instanceData.stockCountGrid ? lotResults.filter(r => r.variance !== 0).length : enrichedResults.filter(r => r.variance !== 0).length;

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
      lotResults,
      summary: { totalProducts, alertCount, totalAdjustments },
      adjustmentsStatus,
    };
  }
}
