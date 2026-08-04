"use client";

import { useEffect, useState, useCallback } from "react";
import { CashFlowCalendar } from "@/components/finance/cash-flow-calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Calendar, Loader2, AlertCircle } from "lucide-react";

interface Branch {
  id: string;
  name: string;
}

export default function CashFlowPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [projection, setProjection] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        const data = await res.json();
        const list = data.data || data.branches || (Array.isArray(data) ? data : []);
        setBranches(list);
      } catch (err) {
        console.error("Error fetching branches:", err);
      }
    }
    fetchBranches();
  }, []);

  const fetchProjection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/finance/cash-flow", window.location.origin);
      url.searchParams.set("days", "30");
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setProjection(json.data || []);
      } else {
        setError(json?.error || "No se pudo calcular la proyección de flujo de efectivo.");
        setProjection([]);
      }
    } catch (err) {
      console.error("Failed to load cash flow projection:", err);
      setError("Error de conexión al calcular la proyección. Revisa tu red e intenta de nuevo.");
      setProjection([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    fetchProjection();
  }, [fetchProjection]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="h-7 w-7 text-primary" /> Panel de Alerta Temprana de Tesorería
          </h1>
          <p className="text-sm text-muted-foreground">
            ¿Me alcanza? · ¿En qué gasto? · ¿Qué semanas son críticas? · ¿Qué facturas están vencidas?
          </p>
        </div>

        <div className="w-56">
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger>
              <SelectValue placeholder="Todas las sucursales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas las sucursales (consolidado)</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Analizando flujo de efectivo...
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudo calcular el flujo de efectivo"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={fetchProjection}>
              <Loader2 className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : (
        <CashFlowCalendar projection={projection} />
      )}
    </div>
  );
}