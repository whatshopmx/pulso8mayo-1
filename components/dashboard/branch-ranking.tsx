"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BranchIncidentStat } from "@/lib/services/branch-incident-stats";

interface BranchRankingProps {
    branches: BranchIncidentStat[];
    /** Cuántas mostrar. El resto queda en la vista por sucursal. */
    limit?: number;
}

/**
 * Tendencia de incidentes: **menos es mejor**.
 *
 * Aquí la flecha hacia arriba es mala noticia (más incidentes que el mes
 * pasado), al revés que en un KPI de ventas. Por eso el color va atado al
 * significado y no a la dirección: subir incidentes se pinta en destructive.
 */
function Delta({ actual, previo }: { actual: number; previo: number }) {
    const delta = actual - previo;

    if (delta === 0) {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Minus className="h-3 w-3" />
                igual
            </span>
        );
    }

    const Icono = delta > 0 ? ArrowUp : ArrowDown;
    return (
        <span
            className={`inline-flex items-center gap-1 text-xs ${
                delta > 0 ? "text-destructive" : "text-success-text"
            }`}
        >
            <Icono className="h-3 w-3" />
            {delta > 0 ? "+" : ""}
            {delta} vs. mes anterior
        </span>
    );
}

export function BranchRanking({ branches, limit = 5 }: BranchRankingProps) {
    // Peor a mejor: la que más incidentes tuvo este mes encabeza. El desempate
    // es por cumplimiento, para que dos sucursales con el mismo conteo no
    // queden en un orden arbitrario que cambia entre recargas.
    const ordenadas = React.useMemo(
        () =>
            [...branches]
                .sort((a, b) => b.thisPeriod - a.thisPeriod || a.score - b.score)
                .slice(0, limit),
        [branches, limit]
    );

    if (ordenadas.length === 0) return null;

    const sinIncidentes = ordenadas.every((b) => b.thisPeriod === 0);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy className="h-4 w-4 text-muted-foreground" />
                    Ranking de sucursales
                </CardTitle>
            </CardHeader>
            <CardContent>
                {sinIncidentes ? (
                    <p className="py-2 text-sm text-muted-foreground">
                        Ninguna sucursal registró incidentes en los últimos 30 días.
                    </p>
                ) : (
                    <ol className="space-y-1">
                        {ordenadas.map((b, i) => (
                            <li key={b.branchId}>
                                <Link
                                    href={`/dashboard/incidents?branchId=${b.branchId}`}
                                    className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                                        {i + 1}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{b.name}</p>
                                        <Delta actual={b.thisPeriod} previo={b.lastPeriod} />
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p className="text-sm font-semibold tabular-nums">
                                            {b.thisPeriod}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            este mes
                                        </p>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ol>
                )}
            </CardContent>
        </Card>
    );
}
