"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    FileText,
    Download,
    Calendar,
    Loader2,
    BarChart3,
    Shield,
    MoreVertical,
    Trash2,
    Play,
    Search,
} from "lucide-react";
import {
    format,
    startOfMonth,
    endOfMonth,
    subMonths,
    subDays,
    startOfYear,
} from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { PageHeader, PageContainer, EmptyState, ErrorState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { REPORTES, CATEGORIAS, GRUPOS_CATEGORIA, type FormatoReporte } from "./report-catalog";

interface ReporteProgramado {
    id: string;
    name?: string;
    dataSource?: string;
    schedule?: { frequency?: string; time?: string; format?: string };
    nextRunAt?: string | null;
    lastRunAt?: string | null;
    lastRunStatus?: string | null;
}

type PresetPeriodo = "THIS_MONTH" | "LAST_MONTH" | "LAST_30_DAYS" | "THIS_YEAR" | "ALL_TIME" | "CUSTOM";

const ETIQUETA_PRESET: Record<PresetPeriodo, string> = {
    THIS_MONTH: "Este mes",
    LAST_MONTH: "Mes anterior",
    LAST_30_DAYS: "Últimos 30 días",
    THIS_YEAR: "Año en curso",
    ALL_TIME: "Todo el historial",
    CUSTOM: "Personalizado",
};

function calcularRango(preset: PresetPeriodo): { from: string; to: string } {
    const hoy = new Date();
    switch (preset) {
        case "THIS_MONTH":
            return {
                from: format(startOfMonth(hoy), "yyyy-MM-dd"),
                to: format(hoy, "yyyy-MM-dd"),
            };
        case "LAST_MONTH": {
            const mesAnt = subMonths(hoy, 1);
            return {
                from: format(startOfMonth(mesAnt), "yyyy-MM-dd"),
                to: format(endOfMonth(mesAnt), "yyyy-MM-dd"),
            };
        }
        case "LAST_30_DAYS":
            return {
                from: format(subDays(hoy, 30), "yyyy-MM-dd"),
                to: format(hoy, "yyyy-MM-dd"),
            };
        case "THIS_YEAR":
            return {
                from: format(startOfYear(hoy), "yyyy-MM-dd"),
                to: format(hoy, "yyyy-MM-dd"),
            };
        case "ALL_TIME":
        case "CUSTOM":
            return { from: "", to: "" };
    }
}

const ETIQUETA_FRECUENCIA: Record<string, string> = {
    DAILY: "Diaria",
    WEEKLY: "Semanal",
    MONTHLY: "Mensual",
};

function fechaCorta(valor?: string | null) {
    if (!valor) return null;
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return null;
    return format(fecha, "d 'de' MMM, HH:mm", { locale: es });
}

export default function ReportsPage() {
    const { selectedBranchId, branches } = useBranch();

    const [generando, setGenerando] = useState<string | null>(null);
    const [programados, setProgramados] = useState<ReporteProgramado[]>([]);
    const [cargandoProgramados, setCargandoProgramados] = useState(true);
    const [errorProgramados, setErrorProgramados] = useState<string | null>(null);
    const [categoria, setCategoria] = useState("ALL");
    const [busqueda, setBusqueda] = useState("");

    // Gestión de eliminación de reportes programados
    const [reporteAEliminar, setReporteAEliminar] = useState<ReporteProgramado | null>(null);
    const [eliminando, setEliminando] = useState(false);

    // Período de descarga
    const [presetPeriodo, setPresetPeriodo] = useState<PresetPeriodo>("THIS_MONTH");
    const [rangoFechas, setRangoFechas] = useState<{ from: string; to: string }>(() =>
        calcularRango("THIS_MONTH")
    );

    const handlePresetChange = (nuevoPreset: PresetPeriodo) => {
        setPresetPeriodo(nuevoPreset);
        if (nuevoPreset !== "CUSTOM") {
            setRangoFechas(calcularRango(nuevoPreset));
        } else {
            const hoy = format(new Date(), "yyyy-MM-dd");
            const haceTreinta = format(subDays(new Date(), 30), "yyyy-MM-dd");
            setRangoFechas({ from: haceTreinta, to: hoy });
        }
    };

    const etiquetaPeriodo = useMemo(() => {
        return ETIQUETA_PRESET[presetPeriodo];
    }, [presetPeriodo]);

    const sucursalActiva = useMemo(() => {
        if (!selectedBranchId) return "Todas las sucursales";
        return branches.find((b) => b.id === selectedBranchId)?.name ?? "Sucursal seleccionada";
    }, [selectedBranchId, branches]);

    const cargarProgramados = useCallback(async () => {
        setCargandoProgramados(true);
        setErrorProgramados(null);
        try {
            const res = await fetch("/api/reports/scheduled");
            if (!res.ok) throw new Error("No se pudieron cargar los reportes programados");
            const json = await res.json();
            setProgramados(Array.isArray(json) ? json : json?.reports ?? []);
        } catch (error: any) {
            setProgramados([]);
            setErrorProgramados(error?.message || "No se pudieron cargar los reportes programados");
        } finally {
            setCargandoProgramados(false);
        }
    }, []);

    useEffect(() => {
        cargarProgramados();
    }, [cargarProgramados]);

    const eliminarProgramacion = async () => {
        if (!reporteAEliminar) return;
        setEliminando(true);
        try {
            const res = await fetch(`/api/reports/scheduled/${reporteAEliminar.id}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("No se pudo eliminar el reporte programado");
            setProgramados((prev) => prev.filter((p) => p.id !== reporteAEliminar.id));
            toast.success(`"${reporteAEliminar.name || "Reporte"}" eliminado de la programación`);
            setReporteAEliminar(null);
        } catch (error: any) {
            toast.error(error?.message || "Error al eliminar reporte");
        } finally {
            setEliminando(false);
        }
    };

    const generar = async (reporteId: string, nombre: string, formato: FormatoReporte) => {
        setGenerando(`${reporteId}:${formato}`);
        try {
            const res = await fetch("/api/reports/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reportId: reporteId,
                    format: formato,
                    branchId: selectedBranchId || undefined,
                    dateFrom: rangoFechas.from || undefined,
                    dateTo: rangoFechas.to || undefined,
                }),
            });

            if (!res.ok) {
                let mensaje = "No se pudo generar el reporte";
                try {
                    const data = await res.json();
                    mensaje = data?.error || mensaje;
                } catch {
                    /* respuesta sin cuerpo JSON */
                }
                throw new Error(mensaje);
            }

            const tipo = res.headers.get("Content-Type") ?? "";
            if (tipo.includes("application/json")) {
                let mensaje = "El servidor no devolvió un archivo.";
                try {
                    const data = await res.json();
                    mensaje = data?.error || mensaje;
                } catch {
                    /* respuesta sin cuerpo JSON */
                }
                throw new Error(mensaje);
            }

            const disposition = res.headers.get("Content-Disposition") ?? "";
            const propuesto = /filename="?([^"]+)"?/.exec(disposition)?.[1];
            const extension = formato === "Excel" ? "xlsx" : "pdf";
            const respaldo = `${nombre.replace(/[^a-zA-Z0-9À-ɏ\s-]/g, "").replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.${extension}`;

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = propuesto || respaldo;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            const detallePeriodo = presetPeriodo === "ALL_TIME"
                ? "todo el historial"
                : `${etiquetaPeriodo.toLowerCase()}`;
            toast.success(`${nombre} descargado en ${formato} (${detallePeriodo})`);
        } catch (error: unknown) {
            const mensaje = error instanceof Error ? error.message : "No se pudo generar el reporte";
            toast.error(mensaje);
        } finally {
            setGenerando(null);
        }
    };

    const visibles = useMemo(() => {
        return REPORTES.filter((r) => {
            const coincideCat = categoria === "ALL" || GRUPOS_CATEGORIA[categoria]?.includes(r.category);
            if (!coincideCat) return false;
            if (!busqueda.trim()) return true;
            const q = busqueda.toLowerCase();
            return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
        });
    }, [categoria, busqueda]);

    return (
        <PageContainer>
            <PageHeader
                title="Reportes"
                description="Descarga el reporte que necesitas, o prográmalo para que llegue solo."
                icon={FileText}
                actions={
                    <Button asChild variant="default">
                        <Link href="/dashboard/reports/custom">
                            <FileText className="h-4 w-4 mr-2" aria-hidden="true" />
                            Reportes personalizados
                        </Link>
                    </Button>
                }
            />

            {/* Barra de alcance y selector de período */}
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                        <Calendar className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                            Período de descarga:{" "}
                            <span className="font-semibold text-primary">{etiquetaPeriodo}</span>
                            {" · "}
                            <span className="font-normal text-muted-foreground">{sucursalActiva}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {rangoFechas.from && rangoFechas.to
                                ? `${format(new Date(rangoFechas.from + "T00:00:00"), "d 'de' MMMM", { locale: es })} al ${format(new Date(rangoFechas.to + "T00:00:00"), "d 'de' MMMM yyyy", { locale: es })}`
                                : "Sin filtro de fecha: incluye todo el historial"}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Select value={presetPeriodo} onValueChange={(val: PresetPeriodo) => handlePresetChange(val)}>
                        <SelectTrigger className="h-10 w-44 text-xs font-medium" aria-label="Seleccionar período de reporte">
                            <SelectValue placeholder="Elegir período" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="THIS_MONTH">Este mes</SelectItem>
                            <SelectItem value="LAST_MONTH">Mes anterior</SelectItem>
                            <SelectItem value="LAST_30_DAYS">Últimos 30 días</SelectItem>
                            <SelectItem value="THIS_YEAR">Año en curso</SelectItem>
                            <SelectItem value="ALL_TIME">Todo el historial</SelectItem>
                            <SelectItem value="CUSTOM">Rango personalizado</SelectItem>
                        </SelectContent>
                    </Select>

                    {presetPeriodo === "CUSTOM" && (
                        <div className="flex items-center gap-1.5">
                            <Input
                                type="date"
                                className="h-10 w-36 text-xs"
                                value={rangoFechas.from}
                                onChange={(e) => setRangoFechas((prev) => ({ ...prev, from: e.target.value }))}
                                aria-label="Fecha inicial de reporte"
                            />
                            <span className="text-xs text-muted-foreground">a</span>
                            <Input
                                type="date"
                                className="h-10 w-36 text-xs"
                                value={rangoFechas.to}
                                onChange={(e) => setRangoFechas((prev) => ({ ...prev, to: e.target.value }))}
                                aria-label="Fecha final de reporte"
                            />
                        </div>
                    )}
                </div>
            </div>

            {!selectedBranchId && (
                <Card>
                    <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <p className="font-medium text-pretty">
                                ¿Cuál de tus sucursales va atrasada?
                            </p>
                            <p className="text-sm text-muted-foreground text-pretty">
                                Los reportes de abajo entregan un total de toda la cadena. Para
                                comparar sucursal contra sucursal y ver el ranking, usa el
                                comparativo de desempeño.
                            </p>
                        </div>
                        <Button asChild variant="outline" className="h-11 shrink-0">
                            <Link href="/dashboard/analytics/branches">
                                <BarChart3 className="h-4 w-4 mr-2" aria-hidden="true" />
                                Comparar sucursales
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Tabs value={categoria} onValueChange={setCategoria} className="w-full sm:w-auto">
                        <TabsList className="flex w-full flex-wrap justify-start gap-1 sm:w-auto">
                            {CATEGORIAS.map((cat) => (
                                <TabsTrigger key={cat.id} value={cat.id}>
                                    {cat.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>

                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            type="search"
                            placeholder="Buscar reporte…"
                            className="h-10 pl-9 text-xs"
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            aria-label="Buscar en catálogo de reportes"
                        />
                    </div>
                </div>

                {visibles.length === 0 ? (
                    <EmptyState
                        icon={FileText}
                        title="No se encontraron reportes"
                        description="Intenta buscar con otros términos o cambia la categoría seleccionada."
                    />
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {visibles.map((reporte) => {
                            const proximamente = Boolean(reporte.comingSoon);
                            return (
                                <Card key={reporte.id} className={proximamente ? "opacity-70" : undefined}>
                                    <CardHeader>
                                        <div className="flex items-start justify-between gap-3">
                                            <CardTitle className="text-base text-pretty">
                                                {reporte.name}
                                            </CardTitle>
                                            {reporte.official && (
                                                <Badge className="shrink-0 bg-info text-info-foreground">
                                                    <Shield className="h-3 w-3 mr-1" aria-hidden="true" />
                                                    Oficial
                                                </Badge>
                                            )}
                                            {proximamente && (
                                                <Badge variant="secondary" className="shrink-0">
                                                    Próximamente
                                                </Badge>
                                            )}
                                        </div>
                                        <CardDescription className="text-pretty">
                                            {reporte.description}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        {proximamente ? (
                                            <p className="text-sm text-muted-foreground">
                                                Todavía no está disponible para descarga.
                                            </p>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {reporte.formats.map((formato) => {
                                                    const estaGenerando =
                                                        generando === `${reporte.id}:${formato}`;
                                                    return (
                                                        <Button
                                                            key={formato}
                                                            variant="outline"
                                                            className="h-11 flex-1"
                                                            disabled={estaGenerando}
                                                            onClick={() =>
                                                                generar(reporte.id, reporte.name, formato)
                                                            }
                                                        >
                                                            {estaGenerando ? (
                                                                <Loader2
                                                                    className="h-4 w-4 animate-spin mr-1"
                                                                    aria-hidden="true"
                                                                />
                                                            ) : (
                                                                <Download
                                                                    className="h-4 w-4 mr-1"
                                                                    aria-hidden="true"
                                                                />
                                                            )}
                                                            <span aria-hidden="true">{formato}</span>
                                                            <span className="sr-only">
                                                                {estaGenerando
                                                                    ? `Generando ${reporte.name} en ${formato} para ${etiquetaPeriodo}`
                                                                    : `Descargar ${reporte.name} en ${formato} para ${etiquetaPeriodo}`}
                                                            </span>
                                                        </Button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Calendar className="h-5 w-5" aria-hidden="true" />
                        Reportes programados
                    </CardTitle>
                    <CardDescription>
                        Se generan y envían solos. Aquí ves cuándo llegó el último y cuándo llega el
                        siguiente.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {cargandoProgramados ? (
                        <div className="space-y-3" aria-live="polite">
                            <span className="sr-only">Cargando reportes programados</span>
                            {[0, 1].map((i) => (
                                <Skeleton key={i} className="h-20 w-full rounded-lg" />
                            ))}
                        </div>
                    ) : errorProgramados ? (
                        <ErrorState message={errorProgramados} onRetry={cargarProgramados} />
                    ) : programados.length === 0 ? (
                        <EmptyState
                            icon={Calendar}
                            title="No hay reportes programados"
                            description="Programa uno y te llega por correo sin que tengas que entrar."
                            action={{
                                label: "Programar un reporte",
                                href: "/dashboard/reports/schedule",
                            }}
                        />
                    ) : (
                        <ul className="divide-y rounded-lg border">
                            {programados.map((reporte) => {
                                const sched = reporte.schedule ?? {};
                                const frecuencia = sched.frequency
                                    ? ETIQUETA_FRECUENCIA[sched.frequency] ?? sched.frequency
                                    : null;
                                const ultimo = fechaCorta(reporte.lastRunAt);
                                const siguiente = fechaCorta(reporte.nextRunAt);
                                const fallo = reporte.lastRunStatus === "FAILED";
                                const formatoSched = (sched.format === "Excel" || sched.format === "EXCEL" ? "Excel" : "PDF") as FormatoReporte;

                                return (
                                    <li
                                        key={reporte.id}
                                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-medium text-pretty">
                                                    {reporte.name || "Reporte programado"}
                                                </p>
                                                {fallo ? (
                                                    <Badge variant="destructive" className="shrink-0 text-xs">
                                                        Falló el último envío
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="shrink-0 text-xs">
                                                        Activo
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                {[frecuencia, sched.time, sched.format]
                                                    .filter(Boolean)
                                                    .join(" · ") || "Sin configuración de envío"}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                {ultimo ? `Último: ${ultimo}` : "Todavía no se ha enviado"}
                                                {siguiente ? ` · Siguiente: ${siguiente}` : ""}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9"
                                                onClick={() =>
                                                    generar(
                                                        reporte.dataSource || "workflow-summary",
                                                        reporte.name || "Reporte",
                                                        formatoSched
                                                    )
                                                }
                                                disabled={generando === `${reporte.dataSource || "workflow-summary"}:${formatoSched}`}
                                            >
                                                {generando === `${reporte.dataSource || "workflow-summary"}:${formatoSched}` ? (
                                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                                                ) : (
                                                    <Play className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                                                )}
                                                Descargar ahora
                                            </Button>

                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-9 w-9">
                                                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                                                        <span className="sr-only">Opciones de {reporte.name}</span>
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            generar(
                                                                reporte.dataSource || "workflow-summary",
                                                                reporte.name || "Reporte",
                                                                formatoSched
                                                            )
                                                        }
                                                    >
                                                        <Download className="h-4 w-4 mr-2" />
                                                        Generar archivo ahora
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        className="text-destructive focus:text-destructive"
                                                        onClick={() => setReporteAEliminar(reporte)}
                                                    >
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Eliminar programación
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    <Button variant="outline" className="h-11 w-full" asChild>
                        <Link href="/dashboard/reports/schedule">
                            <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
                            Programar nuevo reporte
                        </Link>
                    </Button>
                </CardContent>
            </Card>

            {/* Confirmación para eliminar reporte programado */}
            <AlertDialog open={Boolean(reporteAEliminar)} onOpenChange={(open) => !open && setReporteAEliminar(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar reporte programado?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se cancelarán los envíos periódicos de &quot;{reporteAEliminar?.name}&quot;. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={eliminando}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={eliminarProgramacion}
                            disabled={eliminando}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {eliminando ? "Eliminando…" : "Eliminar programación"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageContainer>
    );
}
