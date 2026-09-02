"use client";

import * as React from "react";
import {
    Camera,
    CheckCircle2,
    FileText,
    ImageOff,
    XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export interface EvidenceItem {
    stepIndex: number | null;
    type: "photo" | "text";
    content: string;
    passed: boolean | null;
    aiReason: string | null;
    aiConfidence: number | null;
    submittedBy: string | null;
    createdAt: string;
    source: "detection" | "remediation";
}

interface EvidenceGalleryProps {
    incidentId: string;
}

function formatearFecha(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "Fecha desconocida";
    return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Etiqueta del paso. `null` es la foto de detección, no "paso 0": mezclarlas
 * haría leer la evidencia original como si fuera un intento de arreglo.
 */
function etiquetaPaso(item: EvidenceItem): string {
    if (item.source === "detection") return "Detección";
    return item.stepIndex === null ? "Remediación" : `Paso ${item.stepIndex + 1}`;
}

function ResultadoBadge({ item }: { item: EvidenceItem }) {
    if (item.passed === null) return null;
    return item.passed ? (
        <Badge variant="outline" className="gap-1 text-xs">
            <CheckCircle2 className="h-3 w-3 text-success" />
            Aprobada
        </Badge>
    ) : (
        <Badge variant="destructive" className="gap-1 text-xs">
            <XCircle className="h-3 w-3" />
            Rechazada
        </Badge>
    );
}

export function EvidenceGallery({ incidentId }: EvidenceGalleryProps) {
    const [items, setItems] = React.useState<EvidenceItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(false);
    const [abierta, setAbierta] = React.useState<EvidenceItem | null>(null);
    /**
     * Fotos cuya URL ya no responde. R2 tiene ciclo de vida propio y las
     * entradas del historial son permanentes, así que una evidencia vieja
     * puede apuntar a un objeto borrado; sin esto el usuario ve el cuadro roto
     * del navegador y no sabe si falló la carga o si nunca hubo foto.
     */
    const [rotas, setRotas] = React.useState<Set<string>>(new Set());
    const marcarRota = React.useCallback((url: string) => {
        setRotas((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
    }, []);

    React.useEffect(() => {
        const controller = new AbortController();
        async function cargar() {
            try {
                const res = await fetch(`/api/incidents/${incidentId}/evidence`, {
                    signal: controller.signal,
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                setItems(json.data ?? []);
                setError(false);
            } catch (err) {
                if ((err as Error).name !== "AbortError") setError(true);
            } finally {
                setLoading(false);
            }
        }
        cargar();
        return () => controller.abort();
    }, [incidentId]);

    if (loading) {
        return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-44 w-full" />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <EmptyState
                icon={ImageOff}
                title="No se pudo cargar la evidencia"
                description="Vuelve a intentarlo en unos segundos."
            />
        );
    }

    if (items.length === 0) {
        return (
            <EmptyState
                icon={Camera}
                title="Sin evidencia registrada"
                description="Cuando alguien suba una foto o registre un intento de remediación, aparecerá aquí."
            />
        );
    }

    return (
        <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item, i) => (
                    <Card
                        key={`${item.createdAt}-${i}`}
                        className={
                            item.type === "photo"
                                ? "overflow-hidden cursor-pointer transition-colors hover:bg-muted/40"
                                : "overflow-hidden"
                        }
                        onClick={() => {
                            if (item.type === "photo") setAbierta(item);
                        }}
                    >
                        {item.type === "photo" ? (
                            <div className="flex h-32 w-full items-center justify-center bg-muted">
                                {rotas.has(item.content) ? (
                                    <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                                        <ImageOff className="h-5 w-5" />
                                        <span className="text-xs">Foto no disponible</span>
                                    </div>
                                ) : (
                                    /* `<img>` y no `next/image`: es la convención del repo para
                                       evidencia (workflow-executor, ai-verification-status). Las
                                       fotos viven en R2 con dominio distinto por entorno y no
                                       están en `images.remotePatterns`. */
                                    <img
                                        src={item.content}
                                        alt={`Evidencia — ${etiquetaPaso(item)}`}
                                        className="h-full w-full object-cover"
                                        onError={() => marcarRota(item.content)}
                                    />
                                )}
                            </div>
                        ) : (
                            <div className="flex h-32 w-full items-start gap-2 bg-muted/40 p-3">
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <p className="text-xs text-muted-foreground line-clamp-5">
                                    {item.content || "Sin contenido"}
                                </p>
                            </div>
                        )}

                        <CardContent className="space-y-1.5 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <Badge variant="secondary" className="text-xs">
                                    {etiquetaPaso(item)}
                                </Badge>
                                <ResultadoBadge item={item} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {formatearFecha(item.createdAt)}
                            </p>
                            {item.aiConfidence !== null && (
                                <p className="text-xs text-muted-foreground">
                                    Confianza IA: {Math.round(item.aiConfidence * 100)}%
                                </p>
                            )}
                            {item.aiReason && (
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                    {item.aiReason}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={!!abierta} onOpenChange={(o) => !o && setAbierta(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogTitle className="text-base">
                        {abierta
                            ? `${etiquetaPaso(abierta)} — ${formatearFecha(abierta.createdAt)}`
                            : ""}
                    </DialogTitle>
                    {abierta && (
                        <div className="space-y-3">
                            {rotas.has(abierta.content) ? (
                                <div className="flex h-48 flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
                                    <ImageOff className="h-6 w-6" />
                                    <span className="text-sm">Foto no disponible</span>
                                </div>
                            ) : (
                                <img
                                    src={abierta.content}
                                    alt="Evidencia"
                                    className="max-h-[60vh] w-full bg-muted object-contain"
                                    onError={() => marcarRota(abierta.content)}
                                />
                            )}
                            {abierta.aiReason && (
                                <p className="text-sm text-muted-foreground">{abierta.aiReason}</p>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
