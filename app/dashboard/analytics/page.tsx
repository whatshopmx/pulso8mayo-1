"use client";

import * as React from "react";
import { RestaurantKpiDashboard } from "@/components/analytics/restaurant-kpi-dashboard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { Plus, Download, Filter, RefreshCw, Store, TrendingUp, ArrowLeft, History, BarChart3 } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { KpiCard } from "@/components/analytics/kpi-card";
import { KpiChart } from "@/components/analytics/kpi-chart";
import { KpiAlerts } from "@/components/analytics/kpi-alerts";
import { KpiTemplates } from "@/components/analytics/kpi-templates";
import { allRestaurantKPIs } from "@/lib/analytics/restaurant-kpis";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface KpiData {
    id: string;
    name: string;
    description?: string;
    metricType: string;
    category: string;
    unit?: string;
    decimalPlaces?: number;
    target?: number;
    warningThreshold?: number;
    criticalThreshold?: number;
    thresholdType?: string;
    currentValue: number;
    previousValue?: number;
    status: "NORMAL" | "WARNING" | "CRITICAL";
    history: Array<{ date: string; value: number }>;
}

export default function AnalyticsDashboard() {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = React.useState(true);
    const [kpis, setKpis] = React.useState<KpiData[]>([]);
    const [selectedPeriod, setSelectedPeriod] = React.useState("7d");
    const [selectedCategory, setSelectedCategory] = React.useState("all");
    const [selectedBranch, setSelectedBranch] = React.useState("all");
    const [alerts, setAlerts] = React.useState<any[]>([]);
    const [branches, setBranches] = React.useState<any[]>([]);
    const [lastRefresh, setLastRefresh] = React.useState<Date>(new Date());
    const [isAutoRefreshing, setIsAutoRefreshing] = React.useState(true);
    const [userActive, setUserActive] = React.useState(false);
    const [drillDownKpi, setDrillDownKpi] = React.useState<KpiData | null>(null);
    const fetchKpis = React.useCallback(async () => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/kpi/dashboard?period=${selectedPeriod}&branchId=${selectedBranch}`);
            if (response.ok) {
                const data = await response.json();
                setKpis(data.kpis || []);

                // Fetch alerts
                const alertsResponse = await fetch(`/api/kpi/alerts?branchId=${selectedBranch}`);
                if (alertsResponse.ok) {
                    const alertsData = await alertsResponse.json();
                    setAlerts(alertsData.alerts || []);
                }
                
                setLastRefresh(new Date());
            }
        } catch (error) {
            toast({
                title: "Error",
                description: "No se pudieron obtener los datos de KPI",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [selectedPeriod, selectedBranch, toast]);

    React.useEffect(() => {
        fetchKpis();
        async function fetchBranches() {
            try {
                const res = await fetch("/api/branches");
                if (res.ok) {
                    const data = await res.json();
                    setBranches(data.branches || []);
                }
            } catch (error) {
                console.error("Failed to fetch branches", error);
            }
        }
        fetchBranches();
    }, [fetchKpis]);

    // Auto-refresh every 5 minutes
    React.useEffect(() => {
        if (!isAutoRefreshing || userActive) return;

        const interval = setInterval(() => {
            fetchKpis();
        }, 5 * 60 * 1000); // 5 minutes

        return () => clearInterval(interval);
    }, [isAutoRefreshing, userActive, fetchKpis]);

    // Track user activity (pause refresh when active)
    React.useEffect(() => {
        let timeout: NodeJS.Timeout;

        const handleActivity = () => {
            setUserActive(true);
            clearTimeout(timeout);
            timeout = setTimeout(() => setUserActive(false), 5 * 60 * 1000);
        };

        window.addEventListener('mousemove', handleActivity);
        window.addEventListener('keydown', handleActivity);
        window.addEventListener('scroll', handleActivity);

        return () => {
            window.removeEventListener('mousemove', handleActivity);
            window.removeEventListener('keydown', handleActivity);
            window.removeEventListener('scroll', handleActivity);
            clearTimeout(timeout);
        };
    }, []);

    const filteredKpis = kpis.filter((kpi) => {
        if (selectedCategory !== "all" && kpi.category !== selectedCategory) {
            return false;
        }
        return true;
    });

    const handleExport = async () => {
        try {
            toast({
                title: "Exportación iniciada",
                description: "Tu tablero se está exportando a PDF...",
            });

            const doc = new jsPDF();

            // Header
            doc.setFontSize(20);
            doc.text('Pulso - Analytics Dashboard', 14, 20);

            doc.setFontSize(10);
            doc.text(`Generated: ${new Date().toLocaleString('es-MX')}`, 14, 28);
            doc.text(`Period: ${selectedPeriod} | Category: ${selectedCategory} | Branch: ${selectedBranch}`, 14, 33);

            // KPI Summary Table
            doc.setFontSize(14);
            doc.text('KPI Summary', 14, 45);

            const kpiTable = kpis.map(kpi => [
                kpi.name,
                kpi.currentValue.toFixed(kpi.decimalPlaces || 2),
                kpi.target?.toFixed(2) || 'N/A',
                kpi.status
            ]);

            autoTable(doc, {
                startY: 50,
                head: [['KPI', 'Current Value', 'Target', 'Status']],
                body: kpiTable,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [37, 99, 235] },
                columnStyles: {
                    0: { cellWidth: 60 },
                    1: { cellWidth: 35 },
                    2: { cellWidth: 35 },
                    3: { cellWidth: 25 }
                }
            });

            // Alerts Section
            if (alerts.length > 0) {
                const finalY = (doc as any).lastAutoTable.finalY + 10;
                doc.setFontSize(14);
                doc.text('Active Alerts', 14, finalY);

                const alertTable = alerts.map(alert => [
                    alert.kpiName,
                    alert.alertType,
                    alert.currentValue,
                    alert.threshold
                ]);

                autoTable(doc, {
                    startY: finalY + 5,
                    head: [['KPI', 'Type', 'Current', 'Threshold']],
                    body: alertTable,
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [220, 38, 38] }
                });
            }

            // Summary Stats
            const lastY = alerts.length > 0 
                ? (doc as any).lastAutoTable.finalY + 10 
                : (doc as any).lastAutoTable.finalY + 10;
            
            doc.setFontSize(14);
            doc.text('Summary Statistics', 14, lastY);

            doc.setFontSize(10);
            doc.text(`Total KPIs: ${kpis.length}`, 14, lastY + 10);
            doc.text(`Normal: ${kpis.filter(k => k.status === 'NORMAL').length}`, 14, lastY + 17);
            doc.text(`Warnings: ${kpis.filter(k => k.status === 'WARNING').length}`, 70, lastY + 17);
            doc.text(`Critical: ${kpis.filter(k => k.status === 'CRITICAL').length}`, 120, lastY + 17);

            // Save the PDF
            doc.save(`analytics-dashboard-${Date.now()}.pdf`);

            toast({
                title: "Exportación completada",
                description: "El tablero se exportó correctamente a PDF",
            });
        } catch (error) {
            console.error('PDF Export Error:', error);
            toast({
                title: "Error al exportar",
                description: "No se pudo exportar el tablero a PDF",
                variant: "destructive",
            });
        }
    };

    const handleDrillDown = (kpiId: string) => {
        const kpi = kpis.find((k) => k.id === kpiId);
        if (kpi) {
            setDrillDownKpi(kpi);
        }
    };

    const handleBackToOverview = () => {
        setDrillDownKpi(null);
    };

    const categories = ["all", ...Array.from(new Set(kpis.map((k) => k.category)))];

    return (
        <PageContainer>
            <PageHeader
                title="Tablero de Analíticas"
                description="Monitorea tus indicadores clave de rendimiento en tiempo real"
                icon={TrendingUp}
                actions={
                    <>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <RefreshCw className={`h-4 w-4 ${isAutoRefreshing && !userActive ? 'animate-spin' : ''}`} />
                            <span className="hidden md:inline">
                                {lastRefresh.toLocaleTimeString('es-MX')}
                            </span>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-6 px-2 text-xs"
                                onClick={() => setIsAutoRefreshing(!isAutoRefreshing)}
                            >
                                {isAutoRefreshing ? 'Pausar' : 'Reanudar'}
                            </Button>
                        </div>
                        
                        <Button variant="outline" size="icon" onClick={fetchKpis} disabled={isLoading}>
                            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                        </Button>
                        <Button variant="outline" onClick={handleExport}>
                            <Download className="h-4 w-4 mr-2" />
                            Exportar PDF
                        </Button>
                        <Button asChild>
                            <Link href="/dashboard/analytics/kpi-builder">
                                <Plus className="h-4 w-4 mr-2" />
                                Nuevo KPI
                            </Link>
                        </Button>
                    </>
                }
            />

            {/* Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4" />
                        <CardTitle className="text-base">Filtros</CardTitle>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Período</label>
                            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="24h">Últimas 24 horas</SelectItem>
                                    <SelectItem value="7d">Últimos 7 días</SelectItem>
                                    <SelectItem value="30d">Últimos 30 días</SelectItem>
                                    <SelectItem value="90d">Últimos 90 días</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Categoría</label>
                            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las Categorías</SelectItem>
                                    {categories.filter(c => c !== "all").map((category) => (
                                        <SelectItem key={category} value={category}>
                                            {category}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sucursal</label>
                            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las Sucursales</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

      {/* Alerts */}
      {alerts.length > 0 && (
        <KpiAlerts alerts={alerts} onAcknowledge={() => fetchKpis()} />
      )}

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
          <CardDescription>Métricas de desempeño general</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">KPIs Totales</div>
              <div className="text-2xl font-bold">{kpis.length}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Normal</div>
              <div className="text-2xl font-bold text-green-600">
                {kpis.filter((k) => k.status === "NORMAL").length}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Advertencias</div>
              <div className="text-2xl font-bold text-yellow-600">
                {kpis.filter((k) => k.status === "WARNING").length}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">Crítico</div>
              <div className="text-2xl font-bold text-red-600">
                {kpis.filter((k) => k.status === "CRITICAL").length}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drill-Down View */}
      {drillDownKpi && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={handleBackToOverview}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <CardTitle>{drillDownKpi.name}</CardTitle>
                  <CardDescription>
                    {drillDownKpi.description} · {drillDownKpi.category}
                  </CardDescription>
                </div>
              </div>
              <Badge variant={drillDownKpi.status === 'NORMAL' ? 'secondary' : drillDownKpi.status === 'WARNING' ? 'warning' : 'destructive'}>
                {drillDownKpi.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Historial</h4>
                <div className="h-[250px]">
                  <KpiChart
                    title="Tendencia"
                    data={drillDownKpi.history.map((h) => ({
                      date: h.date,
                      value: h.value,
                      target: drillDownKpi.target,
                    }))}
                    chartType="line"
                    metricType={drillDownKpi.metricType}
                    unit={drillDownKpi.unit}
                    showTarget
                  />
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Detalle</h4>
                <div className="space-y-3">
                  <div className="flex justify-between p-3 rounded-lg bg-card border">
                    <span className="text-sm">Valor Actual</span>
                    <span className="text-lg font-bold">{drillDownKpi.currentValue.toFixed(drillDownKpi.decimalPlaces || 2)}{drillDownKpi.unit}</span>
                  </div>
                  <div className="flex justify-between p-3 rounded-lg bg-card border">
                    <span className="text-sm">Valor Anterior</span>
                    <span className="text-lg font-medium">{drillDownKpi.previousValue?.toFixed(drillDownKpi.decimalPlaces || 2) || 'N/A'}{drillDownKpi.unit}</span>
                  </div>
                  <div className="flex justify-between p-3 rounded-lg bg-card border">
                    <span className="text-sm">Meta</span>
                    <span className="text-lg font-medium">{drillDownKpi.target?.toFixed(2) || 'Sin meta'}{drillDownKpi.unit}</span>
                  </div>
                  <div className="flex justify-between p-3 rounded-lg bg-card border">
                    <span className="text-sm">Tipo</span>
                    <span className="text-lg font-medium capitalize">{drillDownKpi.metricType.toLowerCase()}</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-card border">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {drillDownKpi.history.length} registros en el período
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      {!drillDownKpi && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {filteredKpis.map((kpi) => (
            <KpiCard
              key={kpi.id}
              kpi={kpi}
              currentValue={kpi.currentValue}
              previousValue={kpi.previousValue}
              history={kpi.history}
              status={kpi.status}
              onDrillDown={handleDrillDown}
            />
          ))}
        </div>
      )}

            {/* Charts */}
            <Tabs defaultValue="trends" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="trends">Tendencias</TabsTrigger>
                    <TabsTrigger value="comparison">Comparativa</TabsTrigger>
                </TabsList>
                <TabsContent value="trends" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        {filteredKpis.slice(0, 2).map((kpi) => (
                            <KpiChart
                                key={kpi.id}
                                title={kpi.name}
                                data={kpi.history.map((h) => ({
                                    date: h.date,
                                    value: h.value,
                                    target: kpi.target,
                                }))}
                                chartType="line"
                                metricType={kpi.metricType}
                                unit={kpi.unit}
                                showTarget
                            />
                        ))}
                    </div>
                </TabsContent>
                <TabsContent value="comparison" className="space-y-4">
                    <KpiChart
                        title="Comparativa de KPIs por Categoría"
                        data={filteredKpis.map((kpi) => ({
                            date: kpi.category,
                            value: kpi.currentValue,
                            target: kpi.target,
                        }))}
                        chartType="bar"
                        metricType="PERCENTAGE"
                        unit="%"
                        showTarget
                    />
                </TabsContent>
            </Tabs>

    </PageContainer>
    );
}
