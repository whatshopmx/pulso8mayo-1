"use client"

import * as React from "react"
import { format } from "date-fns"
import {
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts"
import {
    Clock,
    DollarSign,
    AlertCircle,
    Users,
    RefreshCw,
    Download,
    Search,
    ShieldAlert,
    ShieldCheck,
    AlertTriangle,
    Layers,
    FileCheck,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { OvertimeRequestsClient } from "@/app/dashboard/labor/overtime/requests/overtime-requests-client"
import { toast } from "sonner"

// Paleta institucional sobria alineada a DESIGN.md (Flat, sin gradientes, accesible en claro/oscuro)
const CHART_COLORS = {
    diurnal: "#dc2626", // Operational Red (2x)
    nocturnal: "#4f46e5", // Indigo (3x)
    holiday: "#d97706", // Amber (3x)
    weekly: "#2563eb", // Blue (2x)
}

interface OvertimeDashboardProps {
    branchId?: string
    userRole?: string
    initialData?: {
        data: any[]
        summary: any
    }
}

export function OvertimeDashboard({ branchId, userRole, initialData }: OvertimeDashboardProps) {
    const [activeTab, setActiveTab] = React.useState("analytics")
    const [reports, setReports] = React.useState<any[]>(initialData?.data || [])
    const [summary, setSummary] = React.useState<any>(initialData?.summary || null)
    const [loading, setLoading] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [simulationHours, setSimulationHours] = React.useState<number>(48)

    // Fechas por defecto: Quincena en curso
    const getInitialDates = () => {
        const now = new Date()
        const y = now.getFullYear()
        const m = now.getMonth()
        const day = now.getDate()

        if (day <= 15) {
            const start = new Date(y, m, 1)
            const end = new Date(y, m, 15)
            return {
                start: format(start, "yyyy-MM-dd"),
                end: format(end, "yyyy-MM-dd"),
            }
        } else {
            const start = new Date(y, m, 16)
            const end = new Date(y, m + 1, 0)
            return {
                start: format(start, "yyyy-MM-dd"),
                end: format(end, "yyyy-MM-dd"),
            }
        }
    }

    const [startDate, setStartDate] = React.useState(() => getInitialDates().start)
    const [endDate, setEndDate] = React.useState(() => getInitialDates().end)

    const fetchReport = React.useCallback(async (start = startDate, end = endDate, simHours = simulationHours) => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ startDate: start, endDate: end })
            if (branchId) {
                params.append("branchId", branchId)
            }
            if (simHours && simHours !== 48) {
                params.append("simulationHours", String(simHours))
            }
            const response = await fetch(`/api/reports/overtime?${params.toString()}`)
            if (!response.ok) throw new Error("Error al cargar reporte")
            const result = await response.json()
            setReports(result.data || [])
            setSummary(result.summary || null)
        } catch (error) {
            console.error("Error fetching overtime report:", error)
            toast.error("Error al cargar el reporte de overtime")
        } finally {
            setLoading(false)
        }
    }, [startDate, endDate, branchId, simulationHours])

    // Carga automática en montaje y ante cambios de periodo, sucursal o jornada simulada
    React.useEffect(() => {
        fetchReport(startDate, endDate, simulationHours)
    }, [fetchReport, startDate, endDate, simulationHours])

    // Presets quincenales y mensuales
    const setPreset = (type: "this-fortnight" | "prev-fortnight" | "last-30") => {
        const now = new Date()
        const y = now.getFullYear()
        const m = now.getMonth()
        const day = now.getDate()

        let start: Date
        let end: Date

        if (type === "this-fortnight") {
            if (day <= 15) {
                start = new Date(y, m, 1)
                end = new Date(y, m, 15)
            } else {
                start = new Date(y, m, 16)
                end = new Date(y, m + 1, 0)
            }
        } else if (type === "prev-fortnight") {
            if (day <= 15) {
                // Quincena anterior es del 16 al fin del mes anterior
                start = new Date(y, m - 1, 16)
                end = new Date(y, m, 0)
            } else {
                // Quincena anterior es del 1 al 15 del mes actual
                start = new Date(y, m, 1)
                end = new Date(y, m, 15)
            }
        } else {
            // Últimos 30 días
            end = now
            start = new Date()
            start.setDate(now.getDate() - 30)
        }

        const startStr = format(start, "yyyy-MM-dd")
        const endStr = format(end, "yyyy-MM-dd")
        setStartDate(startStr)
        setEndDate(endStr)
    }

    const formatMinutes = (minutes: number) => {
        if (!minutes || minutes <= 0) return "0h 0m"
        const hours = Math.floor(minutes / 60)
        const mins = Math.round(minutes % 60)
        return `${hours}h ${mins}m`
    }

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("es-MX", {
            style: "currency",
            currency: "MXN",
            maximumFractionDigits: 2,
        }).format(amount || 0)
    }

    // Exportar CSV
    const exportCSV = () => {
        if (!reports.length) {
            toast.error("No hay datos para exportar")
            return
        }

        const headers = [
            "Colaborador",
            "Sucursal",
            "Horas Regulares",
            "Diurnas (2x)",
            "Nocturnas (3x)",
            "Festivo (3x)",
            simulationHours !== 48 ? `Semanales (${simulationHours}h)` : "Semanales (2x)",
            "Total Overtime",
            "Costo Estimado MXN",
            "Estado LFT",
        ]

        const rows = reports.map((r) => [
            `"${r.userName || "N/A"}"`,
            `"${r.branchName || "N/A"}"`,
            `"${formatMinutes(r.regularMinutes)}"`,
            `"${formatMinutes(r.overtimeMinutes?.diurnal || 0)}"`,
            `"${formatMinutes(r.overtimeMinutes?.nocturnal || 0)}"`,
            `"${formatMinutes(r.overtimeMinutes?.holiday || 0)}"`,
            `"${formatMinutes(r.overtimeMinutes?.weekly || 0)}"`,
            `"${formatMinutes(r.totalOvertimeMinutes || 0)}"`,
            `"${r.estimatedCostMXN || 0}"`,
            `"${r.lftStatus || "NORMAL"}"`,
        ])

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.setAttribute("href", url)
        link.setAttribute(
            "download",
            `horas-extras_${startDate}_${endDate}${simulationHours !== 48 ? `_sim-${simulationHours}h` : ""}.csv`
        )
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        toast.success("Reporte CSV descargado con éxito")
    }

    // Filtrado en vivo de colaboradores
    const filteredReports = React.useMemo(() => {
        if (!searchQuery.trim()) return reports
        const q = searchQuery.toLowerCase()
        return reports.filter(
            (r) =>
                r.userName?.toLowerCase().includes(q) ||
                r.branchName?.toLowerCase().includes(q)
        )
    }, [reports, searchQuery])

    // Datos para gráfica de pastel
    const overtimeByTypeData = React.useMemo(() => {
        if (!summary?.overtimeByType) return []
        return [
            { name: "Diurnas (2x)", value: summary.overtimeByType.diurnal, color: CHART_COLORS.diurnal },
            { name: "Nocturnas (3x)", value: summary.overtimeByType.nocturnal, color: CHART_COLORS.nocturnal },
            { name: "Festivo (3x)", value: summary.overtimeByType.holiday, color: CHART_COLORS.holiday },
            { name: "Semanales (2x)", value: summary.overtimeByType.weekly, color: CHART_COLORS.weekly },
        ].filter((d) => d.value > 0)
    }, [summary])

    // Datos para gráfica Top 10
    const topOvertimeEmployees = React.useMemo(() => {
        return reports
            .filter((r) => r.totalOvertimeMinutes > 0)
            .sort((a, b) => b.totalOvertimeMinutes - a.totalOvertimeMinutes)
            .slice(0, 10)
            .map((r) => {
                const parts = (r.userName || "Colaborador").trim().split(" ")
                const shortName = parts[0] + (parts[1] ? ` ${parts[1][0]}.` : "")
                return {
                    name: shortName,
                    fullName: r.userName,
                    hours: Math.round((r.totalOvertimeMinutes / 60) * 10) / 10,
                    diurnal: Math.round(((r.overtimeMinutes?.diurnal || 0) / 60) * 10) / 10,
                    nocturnal: Math.round(((r.overtimeMinutes?.nocturnal || 0) / 60) * 10) / 10,
                }
            })
    }, [reports])

    return (
        <div className="space-y-6">
            {/* Header Principal */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                        Dashboard de Horas Extras
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Supervisión de sobrecostos, incidencias y cumplimiento legal LFT
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={exportCSV}
                        disabled={loading || reports.length === 0}
                        className="h-8 text-xs gap-1.5"
                    >
                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        Exportar CSV
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => fetchReport()}
                        disabled={loading}
                        className="h-8 text-xs gap-1.5"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                        {loading ? "Actualizando..." : "Actualizar"}
                    </Button>
                </div>
            </div>

            {/* Pestañas de Navegación Operativa */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-3">
                    <TabsList className="bg-muted/60 p-1">
                        <TabsTrigger value="analytics" className="text-xs sm:text-sm gap-2">
                            <Layers className="h-4 w-4" />
                            Monitoreo y Distribución LFT
                        </TabsTrigger>
                        <TabsTrigger value="requests" className="text-xs sm:text-sm gap-2">
                            <FileCheck className="h-4 w-4" />
                            Solicitudes y Aprobaciones
                        </TabsTrigger>
                    </TabsList>

                    {/* Barra de Filtros Integrada (Solo en tab de analítica) */}
                    {activeTab === "analytics" && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-md border text-xs">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => setPreset("this-fortnight")}
                                >
                                    Esta Quincena
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => setPreset("prev-fortnight")}
                                >
                                    Quincena Anterior
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => setPreset("last-30")}
                                >
                                    30 Días
                                </Button>
                            </div>

                            {/* Selector de Jornada LFT / Simulador Reforma */}
                            <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-md border text-xs">
                                <span className="text-muted-foreground px-1 font-medium flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Jornada:
                                </span>
                                <Button
                                    variant={simulationHours === 48 ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-6 px-2 text-xs font-mono"
                                    onClick={() => setSimulationHours(48)}
                                >
                                    48h (Vigente)
                                </Button>
                                <Button
                                    variant={simulationHours === 46 ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-6 px-2 text-xs font-mono"
                                    onClick={() => setSimulationHours(46)}
                                >
                                    46h (2027)
                                </Button>
                                <Button
                                    variant={simulationHours === 44 ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-6 px-2 text-xs font-mono"
                                    onClick={() => setSimulationHours(44)}
                                >
                                    44h (2028)
                                </Button>
                                <Button
                                    variant={simulationHours === 40 ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-6 px-2 text-xs font-mono"
                                    onClick={() => setSimulationHours(40)}
                                >
                                    40h (2030)
                                </Button>
                            </div>

                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Input
                                    type="date"
                                    className="h-8 w-32 text-xs bg-card"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                                <span>a</span>
                                <Input
                                    type="date"
                                    className="h-8 w-32 text-xs bg-card"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* TAB 1: ANALÍTICA Y DISTRIBUCIÓN LFT */}
                <TabsContent value="analytics" className="space-y-6 pt-4">
                    {/* Banner de Simulación de Reforma LFT */}
                    {summary?.simulation?.isSimulated && (
                        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-4 text-xs sm:text-sm text-foreground space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2 font-semibold text-indigo-500">
                                    <Layers className="h-4 w-4" />
                                    <span>Simulador Presupuestal Reforma Laboral LFT (Jornada {simulationHours}h Semanales)</span>
                                </div>
                                <Badge variant="outline" className="border-indigo-500/30 text-indigo-500 font-mono text-[11px] self-start sm:self-auto">
                                    Proyección Ley 40h Art. 123
                                </Badge>
                            </div>
                            <p className="text-muted-foreground text-xs leading-relaxed">
                                Evaluando el impacto financiero si tu restaurante redujera la jornada semanal ordinaria de <span className="font-semibold text-foreground">48h</span> a <span className="font-semibold text-foreground">{simulationHours}h</span> manteniendo los turnos y asistencia de tu plantilla actual.
                            </p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-indigo-500/15">
                                <div>
                                    <span className="text-[11px] text-muted-foreground block">Sobrecosto Estimado</span>
                                    <span className="font-mono font-bold text-sm text-indigo-500">
                                        +{formatCurrency(summary.simulation.deltaCostMXN)}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] text-muted-foreground block">Incremento en Nómina Extra</span>
                                    <span className="font-mono font-bold text-sm text-indigo-500">
                                        +{summary.simulation.percentIncrease}%
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] text-muted-foreground block">Horas Extras Nuevas</span>
                                    <span className="font-mono font-bold text-sm">
                                        +{summary.simulation.additionalOvertimeHours}h
                                    </span>
                                </div>
                                <div>
                                    <span className="text-[11px] text-muted-foreground block">Costo Total Proyectado</span>
                                    <span className="font-mono font-bold text-sm">
                                        {formatCurrency(summary.simulation.simulatedCostMXN)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tarjetas KPI de Resumen */}
                    {loading && !summary ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {[1, 2, 3, 4].map((i) => (
                                <Card key={i} className="p-4 space-y-2">
                                    <Skeleton className="h-4 w-28" />
                                    <Skeleton className="h-8 w-36" />
                                    <Skeleton className="h-3 w-44" />
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {/* Card 1: Costo Estimado */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-xs font-medium text-muted-foreground">
                                        Costo Estimado Horas Extra
                                    </CardTitle>
                                    <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
                                            {formatCurrency(summary?.totalEstimatedCostMXN || 0)}
                                        </span>
                                        {summary?.simulation?.isSimulated && summary.simulation.deltaCostMXN > 0 && (
                                            <Badge variant="outline" className="text-[11px] font-mono border-indigo-500/30 text-indigo-500">
                                                +{formatCurrency(summary.simulation.deltaCostMXN)} vs 48h
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {formatMinutes(summary?.totalOvertimeMinutes || 0)} acumuladas en el período
                                    </p>
                                </CardContent>
                            </Card>

                            {/* Card 2: Horas Extra vs Regulares */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-xs font-medium text-muted-foreground">
                                        Horas Extra Totales
                                    </CardTitle>
                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
                                            {formatMinutes(summary?.totalOvertimeMinutes || 0)}
                                        </span>
                                        {summary?.simulation?.isSimulated && summary.simulation.additionalOvertimeHours > 0 && (
                                            <Badge variant="outline" className="text-[11px] font-mono border-indigo-500/30 text-indigo-500">
                                                +{summary.simulation.additionalOvertimeHours}h por reforma
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {summary?.totalRegularMinutes > 0
                                            ? Math.round(
                                                  (summary.totalOvertimeMinutes /
                                                      (summary.totalRegularMinutes + summary.totalOvertimeMinutes)) *
                                                      100
                                              )
                                            : 0}
                                        % sobre tiempo total laborado
                                    </p>
                                </CardContent>
                            </Card>

                            {/* Card 3: Semáforo LFT Tope 9h */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-xs font-medium text-muted-foreground">
                                        Cumplimiento LFT (Tope 9h)
                                    </CardTitle>
                                    {summary?.employeesExceedingLimit > 0 ? (
                                        <ShieldAlert className="h-4 w-4 text-destructive" />
                                    ) : (
                                        <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                    )}
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold tracking-tight">
                                        {summary?.employeesExceedingLimit > 0 ? (
                                            <span className="text-destructive font-bold">
                                                {summary.employeesExceedingLimit} en riesgo
                                            </span>
                                        ) : summary?.employeesNearLimit > 0 ? (
                                            <span className="text-amber-600 dark:text-amber-400 font-bold">
                                                {summary.employeesNearLimit} en alerta
                                            </span>
                                        ) : (
                                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                                100% en norma
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {summary?.employeesExceedingLimit > 0
                                            ? "Exceden tope legal de 9h semanales (Art. 68)"
                                            : "Todos los colaboradores dentro del límite legal"}
                                    </p>
                                </CardContent>
                            </Card>

                            {/* Card 4: Plantilla Involucrada */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-xs font-medium text-muted-foreground">
                                        Colaboradores Involucrados
                                    </CardTitle>
                                    <Users className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold tracking-tight">
                                        {summary?.employeesWithOvertime || 0} de {summary?.totalEmployees || 0}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {summary?.totalEmployees > 0
                                            ? Math.round(
                                                  (summary.employeesWithOvertime / summary.totalEmployees) * 100
                                              )
                                            : 0}
                                        % de la plantilla con horas extra
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    )}

                    {/* Gráficas Normalizadas (Sin gradientes, escala mínima 12px) */}
                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Distribución por Tipo de Overtime */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base font-semibold">Distribución por Tipo LFT</CardTitle>
                                <CardDescription className="text-xs">
                                    Proporción de horas según recargo de Ley (2x y 3x)
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {loading && !summary ? (
                                    <Skeleton className="h-[250px] w-full rounded-md" />
                                ) : overtimeByTypeData.length === 0 ? (
                                    <div className="h-[250px] flex items-center justify-center text-xs text-muted-foreground">
                                        Sin horas extras registradas en este período
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <PieChart>
                                            <Pie
                                                data={overtimeByTypeData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={50}
                                                outerRadius={80}
                                                paddingAngle={2}
                                                dataKey="value"
                                                nameKey="name"
                                            >
                                                {overtimeByTypeData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value: any) => [`${formatMinutes(Number(value))}`, "Horas"]}
                                                contentStyle={{
                                                    backgroundColor: "hsl(var(--card))",
                                                    borderColor: "hsl(var(--border))",
                                                    color: "hsl(var(--card-foreground))",
                                                    borderRadius: "8px",
                                                    fontSize: "12px",
                                                }}
                                            />
                                            <Legend
                                                wrapperStyle={{ fontSize: "12px" }}
                                                formatter={(value, entry: any) => (
                                                    <span className="text-xs text-foreground font-medium">
                                                        {value} ({formatMinutes(entry.payload.value)})
                                                    </span>
                                                )}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        {/* Top 10 con Más Horas Extras */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base font-semibold">Top 10 Hotspots de Horas Extra</CardTitle>
                                <CardDescription className="text-xs">
                                    Colaboradores con mayor acumulación de jornada extraordinaria
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {loading && !summary ? (
                                    <Skeleton className="h-[250px] w-full rounded-md" />
                                ) : topOvertimeEmployees.length === 0 ? (
                                    <div className="h-[250px] flex items-center justify-center text-xs text-muted-foreground">
                                        Sin registros de horas extras para mostrar
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={topOvertimeEmployees}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                                                tickLine={false}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                                                tickLine={false}
                                                unit="h"
                                            />
                                            <Tooltip
                                                formatter={(value: any, name: any) => [`${value} hrs`, name]}
                                                contentStyle={{
                                                    backgroundColor: "hsl(var(--card))",
                                                    borderColor: "hsl(var(--border))",
                                                    color: "hsl(var(--card-foreground))",
                                                    borderRadius: "8px",
                                                    fontSize: "12px",
                                                }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: "12px" }} />
                                            <Bar dataKey="diurnal" fill={CHART_COLORS.diurnal} name="Diurnas (2x)" stackId="a" radius={[0, 0, 0, 0]} />
                                            <Bar dataKey="nocturnal" fill={CHART_COLORS.nocturnal} name="Nocturnas (3x)" stackId="a" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Tabla de Detalle por Colaborador */}
                    <Card>
                        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
                            <div>
                                <CardTitle className="text-base font-semibold">Detalle por Colaborador y Nómina</CardTitle>
                                <CardDescription className="text-xs">
                                    Desglose granular de tiempo extraordinario, cálculo de costo estimado y estado LFT
                                </CardDescription>
                            </div>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar por colaborador..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 h-8 text-xs bg-card"
                                />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                                            <TableHead className="text-xs font-semibold">Colaborador</TableHead>
                                            <TableHead className="text-xs font-semibold">Sucursal</TableHead>
                                            <TableHead className="text-right text-xs font-semibold">Regulares</TableHead>
                                            <TableHead className="text-right text-xs font-semibold">Diurnas (2x)</TableHead>
                                            <TableHead className="text-right text-xs font-semibold">Nocturnas (3x)</TableHead>
                                            <TableHead className="text-right text-xs font-semibold">Festivo (3x)</TableHead>
                                            <TableHead className="text-right text-xs font-semibold">
                                                {simulationHours !== 48 ? `Semanales (${simulationHours}h)` : "Semanales (2x)"}
                                            </TableHead>
                                            <TableHead className="text-right text-xs font-semibold">Total Overtime</TableHead>
                                            <TableHead className="text-right text-xs font-semibold">Costo Estimado</TableHead>
                                            <TableHead className="text-center text-xs font-semibold">Cumplimiento LFT</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loading && reports.length === 0 ? (
                                            [1, 2, 3].map((i) => (
                                                <TableRow key={i}>
                                                    <TableCell colSpan={10} className="py-3">
                                                        <Skeleton className="h-5 w-full" />
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : filteredReports.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={10} className="text-center py-8 text-xs text-muted-foreground">
                                                    No se encontraron registros de horas extras para el período y filtro seleccionados
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            filteredReports.map((report) => (
                                                <TableRow key={report.userId} className="hover:bg-muted/30 transition-colors">
                                                    <TableCell className="font-medium text-xs">
                                                        <div>{report.userName}</div>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {report.branchName || "—"}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                                                        {formatMinutes(report.regularMinutes)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                                        {formatMinutes(report.overtimeMinutes?.diurnal)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                                        {formatMinutes(report.overtimeMinutes?.nocturnal)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                                        {formatMinutes(report.overtimeMinutes?.holiday)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums">
                                                        {formatMinutes(report.overtimeMinutes?.weekly)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums font-semibold">
                                                        {report.totalOvertimeMinutes > 0 ? (
                                                            formatMinutes(report.totalOvertimeMinutes)
                                                        ) : (
                                                            <span className="text-muted-foreground font-normal">0h 0m</span>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono text-xs tabular-nums font-medium text-emerald-700 dark:text-emerald-400">
                                                        {report.estimatedCostMXN > 0 ? formatCurrency(report.estimatedCostMXN) : "—"}
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        {report.lftStatus === "CRITICAL" ? (
                                                            <Badge variant="destructive" className="text-[11px] font-medium gap-1 py-0.5">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                Excede 9h (+3x)
                                                            </Badge>
                                                        ) : report.lftStatus === "WARNING" ? (
                                                            <Badge className="text-[11px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 py-0.5">
                                                                Próximo al límite
                                                            </Badge>
                                                        ) : report.totalOvertimeMinutes > 0 ? (
                                                            <span className="text-xs text-muted-foreground font-medium">
                                                                En norma
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground/60">—</span>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Ficha de Cumplimiento Normativo LFT */}
                    <Card className="border-border bg-card">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 text-primary" />
                                Marco Legal Mexicano: Horas Extras según la Ley Federal del Trabajo (LFT)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3 sm:grid-cols-2 text-xs text-muted-foreground">
                            <div className="p-3 bg-muted/40 rounded-md space-y-1 border">
                                <div className="font-semibold text-foreground">Horas Extras Diurnas (2x) — Art. 68 LFT</div>
                                <p>
                                    Trabajadas tras la jornada ordinaria en horario de 6:00 a 22:00. Se pagan con un 100% de recargo sobre el salario ordinario.
                                </p>
                            </div>
                            <div className="p-3 bg-muted/40 rounded-md space-y-1 border">
                                <div className="font-semibold text-foreground">Horas Extras Nocturnas y Festivos (3x) — Art. 69 y 73 LFT</div>
                                <p>
                                    Laboradas en jornada nocturna (22:00 a 6:00) o en días de descanso obligatorio / festivos. Pago obligatorio al 200% adicional.
                                </p>
                            </div>
                            <div className="p-3 bg-muted/40 rounded-md space-y-1 border sm:col-span-2">
                                <div className="font-semibold text-foreground">Tope Legal Semanal de 9 Horas — Art. 66 y 68 (Párrafo 2°)</div>
                                <p>
                                    La LFT prohíbe que el tiempo extraordinario exceda de 3 horas diarias ni de 3 veces en una semana (máximo 9 horas semanales al 2x). Las horas que excedan este tope se deben liquidar al 200% más (3x) y exponen a la empresa a sanciones de la Secretaría del Trabajo (STPS).
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* TAB 2: SOLICITUDES Y APROBACIONES */}
                <TabsContent value="requests" className="pt-4">
                    <OvertimeRequestsClient branchId={branchId} userRole={userRole} />
                </TabsContent>
            </Tabs>
        </div>
    )
}
