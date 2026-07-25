"use client";

import { useState, useEffect } from "react";
import { BranchComparisonChart } from "@/components/analytics/branch-comparison-chart";
import { BranchRankingTable } from "@/components/analytics/branch-ranking-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, TrendingUp, AlertTriangle, Thermometer, Package, Users } from "lucide-react";

interface BranchDetail {
  branchId: string;
  branchName: string;
  workflowMetrics: {
    completionRate: number;
    totalWorkflows: number;
    completedWorkflows: number;
    avgScore: number;
  };
  complianceScore: number;
  assignmentMetrics: {
    completionRate: number;
    total: number;
    completed: number;
  };
  openIncidents: number;
  laborMetrics: {
    attendanceRate: number;
    totalSessions: number;
    noShows: number;
    overtimeMinutes: number;
  };
  temperatureMetrics: {
    complianceRate: number;
    totalReadings: number;
    compliantReadings: number;
  };
  inventoryMetrics: {
    totalBatches: number;
    lowStock: number;
    expiringSoon: number;
  };
  costMetrics: {
    total: number;
    byCategory: Record<string, number>;
  };
  performanceIndex: number;
}

export default function BranchesPage() {
  const [period, setPeriod] = useState("30d");
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState<BranchDetail | null>(null);

  useEffect(() => {
    setLoading(true);
      fetch(`/api/analytics/branch-performance?period=${period}`)
      .then((res) => res.json())
      .then((data) => {
        setBranches(data.branches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6 p-8">
        <div className="h-10 w-64 bg-muted animate-pulse rounded" />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="h-[400px] bg-muted animate-pulse rounded-xl" />
          <div className="h-[400px] bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Desempeño de Sucursales</h2>
          <p className="text-muted-foreground mt-1">
            Comparativo y ranking de sucursales por indicadores clave
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Periodo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
            <SelectItem value="90d">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {branches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay datos de sucursales disponibles para el periodo seleccionado
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <BranchComparisonChart period={period} />
            <BranchRankingTable period={period} />
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-4">Detalle por Sucursal</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {branches.map((branch) => (
                <Card
                  key={branch.branchId}
                  className="cursor-pointer transition-all hover:shadow-md"
                  onClick={() =>
                    setSelectedBranch(
                      selectedBranch?.branchId === branch.branchId ? null : branch
                    )
                  }
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between">
                      <span className="truncate">{branch.branchName}</span>
                      <span className="text-2xl font-bold text-primary ml-2">
                        {branch.performanceIndex.toFixed(1)}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-600" />
                        <div>
                          <p className="text-muted-foreground text-xs">Completitud</p>
                          <p className="font-medium">{branch.workflowMetrics.completionRate}%</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                        <div>
                          <p className="text-muted-foreground text-xs">Cumplimiento</p>
                          <p className="font-medium">{branch.complianceScore}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-600" />
                        <div>
                          <p className="text-muted-foreground text-xs">Incidentes</p>
                          <p className="font-medium">{branch.openIncidents}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-purple-600" />
                        <div>
                          <p className="text-muted-foreground text-xs">Asistencia</p>
                          <p className="font-medium">{branch.laborMetrics.attendanceRate}%</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-red-600" />
                        <div>
                          <p className="text-muted-foreground text-xs">Temperatura</p>
                          <p className="font-medium">{branch.temperatureMetrics.complianceRate}%</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-amber-600" />
                        <div>
                          <p className="text-muted-foreground text-xs">Stock Bajo</p>
                          <p className="font-medium">{branch.inventoryMetrics.lowStock}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {selectedBranch && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{selectedBranch.branchName} - Detalle</span>
                  <span className="text-3xl font-bold text-primary">
                    {selectedBranch.performanceIndex.toFixed(1)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <h4 className="font-semibold mb-2 text-sm text-muted-foreground uppercase">Flujos de Trabajo</h4>
                    <div className="space-y-1 text-sm">
                      <p>Total: <span className="font-medium">{selectedBranch.workflowMetrics.totalWorkflows}</span></p>
                      <p>Completados: <span className="font-medium">{selectedBranch.workflowMetrics.completedWorkflows}</span></p>
                      <p>Tasa: <span className="font-medium">{selectedBranch.workflowMetrics.completionRate}%</span></p>
                      <p>Score promedio: <span className="font-medium">{selectedBranch.workflowMetrics.avgScore}</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2 text-sm text-muted-foreground uppercase">Personal</h4>
                    <div className="space-y-1 text-sm">
                      <p>Sesiones: <span className="font-medium">{selectedBranch.laborMetrics.totalSessions}</span></p>
                      <p>Asistencia: <span className="font-medium">{selectedBranch.laborMetrics.attendanceRate}%</span></p>
                      <p>No shows: <span className="font-medium">{selectedBranch.laborMetrics.noShows}</span></p>
                      <p>Horas extras: <span className="font-medium">{selectedBranch.laborMetrics.overtimeMinutes} min</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2 text-sm text-muted-foreground uppercase">Inventario y Temperatura</h4>
                    <div className="space-y-1 text-sm">
                      <p>Lotes: <span className="font-medium">{selectedBranch.inventoryMetrics.totalBatches}</span></p>
                      <p>Stock bajo: <span className="font-medium text-orange-600">{selectedBranch.inventoryMetrics.lowStock}</span></p>
                      <p>Por expirar: <span className="font-medium text-red-600">{selectedBranch.inventoryMetrics.expiringSoon}</span></p>
                      <p>Temp. compliance: <span className="font-medium">{selectedBranch.temperatureMetrics.complianceRate}%</span></p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2 text-sm text-muted-foreground uppercase">Costos</h4>
                    <div className="space-y-1 text-sm">
                      <p>Total: <span className="font-medium">${selectedBranch.costMetrics.total.toLocaleString()}</span></p>
                      {Object.entries(selectedBranch.costMetrics.byCategory).slice(0, 4).map(([cat, amt]) => (
                        <p key={cat} className="capitalize">{cat}: <span className="font-medium">${Number(amt).toLocaleString()}</span></p>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
