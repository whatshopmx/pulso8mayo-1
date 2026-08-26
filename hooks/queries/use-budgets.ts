"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Hooks de Presupuestos por sucursal × centro de costo × mes (Task 9, plan-ordenes-oc-os).
 * API: /api/budgets — GET devuelve el grid mensual completo; PUT hace upsert de una
 * celda (solo ADMIN+, 403 para el resto). El alcance de sucursal fijo del tenant
 * (GERENTE/SUPERVISOR) lo impone el servidor.
 *
 * Dinero SIEMPRE en centavos integer; meses "YYYY-MM".
 */

export interface BudgetRow {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  costCenterId: string;
  costCenterCode: string | null;
  costCenterName: string;
  accountingLine: string | null;
  /** Centavos. */
  budgeted: number;
  /** Centavos: OC/OS aprobadas que comprometen presupuesto. */
  committed: number;
  /** Centavos: budgeted − committed (puede ser negativo si se excedió). */
  available: number;
  /** Comprometido ≥ 90% del presupuestado → alerta visual. */
  alert: boolean;
}

export function useBudgets(month: string, branchId?: string) {
  return useQuery({
    queryKey: ["budgets", month, branchId ?? null],
    queryFn: async () => {
      const sp = new URLSearchParams({ month });
      if (branchId) sp.set("branchId", branchId);
      const res = await fetch(`/api/budgets?${sp.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Error al cargar presupuestos");
      return data as { month: string; rows: BudgetRow[] };
    },
    staleTime: 15 * 1000,
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
}

/** Upsert de una celda del grid. `amount` en centavos; el API rechaza no-ADMIN con 403. */
export function useSaveBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      branchId: string;
      costCenterId: string;
      month: string;
      amount: number; // centavos
    }) => {
      const res = await fetch("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Error al guardar el presupuesto");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }),
  });
}
