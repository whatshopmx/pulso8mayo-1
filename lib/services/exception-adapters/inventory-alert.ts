import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { inventoryAlerts, inventoryItems } from "@/lib/db/schema";
import { ExceptionService } from "../exception-service";
import {
  INVENTORY_ALERT_TITLES,
  normalizeInventorySeverity,
} from "./shared";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "inventory_alert";

/** Alertas de inventario activas → excepción de dominio `inventario`/`ABASTO`. */
export const inventoryAlertAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: inventoryAlerts.id,
        branchId: inventoryAlerts.branchId,
        severity: inventoryAlerts.severity,
        status: inventoryAlerts.status,
        type: inventoryAlerts.type,
        itemName: inventoryItems.name,
        notes: inventoryAlerts.notes,
        detectedAt: inventoryAlerts.detectedAt,
      })
      .from(inventoryAlerts)
      .innerJoin(inventoryItems, eq(inventoryAlerts.itemId, inventoryItems.id))
      .where(
        and(
          eq(inventoryAlerts.companyId, companyId),
          inArray(inventoryAlerts.status, ["ACTIVE", "VIEWED", "IN_PROGRESS"]),
          branchId ? eq(inventoryAlerts.branchId, branchId) : undefined,
        ),
      );

    for (const r of rows) {
      const isCriticalSupply =
        r.type === "LOW_STOCK" || r.type === "OUT_OF_STOCK";
      const title = `${INVENTORY_ALERT_TITLES[r.type] ?? r.type}${
        r.itemName ? `: ${r.itemName}` : ""
      }`;
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "inventario",
        qsrCategory: "ABASTO",
        severity: normalizeInventorySeverity(r.severity),
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: title,
        actionMeta: {
          type: "TRANSFER_STOCK",
          label: "Transferir Insumos",
          url: `/dashboard/inventory/alerts?highlight=${r.id}`,
        },
        metadata: {
          title,
          description: r.notes,
          alertType: r.type,
          sourceStatus: r.status,
          impact: isCriticalSupply
            ? "Riesgo de desabasto en rush de ventas"
            : "Merma o caducidad detectada en almacén",
          detectedAt: r.detectedAt,
        },
      });
    }
    return rows.length;
  },
};
