"use client";

import { useEffect, useState } from "react";
import { CashFlowCalendar } from "@/components/finance/cash-flow-calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, DollarSign, TrendingUp, Loader2 } from "lucide-react";

export default function CashFlowPage() {
  const [projection, setProjection] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjection() {
      setLoading(true);
      try {
        const res = await fetch("/api/finance/cash-flow?days=30");
        const json = await res.json();
        if (res.ok && json.success) {
          setProjection(json.data || []);
        }
      } catch (err) {
        console.error("Failed to load cash flow projection:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchProjection();
  }, []);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Calendar className="h-7 w-7 text-primary" /> Calendario de Flujo de Efectivo Proyectado
        </h1>
        <p className="text-sm text-muted-foreground">
          Proyección a 30 días calculada sumando estimación de ventas diarias vs compromisos de egresos (gastos + nómina).
        </p>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Calculando proyección a 30 días...
        </div>
      ) : (
        <CashFlowCalendar projection={projection} />
      )}
    </div>
  );
}
