"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useBranch } from "@/lib/branch-context";
import { useBranches } from "@/hooks/queries/use-branches";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CreditCard,
  UploadCloud,
  FileSpreadsheet,
  Calendar,
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Receipt,
  Percent,
  TrendingDown,
  ArrowRight,
  ShieldCheck,
  Scale,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { formatCents } from "@/lib/utils";
import Link from "next/link";
import type { AcquirerType } from "@/lib/services/gateway-report-parser";
import type { CommissionAuditResult } from "@/lib/services/commission-service";

interface GatewayTransactionItem {
  id: string;
  branchId: string;
  branchName: string | null;
  acquirer: string;
  externalId: string | null;
  authorizationCode: string | null;
  transactionDate: string;
  cardLast4: string | null;
  cardBrand: string | null;
  cardType: string | null;
  grossAmountCents: number;
  feeAmountCents: number;
  feeVatCents: number;
  netAmountCents: number;
  settlementDate: string | null;
  batchNumber: string | null;
  status: string;
  importedAt: string;
  importedByName: string | null;
}

interface TransactionsSummary {
  totalGrossCents: number;
  totalFeeCents: number;
  totalFeeVatCents: number;
  totalNetCents: number;
}

export default function ReconciliationPage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <ReconciliationContent />
    </Suspense>
  );
}

function ReconciliationContent() {
  const { selectedBranchId } = useBranch();
  const { data: branchesData } = useBranches();
  const branches = branchesData ?? [];

  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<GatewayTransactionItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<TransactionsSummary>({
    totalGrossCents: 0,
    totalFeeCents: 0,
    totalFeeVatCents: 0,
    totalNetCents: 0,
  });

  // Filtros
  const [acquirerFilter, setAcquirerFilter] = useState<string>("ALL");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Tab activa
  const [activeTab, setActiveTab] = useState<"transactions" | "audit">("transactions");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<CommissionAuditResult | null>(null);

  // Modal de subida
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBranchId, setUploadBranchId] = useState<string>("");
  const [uploadAcquirer, setUploadAcquirer] = useState<AcquirerType>("CLIP");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Inicializar sucursal de subida
  useEffect(() => {
    if (selectedBranchId && selectedBranchId !== "ALL") {
      setUploadBranchId(selectedBranchId);
    } else if (branches.length > 0 && !uploadBranchId) {
      setUploadBranchId(branches[0].id);
    }
  }, [selectedBranchId, branches, uploadBranchId]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId && selectedBranchId !== "ALL") {
        params.set("branchId", selectedBranchId);
      }
      if (acquirerFilter !== "ALL") {
        params.set("acquirer", acquirerFilter);
      }
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const res = await fetch(
        `/api/finance/reconciliation/transactions?${params.toString()}`
      );
      if (!res.ok) throw new Error("Error al cargar transacciones");
      const json = await res.json();
      setTransactions(json.data.items || []);
      setTotalCount(json.data.total || 0);
      setSummary(
        json.data.summary || {
          totalGrossCents: 0,
          totalFeeCents: 0,
          totalFeeVatCents: 0,
          totalNetCents: 0,
        }
      );
    } catch (err) {
      console.error("Error fetching transactions:", err);
      toast.error("No se pudieron cargar las transacciones de pasarela.");
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, acquirerFilter, startDate, endDate]);

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId && selectedBranchId !== "ALL") {
        params.set("branchId", selectedBranchId);
      }
      if (acquirerFilter !== "ALL") {
        params.set("acquirer", acquirerFilter);
      }
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const res = await fetch(
        `/api/finance/commissions/audit?${params.toString()}`
      );
      if (!res.ok) throw new Error("Error al auditar comisiones");
      const json = await res.json();
      setAuditResult(json.data || null);
    } catch (err) {
      console.error("Error fetching commission audit:", err);
      toast.error("No se pudo ejecutar la auditoría de comisiones.");
    } finally {
      setAuditLoading(false);
    }
  }, [selectedBranchId, acquirerFilter, startDate, endDate]);

  useEffect(() => {
    fetchTransactions();
    fetchAudit();
  }, [fetchTransactions, fetchAudit]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.error("Selecciona un archivo CSV o Excel.");
      return;
    }
    if (!uploadBranchId) {
      toast.error("Selecciona la sucursal a la que corresponde el reporte.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("branchId", uploadBranchId);
      formData.append("acquirer", uploadAcquirer);

      const res = await fetch("/api/finance/reconciliation/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Error al procesar el archivo");
      }

      const { data: result } = await res.json();
      toast.success(
        `Reporte procesado: ${result.insertedCount} transacciones nuevas (${result.duplicateCount} duplicadas omitidas).`
      );
      setUploadOpen(false);
      setUploadFile(null);
      fetchTransactions();
      fetchAudit();
    } catch (err: any) {
      console.error("Error uploading report:", err);
      toast.error(err.message || "Error al subir reporte de pasarela.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Conciliación TPV y Pasarelas
            </h1>
            <Badge variant="outline" className="border-primary text-primary text-xs">
              Banda 2
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Importación de reportes de agregadores (Clip, Mercado Pago, bancos),
            auditoría de comisiones MDR e IVA acreditable (16%).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/finance/cash-flow">
              Ver Flujo de Efectivo
            </Link>
          </Button>
          <Button onClick={() => setUploadOpen(true)} size="sm">
            <UploadCloud className="h-4 w-4 mr-2" />
            Cargar Reporte Pasarela
          </Button>
        </div>
      </div>

      {/* Tarjetas KPI de Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CreditCard className="h-4 w-4 text-primary" />
              Venta Bruta Tarjeta
            </span>
            <p className="text-2xl font-bold text-foreground">
              {formatCents(summary.totalGrossCents)}
            </p>
            <span className="text-xs text-muted-foreground">
              {totalCount} transacciones importadas
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-warning-text" />
              Comisión Retenida (Base)
            </span>
            <p className="text-2xl font-bold text-foreground">
              {formatCents(summary.totalFeeCents)}
            </p>
            <span className="text-xs text-muted-foreground">
              {summary.totalGrossCents > 0
                ? `${((summary.totalFeeCents / summary.totalGrossCents) * 100).toFixed(2)}% tasa promedio`
                : "Sin datos"}
            </span>
          </CardContent>
        </Card>

        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Percent className="h-4 w-4 text-success" />
                IVA Comisión (16%)
              </span>
              <Badge variant="outline" className="text-xs font-semibold border-success text-success bg-success/10 py-0.5">
                Acreditable
              </Badge>
            </div>
            <p className="text-2xl font-bold text-success">
              {formatCents(summary.totalFeeVatCents)}
            </p>
            <span className="text-xs text-muted-foreground">
              Segregado para conciliación fiscal SAT
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Abono Neto a Banco
            </span>
            <p className="text-2xl font-bold text-foreground">
              {formatCents(summary.totalNetCents)}
            </p>
            <span className="text-xs text-muted-foreground">
              Bruto menos comisiones e IVA
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Pasarela / Adquirente
              </Label>
              <Select value={acquirerFilter} onValueChange={setAcquirerFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas las pasarelas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas las pasarelas</SelectItem>
                  <SelectItem value="CLIP">Clip</SelectItem>
                  <SelectItem value="MERCADO_PAGO">Mercado Pago</SelectItem>
                  <SelectItem value="BBVA">BBVA</SelectItem>
                  <SelectItem value="BANORTE">Banorte</SelectItem>
                  <SelectItem value="SANTANDER">Santander</SelectItem>
                  <SelectItem value="OTHER">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-[160px]">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Desde
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="w-[160px]">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Hasta
              </Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            {(acquirerFilter !== "ALL" || startDate || endDate) && (
              <div className="self-end pb-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAcquirerFilter("ALL");
                    setStartDate("");
                    setEndDate("");
                  }}
                  className="h-9 text-xs"
                >
                  Limpiar filtros
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pestañas: Transacciones y Auditoría de Comisiones */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full space-y-4">
        <div className="flex items-center justify-between">
          <TabsList className="grid grid-cols-2 w-[380px]">
            <TabsTrigger value="transactions" className="text-xs">
              Transacciones ({totalCount})
            </TabsTrigger>
            <TabsTrigger value="audit" className="text-xs flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5" />
              Auditoría de Comisiones
              {auditResult && auditResult.discrepanciesCount > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0 font-semibold">
                  {auditResult.discrepanciesCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Transacciones Importadas */}
        <TabsContent value="transactions" className="m-0 space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Transacciones Importadas ({totalCount})
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {transactions.length} mostradas
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs">Cargando transacciones...</span>
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto" />
                  <p className="font-semibold text-foreground">
                    No hay transacciones importadas para este filtro
                  </p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    Sube los reportes en CSV o Excel descargados de tu portal Clip,
                    Mercado Pago o banco para auditar las comisiones.
                  </p>
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <UploadCloud className="h-4 w-4 mr-2" />
                    Cargar primer reporte
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Fecha / Hora</TableHead>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Pasarela</TableHead>
                        <TableHead>Tarjeta</TableHead>
                        <TableHead>Autorización / ID</TableHead>
                        <TableHead className="text-right">Monto Bruto</TableHead>
                        <TableHead className="text-right">Comisión</TableHead>
                        <TableHead className="text-right">IVA (16%)</TableHead>
                        <TableHead className="text-right">Neto Liquidado</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactions.map((tx) => (
                        <TableRow key={tx.id} className="text-xs">
                          <TableCell className="font-medium whitespace-nowrap">
                            {new Date(tx.transactionDate).toLocaleDateString("es-MX", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </TableCell>
                          <TableCell>{tx.branchName || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs font-medium">
                              {tx.acquirer}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 font-mono">
                              {tx.cardBrand && (
                                <span className="text-xs font-semibold text-muted-foreground">
                                  {tx.cardBrand}
                                </span>
                              )}
                              {tx.cardLast4 ? `•••• ${tx.cardLast4}` : "—"}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[140px] truncate" title={tx.externalId || tx.authorizationCode || ""}>
                            {tx.authorizationCode ? (
                              <span>Aut: {tx.authorizationCode}</span>
                            ) : (
                              <span className="text-muted-foreground">{tx.externalId?.slice(0, 10)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatCents(tx.grossAmountCents)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatCents(tx.feeAmountCents)}
                          </TableCell>
                          <TableCell className="text-right text-success font-medium">
                            {formatCents(tx.feeVatCents)}
                          </TableCell>
                          <TableCell className="text-right font-bold text-foreground">
                            {formatCents(tx.netAmountCents)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">
                              {tx.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Auditoría de Comisiones */}
        <TabsContent value="audit" className="m-0 space-y-4">
          {auditLoading ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="text-xs">Auditando comisiones con tarifas pactadas...</span>
              </CardContent>
            </Card>
          ) : !auditResult || auditResult.totalAudited === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Scale className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="font-semibold text-foreground">
                  Sin transacciones para auditar
                </p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Importa reportes de pasarela para contrastar la retención real contra las tarifas contractuales registradas.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Banner de Estado de Auditoría */}
              {auditResult.discrepanciesCount === 0 ? (
                <div className="rounded-lg border border-success/40 bg-success/10 p-4 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                  <div className="text-xs">
                    <p className="font-semibold text-success">
                      Auditoría Conforme: Sin sobrecobros detectados
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      Las {auditResult.totalAudited} transacciones auditadas coinciden exactamente con las tarifas MDR configuradas (+ 16% IVA acreditable).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-xs">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                      <p className="font-semibold text-destructive">
                        {auditResult.discrepanciesCount} transacción(es) con discrepancia de comisión
                      </p>
                      <p className="text-muted-foreground mt-0.5">
                        Sobrecobro total acumulado de{" "}
                        <strong className="text-destructive font-semibold">
                          {formatCents(auditResult.totalOverchargeCents)}
                        </strong>{" "}
                        respecto a la tarifa contratada.
                      </p>
                    </div>
                  </div>
                  <Badge variant="destructive" className="text-xs px-2.5 py-1">
                    Revisión Requerida
                  </Badge>
                </div>
              )}

              {/* Tarjetas de Auditoría */}
              {/* Tarjetas de Auditoría */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 space-y-1">
                    <span className="text-xs text-muted-foreground">Venta Bruta Auditada</span>
                    <p className="text-xl font-bold">{formatCents(auditResult.totalGrossCents)}</p>
                    <span className="text-xs text-muted-foreground">100% íntegra para P&L</span>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 space-y-1">
                    <span className="text-xs text-muted-foreground">Retención Cobrada Real</span>
                    <p className="text-xl font-bold">{formatCents(auditResult.totalActualFeeCents)}</p>
                    <span className="text-xs text-muted-foreground">
                      Tasa promedio: {(auditResult.effectiveAvgRateBps / 100).toFixed(2)}%
                    </span>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 space-y-1">
                    <span className="text-xs text-muted-foreground">Tarifa Esperada Pactada</span>
                    <p className="text-xl font-bold">{formatCents(auditResult.totalExpectedFeeCents)}</p>
                    <span className="text-xs text-muted-foreground">Tarifa contrato + IVA 16%</span>
                  </CardContent>
                </Card>
                <Card className={auditResult.totalOverchargeCents > 0 ? "border-destructive/40 bg-destructive/5" : ""}>
                  <CardContent className="p-4 space-y-1">
                    <span className="text-xs text-muted-foreground">Sobrecobro Detectado</span>
                    <p className={`text-xl font-bold ${auditResult.totalOverchargeCents > 0 ? "text-destructive" : "text-foreground"}`}>
                      {formatCents(auditResult.totalOverchargeCents)}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      Reclamable ante el adquirente
                    </span>
                  </CardContent>
                </Card>
              </div>

              {/* Tabla de Discrepancias */}
              <Card>
                <CardHeader className="pb-3 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">
                      Detalle de Inconsistencias de Comisión ({auditResult.discrepancies.length})
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      Tolerancia de cuadre: ±$0.50 MXN por redondeo
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {auditResult.discrepancies.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      Todas las transacciones se ajustan a la tarifa contratada dentro del margen de tolerancia.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead>Fecha</TableHead>
                            <TableHead>Autorización / ID</TableHead>
                            <TableHead>Tarjeta</TableHead>
                            <TableHead className="text-right">Monto Bruto</TableHead>
                            <TableHead className="text-right">Tarifa Pactada</TableHead>
                            <TableHead className="text-right">Cobrado Real</TableHead>
                            <TableHead className="text-right">Esperado Contrato</TableHead>
                            <TableHead className="text-right">Diferencia</TableHead>
                            <TableHead>Resultado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditResult.discrepancies.map((d) => (
                            <TableRow key={d.transactionId} className="text-xs">
                              <TableCell className="whitespace-nowrap font-medium">
                                {new Date(d.transactionDate).toLocaleDateString("es-MX", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {d.authorizationCode ? `Aut: ${d.authorizationCode}` : d.externalId?.slice(0, 10)}
                              </TableCell>
                              <TableCell>
                                <span className="font-mono text-xs">
                                  {d.cardBrand || "—"} {d.cardType ? `(${d.cardType})` : ""}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatCents(d.grossAmountCents)}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {(d.rateBpsApplied / 100).toFixed(2)}% + {(d.vatBpsApplied / 100).toFixed(0)}% IVA
                              </TableCell>
                              <TableCell className="text-right font-semibold text-foreground">
                                {formatCents(d.actualTotalFeeCents)}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {formatCents(d.expectedTotalFeeCents)}
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                <span className={d.type === "OVERCHARGED" ? "text-destructive" : "text-primary"}>
                                  {d.differenceCents > 0 ? `+${formatCents(d.differenceCents)}` : formatCents(d.differenceCents)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={d.type === "OVERCHARGED" ? "destructive" : "secondary"}
                                  className="text-xs"
                                >
                                  {d.type === "OVERCHARGED" ? "SOBRECOBRO" : "A FAVOR"}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal de Carga de Reporte */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UploadCloud className="h-5 w-5 text-primary" />
              Cargar Reporte de Pasarela
            </DialogTitle>
            <DialogDescription>
              Sube el archivo CSV o Excel descargado de Clip, Mercado Pago o portal bancario.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUploadSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="uploadBranch" className="text-xs font-medium">
                Sucursal destino *
              </Label>
              <Select value={uploadBranchId} onValueChange={setUploadBranchId}>
                <SelectTrigger id="uploadBranch" className="text-xs">
                  <SelectValue placeholder="Selecciona una sucursal" />
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

            <div className="space-y-1.5">
              <Label htmlFor="uploadAcquirer" className="text-xs font-medium">
                Pasarela / Banco adquirente *
              </Label>
              <Select
                value={uploadAcquirer}
                onValueChange={(val) => setUploadAcquirer(val as AcquirerType)}
              >
                <SelectTrigger id="uploadAcquirer" className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CLIP">Clip</SelectItem>
                  <SelectItem value="MERCADO_PAGO">Mercado Pago</SelectItem>
                  <SelectItem value="BBVA">BBVA</SelectItem>
                  <SelectItem value="BANORTE">Banorte</SelectItem>
                  <SelectItem value="SANTANDER">Santander</SelectItem>
                  <SelectItem value="OTHER">Otro proveedor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reportFile" className="text-xs font-medium">
                Archivo (.csv o .xlsx) *
              </Label>
              <Input
                id="reportFile"
                type="file"
                accept=".csv,.xlsx,.xlsm,.txt"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="text-xs file:text-xs file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary file:text-primary-foreground"
              />
              <span className="text-xs text-muted-foreground block">
                Las transacciones repetidas son detectadas y omitidas automáticamente.
              </span>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadOpen(false)}
                disabled={uploading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={uploading}>
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  "Importar Transacciones"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
