"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Package, ArrowDown, ArrowUp, AlertTriangle, RefreshCw } from "lucide-react";
import { formatQty } from "@/lib/utils";
import { useEffect, useState } from "react";

interface MovementItem {
  id: string;
  type: string;
  typeLabel: string;
  itemName: string;
  quantityChange: number;
  reason: string | null;
  performerName: string;
  timestamp: string;
}

const typeConfig: Record<string, { icon: typeof ArrowDown; color: string }> = {
  RECEIVING: { icon: ArrowDown, color: 'text-green-600' },
  USAGE: { icon: ArrowUp, color: 'text-blue-600' },
  ADJUSTMENT: { icon: RefreshCw, color: 'text-yellow-600' },
  TRANSFER: { icon: RefreshCw, color: 'text-purple-600' },
  WASTE: { icon: AlertTriangle, color: 'text-red-600' },
  RETURN: { icon: ArrowDown, color: 'text-teal-600' },
};

export function InventoryActivityFeed({ branchId }: { branchId?: string }) {
  const [movements, setMovements] = useState<MovementItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (branchId && branchId !== 'all') params.set('branchId', branchId);
    fetch(`/api/analytics/inventory/activity?${params}`)
      .then(res => res.json())
      .then(data => {
        setMovements(data.movements || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [branchId]);

  if (loading) {
    return <div className="flex items-center justify-center h-[300px] text-muted-foreground">Cargando actividad...</div>;
  }

  if (movements.length === 0) {
    return <div className="flex items-center justify-center h-[300px] text-muted-foreground">Sin movimientos hoy</div>;
  }

  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-3">
        {movements.map((m) => {
          const config = typeConfig[m.type] || { icon: Package, color: 'text-gray-600' };
          const Icon = config.icon;
          const time = new Date(m.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

          return (
            <div key={m.id} className="flex items-center gap-3 border-b pb-3 last:border-0 last:pb-0">
              <div className={`p-1.5 rounded-md bg-muted ${config.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5">{m.typeLabel}</Badge>
                  <span className="text-sm font-medium truncate">{m.itemName}</span>
                </div>
                <p className="text-xs text-muted-foreground">{m.performerName} · {time}</p>
              </div>
              <span className={`text-sm font-semibold ${m.quantityChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {m.quantityChange >= 0 ? '+' : ''}{formatQty(m.quantityChange)}
              </span>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
