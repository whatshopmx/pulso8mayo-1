"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { 
    ClipboardCheck,
    ShieldCheck,
    Search, 
    Filter, 
    Download,
    Calendar,
    User,
    Users,
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Eye,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Copy,
    Info,
    X,
    RotateCcw,
    Smartphone,
    Laptop,
    MessageSquare,
    FileText,
    Store,
    Timer,
    Check
} from "lucide-react";
import { format, formatDistanceToNow, subDays, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { exportToCSV, cn } from "@/lib/utils";
import { MetricCard } from "@/components/ui/metric-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface AuditLog {
    id: string;
    action: string;
    resource: string;
    resourceType: "WORKFLOW" | "INCIDENT" | string;
    userId: string;
    userName: string;
    userRole: string;
    branchId: string;
    branchName: string;
    details: Record<string, any>;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
}

interface AuditFilters {
    resourceType?: string;
    action?: string;
    userId?: string;
    branchId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

interface SearchableSelectProps {
    placeholder: string;
    options: { id: string; name: string }[];
    value?: string;
    onChange: (value: string | undefined) => void;
    emptyText?: string;
    className?: string;
}

function SearchableSelect({
    placeholder,
    options,
    value,
    onChange,
    emptyText = "No se encontraron resultados",
    className,
}: SearchableSelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const selectedOption = options.find((o) => o.id === value);
    const filteredOptions = options.filter((o) =>
        (o.name || "").toLowerCase().includes(search.toLowerCase())
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "w-full justify-between text-left font-normal bg-background border-input hover:bg-accent hover:text-accent-foreground h-9 px-3 py-2 text-sm",
                        className
                    )}
                >
                    <span className="truncate">
                        {selectedOption ? selectedOption.name : placeholder}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-2 space-y-2 z-50 bg-popover border border-border rounded-md shadow-md" align="start">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        placeholder="Buscar..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 text-xs pl-8"
                    />
                </div>
                <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                    <button
                        type="button"
                        onClick={() => {
                            onChange(undefined);
                            setSearch("");
                            setOpen(false);
                        }}
                        className={cn(
                            "w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors truncate block",
                            !value && "bg-accent/50 font-medium"
                        )}
                    >
                        {placeholder}
                    </button>
                    {filteredOptions.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-2 text-center">
                            {emptyText}
                        </p>
                    ) : (
                        filteredOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                                    onChange(option.id);
                                    setSearch("");
                                    setOpen(false);
                                }}
                                className={cn(
                                    "w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors truncate block",
                                    value === option.id && "bg-accent/50 font-medium"
                                )}
                            >
                                {option.name}
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function getStatusLabel(status: string) {
    const labels: Record<string, string> = {
        COMPLETED: "Completado",
        IN_PROGRESS: "En Progreso",
        PENDING: "Pendiente",
        FAILED: "Con Observaciones",
        OPEN: "Abierta",
        RESOLVED: "Solucionada",
        CLOSED: "Cerrada",
    };
    return labels[status?.toUpperCase()] || status || "Registrado";
}

function getSeverityBadge(severity: string) {
    const sev = (severity || "").toUpperCase();
    if (sev === "CRITICAL" || sev === "HIGH") {
        return (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-medium text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {sev === "CRITICAL" ? "Prioridad Crítica" : "Prioridad Alta"}
            </Badge>
        );
    }
    if (sev === "MEDIUM") {
        return (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-medium text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Prioridad Media
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-medium text-xs">
            Baja / Informativa
        </Badge>
    );
}

function getCaptureChannel(userAgent: string | null, ipAddress: string | null) {
    const ua = (userAgent || "").toLowerCase();
    if (ua.includes("whatsapp") || ua.includes("wasender") || ua.includes("webhook")) {
        return { label: "WhatsApp Bot", icon: MessageSquare, badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
    }
    if (ua.includes("mobile") || ua.includes("tablet") || ua.includes("ipad") || ua.includes("android")) {
        return { label: "Tablet / Móvil", icon: Smartphone, badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" };
    }
    return { label: "Portal Web", icon: Laptop, badgeClass: "bg-muted text-muted-foreground border-border" };
}

function formatTaskName(resource: string, action: string) {
    if (resource && resource !== "null") return resource;
    if (action.startsWith("WORKFLOW_")) {
        return "Checklist Operativo de Turno";
    }
    if (action.startsWith("INCIDENT_")) {
        return "Reporte de Incidencia en Sucursal";
    }
    return "Registro de Actividad";
}

export default function AuditPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<AuditFilters>({});
    const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
    const [searchValue, setSearchValue] = useState("");
    const [activePreset, setActivePreset] = useState<string | null>(null);

    // Pagination states
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Dialog states
    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
    const [infoDialogOpen, setInfoDialogOpen] = useState(false);

    // Fetch filters once on mount
    useEffect(() => {
        fetchFilterOptions();
    }, []);

    // Fetch logs when filters change
    useEffect(() => {
        const doFetch = async () => {
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (filters.resourceType) params.append("resourceType", filters.resourceType);
                if (filters.action) params.append("action", filters.action);
                if (filters.userId) params.append("userId", filters.userId);
                if (filters.branchId) params.append("branchId", filters.branchId);
                if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
                if (filters.dateTo) params.append("dateTo", filters.dateTo);
                if (filters.search) params.append("search", filters.search);

                const response = await fetch(`/api/audit/logs?${params}`);
                if (response.ok) {
                    const data = await response.json();
                    setLogs(data.data || []);
                }
            } catch (error) {
                console.error("Failed to fetch operational logs:", error);
                toast.error("Error al cargar la bitácora operativa");
            } finally {
                setLoading(false);
            }
        };
        doFetch();
        setCurrentPage(1);
    }, [filters]);

    // Search input debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            setFilters(prev => {
                if (prev.search === searchValue) return prev;
                const next = { ...prev };
                if (searchValue) {
                    next.search = searchValue;
                } else {
                    delete next.search;
                }
                return next;
            });
        }, 300);
        return () => clearTimeout(timer);
    }, [searchValue]);

    const fetchFilterOptions = async () => {
        try {
            const response = await fetch("/api/audit/filters");
            if (response.ok) {
                const data = await response.json();
                setUsers(data.users || []);
                setBranches(data.branches || []);
            }
        } catch (error) {
            console.error("Failed to fetch filter options:", error);
        }
    };

    const clearFilters = () => {
        setFilters({});
        setSearchValue("");
        setActivePreset(null);
    };

    // Quick filter presets for restaurant managers
    const applyPreset = (preset: "today" | "yesterday" | "7d" | "incidents" | "checklists") => {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        if (activePreset === preset) {
            clearFilters();
            return;
        }

        setActivePreset(preset);
        if (preset === "today") {
            setFilters(prev => ({
                ...prev,
                dateFrom: todayStr,
                dateTo: todayStr,
                resourceType: undefined,
            }));
        } else if (preset === "yesterday") {
            const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");
            setFilters(prev => ({
                ...prev,
                dateFrom: yesterdayStr,
                dateTo: yesterdayStr,
                resourceType: undefined,
            }));
        } else if (preset === "7d") {
            const weekAgoStr = format(subDays(new Date(), 7), "yyyy-MM-dd");
            setFilters(prev => ({
                ...prev,
                dateFrom: weekAgoStr,
                dateTo: todayStr,
                resourceType: undefined,
            }));
        } else if (preset === "incidents") {
            setFilters(prev => ({
                ...prev,
                resourceType: "INCIDENT",
            }));
        } else if (preset === "checklists") {
            setFilters(prev => ({
                ...prev,
                resourceType: "WORKFLOW",
            }));
        }
    };

    const removeFilter = (key: keyof AuditFilters) => {
        setFilters(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        if (key === "dateFrom" || key === "dateTo") {
            setActivePreset(null);
        }
        if (key === "search") {
            setSearchValue("");
        }
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined && v !== "") || searchValue !== "";

    const handleExport = () => {
        if (logs.length === 0) {
            toast.error("No hay registros para exportar con los filtros seleccionados");
            return;
        }
        exportToCSV(logs as any[], [
            { key: "id", label: "Folio" },
            { key: "resource", label: "Actividad / Checklist" },
            { key: "resourceType", label: "Tipo de Registro" },
            { key: "userName", label: "Responsable" },
            { key: "userRole", label: "Puesto / Rol" },
            { key: "branchName", label: "Sucursal" },
            { key: "createdAt", label: "Fecha y Hora" },
        ], `bitacora-operativa-qsr-${format(new Date(), "yyyyMMdd-HHmm")}`);
        toast.success(`Bitácora descargada: ${logs.length} registros en formato CSV`);
    };

    // Calculate restaurant metrics
    const stats = useMemo(() => {
        const uniqueUsers = new Set(logs.map(l => l.userName).filter(Boolean)).size;
        return {
            total: logs.length,
            workflows: logs.filter(l => l.resourceType === "WORKFLOW").length,
            incidents: logs.filter(l => l.resourceType === "INCIDENT").length,
            activeStaff: uniqueUsers,
        };
    }, [logs]);

    // Pagination calculations
    const totalLogs = logs.length;
    const totalPages = Math.ceil(totalLogs / pageSize);
    const paginatedLogs = logs.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    return (
        <div className="container mx-auto py-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
                        <ClipboardCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                            Bitácora Operativa
                        </h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Supervisión en tiempo real de aperturas, checklists sanitarios e incidencias en sucursales
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setInfoDialogOpen(true)}
                        className="h-9 gap-1.5"
                    >
                        <Info className="h-4 w-4 text-muted-foreground" />
                        <span>Normativa NOM-251</span>
                    </Button>
                    <Button 
                        variant="default" 
                        size="sm" 
                        onClick={handleExport}
                        className="h-9 gap-1.5"
                    >
                        <Download className="h-4 w-4" />
                        <span>Descargar Bitácora (CSV)</span>
                    </Button>
                </div>
            </div>

            {/* QSR Metric Cards */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <MetricCard
                    label="Total de Registros"
                    value={stats.total}
                    icon={<Activity className="h-4 w-4 text-primary" />}
                />
                <MetricCard
                    label="Checklists Realizados"
                    value={stats.workflows}
                    icon={<ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                />
                <MetricCard
                    label="Incidencias y Desviaciones"
                    value={stats.incidents}
                    icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
                />
                <MetricCard
                    label="Personal en Turno"
                    value={stats.activeStaff}
                    icon={<Users className="h-4 w-4 text-primary" />}
                />
            </div>

            {/* Routine & Search Filters */}
            <Card className="border">
                <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <CardTitle className="text-sm font-semibold">Filtros de Supervisión</CardTitle>
                        </div>
                        {/* Quick Routine Presets */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted-foreground mr-1">Turno / Rango:</span>
                            <Button
                                variant={activePreset === "today" ? "default" : "outline"}
                                size="sm"
                                onClick={() => applyPreset("today")}
                                className="h-7 px-2.5 text-xs"
                            >
                                Hoy
                            </Button>
                            <Button
                                variant={activePreset === "yesterday" ? "default" : "outline"}
                                size="sm"
                                onClick={() => applyPreset("yesterday")}
                                className="h-7 px-2.5 text-xs"
                            >
                                Ayer
                            </Button>
                            <Button
                                variant={activePreset === "7d" ? "default" : "outline"}
                                size="sm"
                                onClick={() => applyPreset("7d")}
                                className="h-7 px-2.5 text-xs"
                            >
                                Últimos 7 días
                            </Button>
                            <Button
                                variant={activePreset === "incidents" ? "default" : "outline"}
                                size="sm"
                                onClick={() => applyPreset("incidents")}
                                className="h-7 px-2.5 text-xs text-destructive border-destructive/20 hover:bg-destructive/10"
                            >
                                Solo Incidencias
                            </Button>
                            <Button
                                variant={activePreset === "checklists" ? "default" : "outline"}
                                size="sm"
                                onClick={() => applyPreset("checklists")}
                                className="h-7 px-2.5 text-xs"
                            >
                                Solo Checklists
                            </Button>
                            {hasFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearFilters}
                                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <RotateCcw className="h-3 w-3 mr-1" />
                                    Restablecer
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-4 sm:px-6 pb-4 pt-1 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Search Input */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Buscar en bitácora</label>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Checklist, responsable o detalle..."
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                    className="h-9 pl-8 text-sm"
                                />
                            </div>
                        </div>

                        {/* Resource / Event Type */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Tipo de registro</label>
                            <Select
                                value={filters.resourceType || "all"}
                                onValueChange={(value) =>
                                    setFilters({ ...filters, resourceType: value === "all" ? undefined : value })
                                }
                            >
                                <SelectTrigger className="h-9 text-sm">
                                    <SelectValue placeholder="Todos los registros" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los registros</SelectItem>
                                    <SelectItem value="WORKFLOW">Checklists y Rutinas de Turno</SelectItem>
                                    <SelectItem value="INCIDENT">Incidencias y Desviaciones</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Responsible Staff Combobox */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Responsable de turno</label>
                            <SearchableSelect
                                placeholder="Todo el personal"
                                options={users}
                                value={filters.userId}
                                onChange={(value) =>
                                    setFilters({ ...filters, userId: value })
                                }
                            />
                        </div>

                        {/* Branch Combobox */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Sucursal</label>
                            <SearchableSelect
                                placeholder="Todas las sucursales"
                                options={branches}
                                value={filters.branchId}
                                onChange={(value) =>
                                    setFilters({ ...filters, branchId: value })
                                }
                            />
                        </div>

                        {/* Date From */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Fecha desde</label>
                            <Input
                                type="date"
                                value={filters.dateFrom || ""}
                                onChange={(e) => {
                                    setFilters({ ...filters, dateFrom: e.target.value || undefined });
                                    setActivePreset(null);
                                }}
                                className="h-9 text-sm"
                            />
                        </div>

                        {/* Date To */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Fecha hasta</label>
                            <Input
                                type="date"
                                value={filters.dateTo || ""}
                                min={filters.dateFrom}
                                onChange={(e) => {
                                    setFilters({ ...filters, dateTo: e.target.value || undefined });
                                    setActivePreset(null);
                                }}
                                className="h-9 text-sm"
                            />
                        </div>
                    </div>

                    {/* Active Filter Chips */}
                    {hasFilters && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t text-xs">
                            <span className="text-muted-foreground font-medium mr-1">Filtros aplicados:</span>
                            {filters.search && (
                                <Badge variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                                    <span>Texto: "{filters.search}"</span>
                                    <button 
                                        onClick={() => removeFilter("search")} 
                                        className="hover:text-destructive transition-colors ml-0.5"
                                        aria-label="Quitar filtro de texto"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )}
                            {filters.resourceType && (
                                <Badge variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                                    <span>Tipo: {filters.resourceType === "WORKFLOW" ? "Checklists" : "Incidencias"}</span>
                                    <button 
                                        onClick={() => removeFilter("resourceType")} 
                                        className="hover:text-destructive transition-colors ml-0.5"
                                        aria-label="Quitar filtro de tipo"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )}
                            {filters.userId && (
                                <Badge variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                                    <span>Personal: {users.find(u => u.id === filters.userId)?.name || filters.userId}</span>
                                    <button 
                                        onClick={() => removeFilter("userId")} 
                                        className="hover:text-destructive transition-colors ml-0.5"
                                        aria-label="Quitar filtro de personal"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )}
                            {filters.branchId && (
                                <Badge variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                                    <span>Sucursal: {branches.find(b => b.id === filters.branchId)?.name || filters.branchId}</span>
                                    <button 
                                        onClick={() => removeFilter("branchId")} 
                                        className="hover:text-destructive transition-colors ml-0.5"
                                        aria-label="Quitar filtro de sucursal"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )}
                            {filters.dateFrom && (
                                <Badge variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                                    <span>Desde: {filters.dateFrom}</span>
                                    <button 
                                        onClick={() => removeFilter("dateFrom")} 
                                        className="hover:text-destructive transition-colors ml-0.5"
                                        aria-label="Quitar filtro de fecha desde"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )}
                            {filters.dateTo && (
                                <Badge variant="secondary" className="gap-1 py-0.5 px-2 text-xs font-normal">
                                    <span>Hasta: {filters.dateTo}</span>
                                    <button 
                                        onClick={() => removeFilter("dateTo")} 
                                        className="hover:text-destructive transition-colors ml-0.5"
                                        aria-label="Quitar filtro de fecha hasta"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Table of Operational Records */}
            <Card className="border">
                <CardHeader className="pb-3 px-4 sm:px-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base sm:text-lg">Historial de Turnos y Supervisión</CardTitle>
                            <CardDescription className="text-xs sm:text-sm">
                                Registro cronológico de actividades ejecutadas en cocina, piso y almacén
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-4 sm:px-6 pb-6 pt-0">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground space-y-3">
                            <Clock className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm font-medium">Consultando registros de sucursales...</p>
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                            <div className="p-3 rounded-full bg-muted">
                                <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-semibold text-foreground text-base">
                                    Sin registros para mostrar
                                </p>
                                <p className="text-xs text-muted-foreground max-w-sm">
                                    No hay checklists ni incidencias registradas con los filtros seleccionados.
                                </p>
                            </div>
                            {hasFilters && (
                                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2 text-xs">
                                    Ver todos los registros
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-lg border overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                                            <TableHead className="font-semibold text-xs">Tipo</TableHead>
                                            <TableHead className="font-semibold text-xs">Actividad / Tarea</TableHead>
                                            <TableHead className="font-semibold text-xs">Responsable</TableHead>
                                            <TableHead className="font-semibold text-xs">Sucursal</TableHead>
                                            <TableHead className="font-semibold text-xs">Canal</TableHead>
                                            <TableHead className="font-semibold text-xs">Fecha y Hora</TableHead>
                                            <TableHead className="text-right font-semibold text-xs">Ficha</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedLogs.map((log) => {
                                            const isIncident = log.resourceType === "INCIDENT" || log.action.includes("INCIDENT");
                                            const channel = getCaptureChannel(log.userAgent, log.ipAddress);
                                            const ChannelIcon = channel.icon;

                                            return (
                                                <TableRow key={log.id} className="hover:bg-muted/30 transition-colors">
                                                    <TableCell>
                                                        {isIncident ? (
                                                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 font-medium text-xs">
                                                                <AlertTriangle className="h-3 w-3 mr-1" />
                                                                Incidencia
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-muted text-foreground border-border font-medium text-xs">
                                                                <ShieldCheck className="h-3 w-3 mr-1 text-emerald-600 dark:text-emerald-400" />
                                                                Checklist
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="space-y-0.5">
                                                            <p className="font-medium text-sm text-foreground">
                                                                {formatTaskName(log.resource, log.action)}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {isIncident ? "Desviación reportada" : "Rutina de operación"}
                                                            </p>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="space-y-0.5">
                                                            <div className="flex items-center gap-1.5 text-sm font-medium">
                                                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                                <span>{log.userName || "Personal de Sucursal"}</span>
                                                            </div>
                                                            {log.userRole && (
                                                                <span className="text-[11px] text-muted-foreground">
                                                                    {log.userRole}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                                                            <Store className="h-3.5 w-3.5 text-muted-foreground" />
                                                            <span>{log.branchName || "Sucursal Matriz"}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className={cn("text-xs font-normal gap-1", channel.badgeClass)}>
                                                            <ChannelIcon className="h-3 w-3" />
                                                            <span>{channel.label}</span>
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="space-y-0.5">
                                                            <div className="flex items-center gap-1 text-sm font-medium">
                                                                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                                                <span>
                                                                    {format(new Date(log.createdAt), "dd MMM yyyy, HH:mm", { locale: es })}
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] text-muted-foreground">
                                                                {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: es })}
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 px-2.5 text-xs hover:bg-accent"
                                                            onClick={() => setSelectedLog(log)}
                                                        >
                                                            <FileText className="h-3.5 w-3.5 mr-1.5 text-primary" />
                                                            Ver Ficha
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination Controls */}
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-1 text-xs text-muted-foreground">
                                <div>
                                    Mostrando{" "}
                                    <span className="font-semibold text-foreground">
                                        {totalLogs === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                                    </span>{" "}
                                    al{" "}
                                    <span className="font-semibold text-foreground">
                                        {Math.min(currentPage * pageSize, totalLogs)}
                                    </span>{" "}
                                    de <span className="font-semibold text-foreground">{totalLogs}</span> registros
                                </div>
                                <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                                    <div className="flex items-center gap-2">
                                        <p className="font-medium">Registros por página</p>
                                        <Select
                                            value={String(pageSize)}
                                            onValueChange={(value) => {
                                                setPageSize(Number(value));
                                                setCurrentPage(1);
                                            }}
                                        >
                                            <SelectTrigger className="h-8 w-[70px] text-xs">
                                                <SelectValue placeholder={String(pageSize)} />
                                            </SelectTrigger>
                                            <SelectContent align="end">
                                                {[10, 20, 50, 100].map((size) => (
                                                    <SelectItem key={size} value={String(size)} className="text-xs">
                                                        {size}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="font-medium">
                                        Página {currentPage} de {totalPages || 1}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            variant="outline"
                                            className="h-8 w-8 p-0"
                                            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1 || loading}
                                        >
                                            <span className="sr-only">Página anterior</span>
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            className="h-8 w-8 p-0"
                                            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages || totalPages === 0 || loading}
                                        >
                                            <span className="sr-only">Página siguiente</span>
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* QSR Operational Inspection Sheet Modal (Zero-JSON, Human-First) */}
            <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <div className="flex items-center justify-between pr-6">
                            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                                <FileText className="h-5 w-5 text-primary" />
                                Ficha de Supervisión Operativa
                            </DialogTitle>
                        </div>
                        <DialogDescription className="text-xs">
                            {selectedLog?.resourceType === "INCIDENT" 
                                ? "Reporte de incidencia y desviación en sucursal" 
                                : "Comprobante de cumplimiento y registro de turno"}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedLog && (() => {
                        const isIncident = selectedLog.resourceType === "INCIDENT";
                        const channel = getCaptureChannel(selectedLog.userAgent, selectedLog.ipAddress);
                        const ChannelIcon = channel.icon;
                        const durationMins = selectedLog.details?.startedAt && selectedLog.details?.completedAt
                            ? differenceInMinutes(new Date(selectedLog.details.completedAt), new Date(selectedLog.details.startedAt))
                            : null;

                        return (
                            <div className="space-y-4 py-2 text-xs sm:text-sm">
                                {/* Summary Card */}
                                <div className="bg-muted/40 p-4 rounded-lg border space-y-3">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                                                Actividad / Tarea
                                            </span>
                                            <h3 className="font-bold text-sm sm:text-base text-foreground mt-0.5">
                                                {formatTaskName(selectedLog.resource, selectedLog.action)}
                                            </h3>
                                        </div>
                                        {isIncident ? (
                                            getSeverityBadge(selectedLog.details?.severity)
                                        ) : (
                                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs font-semibold">
                                                <Check className="h-3 w-3 mr-1" />
                                                {getStatusLabel(selectedLog.details?.status || "COMPLETED")}
                                            </Badge>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t text-xs">
                                        <div>
                                            <span className="text-muted-foreground block text-[11px]">Sucursal</span>
                                            <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                                <Store className="h-3 w-3 text-muted-foreground" />
                                                {selectedLog.branchName || "Sucursal Matriz"}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground block text-[11px]">Responsable</span>
                                            <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                                <User className="h-3 w-3 text-muted-foreground" />
                                                {selectedLog.userName || "Personal de Turno"}
                                            </span>
                                            {selectedLog.userRole && (
                                                <span className="text-[10px] text-muted-foreground block">
                                                    {selectedLog.userRole}
                                                </span>
                                            )}
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground block text-[11px]">Canal de Captura</span>
                                            <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                                                <ChannelIcon className="h-3 w-3 text-muted-foreground" />
                                                {channel.label}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Operational Findings & Verification */}
                                {isIncident ? (
                                    <div className="space-y-3">
                                        <div className="bg-destructive/5 border border-destructive/20 p-3.5 rounded-lg space-y-1.5">
                                            <span className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                                                <AlertTriangle className="h-4 w-4" />
                                                Descripción de la Desviación
                                            </span>
                                            <p className="text-foreground text-xs leading-relaxed font-medium">
                                                {selectedLog.details?.description || "Incidencia registrada durante la operación de cocina."}
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-muted/30 p-3 rounded-lg border">
                                                <span className="text-muted-foreground block text-[11px]">Estado de Atención</span>
                                                <span className="font-bold text-foreground mt-0.5 block">
                                                    {getStatusLabel(selectedLog.details?.status || "OPEN")}
                                                </span>
                                            </div>
                                            <div className="bg-muted/30 p-3 rounded-lg border">
                                                <span className="text-muted-foreground block text-[11px]">Fecha y Hora de Reporte</span>
                                                <span className="font-medium text-foreground mt-0.5 block">
                                                    {format(new Date(selectedLog.createdAt), "dd MMM yyyy, HH:mm", { locale: es })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-muted/30 p-3 rounded-lg border">
                                                <span className="text-muted-foreground block text-[11px]">Calificación del Checklist</span>
                                                <div className="flex items-baseline gap-1 mt-0.5">
                                                    <span className="text-lg font-bold text-foreground">
                                                        {selectedLog.details?.score !== undefined && selectedLog.details?.score !== null 
                                                            ? `${selectedLog.details.score}%` 
                                                            : "100%"}
                                                    </span>
                                                    <span className="text-xs text-emerald-600 font-medium">Cumplimiento</span>
                                                </div>
                                            </div>
                                            <div className="bg-muted/30 p-3 rounded-lg border">
                                                <span className="text-muted-foreground block text-[11px]">Tiempo de Ejecución</span>
                                                <div className="flex items-center gap-1.5 mt-1 text-foreground font-semibold">
                                                    <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                                                    <span>{durationMins !== null ? `${durationMins} minutos` : "En tiempo regular"}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-muted/20 border p-3 rounded-lg space-y-1">
                                            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                                                Dictamen de Supervisión
                                            </span>
                                            <p className="text-xs text-foreground leading-relaxed">
                                                Actividad completada y validada según los lineamientos de higiene y operación establecidos para el restaurante.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Folio & Quick Actions Footer */}
                                <div className="flex items-center justify-between pt-3 border-t text-xs text-muted-foreground">
                                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                        <span>Folio:</span>
                                        <span className="font-semibold text-foreground">#{selectedLog.id.slice(0, 8).toUpperCase()}</span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs gap-1"
                                        onClick={() => {
                                            navigator.clipboard.writeText(`FOLIO-${selectedLog.id.toUpperCase()}`);
                                            toast.success("Folio de bitácora copiado al portapapeles");
                                        }}
                                    >
                                        <Copy className="h-3 w-3" />
                                        Copiar Folio
                                    </Button>
                                </div>
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* Normative & Health Retention Dialog */}
            <Dialog open={infoDialogOpen} onOpenChange={setInfoDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                            <ShieldCheck className="h-5 w-5 text-primary" />
                            Normativa Sanitaria y Bitácoras (NOM-251)
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Lineamientos oficiales y validez legal de las bitácoras en restaurantes.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 text-xs sm:text-sm text-muted-foreground py-2 leading-relaxed">
                        <p>
                            En México y Latinoamérica, los grupos restauranteros y cadenas de comida rápida están obligados a mantener registros de control higiénico:
                        </p>
                        <ul className="list-disc list-inside space-y-1.5 ml-2">
                            <li><strong className="text-foreground">NOM-251-SSA1-2009</strong>: Prácticas de higiene obligatorias para el manejo de alimentos y bebidas.</li>
                            <li><strong className="text-foreground">Distintivo H</strong>: Trazabilidad de temperaturas en cámaras frías, freidoras y línea de ensamble.</li>
                            <li><strong className="text-foreground">Firmas y Responsables</strong>: Identificación clara del supervisor de turno y hora de captura.</li>
                            <li><strong className="text-foreground">Inspecciones de Autoridad</strong>: Respaldos descargables para visitas de COFEPRIS y auditores de franquicia.</li>
                        </ul>
                        <div className="bg-muted/50 p-3.5 rounded-lg border space-y-1">
                            <p className="font-semibold text-foreground text-xs">Conservación Digital (12 Meses)</p>
                            <p className="text-xs text-muted-foreground">
                                Las bitácoras se resguardan de forma segura e inmutable durante 1 año para auditorías sanitarias o reclamos de calidad.
                            </p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
