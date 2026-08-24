"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/shared/error-state";
import { useBranch } from "@/lib/branch-context";

interface LowStockItem {
  itemId: string;
  itemName: string;
  totalStock: number;
  minLevel: number | null;
  unit: string;
  branchId?: string | null;
  branchName?: string | null;
}

interface ExpiringItem {
  id: string;
  itemId: string;
  itemName: string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  currentQuantity: number;
  unit: string | null;
  branchId?: string | null;
  branchName?: string | null;
}

interface QuickAlertsProps {
  topLowStock?: LowStockItem[];
  topExpiring?: ExpiringItem[];
  isError?: boolean;
  onRetry?: () => void;
  showBranchAttribution?: boolean;
}

/**
 * AD-2: en modo "Todas" la sucursal es el dato accionable ("¿cuál me sangra?"),
 * así que se muestra como chip prominente y clicable que enfoca la vista en esa
 * sucursal vía el alcance del header. Fuera del Link para no anidar interactivos.
 */
function BranchChip({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { setSelectedBranchId } = useBranch();
  return (
    <button
      type="button"
      onClick={() => setSelectedBranchId(branchId)}
      title={`Ver solo ${branchName}`}
      className="shrink-0 rounded-full border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {branchName}
    </button>
  );
}

export function QuickAlerts({ topLowStock, topExpiring, isError, onRetry, showBranchAttribution }: QuickAlertsProps) {
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
            <AlertTriangle className="h-4 w-4 text-warning" />
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
                <li key={item.itemId} className="flex items-center gap-2">
                  <Link href={`/dashboard/inventory/${item.itemId}`} className="flex items-center justify-between min-w-0 flex-1 p-2 rounded hover:bg-muted transition-colors">
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate mr-2">{item.itemName}</span>
                      <span className="block text-sm text-warning-text font-medium whitespace-nowrap">
                        {item.totalStock} / {item.minLevel ?? 0} {item.unit}
                      </span>
                    </div>
                  </Link>
                  {showBranchAttribution && item.branchId && item.branchName && (
                    <BranchChip branchId={item.branchId} branchName={item.branchName} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning" />
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
                <li key={batch.id} className="flex items-center gap-2">
                  <Link href={`/dashboard/inventory/${batch.itemId}`} className="flex items-center justify-between min-w-0 flex-1 p-2 rounded hover:bg-muted transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{batch.itemName}</p>
                      <p className="text-xs text-muted-foreground">Lote: {batch.lotNumber ?? "N/A"}</p>
                    </div>
                    <span className="text-sm text-warning-text font-medium whitespace-nowrap ml-2">
                      {batch.expirationDate ? new Date(batch.expirationDate).toLocaleDateString("es-MX") : "N/A"}
                    </span>
                  </Link>
                  {showBranchAttribution && batch.branchId && batch.branchName && (
                    <BranchChip branchId={batch.branchId} branchName={batch.branchName} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
