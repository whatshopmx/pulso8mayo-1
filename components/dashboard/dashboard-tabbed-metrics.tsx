"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  ClipboardList, 
  ShieldCheck, 
  Users, 
  AlertCircle, 
  AlertTriangle, 
  Clock, 
  PackageOpen, 
  CalendarClock,
  CheckCircle2
} from "lucide-react";
import { MetricCard, MetricGrid, MetricCardSkeleton } from "@/components/ui/metric-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ComplianceData {
  complianceRate: number;
  complianceSentiment: string;
  totalInspections: number;
  openIncidents: number;
  openIncidentsSentiment: string;
  activeStaff?: number;
  activeStaffSentiment?: string;
}

interface KpiSummary {
  id: string;
  name: string;
  currentValue: number;
  previousValue: number;
  status: string;
  unit: string;
  target: number | null;
  category: string;
  description?: string;
}

interface ExecutiveData {
  alertSummary: {
    criticalIncidents: number;
    overdueWorkflows: number;
    lowStockItems: number;
    expiringBatches: number;
  };
}

interface DashboardTabbedMetricsProps {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

const categoryLabels: Record<string, string> = {
  OPERATIONS: 'Operaciones',
  COMPLIANCE: 'Cumplimiento',
  LABOR: 'RH',
  INVENTORY: 'Inventario',
};

const statusTones = {
  NORMAL: 'success' as const,
  WARNING: 'warning' as const,
  CRITICAL: 'destructive' as const,
};

export function DashboardTabbedMetrics({ branchId, startDate, endDate }: DashboardTabbedMetricsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [kpis, setKpis] = useState<KpiSummary[]>([]);
  const [executive, setExecutive] = useState<ExecutiveData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const complianceParams = new URLSearchParams();
        if (branchId && branchId !== 'all') complianceParams.set('branch', branchId);
        if (startDate) complianceParams.set('startDate', startDate);
        if (endDate) complianceParams.set('endDate', endDate);

        const kpiParams = new URLSearchParams({ period: '7d' });
        if (branchId && branchId !== 'all') kpiParams.set('branchId', branchId);
        if (startDate) kpiParams.set('startDate', startDate);
        if (endDate) kpiParams.set('endDate', endDate);

        const execParams = new URLSearchParams();
        if (branchId && branchId !== 'all') execParams.set('branchId', branchId);
        if (startDate) execParams.set('startDate', startDate);
        if (endDate) execParams.set('endDate', endDate);

        const [complianceRes, kpiRes, execRes] = await Promise.all([
          fetch(`/api/analytics/compliance?${complianceParams.toString()}`),
          fetch(`/api/kpi/dashboard?${kpiParams.toString()}`),
          fetch(`/api/analytics/executive-summary?${execParams.toString()}`)
        ]);

        let complianceData = null;
        if (complianceRes.ok) {
          complianceData = await complianceRes.json();
        }

        let kpiData = [];
        if (kpiRes.ok) {
          const res = await kpiRes.json();
          kpiData = res.kpis || [];
        }

        let execData = null;
        if (execRes.ok) {
          execData = await execRes.json();
        }

        setCompliance(complianceData);
        setKpis(kpiData);
        setExecutive(execData);
      } catch (error) {
        console.error("Error fetching dashboard tabbed metrics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [branchId, startDate, endDate]);

  // Global Keyboard listener for cycling tabs (AD-4 / Task 5 / Task 6)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle '/' key to focus search input even if activeElement is not input (but check we aren't typing)
      if (e.key === "/") {
        if (
          document.activeElement?.tagName === "INPUT" || 
          document.activeElement?.tagName === "TEXTAREA" || 
          (document.activeElement as HTMLElement)?.isContentEditable
        ) {
          return;
        }
        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
        return;
      }

      // Handle 'Escape' to reset filters/selectors
      if (e.key === "Escape") {
        document.cookie = "pulso_selected_branch=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
        router.push('/dashboard');
        return;
      }

      // Don't intercept typing in inputs or textareas for arrow keys
      if (
        document.activeElement?.tagName === "INPUT" || 
        document.activeElement?.tagName === "TEXTAREA" || 
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // Tab key or custom arrow key triggers to cycle tabs (prevent default standard Tab if we want specific tab behavior, or Alt+Tab)
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const tabs = ["overview", "compliance", "inventory", "labor"];
        const currentIndex = tabs.indexOf(activeTab);
        let nextIndex = currentIndex;

        if (e.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % tabs.length;
        } else if (e.key === "ArrowLeft") {
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        }

        setActiveTab(tabs[nextIndex]);
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, router]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-80 bg-muted animate-pulse rounded-lg" />
        <MetricCardSkeleton count={4} />
      </div>
    );
  }

  // Fallback defaults
  const totalInspections = compliance?.totalInspections ?? 0;
  const complianceRate = compliance?.complianceRate ?? 0;
  const complianceSentiment = compliance?.complianceSentiment ?? "Sin datos";
  const openIncidents = compliance?.openIncidents ?? 0;
  const openIncidentsSentiment = compliance?.openIncidentsSentiment ?? "Sin datos";
  const activeStaff = compliance?.activeStaff ?? 0;
  const activeStaffSentiment = compliance?.activeStaffSentiment ?? "Sin datos";

  const criticalIncidents = executive?.alertSummary?.criticalIncidents ?? 0;
  const overdueWorkflows = executive?.alertSummary?.overdueWorkflows ?? 0;
  const lowStockItems = executive?.alertSummary?.lowStockItems ?? 0;
  const expiringBatches = executive?.alertSummary?.expiringBatches ?? 0;

  // Filter KPI cards by category
  const complianceKpi = kpis.find(k => k.category === 'COMPLIANCE');
  const inventoryKpi = kpis.find(k => k.category === 'INVENTORY');
  const laborKpi = kpis.find(k => k.category === 'LABOR');
  const operationsKpi = kpis.find(k => k.category === 'OPERATIONS');

  const getKpiTrend = (kpi: KpiSummary) => {
    if (kpi.previousValue === 0) return 0;
    return ((kpi.currentValue - kpi.previousValue) / kpi.previousValue) * 100;
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-4 bg-muted p-1 rounded-xl">
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="compliance">Cumplimiento</TabsTrigger>
          <TabsTrigger value="inventory">Inventario</TabsTrigger>
          <TabsTrigger value="labor">Personal</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "overview" && (
        <MetricGrid columns={4}>
          <MetricCard
            label="Flujos Ejecutados"
            value={totalInspections}
            icon={<ClipboardList className="h-4 w-4" />}
            subtitle="Total en período"
            delta={{ value: 12, isPositive: true }}
            helpText="Cantidad total de listas de verificación y auditorías de inocuidad/operaciones ejecutadas en el período seleccionado."
          />

          <MetricCard
            label="Cumplimiento NOM-251"
            value={`${complianceRate}%`}
            icon={<ShieldCheck className="h-4 w-4" />}
            subtitle={
              <span className="inline-flex items-center gap-1 font-medium">
                <CheckCircle2 className="h-3 w-3 text-success" />
                <span>Estado: {complianceSentiment}</span>
              </span>
            }
            delta={{ value: 3.2, isPositive: true }}
            tone={complianceRate > 90 ? "success" : complianceRate > 75 ? "warning" : "destructive"}
            helpText="Score promedio de auditorías sanitarias y de higiene calculado con base en los requisitos normativos de la NOM-251-SSA1-2009."
          />

          <MetricCard
            label="Stock Bajo"
            value={lowStockItems}
            icon={<PackageOpen className="h-4 w-4" />}
            tone={lowStockItems > 0 ? "warning" : "neutral"}
            subtitle="Productos bajo mínimo"
            helpText="Cantidad de insumos o productos en inventario cuyos niveles de stock se encuentran por debajo del punto de reorden configurado."
          />

          <MetricCard
            label="Incidentes Abiertos"
            value={openIncidents}
            icon={<AlertCircle className="h-4 w-4" />}
            subtitle={
              <span className="inline-flex items-center gap-1 font-medium">
                <AlertCircle className={`h-3 w-3 ${openIncidents > 0 ? 'text-warning-text' : 'text-success'}`} />
                <span>Riesgo: {openIncidentsSentiment}</span>
              </span>
            }
            delta={{ value: 0, isPositive: true }}
            tone={openIncidents > 0 ? "destructive" : "neutral"}
            helpText="Incidentes operativos y sanitarios reportados que se encuentran actualmente abiertos y requieren resolución o remediación activa."
          />
        </MetricGrid>
      )}

      {activeTab === "compliance" && (
        <MetricGrid columns={4}>
          <MetricCard
            label="Cumplimiento NOM-251"
            value={`${complianceRate}%`}
            icon={<ShieldCheck className="h-4 w-4" />}
            subtitle={`Estado: ${complianceSentiment}`}
            tone={complianceRate > 90 ? "success" : complianceRate > 75 ? "warning" : "destructive"}
            helpText="Score promedio de auditorías sanitarias y de higiene calculado con base en los requisitos normativos de la NOM-251-SSA1-2009."
          />

          <MetricCard
            label="Incidentes Abiertos"
            value={openIncidents}
            icon={<AlertCircle className="h-4 w-4" />}
            subtitle={`Riesgo: ${openIncidentsSentiment}`}
            tone={openIncidents > 0 ? "destructive" : "neutral"}
            helpText="Incidentes operativos y sanitarios reportados que se encuentran actualmente abiertos y requieren resolución."
          />

          <MetricCard
            label="Incidentes Críticos"
            value={criticalIncidents}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={criticalIncidents > 0 ? "destructive" : "neutral"}
            subtitle="Gravedad alta acumulada"
            helpText="Alertas críticas e incidentes de alta prioridad (como fallas severas de inocuidad o protección civil) activos en las sucursales."
          />

          <MetricCard
            label="Flujos Vencidos"
            value={overdueWorkflows}
            icon={<Clock className="h-4 w-4" />}
            tone={overdueWorkflows > 0 ? "warning" : "neutral"}
            subtitle="Tareas fuera de plazo"
            helpText="Flujos de trabajo programados (checklists, bitácoras de temperatura) cuya hora límite de ejecución ha pasado y siguen pendientes."
          />

          {complianceKpi && (
            <MetricCard
              label={categoryLabels[complianceKpi.category]}
              value={`${complianceKpi.currentValue.toFixed(1)}${complianceKpi.unit}`}
              icon={<ShieldCheck className="h-4 w-4" />}
              tone={statusTones[complianceKpi.status as keyof typeof statusTones] ?? 'success'}
              subtitle={complianceKpi.name}
              delta={{
                value: Number(getKpiTrend(complianceKpi).toFixed(1)),
                isPositive: getKpiTrend(complianceKpi) >= 0,
              }}
              helpText={complianceKpi.description || "Indicador clave de rendimiento del área de cumplimiento legal e inocuidad alimentaria."}
            />
          )}
        </MetricGrid>
      )}

      {activeTab === "inventory" && (
        <MetricGrid columns={3}>
          <MetricCard
            label="Stock Bajo"
            value={lowStockItems}
            icon={<PackageOpen className="h-4 w-4" />}
            tone={lowStockItems > 0 ? "warning" : "neutral"}
            subtitle="Productos bajo mínimo"
            helpText="Cantidad de insumos o productos en inventario cuyos niveles de stock se encuentran por debajo del punto de reorden configurado."
          />

          <MetricCard
            label="Lotes por Vencer"
            value={expiringBatches}
            icon={<CalendarClock className="h-4 w-4" />}
            tone={expiringBatches > 0 ? "primary" : "neutral"}
            subtitle="Vencimiento en 7 días"
            helpText="Lotes de insumos perecederos cuya fecha de caducidad está programada dentro de los próximos 7 días naturales."
          />

          {inventoryKpi && (
            <MetricCard
              label={categoryLabels[inventoryKpi.category]}
              value={`${inventoryKpi.currentValue.toFixed(1)}${inventoryKpi.unit}`}
              icon={<PackageOpen className="h-4 w-4" />}
              tone={statusTones[inventoryKpi.status as keyof typeof statusTones] ?? 'success'}
              subtitle={inventoryKpi.name}
              delta={{
                value: Number(getKpiTrend(inventoryKpi).toFixed(1)),
                isPositive: getKpiTrend(inventoryKpi) >= 0,
              }}
              helpText={inventoryKpi.description || "Precisión porcentual del inventario de insumos (conteo real vs. teórico del sistema)."}
            />
          )}
        </MetricGrid>
      )}

      {activeTab === "labor" && (
        <MetricGrid columns={3}>
          <MetricCard
            label="Personal / Turnos"
            value={activeStaff}
            icon={<Users className="h-4 w-4" />}
            subtitle={
              <span className="inline-flex items-center gap-1 font-medium">
                <Users className="h-3 w-3 text-info" />
                <span>Operación: {activeStaffSentiment}</span>
              </span>
            }
            delta={{ value: 5, isPositive: true }}
            helpText="Cantidad de personal activo en el turno de trabajo actual y su nivel de asistencia/cobertura operativa."
          />

          {laborKpi && (
            <MetricCard
              label={categoryLabels[laborKpi.category]}
              value={`${laborKpi.currentValue.toFixed(1)}${laborKpi.unit}`}
              icon={<Users className="h-4 w-4" />}
              tone={statusTones[laborKpi.status as keyof typeof statusTones] ?? 'success'}
              subtitle={laborKpi.name}
              delta={{
                value: Number(getKpiTrend(laborKpi).toFixed(1)),
                isPositive: getKpiTrend(laborKpi) >= 0,
              }}
              helpText="Costo total de nómina expresado como porcentaje con respecto a los ingresos brutos del período seleccionado (labor cost %)."
            />
          )}

          {operationsKpi && (
            <MetricCard
              label={categoryLabels[operationsKpi.category]}
              value={`${operationsKpi.currentValue.toFixed(1)}${operationsKpi.unit}`}
              icon={<ClipboardList className="h-4 w-4" />}
              tone={statusTones[operationsKpi.status as keyof typeof statusTones] ?? 'success'}
              subtitle={operationsKpi.name}
              delta={{
                value: Number(getKpiTrend(operationsKpi).toFixed(1)),
                isPositive: getKpiTrend(operationsKpi) >= 0,
              }}
              helpText="Porcentaje de listas de verificación y auditorías obligatorias que se completaron puntualmente según lo programado."
            />
          )}
        </MetricGrid>
      )}
    </div>
  );
}
