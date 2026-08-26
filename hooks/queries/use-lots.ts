"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Hooks de lotes de inventario (`inventory_batches`) para la vista FEFO
 * (/dashboard/inventory/lotes). El API ya devuelve las filas ordenadas por
 * `expirationDate` ASC (primero el que vence primero) y coerciona las cantidades
 * numeric(12,4) a number.
 */

export type BatchStatus = "AVAILABLE" | "RESERVED" | "EXPIRED" | "QUARANTINED" | "DEPLETED";

export interface InventoryBatch {
  id: string;
  itemId: string;
  branchId: string;
  lotNumber: string | null;
  productionDate: string | null;
  expirationDate: string | null;
  receivedAt: string | null;
  /** Unidades (numeric 12,4 coercido a number). */
  initialQuantity: number;
  currentQuantity: number;
  /** Centavos por unidad; null si el lote no tiene costo capturado. */
  unitCost: number | null;
  status: BatchStatus;
  branchName: string;
  // Enriquecido por el API (join con inventory_items)
  itemName: string;
  itemSku: string | null;
  itemUnit: string;
}

export function useBatches(params?: {
  itemId?: string;
  branchId?: string;
  status?: BatchStatus;
}) {
  return useQuery({
    queryKey: ["inventory-batches", params ?? {}],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (params?.itemId) sp.set("itemId", params.itemId);
      if (params?.branchId) sp.set("branchId", params.branchId);
      if (params?.status) sp.set("status", params.status);
      const res = await fetch(`/api/inventory/batches?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Error al cargar lotes");
      return data as { batches: InventoryBatch[] };
    },
    staleTime: 15 * 1000,
  });
}
