"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, AlertTriangle, CheckCircle, Calendar, FileText, Download, Shield, Activity, Building2 } from "lucide-react";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { RateBadge, getRateBadgeVariant, getRateColor, getRateClasses, getRateTextClass, getRateProgressClasses, getRateTier } from "@/components/compliance/rate-badge";
import { toast } from "sonner";
import { ErrorState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";

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
    dueDate?: Date | null;
    complianceType?: string | null;
    isCritical: boolean;
}

interface Alert {
    id: string;
    title: string;
    severity: "CRITICAL" | "HIGH" | "WARNING" | "FATAL";
    status: "DETECTED" | "IN_REMEDIATION" | "RESOLVED" | "ESCALATED";
    branchId?: string | null;
    createdAt: Date;
    workflowName?: string | null;
}

interface BranchBreakdown {
    branchId?: string | null;
    branchName: string;
    complianceRate: number;
    totalWorkflows: number;
    criticalIssues: number;
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
    const { selectedBranchId, selectedBranch } = useBranch();
    const [data, setData] = useState<ComplianceData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState<string>("30");

    const fetchData = async () => {
        setLoading(true);
        setError(false);
        try {
            const params = new URLSearchParams();
            if (selectedBranchId) {
                params.set('branchId', selectedBranchId);
            }
            params.set('days', selectedPeriod);

            const res = await fetch(`/api/analytics/compliance/trends?${params.toString()}`);
            if (!res.ok) {
                throw new Error(`Error ${res.status}: no se pudieron obtener los datos de cumplimiento`);
            }
            const result = await res.json();
            setData(result);
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

    const exportToPDF = async () => {
        if (!data) return;

        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(18);
        doc.text("Reporte de Cumplimiento", 14, 20);
        
        // Period
        doc.setFontSize(10);
        doc.text(`Período: Últimos ${data.period.days} días`, 14, 28);
        doc.text(`Generado: ${new Date().toLocaleDateString("es-MX")}`, 14, 33);

        // Overall Compliance Rate
        const overallRate = data.scorecards.length > 0
            ? Math.round(data.scorecards.reduce((acc, s) => acc + s.complianceRate, 0) / data.scorecards.length)
            : 0;
        
        doc.setFontSize(12);
        doc.text(`Cumplimiento General: ${overallRate}%`, 14, 45);

        // Scorecards Table
        const scorecardData = data.scorecards.map(s => [
            s.category,
            s.complianceType || 'N/A',
            `${s.complianceRate}%`,
            s.totalWorkflows.toString(),
            s.criticalWorkflows.toString()
        ]);

        autoTable(doc, {
            startY: 50,
            head: [['Categoría', 'Tipo', 'Cumplimiento', 'Flujos Totales', 'Críticos']],
            body: scorecardData,
            theme: 'striped',
            headStyles: { fillColor: [133, 22, 28] },
        });

        // Alerts Section
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(14);
        doc.text("Alertas Activas", 14, finalY);
        
        if (data.alerts.length > 0) {
            const alertData = data.alerts.map(a => [
                a.title,
                a.severity,
                a.status,
                a.workflowName || 'N/A',
                new Date(a.createdAt).toLocaleDateString("es-MX")
            ]);

            autoTable(doc, {
                startY: finalY + 5,
                head: [['Alerta', 'Gravedad', 'Estado', 'Flujo de Trabajo', 'Fecha']],
                body: alertData,
                theme: 'striped',
                headStyles: { fillColor: [133, 22, 28] },
            });
        } else {
            doc.setFontSize(10);
            doc.text("Sin alertas activas", 14, finalY + 10);
        }

        // Save the PDF
        doc.save(`reporte-cumplimiento-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    if (loading) {
        return (
            <div className="p-8 flex justify-center items-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

    const overallComplianceRate = data.scorecards.length > 0
        ? Math.round(data.scorecards.reduce((acc, s) => acc + s.complianceRate, 0) / data.scorecards.length)
        : 0;

    const totalAlerts = data.alerts.length;
    const criticalAlerts = data.alerts.filter(a => a.severity === 'CRITICAL').length;

    return (
        <div className="space-y-6">
            {/* Header Controls */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <div className="flex gap-2 items-center">
                    <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                        <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="Período" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7">Últimos 7 días</SelectItem>
                            <SelectItem value="30">Últimos 30 días</SelectItem>
                            <SelectItem value="90">Últimos 90 días</SelectItem>
                        </SelectContent>
                    </Select>

                    <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs font-medium bg-background border">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {selectedBranch ? `Sucursal: ${selectedBranch.name}` : "Todas las sucursales"}
                    </Badge>
                </div>

                <Button onClick={exportToPDF} variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                        Exportar PDF
                </Button>
            </div>

            {/* Summary Cards */}
            <MetricGrid columns={4}>
                <MetricCard
                    label="Cumplimiento General"
                    value={`${overallComplianceRate}%`}
                    icon={<Shield className="h-4 w-4" />}
                    subtitle="Promedio general de cumplimiento"
                />
                <MetricCard
                    label="Total de Flujos"
                    value={data.scorecards.reduce((acc, s) => acc + s.totalWorkflows, 0)}
                    icon={<FileText className="h-4 w-4" />}
                    subtitle="Completados en el período"
                />
                <MetricCard
                    label="Alertas Activas"
                    value={totalAlerts}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone={totalAlerts > 0 ? "warning" : "neutral"}
                    subtitle={`${criticalAlerts} críticas`}
                />
                <MetricCard
                    label="Próximos Vencimientos"
                    value={data.deadlines.length}
                    icon={<Calendar className="h-4 w-4" />}
                    subtitle="Próximos 30 días"
                />
            </MetricGrid>

            {/* Main Dashboard Tabs */}
            <Tabs defaultValue="scorecards" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="scorecards">Evaluaciones</TabsTrigger>
                    <TabsTrigger value="trends">Tendencias</TabsTrigger>
                    <TabsTrigger value="deadlines">Vencimientos</TabsTrigger>
                    <TabsTrigger value="alerts">Alertas</TabsTrigger>
                    <TabsTrigger value="branches">Por Sucursal</TabsTrigger>
                </TabsList>

                {/* Scorecards Tab */}
                <TabsContent value="scorecards" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {data.scorecards.map((scorecard, index) => (
                            <Card key={index}>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-base">{scorecard.category}</CardTitle>
                                            <CardDescription>
                                                {scorecard.complianceType || 'General'}
                                            </CardDescription>
                                        </div>
                                        <RateBadge rate={scorecard.complianceRate} />
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Flujos Totales</span>
                                            <span className="font-medium">{scorecard.totalWorkflows}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Flujos Críticos</span>
                                            <span className={`font-medium ${scorecard.criticalWorkflows > 0 ? 'text-destructive' : ''}`}>
                                                {scorecard.criticalWorkflows}
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                {/* Historical Trends Tab */}
                <TabsContent value="trends">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Tendencias de Cumplimiento
                            </CardTitle>
                            <CardDescription>
                                Cumplimiento diario durante el período seleccionado
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data.trends.length > 0 ? (
                                <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
                                    <AreaChart data={data.trends}>
                                        <defs>
                                            <linearGradient id="fillCompliance" x1="0" y1="0" x2="0" y2="1">
                                                <stop
                                                    offset="5%"
                                                    stopColor="var(--color-complianceRate)"
                                                    stopOpacity={1.0}
                                                />
                                                <stop
                                                    offset="95%"
                                                    stopColor="var(--color-complianceRate)"
                                                    stopOpacity={0.1}
                                                />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid vertical={false} />
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
                                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                                    No hay datos de tendencia para este período
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Deadlines Tab */}
                <TabsContent value="deadlines">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="h-5 w-5" />
                            Próximos Vencimientos
                            </CardTitle>
                            <CardDescription>
                                Actividades de cumplimiento programadas para los próximos 30 días
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data.deadlines.length > 0 ? (
                                <div className="space-y-4">
                                    {data.deadlines.map((deadline) => (
                                        <div
                                            key={deadline.id}
                                            className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`p-2 rounded-full ${deadline.isCritical ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                                                    <FileText className={`h-5 w-5 ${deadline.isCritical ? 'text-destructive' : 'text-primary'}`} />
                                                </div>
                                                <div>
                                                    <p className="font-medium">{deadline.name}</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {deadline.branchName} • {deadline.complianceType || 'General'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {deadline.isCritical && (
                                                    <Badge variant="destructive" className="text-xs">
                                                        Crítico
                                                    </Badge>
                                                )}
                                                <Badge variant="outline">
                                                    {deadline.dueDate ? new Date(deadline.dueDate).toLocaleDateString("es-MX") : 'Pendiente'}
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>No hay vencimientos próximos</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Alerts Tab */}
                <TabsContent value="alerts">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5" />
                                Alertas de Cumplimiento
                            </CardTitle>
                            <CardDescription>
                                Problemas activos de cumplimiento que requieren atención
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data.alerts.length > 0 ? (
                                <div className="space-y-4">
                                    {data.alerts.map((alert) => (
                                        <div
                                            key={alert.id}
                                            className={`p-4 border rounded-lg ${
                                                alert.severity === 'CRITICAL' 
                                                    ? 'border-destructive/50 bg-destructive/5' 
                                                    : 'border-yellow-500/50 bg-yellow-500/5'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex items-start gap-3">
                                                    <AlertTriangle className={`h-5 w-5 mt-0.5 ${
                                                        alert.severity === 'CRITICAL' ? 'text-destructive' : 'text-yellow-500'
                                                    }`} />
                                                    <div>
                                                        <p className="font-medium">{alert.title}</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            {alert.workflowName && `Workflow: ${alert.workflowName}`}
                                                        </p>
                                                        <div className="flex gap-2 mt-2">
                                                            <Badge 
                                                                variant={alert.severity === 'CRITICAL' ? 'destructive' : 'secondary'}
                                                                className="text-xs"
                                                            >
                                                                {alert.severity}
                                                            </Badge>
                                                            <Badge variant="outline" className="text-xs">
                                                                {alert.status}
                                                            </Badge>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-sm text-muted-foreground">
                                                    {new Date(alert.createdAt).toLocaleDateString("es-MX")}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50 text-green-500" />
                                    <p className="text-lg font-medium">Sin alertas activas</p>
                                    <p className="text-sm">Todos los controles están en orden</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Branch Breakdown Tab */}
                <TabsContent value="branches">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="h-5 w-5" />
                                Cumplimiento por Sucursal
                            </CardTitle>
                            <CardDescription>
                                Vista detallada de cumplimiento por sucursal
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data.branchBreakdown.length > 0 ? (
                                <div className="space-y-4">
                                    {data.branchBreakdown.map((branch) => (
                                        <div
                                            key={branch.branchId}
                                            className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium">{branch.branchName}</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {branch.totalWorkflows} flujos • {branch.criticalIssues} incidencias
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="text-right">
                                                        <p className="text-2xl font-bold">{branch.complianceRate}%</p>
                                                        <p className="text-xs text-muted-foreground">Cumplimiento</p>
                                                    </div>
                                                    <RateBadge rate={branch.complianceRate} />
                                                </div>
                                            </div>
                                            {/* Progress bar */}
                                            <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full transition-all ${getRateProgressClasses(getRateTier(branch.complianceRate))}`}
                                                    style={{ width: `${branch.complianceRate}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p>No hay datos por sucursal</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
