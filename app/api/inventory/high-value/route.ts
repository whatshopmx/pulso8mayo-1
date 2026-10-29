import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { db } from "@/lib/db";
import { inventoryItems, branches, stockCounts } from "@/lib/db/schema";
import { eq, and, desc, inArray, lte } from "drizzle-orm";
import { businessDateIso } from "@/lib/business-date";

/**
 * GET /api/inventory/high-value?branchId=
 * Fase 4: SKUs de alto valor (80/20) con la fecha del último conteo físico y su
 * inventario teórico. Alimenta la sección "SKUs de alto valor" del dashboard.
 *
 * La fuente es `stock_counts`, el registro canónico que ya alimenta el snapshot
 * de inventario y los reportes de varianza. Antes se derivaba de pasos
 * `count-<itemId>` de workflows terminados, un modelo anterior que el seed ya no
 * escribe: la API devolvía `lastCountedAt = null` aunque existiera un conteo.
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

    const requestedBranchId = req.nextUrl.searchParams.get("branchId") || undefined;

    // Sucursales de la empresa: validan el branchId pedido y acotan los conteos
    // al tenant. El alcance del rol se resuelve en servidor (F01/F03): un
    // GERENTE no puede pedir el conteo de otra sucursal por query.
    const branchRows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.companyId, tenant.id));
    const branchIds = branchRows.map((b) => b.id);

    const scope = resolveBranchScope(
      user.role,
      user.branchId ?? null,
      requestedBranchId ?? null
    );

    if (scope.kind === "BRANCH" && !branchIds.includes(scope.branchId)) {
      return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 });
    }

    const scopeBranchIds =
      scope.kind === "ALL" ? branchIds : scope.kind === "BRANCH" ? [scope.branchId] : [];

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

    // Último conteo canónico por SKU dentro del alcance autorizado. La fecha
    // del conteo es civil (`date`), no un instante: se compara contra el día de
    // negocio y se devuelve anclada a mediodía UTC para no moverse de día al
    // formatearla.
    const todayIso = businessDateIso();
    const lastCounts =
      scopeBranchIds.length === 0
        ? []
        : await db
            .selectDistinctOn([stockCounts.itemId], {
              itemId: stockCounts.itemId,
              countDate: stockCounts.countDate,
              createdAt: stockCounts.createdAt,
            })
            .from(stockCounts)
            .where(
              and(
                eq(stockCounts.companyId, tenant.id),
                inArray(stockCounts.branchId, scopeBranchIds),
                lte(stockCounts.countDate, todayIso)
              )
            )
            .orderBy(
              stockCounts.itemId,
              desc(stockCounts.countDate),
              desc(stockCounts.createdAt)
            );

    const lastCountByItem = new Map(lastCounts.map((row) => [row.itemId, row]));
    const todayUtc = Date.parse(`${todayIso}T00:00:00.000Z`);

    const enriched = items.map((item) => {
      const last = lastCountByItem.get(item.id);
      const lastCountedAt = last ? `${last.countDate}T12:00:00.000Z` : null;
      const daysSinceLastCount = last
        ? Math.max(
            0,
            Math.floor(
              (todayUtc - Date.parse(`${last.countDate}T00:00:00.000Z`)) / 86_400_000
            )
          )
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
