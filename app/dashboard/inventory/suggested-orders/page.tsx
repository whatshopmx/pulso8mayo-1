"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ShoppingCart, Package, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";

interface SuggestedItem {
  itemId: string;
  itemName: string;
  sku: string | null;
  currentStock: number;
  minLevel: number;
  maxLevel: number | null;
  leadTimeDays: number;
  avgDailyConsumption: number;
  reorderPoint: number;
  suggestedQty: number;
  supplierId?: string | null;
  supplierName?: string | null;
}

export default function SuggestedOrdersPage() {
  const router = useRouter();
  const { selectedBranchId } = useBranch();
  const [suggestions, setSuggestions] = React.useState<SuggestedItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);

  const fetchSuggestions = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = selectedBranchId
        ? `/api/inventory/suggested-orders?branchId=${encodeURIComponent(selectedBranchId)}`
        : "/api/inventory/suggested-orders";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar sugerencias");
      setSuggestions(data.suggestions || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar sugerencias");
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  React.useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const groupedSuggestions = React.useMemo(() => {
    const groups: Record<string, { supplierId: string | null; supplierName: string; items: SuggestedItem[] }> = {};
    suggestions.forEach(item => {
      const key = item.supplierId || item.supplierName || "Sin Proveedor";
      if (!groups[key]) {
        groups[key] = {
          supplierId: item.supplierId || null,
          supplierName: item.supplierName || "Sin Proveedor",
          items: [],
        };
      }
      groups[key].items.push(item);
    });
    return groups;
  }, [suggestions]);

  const toggleItem = (itemId: string) => {
    const next = new Set(selectedIds);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === suggestions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(suggestions.map(s => s.itemId)));
    }
  };

  const toggleSupplierGroup = (groupItems: SuggestedItem[]) => {
    const next = new Set(selectedIds);
    const itemIds = groupItems.map(i => i.itemId);
    const allSelected = itemIds.every(id => next.has(id));

    if (allSelected) {
      itemIds.forEach(id => next.delete(id));
    } else {
      itemIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  const createPurchaseOrders = async () => {
    if (selectedIds.size === 0) {
      toast.error("Selecciona al menos un item");
      return;
    }

    setCreating(true);
    try {
      const items = suggestions
        .filter(s => selectedIds.has(s.itemId))
        .map(s => ({ itemId: s.itemId, suggestedQty: s.suggestedQty }));

      const res = await fetch("/api/inventory/suggested-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, branchId: selectedBranchId ?? undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Error al crear órdenes");
      }

      toast.success(
        data.count === 1
          ? "1 orden de compra consolidada creada"
          : `${data.count} órdenes de compra creadas (1 consolidada por proveedor)`
      );
      setSelectedIds(new Set());
      fetchSuggestions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear órdenes");
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Órdenes Sugeridas (PAR)"
        description="Artículos que necesitan reorden según nivel mínimo, consumo y lead time"
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchSuggestions} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Recalcular
          </Button>
          <Button onClick={createPurchaseOrders} disabled={creating || selectedIds.size === 0}>
            {creating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4 mr-2" />
            )}
            Crear PO ({selectedIds.size})
          </Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Artículos por reordenar
            </CardTitle>
            <CardDescription>
              Basado en niveles PAR, consumo promedio y lead time de proveedores
            </CardDescription>
          </div>
          {!loading && suggestions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-muted/30">
              <Checkbox
                id="select-all-suggestions"
                checked={selectedIds.size === suggestions.length && suggestions.length > 0}
                onCheckedChange={toggleAll}
              />
              <label htmlFor="select-all-suggestions" className="text-xs font-medium cursor-pointer select-none">
                Seleccionar todo ({suggestions.length})
              </label>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : suggestions.length === 0 ? (
            <EmptyState
              icon={AlertCircle}
              title="Sin sugerencias"
              description="No hay artículos que necesiten reorden en este momento"
            />
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedSuggestions).map(([key, group]) => {
                const groupItems = group.items;
                const supplierName = group.supplierName;
                const groupItemIds = groupItems.map(i => i.itemId);
                const allGroupSelected = groupItemIds.every(id => selectedIds.has(id));
                const someGroupSelected = groupItemIds.some(id => selectedIds.has(id)) && !allGroupSelected;

                return (
                  <div key={key} className="border rounded-md overflow-hidden bg-card text-card-foreground shadow-sm">
                    {/* Supplier Group Header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={allGroupSelected ? true : someGroupSelected ? "indeterminate" : false}
                          onCheckedChange={() => toggleSupplierGroup(groupItems)}
                        />
                        <span className="font-semibold text-sm">{supplierName}</span>
                        <Badge variant="outline" className="text-xs bg-background/50">
                          {groupItems.length} {groupItems.length === 1 ? "artículo" : "artículos"}
                        </Badge>
                      </div>
                    </div>
                    
                    {/* Supplier Items Table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>Artículo</TableHead>
                          <TableHead className="text-right">Stock Actual</TableHead>
                          <TableHead className="text-right">Min</TableHead>
                          <TableHead className="text-right">Max</TableHead>
                          <TableHead className="text-right">Consumo Prom.</TableHead>
                          <TableHead className="text-right">Lead Time</TableHead>
                          <TableHead className="text-right">Punto Reorden</TableHead>
                          <TableHead className="text-right font-bold">Sugerido</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupItems.map((item) => (
                          <TableRow key={item.itemId}>
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(item.itemId)}
                                onCheckedChange={() => toggleItem(item.itemId)}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-sm">{item.itemName}</div>
                              {item.sku && (
                                <div className="text-xs text-muted-foreground">{item.sku}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.currentStock <= item.minLevel ? "destructive" : "secondary"}>
                                {item.currentStock}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm">{item.minLevel}</TableCell>
                            <TableCell className="text-right text-sm">{item.maxLevel ?? "—"}</TableCell>
                            <TableCell className="text-right text-sm">{item.avgDailyConsumption}</TableCell>
                            <TableCell className="text-right text-sm">{item.leadTimeDays}d</TableCell>
                            <TableCell className="text-right text-sm">{item.reorderPoint}</TableCell>
                            <TableCell className="text-right font-bold text-base">
                              {item.suggestedQty}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
