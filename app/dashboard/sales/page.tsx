"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SalesCutUpload } from "@/components/sales/sales-cut-upload";
import { SalesDashboard } from "@/components/sales/sales-dashboard";
import { FinancialKpiCards } from "@/components/sales/financial-kpi-cards";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Loader2,
  Coins,
  AlertCircle,
  CheckCircle,
  Settings2,
  BarChart3,
  FileSpreadsheet,
  Store,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { statusBadgeClasses, formatCents } from "@/lib/utils";
import { computeCashVariance, cashVarianceToneClass } from "@/lib/sales/cash-variance";
import { useBranches } from "@/hooks/use-branches";
import Link from "next/link";

interface SalesCut {
  id: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  shift: "MATUTINO" | "VESPERTINO" | "COMPLETO";
  channel: "SALON" | "DELIVERY" | "EVENTOS" | "TOTAL";
  totalSales: number;
  cashSales: number | null;
  cardSales: number | null;
  otherPayments: number | null;
  cashCountedCents: number | null;
  depositedCents: number | null;
  aggregatorSales: Record<string, number> | null;
  ticketCount: number | null;
  avgTicket: number | null;
  source: "UPLOAD" | "WHATSAPP" | "MANUAL_FORM";
  rawFileUrl: string | null;
  status: "VALIDATED" | "PENDING_REVIEW";
  validationNotes: string | null;
  receivedByName: string | null;
  receivedAt: string;
  createdAt: string;
}

export default function SalesDashboardPage() {
  const { toast } = useToast();
  const [cuts, setCuts] = useState<SalesCut[]>([]);
  const { branches, loading: loadingBranches } = useBranches();
  const [loadingCuts, setLoadingCuts] = useState(true);

  // Filters — single source of truth for branch across Analytics + Cuts tabs
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Fetch sales cuts
  const fetchCuts = useCallback(async () => {
    setLoadingCuts(true);
    try {
      let url = "/api/sales/cuts?";
      if (selectedBranch && selectedBranch !== "ALL") {
        url += `branchId=${selectedBranch}&`;
      }
      if (startDate) {
        url += `startDate=${startDate}&`;
      }
      if (endDate) {
        url += `endDate=${endDate}&`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("No se pudieron cargar los cortes de ventas.");
      }
      const data = await res.json();
      setCuts(data.data || []);
    } catch (err) {
      console.error(err);
      toast({
        title: "Error de Carga",
        description:
          err instanceof Error ? err.message : "Error al conectar con el servidor.",
        variant: "destructive",
      });
    } finally {
      setLoadingCuts(false);
    }
  }, [selectedBranch, startDate, endDate, toast]);

  useEffect(() => {
    fetchCuts();
  }, [fetchCuts]);

  const getSourceBadge = (source: SalesCut["source"]) => {
    switch (source) {
      case "UPLOAD":
        return <Badge variant="outline" className={statusBadgeClasses("info")}>Archivo POS</Badge>;
      case "WHATSAPP":
        return <Badge variant="outline" className={statusBadgeClasses("success")}>WhatsApp</Badge>;
      case "MANUAL_FORM":
        return <Badge variant="outline" className={statusBadgeClasses("warning")}>Manual</Badge>;
    }
  };

  /** Aplica un preset de fechas y dispara el fetch. */
  const applyDatePreset = (preset: "today" | "7d" | "thisMonth" | "lastMonth") => {
    const now = new Date();
    // Se construye en hora local: `toISOString()` convierte a UTC y en
    // America/Mexico_City (UTC−6) adelantaría un día a partir de las 18:00.
    const toISODate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    switch (preset) {
      case "today": {
        const today = toISODate(now);
        setStartDate(today);
        setEndDate(today);
        break;
      }
      case "7d": {
        const sevenAgo = new Date(now);
        sevenAgo.setDate(sevenAgo.getDate() - 6);
        setStartDate(toISODate(sevenAgo));
        setEndDate(toISODate(now));
        break;
      }
      case "thisMonth": {
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        setStartDate(toISODate(firstOfMonth));
        setEndDate(toISODate(now));
        break;
      }
      case "lastMonth": {
        const firstOfLast = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastOfLast = new Date(now.getFullYear(), now.getMonth(), 0);
        setStartDate(toISODate(firstOfLast));
        setEndDate(toISODate(lastOfLast));
        break;
      }
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="h-7 w-7 text-primary" /> Ventas y POS (M13)
            {/* `button` en vez de `span`: un `title` sobre texto plano es
                inalcanzable por teclado y lo ignora el lector de pantalla. */}
            <button
              type="button"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-muted-foreground/30 text-[10px] text-muted-foreground cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Módulo de ingesta de cortes de ventas desde archivos POS, WhatsApp o captura manual. Los datos alimentan KPIs financieros y la proyección de flujo de efectivo."
              aria-label="Qué es este módulo: ingesta de cortes de ventas desde archivos POS, WhatsApp o captura manual. Los datos alimentan KPIs financieros y la proyección de flujo de efectivo."
            >
              ?
            </button>
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingesta de cortes diarios, análisis por turno/canal y desglose de ventas totales.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/sales/mapping">
              <Settings2 className="w-4 h-4 mr-2" /> Plantillas POS
            </Link>
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="analytics" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Analítica y KPIs
          </TabsTrigger>
          <TabsTrigger value="cuts" className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Registro de Cortes
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Analytics & KPIs */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Common branch selector — feeds both KPIs and charts */}
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sucursal:</span>
            <div className="w-56">
              <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={loadingBranches}>
                <SelectTrigger className="h-8 text-xs">
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

          <FinancialKpiCards branchId={selectedBranch} />
          <SalesDashboard branchId={selectedBranch} />
        </TabsContent>

        {/* TAB 2: Ingestion & Cuts List */}
        <TabsContent value="cuts" className="space-y-6">
          <SalesCutUpload branches={branches} onUploadSuccess={fetchCuts} />

          {/* Fase 2: alerta de cortes con diferencia (arqueo vs efectivo declarado) */}
          {(() => {
            // Misma fuente de verdad que la celda de la tabla, para que el
            // conteo del banner no pueda discrepar de las filas en rojo.
            const diffCuts = cuts.filter((c) => {
              const arqueo = computeCashVariance(c);
              return arqueo !== null && arqueo.direction !== "cuadrado";
            });
            if (diffCuts.length === 0) return null;
            const byBranch = new Map<string, number>();
            for (const c of diffCuts) {
              byBranch.set(c.branchName, (byBranch.get(c.branchName) ?? 0) + 1);
            }
            const summary = Array.from(byBranch.entries())
              .map(([name, n]) => `${n} en ${name}`)
              .join(", ");
            return (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-destructive">
                    {diffCuts.length} corte{diffCuts.length !== 1 ? "s" : ""} con diferencia entre efectivo declarado y arqueo
                  </p>
                  <p className="text-muted-foreground">
                    Revisa los cortes marcados en rojo en la columna Diferencia: {summary}.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Cuts Table */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" /> Historial de Cortes Registrados
                </CardTitle>

                {/* Table Filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-44">
                    <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={loadingBranches}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Todas las sucursales" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">Todas las sucursales</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label htmlFor="cuts-start-date" className="sr-only">
                    Fecha inicial
                  </label>
                  <Input
                    id="cuts-start-date"
                    type="date"
                    className="h-8 text-xs w-36"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground" aria-hidden>-</span>
                  <label htmlFor="cuts-end-date" className="sr-only">
                    Fecha final
                  </label>
                  <Input
                    id="cuts-end-date"
                    type="date"
                    className="h-8 text-xs w-36"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />

                  {/* Date presets */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => applyDatePreset("today")}
                    >
                      Hoy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => applyDatePreset("7d")}
                    >
                      7d
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => applyDatePreset("thisMonth")}
                    >
                      Este mes
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2"
                      onClick={() => applyDatePreset("lastMonth")}
                    >
                      Mes ant.
                    </Button>
                  </div>

                  {(selectedBranch !== "ALL" || startDate || endDate) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => {
                        setSelectedBranch("ALL");
                        setStartDate("");
                        setEndDate("");
                      }}
                    >
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingCuts ? (
                <div className="py-12 flex justify-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando cortes de ventas...
                </div>
              ) : cuts.length === 0 ? (
                <EmptyState
                  bare
                  icon={Coins}
                  title="No se encontraron cortes de ventas en el período"
                  description="Sube un archivo exportado del POS o recibe cortes por WhatsApp para empezar a registrar la operación diaria."
                />
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Fecha</TableHead>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Turno</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Venta Total</TableHead>
                        <TableHead>Formas de Pago</TableHead>
                        <TableHead className="text-center">Tickets</TableHead>
                        <TableHead>Arqueo/Dif.</TableHead>
                        <TableHead>Origen</TableHead>
                        <TableHead>Estatus</TableHead>
                        <TableHead>Recibido por</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cuts.map((cut) => {
                        const paymentParts = [];
                        if (cut.cashSales !== null) paymentParts.push(`Efectivo: ${formatCents(cut.cashSales)}`);
                        if (cut.cardSales !== null) paymentParts.push(`Tarjeta: ${formatCents(cut.cardSales)}`);
                        if (cut.otherPayments !== null) paymentParts.push(`Otros: ${formatCents(cut.otherPayments)}`);

                        // Fase 2: arqueo = efectivo contado vs. efectivo declarado.
                        // `countedCents` puede existir sin contraparte declarada:
                        // en ese caso hay conteo que mostrar pero no diferencia.
                        const countedCents = cut.cashCountedCents;
                        const arqueo = computeCashVariance(cut);

                        return (
                          <TableRow key={cut.id} className="hover:bg-muted/40 transition">
                            <TableCell className="font-medium whitespace-nowrap">
                              {new Date(cut.businessDate + "T00:00:00").toLocaleDateString("es-MX", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </TableCell>
                            <TableCell className="font-medium">{cut.branchName}</TableCell>
                            <TableCell className="text-xs font-semibold capitalize">
                              {cut.shift.toLowerCase()}
                            </TableCell>
                            <TableCell>
                              <Badge variant={cut.channel === "TOTAL" ? "secondary" : "outline"} className="text-xs">
                                {cut.channel}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-sm">
                              {formatCents(cut.totalSales)}
                            </TableCell>
                            <TableCell>
                              {paymentParts.length > 0 ? (
                                <div className="text-xs text-muted-foreground flex flex-col gap-0.5">
                                  {paymentParts.map((p, idx) => (
                                    <span key={idx}>{p}</span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center text-sm font-medium">
                              {cut.ticketCount !== null ? cut.ticketCount : <span className="text-muted-foreground/60">—</span>}
                            </TableCell>
                            <TableCell>
                              {countedCents !== null ? (
                                <div className="flex flex-col text-xs">
                                  <span className="text-muted-foreground">
                                    Contado: {formatCents(countedCents)}
                                  </span>
                                  {arqueo === null ? (
                                    <span className="text-muted-foreground/60">
                                      Diferencia: — (sin efectivo declarado)
                                    </span>
                                  ) : (
                                    <span className={`font-semibold ${cashVarianceToneClass(arqueo.direction)}`}>
                                      Diferencia:{" "}
                                      {arqueo.direction === "cuadrado"
                                        ? "cuadrado"
                                        : `${arqueo.varianceCents > 0 ? "+" : ""}${formatCents(arqueo.varianceCents)} (${arqueo.direction})`}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                            <TableCell>{getSourceBadge(cut.source)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {cut.status === "VALIDATED" ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-success font-semibold">
                                    <CheckCircle className="h-3 w-3" /> Validado
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-warning font-semibold">
                                    <AlertCircle className="h-3 w-3" /> Observación
                                  </span>
                                )}
                                {cut.validationNotes && (
                                  <span className="text-xs text-muted-foreground max-w-[200px] leading-tight block">
                                    {cut.validationNotes}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex flex-col">
                                <span className="font-medium text-muted-foreground">{cut.receivedByName || "Sistema"}</span>
                                <span className="text-xs text-muted-foreground/75">
                                  {new Date(cut.receivedAt).toLocaleDateString("es-MX", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fase 3: conciliación por agregador — venta reportada vs. liquidación */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" /> Conciliación por Agregador
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Compara la venta reportada en los cortes contra la liquidación del agregador (que llega neta de comisión). Captura el monto liquidado para ver la varianza.
                <span className="block mt-1 text-xs text-muted-foreground/80">
                  Los montos capturados aquí no se guardan: son una ayuda de cálculo de la sesión y se limpian al cambiar el filtro.
                </span>
              </p>
            </CardHeader>
            <CardContent>
              {/* `key` fuerza el remontaje al cambiar el filtro: sin esto, un monto
                  capturado bajo una sucursal seguía comparándose contra la venta
                  reportada de otra. */}
              <AggregatorConciliation
                key={`${selectedBranch}|${startDate}|${endDate}`}
                cuts={cuts}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AggregatorConciliation({ cuts }: { cuts: SalesCut[] }) {
  // Sum reported sales per aggregator across the filtered cuts.
  const totals = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const cut of cuts) {
      if (!cut.aggregatorSales) continue;
      for (const [key, value] of Object.entries(cut.aggregatorSales)) {
        acc[key] = (acc[key] ?? 0) + value;
      }
    }
    return acc;
  }, [cuts]);

  const labels: Record<string, string> = {
    rappi: "Rappi",
    uber: "Uber Eats",
    didi: "Didi Food",
    justo: "Justo",
    sindelantal: "Sin Delantal",
    mercadopago: "Mercado Pago",
  };

  const [liquidated, setLiquidated] = useState<Record<string, string>>({});
  const keys = Object.keys(totals);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay ventas por agregador en los cortes del período filtrado. Captura un corte con Rappi/Uber/Didi desde el Smart Link para ver la conciliación.
      </p>
    );
  }

  return (
    <div className="border rounded-md overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Agregador</TableHead>
            <TableHead className="text-right">Venta reportada</TableHead>
            <TableHead className="text-right">Liquidación recibida</TableHead>
            <TableHead className="text-right">Retención (comisión y ajustes)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => {
            const reported = totals[key];
            const raw = liquidated[key] ?? "";
            const liquidatedCents = raw.trim() === "" ? null : Math.round(parseFloat(raw.replace(/[$,]/g, "")) * 100);
            const valid = liquidatedCents !== null && !isNaN(liquidatedCents);
            const variance = valid ? reported - liquidatedCents! : null;
            const pct = valid && reported > 0 ? ((variance! / reported) * 100).toFixed(1) : null;
            return (
              <TableRow key={key} className="hover:bg-muted/40 transition">
                <TableCell className="font-medium">{labels[key] ?? key}</TableCell>
                <TableCell className="text-right font-semibold text-sm">
                  {formatCents(reported)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="h-8 w-32 text-xs text-right"
                      value={raw}
                      onChange={(e) => setLiquidated((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {valid && variance !== null ? (
                    // `reported > liquidated` es lo ESPERADO: la liquidación llega
                    // neta de comisión. Solo lo inverso (te liquidan más de lo que
                    // vendiste) es una anomalía. Sin una tasa de comisión esperada
                    // en el esquema no hay forma de juzgar si la retención es
                    // excesiva, así que se presenta como dato, no como error.
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-semibold ${
                        variance < 0 ? "text-warning" : "text-foreground"
                      }`}
                    >
                      {variance > 0 ? "+" : ""}
                      {formatCents(variance)}
                      {pct !== null && (
                        <span className="text-xs text-muted-foreground">({pct}%)</span>
                      )}
                      {variance < 0 && (
                        <span className="text-xs font-normal">liquidación &gt; venta</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
