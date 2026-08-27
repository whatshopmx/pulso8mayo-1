"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { formatCents } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Loader2,
  Plus,
  RefreshCw,
  Wallet,
  FileText,
  ArrowRight,
  Search,
  DollarSign,
  Calendar,
  AlertCircle,
  Building2,
  Clock,
  Download,
  CheckCheck,
} from "lucide-react";
import { CreatePaymentRunModal } from "./create-payment-run-modal";
import { CreateRecurringContractModal } from "./create-recurring-contract-modal";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }
> = {
  APPROVED: {
    label: "Aprobada",
    variant: "default",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium",
  },
  EXECUTED: { label: "Pagada", variant: "secondary" },
  PAID: { label: "Pagada", variant: "secondary" },
  PENDING: {
    label: "Pendiente",
    variant: "outline",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20 font-medium",
  },
  DRAFT: { label: "Borrador", variant: "outline" },
  PROCESSING: {
    label: "En Proceso",
    variant: "outline",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/20 font-medium",
  },
  REJECTED: { label: "Rechazada", variant: "destructive" },
};

const CONTRACT_TYPE_MAP: Record<string, string> = {
  RENTAL: "Renta de Local",
  RENTA: "Renta de Local",
  UTILITIES: "Servicios (CFE/Agua)",
  SERVICIOS: "Servicios (CFE/Agua)",
  MAINTENANCE: "Mantenimiento",
  SOFTWARE: "Licencias / SaaS",
  OTHER: "Otro / Varios",
};

const FREQUENCY_MAP: Record<string, string> = {
  MONTHLY: "Mensual",
  MENSUAL: "Mensual",
  WEEKLY: "Semanal",
  BIWEEKLY: "Quincenal",
  ANNUAL: "Anual",
};

function getDueDateUrgency(dateStr: string) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
  // reset hours for calendar day comparison
  target.setHours(0, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: "Vencido", className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20" };
  }
  if (diffDays === 0) {
    return { label: "Vence hoy", className: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/30" };
  }
  if (diffDays <= 3) {
    return { label: `Vence en ${diffDays}d`, className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" };
  }
  return { label: `En ${diffDays}d`, className: "text-muted-foreground border-border/50" };
}

export function TreasuryDashboard() {
  const [data, setData] = useState<{ paymentRuns: any[]; recurringContracts: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/treasury");
      const json = await res.json();
      if (res.ok && json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Error al cargar la tesorería");
      }
    } catch (e) {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rawPaymentRuns = data?.paymentRuns || [];
  const rawRecurringContracts = data?.recurringContracts || [];

  // Filtered runs & contracts
  const paymentRuns = useMemo(() => {
    return rawPaymentRuns.filter((run) => {
      const matchesSearch =
        !searchQuery ||
        run.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.branchName?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "ALL" || run.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rawPaymentRuns, searchQuery, statusFilter]);

  const recurringContracts = useMemo(() => {
    return rawRecurringContracts.filter((contract) => {
      return (
        !searchQuery ||
        contract.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contract.contractType?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [rawRecurringContracts, searchQuery]);

  const downloadLayout = async (runId: string, format: "SPEI_CSV" | "BANORTE_TXT" | "BBVA_TXT" = "SPEI_CSV") => {
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/layout?format=${format}`);
      const json = await res.json();
      if (res.ok && json.success) {
        const blob = new Blob([json.data.content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `layout_${json.data.runTitle.replace(/\s+/g, "_")}_${format}.${format === "SPEI_CSV" ? "csv" : "txt"}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("Error downloading bank layout:", e);
    }
  };

  // Executive KPI summary calculations
  const totalScheduledCents = useMemo(() => {
    return rawPaymentRuns.reduce((acc, r) => acc + (r.totalAmountCents || 0), 0);
  }, [rawPaymentRuns]);

  const monthlyContractsCents = useMemo(() => {
    return rawRecurringContracts.reduce((acc, c) => acc + (c.baseAmountCents || 0), 0);
  }, [rawRecurringContracts]);

  const pendingRunsCount = useMemo(() => {
    return rawPaymentRuns.filter((r) => r.status === "PENDING" || r.status === "DRAFT").length;
  }, [rawPaymentRuns]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-64 items-center justify-center gap-4 text-destructive">
        <AlertCircle className="h-8 w-8" />
        <p className="font-medium">{error}</p>
        <Button variant="outline" onClick={() => load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action Toolbar & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por concepto, proveedor o sucursal..."
              className="pl-9 h-9 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">Todos los estatus</option>
            <option value="PENDING">Pendientes</option>
            <option value="APPROVED">Aprobadas</option>
            <option value="EXECUTED">Pagadas</option>
          </select>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            aria-label="Actualizar tesorería"
            title="Actualizar tesorería"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
          <CreatePaymentRunModal onSuccess={() => load(true)} />
        </div>
      </div>

      {/* Executive Financial KPI Bar */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 flex items-center justify-between space-y-0">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Egresos Programados Total</p>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
              ${formatCents(totalScheduledCents)} <span className="text-xs font-normal text-muted-foreground">MXN</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rawPaymentRuns.length} {rawPaymentRuns.length === 1 ? "corrida activa" : "corridas activas"}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
            <DollarSign className="h-5 w-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between space-y-0">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Gastos Fijos Recurrentes</p>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
              ${formatCents(monthlyContractsCents)} <span className="text-xs font-normal text-muted-foreground">MXN/mes</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rawRecurringContracts.length} {rawRecurringContracts.length === 1 ? "contrato registrado" : "contratos registrados"}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Calendar className="h-5 w-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between space-y-0">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Pendientes de Autorización</p>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
              {pendingRunsCount} <span className="text-xs font-normal text-muted-foreground">corridas</span>
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
              {pendingRunsCount > 0 ? "Requieren revisión financiera" : "Sin pendientes inmediatos"}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="h-5 w-5" />
          </div>
        </Card>
      </div>

      {/* Main Grid Tables */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Corridas de Pago */}
        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Próximas Corridas de Pago</CardTitle>
              <CardDescription>Programación de egresos para nómina y proveedores</CardDescription>
            </div>
            <Wallet className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between">
            {paymentRuns.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Sin corridas encontradas"
                description={
                  searchQuery || statusFilter !== "ALL"
                    ? "No hay corridas que coincidan con los filtros."
                    : "No hay corridas de pago programadas actualmente."
                }
                action={<CreatePaymentRunModal onSuccess={() => load(true)} />}
              />
            ) : (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Título / Concepto</TableHead>
                      <TableHead>Sucursal</TableHead>
                      <TableHead>Fecha / Urgencia</TableHead>
                      <TableHead>Estatus</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Dispersión</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentRuns.map((run) => {
                      const statusInfo = STATUS_CONFIG[run.status] || {
                        label: run.status,
                        variant: "secondary" as const,
                        className: undefined,
                      };
                      const urgency = getDueDateUrgency(run.runDate);

                      return (
                        <TableRow key={run.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="font-medium text-sm">
                            <div>{run.title}</div>
                            {run.description && (
                              <div className="text-xs text-muted-foreground line-clamp-1">
                                {run.description}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {run.branchName || "Todas"}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="text-xs font-medium">
                              {new Date(run.runDate).toLocaleDateString("es-MX", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </div>
                            {urgency && (
                              <Badge
                                variant="outline"
                                className={`text-xs px-1.5 py-0 mt-0.5 font-normal ${urgency.className}`}
                              >
                                {urgency.label}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Badge variant={statusInfo.variant} className={statusInfo.className}>
                              {statusInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium text-sm whitespace-nowrap">
                            ${formatCents(run.totalAmountCents)}{" "}
                            <span className="text-xs text-muted-foreground">{run.currency || "MXN"}</span>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1 border-primary/30 hover:bg-primary/10"
                              onClick={() => downloadLayout(run.id, "SPEI_CSV")}
                              title="Descargar Layout Bancario SPEI (CSV)"
                            >
                              <Download className="h-3 w-3" /> Layout SPEI
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="flex justify-end pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    aria-label="Ver calendario completo de corridas"
                  >
                    Ver calendario completo <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contratos Recurrentes */}
        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Gastos Recurrentes</CardTitle>
              <CardDescription>Renta de inmuebles, CFE, servicios y mantenimiento</CardDescription>
            </div>
            <FileText className="h-5 w-5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between">
            {recurringContracts.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Sin contratos registrados"
                description={
                  searchQuery
                    ? "No hay contratos que coincidan con la búsqueda."
                    : "Registra la renta mensual o CFE para habilitar alertas de vencimiento."
                }
                action={<CreateRecurringContractModal onSuccess={() => load(true)} />}
              />
            ) : (
              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Concepto</TableHead>
                      <TableHead>Tipo / Categoría</TableHead>
                      <TableHead>Frecuencia</TableHead>
                      <TableHead className="text-right">Monto Base</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recurringContracts.map((contract) => (
                      <TableRow key={contract.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell className="font-medium text-sm">
                          <div>{contract.title}</div>
                          {contract.vendorName && (
                            <div className="text-xs text-muted-foreground">{contract.vendorName}</div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className="text-xs font-normal">
                            {CONTRACT_TYPE_MAP[contract.contractType] || contract.contractType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {FREQUENCY_MAP[contract.paymentFrequency] || contract.paymentFrequency}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm whitespace-nowrap">
                          ${formatCents(contract.baseAmountCents)}{" "}
                          <span className="text-xs text-muted-foreground">MXN</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-end items-center space-x-2 pt-2">
                  <CreateRecurringContractModal
                    onSuccess={() => load(true)}
                    trigger={
                      <Button variant="outline" size="sm" className="text-xs">
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Registrar Otro
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    aria-label="Administrar contratos recurrentes"
                  >
                    Administrar contratos <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

