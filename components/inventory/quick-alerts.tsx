"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/shared/error-state";

interface LowStockItem {
  itemId: string;
  itemName: string;
  totalStock: number;
  minLevel: number | null;
  unit: string;
}

interface ExpiringItem {
  id: string;
  itemId: string;
  itemName: string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  currentQuantity: number;
  unit: string | null;
}

interface QuickAlertsProps {
  topLowStock?: LowStockItem[];
  topExpiring?: ExpiringItem[];
  isError?: boolean;
  onRetry?: () => void;
}

export function QuickAlerts({ topLowStock, topExpiring, isError, onRetry }: QuickAlertsProps) {
  if (isError) {
    return (
      <Card>
        <ErrorState
          message="No se pudieron cargar las alertas de inventario."
          onRetry={onRetry}
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Stock Bajo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!topLowStock || topLowStock.length === 0 ? (
            <div className="text-center py-4 space-y-2">
              <p className="text-sm text-muted-foreground">Sin alertas de stock bajo</p>
              <Link href="/dashboard/inventory/alerts" className="text-xs text-primary hover:underline block">
                Ver todas las alertas
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {topLowStock.map((item) => (
                <li key={item.itemId}>
                  <Link href={`/dashboard/inventory/${item.itemId}`} className="flex items-center justify-between p-2 rounded hover:bg-muted transition-colors">
                    <span className="text-sm font-medium truncate mr-2">{item.itemName}</span>
                    <span className="text-sm text-amber-600 font-medium whitespace-nowrap">
                      {item.totalStock} / {item.minLevel ?? 0} {item.unit}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-orange-500" />
            Próximos a Vencer
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!topExpiring || topExpiring.length === 0 ? (
            <div className="text-center py-4 space-y-2">
              <p className="text-sm text-muted-foreground">Sin productos próximos a vencer</p>
              <Link href="/dashboard/inventory/alerts" className="text-xs text-primary hover:underline block">
                Ver todas las alertas
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {topExpiring.map((batch) => (
                <li key={batch.id}>
                  <Link href={`/dashboard/inventory/${batch.itemId}`} className="flex items-center justify-between p-2 rounded hover:bg-muted transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{batch.itemName}</p>
                      <p className="text-xs text-muted-foreground">Lote: {batch.lotNumber ?? "N/A"}</p>
                    </div>
                    <span className="text-sm text-orange-600 font-medium whitespace-nowrap ml-2">
                      {batch.expirationDate ? new Date(batch.expirationDate).toLocaleDateString() : "N/A"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
