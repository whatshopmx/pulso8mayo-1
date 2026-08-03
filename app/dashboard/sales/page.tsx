"use client";

import { useState, useEffect, useCallback } from "react";
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
import { 
  TrendingUp, 
  Loader2, 
  Calendar, 
  Filter, 
  Coins, 
  AlertCircle, 
  CheckCircle,
  Ticket,
  Settings2,
  BarChart3,
  FileSpreadsheet
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

interface Branch {
  id: string;
  name: string;
}

export default function SalesDashboardPage() {
  const { toast } = useToast();
  const [cuts, setCuts] = useState<SalesCut[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingCuts, setLoadingCuts] = useState(true);
  const [loadingBranches, setLoadingBranches] = useState(true);

  // Filters
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Fetch branches
  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        if (!res.ok) throw new Error();
        const data = await res.json();
        const branchesList = data.data || data.branches || (Array.isArray(data) ? data : []);
        setBranches(branchesList);
      } catch (err) {
        console.error("Error fetching branches:", err);
      } finally {
        setLoadingBranches(false);
      }
    }
    fetchBranches();
  }, []);

  // Fetch sales cuts
  const fetchCuts = useCallback(async () => {
    setLoadingCuts(true);
    try {
      let url = "/api/sales/cuts?";
      if (selectedBranch && selectedBranch !== "all") {
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
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error de Carga",
        description: err.message || "Error al conectar con el servidor.",
        variant: "destructive",
      });
    } finally {
      setLoadingCuts(false);
    }
  }, [selectedBranch, startDate, endDate, toast]);

  useEffect(() => {
    fetchCuts();
  }, [fetchCuts]);

  const formatMXN = (cents: number) => {
    return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  };

  const getSourceBadge = (source: SalesCut["source"]) => {
    switch (source) {
      case "UPLOAD":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Archivo POS</Badge>;
      case "WHATSAPP":
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">WhatsApp</Badge>;
      case "MANUAL_FORM":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Manual</Badge>;
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="h-7 w-7 text-primary" /> Ventas y POS (M13)
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingesta de cortes diarios, análisis por turno/canal y control de Food Cost % y Labor Cost %.
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
          <FinancialKpiCards branchId={selectedBranch} />
          <SalesDashboard branches={branches} />
        </TabsContent>

        {/* TAB 2: Ingestion & Cuts List */}
        <TabsContent value="cuts" className="space-y-6">
          <SalesCutUpload branches={branches} onUploadSuccess={fetchCuts} />

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
                        <SelectItem value="all">Todas las sucursales</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Input
                    type="date"
                    className="h-8 text-xs w-36"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">-</span>
                  <Input
                    type="date"
                    className="h-8 text-xs w-36"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />

                  {(selectedBranch !== "all" || startDate || endDate) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => {
                        setSelectedBranch("all");
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
                <div className="py-12 text-center text-muted-foreground space-y-2">
                  <Coins className="w-8 h-8 text-muted-foreground/50 mx-auto" />
                  <p className="text-sm font-medium">No se encontraron cortes de ventas en el período.</p>
                </div>
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
                        <TableHead>Origen</TableHead>
                        <TableHead>Estatus</TableHead>
                        <TableHead>Recibido por</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cuts.map((cut) => {
                        const paymentParts = [];
                        if (cut.cashSales !== null) paymentParts.push(`Efectivo: ${formatMXN(cut.cashSales)}`);
                        if (cut.cardSales !== null) paymentParts.push(`Tarjeta: ${formatMXN(cut.cardSales)}`);
                        if (cut.otherPayments !== null) paymentParts.push(`Otros: ${formatMXN(cut.otherPayments)}`);

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
                              {formatMXN(cut.totalSales)}
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
                            <TableCell>{getSourceBadge(cut.source)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {cut.status === "VALIDATED" ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-green-500 font-semibold">
                                    <CheckCircle className="h-3 w-3" /> Validado
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-yellow-500 font-semibold">
                                    <AlertCircle className="h-3 w-3" /> Observación
                                  </span>
                                )}
                                {cut.validationNotes && (
                                  <span className="text-[10px] text-muted-foreground max-w-[200px] leading-tight block">
                                    {cut.validationNotes}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex flex-col">
                                <span className="font-medium text-muted-foreground">{cut.receivedByName || "Sistema"}</span>
                                <span className="text-[10px] text-muted-foreground/75">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
