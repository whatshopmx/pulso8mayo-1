"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Hooks de Órdenes de Servicio (control OC/OS, finzasordenes.md).
 * API: /api/service-orders (+quotes/evidence/conformity/submit) y
 * /api/approval-requests para la resolución de niveles desde el detalle.
 */

export interface ServiceOrderListItem {
  id: string;
  folio: string;
  type: string;
  urgency: string;
  status: string;
  amount: number | null;
  scheduledDate: string | null;
  scope: string | null;
  supplierId: string | null;
  costCenterId: string | null;
  createdAt: string;
  updatedAt: string;
  branchName: string | null;
  branchCode: string | null;
  supplierName: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
}

export function useServiceOrders(params?: {
  branchId?: string;
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["service-orders", "list", params],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (params?.branchId) sp.set("branchId", params.branchId);
      if (params?.status) sp.set("status", params.status);
      if (params?.type) sp.set("type", params.type);
      if (params?.limit !== undefined) sp.set("limit", String(params.limit));
      if (params?.offset !== undefined) sp.set("offset", String(params.offset));
      const res = await fetch(`/api/service-orders?${sp.toString()}`);
      if (!res.ok) throw new Error("Error al cargar órdenes de servicio");
      return res.json() as Promise<{ orders: ServiceOrderListItem[]; total: number; limit: number; offset: number }>;
    },
    staleTime: 15 * 1000,
  });
}

export interface ServiceOrderDetail {
  order: Record<string, unknown> & {
    id: string;
    folio: string;
    type: string;
    urgency: string;
    status: string;
    amount: number | null;
    scope: string | null;
    justification: string | null;
    technicalReport: string | null;
    costCenterId: string | null;
    scheduledDate: string | null;
    completedAt: string | null;
    conformitySignedBy: string | null;
    conformitySignedAt: string | null;
    createdBy: string;
    createdAt: string;
    // Campos enriquecidos por el backend (joins)
    branchName?: string | null;
    branchCode?: string | null;
    costCenterCode?: string | null;
    costCenterName?: string | null;
    supplierName?: string | null;
  };
  quotes: Array<{
    id: string;
    url: string;
    supplierName: string | null;
    amount: number | null;
    notes: string | null;
    createdAt: string;
  }>;
  evidence: Array<{
    id: string;
    type: "ANTES" | "DESPUES";
    url: string;
    description: string | null;
    uploadedBy: string;
    createdAt: string;
  }>;
  approvals: Array<{
    id: string;
    level: number;
    requiredRole: string;
    minQuotes: number;
    status: "PENDING" | "APPROVED" | "REJECTED";
    resolvedBy: string | null;
    resolvedAt: string | null;
    reason: string | null;
  }>;
}

export function useServiceOrder(id: string) {
  return useQuery({
    queryKey: ["service-orders", "detail", id],
    queryFn: async () => {
      const res = await fetch(`/api/service-orders/${id}`);
      if (!res.ok) throw new Error("Error al cargar la orden");
      return res.json() as Promise<ServiceOrderDetail>;
    },
    enabled: !!id,
    staleTime: 10 * 1000,
  });
}

async function postJson(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Error en la operación");
  }
  return res.json();
}

export function useCreateServiceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson("/api/service-orders", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

export function useUpdateServiceOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson(`/api/service-orders/${id}`, body, "PATCH"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

/** Transición operativa: schedule | start | complete | cancel. */
export function useTransitionServiceOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, scheduledDate }: { action: string; scheduledDate?: string }) =>
      postJson(`/api/service-orders/${id}`, { action, ...(scheduledDate ? { scheduledDate } : {}) }, "PATCH"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

export function useSubmitServiceOrder(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson(`/api/service-orders/${id}/submit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

export function useAddQuote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; supplierName?: string; amount?: number; notes?: string }) =>
      postJson(`/api/service-orders/${id}/quotes`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

export function useAddEvidence(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { type: "ANTES" | "DESPUES"; url: string; description?: string }) =>
      postJson(`/api/service-orders/${id}/evidence`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

export function useSignConformity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson(`/api/service-orders/${id}/conformity`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

// ── Aprobaciones (nivel actual del documento) ──

export function useApproveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => postJson(`/api/approval-requests/${requestId}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

export function useRejectRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, reason }: { requestId: string; reason: string }) =>
      postJson(`/api/approval-requests/${requestId}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service-orders"] }),
  });
}

// ── Catálogos auxiliares ──

export function useCostCenters(includeInactive = false) {
  return useQuery({
    queryKey: ["cost-centers", includeInactive],
    queryFn: async () => {
      const res = await fetch(`/api/cost-centers${includeInactive ? "?includeInactive=1" : ""}`);
      if (!res.ok) throw new Error("Error al cargar centros de costo");
      return res.json() as Promise<{
        costCenters: Array<{ id: string; code: string; name: string; accountingLine: string | null }>;
      }>;
    },
    staleTime: 60 * 1000,
  });
}
