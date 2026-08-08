import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { receivingReports, receivingReportItems, inventoryItems, suppliers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * GET /api/inventory/supplier-variance
 * Fase 5: varianza por proveedor (ordenado vs. recibido) agregada sobre
 * receiving_report_items. Alimenta la card del dashboard de proveedores:
 * "Proveedor X: −4% de faltante los viernes".
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();
    if (!tenant.id) return NextResponse.json({ error: "Sin empresa" }, { status: 403 });
    if (!hasPermission(user.role, "inventory", "read")) {
      return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
    }

    const rows = await db
      .select({
        supplierId: receivingReports.supplierId,
        supplierName: suppliers.name,
        itemName: inventoryItems.name,
        orderedQty: receivingReportItems.orderedQuantity,
        receivedQty: receivingReportItems.receivedQuantity,
        unitCost: receivingReportItems.unitCost,
        receivedAt: receivingReports.receivedAt,
      })
      .from(receivingReportItems)
      .innerJoin(receivingReports, eq(receivingReportItems.receivingReportId, receivingReports.id))
      .leftJoin(suppliers, eq(receivingReports.supplierId, suppliers.id))
      .leftJoin(inventoryItems, eq(receivingReportItems.itemId, inventoryItems.id))
      .where(
        and(
          eq(receivingReports.companyId, tenant.id),
          sql`${receivingReportItems.orderedQuantity} IS NOT NULL`
        )
      );

    const bySupplier = new Map<string, {
      supplierId: string;
      name: string;
      reports: number;
      shortQty: number;
      receivedQty: number;
      orderedQty: number;
      shortValueCents: number;
      byDay: Record<string, { shortQty: number; count: number }>;
    }>();

    const addDay = (map: Record<string, { shortQty: number; count: number }>, day: string, short: number) => {
      if (!map[day]) map[day] = { shortQty: 0, count: 0 };
      map[day].shortQty += short;
      map[day].count += 1;
    };

    for (const r of rows) {
      const sid = r.supplierId || "unknown";
      if (!bySupplier.has(sid)) {
        bySupplier.set(sid, {
          supplierId: sid,
          name: r.supplierName || "Sin proveedor",
          reports: 0,
          shortQty: 0,
          receivedQty: 0,
          orderedQty: 0,
          shortValueCents: 0,
          byDay: {},
        });
      }
      const agg = bySupplier.get(sid)!;
      const ordered = r.orderedQty ?? 0;
      const received = r.receivedQty ?? 0;
      const short = Math.max(0, ordered - received);
      agg.orderedQty += ordered;
      agg.receivedQty += received;
      agg.shortQty += short;
      agg.shortValueCents += short * (r.unitCost ?? 0);
      if (short > 0 && r.receivedAt) {
        const day = new Date(r.receivedAt).toLocaleDateString("es-MX", { weekday: "long" });
        addDay(agg.byDay, day, short);
      }
      agg.reports += 1;
    }

    const result = Array.from(bySupplier.values()).map((a) => {
      const shortagePct = a.orderedQty > 0 ? (a.shortQty / a.orderedQty) * 100 : 0;
      // pico = día con más faltante
      let peakDay: { day: string; shortQty: number } | null = null;
      for (const [day, v] of Object.entries(a.byDay)) {
        if (!peakDay || v.shortQty > peakDay.shortQty) peakDay = { day, shortQty: v.shortQty };
      }
      return {
        supplierId: a.supplierId,
        name: a.name,
        reports: a.reports,
        shortQty: a.shortQty,
        orderedQty: a.orderedQty,
        receivedQty: a.receivedQty,
        shortagePct: Math.round(shortagePct * 100) / 100,
        shortValueCents: a.shortValueCents,
        byDay: a.byDay,
        peakDay,
      };
    });

    return NextResponse.json({ suppliers: result });
  } catch (error) {
    console.error("Failed to compute supplier variance", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}