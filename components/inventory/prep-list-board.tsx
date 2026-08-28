"use client";

// Task 6b (plan-loteprod-gaps §6.2) — Hoja de Producción Diaria.
//
// La hoja del manual es una TABLA POR ESTACIÓN: «Preparación | Cant. a producir |
// Lote a usar (FEFO) | Turno | Responsable | Hora límite | Estatus». Aquí se
// respeta esa forma en vez de convertirla en tarjetas: el cocinero la lee de
// arriba abajo buscando lo suyo, y una rejilla de tarjetas obliga a rastrear.
//
// El checkbox de completado NO es un toggle silencioso: completar dispara la
// producción real y descuenta lotes por FEFO. Por eso abre una confirmación que
// muestra exactamente qué lotes va a consumir y deja corregir la cantidad —
// la hoja planea 12 kg, la cocina cierra con lo que salió.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Loader2, Pencil, Plus, TriangleAlert, CloudSun, Flame, CloudRain, Trophy, Sparkles, Check, Filter } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PREP_SHIFT_LABELS, PREP_STATE_LABELS, type PrepLineState } from "@/lib/inventory/prep-list";
import { PrepListLineDialog } from "./prep-list-line-dialog";
import type { WeatherProfile } from "@/lib/inventory/weather-forecast";

export interface PrepFefoPreview {
    itemId: string;
    itemName: string;
    requiredQuantity: number;
    unit: string;
    batchId: string | null;
    lotNumber: string | null;
    expirationDate: string | null;
    allocatedQuantity: number;
    shortfall: number;
}

export interface PrepLine {
    id: string;
    recipeId: string;
    recipeName: string;
    plannedQuantity: number;
    unit: string;
    station: string | null;
    shift: string | null;
    responsibleUserId: string | null;
    responsibleName: string | null;
    deadlineTime: string | null;
    notes: string | null;
    status: string;
    state: PrepLineState;
    completedAt: string | null;
    completedByName: string | null;
    holdTimeMinutes: number | null;
    fefo: PrepFefoPreview[];
}

interface PrepGroup {
    key: string;
    label: string;
    lines: PrepLine[];
    pending: number;
    overdue: number;
    done: number;
    total: number;
}

interface PrepDay {
    date: string;
    timezone: string;
    totals: { total: number; done: number; pending: number; overdue: number };
    groups: PrepGroup[];
}

/** Color del estatus. Nunca sólo color: cada insignia lleva su texto. */
const STATE_VARIANT: Record<PrepLineState, "destructive" | "warning" | "secondary" | "success" | "outline"> = {
    ATRASADA: "destructive",
    POR_VENCER: "warning",
    PENDIENTE: "secondary",
    HECHA: "success",
    CANCELADA: "outline",
};

/** Resumen del lote FEFO de una línea, en una celda que se pueda leer de un vistazo. */
function FefoCell({ fefo }: { fefo: PrepFefoPreview[] }) {
    if (fefo.length === 0) {
        return <span className="text-muted-foreground">—</span>;
    }
    return (
        <ul className="space-y-1">
            {fefo.map((f, i) => (
                <li key={`${f.itemId}-${f.batchId ?? "falta"}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-foreground">{f.itemName}</span>
                    {f.batchId ? (
                        <span className="font-mono text-xs text-muted-foreground">
                            {f.lotNumber || "sin folio"} · {f.allocatedQuantity} {f.unit}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <TriangleAlert className="size-3" aria-hidden="true" />
                            faltan {f.shortfall} {f.unit}
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}

export function PrepListBoard({ branchId }: { branchId: string }) {
    const [day, setDay] = useState<PrepDay | null>(null);
    const [date, setDate] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [target, setTarget] = useState<PrepLine | null>(null);
    const [producedQty, setProducedQty] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<PrepLine | null>(null);
    const [selectedStation, setSelectedStation] = useState<string>("ALL");

    const fetchDay = useCallback(async (targetDate: string | null) => {
        setError(null);
        try {
            const params = new URLSearchParams({ branchId });
            if (targetDate) params.set("date", targetDate);
            const res = await fetch(`/api/inventory/production/prep-list?${params}`);
            const json = await res.json();

            if (!res.ok || !json.success) {
                setDay(null);
                setError(json?.error?.message || "No se pudo cargar la prep list");
                return;
            }
            setDay(json.data);
            // La fecha la fija el servidor con la zona de la sucursal: el
            // navegador del gerente puede estar en otro huso.
            setDate((current) => current ?? json.data.date);
        } catch {
            setDay(null);
            setError("Error de red al cargar la prep list");
        } finally {
            setLoading(false);
        }
    }, [branchId]);

    useEffect(() => {
        setLoading(true);
        fetchDay(date);
    }, [fetchDay, date]);

    const openComplete = (line: PrepLine) => {
        setTarget(line);
        // Prellenado con lo planeado: producir la cantidad de la hoja es el caso normal.
        setProducedQty(line.plannedQuantity);
    };

    const submitComplete = async () => {
        if (!target) return;
        setSubmitting(true);
        try {
            const res = await fetch("/api/inventory/production/prep-list/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: target.id, branchId, producedQuantity: producedQty }),
            });
            const json = await res.json();

            if (!res.ok || !json.success) {
                const code = json?.error?.details?.code;
                if (code === "ALREADY_COMPLETED") {
                    toast.info("Esa línea ya se había completado");
                    setTarget(null);
                    fetchDay(date);
                    return;
                }
                toast.error(json?.error?.message || "No se pudo completar la línea");
                return;
            }

            const faltantes = json.data.shortfalls?.length ?? 0;
            if (faltantes > 0) {
                toast.warning(
                    `${target.recipeName}: producida, pero ${faltantes} insumo(s) no alcanzaron y quedaron como merma`
                );
            } else {
                toast.success(`${target.recipeName} producida — ${json.data.producedQuantity} ${target.unit}`);
            }
            setTarget(null);
            fetchDay(date);
        } catch {
            toast.error("Error al completar la línea");
        } finally {
            setSubmitting(false);
        }
    };

    const openNew = () => {
        setEditing(null);
        setFormOpen(true);
    };

    const openEdit = (line: PrepLine) => {
        setEditing(line);
        setFormOpen(true);
    };

    const [weatherProfile, setWeatherProfile] = useState<WeatherProfile>("NORMAL");

    const visibleGroups = day?.groups.filter(
        (g) => selectedStation === "ALL" || g.key === selectedStation
    ) ?? [];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="prep-list-date">Fecha de la hoja</Label>
                        <Input
                            id="prep-list-date"
                            type="date"
                            className="w-44"
                            value={date ?? ""}
                            onChange={(e) => setDate(e.target.value || null)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="prep-weather-modifier">Factor Clima / Evento MTY</Label>
                        <Select
                            value={weatherProfile}
                            onValueChange={(val) => setWeatherProfile(val as WeatherProfile)}
                        >
                            <SelectTrigger id="prep-weather-modifier" className="w-64">
                                <SelectValue placeholder="Seleccionar clima/evento..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="NORMAL">
                                    <span className="flex items-center gap-2">
                                        <CloudSun className="size-4 text-muted-foreground" /> Día Normal (100% Estándar)
                                    </span>
                                </SelectItem>
                                <SelectItem value="HEATWAVE_MTY">
                                    <span className="flex items-center gap-2">
                                        <Flame className="size-4 text-orange-500" /> Ola de Calor (&gt;40°C Canícula MTY)
                                    </span>
                                </SelectItem>
                                <SelectItem value="RAINY_COLD">
                                    <span className="flex items-center gap-2">
                                        <CloudRain className="size-4 text-blue-500" /> Día Lluvioso / Frente Frío MTY
                                    </span>
                                </SelectItem>
                                <SelectItem value="SPORT_EVENT_MTY">
                                    <span className="flex items-center gap-2">
                                        <Trophy className="size-4 text-amber-500" /> Clásico Regio / Rayados / Tigres
                                    </span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {day && (
                        <p className="text-sm text-muted-foreground" role="status">
                            {day.totals.done} de {day.totals.total} hechas
                            {day.totals.overdue > 0 && (
                                <span className="ml-2 font-medium text-destructive">
                                    · {day.totals.overdue} atrasada{day.totals.overdue === 1 ? "" : "s"}
                                </span>
                            )}
                        </p>
                    )}
                    <Button className="gap-2" onClick={openNew}>
                        <Plus className="size-4" aria-hidden="true" />
                        Nueva línea
                    </Button>
                </div>
            </div>

            {/* Contextual Weather Impact Alert */}
            {weatherProfile !== "NORMAL" && (
                <div className="p-3 bg-card/60 border border-primary/20 rounded-lg flex items-center justify-between text-xs space-x-3">
                    <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-primary shrink-0" />
                        <span>
                            {weatherProfile === "HEATWAVE_MTY" && (
                                <>
                                    <strong>Modificador de Ola de Calor Activado:</strong> Proyección de bebidas frías/hielo <strong>+30%</strong>, caldos y sopas <strong>-20%</strong>, café caliente <strong>-25%</strong>.
                                </>
                            )}
                            {weatherProfile === "RAINY_COLD" && (
                                <>
                                    <strong>Modificador de Lluvia/Frío Activado:</strong> Proyección de caldos/sopas <strong>+30%</strong>, café/chocolate <strong>+35%</strong>, bebidas frías <strong>-25%</strong>.
                                </>
                            )}
                            {weatherProfile === "SPORT_EVENT_MTY" && (
                                <>
                                    <strong>Modificador de Evento Deportivo Activado:</strong> Proyección de cervezas/bebidas <strong>+40%</strong>, alitas/boneless/snacks <strong>+35%</strong>.
                                </>
                            )}
                        </span>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs uppercase shrink-0">
                        Forecast MTY
                    </Badge>
                </div>
            )}

            {/* Station Filter Pills */}
            {day && day.groups.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
                    <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1 shrink-0">
                        <Filter className="size-3.5" />
                        Estación:
                    </span>
                    <Button
                        type="button"
                        variant={selectedStation === "ALL" ? "default" : "outline"}
                        size="sm"
                        className="h-7 text-xs rounded-full px-3"
                        onClick={() => setSelectedStation("ALL")}
                    >
                        Todas ({day.totals.total})
                    </Button>
                    {day.groups.map((group) => (
                        <Button
                            key={group.key}
                            type="button"
                            variant={selectedStation === group.key ? "default" : "outline"}
                            size="sm"
                            className="h-7 text-xs rounded-full px-3 gap-1.5"
                            onClick={() => setSelectedStation(group.key)}
                        >
                            <span>{group.label}</span>
                            <span className={cn(
                                "text-xs px-1.5 py-0.5 rounded-full font-mono",
                                selectedStation === group.key
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                            )}>
                                {group.done}/{group.total}
                            </span>
                            {group.overdue > 0 && (
                                <span className="size-2 rounded-full bg-destructive" title={`${group.overdue} atrasadas`} />
                            )}
                        </Button>
                    ))}
                </div>
            )}

            {loading ? (
                <div className="space-y-3" aria-busy="true" aria-label="Cargando prep list">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                </div>
            ) : error ? (
                <Card>
                    <CardContent className="p-8 text-center" role="alert">
                        <TriangleAlert className="mx-auto mb-4 size-12 text-muted-foreground" aria-hidden="true" />
                        <h3 className="mb-2 text-lg font-semibold">No se pudo cargar la prep list</h3>
                        <p className="mb-4 text-muted-foreground">{error}</p>
                        <Button variant="outline" onClick={() => fetchDay(date)}>Reintentar</Button>
                    </CardContent>
                </Card>
            ) : !day || day.groups.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center">
                        <ClipboardList className="mx-auto mb-4 size-12 text-muted-foreground" aria-hidden="true" />
                        <h3 className="mb-2 text-lg font-semibold">Sin prep list para este día</h3>
                        <p className="mb-4 text-muted-foreground">
                            Arma la hoja de producción: qué se prepara, en qué estación, quién y a qué hora.
                        </p>
                        <Button onClick={openNew} className="gap-2">
                            <Plus className="size-4" aria-hidden="true" />
                            Nueva línea
                        </Button>
                    </CardContent>
                </Card>
            ) : visibleGroups.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-center text-muted-foreground">
                        <p className="text-sm">No hay preparaciones registradas para la estación seleccionada.</p>
                        <Button variant="link" size="sm" onClick={() => setSelectedStation("ALL")} className="mt-2 text-xs">
                            Ver todas las estaciones
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                visibleGroups.map((group) => (
                    <section key={group.key} aria-labelledby={`prep-station-${group.key || "sin-estacion"}`} className="space-y-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3
                                id={`prep-station-${group.key || "sin-estacion"}`}
                                className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                                {group.label}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                {group.done}/{group.total} hechas
                                {group.overdue > 0 && (
                                    <span className="ml-2 font-medium text-destructive">
                                        {group.overdue} atrasada{group.overdue === 1 ? "" : "s"}
                                    </span>
                                )}
                            </p>
                        </div>

                        {/* Vista de Escritorio: Tabla de 9 columnas */}
                        <div className="hidden lg:block overflow-x-auto rounded-lg border bg-card">
                            <table className="w-full text-sm">
                                <caption className="sr-only">
                                    Hoja de producción de la estación {group.label}
                                </caption>
                                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    <tr>
                                        <th scope="col" className="w-10 p-3">
                                            <span className="sr-only">Completar</span>
                                        </th>
                                        <th scope="col" className="p-3 font-medium">Preparación</th>
                                        <th scope="col" className="p-3 font-medium">Cantidad</th>
                                        <th scope="col" className="p-3 font-medium">Lote a usar (FEFO)</th>
                                        <th scope="col" className="p-3 font-medium">Turno</th>
                                        <th scope="col" className="p-3 font-medium">Responsable</th>
                                        <th scope="col" className="p-3 font-medium">Hora límite</th>
                                        <th scope="col" className="p-3 font-medium">Estatus</th>
                                        <th scope="col" className="w-10 p-3">
                                            <span className="sr-only">Editar</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {group.lines.map((line) => {
                                        const cerrada = line.state === "HECHA" || line.state === "CANCELADA";
                                        return (
                                            <tr key={line.id} className={cerrada ? "text-muted-foreground bg-muted/10" : undefined}>
                                                <td className="p-3 align-top">
                                                    <Checkbox
                                                        checked={line.state === "HECHA"}
                                                        disabled={cerrada}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) openComplete(line);
                                                        }}
                                                        aria-label={`Completar ${line.recipeName}`}
                                                    />
                                                </td>
                                                <th scope="row" className="p-3 text-left align-top font-medium">
                                                    {line.recipeName}
                                                    {line.holdTimeMinutes ? (
                                                        <span className="block text-xs font-normal text-muted-foreground">
                                                            {line.holdTimeMinutes} min en línea
                                                        </span>
                                                    ) : null}
                                                </th>
                                                <td className="p-3 align-top whitespace-nowrap">
                                                    {line.plannedQuantity} {line.unit}
                                                </td>
                                                <td className="p-3 align-top">
                                                    <FefoCell fefo={line.fefo} />
                                                </td>
                                                <td className="p-3 align-top whitespace-nowrap">
                                                    {line.shift ? PREP_SHIFT_LABELS[line.shift] ?? line.shift : "—"}
                                                </td>
                                                <td className="p-3 align-top">
                                                    {line.responsibleName || "—"}
                                                    {line.completedByName && (
                                                        <span className="block text-xs text-muted-foreground">
                                                            cerró {line.completedByName}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 align-top whitespace-nowrap tabular-nums font-mono text-xs">
                                                    {line.deadlineTime || "—"}
                                                </td>
                                                <td className="p-3 align-top">
                                                    <Badge variant={STATE_VARIANT[line.state]}>
                                                        {PREP_STATE_LABELS[line.state]}
                                                    </Badge>
                                                </td>
                                                <td className="p-3 align-top">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openEdit(line)}
                                                        aria-label={`Editar ${line.recipeName}`}
                                                    >
                                                        <Pencil className="size-4" aria-hidden="true" />
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Vista Tablet / Móvil: Tarjetas Táctiles de Estación */}
                        <div className="block lg:hidden space-y-3">
                            {group.lines.map((line) => {
                                const cerrada = line.state === "HECHA" || line.state === "CANCELADA";
                                return (
                                    <Card key={line.id} className={cn("transition-colors", cerrada && "opacity-60 bg-muted/20")}>
                                        <CardContent className="p-4 space-y-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <h4 className="font-semibold text-base text-foreground leading-snug">{line.recipeName}</h4>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        <span className="font-medium text-foreground">{line.plannedQuantity} {line.unit}</span>
                                                        {line.shift ? ` · ${PREP_SHIFT_LABELS[line.shift] ?? line.shift}` : ""}
                                                        {line.responsibleName ? ` · ${line.responsibleName}` : ""}
                                                    </p>
                                                </div>
                                                <Badge variant={STATE_VARIANT[line.state]}>
                                                    {PREP_STATE_LABELS[line.state]}
                                                </Badge>
                                            </div>

                                            {line.deadlineTime && (
                                                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-muted/40 px-2.5 py-1 rounded">
                                                    <span className="font-sans font-medium text-foreground">Hora límite:</span>
                                                    <span>{line.deadlineTime}</span>
                                                    {line.holdTimeMinutes ? ` (${line.holdTimeMinutes} min retención)` : ""}
                                                </div>
                                            )}

                                            {line.fefo.length > 0 && (
                                                <div className="bg-muted/30 rounded p-2.5 text-xs border border-border/50">
                                                    <span className="font-medium text-muted-foreground block mb-1.5">Lotes FEFO asignados:</span>
                                                    <FefoCell fefo={line.fefo} />
                                                </div>
                                            )}

                                            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                                                {!cerrada ? (
                                                    <Button
                                                        className="flex-1 gap-2 h-10 text-xs font-medium"
                                                        onClick={() => openComplete(line)}
                                                    >
                                                        <Check className="size-4" />
                                                        Completar ({line.plannedQuantity} {line.unit})
                                                    </Button>
                                                ) : (
                                                    <p className="text-xs text-muted-foreground italic flex-1 py-1">
                                                        Completada{line.completedByName ? ` por ${line.completedByName}` : ""}
                                                    </p>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-10 w-10 shrink-0"
                                                    onClick={() => openEdit(line)}
                                                    aria-label={`Editar ${line.recipeName}`}
                                                >
                                                    <Pencil className="size-4" />
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </section>
                ))
            )}

            <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Completar línea</DialogTitle>
                        <DialogDescription>
                            {target?.recipeName} — se planearon {target?.plannedQuantity} {target?.unit}.
                            Al confirmar se registra la producción y se descuentan los lotes por FEFO.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="prep-produced-qty">Cantidad producida</Label>
                            <Input
                                id="prep-produced-qty"
                                type="number"
                                min={1}
                                value={producedQty}
                                onChange={(e) => setProducedQty(Number(e.target.value))}
                            />
                            <div className="flex gap-1.5 pt-1">
                                {[-5, -1, 1, 5, 10].map((delta) => (
                                    <Button
                                        key={delta}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-xs font-mono"
                                        onClick={() => setProducedQty((q) => Math.max(1, q + delta))}
                                    >
                                        {delta > 0 ? `+${delta}` : delta}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {target && target.fefo.length > 0 && (
                            <div className="space-y-1.5 rounded-md border p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Lotes que se van a consumir
                                </p>
                                <FefoCell fefo={target.fefo} />
                                <p className="text-xs text-muted-foreground">
                                    Calculado para {target.plannedQuantity} {target.unit}; el descuento real
                                    se hace sobre la cantidad que confirmes.
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTarget(null)} disabled={submitting}>
                            Cancelar
                        </Button>
                        <Button onClick={submitComplete} disabled={submitting || producedQty <= 0}>
                            {submitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                            Registrar producción
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PrepListLineDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                branchId={branchId}
                date={day?.date ?? date}
                line={editing}
                onSaved={() => fetchDay(date)}
            />
        </div>
    );
}
