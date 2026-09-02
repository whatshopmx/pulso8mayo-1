"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { BranchIncidentStat } from "@/lib/services/branch-incident-stats";

interface BranchIncidentSummaryProps {
    branches: BranchIncidentStat[];
    /** Sucursal filtrada actualmente, para marcar la card activa. */
    selectedBranchId?: string;
}

type Orden = "incidentes" | "score" | "nombre";

/** Mismo semáforo que `ComplianceScoreCard`: >80 bien, 60–80 atención, <60 mal. */
function tonoScore(score: number): string {
    if (score > 80) return "text-success-text";
    if (score >= 60) return "text-warning-text";
    return "text-destructive";
}

export function BranchIncidentSummary({
    branches,
    selectedBranchId,
}: BranchIncidentSummaryProps) {
    const [orden, setOrden] = React.useState<Orden>("incidentes");

    const ordenadas = React.useMemo(() => {
        const copia = [...branches];
        if (orden === "incidentes") return copia.sort((a, b) => b.active - a.active);
        if (orden === "score") return copia.sort((a, b) => a.score - b.score);
        return copia.sort((a, b) => a.name.localeCompare(b.name, "es"));
    }, [branches, orden]);

    if (branches.length === 0) return null;

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                    Por sucursal · últimos 60 días
                </h2>
                <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
                    <SelectTrigger className="h-8 w-[190px] text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="incidentes">Más incidentes activos</SelectItem>
                        <SelectItem value="score">Menor cumplimiento</SelectItem>
                        <SelectItem value="nombre">Nombre</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ordenadas.map((b) => {
                    const activa = selectedBranchId === b.branchId;
                    return (
                        <Link
                            key={b.branchId}
                            // El filtro viaja en la URL: la card es un enlace de
                            // verdad, así que se puede compartir y abrir en otra
                            // pestaña, cosa que un onClick con estado no permite.
                            href={activa ? "/dashboard/incidents" : `/dashboard/incidents?branchId=${b.branchId}`}
                            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                        >
                            <Card
                                className={`h-full transition-colors hover:bg-muted/50 ${
                                    activa ? "border-primary bg-muted/40" : ""
                                }`}
                            >
                                <CardContent className="space-y-3 p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate text-sm font-medium">
                                                {b.name}
                                            </span>
                                        </div>
                                        {activa && (
                                            <Badge variant="secondary" className="shrink-0 text-xs">
                                                Filtrando
                                            </Badge>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div>
                                            <p className="text-lg font-semibold tabular-nums">
                                                {b.total}
                                            </p>
                                            <p className="text-xs text-muted-foreground">Totales</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-semibold tabular-nums">
                                                {b.active}
                                            </p>
                                            <p className="text-xs text-muted-foreground">Activos</p>
                                        </div>
                                        <div>
                                            <p className="text-lg font-semibold tabular-nums">
                                                {b.resolved}
                                            </p>
                                            <p className="text-xs text-muted-foreground">Resueltos</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 border-t pt-2">
                                        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">
                                            Cumplimiento
                                        </span>
                                        <span
                                            className={`ml-auto text-sm font-semibold tabular-nums ${tonoScore(b.score)}`}
                                        >
                                            {b.score}
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
