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
import { BranchRankingTable } from "@/components/analytics/branch-ranking-table";
import { BranchQSRScorecard } from "@/components/analytics/branch-qsr-scorecard";
import { useExportCsv } from "@/components/shared/use-export-csv";
import { Download, Store, Trophy } from "lucide-react";
import type { BranchQSRRankingResult } from "@/lib/services/cross-branch-service";

const PERIODOS = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "ytd", label: "En el año" },
];

export default function BranchesPage() {
  const [period, setPeriod] = React.useState("30d");
  const [qsrData, setQsrData] = React.useState<BranchQSRRankingResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { exportToCsv } = useExportCsv();

  const cargar = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/group/branches-qsr?period=${period}`);
      if (!res.ok) throw new Error("No se pudo cargar la Liga de Sucursales");
      const json = await res.json();
      setQsrData(json.data ?? json);
    } catch (err: any) {
      setQsrData(null);
      setError(err?.message || "No se pudo cargar la Liga de Sucursales");
    } finally {
      setLoading(false);
    }
  }, [period]);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  const exportar = () => {
    if (!qsrData || qsrData.branches.length === 0) return;
    const etiquetaPeriodo = PERIODOS.find((p) => p.value === period)?.label ?? period;

    exportToCsv({
      headers: [
        "Lugar",
        "Sucursal",
        "Score QSR",
        "Venta Total (MXN)",
        "Food Cost (%)",
        "Labor Cost (%)",
        "Prime Cost (%)",
        "Estatus Prime Cost",
        "Cumplimiento NOM-251 (%)",
        "Cuadre Caja (%)",
        "Calidad Datos",
        "Período",
      ],
      rows: qsrData.branches.map((b) => [
        b.rank,
        b.branchName,
        b.compositeScore.toFixed(1),
        Math.round(b.salesTotalCents / 100),
        b.foodCostPercent.toFixed(1),
        b.laborCostPercent.toFixed(1),
        b.primeCostPercent.toFixed(1),
        b.primeCostStatus,
        b.nom251ComplianceRate.toFixed(1),
        b.cashReconciliationRate.toFixed(1),
        b.dataQuality === "VERIFIED" ? "Verificado" : "Estimado",
        etiquetaPeriodo,
      ]),
      filename: "liga-sucursales-qsr",
      useBom: true,
    });
  };

  const branches = qsrData?.branches ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Liga de Sucursales"
        description="Benchmarking, consistencia multi-unidad y control de Prime Cost en la red QSR."
        icon={Trophy}
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
          <span className="sr-only">Cargando Liga de Sucursales</span>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[220px] w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[350px] w-full rounded-xl" />
        </div>
      ) : branches.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Store}
              title="Todavía no hay datos para comparar"
              description="En cuanto tus sucursales registren actividad o cortes en este período, aquí aparece la Liga QSR."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {qsrData && <BranchQSRScorecard data={qsrData} period={period} />}
          <BranchRankingTable qsrBranches={branches} period={period} />
        </div>
      )}
    </PageContainer>
  );
}
