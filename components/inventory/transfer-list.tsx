"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
    ArrowRight, 
    CheckCircle, 
    XCircle, 
    Truck, 
    Package, 
    Clock, 
    AlertCircle,
    Eye,
    Search
} from "lucide-react";
import { DataTableSkeleton } from "@/components/shared/skeletons";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { EmptyState } from "@/components/shared";

interface Transfer {
    transfer: {
        id: string;
        transferNumber: string;
        fromBranchId: string;
        toBranchId: string;
        status: string;
        requestedBy: string;
        approvedBy?: string;
        shippedBy?: string;
        receivedBy?: string;
        requestedAt: string;
        approvedAt?: string;
        shippedAt?: string;
        receivedAt?: string;
        notes?: string;
        rejectionReason?: string;
    };
    items?: any[];
}

interface TransferListProps {
    branchId: string;
    branches?: Array<{ id: string; name: string }>;
    onRequestNewTransfer?: () => void;
    refreshKey?: number;
}

export function TransferList({ branchId, branches = [], onRequestNewTransfer, refreshKey }: TransferListProps) {
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [rejectionReason, setRejectionReason] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
    const [roleFilter, setRoleFilter] = useState<"from" | "to" | "both">("both");

    // Memoize branch lookup Map to avoid O(N*B) search loops
    const branchMap = useMemo(() => {
        const map = new Map<string, string>();
        branches.forEach(b => map.set(b.id, b.name));
        return map;
    }, [branches]);

    const getBranchName = useCallback((id: string) => {
        return branchMap.get(id) || id;
    }, [branchMap]);

    // Fetch transfers
    useEffect(() => {
        fetchTransfers();
    }, [branchId, roleFilter, refreshKey]);

    const handleOpenDetail = (t: Transfer) => {
        setSelectedTransfer(t);
        const initialQties: Record<string, number> = {};
        t.items?.forEach(item => {
            const qty = item.shippedQuantity !== null && item.shippedQuantity !== undefined 
                ? parseFloat(item.shippedQuantity) 
                : parseFloat(item.requestedQuantity || "0");
            initialQties[item.id] = qty;
        });
        setReceivedQuantities(initialQties);
        setIsDetailOpen(true);
    };

    const fetchTransfers = async () => {
        try {
            const branchParam = branchId ? `&branchId=${encodeURIComponent(branchId)}` : "";
            const response = await fetch(`/api/inventory/transfers?role=${roleFilter}${branchParam}`);
            const result = await response.json();

            if (response.ok) {
                setTransfers(result.transfers || []);
            } else {
                setTransfers([]);
                toast.error(result.error || "Failed to fetch transfers");
            }
        } catch (error) {
            console.error("Fetch transfers error:", error);
            toast.error("Error al cargar transferencias");
        } finally {
            setLoading(false);
        }
    };

    // Handle transfer action
    const handleAction = async (transferId: string, action: string, data?: any) => {
        if (action === "reject" && (!data?.reason || !data.reason.trim())) {
            toast.error("Por favor ingresa el motivo del rechazo en el campo correspondiente.");
            return;
        }

        setIsProcessing(true);

        try {
            const response = await fetch(`/api/inventory/transfers/${transferId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...data }),
            });

            const result = await response.json();

            if (response.ok) {
                toast.success(`Transferencia ${action === 'approve' ? 'aprobada' : action === 'reject' ? 'rechazada' : action === 'ship' ? 'enviada' : 'recibida'} exitosamente`);
                fetchTransfers();
                setIsDetailOpen(false);
                setRejectionReason("");
            } else {
                toast.error(result.error || `Failed to ${action} transfer`);
            }
        } catch (error) {
            console.error("Transfer action error:", error);
            toast.error("Error al procesar la transferencia");
        } finally {
            setIsProcessing(false);
        }
    };


    // Get status badge
    const getStatusBadge = (status: string) => {
        const badges: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; icon: any }> = {
            PENDING: { variant: "secondary", label: "Pendiente", icon: Clock },
            APPROVED: { variant: "default", label: "Aprobada", icon: CheckCircle },
            REJECTED: { variant: "destructive", label: "Rechazada", icon: XCircle },
            IN_TRANSIT: { variant: "default", label: "En Tránsito", icon: Truck },
            COMPLETED: { variant: "outline", label: "Completada", icon: CheckCircle },
            CANCELLED: { variant: "destructive", label: "Cancelada", icon: XCircle },
        };

        const config = badges[status] || { variant: "outline", label: status, icon: AlertCircle };
        const Icon = config.icon;

        return (
            <Badge variant={config.variant} className="gap-1 px-2.5 py-1 text-xs">
                <Icon className="w-3.5 h-3.5" />
                {config.label}
            </Badge>
        );
    };

    // Memoize search filtering
    const filteredTransfers = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return transfers;
        return transfers.filter(t => {
            const numMatch = t.transfer.transferNumber.toLowerCase().includes(term);
            const fromName = getBranchName(t.transfer.fromBranchId).toLowerCase();
            const toName = getBranchName(t.transfer.toBranchId).toLowerCase();
            return numMatch || fromName.includes(term) || toName.includes(term);
        });
    }, [transfers, searchTerm, getBranchName]);

    // Group transfers by status using useMemo
    const { pendingTransfers, toApproveTransfers, inTransitTransfers, completedTransfers } = useMemo(() => {
        return {
            pendingTransfers: filteredTransfers.filter(t => t.transfer.status === "PENDING" && t.transfer.fromBranchId === branchId),
            toApproveTransfers: filteredTransfers.filter(t => t.transfer.status === "PENDING" && t.transfer.toBranchId === branchId),
            inTransitTransfers: filteredTransfers.filter(t => t.transfer.status === "IN_TRANSIT"),
            completedTransfers: filteredTransfers.filter(t => ["COMPLETED", "REJECTED", "CANCELLED"].includes(t.transfer.status)),
        };
    }, [filteredTransfers, branchId]);

    const renderTransferTable = (transferList: Transfer[]) => (
        <div className="space-y-2">
            {transferList.length === 0 ? (
                <EmptyState
                    icon={Package}
                    title="Sin transferencias"
                    description="No hay transferencias en esta categoría."
                    action={onRequestNewTransfer ? {
                        label: "Solicitar primera transferencia",
                        onClick: onRequestNewTransfer,
                    } : undefined}
                />
            ) : (
                transferList.map(({ transfer, items }) => (
                    <Card key={transfer.id} className="hover:border-primary/40 transition-colors">
                        <CardContent className="p-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <p className="font-semibold text-base">{transfer.transferNumber}</p>
                                        {getStatusBadge(transfer.status)}
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <span className="font-medium text-foreground">{getBranchName(transfer.fromBranchId)}</span>
                                        <ArrowRight className="w-3.5 h-3.5" />
                                        <span className="font-medium text-foreground">{getBranchName(transfer.toBranchId)}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Solicitado: {format(new Date(transfer.requestedAt), "dd MMM yyyy HH:mm", { locale: es })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleOpenDetail({ transfer, items })}
                                        className="gap-2 min-h-[40px] px-3 text-xs"
                                    >
                                        <Eye className="w-4 h-4" />
                                        Ver Detalle
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );

    const renderTransferDetail = () => {
        if (!selectedTransfer) return null;

        const { transfer, items } = selectedTransfer;

        return (
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-xl">Transferencia {transfer.transferNumber}</DialogTitle>
                    <DialogDescription className="text-sm">
                        {getBranchName(transfer.fromBranchId)} → {getBranchName(transfer.toBranchId)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Status */}
                    <div className="flex items-center gap-2">
                        <Label className="font-medium">Estado:</Label>
                        {getStatusBadge(transfer.status)}
                    </div>

                    {/* Items */}
                    <Card className="border">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base font-semibold">Productos</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {items?.map((item: any, idx: number) => {
                                    const maxQty = item.shippedQuantity !== null && item.shippedQuantity !== undefined
                                        ? parseFloat(item.shippedQuantity)
                                        : parseFloat(item.requestedQuantity || "0");
                                        
                                    return (
                                        <div key={item.id || `item-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-lg gap-2 bg-muted/20">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <Package className="w-4 h-4 text-muted-foreground" />
                                                    <span className="text-sm font-semibold">{item.itemName || "Producto"}</span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    SKU: {item.itemSku || 'N/A'} • Solicitado: {item.requestedQuantity} {item.itemUnit || 'U'}
                                                    {item.shippedQuantity !== null && item.shippedQuantity !== undefined && ` • Enviado: ${item.shippedQuantity}`}
                                                </div>
                                            </div>
                                            
                                            {transfer.status === "IN_TRANSIT" && transfer.toBranchId === branchId ? (
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Label htmlFor={`qty-${item.id}`} className="text-xs font-medium">Recibido:</Label>
                                                    <Input
                                                        id={`qty-${item.id}`}
                                                        type="number"
                                                        step="any"
                                                        min="0"
                                                        max={maxQty}
                                                        value={receivedQuantities[item.id] ?? maxQty}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            if (!isNaN(val)) {
                                                                const constrainedVal = Math.min(val, maxQty);
                                                                setReceivedQuantities(prev => ({
                                                                    ...prev,
                                                                    [item.id]: constrainedVal
                                                                }));
                                                            }
                                                        }}
                                                        className="w-24 h-10 text-right font-mono"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="text-sm font-medium text-right">
                                                    {transfer.status === "COMPLETED" ? (
                                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                                            Recibido: {item.receivedQuantity}
                                                        </span>
                                                    ) : (
                                                        <span>Cantidad: {item.requestedQuantity}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Notes */}
                    {transfer.notes && (
                        <div className="space-y-2">
                            <Label className="font-medium">Notas:</Label>
                            <p className="text-sm text-muted-foreground p-3 border rounded-lg bg-muted/30">
                                {transfer.notes}
                            </p>
                        </div>
                    )}

                    {/* Rejection input */}
                    {transfer.status === "PENDING" && transfer.toBranchId === branchId && (
                        <div className="space-y-2">
                            <Label htmlFor="rejection-reason" className="font-medium">Motivo de Rechazo (si se rechaza):</Label>
                            <Input
                                id="rejection-reason"
                                placeholder="Escribe el motivo..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                className="min-h-[44px]"
                            />
                        </div>
                    )}

                    {/* Rejection reason display */}
                    {transfer.rejectionReason && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                Motivo del rechazo: {transfer.rejectionReason}
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Timeline */}
                    <div className="space-y-2">
                        <Label className="font-medium">Historial:</Label>
                        <div className="space-y-1 text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg border font-mono">
                            <p>Solicitado: {format(new Date(transfer.requestedAt), "dd MMM yyyy HH:mm", { locale: es })}</p>
                            {transfer.approvedAt && (
                                <p>Aprobado: {format(new Date(transfer.approvedAt), "dd MMM yyyy HH:mm", { locale: es })}</p>
                            )}
                            {transfer.shippedAt && (
                                <p>Enviado: {format(new Date(transfer.shippedAt), "dd MMM yyyy HH:mm", { locale: es })}</p>
                            )}
                            {transfer.receivedAt && (
                                <p>Recibido: {format(new Date(transfer.receivedAt), "dd MMM yyyy HH:mm", { locale: es })}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <DialogFooter className="flex-col gap-2 sm:flex-row">
                    {transfer.status === "PENDING" && transfer.toBranchId === branchId && (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => handleAction(transfer.id, "reject", { reason: rejectionReason })}
                                disabled={isProcessing}
                                className="min-h-[44px]"
                            >
                                <XCircle className="w-4 h-4 mr-2 text-destructive" />
                                Rechazar
                            </Button>
                            <Button
                                onClick={() => handleAction(transfer.id, "approve")}
                                disabled={isProcessing}
                                className="min-h-[44px]"
                            >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Aprobar
                            </Button>
                        </>
                    )}
                    {transfer.status === "APPROVED" && transfer.fromBranchId === branchId && (
                        <Button
                            onClick={() => handleAction(transfer.id, "ship")}
                            disabled={isProcessing}
                            className="min-h-[44px]"
                        >
                            <Truck className="w-4 h-4 mr-2" />
                            Enviar
                        </Button>
                    )}
                    {transfer.status === "IN_TRANSIT" && transfer.toBranchId === branchId && (
                        <Button
                            onClick={() => {
                                const itemsData = items?.map(item => ({
                                    id: item.id,
                                    receivedQuantity: receivedQuantities[item.id] ?? (item.shippedQuantity || item.requestedQuantity)
                                }));
                                handleAction(transfer.id, "receive", { items: itemsData });
                            }}
                            disabled={isProcessing}
                            className="min-h-[44px]"
                        >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Confirmar Recepción
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        );
    };

    return (
        <div className="space-y-4">
            {/* Search and Role Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por número o sucursal..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 min-h-[44px]"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">Rol:</span>
                    <div 
                        className="flex gap-1 p-1 bg-muted/50 rounded-lg border"
                        role="radiogroup"
                        aria-label="Filtrar transferencias por rol de sucursal"
                    >
                        <Button
                            variant={roleFilter === "both" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setRoleFilter("both")}
                            aria-pressed={roleFilter === "both"}
                            className="text-xs min-h-[36px] px-3"
                        >
                            Todos
                        </Button>
                        <Button
                            variant={roleFilter === "from" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setRoleFilter("from")}
                            aria-pressed={roleFilter === "from"}
                            className="text-xs min-h-[36px] px-3"
                        >
                            Origen
                        </Button>
                        <Button
                            variant={roleFilter === "to" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setRoleFilter("to")}
                            aria-pressed={roleFilter === "to"}
                            className="text-xs min-h-[36px] px-3"
                        >
                            Destino
                        </Button>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="pending" className="w-full">
                <div className="overflow-x-auto pb-1">
                    <TabsList className="grid w-full min-w-[500px] sm:min-w-0 grid-cols-2 md:grid-cols-4 gap-1 h-auto p-1 bg-muted/50 border">
                        <TabsTrigger value="pending" className="min-h-[40px] text-xs font-medium">
                            Pendientes ({pendingTransfers.length})
                        </TabsTrigger>
                        <TabsTrigger value="to-approve" className="min-h-[40px] text-xs font-medium">
                            Por Aprobar ({toApproveTransfers.length})
                        </TabsTrigger>
                        <TabsTrigger value="transit" className="min-h-[40px] text-xs font-medium">
                            En Tránsito ({inTransitTransfers.length})
                        </TabsTrigger>
                        <TabsTrigger value="completed" className="min-h-[40px] text-xs font-medium">
                            Completadas ({completedTransfers.length})
                        </TabsTrigger>
                    </TabsList>
                </div>


                <TabsContent value="pending" className="mt-4">
                    {loading ? (
                        <DataTableSkeleton columns={5} rows={4} />
                    ) : (
                        renderTransferTable(pendingTransfers)
                    )}
                </TabsContent>

                <TabsContent value="to-approve" className="mt-4">
                    {loading ? (
                        <DataTableSkeleton columns={5} rows={4} />
                    ) : (
                        renderTransferTable(toApproveTransfers)
                    )}
                </TabsContent>

                <TabsContent value="transit" className="mt-4">
                    {loading ? (
                        <DataTableSkeleton columns={5} rows={4} />
                    ) : (
                        renderTransferTable(inTransitTransfers)
                    )}
                </TabsContent>

                <TabsContent value="completed" className="mt-4">
                    {loading ? (
                        <DataTableSkeleton columns={5} rows={4} />
                    ) : (
                        renderTransferTable(completedTransfers)
                    )}
                </TabsContent>
            </Tabs>

            {/* Detail Dialog */}
            <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
                {renderTransferDetail()}
            </Dialog>
        </div>
    );
}

