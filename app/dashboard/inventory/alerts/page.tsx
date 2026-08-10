"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Package, TrendingDown, Clock, RefreshCw, Eye, CheckCircle2, XCircle, AlertTriangle, Bell } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageContainer } from "@/components/shared";
import { DataTableSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";
import { MetricCard, MetricGrid, MetricCardSkeleton } from "@/components/ui/metric-card";

interface AlertRecord {
    id: string;
    type: string;
    severity: string;
    status: string;
    currentStock: number;
    minLevel: number;
    detectedAt: Date;
    viewedAt: Date | null;
    resolvedAt: Date | null;
    notes: string | null;
    itemName: string | null;
    itemSku: string | null;
    branchName: string | null;
    resolvedByName: string | null;
}

interface AlertSummary {
    total: number;
    active: number;
    viewed: number;
    inProgress: number;
    resolved: number;
    dismissed: number;
}

export default function InventoryAlertsPage() {
    const router = useRouter();
    const [alerts, setAlerts] = React.useState<AlertRecord[]>([]);
    const [summary, setSummary] = React.useState<AlertSummary | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
    const [typeFilter, setTypeFilter] = React.useState<string>("ALL");
    const [selectedAlert, setSelectedAlert] = React.useState<AlertRecord | null>(null);
    const [updateDialogOpen, setUpdateDialogOpen] = React.useState(false);
    const [updateStatus, setUpdateStatus] = React.useState<string>("");
    const [updateNotes, setUpdateNotes] = React.useState("");
    const [updating, setUpdating] = React.useState(false);

    const fetchAlerts = React.useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== "ALL") params.set("status", statusFilter);
            if (typeFilter !== "ALL") params.set("type", typeFilter);

            const response = await fetch(`/api/inventory/alerts/history?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                setAlerts(data.data || []);
                setSummary(data.summary || null);
            } else {
                toast.error("Error al cargar el historial de alertas");
            }
        } catch (error) {
            console.error("Error fetching alerts:", error);
            toast.error("Error al cargar el historial de alertas");
        } finally {
            setLoading(false);
        }
    }, [statusFilter, typeFilter]);

    React.useEffect(() => {
        fetchAlerts();
    }, [fetchAlerts]);

    const handleUpdateStatus = async (alertId: string, status: string, notes?: string) => {
        setUpdating(true);
        try {
            const response = await fetch(`/api/inventory/alerts/history/${alertId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status, notes }),
            });

            if (response.ok) {
                toast.success("Estado de alerta actualizado");
                setUpdateDialogOpen(false);
                await fetchAlerts();
            } else {
                toast.error("Error al actualizar el estado de la alerta");
            }
        } catch (error) {
            console.error("Error updating alert:", error);
            toast.error("Error al actualizar el estado de la alerta");
        } finally {
            setUpdating(false);
        }
    };

    const openUpdateDialog = (alert: AlertRecord) => {
        setSelectedAlert(alert);
        setUpdateStatus(alert.status);
        setUpdateNotes(alert.notes || "");
        setUpdateDialogOpen(true);
    };

    const getStatusBadge = (status: string) => {
        const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string, icon: React.ReactNode }> = {
            ACTIVE: { variant: "destructive", label: "Activa", icon: <AlertCircle className="h-3 w-3" /> },
            VIEWED: { variant: "secondary", label: "Vista", icon: <Eye className="h-3 w-3" /> },
            IN_PROGRESS: { variant: "default", label: "En Proceso", icon: <Clock className="h-3 w-3" /> },
            RESOLVED: { variant: "outline", label: "Resuelta", icon: <CheckCircle2 className="h-3 w-3" /> },
            DISMISSED: { variant: "outline", label: "Descartada", icon: <XCircle className="h-3 w-3" /> },
        };

        const config = variants[status] || variants.ACTIVE;
        return (
            <Badge variant={config.variant} className="gap-1">
                {config.icon}
                {config.label}
            </Badge>
        );
    };

    const getTypeBadge = (type: string) => {
        const variants: Record<string, { variant: "default" | "secondary" | "destructive", label: string, icon: React.ReactNode }> = {
            LOW_STOCK: { variant: "secondary", label: "Stock Bajo", icon: <TrendingDown className="h-3 w-3" /> },
            OUT_OF_STOCK: { variant: "destructive", label: "Sin Stock", icon: <Package className="h-3 w-3" /> },
            EXPIRING_SOON: { variant: "default", label: "Próximo a Vencer", icon: <Clock className="h-3 w-3" /> },
            EXPIRED: { variant: "destructive", label: "Vencido", icon: <AlertTriangle className="h-3 w-3" /> },
            PRICE_INCREASE: { variant: "destructive", label: "Alza de Costo", icon: <TrendingDown className="h-3 w-3" /> },
        };

        const config = variants[type] || variants.LOW_STOCK;
        return (
            <Badge variant={config.variant} className="gap-1">
                {config.icon}
                {config.label}
            </Badge>
        );
    };

const getSeverityBadge = (severity: string) => {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string, color: string }> = {
    CRITICA: { variant: "destructive", label: "Crítica", color: "bg-red-500" },
    ALTA: { variant: "destructive", label: "Alta", color: "bg-orange-500" },
    MEDIA: { variant: "secondary", label: "Media", color: "bg-yellow-500" },
    BAJA: { variant: "outline", label: "Baja", color: "bg-green-500" },
  };

        const config = variants[severity] || variants.BAJA;
        return (
            <Badge variant={config.variant} className="gap-1">
                <div className={`h-2 w-2 rounded-full ${config.color}`} />
                {config.label}
            </Badge>
        );
    };

    if (loading) {
        return (
            <div className="p-6 space-y-6">
                <PageHeaderSkeleton />
                <MetricCardSkeleton count={5} />
                <DataTableSkeleton columns={6} rows={8} />
            </div>
        );
    }

    return (
        <PageContainer>
            <PageHeader
                title="Alertas de Stock"
                description="Historial y gestión de alertas de stock"
                icon={Bell}
            />
            {/* Summary Cards */}
            {summary && (
                <MetricGrid columns={5}>
                    <MetricCard label="Total" value={summary.total} icon={<AlertCircle className="h-4 w-4" />} />
                    <MetricCard label="Activas" value={summary.active} icon={<AlertCircle className="h-4 w-4" />} tone="destructive" />
                    <MetricCard label="En Proceso" value={summary.inProgress} icon={<Clock className="h-4 w-4" />} tone="info" />
                    <MetricCard label="Resueltas" value={summary.resolved} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
                    <MetricCard label="Descartadas" value={summary.dismissed} icon={<XCircle className="h-4 w-4" />} tone="neutral" />
                </MetricGrid>
            )}

            {/* Filters */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-end">
                        <Button
                            variant="outline"
                            onClick={() => fetchAlerts()}
                            className="gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Actualizar
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-4 mb-4">
                        <div className="flex-1">
                            <Label>Estado</Label>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos los estados" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Todos</SelectItem>
                                    <SelectItem value="ACTIVE">Activas</SelectItem>
                                    <SelectItem value="VIEWED">Vistas</SelectItem>
                                    <SelectItem value="IN_PROGRESS">En Proceso</SelectItem>
                                    <SelectItem value="RESOLVED">Resueltas</SelectItem>
                                    <SelectItem value="DISMISSED">Descartadas</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-1">
                            <Label>Tipo</Label>
                            <Select value={typeFilter} onValueChange={setTypeFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todos los tipos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">Todos</SelectItem>
                                    <SelectItem value="LOW_STOCK">Stock Bajo</SelectItem>
                                    <SelectItem value="OUT_OF_STOCK">Sin Stock</SelectItem>
                                    <SelectItem value="EXPIRING_SOON">Próximo a Vencer</SelectItem>
                                    <SelectItem value="EXPIRED">Vencido</SelectItem>
                                    <SelectItem value="PRICE_INCREASE">Alza de Costo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Alerts Table */}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Severidad</TableHead>
                                <TableHead>Producto</TableHead>
                                <TableHead>Sucursal</TableHead>
                                <TableHead>Stock</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Detectada</TableHead>
                                <TableHead>Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {alerts.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                        No hay alertas registradas
                                    </TableCell>
                                </TableRow>
                            ) : (
                                alerts.map((alert) => (
                                    <TableRow key={alert.id}>
                                        <TableCell>
                                            {getTypeBadge(alert.type)}
                                        </TableCell>
                                        <TableCell>
                                            {getSeverityBadge(alert.severity)}
                                        </TableCell>
                                        <TableCell>
                                            <div>
                                                <div className="font-medium">{alert.itemName || "N/A"}</div>
                                                {alert.itemSku && (
                                                    <div className="text-xs text-muted-foreground">{alert.itemSku}</div>
                                                )}
                                                {alert.notes && (
                                                    <div className="text-xs text-muted-foreground max-w-xs truncate" title={alert.notes}>{alert.notes}</div>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{alert.branchName || "N/A"}</TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                <div className={alert.currentStock === 0 ? "text-red-600 font-bold" : ""}>
                                                    {alert.currentStock}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    Mín: {alert.minLevel}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {getStatusBadge(alert.status)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                {new Date(alert.detectedAt).toLocaleDateString('es-MX')}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openUpdateDialog(alert)}
                                            >
                                                Actualizar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Update Status Dialog */}
            <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Actualizar Estado de Alerta</DialogTitle>
                        <DialogDescription>
                            {selectedAlert?.itemName || "Alerta"} - {selectedAlert?.branchName || ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nuevo Estado</Label>
                            <Select value={updateStatus} onValueChange={setUpdateStatus}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ACTIVE">Activa</SelectItem>
                                    <SelectItem value="VIEWED">Vista</SelectItem>
                                    <SelectItem value="IN_PROGRESS">En Proceso</SelectItem>
                                    <SelectItem value="RESOLVED">Resuelta</SelectItem>
                                    <SelectItem value="DISMISSED">Descartada</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Notas</Label>
                            <Textarea
                                placeholder="Agrega notas sobre las acciones tomadas..."
                                value={updateNotes}
                                onChange={(e) => setUpdateNotes(e.target.value)}
                                className="min-h-[100px]"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setUpdateDialogOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => selectedAlert && handleUpdateStatus(selectedAlert.id, updateStatus, updateNotes)}
                            disabled={updating}
                        >
                            {updating ? "Actualizando..." : "Actualizar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageContainer>
    );
}
