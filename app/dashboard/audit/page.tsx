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
    Eye
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/utils";
import Link from "next/link";

interface AuditLog {
    id: string;
    action: string;
    resource: string;
    resourceType: "WORKFLOW" | "USER" | "COMPANY" | "BRANCH" | "INVENTORY" | "EVIDENCE";
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

export default function AuditPage() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<AuditFilters>({});
    const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

    useEffect(() => {
        fetchLogs();
        fetchFilterOptions();
    }, [filters]);

    const fetchLogs = async () => {
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
    };

    const hasFilters = Object.values(filters).some(v => v !== undefined && v !== "");

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
        evidence: logs.filter(l => l.resourceType === "EVIDENCE").length,
    };

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
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Total de Logs
                        </CardDescription>
                        <CardTitle className="text-3xl">{stats.total}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2 text-blue-600">
                            <Shield className="h-4 w-4" />
                            Workflows
                        </CardDescription>
                        <CardTitle className="text-3xl text-blue-600">{stats.workflows}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2 text-purple-600">
                            <User className="h-4 w-4" />
                            Usuarios
                        </CardDescription>
                        <CardTitle className="text-3xl text-purple-600">{stats.users}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center gap-2 text-pink-600">
                            <FileText className="h-4 w-4" />
                            Evidencias
                        </CardDescription>
                        <CardTitle className="text-3xl text-pink-600">{stats.evidence}</CardTitle>
                    </CardHeader>
                </Card>
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
                                    value={filters.search || ""}
                                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
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
                                    <SelectItem value="WORKFLOW">Workflow</SelectItem>
                                    <SelectItem value="USER">Usuario</SelectItem>
                                    <SelectItem value="COMPANY">Empresa</SelectItem>
                                    <SelectItem value="BRANCH">Sucursal</SelectItem>
                                    <SelectItem value="INVENTORY">Inventario</SelectItem>
                                    <SelectItem value="EVIDENCE">Evidencia</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Usuario</label>
                            <Select
                                value={filters.userId || "all"}
                                onValueChange={(value) =>
                                    setFilters({ ...filters, userId: value === "all" ? undefined : value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos los usuarios" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los usuarios</SelectItem>
                                    {users.map((u) => (
                                        <SelectItem key={u.id} value={u.id}>
                                            {u.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Sucursal</label>
                            <Select
                                value={filters.branchId || "all"}
                                onValueChange={(value) =>
                                    setFilters({ ...filters, branchId: value === "all" ? undefined : value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Todas las sucursales" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las sucursales</SelectItem>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>
                                            {b.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
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
                                    {logs.map((log) => (
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
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(JSON.stringify(log.details, null, 2));
                                                        toast.success("Detalles copiados al portapapeles");
                                                    }}
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
        </div>
    );
}
