import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { inventoryItems, branches, workflowTemplates, workflowInstances, workflowInstanceSteps } from "@/lib/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { STOCK_COUNT_TEMPLATE_NAME } from "@/lib/services/stock-count-service";

/**
 * GET /api/inventory/high-value
 * Fase 4: SKUs de alto valor (80/20) con la fecha del último conteo físico y su
 * inventario teórico. Alimenta la sección "SKUs de alto valor" del dashboard.
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();
    if (!tenant.id) {
      return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
    }
    if (!hasPermission(user.role, "inventory", "read")) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const items = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        sku: inventoryItems.sku,
        category: inventoryItems.category,
        unit: inventoryItems.unit,
        lastCost: inventoryItems.lastCost,
        averageCost: inventoryItems.averageCost,
        isHighValue: inventoryItems.isHighValue,
      })
      .from(inventoryItems)
      .where(and(eq(inventoryItems.companyId, tenant.id), eq(inventoryItems.isHighValue, true)))
      .orderBy(desc(inventoryItems.averageCost), desc(inventoryItems.lastCost));

    // Último conteo físico por SKU: localizamos los pasos "count-<itemId>"
    // completados en instancias terminadas del template de conteo.
    const lastCountPerItem = new Map<string, { instanceId: string; completedAt: Date }>();

    try {
      // Las instancias de conteo se agrupan por sucursal; acotamos al tenant
      // mediante las sucursales de la empresa.
      const branchRows = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.companyId, tenant.id));
      const branchIds = branchRows.map((b) => b.id);

      const counts = await db
        .select({ instanceId: workflowInstances.id, completedAt: workflowInstances.completedAt })
        .from(workflowInstances)
        .innerJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, workflowTemplates.id))
        .where(
          and(
            branchIds.length > 0 ? inArray(workflowInstances.branchId, branchIds) : sql`1=0`,
            eq(workflowInstances.status, "COMPLETED"),
            eq(workflowTemplates.name, STOCK_COUNT_TEMPLATE_NAME)
          )
        );

      if (counts.length > 0) {
        const steps = await db
          .select({
            instanceId: workflowInstanceSteps.instanceId,
            stepId: workflowInstanceSteps.stepId,
            status: workflowInstanceSteps.status,
          })
          .from(workflowInstanceSteps)
          .where(
            and(
              inArray(workflowInstanceSteps.instanceId, counts.map((c) => c.instanceId)),
              eq(workflowInstanceSteps.status, "COMPLETED")
            )
          );

        for (const step of steps) {
          const m = step.stepId.match(/^count-(.+)$/);
          if (!m) continue;
          const instance = counts.find((c) => c.instanceId === step.instanceId);
          if (!instance || !instance.completedAt) continue;
          const existing = lastCountPerItem.get(m[1]);
          if (!existing || instance.completedAt > existing.completedAt) {
            lastCountPerItem.set(m[1], { instanceId: instance.instanceId, completedAt: instance.completedAt });
          }
        }
      }
    } catch (e) {
      console.error("[high-value] count history lookup failed:", e);
    }

    const now = Date.now();
    const enriched = items.map((item) => {
      const last = lastCountPerItem.get(item.id);
      const lastCountedAt = last?.completedAt ?? null;
      const daysSinceLastCount = lastCountedAt
        ? Math.max(0, Math.floor((now - new Date(lastCountedAt).getTime()) / 86_400_000))
        : null;

      // Valor 80/20: aproximación de costo promedio (centavos) ponderada por precio.
      const unitCostCents = item.averageCost ?? item.lastCost ?? null;
      return { ...item, unitCostCents, lastCountedAt, daysSinceLastCount };
    });

    return NextResponse.json({ items: enriched });
  } catch (error) {
    console.error("Failed to fetch high-value SKUs", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}