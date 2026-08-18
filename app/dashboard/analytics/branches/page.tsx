"use client";

import * as React from "react";
import { PageHeader, PageContainer, EmptyState, ErrorState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BranchComparisonChart } from "@/components/analytics/branch-comparison-chart";
import { BranchRankingTable } from "@/components/analytics/branch-ranking-table";
import { BranchPerformanceScoreCard } from "@/components/analytics/branch-performance-score-card";
import { useExportCsv } from "@/components/shared/use-export-csv";
import { Download, Store } from "lucide-react";

export interface BranchData {
  branchId: string;
  branchName: string;
  workflowMetrics: { completionRate: number };
  complianceScore: number;
  assignmentMetrics: { completionRate: number };
  performanceIndex: number;
}

export interface RankingItem {
  rank: number;
  branchId: string;
  branchName: string;
  performanceIndex: number;
}

const PERIODOS = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "ytd", label: "En el año" },
];

export default function BranchPerformancePage() {
  const [period, setPeriod] = React.useState("30d");
  const [branches, setBranches] = React.useState<BranchData[]>([]);
  const [ranking, setRanking] = React.useState<RankingItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { exportToCsv } = useExportCsv();

  // Una sola petición para toda la pantalla. La página, la gráfica y el ranking
  // pedían cada quien `/api/analytics/branch-performance` por su cuenta: tres
  // veces la misma agregación pesada en cada carga y en cada cambio de período.
  const cargar = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/branch-performance?period=${period}`);
      if (!res.ok) throw new Error("No se pudo cargar el desempeño por sucursal");
      const data = await res.json();
      setBranches(data.branches ?? []);
      setRanking(data.ranking ?? []);
    } catch (err: any) {
      setBranches([]);
      setRanking([]);
      // Antes el `.catch` sólo apagaba el spinner: una falla del servidor se
      // veía igual que "esta empresa no tiene sucursales".
      setError(err?.message || "No se pudo cargar el desempeño por sucursal");
    } finally {
      setLoading(false);
    }
  }, [period]);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  const exportar = () => {
    const etiquetaPeriodo = PERIODOS.find((p) => p.value === period)?.label ?? period;
    exportToCsv({
      headers: [
        "Lugar",
        "Sucursal",
        "Índice de desempeño",
        "Completitud de tareas (%)",
        "Cumplimiento",
        "Asignaciones completadas (%)",
        "Período",
      ],
      rows: [...branches]
        .sort((a, b) => b.performanceIndex - a.performanceIndex)
        .map((b, i) => [
          i + 1,
          b.branchName,
          b.performanceIndex,
          b.workflowMetrics.completionRate,
          b.complianceScore,
          b.assignmentMetrics.completionRate,
          etiquetaPeriodo,
        ]),
      filename: "desempeno-por-sucursal",
      // Excel en español necesita el BOM para no romper acentos.
      useBom: true,
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Desempeño por sucursal"
        description="Qué sucursal va adelante y cuál necesita atención."
        icon={Store}
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="periodo" className="sr-only">
                Período
              </Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger id="periodo" className="h-11 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="h-11"
              onClick={exportar}
              disabled={loading || branches.length === 0}
            >
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              Exportar CSV
            </Button>
          </div>
        }
      />

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <ErrorState message={error} onRetry={cargar} />
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-6" aria-live="polite">
          <span className="sr-only">Cargando desempeño por sucursal</span>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[200px] w-full rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[400px] w-full rounded-xl" />
            <Skeleton className="h-[400px] w-full rounded-xl" />
          </div>
        </div>
      ) : branches.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Store}
              title="Todavía no hay datos para comparar"
              description="En cuanto tus sucursales registren actividad en este período, aquí aparece el comparativo."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {branches.map((branch) => (
              <BranchPerformanceScoreCard
                key={branch.branchId}
                branchId={branch.branchId}
                branchName={branch.branchName}
                performanceIndex={branch.performanceIndex}
                dimensions={[
                  {
                    label: "Tareas",
                    value: branch.workflowMetrics.completionRate,
                    maxValue: 100,
                  },
                  {
                    label: "Cumplimiento",
                    value: branch.complianceScore,
                    maxValue: 100,
                  },
                  {
                    label: "Asignaciones",
                    value: branch.assignmentMetrics.completionRate,
                    maxValue: 100,
                  },
                ]}
              />
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <BranchComparisonChart branches={branches} />
            <BranchRankingTable ranking={ranking} />
          </div>
        </>
      )}
    </PageContainer>
  );
}
