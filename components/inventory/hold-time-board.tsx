"use client";

// Task 5 (plan-loteprod-gaps §6.4) — tablero de producto en línea.
//
// Es una pantalla de línea, no de escritorio: lo que importa es qué hay que
// tirar AHORA. Por eso todo se lee en minutos relativos (los calcula el
// servidor contra su propio reloj) y no en horas absolutas, y por eso se
// refresca sola cada 30 s: una ventana de 7 minutos se vence entre dos clics.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Timer, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface BoardLine {
    id: string;
    recipeId: string;
    recipeName: string;
    producedQuantity: number;
    unit: string;
    holdTimeMinutes: number | null;
    status: "EXPIRING" | "EXPIRED";
    minutesOverdue: number;
    minutesRemaining: number;
    notified: boolean;
    estimatedLossCents: number | null;
}

const formatMXN = (cents: number) =>
    `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function HoldTimeBoard({ branchId }: { branchId: string }) {
    const [expiringSoon, setExpiringSoon] = useState<BoardLine[]>([]);
    const [expired, setExpired] = useState<BoardLine[]>([]);
    const [graceMinutes, setGraceMinutes] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [target, setTarget] = useState<BoardLine | null>(null);
    const [discardQty, setDiscardQty] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const fetchBoard = useCallback(async () => {
        try {
            const res = await fetch(
                `/api/inventory/production/hold-time?branchId=${encodeURIComponent(branchId)}`
            );
            const json = await res.json();
            if (!res.ok || !json.success) {
                // Sin sucursal seleccionada la API responde BRANCH_REQUIRED; no
                // es un error que valga un toast en cada refresco.
                setExpiringSoon([]);
                setExpired([]);
                return;
            }
            setExpiringSoon(json.data.expiringSoon ?? []);
            setExpired(json.data.expired ?? []);
            setGraceMinutes(json.data.graceMinutes ?? null);
        } catch {
            toast.error("Error al cargar el tablero en línea");
        } finally {
            setLoading(false);
        }
    }, [branchId]);

    useEffect(() => {
        setLoading(true);
        fetchBoard();
        const timer = setInterval(fetchBoard, 30_000);
        return () => clearInterval(timer);
    }, [fetchBoard]);

    const openConfirm = (line: BoardLine) => {
        setTarget(line);
        // Prellenado con la tanda completa: tirarla entera es el caso normal.
        setDiscardQty(line.producedQuantity);
    };

    const submitDiscard = async () => {
        if (!target) return;
        setSubmitting(true);
        try {
            const res = await fetch("/api/inventory/production/hold-time", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    resultId: target.id,
                    branchId,
                    discardedQuantity: discardQty,
                }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                const code = json?.error?.details?.code;
                if (code === "ALREADY_DISCARDED") {
                    toast.info("Esa tanda ya se había cerrado");
                    setTarget(null);
                    fetchBoard();
                    return;
                }
                toast.error(json?.error?.message || "No se pudo confirmar el descarte");
                return;
            }

            toast.success(
                discardQty > 0
                    ? `Merma registrada: ${discardQty} ${target.unit} de ${target.recipeName}`
                    : `${target.recipeName} se cerró sin merma (se vendió)`
            );
            setTarget(null);
            fetchBoard();
        } catch {
            toast.error("Error al confirmar el descarte");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                    Cargando producto en línea...
                </CardContent>
            </Card>
        );
    }

    if (expired.length === 0 && expiringSoon.length === 0) {
        return (
            <Card>
                <CardContent className="p-8 text-center">
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-semibold mb-2">Nada por vencer en línea</h3>
                    <p className="text-muted-foreground">
                        Todo el producto cocinado está dentro de su ventana de retención.
                        Aquí aparecerán las tandas por vencer y las que haya que tirar.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {expired.length > 0 && (
                <section className="space-y-3">
                    <div className="flex items-baseline justify-between gap-4">
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Vencidas — tirar y confirmar ({expired.length})
                        </h3>
                        {graceMinutes != null && (
                            <p className="text-xs text-muted-foreground">
                                Sin confirmar en {graceMinutes} min, el sistema registra la merma completa.
                            </p>
                        )}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {expired.map((line) => (
                            <Card key={line.id} className="border-destructive/40">
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <CardTitle className="text-lg">{line.recipeName}</CardTitle>
                                        <Badge variant="destructive">
                                            Venció hace {line.minutesOverdue} min
                                        </Badge>
                                    </div>
                                    <CardDescription>
                                        {line.producedQuantity} {line.unit}
                                        {line.holdTimeMinutes ? ` · ventana ${line.holdTimeMinutes} min` : ""}
                                        {line.estimatedLossCents != null
                                            ? ` · ${formatMXN(line.estimatedLossCents)} en riesgo`
                                            : ""}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button
                                        variant="destructive"
                                        className="w-full gap-2"
                                        onClick={() => openConfirm(line)}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Confirmar descarte
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            {expiringSoon.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Por vencer ({expiringSoon.length})
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {expiringSoon.map((line) => (
                            <Card key={line.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <CardTitle className="text-lg">{line.recipeName}</CardTitle>
                                        <Badge variant="warning" className="gap-1">
                                            <Timer className="w-3 h-3" />
                                            {line.minutesRemaining} min
                                        </Badge>
                                    </div>
                                    <CardDescription>
                                        {line.producedQuantity} {line.unit}
                                        {line.holdTimeMinutes ? ` · ventana ${line.holdTimeMinutes} min` : ""}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <p className="text-sm text-muted-foreground">
                                        Todavía se puede vender. Sácalo primero.
                                    </p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar descarte</DialogTitle>
                        <DialogDescription>
                            {target?.recipeName} — se produjeron {target?.producedQuantity} {target?.unit}.
                            Si alcanzó a venderse, confirma con 0 y no se registra merma.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="hold-time-discard-qty">Cantidad tirada</Label>
                        <Input
                            id="hold-time-discard-qty"
                            type="number"
                            min={0}
                            max={target?.producedQuantity ?? undefined}
                            value={discardQty}
                            onChange={(e) => setDiscardQty(Number(e.target.value))}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTarget(null)} disabled={submitting}>
                            Cancelar
                        </Button>
                        <Button onClick={submitDiscard} disabled={submitting}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
