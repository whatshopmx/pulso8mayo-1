"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  const getComplianceColor = (rate: number) => {
    if (rate >= 90) return "oklch(0.60 0.16 150)";
    if (rate >= 70) return "oklch(0.72 0.15 80)";
    return "oklch(0.50 0.22 22)";
  };

  const getComplianceBg = (rate: number) => {
    if (rate >= 90) return "bg-green-500/10 text-green-700 border-green-500/20";
    if (rate >= 70) return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
    return "bg-red-500/10 text-red-700 border-red-500/20";
  };

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
      <div className="grid gap-4 md:grid-cols-4">
        {/* Card 1: Corporate Average */}
        <Card className="border-primary/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold">
              Cumplimiento Corporativo
            </CardDescription>
            <CardTitle className="text-3xl font-bold tracking-tight text-primary flex items-baseline gap-1">
              {avgCompliance}%
              <span className="text-xs text-muted-foreground font-normal">promedio</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={avgCompliance} className="h-2" />
            <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
              <span>Calificación global NOM-251</span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Best Branch */}
        <Card className="border-green-500/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold">
              Mayor Cumplimiento
            </CardDescription>
            <CardTitle className="text-xl font-bold truncate text-green-700 flex items-center gap-1.5">
              <TrendingUp className="h-5 w-5 text-green-600" />
              {bestBranch ? bestBranch.branchName : "N/A"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold">{bestBranch ? `${bestBranch.complianceRate}%` : "N/A"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Gerente: {bestBranch ? bestBranch.managerName : "N/A"}
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Worst Branch */}
        <Card className="border-red-500/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold">
              Menor Cumplimiento
            </CardDescription>
            <CardTitle className="text-xl font-bold truncate text-red-700 flex items-center gap-1.5">
              <TrendingDown className="h-5 w-5 text-red-600" />
              {worstBranch ? worstBranch.branchName : "N/A"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-extrabold text-red-600">
              {worstBranch ? `${worstBranch.complianceRate}%` : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Requiere supervisión e intervención
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Incidents */}
        <Card className="border-yellow-500/10">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold">
              Desviaciones y Alertas
            </CardDescription>
            <CardTitle className="text-3xl font-extrabold text-yellow-600 flex items-baseline gap-1.5">
              {totalOpenIncidents}
              <span className="text-xs text-muted-foreground font-normal">activas</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                {totalCriticalIncidents} críticas
              </span>
              <span>De {validBranches.reduce((acc, b) => acc + b.incidents.total, 0)} totales</span>
            </div>
            <Progress
              value={totalOpenIncidents > 0 ? (totalCriticalIncidents / totalOpenIncidents) * 100 : 0}
              className="h-1.5 mt-2.5 bg-yellow-100"
            />
          </CardContent>
        </Card>
      </div>

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
                    background: "white",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                  }}
                />
                <Bar dataKey="Cumplimiento %" radius={[4, 4, 0, 0]} barSize={35}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getComplianceColor(entry["Cumplimiento %"])}
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
                      style={{ backgroundColor: getComplianceColor(branch.complianceRate) }}
                    />
                    {branch.branchName}
                    {!branch.active && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1 text-muted-foreground">
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
                        className={`text-sm font-bold min-w-[36px] ${
                          branch.complianceRate >= 90
                            ? "text-green-700"
                            : branch.complianceRate >= 70
                            ? "text-yellow-700"
                            : "text-red-600"
                        }`}
                      >
                        {branch.complianceRate}%
                      </span>
                      <Progress
                        value={branch.complianceRate}
                        className="h-1.5 w-24"
                        style={
                          {
                            "--progress-background": getComplianceColor(branch.complianceRate),
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
                          <span className="text-[10px] text-red-600 font-bold ml-1">
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
