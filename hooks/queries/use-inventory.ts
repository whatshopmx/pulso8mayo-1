import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export function useInventory(branchId?: string) {
  return useQuery({
    queryKey: ["inventory", branchId],
    queryFn: async () => {
      const url = branchId
        ? `/api/inventory/products?branchId=${branchId}`
        : "/api/inventory/products"
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch products")
      return res.json()
    },
    staleTime: 30 * 1000,
  })
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ["inventory", "product", id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/products/${id}`)
      if (!res.ok) throw new Error("Failed to fetch product")
      return res.json()
    },
    enabled: !!id,
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/inventory/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al crear producto")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
    },
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) => {
      const res = await fetch(`/api/inventory/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al actualizar producto")
      }
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
      queryClient.invalidateQueries({ queryKey: ["inventory", "product", data.id] })
    },
  })
}

export function useDeleteProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/inventory/products/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al eliminar producto")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] })
    },
  })
}

export type InventoryDashboardData = {
  generatedAt: string
  totalProducts: number
  activeAlertsCount: number
  totalStockValue: number
  branchesWithStock: number
  threeWayMatchRate: number | null
  wasteLossRatio: number | null
  stockByCategory: Array<{ category: string | null; count: number }>
  recentMovements: Array<{ date: string; type: string; count: number }>
  topLowStock: Array<{
    itemId: string
    itemName: string
    minLevel: number
    unit: string
    branchId: string | null
    branchName: string | null
    totalStock: number
  }>
  topExpiring: Array<{
    id: string
    itemId: string
    itemName: string
    lotNumber: string | null
    expirationDate: string
    currentQuantity: number
    unit: string
    branchId: string | null
    branchName: string | null
  }>
}

export function useDashboard(branchId?: string) {
  return useQuery({
    queryKey: ["inventory", "dashboard", branchId],
    queryFn: async (): Promise<InventoryDashboardData> => {
      const url = branchId
        ? `/api/inventory/dashboard?branchId=${branchId}`
        : "/api/inventory/dashboard"
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch dashboard")
      return res.json()
    },
    staleTime: 30 * 1000,
  })
}

export function useStorageLocations(branchId?: string) {
  return useQuery({
    queryKey: ["inventory", "storage-locations", branchId],
    queryFn: async () => {
      const url = branchId
        ? `/api/inventory/storage-locations?branchId=${branchId}`
        : "/api/inventory/storage-locations"
      const res = await fetch(url)
      if (!res.ok) throw new Error("Error al cargar ubicaciones")
      return res.json()
    },
    staleTime: 30 * 1000,
  })
}

export function useCreateStorageLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/inventory/storage-locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al crear ubicación")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "storage-locations"] })
    },
  })
}

export function useUpdateStorageLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) => {
      const res = await fetch(`/api/inventory/storage-locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al actualizar ubicación")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "storage-locations"] })
    },
  })
}

export function useDeleteStorageLocation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/inventory/storage-locations/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al eliminar ubicación")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "storage-locations"] })
    },
  })
}

// --- Purchase Orders ---

export function usePurchaseOrders(params?: {
  branchId?: string;
  supplierId?: string;
  status?: string;
  search?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["inventory", "purchase-orders", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.branchId) searchParams.set("branchId", params.branchId);
      if (params?.supplierId) searchParams.set("supplierId", params.supplierId);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.search) searchParams.set("search", params.search);
      if (params?.sortField) searchParams.set("sortField", params.sortField);
      if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder);
      if (params?.dateFrom) searchParams.set("dateFrom", params.dateFrom);
      if (params?.dateTo) searchParams.set("dateTo", params.dateTo);
      if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
      if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
      const res = await fetch(`/api/inventory/purchase-orders?${searchParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch purchase orders");
      return res.json();
    },
    staleTime: 15 * 1000,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ["inventory", "purchase-orders", id],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/purchase-orders/${id}`);
      if (!res.ok) throw new Error("Failed to fetch purchase order");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/inventory/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al crear orden de compra");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "purchase-orders"] });
    },
  });
}

export function useUpdatePurchaseOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) => {
      const res = await fetch(`/api/inventory/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al actualizar orden de compra");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "purchase-orders"] });
    },
  });
}

export function usePriceCheck() {
  return useMutation({
    mutationFn: async (body: { supplierId: string; items: Array<{ itemId: string; unitCost: number }> }) => {
      const res = await fetch("/api/inventory/purchase-orders/price-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al verificar precios");
      }
      return res.json();
    },
  });
}

export function useMovements(params?: {
  branchId?: string
  type?: string[]
  dateFrom?: string
  dateTo?: string
  itemId?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ["inventory", "movements", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params?.branchId) searchParams.set("branchId", params.branchId)
      if (params?.type?.length) searchParams.set("type", params.type.join(","))
      if (params?.dateFrom) searchParams.set("dateFrom", params.dateFrom)
      if (params?.dateTo) searchParams.set("dateTo", params.dateTo)
      if (params?.itemId) searchParams.set("itemId", params.itemId)
      if (params?.limit) searchParams.set("limit", String(params.limit))
      if (params?.offset) searchParams.set("offset", String(params.offset))
      const res = await fetch(`/api/inventory/movements?${searchParams.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch movements")
      return res.json()
    },
    staleTime: 15 * 1000,
  })
}
