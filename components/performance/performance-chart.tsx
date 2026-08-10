'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Loader2 } from 'lucide-react';

interface TrendPoint {
  reviewPeriod: string;
  averageRating: number | null;
  completed: number;
}

interface PerformanceChartProps {
  companyId: string;
}

const MIN_COMPLETED_FOR_TREND = 5;

export function PerformanceChart({ companyId }: PerformanceChartProps) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [totalCompleted, setTotalCompleted] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrend = async () => {
      try {
        const res = await fetch(`/api/performance/stats`);
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = await res.json();
        const points: TrendPoint[] = Array.isArray(data.trend)
          ? data.trend.map((t: any) => ({
              reviewPeriod: t.reviewPeriod,
              averageRating: t.averageRating != null ? Number(t.averageRating) : null,
              completed: t.completed ?? 0,
            }))
          : [];
        setTrend(points);
        setTotalCompleted(data.stats?.reviews?.completed ?? 0);
      } catch (error) {
        console.error('Error fetching performance trend:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTrend();
  }, [companyId]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center gap-2 h-[300px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando tendencias...
      </div>
    );
  }

  if (totalCompleted < MIN_COMPLETED_FOR_TREND || trend.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px] gap-2 text-center">
        <p className="font-medium text-muted-foreground">
          Sin suficientes datos de evaluación para mostrar tendencias
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          Las tendencias aparecerán cuando haya al menos {MIN_COMPLETED_FOR_TREND} evaluaciones
          completadas con calificación en un mismo período.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-[300px]" role="img" aria-label="Gráfica de rating promedio y evaluaciones completadas por período">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="reviewPeriod" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="rating"
              domain={[0, 5]}
              tickCount={6}
              allowDecimals={false}
              tick={{ fontSize: 12 }}
              label={{ value: 'Rating', angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: 'var(--muted-foreground)' } }}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              allowDecimals={false}
              tick={{ fontSize: 12 }}
              label={{ value: 'Completadas', angle: 90, position: 'insideRight', style: { fontSize: 12, fill: 'var(--muted-foreground)' } }}
            />
            <Tooltip
              formatter={(value: number | string, name: string) => [
                name === 'Rating promedio' ? `${value}/5` : String(value),
                name,
              ]}
              labelFormatter={(label) => `Período ${label}`}
            />
            <Legend />
            <Bar
              yAxisId="count"
              dataKey="completed"
              name="Evaluaciones completadas"
              fill="var(--chart-3)"
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="rating"
              type="monotone"
              dataKey="averageRating"
              name="Rating promedio"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--chart-1)' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-sm text-muted-foreground text-center">
        Promedio real de evaluaciones completadas por período
      </div>
    </div>
  );
}