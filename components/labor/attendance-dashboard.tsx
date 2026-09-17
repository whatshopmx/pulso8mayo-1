"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import {
    BarChart,
    Bar,
    Line,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from "recharts"
import {
    Clock,
    TrendingUp,
    CheckCircle2,
    Calendar,
    RefreshCw,
    Building2,
    Users,
    ShieldAlert,
    BarChart3,
    ListFilter,
    Search,
    Loader2
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { AttendanceReport } from "./attendance-report"
import { AttendanceRecord } from "@/app/api/reports/attendance/route"

export type MexicanDatePreset = "hoy" | "esta-quincena" | "quincena-anterior" | "este-mes" | "personalizado"

interface AttendanceSummary {
    totalRecords?: number;
    totalWorkMinutes?: number;
    totalBreakMinutes?: number;
    totalOvertimeMinutes?: number;
    completedShifts?: number;
    activeShifts?: number;
    uniqueEmployees?: number;
}

interface AttendanceDashboardProps {
    initialData?: {
        data: AttendanceRecord[]
        summary: AttendanceSummary
    }
}

interface DailyTrendItem {
    date: string;
    workMinutes: number;
    breakMinutes: number;
    overtimeMinutes: number;
    shifts: number;
    employees: Set<string>;
    workHours?: number;
    avgHours?: number;
    employeeCount?: number;
}

interface EmployeeSummaryItem {
    userId: string;
    name: string;
    role: string;
    branch: string;
    totalWorkMinutes: number;
    totalBreakMinutes: number;
    totalOvertimeMinutes: number;
    shifts: number;
    totalHours?: number;
    avgHoursPerShift?: number;
    overtimeHours?: number;
}

interface BranchSummaryItem {
    branchId: string;
    branchName: string;
    totalWorkMinutes: number;
    totalOvertimeMinutes: number;
    shifts: number;
    employees: Set<string>;
    totalHours?: number;
    overtimeHours?: number;
    employeeCount?: number;
    avgHoursPerEmployee?: number;
}

// Tokens semánticos del sistema Pulso HORECA (OKLCH derivados vía CSS variables)
const CHART_PALETTE = [
    "var(--primary)",
    "var(--chart-3)",
    "var(--chart-2)",
    "var(--chart-4)",
    "var(--chart-6)",
]

/**
 * Calcula fechas y etiquetas de acuerdo a los cortes de nómina quincenal en México.
 * 1ª Quincena: Días 1 al 15.
 * 2ª Quincena: Días 16 al último día del mes.
 */
export function getMexicanPresetDates(preset: MexicanDatePreset, customStart?: string, customEnd?: string, referenceDate?: Date) {
    const now = referenceDate || new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const day = now.getDate()

    const pad = (n: number) => n.toString().padStart(2, "0")
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    if (preset === "hoy") {
        const todayStr = fmt(now)
        return { startDate: todayStr, endDate: todayStr, label: `Hoy (${format(now, "dd/MMM", { locale: es })})` }
    }

    if (preset === "esta-quincena") {
        if (day <= 15) {
            const start = new Date(year, month, 1)
            const end = new Date(year, month, 15)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `1ª Quincena de ${format(now, "MMMM", { locale: es })} (1-15)`
            }
        } else {
            const start = new Date(year, month, 16)
            const end = new Date(year, month + 1, 0)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `2ª Quincena de ${format(now, "MMMM", { locale: es })} (16-${end.getDate()})`
            }
        }
    }

    if (preset === "quincena-anterior") {
        if (day <= 15) {
            const start = new Date(year, month - 1, 16)
            const end = new Date(year, month, 0)
            const prevMonthDate = new Date(year, month - 1, 1)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `2ª Quincena de ${format(prevMonthDate, "MMMM", { locale: es })} (16-${end.getDate()})`
            }
        } else {
            const start = new Date(year, month, 1)
            const end = new Date(year, month, 15)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `1ª Quincena de ${format(now, "MMMM", { locale: es })} (1-15)`
            }
        }
    }

    if (preset === "este-mes") {
        const start = new Date(year, month, 1)
        const end = new Date(year, month + 1, 0)
        return {
            startDate: fmt(start),
            endDate: fmt(end),
            label: `Mes completo de ${format(now, "MMMM yyyy", { locale: es })}`
        }
    }

    // personalizado
    return {
        startDate: customStart || fmt(new Date(year, month, 1)),
        endDate: customEnd || fmt(now),
        label: `Rango personalizado (${customStart || ""} - ${customEnd || ""})`
    }
}

export function AttendanceDashboard({ initialData }: AttendanceDashboardProps) {
    const searchParams = useSearchParams()
    const focusedSessionId = searchParams.get("sessionId")

    const [records, setRecords] = React.useState<AttendanceRecord[]>(initialData?.data || [])
    const [summary, setSummary] = React.useState<AttendanceSummary>(initialData?.summary || {})
    const [datePreset, setDatePreset] = React.useState<MexicanDatePreset>("esta-quincena")
    const [customStartDate, setCustomStartDate] = React.useState("")
    const [customEndDate, setCustomEndDate] = React.useState("")
    const [selectedBranch, setSelectedBranch] = React.useState<string>("all")
    const [searchTerm, setSearchTerm] = React.useState("")
    const [branches, setBranches] = React.useState<Array<{ id: string; name: string }>>([])
    const [loading, setLoading] = React.useState(false)

    // Cálculo del rango activo
    const activeRange = React.useMemo(() => {
        return getMexicanPresetDates(datePreset, customStartDate, customEndDate)
    }, [datePreset, customStartDate, customEndDate])

    const fetchBranches = React.useCallback(async () => {
        try {
            const res = await fetch("/api/branches")
            if (res.ok) {
                const data = await res.json()
                setBranches(data.data || data.branches || data || [])
            }
        } catch (err) {
            console.error("Error fetching branches:", err)
        }
    }, [])

    const fetchAttendance = React.useCallback(async () => {
        try {
            setLoading(true)
            const params = new URLSearchParams({
                startDate: activeRange.startDate,
                endDate: activeRange.endDate
            })
            if (selectedBranch !== "all") {
                params.set("branchId", selectedBranch)
            }

            const res = await fetch(`/api/reports/attendance?${params.toString()}`)
            if (res.ok) {
                const data = await res.json()
                setRecords(data.data || [])
                setSummary(data.summary || {})
            }
        } catch (err) {
            console.error("Error fetching attendance report:", err)
        } finally {
            setLoading(false)
        }
    }, [activeRange.startDate, activeRange.endDate, selectedBranch])

    React.useEffect(() => {
        fetchBranches()
    }, [fetchBranches])

    React.useEffect(() => {
        fetchAttendance()
    }, [fetchAttendance])

    // Análisis de Horas Extraordinarias conforme a la LFT
    const lftOvertimeAnalysis = React.useMemo(() => {
        let doubleOvertimeMinutes = 0
        let tripleOvertimeMinutes = 0
        let employeesExceedingDailyLimit = 0

        records.forEach(r => {
            const extra = r.overtimeMinutes || 0
            if (extra > 0) {
                if (extra <= 180) {
                    doubleOvertimeMinutes += extra
                } else {
                    doubleOvertimeMinutes += 180
                    tripleOvertimeMinutes += (extra - 180)
                    employeesExceedingDailyLimit += 1
                }
            }
        })

        return {
            totalExtraMinutes: doubleOvertimeMinutes + tripleOvertimeMinutes,
            doubleMinutes: doubleOvertimeMinutes,
            tripleMinutes: tripleOvertimeMinutes,
            hasViolations: tripleOvertimeMinutes > 0,
            employeesExceedingDailyLimit
        }
    }, [records])

    // Tendencias diarias para gráficas
    const dailyTrends = React.useMemo(() => {
        const grouped: Record<string, DailyTrendItem> = {}

        records.forEach(record => {
            const date = record.date
            if (!grouped[date]) {
                grouped[date] = {
                    date,
                    workMinutes: 0,
                    breakMinutes: 0,
                    overtimeMinutes: 0,
                    shifts: 0,
                    employees: new Set<string>()
                }
            }
            grouped[date].workMinutes += record.totalWorkMinutes || 0
            grouped[date].breakMinutes += record.breakMinutes || 0
            grouped[date].overtimeMinutes += record.overtimeMinutes || 0
            grouped[date].shifts += 1
            if (record.userId) {
                grouped[date].employees.add(record.userId)
            }
        })

        return Object.values(grouped)
            .map(d => ({
                ...d,
                workHours: Number(((d.workMinutes || 0) / 60).toFixed(1)),
                avgHours: Number(((d.workMinutes || 0) / (d.employees.size || 1) / 60).toFixed(1)),
                employeeCount: d.employees.size
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30)
    }, [records])

    // Resumen por colaborador para gráficas
    const employeeSummary = React.useMemo(() => {
        const grouped: Record<string, EmployeeSummaryItem> = {}

        records.forEach(record => {
            if (!record.userId) return
            if (!grouped[record.userId]) {
                grouped[record.userId] = {
                    userId: record.userId,
                    name: record.userName,
                    role: record.userRole,
                    branch: record.branchName,
                    totalWorkMinutes: 0,
                    totalBreakMinutes: 0,
                    totalOvertimeMinutes: 0,
                    shifts: 0,
                }
            }
            grouped[record.userId].totalWorkMinutes += record.totalWorkMinutes || 0
            grouped[record.userId].totalBreakMinutes += record.breakMinutes || 0
            grouped[record.userId].totalOvertimeMinutes += record.overtimeMinutes || 0
            grouped[record.userId].shifts += 1
        })

        return Object.values(grouped)
            .map(e => ({
                ...e,
                totalHours: Number(((e.totalWorkMinutes || 0) / 60).toFixed(1)),
                avgHoursPerShift: Number(((e.totalWorkMinutes || 0) / (e.shifts || 1) / 60).toFixed(1)),
                overtimeHours: Number(((e.totalOvertimeMinutes || 0) / 60).toFixed(1))
            }))
            .sort((a, b) => (b.totalOvertimeMinutes || 0) - (a.totalOvertimeMinutes || 0))
            .slice(0, 8)
    }, [records])

    // Distribución de estados
    const statusDistribution = React.useMemo(() => {
        const counts: Record<string, number> = {
            COMPLETED: 0,
            ACTIVE: 0,
            MISSED: 0
        }

        records.forEach(record => {
            if (record.status) {
                counts[record.status] = (counts[record.status] || 0) + 1
            }
        })

        return [
            { name: "Completados", value: counts.COMPLETED || 0, color: "var(--chart-3)" },
            { name: "En Turno", value: counts.ACTIVE || 0, color: "var(--primary)" },
            { name: "No Presentado", value: counts.MISSED || 0, color: "var(--destructive)" }
        ].filter(item => item.value > 0)
    }, [records])

    // Comparativa por sucursal
    const branchSummary = React.useMemo(() => {
        const grouped: Record<string, BranchSummaryItem> = {}

        records.forEach(record => {
            const bId = record.branchId || "general"
            if (!grouped[bId]) {
                grouped[bId] = {
                    branchId: bId,
                    branchName: record.branchName || "General",
                    totalWorkMinutes: 0,
                    totalOvertimeMinutes: 0,
                    shifts: 0,
                    employees: new Set<string>()
                }
            }
            grouped[bId].totalWorkMinutes += record.totalWorkMinutes || 0
            grouped[bId].totalOvertimeMinutes += record.overtimeMinutes || 0
            grouped[bId].shifts += 1
            if (record.userId) {
                grouped[bId].employees.add(record.userId)
            }
        })

        return Object.values(grouped)
            .map(b => ({
                ...b,
                totalHours: Number(((b.totalWorkMinutes || 0) / 60).toFixed(1)),
                overtimeHours: Number(((b.totalOvertimeMinutes || 0) / 60).toFixed(1)),
                employeeCount: b.employees.size,
                avgHoursPerEmployee: Number(((b.totalWorkMinutes || 0) / (b.employees.size || 1) / 60).toFixed(1))
            }))
            .sort((a, b) => (b.totalWorkMinutes || 0) - (a.totalWorkMinutes || 0))
    }, [records])

    const formatMinutes = (minutes: number) => {
        const hours = Math.floor(minutes / 60)
        const mins = Math.round(minutes % 60)
        if (hours === 0) return `${mins}m`
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    }

    const totalRecords = records.length
    const completedCount = records.filter(r => r.status === "COMPLETED").length
    const activeCount = records.filter(r => r.status === "ACTIVE").length
    const missedCount = records.filter(r => r.status === "MISSED").length
    const completionRate = totalRecords > 0 ? Math.round((completedCount / totalRecords) * 100) : 0
    const totalWorkMinutes = records.reduce((sum, r) => sum + (r.totalWorkMinutes || 0), 0)
    const avgMinutesPerShift = totalRecords > 0 ? Math.round(totalWorkMinutes / totalRecords) : 0

    return (
        <div className="space-y-5">
            {/* Barra de Control Unificada: Sucursal + Presets Quincenales + Búsqueda + Refresco */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 pb-2">
                <div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">
                        Auditoría de Asistencia y Turnos
                    </h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {activeRange.label} · Control de jornadas, relevos y cumplimiento legal de horas extra (LFT)
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Selector de Sucursal */}
                    <div className="w-40 sm:w-48">
                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                            <SelectTrigger className="h-8 text-xs bg-background">
                                <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                                <SelectValue placeholder="Todas las sucursales" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas las sucursales</SelectItem>
                                {branches.map(b => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Presets Quincenales Mexicanos */}
                    <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
                        <button
                            type="button"
                            onClick={() => setDatePreset("hoy")}
                            className={`h-7 px-2.5 text-xs font-medium rounded transition-colors ${
                                datePreset === "hoy"
                                    ? "bg-background text-foreground shadow-none font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Hoy
                        </button>
                        <button
                            type="button"
                            onClick={() => setDatePreset("esta-quincena")}
                            className={`h-7 px-2.5 text-xs font-medium rounded transition-colors ${
                                datePreset === "esta-quincena"
                                    ? "bg-background text-foreground shadow-none font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Esta Quincena
                        </button>
                        <button
                            type="button"
                            onClick={() => setDatePreset("quincena-anterior")}
                            className={`h-7 px-2.5 text-xs font-medium rounded transition-colors ${
                                datePreset === "quincena-anterior"
                                    ? "bg-background text-foreground shadow-none font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Quincena Anterior
                        </button>
                        <button
                            type="button"
                            onClick={() => setDatePreset("este-mes")}
                            className={`h-7 px-2.5 text-xs font-medium rounded transition-colors ${
                                datePreset === "este-mes"
                                    ? "bg-background text-foreground shadow-none font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Mes
                        </button>
                        <button
                            type="button"
                            onClick={() => setDatePreset("personalizado")}
                            className={`h-7 px-2 text-xs font-medium rounded transition-colors ${
                                datePreset === "personalizado"
                                    ? "bg-background text-foreground shadow-none font-semibold"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            Personalizado
                        </button>
                    </div>

                    {/* Selector de Rango Personalizado */}
                    {datePreset === "personalizado" && (
                        <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                            <Input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="h-8 w-32 text-xs bg-background"
                            />
                            <span className="text-xs text-muted-foreground">a</span>
                            <Input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="h-8 w-32 text-xs bg-background"
                            />
                        </div>
                    )}

                    {/* Búsqueda rápida de Colaborador */}
                    <div className="relative w-36 sm:w-48">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Buscar colaborador..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-8 pl-8 pr-6 text-xs bg-background"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm("")}
                                className="absolute right-2 top-2 text-xs text-muted-foreground hover:text-foreground"
                                aria-label="Limpiar búsqueda"
                            >
                                ×
                            </button>
                        )}
                    </div>

                    {/* Botón de Refrescar */}
                    <Button
                        onClick={fetchAttendance}
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        title="Actualizar datos"
                        disabled={loading}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* KPI Strip Unificado (4 tarjetas esenciales, flat-by-default, sin redundancia) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* 1. Cobertura de Turnos */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Cobertura de Turnos
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                            {loading ? "..." : totalRecords === 0 ? "--" : `${completionRate}%`}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {totalRecords === 0
                                ? "Sin turnos registrados en el período"
                                : `${completedCount} completados · ${activeCount} en curso`}
                        </p>
                    </CardContent>
                </Card>

                {/* 2. Horas Ordinarias */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Horas Trabajadas
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                            {loading ? "..." : totalRecords === 0 ? "0h" : formatMinutes(totalWorkMinutes)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                            {totalRecords === 0
                                ? "Sin actividad registrada"
                                : `${formatMinutes(avgMinutesPerShift)} promedio/turno`}
                        </p>
                    </CardContent>
                </Card>

                {/* 3. Horas Extraordinarias (Semáforo LFT) */}
                <Card className={`border bg-card transition-colors ${
                    lftOvertimeAnalysis.hasViolations
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border"
                }`}>
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Horas Extra (LFT)
                            {lftOvertimeAnalysis.hasViolations ? (
                                <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                            ) : (
                                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className={`text-2xl font-bold tracking-tight font-mono ${
                            lftOvertimeAnalysis.hasViolations
                                ? "text-destructive font-black"
                                : lftOvertimeAnalysis.totalExtraMinutes > 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-foreground"
                        }`}>
                            {loading ? "..." : totalRecords === 0 ? "0h" : formatMinutes(lftOvertimeAnalysis.totalExtraMinutes)}
                        </div>
                        <p className="text-xs mt-0.5 font-medium">
                            {lftOvertimeAnalysis.hasViolations ? (
                                <span className="text-destructive font-semibold">
                                    ⚠️ {formatMinutes(lftOvertimeAnalysis.tripleMinutes)} en Horas Triples (Art. 68 LFT)
                                </span>
                            ) : lftOvertimeAnalysis.totalExtraMinutes > 0 ? (
                                <span className="text-muted-foreground">
                                    ✓ {formatMinutes(lftOvertimeAnalysis.doubleMinutes)} Dobles (Dentro del tope legal)
                                </span>
                            ) : (
                                <span className="text-muted-foreground">✓ Sin tiempo extra registrado</span>
                            )}
                        </p>
                    </CardContent>
                </Card>

                {/* 4. Colaboradores y Ausencias */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Plantilla Auditada
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                            {loading ? "..." : totalRecords === 0 ? "0" : (summary.uniqueEmployees || new Set(records.map(r => r.userId)).size)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {missedCount > 0 ? (
                                <span className="text-destructive font-medium">⚠️ {missedCount} {missedCount === 1 ? "ausencia no justificada" : "ausencias no justificadas"}</span>
                            ) : totalRecords === 0 ? (
                                "Sin colaboradores en el período"
                            ) : (
                                "colaboradores con registro"
                            )}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Estructura conmutada por Pestañas: Auditoría de Turnos vs Tendencias y Nómina */}
            <Tabs defaultValue="attendance" className="w-full space-y-4">
                <TabsList className="h-9 p-1 bg-muted/50 border border-border">
                    <TabsTrigger value="attendance" className="text-xs font-medium flex items-center gap-1.5 px-3">
                        <ListFilter className="h-3.5 w-3.5" />
                        Auditoría de Turnos
                    </TabsTrigger>
                    <TabsTrigger value="analytics" className="text-xs font-medium flex items-center gap-1.5 px-3">
                        <BarChart3 className="h-3.5 w-3.5" />
                        Tendencias y Desviaciones
                    </TabsTrigger>
                </TabsList>

                {/* PESTAÑA 1: Auditoría de Turnos (Tabla Operativa de Relevos y Checadas) */}
                <TabsContent value="attendance" className="space-y-4 m-0">
                    <AttendanceReport
                        records={records}
                        loading={loading}
                        focusedSessionId={focusedSessionId}
                        dateRangeLabel={activeRange.label}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        onRefresh={fetchAttendance}
                    />
                </TabsContent>

                {/* PESTAÑA 2: Tendencias y Desviaciones Analíticas */}
                <TabsContent value="analytics" className="space-y-4 m-0">
                    <div className="grid gap-4 md:grid-cols-2">
                        {/* 1. Evolución Diaria de Horas */}
                        <Card
                            className="col-span-2 border border-border bg-card"
                            role="region"
                            aria-label="Gráfica de tendencia diaria de horas trabajadas"
                            tabIndex={0}
                        >
                            <CardHeader className="p-4 border-b border-border">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    Tendencia Diaria de Horas Trabajadas
                                </CardTitle>
                                <CardDescription className="text-xs text-muted-foreground">
                                    Evolución de horas efectivas totales y promedio por colaborador en el período
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-4">
                                {/* Tabla alternativa accesible para lectores de pantalla */}
                                <div className="sr-only">
                                    <table>
                                        <caption>Resumen de tendencia diaria de horas trabajadas</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">Fecha</th>
                                                <th scope="col">Horas Totales</th>
                                                <th scope="col">Promedio por Colaborador</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dailyTrends.map((d) => (
                                                <tr key={d.date}>
                                                    <td>{d.date}</td>
                                                    <td>{d.workHours}h</td>
                                                    <td>{d.avgHours}h</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {loading ? (
                                    <div className="h-[280px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                        <span className="text-xs">Cargando tendencia diaria...</span>
                                    </div>
                                ) : dailyTrends.length === 0 ? (
                                    <div className="h-[280px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-6 border border-dashed border-border rounded-lg bg-muted/10 text-center">
                                        <Clock className="h-8 w-8 text-muted-foreground/40" />
                                        <p className="text-xs font-semibold text-foreground">Sin registros de horas en el período</p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm">
                                            No se registraron turnos entre el {activeRange.startDate} y {activeRange.endDate}. Selecciona otra quincena o amplía el rango en la barra superior.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="h-[280px] w-full min-w-0" aria-hidden="true">
                                        <ResponsiveContainer width="100%" height="100%" minHeight={280}>
                                            <AreaChart data={dailyTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                                                <XAxis
                                                    dataKey="date"
                                                    tick={{ fontSize: 12 }}
                                                    tickFormatter={(val) => {
                                                        try { return format(parseISO(val), "dd/MM") }
                                                        catch { return val }
                                                    }}
                                                />
                                                <YAxis tick={{ fontSize: 12 }} />
                                                <RechartsTooltip
                                                    contentStyle={{
                                                        backgroundColor: "var(--popover)",
                                                        borderColor: "var(--border)",
                                                        borderRadius: "6px",
                                                        color: "var(--popover-foreground)",
                                                        fontSize: "12px",
                                                        boxShadow: "none"
                                                    }}
                                                    formatter={(value: unknown) => [`${value}h`, "Horas"]}
                                                    labelFormatter={(label) => {
                                                        try { return format(parseISO(String(label)), "EEEE dd 'de' MMMM", { locale: es }) }
                                                        catch { return String(label) }
                                                    }}
                                                />
                                                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                                                <Area
                                                    type="monotone"
                                                    dataKey="workHours"
                                                    stroke="var(--primary)"
                                                    fill="var(--primary)"
                                                    fillOpacity={0.12}
                                                    name="Horas Totales"
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="avgHours"
                                                    stroke="var(--chart-3)"
                                                    strokeWidth={2}
                                                    dot={false}
                                                    name="Promedio por Colaborador"
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 2. Desviación de Horas Extra por Sucursal */}
                        <Card
                            className="border border-border bg-card"
                            role="region"
                            aria-label="Gráfica comparativa de horas por sucursal"
                            tabIndex={0}
                        >
                            <CardHeader className="p-4 border-b border-border">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    Comparativa de Horas por Sucursal
                                </CardTitle>
                                <CardDescription className="text-xs text-muted-foreground">
                                    Carga ordinaria vs tiempo extraordinario por unidad de negocio
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-4">
                                <div className="sr-only">
                                    <table>
                                        <caption>Comparativa de horas por sucursal</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">Sucursal</th>
                                                <th scope="col">Horas Ordinarias</th>
                                                <th scope="col">Horas Extra</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {branchSummary.map((b) => (
                                                <tr key={b.branchId}>
                                                    <td>{b.branchName}</td>
                                                    <td>{b.totalHours}h</td>
                                                    <td>{b.overtimeHours}h</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {loading ? (
                                    <div className="h-[250px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                        <span className="text-xs">Cargando comparativa por sucursal...</span>
                                    </div>
                                ) : branchSummary.length === 0 ? (
                                    <div className="h-[250px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-6 border border-dashed border-border rounded-lg bg-muted/10 text-center">
                                        <Building2 className="h-8 w-8 text-muted-foreground/40" />
                                        <p className="text-xs font-semibold text-foreground">Sin datos por sucursal</p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm">
                                            No se encontró actividad en las sucursales para el rango seleccionado.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="h-[250px] w-full min-w-0" aria-hidden="true">
                                        <ResponsiveContainer width="100%" height="100%" minHeight={250}>
                                            <BarChart data={branchSummary} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                                                <XAxis dataKey="branchName" tick={{ fontSize: 12 }} />
                                                <YAxis tick={{ fontSize: 12 }} />
                                                <RechartsTooltip
                                                    contentStyle={{
                                                        backgroundColor: "var(--popover)",
                                                        borderColor: "var(--border)",
                                                        borderRadius: "6px",
                                                        color: "var(--popover-foreground)",
                                                        fontSize: "12px",
                                                        boxShadow: "none"
                                                    }}
                                                />
                                                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                                                <Bar dataKey="totalHours" fill="var(--primary)" name="Horas Ordinarias" />
                                                <Bar dataKey="overtimeHours" fill="var(--chart-2)" name="Horas Extra" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 3. Colaboradores con Mayor Tiempo Extra (Riesgo LFT y Fatiga) */}
                        <Card
                            className="border border-border bg-card"
                            role="region"
                            aria-label="Gráfica de colaboradores con mayor tiempo extra acumulado"
                            tabIndex={0}
                        >
                            <CardHeader className="p-4 border-b border-border">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    Colaboradores con Mayor Tiempo Extra
                                </CardTitle>
                                <CardDescription className="text-xs text-muted-foreground">
                                    Seguimiento de sobrecosto laboral y prevención de fatiga (NOM-035)
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-4">
                                <div className="sr-only">
                                    <table>
                                        <caption>Colaboradores con mayor tiempo extra acumulado</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">Colaborador</th>
                                                <th scope="col">Horas Extra</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {employeeSummary.map((e) => (
                                                <tr key={e.userId}>
                                                    <td>{e.name}</td>
                                                    <td>{e.overtimeHours}h</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {loading ? (
                                    <div className="h-[250px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                        <span className="text-xs">Cargando horas extraordinarias...</span>
                                    </div>
                                ) : employeeSummary.length === 0 ? (
                                    <div className="h-[250px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-6 border border-dashed border-border rounded-lg bg-muted/10 text-center">
                                        <Users className="h-8 w-8 text-muted-foreground/40" />
                                        <p className="text-xs font-semibold text-foreground">Sin colaboradores con turnos</p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm">
                                            No hay registros de colaboradores en este período.
                                        </p>
                                    </div>
                                ) : !employeeSummary.some(e => (e.overtimeHours || 0) > 0) ? (
                                    <div className="h-[250px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-6 border border-dashed border-emerald-500/20 rounded-lg bg-emerald-500/5 text-center">
                                        <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                                        <p className="text-xs font-semibold text-foreground">100% Cumplimiento LFT - Sin Tiempo Extra</p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm">
                                            Los {employeeSummary.length} colaboradores activos operaron dentro de sus jornadas ordinarias sin acumular horas extras en este período.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="h-[250px] w-full min-w-0" aria-hidden="true">
                                        <ResponsiveContainer width="100%" height="100%" minHeight={250}>
                                            <BarChart data={employeeSummary} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                                                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                                <YAxis tick={{ fontSize: 12 }} />
                                                <RechartsTooltip
                                                    contentStyle={{
                                                        backgroundColor: "var(--popover)",
                                                        borderColor: "var(--border)",
                                                        borderRadius: "6px",
                                                        color: "var(--popover-foreground)",
                                                        fontSize: "12px",
                                                        boxShadow: "none"
                                                    }}
                                                />
                                                <Bar dataKey="overtimeHours" fill="var(--chart-2)" name="Horas Extra (h)" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 4. Distribución de Estados de Turno */}
                        <Card
                            className="col-span-2 md:col-span-2 border border-border bg-card"
                            role="region"
                            aria-label="Gráfica de distribución de estados de turno"
                            tabIndex={0}
                        >
                            <CardHeader className="p-4 border-b border-border">
                                <CardTitle className="text-sm font-semibold text-foreground">
                                    Distribución Operativa de Turnos
                                </CardTitle>
                                <CardDescription className="text-xs text-muted-foreground">
                                    Proporción de completitud, turnos activos y ausentismo
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="p-4 flex flex-col items-center justify-center">
                                <div className="sr-only">
                                    <table>
                                        <caption>Distribución operativa de turnos</caption>
                                        <thead>
                                            <tr>
                                                <th scope="col">Estado</th>
                                                <th scope="col">Total Turnos</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {statusDistribution.map((s) => (
                                                <tr key={s.name}>
                                                    <td>{s.name}</td>
                                                    <td>{s.value}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {loading ? (
                                    <div className="h-[240px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                        <span className="text-xs">Cargando distribución de turnos...</span>
                                    </div>
                                ) : statusDistribution.length === 0 ? (
                                    <div className="h-[240px] w-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-6 border border-dashed border-border rounded-lg bg-muted/10 text-center">
                                        <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" />
                                        <p className="text-xs font-semibold text-foreground">Sin turnos para clasificar</p>
                                        <p className="text-[11px] text-muted-foreground max-w-sm">
                                            No se registran estados de turnos en el período seleccionado.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="h-[240px] w-full min-w-0 flex items-center justify-center" aria-hidden="true">
                                        <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                                            <PieChart>
                                                <Pie
                                                    data={statusDistribution}
                                                    cx="50%"
                                                    cy="50%"
                                                    labelLine={false}
                                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                                    outerRadius={80}
                                                    dataKey="value"
                                                >
                                                    {statusDistribution.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color || CHART_PALETTE[index % CHART_PALETTE.length]} />
                                                    ))}
                                                </Pie>
                                                <RechartsTooltip
                                                    contentStyle={{
                                                        backgroundColor: "var(--popover)",
                                                        borderColor: "var(--border)",
                                                        borderRadius: "6px",
                                                        color: "var(--popover-foreground)",
                                                        fontSize: "12px",
                                                        boxShadow: "none"
                                                    }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
