"use client";

import * as React from "react";
import { PageHeader, PageContainer, EmptyState, ErrorState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

/** C29 — cómo se llamó la base de ventas en cada renglón del CSV. */
const ETIQUETA_BASE: Record<string, string> = {
  NET_MEASURED: "Neta medida (IVA del POS)",
  NET_DERIVED: "Neta estimada (IVA configurado)",
  GROSS_DECLARED: "Con IVA (sin desglose)",
};

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
        "Base de Ventas",
        "Food Cost (%)",
        "Labor Cost (%)",
        "Prime Cost (%)",
        "Estatus Prime Cost",
        "Procedencia Costos",
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
        ETIQUETA_BASE[b.salesBaseKind ?? "GROSS_DECLARED"],
        b.foodCostPercent.toFixed(1),
        b.laborCostPercent.toFixed(1),
        b.primeCostPercent.toFixed(1),
        b.primeCostStatus,
        `${b.foodCostSource ?? "NO_DATA"} / ${b.laborCostSource ?? "NO_DATA"}`,
        b.nom251ComplianceRate.toFixed(1),
        b.cashReconciliationRate.toFixed(1),
        b.dataQuality === "MEASURED" ? "Verificado" : b.dataQuality === "MISSING" ? "Sin datos" : "Estimado",
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
          {/* C22 — quién pide las cifras y sobre qué red se calculan. Los dos
              avisos salen del servidor, no de la interpretación de la
              pantalla: si el servidor acotó, la pantalla lo dice. */}
          {qsrData?.alcance && !qsrData.alcance.completa && (
            <Card role="status" data-testid="aviso-alcance">
              <CardContent className="pt-6 flex flex-col gap-1">
                <p className="text-sm font-medium">{qsrData.alcance.motivo}</p>
                <p className="text-xs text-muted-foreground">
                  Tus cifras cubren {qsrData.alcance.visibles} de{" "}
                  {qsrData.alcance.total} sucursales del grupo.
                </p>
              </CardContent>
            </Card>
          )}
          {qsrData?.red && <RedesDelGrupo red={qsrData.red} />}
          {qsrData && <BranchQSRScorecard data={qsrData} period={period} />}
          <BranchRankingTable qsrBranches={branches} period={period} />
        </div>
      )}
    </PageContainer>
  );
}

/**
 * C22 — lo que la política de tipo de empresa decidió para este grupo.
 *
 * Sale del servidor (`red` en la respuesta de la ruta) y la pantalla sólo lo
 * presenta: una red o dos, cuántas sucursales hay en cada una, sus promedios
 * y las contradicciones de captura que la política dejó a la vista.
 */
function RedesDelGrupo({
  red,
}: {
  red: NonNullable<BranchQSRRankingResult["red"]>;
}) {
  return (
    <Card data-testid="redes-del-grupo">
      <CardHeader>
        <CardTitle className="text-base">{red.veredicto.titulo}</CardTitle>
        <CardDescription>{red.veredicto.detalle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {red.segmentos.map((segmento) => (
            <div key={segmento.tipo} className="rounded-xl border border-border/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{segmento.etiqueta}</span>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {segmento.sucursales} {segmento.sucursales === 1 ? "sucursal" : "sucursales"}
                </Badge>
              </div>
              {segmento.sucursales > 0 ? (
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      ["Prime Cost", segmento.promedios.primeCost],
                      ["Food Cost", segmento.promedios.foodCost],
                      ["Labor Cost", segmento.promedios.laborCost],
                    ] as Array<[string, number]>
                  ).map(([etiqueta, valor]) => (
                    <div key={etiqueta} className="rounded-lg bg-muted/40 px-2 py-2">
                      <dt className="text-[11px] text-muted-foreground">{etiqueta}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{valor.toFixed(1)}%</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sin sucursales en esta red todavía.
                </p>
              )}
            </div>
          ))}
        </div>
        {red.contradicciones.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3" role="alert">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Captura inconsistente
            </p>
            <ul className="mt-1 space-y-1">
              {red.contradicciones.map((contradiccion) => (
                <li key={contradiccion} className="text-xs text-muted-foreground">
                  {contradiccion}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
