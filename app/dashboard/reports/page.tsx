"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    FileText,
    Download,
    Calendar,
    Loader2,
    BarChart3,
    Shield,
} from "lucide-react";
import { format } from "date-fns";
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

    const sucursalActiva = useMemo(() => {
        if (!selectedBranchId) return "Todas las sucursales";
        return branches.find((b) => b.id === selectedBranchId)?.name ?? "Sucursal seleccionada";
    }, [selectedBranchId, branches]);

    const cargarProgramados = useCallback(async () => {
        setCargandoProgramados(true);
        setErrorProgramados(null);
        try {
            const res = await fetch("/api/reports/scheduled");
            // `res.ok` explícito: antes un 500 se resolvía a `null`, se guardaba
            // como lista vacía y la pantalla decía "No hay reportes programados"
            // a alguien cuyo envío semanal lleva medio año corriendo.
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

    const generar = async (reporteId: string, nombre: string, formato: FormatoReporte) => {
        setGenerando(`${reporteId}:${formato}`);
        try {
            const res = await fetch("/api/reports/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reportId: reporteId,
                    format: formato,
                    branchId: selectedBranchId,
                }),
            });

            if (!res.ok) {
                let mensaje = "No se pudo generar el reporte";
                try {
                    mensaje = (await res.json())?.error || mensaje;
                } catch {
                    /* respuesta sin cuerpo JSON */
                }
                throw new Error(mensaje);
            }

            // Un archivo se reconoce por lo que el servidor dice que es. Adivinar
            // la extensión en el cliente fue lo que hacía que un JSON de error
            // terminara guardado como .pdf y anunciado como éxito.
            const tipo = res.headers.get("Content-Type") ?? "";
            if (tipo.includes("application/json")) {
                throw new Error("El servidor no devolvió un archivo. Vuelve a intentar.");
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
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success(`${nombre} descargado en ${formato}`);
        } catch (error: any) {
            toast.error(error?.message || "No se pudo generar el reporte");
        } finally {
            setGenerando(null);
        }
    };

    const visibles = REPORTES.filter(
        (r) => categoria === "ALL" || GRUPOS_CATEGORIA[categoria]?.includes(r.category)
    );

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

            {/* El alcance vive en el encabezado del dashboard. Esta pantalla tenía
                su propio selector de sucursal y su propio rango de fechas, y era
                el suyo el que mandaba: el encabezado podía decir "Reforma"
                mientras la descarga traía toda la cadena. */}
            <p className="text-sm text-muted-foreground">
                Los reportes se generan para{" "}
                <span className="font-medium text-foreground">{sucursalActiva}</span>. Cámbialo
                desde el selector de sucursal del encabezado.
            </p>

            {/* Cada reporte del catálogo entrega una sucursal o todas fundidas en
                un total. La pregunta que llega el dueño de ocho sucursales —cuál
                de todas va atrasada— la contesta la comparativa, que ya existe y
                que esta pantalla nunca mencionaba. */}
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

            <Tabs value={categoria} onValueChange={setCategoria}>
                {/* `grid-cols-5` fijo cortaba "Cumplimiento" en iPad vertical. */}
                <TabsList className="flex w-full flex-wrap justify-start gap-1 sm:grid sm:grid-cols-5">
                    {CATEGORIAS.map((cat) => (
                        <TabsTrigger key={cat.id} value={cat.id}>
                            {cat.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={categoria} className="mt-6">
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
                                                            disabled={Boolean(generando)}
                                                            onClick={() =>
                                                                generar(reporte.id, reporte.name, formato)
                                                            }
                                                        >
                                                            {estaGenerando ? (
                                                                <Loader2
                                                                    className="h-4 w-4 animate-spin"
                                                                    aria-hidden="true"
                                                                />
                                                            ) : (
                                                                <Download
                                                                    className="h-4 w-4 mr-1"
                                                                    aria-hidden="true"
                                                                />
                                                            )}
                                                            <span aria-hidden="true">{formato}</span>
                                                            {/* El nombre del reporte va en el
                                                                nombre accesible: 27 botones que
                                                                sólo dicen "PDF" son inservibles
                                                                con lector de pantalla. */}
                                                            <span className="sr-only">
                                                                {estaGenerando
                                                                    ? `Generando ${reporte.name} en ${formato}`
                                                                    : `Descargar ${reporte.name} en ${formato}`}
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
                </TabsContent>
            </Tabs>

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

                                return (
                                    <li
                                        key={reporte.id}
                                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-medium text-pretty">
                                                {reporte.name || "Reporte programado"}
                                            </p>
                                            {/* Sólo lo que el registro dice de verdad. Los
                                                respaldos "07:00" y "PDF" afirmaban una
                                                configuración que nadie había capturado. */}
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
                                        {fallo ? (
                                            <Badge variant="destructive" className="shrink-0">
                                                Falló el último envío
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="shrink-0">
                                                Activo
                                            </Badge>
                                        )}
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
        </PageContainer>
    );
}
