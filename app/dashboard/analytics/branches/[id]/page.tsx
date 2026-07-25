"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader, PageContainer } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BranchPerformanceScoreCard } from "@/components/analytics/branch-performance-score-card";
import {
  ArrowLeft,
  Users,
  Thermometer,
  Package,
  DollarSign,
  ClipboardCheck,
} from "lucide-react";

interface BranchDetail {
  branchId: string;
  branchName: string;
  workflowMetrics: { completionRate: number; totalWorkflows: number; completedWorkflows: number; avgScore: number };
  complianceScore: number;
  assignmentMetrics: { completionRate: number; total: number; completed: number };
  openIncidents: number;
  laborMetrics: { attendanceRate: number; totalSessions: number; noShows: number; overtimeMinutes: number };
  temperatureMetrics: { complianceRate: number; totalReadings: number; compliantReadings: number };
  inventoryMetrics: { totalBatches: number; lowStock: number; expiringSoon: number };
  costMetrics: { total: number; byCategory: Record<string, number> };
  performanceIndex: number;
}

interface WorkflowItem {
  id: string;
  templateName: string;
  status: string;
  score: number | null;
  assigneeName: string | null;
  createdAt: string;
  completedAt: string | null;
  stepsCompleted: number;
  stepsTotal: number;
}

export default function BranchDrillDownPage() {
  const params = useParams();
  const router = useRouter();
  const branchId = params.id as string;

  const [period, setPeriod] = React.useState("30d");
  const [branch, setBranch] = React.useState<BranchDetail | null>(null);
  const [workflows, setWorkflows] = React.useState<WorkflowItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/analytics/branch-performance?branchId=${branchId}&period=${period}`)
        .then((res) => res.json())
        .then((data) => setBranch(data.branches?.[0] || null)),
      fetch(`/api/workflows/history?branchId=${branchId}&limit=10`)
        .then((res) => res.json())
        .then((data) => setWorkflows(data.data || [])),
    ]).finally(() => setLoading(false));
  }, [branchId, period]);

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
          Cargando...
        </div>
      </PageContainer>
    );
  }

  if (!branch) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
          Sucursal no encontrada
        </div>
      </PageContainer>
    );
  }

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
      COMPLETED: "default",
      IN_PROGRESS: "secondary",
      PENDING: "outline",
      CANCELLED: "destructive",
    };
    const labels: Record<string, string> = {
      COMPLETED: "Completado",
      IN_PROGRESS: "En Progreso",
      PENDING: "Pendiente",
      CANCELLED: "Cancelado",
    };
    return (
      <Badge variant={variants[status] || "outline"}>
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={branch.branchName}
        description="Métricas detalladas de la sucursal"
        icon={ArrowLeft}
        actions={
          <>
            <Button variant="ghost" onClick={() => router.push("/dashboard/analytics/branches")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 días</SelectItem>
                <SelectItem value="30d">30 días</SelectItem>
                <SelectItem value="90d">90 días</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />

      {/* Score Card */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-6">
        <BranchPerformanceScoreCard
          branchId={branch.branchId}
          branchName={branch.branchName}
          performanceIndex={branch.performanceIndex}
          dimensions={[
            { label: "Tareas", value: branch.workflowMetrics.completionRate, maxValue: 100 },
            { label: "Cumplimiento", value: branch.complianceScore, maxValue: 100 },
            { label: "Asignaciones", value: branch.assignmentMetrics.completionRate, maxValue: 100 },
          ]}
        />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Incidentes Abiertos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{branch.openIncidents}</div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
            <Users className="h-4 w-4 text-blue-500" />
            <CardTitle className="text-sm">Asistencia</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tasa de asistencia</span>
                <span className="font-medium">{branch.laborMetrics.attendanceRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sesiones totales</span>
                <span className="font-medium">{branch.laborMetrics.totalSessions}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Inasistencias</span>
                <span className="font-medium text-red-600">{branch.laborMetrics.noShows}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Horas extra</span>
                <span className="font-medium">{branch.laborMetrics.overtimeMinutes} min</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
            <Thermometer className="h-4 w-4 text-orange-500" />
            <CardTitle className="text-sm">Temperatura</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cumplimiento</span>
                <span className="font-medium">{branch.temperatureMetrics.complianceRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Lecturas totales</span>
                <span className="font-medium">{branch.temperatureMetrics.totalReadings}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Conformes</span>
                <span className="font-medium">{branch.temperatureMetrics.compliantReadings}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
            <Package className="h-4 w-4 text-green-500" />
            <CardTitle className="text-sm">Inventario</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Lotes totales</span>
                <span className="font-medium">{branch.inventoryMetrics.totalBatches}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Stock bajo</span>
                <span className="font-medium text-yellow-600">{branch.inventoryMetrics.lowStock}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Por vencer (7d)</span>
                <span className="font-medium text-red-600">{branch.inventoryMetrics.expiringSoon}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
            <DollarSign className="h-4 w-4 text-purple-500" />
            <CardTitle className="text-sm">Costos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total período</span>
                <span className="font-medium">${(branch.costMetrics.total || 0).toLocaleString()}</span>
              </div>
              {Object.entries(branch.costMetrics.byCategory || {}).slice(0, 3).map(([cat, amount]) => (
                <div key={cat} className="flex justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{cat}</span>
                  <span className="font-medium">${Number(amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Workflows */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <ClipboardCheck className="h-4 w-4" />
          <div>
            <CardTitle className="text-base">Workflows Recientes</CardTitle>
            <CardDescription>Últimas actividades en esta sucursal</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {workflows.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Sin workflows recientes
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Asignado a</TableHead>
                  <TableHead>Progreso</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.templateName}</TableCell>
                    <TableCell>{statusBadge(w.status)}</TableCell>
                    <TableCell>{w.score !== null ? `${w.score.toFixed(1)}%` : "-"}</TableCell>
                    <TableCell>{w.assigneeName || "-"}</TableCell>
                    <TableCell>{w.stepsCompleted}/{w.stepsTotal}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(w.createdAt).toLocaleDateString("es-MX")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
