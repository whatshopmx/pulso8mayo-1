"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
    ArrowLeft,
    ChevronDown,
    Download,
    Loader2,
    Plus,
    Save,
    Search,
    ShieldAlert,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageContainer, EmptyState, ErrorState } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";
import { cn } from "@/lib/utils";
import {
    PREGUNTAS_GUARDADAS,
    resolverFiltros,
    type PreguntaGuardada,
} from "./saved-questions";

interface CampoDisponible {
    id: string;
    label: string;
    category: string;
    kind: "boolean" | "number" | "date" | "text";
    sensitive: boolean;
}

interface FilterConfig {
    field: string;
    operator: string;
    value: string;
}

interface Columna {
    id: string;
    label: string;
}

/** Sólo los operadores que el servidor sabe ejecutar. `between` se fue: la UI lo
 *  ofrecía con un único campo de valor y el servidor lo ignoraba en silencio. */
const OPERADORES = [
    { value: "equals", label: "Igual a", requiereValor: true, soloTexto: false },
    { value: "contains", label: "Contiene", requiereValor: true, soloTexto: true },
    { value: "starts_with", label: "Empieza con", requiereValor: true, soloTexto: true },
    { value: "greater_than", label: "Mayor que", requiereValor: true, soloTexto: false },
    { value: "less_than", label: "Menor que", requiereValor: true, soloTexto: false },
    { value: "is_null", label: "Está vacío", requiereValor: false, soloTexto: false },
    { value: "is_not_null", label: "Tiene dato", requiereValor: false, soloTexto: false },
];

const FUENTES = [
    { value: "employees", label: "Empleados" },
    { value: "contracts", label: "Contratos" },
    { value: "documents", label: "Documentos" },
];

interface Resultado {
    titulo: string;
    /** Quién lo generó: una pregunta guardada, una plantilla, o el armado libre. */
    origen: string;
    columns: Columna[];
    rows: Record<string, unknown>[];
    total: number;
    consulta: {
        dataSource: string;
        fields: string[];
        filters: FilterConfig[];
    };
    incluyeSensibles: boolean;
}

async function leerError(res: Response, porDefecto: string) {
    try {
        const cuerpo = await res.json();
        return cuerpo?.error?.message || cuerpo?.error || porDefecto;
    } catch {
        return porDefecto;
    }
}

export default function CustomReportBuilder() {
    const { selectedBranchId, branches } = useBranch();

    const [campos, setCampos] = React.useState<CampoDisponible[]>([]);
    const [puedeVerSensibles, setPuedeVerSensibles] = React.useState(false);
    const [cargandoCampos, setCargandoCampos] = React.useState(true);
    const [errorCampos, setErrorCampos] = React.useState<string | null>(null);

    const [dataSource, setDataSource] = React.useState("employees");
    const [selectedFields, setSelectedFields] = React.useState<string[]>([]);
    const [filters, setFilters] = React.useState<FilterConfig[]>([]);
    const [avanzadoAbierto, setAvanzadoAbierto] = React.useState(false);

    const [resultado, setResultado] = React.useState<Resultado | null>(null);
    const [corriendo, setCorriendo] = React.useState<string | null>(null);
    const [errorConsulta, setErrorConsulta] = React.useState<string | null>(null);
    const [exportando, setExportando] = React.useState(false);
    const [confirmarExport, setConfirmarExport] = React.useState(false);

    const [plantillas, setPlantillas] = React.useState<any[]>([]);
    const [cargandoPlantillas, setCargandoPlantillas] = React.useState(true);
    const [guardando, setGuardando] = React.useState(false);
    const [nombrePlantilla, setNombrePlantilla] = React.useState("");

    const resultadoRef = React.useRef<HTMLDivElement>(null);

    const sucursalActiva = React.useMemo(() => {
        if (!selectedBranchId) return "Todas las sucursales";
        return branches.find((b) => b.id === selectedBranchId)?.name ?? "Sucursal seleccionada";
    }, [selectedBranchId, branches]);

    // El catálogo de campos viene del servidor, filtrado por rol. Antes el
    // cliente tenía su propia lista de 17 campos y la consulta devolvía otros
    // ocho: quince columnas salían vacías y el dueño concluía que no tenía los
    // datos capturados.
    const cargarCampos = React.useCallback(async (fuente: string) => {
        setCargandoCampos(true);
        setErrorCampos(null);
        try {
            const res = await fetch(`/api/reports/execute?dataSource=${fuente}`);
            if (!res.ok) throw new Error(await leerError(res, "No se pudieron cargar los campos"));
            const json = await res.json();
            setCampos(json.data.fields);
            setPuedeVerSensibles(json.data.puedeVerSensibles);
        } catch (error: any) {
            setCampos([]);
            setErrorCampos(error?.message || "No se pudieron cargar los campos");
        } finally {
            setCargandoCampos(false);
        }
    }, []);

    const cargarPlantillas = React.useCallback(async () => {
        setCargandoPlantillas(true);
        try {
            const res = await fetch("/api/reports/templates");
            if (!res.ok) throw new Error();
            const json = await res.json();
            setPlantillas(Array.isArray(json.templates) ? json.templates : []);
        } catch {
            setPlantillas([]);
        } finally {
            setCargandoPlantillas(false);
        }
    }, []);

    React.useEffect(() => {
        cargarCampos(dataSource);
    }, [dataSource, cargarCampos]);

    React.useEffect(() => {
        cargarPlantillas();
    }, [cargarPlantillas]);

    const camposPorCategoria = React.useMemo(() => {
        return campos.reduce<Record<string, CampoDisponible[]>>((acc, campo) => {
            (acc[campo.category] ||= []).push(campo);
            return acc;
        }, {});
    }, [campos]);

    const preguntasVisibles = React.useMemo(
        () => PREGUNTAS_GUARDADAS.filter((p) => !p.requiereSensibles || puedeVerSensibles),
        [puedeVerSensibles]
    );

    const ejecutar = React.useCallback(
        async (
            titulo: string,
            consulta: { dataSource: string; fields: string[]; filters: FilterConfig[] },
            claveCarga: string
        ) => {
            setCorriendo(claveCarga);
            setErrorConsulta(null);
            try {
                const res = await fetch("/api/reports/execute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...consulta, branchId: selectedBranchId }),
                });
                if (!res.ok) {
                    throw new Error(await leerError(res, "No se pudo ejecutar la consulta"));
                }
                const json = await res.json();
                const sensibles = consulta.fields.some(
                    (id) => campos.find((c) => c.id === id)?.sensitive
                );
                setResultado({
                    titulo,
                    origen: claveCarga,
                    columns: json.data.columns,
                    rows: json.data.rows,
                    total: json.data.total,
                    consulta,
                    incluyeSensibles: sensibles,
                });
                // El resultado aparece abajo; sin esto el usuario se queda
                // mirando el botón que acaba de presionar sin saber que ya hay
                // algo que leer.
                requestAnimationFrame(() =>
                    resultadoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                );
            } catch (error: any) {
                setResultado(null);
                setErrorConsulta(error?.message || "No se pudo ejecutar la consulta");
            } finally {
                setCorriendo(null);
            }
        },
        [selectedBranchId, campos]
    );

    const correrPregunta = (pregunta: PreguntaGuardada) => {
        ejecutar(
            pregunta.pregunta,
            {
                dataSource: pregunta.dataSource,
                fields: pregunta.fields,
                filters: resolverFiltros(pregunta),
            },
            pregunta.id
        );
    };

    const validarAvanzado = () => {
        if (selectedFields.length === 0) {
            toast.error("Selecciona al menos un campo para el reporte");
            return false;
        }
        for (let i = 0; i < filters.length; i++) {
            const filtro = filters[i];
            const operador = OPERADORES.find((o) => o.value === filtro.operator);
            if (!filtro.field) {
                toast.error(`Falta elegir el campo del filtro #${i + 1}`);
                return false;
            }
            if (operador?.requiereValor && !filtro.value.trim()) {
                toast.error(`Falta el valor del filtro #${i + 1}`);
                return false;
            }
        }
        return true;
    };

    const correrAvanzado = () => {
        if (!validarAvanzado()) return;
        const fuente = FUENTES.find((f) => f.value === dataSource)?.label ?? dataSource;
        ejecutar(`Reporte de ${fuente.toLowerCase()}`, { dataSource, fields: selectedFields, filters }, "avanzado");
    };

    const exportarCsv = async () => {
        if (!resultado) return;
        setExportando(true);
        try {
            const res = await fetch("/api/reports/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...resultado.consulta,
                    branchId: selectedBranchId,
                    format: "csv",
                }),
            });
            if (!res.ok) throw new Error(await leerError(res, "No se pudo exportar el reporte"));

            // El nombre lo manda el servidor en Content-Disposition. Adivinarlo
            // en el cliente fue justo lo que hacía que un JSON terminara
            // guardado como .pdf en la pantalla de reportes.
            const disposition = res.headers.get("Content-Disposition") ?? "";
            const propuesto = /filename="?([^"]+)"?/.exec(disposition)?.[1];
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = propuesto || `reporte-${resultado.consulta.dataSource}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success(`Se exportaron ${resultado.total} registros`);
        } catch (error: any) {
            toast.error(error?.message || "No se pudo exportar el reporte");
        } finally {
            setExportando(false);
            setConfirmarExport(false);
        }
    };

    const guardarPlantilla = async () => {
        if (!resultado) return;
        if (!nombrePlantilla.trim()) {
            toast.error("Ponle un nombre al reporte para guardarlo");
            return;
        }
        setGuardando(true);
        try {
            const res = await fetch("/api/reports/templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: nombrePlantilla.trim(),
                    dataSource: resultado.consulta.dataSource,
                    fields: resultado.consulta.fields,
                    filters: resultado.consulta.filters,
                }),
            });
            if (!res.ok) throw new Error(await leerError(res, "No se pudo guardar el reporte"));
            toast.success(`"${nombrePlantilla.trim()}" quedó guardado`);
            setNombrePlantilla("");
            cargarPlantillas();
        } catch (error: any) {
            toast.error(error?.message || "No se pudo guardar el reporte");
        } finally {
            setGuardando(false);
        }
    };

    const correrPlantilla = (plantilla: any) => {
        const guardados = plantilla.filters?.filters ?? plantilla.filters ?? [];
        ejecutar(
            plantilla.name,
            {
                dataSource: plantilla.dataSource,
                fields: Array.isArray(plantilla.fields) ? plantilla.fields : [],
                filters: Array.isArray(guardados) ? guardados : [],
            },
            `plantilla-${plantilla.id}`
        );
    };

    // Editar el armado libre invalida el resultado que ese armado produjo:
    // dejarlo en pantalla hacía que las columnas nuevas salieran como "—" y
    // pareciera que no hay datos. Un resultado que vino de una pregunta
    // guardada no se toca, porque no es lo que se está editando.
    const invalidarResultado = React.useCallback(() => {
        setResultado((actual) => (actual?.origen === "avanzado" ? null : actual));
    }, []);

    const alCambiarFuente = (valor: string) => {
        setDataSource(valor);
        setSelectedFields([]);
        setFilters([]);
        setResultado(null);
        setErrorConsulta(null);
    };

    const alternarCampo = (id: string) => {
        setSelectedFields((prev) =>
            prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
        );
        invalidarResultado();
    };

    const seleccionarCategoria = (categoria: string, todos: boolean) => {
        const ids = camposPorCategoria[categoria].map((c) => c.id);
        setSelectedFields((prev) =>
            todos
                ? Array.from(new Set([...prev, ...ids]))
                : prev.filter((id) => !ids.includes(id))
        );
    };

    const campoDe = (id: string) => campos.find((c) => c.id === id);

    return (
        <PageContainer>
            <PageHeader
                title="Reportes personalizados"
                description="Preguntas frecuentes listas para correr, y armado libre para lo que no está en la lista."
                icon={Search}
                actions={
                    <Button asChild variant="outline">
                        <Link href="/dashboard/reports">
                            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                            Regresar
                        </Link>
                    </Button>
                }
            />

            {/* Alcance heredado del encabezado del dashboard, mostrado donde se
                usa. No es un control: duplicar el selector fue el origen de que
                la pantalla y la descarga dijeran cosas distintas. */}
            <p className="text-sm text-muted-foreground">
                Los resultados se limitan a{" "}
                <span className="font-medium text-foreground">{sucursalActiva}</span>. Cámbialo
                desde el selector de sucursal del encabezado.
            </p>

            <section aria-labelledby="preguntas-titulo" className="space-y-3">
                <div>
                    <h2 id="preguntas-titulo" className="text-lg font-semibold">
                        ¿Qué necesitas saber?
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Cada una corre al instante sobre los datos de tu empresa.
                    </p>
                </div>

                {cargandoCampos ? (
                    <div className="divide-y rounded-lg border">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center justify-between gap-4 p-4">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-64" />
                                    <Skeleton className="h-3 w-80" />
                                </div>
                                <Skeleton className="h-9 w-24 shrink-0" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {preguntasVisibles.map((pregunta) => (
                            <li
                                key={pregunta.id}
                                className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0">
                                    <p className="font-medium text-pretty">{pregunta.pregunta}</p>
                                    <p className="text-sm text-muted-foreground text-pretty">
                                        {pregunta.devuelve}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    className="h-11 shrink-0 sm:w-auto"
                                    onClick={() => correrPregunta(pregunta)}
                                    disabled={Boolean(corriendo)}
                                >
                                    {corriendo === pregunta.id ? (
                                        <>
                                            <Loader2
                                                className="h-4 w-4 mr-2 animate-spin"
                                                aria-hidden="true"
                                            />
                                            Consultando…
                                        </>
                                    ) : (
                                        "Ver resultados"
                                    )}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Reportes guardados: el POST existía desde antes, pero nada leía el
                GET, así que lo que el usuario guardaba era irrecuperable. */}
            {(cargandoPlantillas || plantillas.length > 0) && (
                <section aria-labelledby="guardados-titulo" className="space-y-3">
                    <h2 id="guardados-titulo" className="text-lg font-semibold">
                        Tus reportes guardados
                    </h2>
                    {cargandoPlantillas ? (
                        <Skeleton className="h-16 w-full rounded-lg" />
                    ) : (
                        <ul className="divide-y rounded-lg border">
                            {plantillas.map((plantilla) => (
                                <li
                                    key={plantilla.id}
                                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium">{plantilla.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {FUENTES.find((f) => f.value === plantilla.dataSource)?.label ??
                                                plantilla.dataSource}
                                            {" · "}
                                            {Array.isArray(plantilla.fields) ? plantilla.fields.length : 0} campos
                                        </p>
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="h-11 shrink-0"
                                        onClick={() => correrPlantilla(plantilla)}
                                        disabled={Boolean(corriendo)}
                                    >
                                        {corriendo === `plantilla-${plantilla.id}` ? (
                                            <>
                                                <Loader2
                                                    className="h-4 w-4 mr-2 animate-spin"
                                                    aria-hidden="true"
                                                />
                                                Consultando…
                                            </>
                                        ) : (
                                            "Ver resultados"
                                        )}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {/* Armado libre. Sigue estando completo, pero deja de ser lo primero
                que ve alguien que sólo quería saber a quién se le vencieron los
                papeles. */}
            <Collapsible open={avanzadoAbierto} onOpenChange={setAvanzadoAbierto}>
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="h-11 w-full justify-between px-4">
                        <span className="font-medium">Armar un reporte desde cero</span>
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 transition-transform",
                                avanzadoAbierto && "rotate-180"
                            )}
                            aria-hidden="true"
                        />
                    </Button>
                </CollapsibleTrigger>

                <CollapsibleContent className="pt-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Reporte a la medida</CardTitle>
                            <CardDescription>
                                Elige la fuente, marca las columnas que quieres y acota con filtros.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2 sm:max-w-xs">
                                <Label htmlFor="fuente-datos">Fuente de datos</Label>
                                <Select value={dataSource} onValueChange={alCambiarFuente}>
                                    <SelectTrigger id="fuente-datos" className="h-11">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FUENTES.map((fuente) => (
                                            <SelectItem key={fuente.value} value={fuente.value}>
                                                {fuente.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {errorCampos ? (
                                <ErrorState
                                    message={errorCampos}
                                    onRetry={() => cargarCampos(dataSource)}
                                />
                            ) : cargandoCampos ? (
                                <div className="space-y-3">
                                    <Skeleton className="h-4 w-40" />
                                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                                        {[0, 1, 2, 3, 4, 5].map((i) => (
                                            <Skeleton key={i} className="h-11 w-full" />
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <fieldset className="space-y-5">
                                    <legend className="text-sm font-medium">
                                        Columnas del reporte
                                        <span className="ml-2 font-normal text-muted-foreground">
                                            {selectedFields.length} seleccionadas
                                        </span>
                                    </legend>

                                    {Object.entries(camposPorCategoria).map(([categoria, lista]) => {
                                        const todosPuestos = lista.every((c) =>
                                            selectedFields.includes(c.id)
                                        );
                                        return (
                                            <div key={categoria} className="space-y-2">
                                                <div className="flex items-center justify-between gap-3">
                                                    <h4 className="text-sm font-semibold text-foreground">
                                                        {categoria}
                                                    </h4>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8"
                                                        onClick={() =>
                                                            seleccionarCategoria(categoria, !todosPuestos)
                                                        }
                                                    >
                                                        {todosPuestos ? "Quitar todos" : "Marcar todos"}
                                                    </Button>
                                                </div>
                                                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                                                    {lista.map((campo) => (
                                                        <div
                                                            key={campo.id}
                                                            className="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50"
                                                        >
                                                            <Checkbox
                                                                id={`campo-${campo.id}`}
                                                                checked={selectedFields.includes(campo.id)}
                                                                onCheckedChange={() => alternarCampo(campo.id)}
                                                            />
                                                            <label
                                                                htmlFor={`campo-${campo.id}`}
                                                                className="flex-1 cursor-pointer select-none truncate text-sm"
                                                                title={campo.label}
                                                            >
                                                                {campo.label}
                                                            </label>
                                                            {campo.sensitive && (
                                                                <ShieldAlert
                                                                    className="h-4 w-4 shrink-0 text-muted-foreground"
                                                                    aria-label="Dato sensible"
                                                                />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </fieldset>
                            )}

                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="text-sm font-medium">Filtros</h4>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-9"
                                        onClick={() => {
                                            setFilters((prev) => [
                                                ...prev,
                                                { field: "", operator: "equals", value: "" },
                                            ]);
                                            invalidarResultado();
                                        }}
                                    >
                                        <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                                        Agregar filtro
                                    </Button>
                                </div>

                                {filters.length === 0 ? (
                                    <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                                        Sin filtros: el reporte trae todos los registros.
                                    </p>
                                ) : (
                                    <ul className="space-y-3">
                                        {filters.map((filtro, index) => {
                                            const campo = campoDe(filtro.field);
                                            const operador = OPERADORES.find(
                                                (o) => o.value === filtro.operator
                                            );
                                            const operadoresValidos = OPERADORES.filter(
                                                (o) => !o.soloTexto || !campo || campo.kind === "text"
                                            );
                                            return (
                                                <li
                                                    key={index}
                                                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                                                >
                                                    <div className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`filtro-campo-${index}`}
                                                            className="text-xs"
                                                        >
                                                            Campo
                                                        </Label>
                                                        <Select
                                                            value={filtro.field}
                                                            onValueChange={(value) => {
                                                                setFilters((prev) =>
                                                                    prev.map((f, i) =>
                                                                        i === index
                                                                            ? { ...f, field: value, value: "" }
                                                                            : f
                                                                    )
                                                                );
                                                                invalidarResultado();
                                                            }}
                                                        >
                                                            <SelectTrigger
                                                                id={`filtro-campo-${index}`}
                                                                className="h-11"
                                                            >
                                                                <SelectValue placeholder="Elegir campo" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {campos.map((c) => (
                                                                    <SelectItem key={c.id} value={c.id}>
                                                                        {c.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <div className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`filtro-operador-${index}`}
                                                            className="text-xs"
                                                        >
                                                            Condición
                                                        </Label>
                                                        <Select
                                                            value={filtro.operator}
                                                            onValueChange={(value) => {
                                                                setFilters((prev) =>
                                                                    prev.map((f, i) =>
                                                                        i === index ? { ...f, operator: value } : f
                                                                    )
                                                                );
                                                                invalidarResultado();
                                                            }}
                                                        >
                                                            <SelectTrigger
                                                                id={`filtro-operador-${index}`}
                                                                className="h-11"
                                                            >
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {operadoresValidos.map((op) => (
                                                                    <SelectItem key={op.value} value={op.value}>
                                                                        {op.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <div className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`filtro-valor-${index}`}
                                                            className="text-xs"
                                                        >
                                                            Valor
                                                        </Label>
                                                        <Input
                                                            id={`filtro-valor-${index}`}
                                                            className="h-11"
                                                            type={campo?.kind === "date" ? "date" : "text"}
                                                            placeholder={
                                                                operador?.requiereValor ? "Valor" : "No aplica"
                                                            }
                                                            value={filtro.value}
                                                            onChange={(e) => {
                                                                setFilters((prev) =>
                                                                    prev.map((f, i) =>
                                                                        i === index
                                                                            ? { ...f, value: e.target.value }
                                                                            : f
                                                                    )
                                                                );
                                                                invalidarResultado();
                                                            }}
                                                            disabled={!operador?.requiereValor}
                                                        />
                                                    </div>

                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="h-11 w-11 p-0 justify-self-end"
                                                        onClick={() => {
                                                            setFilters((prev) =>
                                                                prev.filter((_, i) => i !== index)
                                                            );
                                                            invalidarResultado();
                                                        }}
                                                    >
                                                        <X className="h-4 w-4" aria-hidden="true" />
                                                        <span className="sr-only">
                                                            Quitar el filtro {index + 1}
                                                        </span>
                                                    </Button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            <Button
                                className="h-11 w-full sm:w-auto"
                                onClick={correrAvanzado}
                                disabled={Boolean(corriendo) || cargandoCampos}
                            >
                                {corriendo === "avanzado" ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                                        Consultando…
                                    </>
                                ) : (
                                    "Ver resultados"
                                )}
                            </Button>
                        </CardContent>
                    </Card>
                </CollapsibleContent>
            </Collapsible>

            {/* Resultados */}
            <div ref={resultadoRef} aria-live="polite" className="scroll-mt-6">
                {errorConsulta ? (
                    <Card>
                        <CardContent className="pt-6">
                            <ErrorState message={errorConsulta} />
                        </CardContent>
                    </Card>
                ) : resultado ? (
                    <Card>
                        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                                <CardTitle className="text-base text-pretty">
                                    {resultado.titulo}
                                </CardTitle>
                                <CardDescription>
                                    {resultado.total === 0
                                        ? "Sin registros"
                                        : `${resultado.total} ${
                                              resultado.total === 1 ? "registro" : "registros"
                                          }`}{" "}
                                    · {sucursalActiva}
                                </CardDescription>
                            </div>
                            {resultado.total > 0 && (
                                <Button
                                    variant="outline"
                                    className="h-11 shrink-0"
                                    onClick={() =>
                                        resultado.incluyeSensibles
                                            ? setConfirmarExport(true)
                                            : exportarCsv()
                                    }
                                    disabled={exportando}
                                >
                                    {exportando ? (
                                        <>
                                            <Loader2
                                                className="h-4 w-4 mr-2 animate-spin"
                                                aria-hidden="true"
                                            />
                                            Exportando…
                                        </>
                                    ) : (
                                        <>
                                            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                                            Exportar CSV
                                        </>
                                    )}
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {resultado.total === 0 ? (
                                <EmptyState
                                    icon={Search}
                                    title="Ningún registro cumple esta condición"
                                    description="Es un resultado válido: por ahora no hay nada que atender aquí."
                                />
                            ) : (
                                <>
                                    <div className="max-h-[28rem] overflow-auto rounded-lg border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    {resultado.columns.map((col) => (
                                                        <TableHead key={col.id}>{col.label}</TableHead>
                                                    ))}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {resultado.rows.map((row, index) => (
                                                    <TableRow key={index}>
                                                        {resultado.columns.map((col) => (
                                                            <TableCell key={col.id}>
                                                                {formatearCelda(row[col.id])}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
                                        <div className="flex-1 space-y-1.5">
                                            <Label htmlFor="nombre-plantilla" className="text-xs">
                                                Guardar esta consulta para volver a correrla
                                            </Label>
                                            <Input
                                                id="nombre-plantilla"
                                                className="h-11"
                                                placeholder="Ej: Documentos vencidos — Reforma"
                                                value={nombrePlantilla}
                                                onChange={(e) => setNombrePlantilla(e.target.value)}
                                            />
                                        </div>
                                        <Button
                                            variant="secondary"
                                            className="h-11"
                                            onClick={guardarPlantilla}
                                            disabled={guardando || !nombrePlantilla.trim()}
                                        >
                                            {guardando ? (
                                                <>
                                                    <Loader2
                                                        className="h-4 w-4 mr-2 animate-spin"
                                                        aria-hidden="true"
                                                    />
                                                    Guardando…
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                                                    Guardar
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                ) : null}
            </div>

            {/* Exportar datos sensibles deja de ser un clic indistinguible de
                cualquier otro: nombra lo que va a salir y cuántos registros. */}
            <AlertDialog open={confirmarExport} onOpenChange={setConfirmarExport}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Vas a exportar datos personales</AlertDialogTitle>
                        <AlertDialogDescription>
                            El archivo incluye {resultado?.total ?? 0}{" "}
                            {resultado?.total === 1 ? "registro" : "registros"} con columnas
                            sensibles:{" "}
                            {resultado?.consulta.fields
                                .map((id) => campoDe(id))
                                .filter((c) => c?.sensitive)
                                .map((c) => c!.label)
                                .join(", ")}
                            . Queda registrado quién lo exportó y cuándo.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={exportarCsv}>Exportar de todas formas</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageContainer>
    );
}

function formatearCelda(valor: unknown) {
    if (valor === null || valor === undefined || valor === "") return "—";
    if (typeof valor === "boolean") return valor ? "Sí" : "No";
    const texto = String(valor);
    // Fechas ISO completas: en una tabla operativa la hora sólo estorba.
    if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) return texto.slice(0, 10);
    return texto;
}
