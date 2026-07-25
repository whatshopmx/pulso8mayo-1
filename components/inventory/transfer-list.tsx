"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
    ArrowRight, 
    CheckCircle, 
    XCircle, 
    Truck, 
    Package, 
    Clock, 
    AlertCircle,
    Loader2,
    Eye,
    Search
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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
}

export function TransferList({ branchId, branches = [] }: TransferListProps) {
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [actionType, setActionType] = useState<"approve" | "reject" | "ship" | "receive" | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [rejectionReason, setRejectionReason] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});

    // Fetch transfers
    useEffect(() => {
        fetchTransfers();
    }, [branchId]);

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
            const response = await fetch(`/api/inventory/transfers?role=both`);
            const result = await response.json();

            if (response.ok) {
                setTransfers(result.transfers);
            } else {
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
            <Badge variant={config.variant} className="gap-1">
                <Icon className="w-3 h-3" />
                {config.label}
            </Badge>
        );
    };

    // Get branch name
    const getBranchName = (id: string) => {
        return branches.find(b => b.id === id)?.name || id;
    };

    // Filter transfers
    const filteredTransfers = transfers.filter(t => 
        t.transfer.transferNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getBranchName(t.transfer.toBranchId).toLowerCase().includes(searchTerm.toLowerCase()) ||
        getBranchName(t.transfer.fromBranchId).toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Group transfers by status
    const pendingTransfers = filteredTransfers.filter(t => t.transfer.status === "PENDING" && t.transfer.fromBranchId === branchId);
    const toApproveTransfers = filteredTransfers.filter(t => t.transfer.status === "PENDING" && t.transfer.toBranchId === branchId);
    const inTransitTransfers = filteredTransfers.filter(t => t.transfer.status === "IN_TRANSIT");
    const completedTransfers = filteredTransfers.filter(t => ["COMPLETED", "REJECTED", "CANCELLED"].includes(t.transfer.status));

    const renderTransferTable = (transferList: Transfer[]) => (
        <div className="space-y-2">
            {transferList.length === 0 ? (
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                        No hay transferencias en esta categoría.
                    </AlertDescription>
                </Alert>
            ) : (
                transferList.map(({ transfer, items }) => (
                    <Card key={transfer.id}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <p className="font-semibold">{transfer.transferNumber}</p>
                                        {getStatusBadge(transfer.status)}
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <ArrowRight className="w-3 h-3" />
                                        <span>{getBranchName(transfer.fromBranchId)}</span>
                                        <span>→</span>
                                        <span>{getBranchName(transfer.toBranchId)}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Solicitado: {format(new Date(transfer.requestedAt), "dd MMM yyyy", { locale: es })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            handleOpenDetail({ transfer, items });
                                        }}
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
                    <DialogTitle>Transferencia {transfer.transferNumber}</DialogTitle>
                    <DialogDescription>
                        {getBranchName(transfer.fromBranchId)} → {getBranchName(transfer.toBranchId)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Status */}
                    <div className="flex items-center gap-2">
                        <Label>Estado:</Label>
                        {getStatusBadge(transfer.status)}
                    </div>

                    {/* Items */}
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Items</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {items?.map((item: any, idx: number) => {
                                    const maxQty = item.shippedQuantity !== null && item.shippedQuantity !== undefined
                                        ? parseFloat(item.shippedQuantity)
                                        : parseFloat(item.requestedQuantity || "0");
                                        
                                    return (
                                        <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded gap-2">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <Package className="w-4 h-4 text-muted-foreground" />
                                                    <span className="text-sm font-semibold">{item.itemName || "Desconocido"}</span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    SKU: {item.itemSku || 'N/A'} • Solicitado: {item.requestedQuantity} {item.itemUnit || 'U'}
                                                    {item.shippedQuantity !== null && item.shippedQuantity !== undefined && ` • Enviado: ${item.shippedQuantity}`}
                                                </div>
                                            </div>
                                            
                                            {transfer.status === "IN_TRANSIT" && transfer.toBranchId === branchId ? (
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Label htmlFor={`qty-${item.id}`} className="text-xs">Recibido:</Label>
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
                                                        className="w-24 h-8 text-right"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="text-sm font-medium text-right">
                                                    {transfer.status === "COMPLETED" ? (
                                                        <span className="text-emerald-700 font-semibold">
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
                            <Label>Notas:</Label>
                            <p className="text-sm text-muted-foreground p-2 border rounded bg-muted">
                                {transfer.notes}
                            </p>
                        </div>
                    )}

                    {/* Rejection input */}
                    {transfer.status === "PENDING" && transfer.toBranchId === branchId && (
                        <div className="space-y-2">
                            <Label htmlFor="rejection-reason">Motivo de Rechazo (si se rechaza):</Label>
                            <Input
                                id="rejection-reason"
                                placeholder="Escribe el motivo..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
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
                        <Label>Historial:</Label>
                        <div className="space-y-1 text-xs text-muted-foreground">
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
                            >
                                <XCircle className="w-4 h-4 mr-2" />
                                Rechazar
                            </Button>
                            <Button
                                onClick={() => handleAction(transfer.id, "approve")}
                                disabled={isProcessing}
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
            {/* Search */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar transferencia..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="pending" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="pending">Pendientes ({pendingTransfers.length})</TabsTrigger>
                    <TabsTrigger value="to-approve">Por Aprobar ({toApproveTransfers.length})</TabsTrigger>
                    <TabsTrigger value="transit">En Tránsito ({inTransitTransfers.length})</TabsTrigger>
                    <TabsTrigger value="completed">Completadas ({completedTransfers.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="pending">
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                    ) : (
                        renderTransferTable(pendingTransfers)
                    )}
                </TabsContent>

                <TabsContent value="to-approve">
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                    ) : (
                        renderTransferTable(toApproveTransfers)
                    )}
                </TabsContent>

                <TabsContent value="transit">
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                    ) : (
                        renderTransferTable(inTransitTransfers)
                    )}
                </TabsContent>

                <TabsContent value="completed">
                    {loading ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
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
