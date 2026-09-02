"use client";

import * as React from "react";
import { Minus, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export interface ComplianceBranch {
    branchId: string;
    name: string;
    score: number;
    trend: number;
    total: number;
    resolved: number;
}

export interface ComplianceScoreData {
    overall: number;
    overallTrend: number;
    slaHoras: Record<string, number>;
    byBranch: ComplianceBranch[];
}

interface ComplianceScoreCardProps {
    data: ComplianceScoreData | null;
    loading?: boolean;
}

/**
 * Semáforo del score. Los cortes (80 / 60) son los del plan V2.
 *
 * El color va en el texto y en la barra, nunca como fondo completo: el rojo
 * operativo es acento de 10–15%, no relleno (DESIGN.md).
 *
 * Texto y relleno no comparten token: `--success`/`--warning` estan calibrados
 * para rellenos y como texto en `text-xs` no llegan a 4.5:1. Para eso existen
 * `--success-text` y `--warning-text` (ver el comentario en `globals.css`).
 */
function tono(score: number): { texto: string; barra: string; etiqueta: string } {
    if (score > 80) {
        return {
            texto: "text-success-text",
            barra: "[&>div]:bg-success",
            etiqueta: "En control",
        };
    }
    if (score >= 60) {
        return {
            texto: "text-warning-text",
            barra: "[&>div]:bg-warning",
            etiqueta: "Requiere atención",
        };
    }
    return {
        texto: "text-destructive",
        barra: "[&>div]:bg-destructive",
        etiqueta: "Crítico",
    };
}

function Tendencia({ valor }: { valor: number }) {
    if (valor === 0) {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Minus className="h-3 w-3" />
                sin cambio
            </span>
        );
    }
    const Icono = valor > 0 ? TrendingUp : TrendingDown;
    return (
        <span
            className={`inline-flex items-center gap-1 text-xs ${
                valor > 0 ? "text-success-text" : "text-destructive"
            }`}
        >
            <Icono className="h-3 w-3" />
            {valor > 0 ? "+" : ""}
            {valor} pts vs. período anterior
        </span>
    );
}

export function ComplianceScoreCard({ data, loading }: ComplianceScoreCardProps) {
    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-5 w-40" />
                </CardHeader>
                <CardContent className="space-y-3">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-2 w-full" />
                    <Skeleton className="h-16 w-full" />
                </CardContent>
            </Card>
        );
    }

    if (!data) return null;

    const t = tono(data.overall);
    const conIncidentes = data.byBranch.filter((b) => b.total > 0);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    Score de cumplimiento
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <div className="flex items-end justify-between gap-3">
                        <div className="flex items-baseline gap-2">
                            <span className={`text-4xl font-bold tabular-nums ${t.texto}`}>
                                {data.overall}
                            </span>
                            <span className="text-sm text-muted-foreground">/ 100</span>
                        </div>
                        <span className={`text-xs font-medium ${t.texto}`}>{t.etiqueta}</span>
                    </div>
                    <Progress value={data.overall} className={`h-2 ${t.barra}`} />
                    <Tendencia valor={data.overallTrend} />
                    <p className="text-xs text-muted-foreground">
                        Incidentes resueltos dentro de su ventana de SLA
                        {" — "}
                        crítico {data.slaHoras.CRITICAL} h, alto {data.slaHoras.HIGH} h,
                        aviso {data.slaHoras.WARNING} h.
                    </p>
                </div>

                {conIncidentes.length > 0 && (
                    <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground">
                            Por sucursal
                        </p>
                        {conIncidentes.map((b) => {
                            const tb = tono(b.score);
                            return (
                                <div key={b.branchId} className="space-y-1">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="truncate">{b.name}</span>
                                        <span className={`shrink-0 font-medium tabular-nums ${tb.texto}`}>
                                            {b.score} · {b.resolved}/{b.total}
                                        </span>
                                    </div>
                                    <Progress value={b.score} className={`h-1 ${tb.barra}`} />
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
