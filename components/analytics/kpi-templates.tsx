"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Plus, 
  TrendingUp, 
  Users, 
  Package, 
  CheckCircle, 
  Briefcase,
  Target,
  AlertTriangle,
  Clock,
  Building2
} from "lucide-react";
import { 
  operationsKPIs, 
  complianceKPIs, 
  laborKPIs, 
  inventoryKPIs,
  corporateKPIs,
  allRestaurantKPIs,
  type KpiTemplate 
} from "@/lib/analytics/restaurant-kpis";
import { useToast } from "@/hooks/use-toast";

interface KpiTemplatesProps {
  onSelectTemplate: (template: KpiTemplate) => void;
  userRole?: string;
}

const categoryIcons = {
  OPERATIONS: TrendingUp,
  COMPLIANCE: CheckCircle,
  LABOR: Users,
  INVENTORY: Package,
};

const categoryColors = {
  OPERATIONS: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  COMPLIANCE: "bg-green-500/10 text-green-600 border-green-500/20",
  LABOR: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  INVENTORY: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

const frequencyLabels = {
  REALTIME: "Tiempo real",
  HOURLY: "Cada hora",
  DAILY: "Diario",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
};

const metricTypeLabels = {
  PERCENTAGE: "%",
  COUNT: "Número",
  AVERAGE: "Promedio",
  SUM: "Suma",
  TIME: "Tiempo",
  RATIO: "Ratio",
};

export function KpiTemplates({ onSelectTemplate, userRole = "GERENTE" }: KpiTemplatesProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const { toast } = useToast();

  // Filter KPIs based on user role and search
  const filterKPIs = (kpis: KpiTemplate[]) => {
    return kpis.filter((kpi) => {
      const matchesRole = kpi.applicableRoles.includes(userRole);
      const matchesSearch = 
        kpi.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        kpi.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesRole && matchesSearch;
    });
  };

  const filteredOperations = filterKPIs(operationsKPIs);
  const filteredCompliance = filterKPIs(complianceKPIs);
  const filteredLabor = filterKPIs(laborKPIs);
  const filteredInventory = filterKPIs(inventoryKPIs);
  const filteredCorporate = filterKPIs(corporateKPIs);

  const handleSelect = (template: KpiTemplate) => {
    onSelectTemplate(template);
    toast({
      title: "Plantilla seleccionada",
      description: `${template.name} ha sido cargado en el formulario`,
    });
  };

  const KpiCard = ({ kpi }: { kpi: KpiTemplate }) => {
    const Icon = categoryIcons[kpi.category];
    
    return (
      <Card className="group hover:shadow-md transition-all duration-200 border-l-4 border-l-transparent hover:border-l-primary">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`p-2 rounded-lg ${categoryColors[kpi.category]}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold leading-tight">
                  {kpi.name}
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Meta: {kpi.target}{kpi.unit} | {frequencyLabels[kpi.frequency]}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleSelect(kpi)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
            {kpi.description}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {metricTypeLabels[kpi.metricType]}
            </Badge>
            <Badge 
              variant="outline" 
              className={`text-[10px] px-1.5 py-0 ${
                kpi.thresholdType === "MIN" ? "border-green-500/30 text-green-600" :
                kpi.thresholdType === "MAX" ? "border-red-500/30 text-red-600" :
                "border-blue-500/30 text-blue-600"
              }`}
            >
              {kpi.thresholdType === "MIN" ? "≥" : kpi.thresholdType === "MAX" ? "≤" : "="} {kpi.target}
            </Badge>
            {kpi.warningThreshold && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-500/30 text-yellow-600">
                <AlertTriangle className="h-3 w-3 mr-0.5" />
                {kpi.warningThreshold}
              </Badge>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Target className="h-3 w-3" />
            <span>Industria: {kpi.benchmark.industry}% | Excelente: {kpi.benchmark.excellent}%</span>
          </div>
        </CardContent>
      </Card>
    );
  };

  const KpiGrid = ({ kpis, emptyMessage }: { kpis: KpiTemplate[]; emptyMessage: string }) => (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {kpis.length === 0 ? (
        <div className="col-span-full text-center py-8 text-muted-foreground text-sm">
          {emptyMessage}
        </div>
      ) : (
        kpis.map((kpi) => <KpiCard key={kpi.id} kpi={kpi} />)
      )}
    </div>
  );

  const getCategoryKpis = () => {
    switch (selectedCategory) {
      case "operations": return filteredOperations;
      case "compliance": return filteredCompliance;
      case "labor": return filteredLabor;
      case "inventory": return filteredInventory;
      case "corporate": return filteredCorporate;
      default: return allRestaurantKPIs.filter(kpi => 
        kpi.applicableRoles.includes(userRole) &&
        (kpi.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
         kpi.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar KPIs por nombre o descripción..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge 
            variant={selectedCategory === "all" ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5"
            onClick={() => setSelectedCategory("all")}
          >
            Todos
          </Badge>
          <Badge 
            variant={selectedCategory === "operations" ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5"
            onClick={() => setSelectedCategory("operations")}
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            Operaciones
          </Badge>
          <Badge 
            variant={selectedCategory === "compliance" ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5"
            onClick={() => setSelectedCategory("compliance")}
          >
            <CheckCircle className="h-3 w-3 mr-1" />
            Cumplimiento
          </Badge>
          <Badge 
            variant={selectedCategory === "labor" ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5"
            onClick={() => setSelectedCategory("labor")}
          >
            <Users className="h-3 w-3 mr-1" />
            Personal
          </Badge>
          <Badge 
            variant={selectedCategory === "inventory" ? "default" : "outline"}
            className="cursor-pointer px-3 py-1.5"
            onClick={() => setSelectedCategory("inventory")}
          >
            <Package className="h-3 w-3 mr-1" />
            Inventario
          </Badge>
          {(userRole === "SUPER_ADMIN" || userRole === "ADMIN") && (
            <Badge 
              variant={selectedCategory === "corporate" ? "default" : "outline"}
              className="cursor-pointer px-3 py-1.5"
              onClick={() => setSelectedCategory("corporate")}
            >
              <Building2 className="h-3 w-3 mr-1" />
              Corporativo
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 gap-1 h-auto p-1 sm:w-auto">
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="operations">Operaciones</TabsTrigger>
          <TabsTrigger value="compliance">Cumplimiento</TabsTrigger>
          <TabsTrigger value="labor">Personal</TabsTrigger>
          <TabsTrigger value="inventory">Inventario</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <KpiGrid 
            kpis={getCategoryKpis()} 
            emptyMessage="No se encontraron KPIs para tu rol con los filtros aplicados"
          />
        </TabsContent>

        <TabsContent value="operations" className="mt-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Métricas de Operaciones ({filteredOperations.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              KPIs relacionados con la ejecución de tareas diarias, apertura/cierre, y control de calidad
            </p>
          </div>
          <KpiGrid 
            kpis={filteredOperations} 
            emptyMessage="No hay KPIs de operaciones disponibles para tu rol"
          />
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Métricas de Cumplimiento ({filteredCompliance.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              NOM-251, NOM-035, y cumplimiento laboral. Requisitos regulatorios obligatorios.
            </p>
          </div>
          <KpiGrid 
            kpis={filteredCompliance} 
            emptyMessage="No hay KPIs de cumplimiento disponibles para tu rol"
          />
        </TabsContent>

        <TabsContent value="labor" className="mt-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Métricas de Personal ({filteredLabor.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Asistencia, horas extra, productividad y cumplimiento de pausas activas
            </p>
          </div>
          <KpiGrid 
            kpis={filteredLabor} 
            emptyMessage="No hay KPIs de personal disponibles para tu rol"
          />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Métricas de Inventario ({filteredInventory.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Precisión de inventario, desabastos, productos por vencer y mermas
            </p>
          </div>
          <KpiGrid 
            kpis={filteredInventory} 
            emptyMessage="No hay KPIs de inventario disponibles para tu rol"
          />
        </TabsContent>

        <TabsContent value="corporate" className="mt-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Métricas Corporativas ({filteredCorporate.length})
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Comparación entre sucursales, consistencia y visión consolidada
            </p>
          </div>
          <KpiGrid 
            kpis={filteredCorporate} 
            emptyMessage="No hay KPIs corporativos disponibles para tu rol"
          />
        </TabsContent>
      </Tabs>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t">
        <div className="flex items-center gap-2 text-sm">
          <div className="p-1.5 rounded bg-blue-500/10">
            <TrendingUp className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <div className="font-medium">{operationsKPIs.length}</div>
            <div className="text-xs text-muted-foreground">Operaciones</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="p-1.5 rounded bg-green-500/10">
            <CheckCircle className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <div className="font-medium">{complianceKPIs.length}</div>
            <div className="text-xs text-muted-foreground">Cumplimiento</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="p-1.5 rounded bg-purple-500/10">
            <Users className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <div className="font-medium">{laborKPIs.length}</div>
            <div className="text-xs text-muted-foreground">Personal</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="p-1.5 rounded bg-orange-500/10">
            <Package className="h-4 w-4 text-orange-600" />
          </div>
          <div>
            <div className="font-medium">{inventoryKPIs.length}</div>
            <div className="text-xs text-muted-foreground">Inventario</div>
          </div>
        </div>
      </div>
    </div>
  );
}
