"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  FileText,
  Download,
  Shield,
  Building2,
  Sparkles,
  MessageSquare,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  ResponsiveContainer,
  Cell,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  RateBadge,
  getRateBadgeVariant,
  getRateColor,
  getRateClasses,
  getRateTextClass,
  getRateProgressClasses,
  getRateTier,
} from "@/components/compliance/rate-badge";
import { toast } from "sonner";
import { ErrorState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface TrendData {
  date: string;
  complianceRate: number;
  completedWorkflows: number;
}

interface Scorecard {
  category: string;
  complianceType?: string | null;
  complianceRate: number;
  totalWorkflows: number;
  criticalWorkflows: number;
}

interface Deadline {
  id: string;
  name: string;
  branchName: string;
  branchId?: string | null;
  dueDate?: Date | string | null;
  complianceType?: string | null;
  isCritical: boolean;
}

interface Alert {
  id: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "WARNING" | "FATAL";
  status: "DETECTED" | "IN_REMEDIATION" | "RESOLVED" | "ESCALATED";
  branchId?: string | null;
  createdAt: Date | string;
  workflowName?: string | null;
}

interface BranchBreakdown {
  branchId?: string | null;
  branchName: string;
  complianceRate: number;
  totalWorkflows: number;
  criticalIssues: number;
}

interface BranchStatus {
  branchId: string;
  branchName: string;
  managerName: string;
  active: boolean;
  complianceRate: number;
  totalInspections: number;
  completedInspections: number;
  incidents: {
    total: number;
    open: number;
    critical: number;
  };
  error?: boolean;
}

interface ComplianceData {
  trends: TrendData[];
  scorecards: Scorecard[];
  deadlines: Deadline[];
  alerts: Alert[];
  branchBreakdown: BranchBreakdown[];
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
}

const chartConfig = {
  complianceRate: {
    label: "Tasa de Cumplimiento",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function ComplianceDashboard() {
  const { selectedBranchId, selectedBranch, branches } = useBranch();
  const [data, setData] = useState<ComplianceData | null>(null);
  const [corporateBranches, setCorporateBranches] = useState<BranchStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("30");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(false);
    try {
      const days = parseInt(selectedPeriod);
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - days);

      const params = new URLSearchParams();
      if (selectedBranchId) {
        params.set("branchId", selectedBranchId);
      }
      params.set("days", selectedPeriod);

      const corpParams = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

      const [trendsRes, corpRes] = await Promise.allSettled([
        fetch(`/api/analytics/compliance/trends?${params.toString()}`),
        fetch(`/api/compliance/corporate-status?${corpParams.toString()}`),
      ]);

      if (trendsRes.status === "fulfilled" && trendsRes.value.ok) {
        const trendsJson = await trendsRes.value.json();
        setData(trendsJson);
      } else {
        throw new Error("No se pudieron obtener los datos de tendencias de cumplimiento");
      }

      if (corpRes.status === "fulfilled" && corpRes.value.ok) {
        const corpJson = await corpRes.value.json();
        if (corpJson.success && Array.isArray(corpJson.data?.branches)) {
          setCorporateBranches(corpJson.data.branches);
        }
      }
    } catch (err) {
      console.error("Failed to fetch compliance data", err);
      toast.error("Error al cargar los datos del tablero de cumplimiento");
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedBranchId, selectedPeriod]);

  const sendWhatsAppReminder = async (branch: BranchStatus) => {
    setSendingReminder(branch.branchId);
    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: "branch-manager",
          branchId: branch.branchId,
          type: "whatsapp",
          templateName: "nom-251-reminder",
          data: {
            branchName: branch.branchName,
            managerName: branch.managerName,
            currentRate: `${branch.complianceRate}%`,
            pendingCount: branch.incidents.open.toString(),
          },
        }),
      });

      if (!response.ok) {
        let apiMessage = "";
        try {
          const errJson = await response.json();
          apiMessage = errJson?.error || errJson?.message || "";
        } catch {
          // respuesta sin cuerpo JSON
        }
        throw new Error(apiMessage || `Error ${response.status} al enviar el recordatorio`);
      }

      toast.success(
        `Recordatorio enviado con éxito a ${branch.managerName} (${branch.branchName}) vía WhatsApp`
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "No se pudo enviar el recordatorio de WhatsApp"
      );
    } finally {
      setSendingReminder(null);
    }
  };

  const exportToPDF = async () => {
    if (!data) return;

    const doc = new jsPDF();

    // Header
    doc.setFontSize(18);
    doc.setTextColor(33, 37, 41);
    doc.text("Reporte Ejecutivo de Cumplimiento", 14, 20);

    // Metadata
    doc.setFontSize(10);
    doc.setTextColor(108, 117, 125);
    doc.text(`Período: Últimos ${data.period.days} días`, 14, 28);
    doc.text(`Sucursal: ${selectedBranch ? selectedBranch.name : "Todas las sucursales"}`, 14, 33);
    doc.text(`Generado: ${new Date().toLocaleDateString("es-MX")}`, 14, 38);

    // Overall Compliance
    const overallRate =
      data.scorecards.length > 0
        ? Math.round(
            data.scorecards.reduce((acc, s) => acc + s.complianceRate, 0) / data.scorecards.length
          )
        : 0;

    doc.setFontSize(12);
    doc.setTextColor(33, 37, 41);
    doc.text(`Cumplimiento General: ${overallRate}%`, 14, 48);

    // Scorecards Table
    const scorecardData = data.scorecards.map((s) => [
      s.category,
      s.complianceType || "General",
      `${s.complianceRate}%`,
      s.totalWorkflows.toString(),
      s.criticalWorkflows.toString(),
    ]);

    autoTable(doc, {
      startY: 54,
      head: [["Categoría", "Normativa", "Cumplimiento", "Flujos Totales", "Críticos"]],
      body: scorecardData,
      theme: "striped",
      headStyles: { fillColor: [40, 40, 40] },
    });

    // Alerts Section
    const finalY = (doc as any).lastAutoTable.finalY + 12;
    doc.setFontSize(14);
    doc.text("Alertas y Desviaciones", 14, finalY);

    if (data.alerts.length > 0) {
      const alertData = data.alerts.map((a) => [
        a.title,
        a.severity,
        a.status,
        a.workflowName || "N/A",
        new Date(a.createdAt).toLocaleDateString("es-MX"),
      ]);

      autoTable(doc, {
        startY: finalY + 5,
        head: [["Alerta", "Gravedad", "Estado", "Flujo / Bitácora", "Fecha"]],
        body: alertData,
        theme: "striped",
        headStyles: { fillColor: [40, 40, 40] },
      });
    } else {
      doc.setFontSize(10);
      doc.setTextColor(108, 117, 125);
      doc.text("Sin alertas activas registradas en este período.", 14, finalY + 8);
    }

    doc.save(`resumen-cumplimiento-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground animate-pulse">
          Cargando indicadores de cumplimiento...
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <ErrorState
        message="No se pudo cargar la información del tablero de cumplimiento."
        onRetry={fetchData}
      />
    );
  }

  const overallComplianceRate =
    data.scorecards.length > 0
      ? Math.round(
          data.scorecards.reduce((acc, s) => acc + s.complianceRate, 0) / data.scorecards.length
        )
      : 0;

  const totalAlerts = data.alerts.length;
  const criticalAlerts = data.alerts.filter((a) => a.severity === "CRITICAL" || a.severity === "FATAL").length;

  const validCorporateBranches = corporateBranches.filter((b) => !b.error);
  const showCorporateSection = validCorporateBranches.length > 0;

  // Chart data for inter-branch comparison
  const branchChartData = validCorporateBranches.map((b) => ({
    name: b.branchName,
    complianceRate: b.complianceRate,
  }));

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Executive Control Bar */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-card p-4 rounded-xl border">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs font-medium bg-background border">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              {selectedBranch ? `Sucursal: ${selectedBranch.name}` : "Todas las sucursales"}
            </Badge>

            {data.period && (
              <span className="text-xs text-muted-foreground ml-1">
                {format(new Date(data.period.startDate), "dd 'de' MMMM", { locale: es })} —{" "}
                {format(new Date(data.period.endDate), "dd 'de' MMMM, yyyy", { locale: es })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Period Segmented Filter */}
            <div className="flex gap-1 bg-muted/40 p-1 rounded-lg border">
              {[
                { label: "7 días", value: "7" },
                { label: "30 días", value: "30" },
                { label: "90 días", value: "90" },
              ].map((p) => (
                <Button
                  key={p.value}
                  variant={selectedPeriod === p.value ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedPeriod(p.value)}
                  className="text-xs h-7 px-3 font-semibold rounded-md transition-all"
                >
                  {p.label}
                </Button>
              ))}
            </div>

            <Button onClick={exportToPDF} variant="outline" size="sm" className="h-8 text-xs font-semibold">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Exportar PDF
            </Button>
          </div>
        </div>

        {/* Top KPI Metric Cards */}
        <MetricGrid columns={4}>
          <MetricCard
            label="Cumplimiento General"
            value={`${overallComplianceRate}%`}
            icon={<Shield className="h-4 w-4" />}
            subtitle="Promedio global normativo"
            progress={{ value: overallComplianceRate }}
          />
          <MetricCard
            label="Total de Bitácoras"
            value={data.scorecards.reduce((acc, s) => acc + s.totalWorkflows, 0)}
            icon={<FileText className="h-4 w-4" />}
            subtitle="Completadas en el período"
          />
          <MetricCard
            label="Alertas y Desviaciones"
            value={totalAlerts}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={criticalAlerts > 0 ? "destructive" : totalAlerts > 0 ? "warning" : "neutral"}
            subtitle={`${criticalAlerts} críticas que requieren atención`}
          />
          <MetricCard
            label="Próximos Vencimientos"
            value={data.deadlines.length}
            icon={<Calendar className="h-4 w-4" />}
            subtitle="Obligaciones en próximos 30 días"
          />
        </MetricGrid>

        {/* Operational Action Board: Split Grid for Alerts & Upcoming Deadlines */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Active Alerts Panel */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-text" />
                  Alertas Activas de Cumplimiento
                </CardTitle>
                <Badge variant={totalAlerts > 0 ? "outline" : "secondary"} className="text-xs">
                  {totalAlerts} activas
                </Badge>
              </div>
              <CardDescription>Desviaciones sanitarias o laborales detectadas</CardDescription>
            </CardHeader>
            <CardContent>
              {data.alerts.length > 0 ? (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {data.alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-3.5 border rounded-lg transition-colors ${
                        alert.severity === "CRITICAL" || alert.severity === "FATAL"
                          ? "border-destructive/30 bg-destructive/5"
                          : "border-warning/30 bg-warning/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">{alert.title}</p>
                          {alert.workflowName && (
                            <p className="text-xs text-muted-foreground">
                              Bitácora: {alert.workflowName}
                            </p>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <Badge
                              variant={
                                alert.severity === "CRITICAL" || alert.severity === "FATAL"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="text-xs font-medium"
                            >
                              {alert.severity}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {alert.status}
                            </Badge>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(alert.createdAt).toLocaleDateString("es-MX", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-2.5 text-success opacity-80" />
                  <p className="text-sm font-semibold text-foreground">Sin alertas activas</p>
                  <p className="text-xs">Todos los controles sanitarios y laborales están al día</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Deadlines Panel */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  Próximos Vencimientos Legales
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {data.deadlines.length} pendientes
                </Badge>
              </div>
              <CardDescription>Plazos obligatorios (SUA, IDSE, renovaciones de constancias)</CardDescription>
            </CardHeader>
            <CardContent>
              {data.deadlines.length > 0 ? (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {data.deadlines.map((deadline) => (
                    <div
                      key={deadline.id}
                      className="flex items-center justify-between p-3.5 border rounded-lg hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            deadline.isCritical ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                          }`}
                        >
                          <Clock className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{deadline.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {deadline.branchName} • {deadline.complianceType || "General"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {deadline.isCritical && (
                          <Badge variant="destructive" className="text-xs py-0 px-1.5">
                            Crítico
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs font-mono">
                          {deadline.dueDate
                            ? new Date(deadline.dueDate).toLocaleDateString("es-MX", {
                                day: "numeric",
                                month: "short",
                              })
                            : "Pendiente"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-2.5 opacity-40" />
                  <p className="text-sm font-semibold text-foreground">Sin vencimientos próximos</p>
                  <p className="text-xs">No hay obligaciones legales agendadas en los siguientes 30 días</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Category Scorecards Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold">Evaluaciones por Categoría Normativa</h3>
              <p className="text-xs text-muted-foreground">Desglose de cumplimiento por marco regulatorio</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.scorecards.map((scorecard, index) => (
              <Card key={index}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold">{scorecard.category}</CardTitle>
                      <CardDescription className="text-xs">
                        {scorecard.complianceType || "General"}
                      </CardDescription>
                    </div>
                    <RateBadge rate={scorecard.complianceRate} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-xs">
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Flujos Totales</span>
                    <span className="font-semibold">{scorecard.totalWorkflows}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Flujos Críticos</span>
                    <span
                      className={`font-semibold ${
                        scorecard.criticalWorkflows > 0 ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {scorecard.criticalWorkflows}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Inter-Branch Comparison & Semáforo (Corporate Multi-Branch View) */}
        {showCorporateSection && (
          <div className="space-y-6">
            {/* Comparison Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Comparativa Inter-sucursales
                </CardTitle>
                <CardDescription>Cumplimiento porcentual global por establecimiento</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[220px] w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={branchChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                      <XAxis dataKey="name" fontSize={11} tickLine={false} />
                      <YAxis domain={[0, 100]} fontSize={11} tickLine={false} axisLine={false} />
                      <RechartsTooltip
                        cursor={{ fill: "rgba(0,0,0,0.03)" }}
                        contentStyle={{
                          background: "var(--background)",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="complianceRate" radius={[4, 4, 0, 0]} barSize={36}>
                        {branchChartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={getRateColor(getRateTier(entry.complianceRate))}
                            fillOpacity={0.9}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Branches Health Table & WhatsApp Reminders */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Semáforo de Sucursales y Acciones
                </CardTitle>
                <CardDescription>Monitoreo de inspecciones, desvíos y recordatorios automáticos</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="pl-6">Establecimiento</TableHead>
                      <TableHead>Gerente Responsable</TableHead>
                      <TableHead className="w-[180px]">Cumplimiento</TableHead>
                      <TableHead>Bitácoras (OK / Totales)</TableHead>
                      <TableHead>Desviaciones Activas</TableHead>
                      <TableHead className="pr-6 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validCorporateBranches.map((branch) => (
                      <TableRow key={branch.branchId} className="hover:bg-muted/20 transition-colors">
                        <TableCell className="font-semibold pl-6 flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: getRateColor(getRateTier(branch.complianceRate)) }}
                          />
                          {branch.branchName}
                          {!branch.active && (
                            <Badge variant="outline" className="text-xs py-0 px-1 text-muted-foreground">
                              Inactiva
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm font-medium">
                          {branch.managerName}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-bold min-w-[36px] ${getRateTextClass(
                                getRateTier(branch.complianceRate)
                              )}`}
                            >
                              {branch.complianceRate}%
                            </span>
                            <Progress
                              value={branch.complianceRate}
                              className="h-1.5 w-20"
                              style={
                                {
                                  "--progress-background": getRateColor(getRateTier(branch.complianceRate)),
                                } as React.CSSProperties
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {branch.completedInspections} / {branch.totalInspections}
                        </TableCell>
                        <TableCell>
                          {branch.incidents.open > 0 ? (
                            <Badge
                              variant="outline"
                              className="font-medium flex items-center gap-1 w-fit border-warning/30 bg-warning/10 text-warning-text"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {branch.incidents.open} activas
                              {branch.incidents.critical > 0 && (
                                <span className="text-xs text-destructive font-bold ml-1">
                                  ({branch.incidents.critical} Críticas)
                                </span>
                              )}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="font-medium border-success/30 bg-success/10 text-success flex items-center gap-1 w-fit"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Sin pendientes
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          {branch.complianceRate >= 95 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    className="h-8 text-xs font-semibold opacity-60"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 mr-1 text-success" />
                                    Recordatorio WA
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Cumplimiento óptimo (≥95%) — no requiere recordatorio</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={sendingReminder === branch.branchId}
                              onClick={() => sendWhatsAppReminder(branch)}
                              className="h-8 text-xs font-semibold hover:bg-success/10 hover:text-success hover:border-success/30"
                            >
                              {sendingReminder === branch.branchId ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <MessageSquare className="h-3.5 w-3.5 mr-1 text-success" />
                              )}
                              Recordatorio WA
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Historical Trends Area Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Tendencias Históricas de Cumplimiento
            </CardTitle>
            <CardDescription>Evolución diaria de cumplimiento durante el período seleccionado</CardDescription>
          </CardHeader>
          <CardContent>
            {data.trends.length > 0 ? (
              <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
                <AreaChart data={data.trends}>
                  <defs>
                    <linearGradient id="fillCompliance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-complianceRate)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-complianceRate)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} opacity={0.2} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString("es-MX", {
                        month: "short",
                        day: "numeric",
                      });
                    }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => {
                          return new Date(value).toLocaleDateString("es-MX", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          });
                        }}
                      />
                    }
                  />
                  <Area
                    dataKey="complianceRate"
                    type="monotone"
                    fill="url(#fillCompliance)"
                    stroke="var(--color-complianceRate)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
                No hay registros de tendencias históricas para este período
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
