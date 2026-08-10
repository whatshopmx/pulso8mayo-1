"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Loader2,
  MessageSquare,
  Sparkles,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, Cell } from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getRateTier, getRateColor, getRateTextClass } from "@/components/compliance/rate-badge";

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

interface CorporateStatusData {
  period: {
    startDate: string;
    endDate: string;
  };
  branches: BranchStatus[];
}

export function CorporateComplianceGrid() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CorporateStatusData | null>(null);
  const [daysPeriod, setDaysPeriod] = useState(30);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  const fetchCorporateData = async (days: number) => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - days);

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

      const response = await fetch(`/api/compliance/corporate-status?${params}`);
      if (!response.ok) {
        throw new Error("Error al obtener la información corporativa");
      }

      const resJson = await response.json();
      if (resJson.success) {
        setData(resJson.data);
      } else {
        throw new Error(resJson.error || "Error desconocido");
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al cargar los datos del semáforo corporativo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCorporateData(daysPeriod);
  }, [daysPeriod]);

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
          // respuesta sin cuerpo JSON — se usa el mensaje genérico
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

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm font-medium animate-pulse">
          Analizando cumplimiento de todas las sucursales...
        </p>
      </div>
    );
  }

  const branchesList = data?.branches || [];
  const validBranches = branchesList.filter((b) => !b.error);

  // Stats calculations
  const avgCompliance =
    validBranches.length > 0
      ? Math.round(validBranches.reduce((acc, b) => acc + b.complianceRate, 0) / validBranches.length)
      : 0;

  const totalOpenIncidents = validBranches.reduce((acc, b) => acc + b.incidents.open, 0);
  const totalCriticalIncidents = validBranches.reduce((acc, b) => acc + b.incidents.critical, 0);

  const bestBranch =
    validBranches.length > 0
      ? [...validBranches].sort((a, b) => b.complianceRate - a.complianceRate)[0]
      : null;

  const worstBranch =
    validBranches.length > 0
      ? [...validBranches].sort((a, b) => a.complianceRate - b.complianceRate)[0]
      : null;

  // Chart data format
  const chartData = validBranches.map((b) => ({
    name: b.branchName,
    "Cumplimiento %": b.complianceRate,
  }));

  return (
    <TooltipProvider>
    <div className="space-y-6">
      {/* Control bar */}
      <div className="flex items-center justify-between bg-muted/30 p-4 rounded-xl border">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Período de Análisis:</span>
          {data?.period && (
            <span className="text-sm font-semibold text-foreground">
              {format(new Date(data.period.startDate), "dd 'de' MMMM", { locale: es })} al{" "}
              {format(new Date(data.period.endDate), "dd 'de' MMMM, yyyy", { locale: es })}
            </span>
          )}
        </div>
        <div className="flex gap-1 bg-background p-1 rounded-lg border">
          {[7, 30, 90].map((days) => (
            <Button
              key={days}
              variant={daysPeriod === days ? "default" : "ghost"}
              size="sm"
              onClick={() => setDaysPeriod(days)}
              className="text-xs h-7 px-3 font-semibold rounded-md transition-all"
            >
              {days} días
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Cards Grid */}
      <MetricGrid columns={4}>
        {/* Card 1: Corporate Average */}
        <MetricCard
          label="Cumplimiento Corporativo"
          value={`${avgCompliance}%`}
          subtitle={
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-warning-text" />
              promedio · Calificación global NOM-251
            </span>
          }
          progress={{ value: avgCompliance }}
        />

        {/* Card 2: Best Branch */}
        <MetricCard
          label="Mayor Cumplimiento"
          value={bestBranch ? `${bestBranch.complianceRate}%` : "N/A"}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="success"
          subtitle={bestBranch ? bestBranch.branchName : "N/A"}
        >
          <p className="text-xs text-muted-foreground">
            Gerente: {bestBranch ? bestBranch.managerName : "N/A"}
          </p>
        </MetricCard>

        {/* Card 3: Worst Branch */}
        <MetricCard
          label="Menor Cumplimiento"
          value={worstBranch ? `${worstBranch.complianceRate}%` : "N/A"}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="destructive"
          subtitle={worstBranch ? worstBranch.branchName : "N/A"}
        >
          <p className="text-xs text-muted-foreground">Requiere supervisión e intervención</p>
        </MetricCard>

        {/* Card 4: Incidents */}
        <MetricCard
          label="Desviaciones y Alertas"
          value={totalOpenIncidents}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={totalOpenIncidents > 0 ? "destructive" : "neutral"}
          subtitle={`${totalCriticalIncidents} críticas · de ${validBranches.reduce((acc, b) => acc + b.incidents.total, 0)} totales`}
          progress={{
            value: totalOpenIncidents > 0 ? (totalCriticalIncidents / totalOpenIncidents) * 100 : 0,
          }}
        />
      </MetricGrid>

      {/* Comparison Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-md font-bold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Comparación Inter-sucursales
          </CardTitle>
          <CardDescription>Cumplimiento porcentual de la norma por establecimiento</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} tickLine={false} />
                <YAxis domain={[0, 100]} fontSize={11} tickLine={false} axisLine={false} />
                <ChartTooltip
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                  contentStyle={{
                    background: "var(--background)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                  }}
                />
                <Bar dataKey="Cumplimiento %" radius={[4, 4, 0, 0]} barSize={35}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getRateColor(getRateTier(entry["Cumplimiento %"]))}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Branches Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-md font-bold flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Semáforo de Sucursales
          </CardTitle>
          <CardDescription>Detalle individual de inspecciones y desvíos</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="pl-6">Establecimiento</TableHead>
                <TableHead>Gerente Responsable</TableHead>
                <TableHead className="w-[180px]">Cumplimiento NOM-251</TableHead>
                <TableHead>Bitácoras (OK / Totales)</TableHead>
                <TableHead>Desviaciones Activas</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branchesList.map((branch) => (
                <TableRow key={branch.branchId} className="hover:bg-muted/20 transition-colors">
                  <TableCell className="font-bold pl-6 flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full`}
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
                        className={`text-sm font-bold min-w-[36px] ${getRateTextClass(getRateTier(branch.complianceRate))}`}
                      >
                        {branch.complianceRate}%
                      </span>
                      <Progress
                        value={branch.complianceRate}
                        className="h-1.5 w-24"
                        style={
                          {
                            "--progress-background": getRateColor(getRateTier(branch.complianceRate)),
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-semibold">
                    {branch.completedInspections} / {branch.totalInspections}
                  </TableCell>
                  <TableCell>
                    {branch.incidents.open > 0 ? (
                      <Badge
                        variant="outline"
                        className={`font-semibold flex items-center gap-1 w-fit border-yellow-200 bg-yellow-50 text-yellow-700`}
                      >
                        <AlertTriangle className="h-3 w-3 text-yellow-600" />
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
                        className="font-semibold border-green-200 bg-green-50 text-green-700 flex items-center gap-1 w-fit"
                      >
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                        Sin pendientes
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {branch.complianceRate >= 95 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {/* span wrapper: los botones disabled no emiten eventos de puntero */}
                          <span className="inline-flex">
                            <Button variant="outline" size="sm" disabled className="h-8 text-xs font-semibold">
                              <MessageSquare className="h-3.5 w-3.5 mr-1 text-green-600" />
                              Recordatorio WA
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Cumplimiento óptimo — no requiere recordatorio</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sendingReminder === branch.branchId}
                        onClick={() => sendWhatsAppReminder(branch)}
                        className="h-8 text-xs font-semibold hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                      >
                        {sendingReminder === branch.branchId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5 mr-1 text-green-600" />
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
    </TooltipProvider>
  );
}
