"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Percent, CheckCircle2, AlertTriangle, Plus, Loader2 } from "lucide-react";

interface Settlement {
  id: string;
  channel: string;
  periodStart: string;
  periodEnd: string;
  grossSalesCents: number;
  commissionCents: number;
  netDepositedCents: number;
  posSalesCents: number;
  varianceCents: number;
  status: "PENDING" | "RECONCILED" | "DISCREPANCY";
  notes?: string;
}

interface CommissionsReconciliationPanelProps {
  branches: Array<{ id: string; name: string }>;
}

export function CommissionsReconciliationPanel({ branches }: CommissionsReconciliationPanelProps) {
  const { toast } = useToast();
  const [selectedBranch, setSelectedBranch] = useState<string>(branches[0]?.id || "");
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form states
  const [channel, setChannel] = useState("rappi");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [grossSales, setGrossSales] = useState("");
  const [commission, setCommission] = useState("");
  const [netDeposited, setNetDeposited] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchSettlements = async () => {
    if (!selectedBranch) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/aggregator-settlements?branchId=${selectedBranch}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setSettlements(data.data || []);
      }
    } catch (err) {
      console.error("Error fetching settlements:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettlements();
  }, [selectedBranch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodStart || !periodEnd || !grossSales || !netDeposited) {
      toast({ title: "Error", description: "Llena todos los campos obligatorios.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/finance/aggregator-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranch,
          channel,
          periodStart,
          periodEnd,
          grossSalesCents: Math.round(parseFloat(grossSales) * 100),
          commissionCents: Math.round(parseFloat(commission || "0") * 100),
          netDepositedCents: Math.round(parseFloat(netDeposited) * 100),
          notes: notes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Error al registrar liquidación.");

      toast({
        title: "Liquidación Registrada",
        description: `Conciliación ${data.data.status === "RECONCILED" ? "Exitosa" : "con Discrepancia"}.`,
      });

      setGrossSales("");
      setCommission("");
      setNetDeposited("");
      setNotes("");
      setShowForm(false);
      fetchSettlements();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const formatMXN = (cents: number) => `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Percent className="w-5 h-5 text-primary" /> Conciliación Semanal de Agregadores y TPV
          </CardTitle>
          <CardDescription className="text-xs">
            Compara el resumen semanal enviado por Rappi, Uber Eats, DiDi o la Terminal contra las ventas registradas en el POS.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4 mr-1" /> Registrar Liquidación
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {showForm && (
          <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="agg-branch" className="text-xs">Sucursal</Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger id="agg-branch">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="agg-channel" className="text-xs">Canal</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger id="agg-channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rappi">Rappi</SelectItem>
                    <SelectItem value="ubereats">Uber Eats</SelectItem>
                    <SelectItem value="didi">DiDi Food</SelectItem>
                    <SelectItem value="tpv">Terminal Bancaria (TPV)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="period-start" className="text-xs">Desde</Label>
                  <Input
                    id="period-start"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="period-end" className="text-xs">Hasta</Label>
                  <Input
                    id="period-end"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="gross-sales" className="text-xs">Venta Bruta Declarada ($)</Label>
                <Input
                  id="gross-sales"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={grossSales}
                  onChange={(e) => setGrossSales(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="comm-retention" className="text-xs">Comisión Retenida ($)</Label>
                <Input
                  id="comm-retention"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="net-deposited" className="text-xs">Monto Neto Depositado en Banco ($)</Label>
                <Input
                  id="net-deposited"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={netDeposited}
                  onChange={(e) => setNetDeposited(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Conciliar Liquidación
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-center py-6 text-muted-foreground text-xs">Cargando liquidaciones...</div>
        ) : settlements.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-xs">
            No hay liquidaciones semanales registradas para esta sucursal.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2">Canal</th>
                  <th className="py-2">Periodo</th>
                  <th className="py-2 text-right">Venta Bruta</th>
                  <th className="py-2 text-right">Comisión</th>
                  <th className="py-2 text-right">Neto Banco</th>
                  <th className="py-2 text-right">Venta POS</th>
                  <th className="py-2 text-right">Varianza</th>
                  <th className="py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 font-medium uppercase">{s.channel}</td>
                    <td className="py-2.5 text-muted-foreground">
                      {s.periodStart} al {s.periodEnd}
                    </td>
                    <td className="py-2.5 text-right">{formatMXN(s.grossSalesCents)}</td>
                    <td className="py-2.5 text-right text-muted-foreground">{formatMXN(s.commissionCents)}</td>
                    <td className="py-2.5 text-right font-medium text-emerald-600 dark:text-emerald-400">
                      {formatMXN(s.netDepositedCents)}
                    </td>
                    <td className="py-2.5 text-right">{formatMXN(s.posSalesCents)}</td>
                    <td className="py-2.5 text-right font-mono">
                      {s.varianceCents === 0 ? (
                        "$0.00"
                      ) : (
                        <span className={s.varianceCents < 0 ? "text-destructive" : "text-amber-600"}>
                          {formatMXN(s.varianceCents)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-center">
                      {s.status === "RECONCILED" ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Conciliado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Discrepancia
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
