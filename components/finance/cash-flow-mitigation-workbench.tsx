"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatCents } from "@/lib/utils";
import { Wrench, Calendar, Clock, Loader2, ArrowUpRight, CheckCircle2 } from "lucide-react";

interface OutflowItem {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  category: string;
  status: string;
  isPayroll: boolean;
  source?: "OPERATING_EXPENSE" | "PURCHASE_ORDER" | "PROCUREMENT_INVOICE" | "RECURRING_CONTRACT";
  isEstimated?: boolean;
  supplierName?: string;
  branchName?: string | null;
}

interface CashFlowMitigationWorkbenchProps {
  overdueItems: OutflowItem[];
  upcomingItems: OutflowItem[];
  canActOnExpenses?: boolean;
  onActionDone?: () => void;
}

export function CashFlowMitigationWorkbench({
  overdueItems,
  upcomingItems,
  canActOnExpenses = false,
  onActionDone,
}: CashFlowMitigationWorkbenchProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"overdue" | "upcoming">("overdue");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const listToShow = activeTab === "overdue" ? overdueItems : upcomingItems.slice(0, 10);

  const handleRescheduleDays = async (item: OutflowItem, daysToAdd: number) => {
    if (!canActOnExpenses) {
      toast({
        title: "Sin Permisos",
        description: "Tu usuario no tiene nivel de permisos para reprogramar gastos.",
        variant: "destructive",
      });
      return;
    }

    if (item.source !== "OPERATING_EXPENSE") {
      toast({
        title: "Acción no disponible",
        description: "Sólo los Gastos Operativos se pueden reprogramar directamente desde aquí.",
        variant: "destructive",
      });
      return;
    }

    const currentDate = new Date(item.date);
    const newDateObj = new Date(currentDate.getTime() + daysToAdd * 86400000);
    const newDueDate = newDateObj.toISOString().slice(0, 10);

    setActionLoadingId(item.id);
    try {
      const res = await fetch(`/api/expenses/${item.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: newDueDate }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || "No se pudo reprogramar el gasto.");

      toast({
        title: "Gasto Reprogramado",
        description: `La nueva fecha de vencimiento es el ${newDueDate} (+${daysToAdd} días).`,
      });

      if (onActionDone) onActionDone();
    } catch (err: any) {
      toast({
        title: "Error al Reprogramar",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <Card className="border-border shadow-sm mt-6">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Wrench className="w-5 h-5 text-primary" /> Workbench de Mitigación de Liquidez
          </CardTitle>
          <CardDescription className="text-xs">
            Acciones rápidas de reprogramación en 1-clic para nivelar semanas de estrés de caja.
          </CardDescription>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-border p-1 bg-muted/30">
          <Button
            variant={activeTab === "overdue" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("overdue")}
            className="text-xs h-7"
          >
            Vencidos ({overdueItems.length})
          </Button>
          <Button
            variant={activeTab === "upcoming" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("upcoming")}
            className="text-xs h-7"
          >
            Próximos de Alto Impacto
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {listToShow.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No hay elementos en esta categoría que requieran mitigación inmediata.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {listToShow.map((item) => (
              <div key={item.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {item.description}
                    </span>
                    {item.supplierName && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        {item.supplierName}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>Vence: {item.date}</span>
                    {item.branchName && <span>· {item.branchName}</span>}
                    <span>· {item.category}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 justify-between sm:justify-end">
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatCents(item.amountCents)}
                  </span>

                  {canActOnExpenses && item.source === "OPERATING_EXPENSE" ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoadingId === item.id}
                        onClick={() => handleRescheduleDays(item, 7)}
                        className="h-7 text-xs px-2"
                        title="Postergar 7 días la fecha de vencimiento"
                      >
                        {actionLoadingId === item.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "+7 días"
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoadingId === item.id}
                        onClick={() => handleRescheduleDays(item, 14)}
                        className="h-7 text-xs px-2"
                        title="Postergar 14 días la fecha de vencimiento"
                      >
                        {actionLoadingId === item.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "+14 días"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      {item.isPayroll ? "Nómina" : "Factura/OC"}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
