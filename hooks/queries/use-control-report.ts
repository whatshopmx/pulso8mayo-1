"use client";

import { useQuery } from "@tanstack/react-query";
import type { ControlReportResult } from "@/lib/services/control-kpi-types";

/**
 * KPIs gerenciales de Control OC/OS (Task 10, plan-ordenes-oc-os).
 * API: /api/reports/control — GERENTE+; el alcance fijo de sucursal
 * (GERENTE/SUPERVISOR) lo impone el servidor sobre el `branchId` pedido.
 *
 * Los tipos vienen de `control-kpi-types`, que no tiene runtime de servidor:
 * importarlos aquí no arrastra Drizzle al bundle del navegador.
 */

export type { ControlReportResult };

export function useControlReport(month: string, branchId?: string) {
  return useQuery({
    queryKey: ["control-report", month, branchId ?? null],
    queryFn: async () => {
      const sp = new URLSearchParams({ month });
      if (branchId) sp.set("branchId", branchId);
      const res = await fetch(`/api/reports/control?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Error al cargar los KPIs de control");
      return data as ControlReportResult;
    },
    staleTime: 30 * 1000,
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
}
