"use client";

import { useState, useEffect } from "react";
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
    Shield, 
    Search, 
    Filter, 
    Download,
    Calendar,
    User,
    FileText,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Eye,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Copy
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
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
    resourceType: "WORKFLOW" | "USER" | "COMPANY" | "BRANCH" | "INVENTORY" | "EVIDENCE" | "INCIDENT";
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
        o.name.toLowerCase().includes(search.toLowerCase())
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
        FAILED: "Fallido",
        OPEN: "Abierto",
        RESOLVED: "Resuelto",
        CLOSED: "Cerrado",
    };
    return labels[status.toUpperCase()] || status;
}

function getSeverityLabel(severity: string) {
    const labels: Record<string, string> = {
        HIGH: "Alta",
        MEDIUM: "Media",
        LOW: "Baja",
        CRITICAL: "Crítica",
    };
    return labels[severity.toUpperCase()] || severity;
}

function renderDetailsContent(log: AuditLog) {
    const { resourceType, details } = log;

    if (resourceType === "WORKFLOW") {
        return (
            <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-muted/30 p-3 rounded-md border">
                    <span className="text-muted-foreground block text-xs">Estado del Flujo</span>
                    <span className="font-semibold text-foreground">
                        {details.status ? getStatusLabel(details.status) : "-"}
                    </span>
                </div>
                <div className="bg-muted/30 p-3 rounded-md border">
                    <span className="text-muted-foreground block text-xs">Calificación / Puntaje</span>
                    <span className="font-semibold text-foreground">
                        {details.score !== undefined && details.score !== null ? `${details.score}%` : "-"}
                    </span>
                </div>
                {details.startedAt && (
                    <div className="bg-muted/30 p-3 rounded-md border">
                        <span className="text-muted-foreground block text-xs">Fecha de Inicio</span>
                        <span className="text-foreground">
                            {format(new Date(details.startedAt), "dd MMM yyyy, HH:mm", { locale: es })}
                        </span>
                    </div>
                )}
                {details.completedAt && (
                    <div className="bg-muted/30 p-3 rounded-md border">
                        <span className="text-muted-foreground block text-xs">Fecha de Término</span>
                        <span className="text-foreground">
                            {format(new Date(details.completedAt), "dd MMM yyyy, HH:mm", { locale: es })}
                        </span>
                    </div>
                )}
            </div>
        );
    }

    if (resourceType === "INCIDENT") {
        return (
            <div className="space-y-4">
                <div className="bg-muted/30 p-3 rounded-md border text-sm">
                    <span className="text-muted-foreground block text-xs">Descripción del Incidente</span>
                    <p className="font-medium mt-1 text-foreground">{details.description || "Sin descripción"}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-muted/30 p-3 rounded-md border">
                        <span className="text-muted-foreground block text-xs">Severidad</span>
                        <Badge 
                            variant={details.severity === "HIGH" || details.severity === "CRITICAL" ? "destructive" : "secondary"}
                            className="mt-1"
                        >
                            {details.severity ? getSeverityLabel(details.severity) : "-"}
                        </Badge>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-md border">
                        <span className="text-muted-foreground block text-xs">Estado del Incidente</span>
                        <span className="font-semibold text-foreground">
                            {details.status ? getStatusLabel(details.status) : "-"}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    // Fallback key-value listing for other types of details
    const keys = Object.keys(details);
    if (keys.length > 0) {
        return (
            <div className="grid grid-cols-2 gap-4 text-sm">
                {keys.map((key) => (
                    <div key={key} className="bg-muted/30 p-3 rounded-md border">
                        <span className="text-muted-foreground block text-xs capitalize">
                            {key.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span className="font-medium text-foreground">
                            {typeof details[key] === "object" ? JSON.stringify(details[key]) : String(details[key])}
                        </span>
                    </div>
                ))}
            </div>
        );
    }

    return <p className="text-sm text-muted-foreground">No hay detalles adicionales disponibles.</p>;
}

export default function AuditPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<AuditFilters>({});
    const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

    // Search input state (local to avoid immediate requests)
    const [searchValue, setSearchValue] = useState("");

    // Pagination states
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Dialog state for viewing logs details
    const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

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
                console.error("Failed to fetch audit logs:", error);
                toast.error("Error al cargar logs de auditoría");
            } finally {
                setLoading(false);
            }
        };
        doFetch();
        setCurrentPage(1); // Reset page on filter change
    }, [filters]);

    // Search input debounce timer
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

    const getResourceTypeColor = (type: AuditLog["resourceType"]) => {
        switch (type) {
            case "WORKFLOW":
                return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100";
            case "USER":
                return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100";
            case "COMPANY":
                return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100";
            case "BRANCH":
                return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100";
            case "INVENTORY":
                return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100";
            case "EVIDENCE":
                return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-100";
            case "INCIDENT":
                return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100";
            default:
                return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100";
        }
    };

    const getActionIcon = (action: string) => {
        if (action.includes("CREATE") || action.includes("CREAR")) {
            return <CheckCircle2 className="h-4 w-4 text-green-600" />;
        }
        if (action.includes("UPDATE") || action.includes("ACTUALIZAR")) {
            return <Clock className="h-4 w-4 text-blue-600" />;
        }
        if (action.includes("DELETE") || action.includes("ELIMINAR")) {
            return <AlertTriangle className="h-4 w-4 text-red-600" />;
        }
        return <FileText className="h-4 w-4 text-gray-600" />;
    };

    const clearFilters = () => {
        setFilters({});
        setSearchValue("");
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined && v !== "") || searchValue !== "";

    const handleExport = () => {
        exportToCSV(logs as any[], [
            { key: "action", label: "Acción" },
            { key: "resource", label: "Recurso" },
            { key: "resourceType", label: "Tipo" },
            { key: "userName", label: "Usuario" },
            { key: "branchName", label: "Sucursal" },
            { key: "ipAddress", label: "IP" },
            { key: "createdAt", label: "Fecha" },
        ], `auditoria-${Date.now()}`);
        toast.success("CSV exportado correctamente");
    };

    const stats = {
        total: logs.length,
        workflows: logs.filter(l => l.resourceType === "WORKFLOW").length,
        users: logs.filter(l => l.resourceType === "USER").length,
        evidence: logs.filter(l => l.resourceType === "INCIDENT").length,
    };

    // Pagination calculations
    const totalLogs = logs.length;
    const totalPages = Math.ceil(totalLogs / pageSize);
    const paginatedLogs = logs.slice(
        (currentPage - 1) * pageSize,
        currentPage * pageSize
    );

    return (
        <div className="container mx-auto py-8 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Shield className="h-8 w-8 text-primary" />
                    <div>
                        <h1 className="text-3xl font-bold">Auditoría</h1>
                        <p className="text-muted-foreground mt-1">
                            Registro detallado de todas las actividades del sistema
                        </p>
                    </div>
                </div>
                <Button variant="outline" onClick={handleExport}>
                    <Download className="h-4 w-4 mr-2" />
                    Exportar
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <MetricCard
                    label="Total de Logs"
                    value={stats.total}
                    icon={<FileText className="h-4 w-4" />}
                />
                <MetricCard
                    label="Flujos"
                    value={stats.workflows}
                    icon={<Shield className="h-4 w-4" />}
                />
                <MetricCard
                    label="Usuarios"
                    value={stats.users}
                    icon={<User className="h-4 w-4" />}
                />
                <MetricCard
                    label="Evidencias"
                    value={stats.evidence}
                    icon={<FileText className="h-4 w-4" />}
                />
            </div>

            {/* Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4" />
                            <CardTitle className="text-base">Filtros</CardTitle>
                        </div>
                        {hasFilters && (
                            <Button variant="ghost" size="sm" onClick={clearFilters}>
                                Limpiar filtros
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Buscar</label>
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Acción, recurso, detalles..."
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                    className="pl-8"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Tipo de Recurso</label>
                            <Select
                                value={filters.resourceType || "all"}
                                onValueChange={(value) =>
                                    setFilters({ ...filters, resourceType: value === "all" ? undefined : value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos los tipos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los tipos</SelectItem>
                                    <SelectItem value="WORKFLOW">Flujo de trabajo</SelectItem>
                                    <SelectItem value="USER">Usuario</SelectItem>
                                    <SelectItem value="COMPANY">Empresa</SelectItem>
                                    <SelectItem value="BRANCH">Sucursal</SelectItem>
                                    <SelectItem value="INVENTORY">Inventario</SelectItem>
                                    <SelectItem value="INCIDENT">Evidencia</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2 flex flex-col justify-end">
                            <label className="text-sm font-medium mb-1">Usuario</label>
                            <SearchableSelect
                                placeholder="Todos los usuarios"
                                options={users}
                                value={filters.userId}
                                onChange={(value) =>
                                    setFilters({ ...filters, userId: value })
                                }
                            />
                        </div>

                        <div className="space-y-2 flex flex-col justify-end">
                            <label className="text-sm font-medium mb-1">Sucursal</label>
                            <SearchableSelect
                                placeholder="Todas las sucursales"
                                options={branches}
                                value={filters.branchId}
                                onChange={(value) =>
                                    setFilters({ ...filters, branchId: value })
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Fecha desde</label>
                            <Input
                                type="date"
                                value={filters.dateFrom || ""}
                                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Fecha hasta</label>
                            <Input
                                type="date"
                                value={filters.dateTo || ""}
                                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Audit Logs Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Logs de Auditoría</CardTitle>
                    <CardDescription>
                        Historial completo de actividades y cambios en el sistema
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Clock className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-muted-foreground">
                                No se encontraron logs de auditoría con los filtros seleccionados
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Acción</TableHead>
                                            <TableHead>Recurso</TableHead>
                                            <TableHead>Usuario</TableHead>
                                            <TableHead>Sucursal</TableHead>
                                            <TableHead>IP</TableHead>
                                            <TableHead>Fecha</TableHead>
                                            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedLogs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        {getActionIcon(log.action)}
                                                        <Badge variant="outline" className={getResourceTypeColor(log.resourceType)}>
                                                            {log.action}
                                                        </Badge>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="space-y-1">
                                                        <p className="font-medium">{log.resource}</p>
                                                        <p className="text-xs text-muted-foreground">{log.resourceType}</p>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <User className="h-4 w-4 text-muted-foreground" />
                                                            {log.userName}
                                                        </div>
                                                        <Badge variant="secondary" className="text-xs">
                                                            {log.userRole}
                                                        </Badge>
                                                    </div>
                                                </TableCell>
                                                <TableCell>{log.branchName}</TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    {log.ipAddress || "-"}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-1 text-sm">
                                                            <Calendar className="h-3 w-3 text-muted-foreground" />
                                                            {format(new Date(log.createdAt), "dd MMM yyyy", { locale: es })}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale: es })}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setSelectedLog(log)}
                                                    >
                                                        <Eye className="h-4 w-4 mr-2" />
                                                        Ver Detalles
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination Controls */}
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-1">
                                <div className="text-sm text-muted-foreground">
                                    Mostrando{" "}
                                    <span className="font-medium">
                                        {totalLogs === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                                    </span>{" "}
                                    al{" "}
                                    <span className="font-medium">
                                        {Math.min(currentPage * pageSize, totalLogs)}
                                    </span>{" "}
                                    de <span className="font-medium">{totalLogs}</span> registros
                                </div>
                                <div className="flex flex-wrap items-center gap-4 sm:gap-6 lg:gap-8">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium">Registros por página</p>
                                        <Select
                                            value={String(pageSize)}
                                            onValueChange={(value) => {
                                                setPageSize(Number(value));
                                                setCurrentPage(1);
                                            }}
                                        >
                                            <SelectTrigger className="h-8 w-[70px]">
                                                <SelectValue placeholder={String(pageSize)} />
                                            </SelectTrigger>
                                            <SelectContent align="end">
                                                {[10, 20, 50, 100].map((size) => (
                                                    <SelectItem key={size} value={String(size)}>
                                                        {size}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                                        Página {currentPage} de {totalPages || 1}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            className="h-8 w-8 p-0"
                                            onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1 || loading}
                                        >
                                            <span className="sr-only">Ir a la página anterior</span>
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="outline"
                                            className="h-8 w-8 p-0"
                                            onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages || totalPages === 0 || loading}
                                        >
                                            <span className="sr-only">Ir a la página siguiente</span>
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Info Card */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Información de Auditoría
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        El sistema de auditoría registra todas las actividades importantes realizadas en la plataforma,
                        incluyendo creación, modificación y eliminación de recursos. Estos logs son útiles para:
                    </p>
                    <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 ml-4">
                        <li>Seguimiento de cambios en workflows y evidencias</li>
                        <li>Investigación de incidentes de seguridad</li>
                        <li>Cumplimiento de requisitos normativos (NOM-251, NOM-035)</li>
                        <li>Auditorías internas y externas</li>
                        <li>Control de acceso y actividades de usuarios</li>
                    </ul>
                    <div className="bg-muted p-4 rounded-lg mt-4">
                        <p className="text-sm font-medium mb-2">Política de Retención</p>
                        <p className="text-sm text-muted-foreground">
                            Los logs de auditoría se conservan durante 12 meses. Para exportar logs históricos o configurar
                            alertas personalizadas, contacta al administrador del sistema.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* Audit Log Detail Dialog */}
            <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-primary" />
                            Detalles del Log de Auditoría
                        </DialogTitle>
                        <DialogDescription>
                            Detalle completo de la acción ejecutada en el sistema.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedLog && (
                        <div className="space-y-6 py-2">
                            {/* Summary Metadata */}
                            <div className="grid grid-cols-2 gap-4 text-sm bg-muted/20 p-4 rounded-lg border">
                                <div>
                                    <span className="text-muted-foreground block text-xs">Acción</span>
                                    <span className="font-semibold">{selectedLog.action}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Recurso</span>
                                    <span className="font-semibold">{selectedLog.resource}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Usuario</span>
                                    <span className="font-medium">{selectedLog.userName} ({selectedLog.userRole})</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Sucursal</span>
                                    <span className="font-medium">{selectedLog.branchName}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Dirección IP</span>
                                    <span className="font-mono text-xs">{selectedLog.ipAddress || "-"}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block text-xs">Fecha</span>
                                    <span>
                                        {format(new Date(selectedLog.createdAt), "dd MMM yyyy, HH:mm:ss", { locale: es })}
                                    </span>
                                </div>
                            </div>
                            
                            {/* Human-readable details content */}
                            <div className="space-y-2">
                                <span className="text-sm font-medium block text-foreground">Detalle del Cambio</span>
                                {renderDetailsContent(selectedLog)}
                            </div>
                            
                            {/* Technical Details Accordion */}
                            <div className="border rounded-lg overflow-hidden">
                                <details className="group">
                                    <summary className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer select-none text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
                                        <span>Datos técnicos para soporte (JSON)</span>
                                        <span className="transition-transform duration-200 group-open:rotate-180">▼</span>
                                    </summary>
                                    <div className="p-3 bg-background border-t space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-muted-foreground">Payload original</span>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(JSON.stringify(selectedLog.details, null, 2));
                                                    toast.success("Detalles copiados al portapapeles");
                                                }}
                                            >
                                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                                Copiar JSON
                                            </Button>
                                        </div>
                                        <pre className="p-3 bg-muted rounded-md overflow-x-auto text-xs font-mono max-h-[150px] border">
                                            {JSON.stringify(selectedLog.details, null, 2)}
                                        </pre>
                                    </div>
                                </details>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
