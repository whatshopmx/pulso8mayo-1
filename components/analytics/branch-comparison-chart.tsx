"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect, useState } from "react";

interface BranchMetric {
  branchId: string;
  branchName: string;
  workflowMetrics: { completionRate: number };
  complianceScore: number;
  assignmentMetrics: { completionRate: number };
  performanceIndex: number;
}

interface Props {
  /** Datos ya cargados por la página. Es la forma preferida. */
  branches?: BranchMetric[];
  /**
   * Modo autónomo heredado: el componente pide los datos por su cuenta.
   * Sólo lo usa `/dashboard/branches`, que está huérfana y duplica esta vista.
   * Cuando esa página se elimine, este modo y el `useEffect` se van con ella.
   */
  period?: string;
}

const SERIES = [
  { key: "Completitud de tareas", color: "var(--chart-1)" },
  { key: "Cumplimiento", color: "var(--chart-3)" },
  { key: "Asignaciones completadas", color: "var(--chart-4)" },
];

export function BranchComparisonChart({ branches: branchesProp, period }: Props) {
  const autonomo = branchesProp === undefined;
  const [branches, setBranches] = useState<BranchMetric[]>([]);
  const [loading, setLoading] = useState(autonomo);

  useEffect(() => {
    if (!autonomo) return;
    fetch(`/api/analytics/branch-performance?period=${period}`)
      .then((res) => res.json())
      .then((data) => {
        setBranches(data.branches || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [autonomo, period]);

  const datos = branchesProp ?? branches;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex h-[400px] items-center justify-center text-muted-foreground">
            Cargando…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (datos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex h-[400px] items-center justify-center text-muted-foreground">
            Sin datos para este período
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = datos.map((b) => ({
    // El nombre completo va en `nombreCompleto` para que el tooltip no mienta
    // cuando la etiqueta del eje se recorta.
    name: b.branchName.length > 12 ? `${b.branchName.substring(0, 12)}…` : b.branchName,
    nombreCompleto: b.branchName,
    "Completitud de tareas": b.workflowMetrics.completionRate,
    Cumplimiento: b.complianceScore,
    "Asignaciones completadas": b.assignmentMetrics.completionRate,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comparativo entre sucursales</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} layout="vertical">
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="name" width={100} />
            <Tooltip
              formatter={(value: number) => [`${value.toFixed(1)}%`]}
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.nombreCompleto ?? ""
              }
            />
            <Legend />
            {/* Tokens de la paleta en vez de hex fijos: los literales no tenían
                equivalente en modo oscuro y se salían del sistema de color. */}
            {SERIES.map((serie) => (
              <Bar key={serie.key} dataKey={serie.key} fill={serie.color} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
