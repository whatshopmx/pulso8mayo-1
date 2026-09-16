"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Package, 
  CheckCircle, 
  AlertTriangle,
  Clock,
  Thermometer,
  Store,
  Calendar,
  RefreshCw,
  Plus,
  ArrowRight
} from "lucide-react";
import { 
  allRestaurantKPIs, 
  operationsKPIs, 
  complianceKPIs, 
  laborKPIs, 
  inventoryKPIs,
  type KpiTemplate 
} from "@/lib/analytics/restaurant-kpis";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";

interface RestaurantKpiDashboardProps {
  userRole?: string;
  empresaId?: string;
}

// Mock data generator for demo purposes
const generateMockValue = (kpi: KpiTemplate): number => {
  const randomFactor = 0.9 + Math.random() * 0.2; // 0.9 - 1.1
  
  switch (kpi.metricType) {
    case "PERCENTAGE":
      return Math.min(100, Math.max(0, kpi.target * randomFactor));
    case "COUNT":
      return Math.round(kpi.target * randomFactor);
    case "TIME":
      return kpi.target * randomFactor;
    case "SUM":
      return kpi.target * randomFactor;
    case "RATIO":
      return kpi.target * randomFactor;
    case "AVERAGE":
      return kpi.target * randomFactor;
    default:
      return kpi.target * randomFactor;
  }
};

const getStatusColor = (kpi: KpiTemplate, currentValue: number): string => {
  if (kpi.thresholdType === "MIN") {
    if (currentValue < kpi.criticalThreshold) return "bg-red-500";
    if (currentValue < kpi.warningThreshold) return "bg-yellow-500";
    return "bg-green-500";
  } else if (kpi.thresholdType === "MAX") {
    if (currentValue > kpi.criticalThreshold) return "bg-red-500";
    if (currentValue > kpi.warningThreshold) return "bg-yellow-500";
    return "bg-green-500";
  } else {
    const diff = Math.abs(currentValue - kpi.target);
    const threshold = Math.abs(kpi.target - kpi.warningThreshold);
    if (diff > Math.abs(kpi.target - kpi.criticalThreshold)) return "bg-red-500";
    if (diff > threshold) return "bg-yellow-500";
    return "bg-green-500";
  }
};

const getStatusText = (kpi: KpiTemplate, currentValue: number): string => {
  if (kpi.thresholdType === "MIN") {
    if (currentValue < kpi.criticalThreshold) return "Crítico";
    if (currentValue < kpi.warningThreshold) return "Advertencia";
    return "Normal";
  } else if (kpi.thresholdType === "MAX") {
    if (currentValue > kpi.criticalThreshold) return "Crítico";
    if (currentValue > kpi.warningThreshold) return "Advertencia";
    return "Normal";
  } else {
    const diff = Math.abs(currentValue - kpi.target);
    if (diff > Math.abs(kpi.target - kpi.criticalThreshold)) return "Crítico";
    if (diff > Math.abs(kpi.target - kpi.warningThreshold)) return "Advertencia";
    return "Normal";
  }
};

const formatValue = (kpi: KpiTemplate, value: number): string => {
  const decimals = kpi.decimalPlaces;
  const formatted = value.toFixed(decimals);
  
  switch (kpi.metricType) {
    case "PERCENTAGE":
      return `${formatted}%`;
    case "TIME":
      return `${formatted} ${kpi.unit || "min"}`;
    case "RATIO":
      return `${formatted}x`;
    default:
      return `${formatted} ${kpi.unit || ""}`;
  }
};

export function RestaurantKpiDashboard({ userRole = "GERENTE" }: RestaurantKpiDashboardProps) {
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const [lastUpdated, setLastUpdated] = React.useState<Date>(new Date());

  // Filter KPIs based on role
  const roleKpis = allRestaurantKPIs.filter(kpi => 
    kpi.applicableRoles.includes(userRole)
  );

  // Group by category
  const categoryKpis = {
    operations: roleKpis.filter(k => k.category === "OPERATIONS"),
    compliance: roleKpis.filter(k => k.category === "COMPLIANCE"),
    labor: roleKpis.filter(k => k.category === "LABOR"),
    inventory: roleKpis.filter(k => k.category === "INVENTORY"),
  };

  // Get critical KPIs (first 4)
  const criticalKpis = roleKpis
    .filter(k => k.target >= 90 || k.id.includes("critical") || k.id.includes("temperature"))
    .slice(0, 4);

  const refreshData = () => {
    setLastUpdated(new Date());
  };

  const KpiSummaryCard = ({ 
    title, 
    count, 
    icon: Icon, 
    color 
  }: { 
    title: string; 
    count: number; 
    icon: any; 
    color: string 
  }) => (
    <Card className="cursor-pointer hover:shadow-md transition-all" onClick={() => setSelectedCategory(title.toLowerCase())}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-2xl font-bold">{count}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            KPIs
          </Badge>
        </div>
      </CardContent>
    </Card>
  );

  const KpiDetailCard = ({ kpi }: { kpi: KpiTemplate }) => {
    const currentValue = generateMockValue(kpi);
    const statusColor = getStatusColor(kpi, currentValue);
    const statusText = getStatusText(kpi, currentValue);
    const progress = kpi.thresholdType === "MAX" 
      ? Math.min(100, (currentValue / kpi.target) * 100)
      : Math.min(100, (currentValue / (kpi.target * 1.2)) * 100);

    return (
      <Card className="group hover:shadow-md transition-all">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm font-semibold truncate" title={kpi.name}>
                {kpi.name}
              </CardTitle>
              <CardDescription className="text-xs line-clamp-2 mt-1">
                {kpi.description}
              </CardDescription>
            </div>
            <Badge 
              className={`${statusColor} text-white text-[10px] ml-2 shrink-0`}
            >
              {statusText}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold">{formatValue(kpi, currentValue)}</span>
            <span className="text-sm text-muted-foreground">
              / {formatValue(kpi, kpi.target)}
            </span>
          </div>
          
          <Progress value={progress} className="h-2" />
          
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>Meta: {formatValue(kpi, kpi.target)}</span>
            <span>{kpi.frequency}</span>
          </div>

          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            <div className="flex-1 text-xs">
              <span className="text-muted-foreground">Benchmark: </span>
              <span className="font-medium">{kpi.benchmark.industry}%</span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
              Ver detalle
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "operations": return TrendingUp;
      case "compliance": return CheckCircle;
      case "labor": return Users;
      case "inventory": return Package;
      default: return TrendingUp;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "operations": return "bg-blue-500/10 text-blue-600";
      case "compliance": return "bg-green-500/10 text-green-600";
      case "labor": return "bg-purple-500/10 text-purple-600";
      case "inventory": return "bg-orange-500/10 text-orange-600";
      default: return "bg-gray-500/10 text-gray-600";
    }
  };

  const getDisplayKpis = () => {
    if (selectedCategory === "all") return roleKpis.slice(0, 12);
    return roleKpis.filter(k => k.category.toLowerCase() === selectedCategory);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold">Dashboard de KPIs</h2>
            <Badge variant="outline" className="text-xs">
              <Store className="h-3 w-3 mr-1" />
              Restaurante
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Métricas clave para grupo de {roleKpis.length} KPIs configurados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            <Clock className="h-3 w-3 inline mr-1" />
            {lastUpdated.toLocaleTimeString("es-MX")}
          </span>
          <Button variant="outline" size="sm" onClick={refreshData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/branches">
              <Plus className="h-4 w-4 mr-2" />
              Ver Sucursales
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiSummaryCard 
          title="Operaciones" 
          count={categoryKpis.operations.length} 
          icon={TrendingUp}
          color="bg-blue-500/10 text-blue-600"
        />
        <KpiSummaryCard 
          title="Cumplimiento" 
          count={categoryKpis.compliance.length} 
          icon={CheckCircle}
          color="bg-green-500/10 text-green-600"
        />
        <KpiSummaryCard 
          title="Personal" 
          count={categoryKpis.labor.length} 
          icon={Users}
          color="bg-purple-500/10 text-purple-600"
        />
        <KpiSummaryCard 
          title="Inventario" 
          count={categoryKpis.inventory.length} 
          icon={Package}
          color="bg-orange-500/10 text-orange-600"
        />
      </div>

      {/* Critical KPIs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-semibold">KPIs Críticos</h3>
          <Badge variant="secondary" className="text-xs">{criticalKpis.length}</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {criticalKpis.map((kpi) => (
            <KpiDetailCard key={kpi.id} kpi={kpi} />
          ))}
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        <Badge 
          variant={selectedCategory === "all" ? "default" : "outline"}
          className="cursor-pointer px-3 py-1.5"
          onClick={() => setSelectedCategory("all")}
        >
          Todos ({roleKpis.length})
        </Badge>
        {["operations", "compliance", "labor", "inventory"].map((cat) => {
          const Icon = getCategoryIcon(cat);
          const count = categoryKpis[cat as keyof typeof categoryKpis].length;
          return (
            <Badge 
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5 flex items-center gap-1"
              onClick={() => setSelectedCategory(cat)}
            >
              <Icon className="h-3 w-3" />
              {cat.charAt(0).toUpperCase() + cat.slice(1)} ({count})
            </Badge>
          );
        })}
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {getDisplayKpis().map((kpi) => (
          <KpiDetailCard key={kpi.id} kpi={kpi} />
        ))}
      </div>

      {/* Benchmark Info */}
      <Card className="bg-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Benchmarks de la Industria</CardTitle>
          <CardDescription className="text-xs">
            Comparativa con estándares del sector HORECA
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Completitud de Tareas</div>
              <div className="font-semibold">85% (industria)</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Cumplimiento NOM-251</div>
              <div className="font-semibold">95% (industria)</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Asistencia Personal</div>
              <div className="font-semibold">92% (industria)</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Precisión Inventario</div>
              <div className="font-semibold">95% (industria)</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
