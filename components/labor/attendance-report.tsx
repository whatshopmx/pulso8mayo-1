"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import {
    Download,
    Search,
    Clock,
    AlertTriangle,
    CheckCircle2,
    Calendar,
    Building2,
    Coffee,
    ChevronLeft,
    ChevronRight,
    Sparkles,
    ShieldAlert,
    Sun,
    Sunset,
    Moon,
    RefreshCw
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { AttendanceRecord } from "@/app/api/reports/attendance/route"

export type ServiceShiftType = "all" | "apertura" | "intermedio" | "cierre"

export interface AttendanceReportProps {
    records: AttendanceRecord[]
    loading?: boolean
    focusedSessionId?: string | null
    dateRangeLabel?: string
    searchTerm?: string
    onSearchTermChange?: (term: string) => void
    onRefresh?: () => void
}

/**
 * Determina el turno de servicio restaurantero según la hora de entrada:
 * - Apertura: 06:00 a 11:59 (desayuno / preparación / comida inicial)
 * - Intermedio: 12:00 a 16:59 (comida fuerte / refuerzo de cocina)
 * - Cierre: 17:00 a 05:59 (cena / servicio nocturno / corte)
 */
export function getServiceShift(clockInIso: string | null): "apertura" | "intermedio" | "cierre" {
    if (!clockInIso) return "apertura"
    try {
        const d = parseISO(clockInIso)
        const hour = d.getHours()
        if (isNaN(hour)) return "apertura"
        if (hour >= 6 && hour < 12) return "apertura"
        if (hour >= 12 && hour < 17) return "intermedio"
        return "cierre"
    } catch {
        return "apertura"
    }
}

export function AttendanceReport({
    records,
    loading = false,
    focusedSessionId,
    dateRangeLabel = "Período actual",
    searchTerm: externalSearchTerm,
    onSearchTermChange,
    onRefresh
}: AttendanceReportProps) {
    const [internalSearchTerm, setInternalSearchTerm] = React.useState("")
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm
    const setSearchTerm = onSearchTermChange || setInternalSearchTerm
    const [selectedShift, setSelectedShift] = React.useState<ServiceShiftType>("all")
    const [onlyOvertime, setOnlyOvertime] = React.useState(false)
    const [page, setPage] = React.useState(1)
    const [pageSize, setPageSize] = React.useState(15)

    // Contadores por turno de servicio
    const shiftCounts = React.useMemo(() => {
        const counts = { all: records.length, apertura: 0, intermedio: 0, cierre: 0, overtimeAlerts: 0 }
        records.forEach(r => {
            const shift = getServiceShift(r.clockIn)
            counts[shift] += 1
            if ((r.overtimeMinutes || 0) > 0) {
                counts.overtimeAlerts += 1
            }
        })
        return counts
    }, [records])

    // Filtrado de registros
    const filteredRecords = React.useMemo(() => {
        return records.filter(record => {
            // Filtro por búsqueda textual (nombre, correo, rol, sucursal)
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase()
                const matchName = record.userName?.toLowerCase().includes(term)
                const matchEmail = record.userEmail?.toLowerCase().includes(term)
                const matchRole = record.userRole?.toLowerCase().includes(term)
                const matchBranch = record.branchName?.toLowerCase().includes(term)
                if (!matchName && !matchEmail && !matchRole && !matchBranch) {
                    return false
                }
            }

            // Filtro por turno de servicio
            if (selectedShift !== "all") {
                const shift = getServiceShift(record.clockIn)
                if (shift !== selectedShift) return false
            }

            // Filtro por sólo overtime / horas extra
            if (onlyOvertime) {
                if ((record.overtimeMinutes || 0) <= 0) return false
            }

            return true
        })
    }, [records, searchTerm, selectedShift, onlyOvertime])

    // Resetear a página 1 al cambiar filtros
    React.useEffect(() => {
        setPage(1)
    }, [searchTerm, selectedShift, onlyOvertime, pageSize])

    // Paginación
    const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1
    const paginatedRecords = React.useMemo(() => {
        const start = (page - 1) * pageSize
        return filteredRecords.slice(start, start + pageSize)
    }, [filteredRecords, page, pageSize])

    const formatMinutesToHours = (minutes: number) => {
        const hours = Math.floor(minutes / 60)
        const mins = Math.round(minutes % 60)
        if (hours === 0) return `${mins}m`
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    }

    const exportToCSV = () => {
        if (filteredRecords.length === 0) {
            toast.error("No hay registros para exportar con los filtros activos")
            return
        }

        const headers = [
            "ID Sesion",
            "Fecha",
            "Turno de Servicio",
            "Colaborador",
            "Correo",
            "Rol Operativo",
            "Sucursal",
            "Hora Entrada",
            "Hora Salida",
            "Minutos Trabajados",
            "Horas Efectivas",
            "Minutos Colación / Descanso (LFT Art. 63)",
            "Minutos Extra LFT (Art. 66/68)",
            "Clasificacion LFT",
            "Estado Turno"
        ]

        const rows = filteredRecords.map(r => {
            const shiftName = getServiceShift(r.clockIn) === "apertura"
                ? "Apertura"
                : getServiceShift(r.clockIn) === "intermedio"
                ? "Intermedio"
                : "Cierre"

            const overtimeMin = r.overtimeMinutes || 0
            const lftStatus = overtimeMin === 0
                ? "Ordinario"
                : overtimeMin <= 180
                ? "Dobles LFT (≤3h diarias)"
                : "Triples LFT (>3h diarias - Excedente Art. 68)"

            return [
                `"${r.id}"`,
                `"${r.date}"`,
                `"${shiftName}"`,
                `"${r.userName?.replace(/"/g, '""') || ''}"`,
                `"${r.userEmail || ''}"`,
                `"${r.userRole || ''}"`,
                `"${r.branchName?.replace(/"/g, '""') || ''}"`,
                `"${r.clockIn ? format(parseISO(r.clockIn), "HH:mm") : 'N/A'}"`,
                `"${r.clockOut ? format(parseISO(r.clockOut), "HH:mm") : 'N/A'}"`,
                r.totalWorkMinutes || 0,
                Number(((r.totalWorkMinutes || 0) / 60).toFixed(2)),
                r.breakMinutes || 0,
                overtimeMin,
                `"${lftStatus}"`,
                `"${r.status}"`
            ]
        })

        // UTF-8 BOM para apertura correcta en Excel en español
        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(row => row.join(","))].join("\r\n")
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.setAttribute("download", `auditoria_turnos_pulso_${new Date().toISOString().split("T")[0]}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        toast.success(`Exportados ${filteredRecords.length} turnos a CSV`)
    }

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="p-4 border-b border-border pb-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                            Auditoría Detallada de Turnos
                            <Badge variant="outline" className="text-xs font-normal font-mono py-0 h-5">
                                {filteredRecords.length} {filteredRecords.length === 1 ? "registro" : "registros"}
                            </Badge>
                            {loading && (
                                <Badge variant="secondary" className="text-xs font-normal gap-1 animate-pulse">
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    Actualizando...
                                </Badge>
                            )}
                        </CardTitle>
                        <CardDescription className="text-xs text-muted-foreground mt-0.5">
                            {dateRangeLabel} · Checadas de relevo, colación y fiscalización de horas extra conforme a la LFT
                        </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={exportToCSV}
                            disabled={loading || filteredRecords.length === 0}
                            className="h-8 text-xs font-medium"
                        >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            Exportar CSV
                        </Button>
                    </div>
                </div>

                {/* Filtros Operativos en Tabla */}
                <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-border/60">
                    {/* Búsqueda rápida */}
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Buscar colaborador, rol o sucursal..."
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

                    {/* Selector de Turno de Servicio Restaurantero */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setSelectedShift("all")}
                            className={`h-7 px-2.5 text-xs font-medium rounded-md transition-colors ${
                                selectedShift === "all"
                                    ? "bg-foreground text-background"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            Todos ({shiftCounts.all})
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedShift("apertura")}
                            className={`h-7 px-2.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors ${
                                selectedShift === "apertura"
                                    ? "bg-foreground text-background"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            <Sun className="h-3 w-3 text-amber-500" />
                            Apertura ({shiftCounts.apertura})
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedShift("intermedio")}
                            className={`h-7 px-2.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors ${
                                selectedShift === "intermedio"
                                    ? "bg-foreground text-background"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            <Sunset className="h-3 w-3 text-orange-500" />
                            Intermedio ({shiftCounts.intermedio})
                        </button>
                        <button
                            type="button"
                            onClick={() => setSelectedShift("cierre")}
                            className={`h-7 px-2.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors ${
                                selectedShift === "cierre"
                                    ? "bg-foreground text-background"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                        >
                            <Moon className="h-3 w-3 text-indigo-400" />
                            Cierre ({shiftCounts.cierre})
                        </button>

                        <button
                            type="button"
                            onClick={() => setOnlyOvertime(!onlyOvertime)}
                            className={`h-7 px-2.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 border transition-colors ${
                                onlyOvertime
                                    ? "bg-destructive/10 text-destructive border-destructive/40 font-semibold"
                                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                            title="Filtrar turnos con horas extra"
                        >
                            <ShieldAlert className="h-3 w-3" />
                            Sólo Horas Extra ({shiftCounts.overtimeAlerts})
                        </button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableHead className="w-32 text-xs font-semibold uppercase tracking-wider">Fecha / Turno</TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wider">Colaborador</TableHead>
                                <TableHead className="text-xs font-semibold uppercase tracking-wider">Sucursal</TableHead>
                                <TableHead className="w-28 text-xs font-semibold uppercase tracking-wider">Entrada / Salida</TableHead>
                                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Horas Efectivas</TableHead>
                                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Colación (LFT)</TableHead>
                                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Horas Extra (LFT)</TableHead>
                                <TableHead className="w-28 text-center text-xs font-semibold uppercase tracking-wider">Estado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && records.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-xs">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                            <span>Cargando registros de turnos...</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : paginatedRecords.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-xs">
                                        <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                                            <Calendar className="h-8 w-8 text-muted-foreground/40 mb-2" />
                                            <p className="font-medium text-foreground text-sm">No se encontraron turnos</p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {searchTerm || selectedShift !== "all" || onlyOvertime
                                                    ? "Prueba ajustando los filtros o el término de búsqueda."
                                                    : "No hay registros de asistencia para la sucursal y fechas seleccionadas."}
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedRecords.map((record) => {
                                    const isFocused = focusedSessionId && record.id === focusedSessionId
                                    const shiftType = getServiceShift(record.clockIn)
                                    const overtimeMinutes = record.overtimeMinutes || 0
                                    const isTripleOvertime = overtimeMinutes > 180 // > 3 horas en un solo turno

                                    return (
                                        <TableRow
                                            key={record.id}
                                            id={`shift-${record.id}`}
                                            className={`transition-colors ${
                                                isFocused
                                                    ? "bg-primary/10 ring-1 ring-inset ring-primary/30 font-medium"
                                                    : "hover:bg-muted/30"
                                            }`}
                                        >
                                            {/* Fecha y Turno de Servicio */}
                                            <TableCell className="py-2.5">
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-foreground text-xs font-mono">
                                                        {format(parseISO(record.date), "dd/MMM/yy", { locale: es })}
                                                    </span>
                                                    <div className="flex items-center gap-1 mt-0.5">
                                                        {shiftType === "apertura" && (
                                                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                                                <Sun className="h-2.5 w-2.5" /> Apertura
                                                            </span>
                                                        )}
                                                        {shiftType === "intermedio" && (
                                                            <span className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                                                                <Sunset className="h-2.5 w-2.5" /> Intermedio
                                                            </span>
                                                        )}
                                                        {shiftType === "cierre" && (
                                                            <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
                                                                <Moon className="h-2.5 w-2.5" /> Cierre
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>

                                            {/* Colaborador */}
                                            <TableCell className="py-2.5">
                                                <div>
                                                    <div className="font-medium text-foreground text-xs flex items-center gap-1.5">
                                                        {record.userName}
                                                        {isFocused && (
                                                            <Badge variant="outline" className="text-xs h-4 border-primary text-primary px-1">
                                                                Enfocado
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                                                        <span className="capitalize">{record.userRole?.toLowerCase()}</span>
                                                        {record.userEmail && (
                                                            <>
                                                                <span>·</span>
                                                                <span className="truncate max-w-[140px]">{record.userEmail}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </TableCell>

                                            {/* Sucursal */}
                                            <TableCell className="py-2.5 text-xs text-muted-foreground">
                                                <span className="inline-flex items-center gap-1">
                                                    <Building2 className="h-3 w-3 text-muted-foreground/70" />
                                                    {record.branchName}
                                                </span>
                                            </TableCell>

                                            {/* Entrada - Salida */}
                                            <TableCell className="py-2.5 font-mono text-xs text-foreground">
                                                <div className="flex flex-col">
                                                    <span>
                                                        {record.clockIn ? format(parseISO(record.clockIn), "HH:mm") : "--:--"}
                                                        {" - "}
                                                        {record.clockOut ? format(parseISO(record.clockOut), "HH:mm") : (
                                                            record.status === "ACTIVE" ? "En curso" : "--:--"
                                                        )}
                                                    </span>
                                                </div>
                                            </TableCell>

                                            {/* Horas Efectivas */}
                                            <TableCell className="py-2.5 text-right font-mono text-xs font-semibold text-foreground">
                                                {formatMinutesToHours(record.totalWorkMinutes || 0)}
                                            </TableCell>

                                            {/* Descanso */}
                                            <TableCell className="py-2.5 text-right font-mono text-xs text-muted-foreground">
                                                {(record.breakMinutes || 0) > 0 ? (
                                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                                        <Coffee className="h-3 w-3 text-muted-foreground/60" />
                                                        {record.breakMinutes}m
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground/50">0m</span>
                                                )}
                                            </TableCell>

                                            {/* Horas Extra (Semáforo LFT) */}
                                            <TableCell className="py-2.5 text-right">
                                                {overtimeMinutes === 0 ? (
                                                    <span className="text-xs text-muted-foreground/50 font-mono">0h</span>
                                                ) : (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Badge
                                                                    variant="outline"
                                                                    className={`text-xs font-mono cursor-help px-2 py-0.5 ${
                                                                        isTripleOvertime
                                                                            ? "border-destructive/50 bg-destructive/10 text-destructive font-bold"
                                                                            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium"
                                                                    }`}
                                                                >
                                                                    {isTripleOvertime && "⚠️ "}
                                                                    {formatMinutesToHours(overtimeMinutes)}
                                                                </Badge>
                                                            </TooltipTrigger>
                                                            <TooltipContent className="text-xs max-w-xs p-2.5">
                                                                {isTripleOvertime ? (
                                                                    <div className="space-y-1">
                                                                        <p className="font-bold text-destructive">
                                                                            Alerta LFT (Art. 66/68): Horas Triples
                                                                        </p>
                                                                        <p className="text-muted-foreground text-xs">
                                                                            Este turno excede el tope legal de 3 horas diarias. El tiempo excedente ({formatMinutesToHours(overtimeMinutes - 180)}) debe liquidarse con recargo del 200%.
                                                                        </p>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-1">
                                                                        <p className="font-semibold text-foreground">
                                                                            Horas Extraordinarias Dobles (LFT)
                                                                        </p>
                                                                        <p className="text-muted-foreground text-xs">
                                                                            Dentro del marco de 3h diarias permitidas (Art. 66 LFT). Liquidar con recargo del 100%.
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                            </TableCell>

                                            {/* Estado del Turno */}
                                            <TableCell className="py-2.5 text-center">
                                                <Badge
                                                    variant="outline"
                                                    className={`text-xs font-medium px-2 py-0.5 ${
                                                        record.status === "COMPLETED"
                                                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                                                            : record.status === "ACTIVE"
                                                            ? "bg-primary/10 text-primary border-primary/25 animate-pulse"
                                                            : "bg-destructive/10 text-destructive border-destructive/20"
                                                    }`}
                                                >
                                                    {record.status === "COMPLETED"
                                                        ? "Completado"
                                                        : record.status === "ACTIVE"
                                                        ? "En Turno"
                                                        : "No presentado"}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Paginación y Resumen Inferior */}
                {filteredRecords.length > 0 && (
                    <div className="p-3.5 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground bg-muted/10">
                        <div className="flex items-center gap-2">
                            <span>Mostrar</span>
                            <Select
                                value={String(pageSize)}
                                onValueChange={(val) => setPageSize(Number(val))}
                            >
                                <SelectTrigger className="h-7 w-16 text-xs">
                                    <SelectValue placeholder={String(pageSize)} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="10">10</SelectItem>
                                    <SelectItem value="15">15</SelectItem>
                                    <SelectItem value="25">25</SelectItem>
                                    <SelectItem value="50">50</SelectItem>
                                </SelectContent>
                            </Select>
                            <span>turnos por página · Total: {filteredRecords.length}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                            <span className="mr-2">
                                Página {page} de {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
