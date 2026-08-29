"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { BarChart, Bar, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"
import { Clock, Users, TrendingUp, CheckCircle, Calendar, RefreshCw, Building2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AttendanceReport } from "./attendance-report"
import { AttendanceRecord } from "@/app/api/reports/attendance/route"

interface AttendanceDashboardProps {
    initialData?: {
        data: AttendanceRecord[]
        summary: any
    }
}

// System tokens for data visualization (OKLCH aligned)
const CHART_COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--chart-2, 160 60% 45%))",
    "hsl(var(--chart-3, 30 80% 55%))",
    "hsl(var(--chart-4, 280 65% 60%))",
    "hsl(var(--chart-5, 340 75% 55%))",
    "hsl(var(--chart-1, 220 70% 50%))",
]

export function AttendanceDashboard({ initialData }: AttendanceDashboardProps) {
    const [records, setRecords] = React.useState<AttendanceRecord[]>(initialData?.data || [])
    const [summary, setSummary] = React.useState<any>(initialData?.summary || {})
    const [timeRange, setTimeRange] = React.useState<"7d" | "30d" | "90d">("30d")
    const [selectedBranch, setSelectedBranch] = React.useState<string>("all")
    const [branches, setBranches] = React.useState<Array<{ id: string; name: string }>>([])
    const [loading, setLoading] = React.useState(false)

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
            const end = new Date()
            const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90
            const start = new Date()
            start.setDate(start.getDate() - days)

            const startDate = start.toISOString().split("T")[0]
            const endDate = end.toISOString().split("T")[0]

            const params = new URLSearchParams({ startDate, endDate })
            if (selectedBranch !== "all") {
                params.set("branchId", selectedBranch)
            }

            const res = await fetch(`/api/reports/attendance?${params}`)
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
    }, [timeRange, selectedBranch])

    React.useEffect(() => {
        fetchBranches()
    }, [fetchBranches])

    React.useEffect(() => {
        fetchAttendance()
    }, [fetchAttendance])

    // Calculate daily trends
    const dailyTrends = React.useMemo(() => {
        const grouped: Record<string, any> = {}

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

    // Calculate employee summary
    const employeeSummary = React.useMemo(() => {
        const grouped: Record<string, any> = {}

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
            .sort((a, b) => b.totalWorkMinutes - a.totalWorkMinutes)
            .slice(0, 10)
    }, [records])

    // Calculate status distribution
    const statusDistribution = React.useMemo(() => {
        const statusCounts: Record<string, number> = {
            COMPLETED: 0,
            ACTIVE: 0,
            MISSED: 0
        }

        records.forEach(record => {
            if (record.status) {
                statusCounts[record.status] = (statusCounts[record.status] || 0) + 1
            }
        })

        return Object.entries(statusCounts).map(([name, value]) => ({
            name: name === "COMPLETED" ? "Completado" : name === "ACTIVE" ? "En Turno" : "No presentado",
            value
        }))
    }, [records])

    // Calculate branch summary
    const branchSummary = React.useMemo(() => {
        const grouped: Record<string, any> = {}

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

        return Object.values(grouped).map(b => ({
            ...b,
            totalHours: Number(((b.totalWorkMinutes || 0) / 60).toFixed(1)),
            overtimeHours: Number(((b.totalOvertimeMinutes || 0) / 60).toFixed(1)),
            employeeCount: b.employees.size,
            avgHoursPerEmployee: Number(((b.totalWorkMinutes || 0) / (b.employees.size || 1) / 60).toFixed(1))
        }))
    }, [records])

    const formatMinutes = (minutes: number) => {
        const hours = Math.floor(minutes / 60)
        const mins = Math.round(minutes % 60)
        return `${hours}h ${mins}m`
    }

    return (
        <div className="space-y-6">
            {/* Header with Branch & TimeRange Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Auditoría de Asistencia y Turnos</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Métricas de horas trabajadas, puntualidad y cumplimiento de jornada laboral
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="w-48">
                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                            <SelectTrigger className="h-8 text-xs">
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

                    <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)} className="w-auto">
                        <TabsList className="h-8">
                            <TabsTrigger value="7d" className="text-xs px-2.5">7d</TabsTrigger>
                            <TabsTrigger value="30d" className="text-xs px-2.5">30d</TabsTrigger>
                            <TabsTrigger value="90d" className="text-xs px-2.5">90d</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <Button onClick={fetchAttendance} variant="outline" size="icon" className="h-8 w-8" title="Actualizar">
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Total Turnos
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-foreground font-mono">{summary.totalRecords || 0}</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            en el periodo seleccionado
                        </p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Horas Totales
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                            {formatMinutes(summary.totalWorkMinutes || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                            {formatMinutes((summary.totalWorkMinutes || 0) / (summary.totalRecords || 1))} prom/turno
                        </p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Horas Extra (Overtime)
                            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight font-mono text-amber-600 dark:text-amber-400">
                            {formatMinutes(summary.totalOvertimeMinutes || 0)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {summary.totalOvertimeMinutes > 0 ? "⚠️ Horas a liquidar" : "✓ Sin horas extra"}
                        </p>
                    </CardContent>
                </Card>

                <Card className="border border-border bg-card">
                    <CardHeader className="p-3.5 pb-1">
                        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Turnos Completados
                            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3.5 pt-0">
                        <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 font-mono">
                            {summary.totalRecords > 0
                                ? Math.round(((summary.completedShifts || 0) / summary.totalRecords) * 100)
                                : 0}%
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {summary.completedShifts || 0} de {summary.totalRecords || 0} turnos
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Visual Analytics */}
            <div className="grid gap-4 md:grid-cols-2">
                {/* Daily Trend */}
                <Card className="col-span-2 border border-border bg-card">
                    <CardHeader className="p-4 border-b border-border">
                        <CardTitle className="text-sm font-bold text-foreground">Tendencia de Horas Trabajadas</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                            Evolución de horas totales y promedio por colaborador
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4">
                        <ResponsiveContainer width="100%" height={260}>
                            <AreaChart data={dailyTrends}>
                                <defs>
                                    <linearGradient id="colorWorkHours" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 12 }}
                                    tickFormatter={(value) => {
                                        try {
                                            return format(parseISO(value), "dd/MM")
                                        } catch {
                                            return value
                                        }
                                    }}
                                />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip
                                    formatter={(value: any) => [`${value}h`, "Horas Trabajadas"]}
                                    labelFormatter={(label) => {
                                        try {
                                            return format(parseISO(label), "dd/MMM", { locale: es })
                                        } catch {
                                            return label
                                        }
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: '12px' }} />
                                <Area
                                    type="monotone"
                                    dataKey="workHours"
                                    stroke="hsl(var(--primary))"
                                    fillOpacity={1}
                                    fill="url(#colorWorkHours)"
                                    name="Horas Totales"
                                />
                                <Line
                                    type="monotone"
                                    dataKey="avgHours"
                                    stroke="hsl(var(--chart-2, 160 60% 45%))"
                                    name="Promedio por Empleado"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Status Distribution */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 border-b border-border">
                        <CardTitle className="text-sm font-bold text-foreground">Distribución de Turnos</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                            Proporción de turnos completados, activos y ausencias
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie
                                    data={statusDistribution}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                    outerRadius={75}
                                    dataKey="value"
                                >
                                    {statusDistribution.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Top Employees */}
                <Card className="border border-border bg-card">
                    <CardHeader className="p-4 border-b border-border">
                        <CardTitle className="text-sm font-bold text-foreground">Top Colaboradores por Horas</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                            Colaboradores con mayor tiempo acumulado en turno
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={employeeSummary}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip />
                                <Bar dataKey="totalHours" fill="hsl(var(--primary))" name="Horas Trabajadas" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Branch Summary */}
                <Card className="col-span-2 border border-border bg-card">
                    <CardHeader className="p-4 border-b border-border">
                        <CardTitle className="text-sm font-bold text-foreground">Comparativa por Sucursal</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                            Horas ordinarias y extraordinarias por ubicación
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4">
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={branchSummary}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis dataKey="branchName" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: '12px' }} />
                                <Bar dataKey="totalHours" fill="hsl(var(--primary))" name="Horas Ordinarias" />
                                <Bar dataKey="overtimeHours" fill="hsl(var(--chart-3, 30 80% 55%))" name="Horas Extra" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Detailed Table Report */}
            <AttendanceReport initialData={initialData} />
        </div>
    )
}
