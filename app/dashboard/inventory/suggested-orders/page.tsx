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
}

export default function SuggestedOrdersPage() {
  const router = useRouter();
  const [suggestions, setSuggestions] = React.useState<SuggestedItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);

  const fetchSuggestions = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory/suggested-orders");
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch {
      toast.error("Error al cargar sugerencias");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

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
        body: JSON.stringify({ items }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Error al crear órdenes");
      }

      toast.success(`${data.count} órdenes de compra creadas`);
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
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            Artículos por reordenar
          </CardTitle>
          <CardDescription>
            Basado en niveles PAR, consumo promedio y lead time de proveedores
          </CardDescription>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === suggestions.length && suggestions.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
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
                {suggestions.map((item) => (
                  <TableRow key={item.itemId}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(item.itemId)}
                        onCheckedChange={() => toggleItem(item.itemId)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.itemName}</div>
                      {item.sku && (
                        <div className="text-xs text-muted-foreground">{item.sku}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={item.currentStock <= item.minLevel ? "destructive" : "secondary"}>
                        {item.currentStock}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{item.minLevel}</TableCell>
                    <TableCell className="text-right">{item.maxLevel ?? "—"}</TableCell>
                    <TableCell className="text-right">{item.avgDailyConsumption}</TableCell>
                    <TableCell className="text-right">{item.leadTimeDays}d</TableCell>
                    <TableCell className="text-right">{item.reorderPoint}</TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      {item.suggestedQty}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
