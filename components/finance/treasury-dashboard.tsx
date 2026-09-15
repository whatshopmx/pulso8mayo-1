"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { CreatePaymentRunModal } from "./create-payment-run-modal";
import { CreateRecurringContractModal } from "./create-recurring-contract-modal";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }
> = {
  DRAFT: {
    label: "Borrador",
    variant: "outline",
    className: "bg-muted text-muted-foreground border-border font-medium",
  },
  PENDING_APPROVAL: {
    label: "Pendiente Aprobación",
    variant: "outline",
    className: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25 font-medium",
  },
  PENDING: {
    label: "Pendiente Aprobación",
    variant: "outline",
    className: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25 font-medium",
  },
  APPROVED: {
    label: "Aprobada",
    variant: "default",
    className: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/25 font-medium",
  },
  PROCESSING: {
    label: "En Proceso",
    variant: "outline",
    className: "bg-sky-500/10 text-sky-800 dark:text-sky-300 border-sky-500/25 font-medium",
  },
  COMPLETED: {
    label: "Pagada / Completada",
    variant: "secondary",
    className: "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 border-emerald-600/25 font-medium",
  },
  EXECUTED: { label: "Pagada", variant: "secondary" },
  PAID: { label: "Pagada", variant: "secondary" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
};

const CONTRACT_TYPE_MAP: Record<string, string> = {
  RENTA: "Renta de Local",
  RENTAL: "Renta de Local",
  SERVICIO_BASICO: "Servicios Básicos (CFE/Agua)",
  UTILITIES: "Servicios Básicos (CFE/Agua)",
  SERVICIOS: "Servicios Básicos (CFE/Agua)",
  MANTENIMIENTO: "Mantenimiento",
  MAINTENANCE: "Mantenimiento",
  SOFTWARE: "Licencias / SaaS",
  OTHER: "Otro / Varios",
};

const FREQUENCY_MAP: Record<string, string> = {
  MONTHLY: "Mensual",
  MENSUAL: "Mensual",
  WEEKLY: "Semanal",
  BIWEEKLY: "Quincenal",
  QUARTERLY: "Trimestral",
  ANNUAL: "Anual",
};

function getDueDateUrgency(dateStr: string) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const now = new Date();
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut '/' to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      setError("Error de conexión con el servicio de tesorería");
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
      const matchesStatus =
        statusFilter === "ALL" ||
        run.status === statusFilter ||
        (statusFilter === "PENDING_APPROVAL" && (run.status === "PENDING" || run.status === "PENDING_APPROVAL")) ||
        (statusFilter === "COMPLETED" && (run.status === "COMPLETED" || run.status === "EXECUTED" || run.status === "PAID"));
      return matchesSearch && matchesStatus;
    });
  }, [rawPaymentRuns, searchQuery, statusFilter]);

  const recurringContracts = useMemo(() => {
    return rawRecurringContracts.filter((contract) => {
      return (
        !searchQuery ||
        contract.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contract.contractType?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contract.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [rawRecurringContracts, searchQuery]);

  const downloadLayout = async (
    runId: string,
    runTitle: string,
    format: "SPEI_CSV" = "SPEI_CSV"
  ) => {
    try {
      const res = await fetch(`/api/finance/treasury/runs/${runId}/layout?format=${format}`);
      const json = await res.json();
      if (res.ok && json.success) {
        const blob = new Blob([json.data.content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const formatLabel = "spei.csv";
        a.download = `layout_${(json.data.runTitle || runTitle || "corrida").replace(/\s+/g, "_")}_${formatLabel}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const nombreFormato = "SPEI (CSV)";

        // Las dos cifras juntas, siempre. Antes el toast decía "N registros
        // listos" con un `recordCount` que no cuadraba con las partidas de la
        // corrida, porque nómina, caja chica e impuestos se descartaban en
        // silencio: la dueña subía al banco un archivo por menos dinero del que
        // había firmado y no tenía cómo enterarse.
        const excluidas = Number(json.data.excludedCount || 0);
        const partidas = Number(json.data.itemCount || 0);

        toast.success("Layout bancario descargado", {
          description:
            `Formato ${nombreFormato}: ${json.data.recordCount || 0} transferencias por $${json.data.totalPesos} MXN` +
            (excluidas > 0
              ? `. ${excluidas} de ${partidas} partidas quedaron fuera del archivo ($${((json.data.excludedAmountCents || 0) / 100).toFixed(2)} MXN) — revísalas antes de dar por pagada la corrida.`
              : "."),
          duration: excluidas > 0 ? 12_000 : 6_000,
        });

        // El detalle de cada exclusión, con lo que hay que hacer para
        // resolverla. Un toast por partida satura la pantalla, así que van
        // agrupadas en uno solo, en el orden en que salieron.
        if (Array.isArray(json.data.excluded) && json.data.excluded.length > 0) {
          toast.warning("Partidas que no viajan en el archivo", {
            description: json.data.excluded
              .map((e: { motivo: string }) => `• ${e.motivo}`)
              .join("\n"),
            duration: 20_000,
          });
        }

        // Avisos que no impiden el pago pero cambian a dónde va: una CLABE que
        // el proveedor movió después de que se firmó la corrida, por ejemplo.
        if (Array.isArray(json.data.avisos) && json.data.avisos.length > 0) {
          toast.warning("Revisa antes de subirlo al banco", {
            description: json.data.avisos.join("\n"),
            duration: 20_000,
          });
        }
      } else {
        toast.error("Error al descargar layout", {
          description: json.error || "No se pudo generar el archivo de dispersión.",
          duration: 12_000,
        });
      }
    } catch (e) {
      toast.error("Error de conexión", { description: "No se pudo contactar al servidor bancario." });
    }
  };

  // Executive Financial KPI summary calculations
  const totalScheduledCents = useMemo(() => {
    return rawPaymentRuns.reduce((acc, r) => acc + (r.totalAmountCents || 0), 0);
  }, [rawPaymentRuns]);

  /**
   * Compromiso recurrente equivalente a un mes.
   *
   * Antes esto sumaba `baseAmountCents` de TODOS los contratos y rotulaba el
   * total como "MXN/mes": una licencia anual de $120,000 entraba completa como
   * si se pagara cada mes, y el número que el dueño usa para saber cuánto tiene
   * comprometido salía inflado por un factor de doce.
   *
   * Un contrato de frecuencia desconocida se cuenta como mensual —es la
   * omisión de la columna— pero se cuenta aparte para poder decirlo.
   */
  const { monthlyContractsCents, contratosSinFrecuencia } = useMemo(() => {
    // Divisor: cuántos períodos de ese contrato caben en un mes.
    const MESES_POR_PERIODO: Record<string, number> = {
      WEEKLY: 1 / (52 / 12), // 52 semanas al año, no 4 al mes
      SEMANAL: 1 / (52 / 12),
      BIWEEKLY: 0.5,
      QUINCENAL: 0.5,
      MONTHLY: 1,
      MENSUAL: 1,
      QUARTERLY: 3,
      TRIMESTRAL: 3,
      ANNUAL: 12,
      ANUAL: 12,
    };

    let cents = 0;
    let desconocidas = 0;
    for (const c of rawRecurringContracts) {
      const base = c.baseAmountCents || 0;
      const meses = MESES_POR_PERIODO[(c.paymentFrequency || "").toUpperCase()];
      if (meses === undefined) desconocidas += 1;
      cents += Math.round(base / (meses ?? 1));
    }
    return { monthlyContractsCents: cents, contratosSinFrecuencia: desconocidas };
  }, [rawRecurringContracts]);

  /**
   * `true` si algún contrato es de monto variable (luz, agua, mantenimiento).
   * El KPI no puede presentarse como una cifra firme cuando parte de lo que
   * suma es un monto BASE esperado y no un importe pactado.
   */
  const hayMontosVariables = useMemo(
    () =>
      rawRecurringContracts.some(
        (c) => c.contractType === "SERVICIO_BASICO" || c.contractType === "MANTENIMIENTO",
      ),
    [rawRecurringContracts],
  );

  const pendingRunsCount = useMemo(() => {
    return rawPaymentRuns.filter((r) => r.status === "PENDING" || r.status === "PENDING_APPROVAL" || r.status === "DRAFT").length;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              type="search"
              placeholder="Buscar corrida, proveedor o sucursal (Presiona '/' para enfocar)..."
              className="pl-9 h-10 sm:h-9 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Buscar corrida, proveedor o sucursal. Presiona la tecla diagonal para enfocar."
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[190px] h-10 sm:h-9 text-xs" aria-label="Filtrar por estatus de corrida">
              <SelectValue placeholder="Todos los estatus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los estatus</SelectItem>
              <SelectItem value="DRAFT">Borradores</SelectItem>
              <SelectItem value="PENDING_APPROVAL">Pendientes Aprobación</SelectItem>
              <SelectItem value="APPROVED">Aprobadas</SelectItem>
              <SelectItem value="PROCESSING">En Proceso</SelectItem>
              <SelectItem value="COMPLETED">Pagadas / Completadas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-10 sm:h-9 px-3 min-h-[44px] sm:min-h-0 text-xs"
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
        <Card
          className="p-4 flex items-center justify-between space-y-0 cursor-pointer hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setStatusFilter("ALL")}
          tabIndex={0}
          role="button"
          aria-label="Filtrar todas las corridas"
        >
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
            {/* "Fijos" era falso justo donde más importa: la luz y el agua
                son recurrentes pero no fijos, y llamarlos fijos invita a
                presupuestar con un número que no se va a cumplir. */}
            <p className="text-xs font-medium text-muted-foreground">Compromiso Recurrente</p>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
              ${formatCents(monthlyContractsCents)}{" "}
              <span className="text-xs font-normal text-muted-foreground">MXN/mes</span>
              {hayMontosVariables && (
                <span className="text-xs font-normal text-muted-foreground" title="Incluye servicios de monto variable: la cifra es el monto base esperado, no un importe pactado.">
                  {" "}≈
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rawRecurringContracts.length}{" "}
              {rawRecurringContracts.length === 1 ? "contrato registrado" : "contratos registrados"}
              {/* Trimestral y anual se prorratean para que la suma sea de
                  verdad mensual; decirlo evita que alguien la contraste contra
                  el estado de cuenta y crea que falta dinero. */}
              , prorrateados a un mes
              {contratosSinFrecuencia > 0 && (
                <>
                  {" "}· {contratosSinFrecuencia} sin periodicidad, contado{contratosSinFrecuencia === 1 ? "" : "s"} como mensual
                </>
              )}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Calendar className="h-5 w-5" />
          </div>
        </Card>

        <Card
          className="p-4 flex items-center justify-between space-y-0 cursor-pointer hover:border-amber-500/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setStatusFilter("PENDING_APPROVAL")}
          tabIndex={0}
          role="button"
          aria-label="Filtrar corridas pendientes de autorización"
        >
          <div>
            <p className="text-xs font-medium text-muted-foreground">Pendientes de Autorización</p>
            <p className="text-2xl font-bold tracking-tight text-foreground mt-1">
              {pendingRunsCount} <span className="text-xs font-normal text-muted-foreground">corridas</span>
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">
              {pendingRunsCount > 0 ? "Haz clic para filtrar pendientes" : "Sin pendientes inmediatos"}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="h-5 w-5" />
          </div>
        </Card>
      </div>

      {/* Main Sections (Full-Width Stacked for Breathing Room) */}
      <div className="space-y-6">
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
                <div className="overflow-x-auto w-full -mx-2 px-2 sm:mx-0 sm:px-0">
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
                        const isDownloadable =
                          run.status === "APPROVED" ||
                          run.status === "PROCESSING" ||
                          run.status === "COMPLETED" ||
                          run.status === "EXECUTED" ||
                          run.status === "PAID";

                        return (
                          <TableRow key={run.id} className="hover:bg-muted/50 transition-colors group">
                            <TableCell className="font-medium text-sm">
                              <Link
                                href={`/dashboard/finance/treasury/runs/${run.id}`}
                                className="hover:text-primary transition-colors flex items-center gap-1.5 font-semibold py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                                aria-label={`Ver detalle de corrida ${run.title}`}
                              >
                                {run.title}
                                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                              </Link>
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
                                disabled={!isDownloadable}
                                className="h-9 sm:h-7 min-h-[44px] sm:min-h-0 text-xs gap-1 border-primary/30 hover:bg-primary/10 disabled:opacity-50"
                                title={
                                  isDownloadable
                                    ? "Descargar el archivo de dispersión SPEI de esta corrida"
                                    : "La corrida debe estar aprobada para descargar el layout SPEI"
                                }
                                aria-label={`Descargar layout SPEI para ${run.title}`}
                                onClick={() => downloadLayout(run.id, run.title)}
                              >
                                <Download className="h-3.5 w-3.5 sm:h-3 sm:w-3" /> Layout SPEI
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-9 sm:h-8"
                    asChild
                  >
                    <Link href="/dashboard/finance/cash-flow">
                      Ver calendario completo <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
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
                <div className="overflow-x-auto w-full -mx-2 px-2 sm:mx-0 sm:px-0">
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
                </div>
                <div className="flex flex-wrap justify-end items-center gap-2 pt-2">
                  <CreateRecurringContractModal
                    onSuccess={() => load(true)}
                    trigger={
                      <Button variant="outline" size="sm" className="text-xs h-9 sm:h-8">
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Registrar Otro
                      </Button>
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-9 sm:h-8"
                    asChild
                  >
                    <Link href="/dashboard/finance/payees">
                      Administrar contrapartes <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
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
