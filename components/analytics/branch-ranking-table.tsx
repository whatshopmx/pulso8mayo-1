"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Medal, Award } from "lucide-react";
import { useEffect, useState } from "react";

interface RankingItem {
  rank: number;
  branchId: string;
  branchName: string;
  performanceIndex: number;
}

interface Props {
  /** Datos ya cargados por la página. Es la forma preferida. */
  ranking?: RankingItem[];
  /**
   * Modo autónomo heredado: el componente pide los datos por su cuenta.
   * Sólo lo usa `/dashboard/branches`, que está huérfana y duplica esta vista.
   * Cuando esa página se elimine, este modo y el `useEffect` se van con ella.
   */
  period?: string;
}

const rankIcons = [Trophy, Medal, Award];

export function BranchRankingTable({ ranking: rankingProp, period }: Props) {
  const autonomo = rankingProp === undefined;
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [loading, setLoading] = useState(autonomo);

  useEffect(() => {
    if (!autonomo) return;
    fetch(`/api/analytics/branch-performance?period=${period}`)
      .then((res) => res.json())
      .then((data) => {
        setRanking(data.ranking || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [autonomo, period]);

  const datos = rankingProp ?? ranking;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="py-8 text-center text-muted-foreground">Cargando ranking…</div>
        </CardContent>
      </Card>
    );
  }

  if (datos.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="py-8 text-center text-muted-foreground">
            Sin datos para este período
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ranking de sucursales</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {datos.map((item) => {
            const RankIcon = item.rank <= 3 ? rankIcons[item.rank - 1] : null;
            return (
              <li
                key={item.branchId}
                className="flex items-center gap-4 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                  {RankIcon ? (
                    // El color de medalla salía de literales de Tailwind sin
                    // equivalente en modo oscuro. El lugar ya lo dice el orden
                    // de la lista y el número; el ícono no necesita cargar el
                    // significado con color.
                    <RankIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground" aria-hidden="true">
                      #{item.rank}
                    </span>
                  )}
                  <span className="sr-only">Lugar {item.rank}</span>
                </div>
                <p className="flex-1 text-sm font-medium">{item.branchName}</p>
                <p className="text-right text-lg font-bold tabular-nums">
                  {item.performanceIndex.toFixed(1)}
                </p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
