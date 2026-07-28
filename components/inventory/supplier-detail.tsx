"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
    Building2, 
    Mail, 
    Phone, 
    MapPin, 
    FileText,
    Calendar,
    Edit,
    X,
    Plus,
    Trash2,
    ClipboardCheck,
    TrendingDown,
    ShieldAlert,
    TrendingUp,
    History,
    Sparkles,
    Clock,
    AlertTriangle,
    Loader2
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { SupplierItemDialog } from "./supplier-item-dialog";

interface Supplier {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxId?: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

interface SupplierDetailProps {
    supplier: Supplier;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onEdit?: () => void;
}

interface SupplierItem {
    id: string;
    itemId: string;
    name: string;
    category: string | null;
    unit: string;
    supplierSku: string | null;
    price: number | null;
    presentation: string | null;
    leadTimeDays: number;
    baseLastCost: number | null;
}

interface PurchaseOrder {
    id: string;
    poNumber: string;
    status: string;
    totalAmount: number;
    createdAt: string;
}

interface SupplierClaim {
    id: string;
    claimNumber: string;
    status: string;
    type: string;
    totalAmount: number;
    description: string | null;
    createdAt: string;
}

interface SupplierMetrics {
    totalOrders: number;
    completedOrders: number;
    totalSpend: number;
    totalClaims: number;
    resolvedClaims: number;
    totalClaimImpact: number;
    accuracyRate: number;
}

export function SupplierDetail({ supplier, open, onOpenChange, onEdit }: SupplierDetailProps) {
    const [activeTab, setActiveTab] = useState("general");
    const [supplierItemsList, setSupplierItemsList] = useState<SupplierItem[]>([]);
    const [loadingItems, setLoadingItems] = useState(false);
    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

    // Purchase History & Metrics states
    const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
    const [claims, setClaims] = useState<SupplierClaim[]>([]);
    const [metrics, setMetrics] = useState<SupplierMetrics | null>(null);
    const [loadingMetrics, setLoadingMetrics] = useState(false);

    const fetchSupplierItems = async () => {
        if (!supplier.id) return;
        setLoadingItems(true);
        try {
            const res = await fetch(`/api/inventory/suppliers/${supplier.id}/items`);
            if (res.ok) {
                const data = await res.json();
                setSupplierItemsList(data.items || []);
            } else {
                toast.error("Error al cargar el catálogo del proveedor");
            }
        } catch (err) {
            console.error("Fetch supplier items error:", err);
        } finally {
            setLoadingItems(false);
        }
    };

    const fetchMetricsAndHistory = async () => {
        if (!supplier.id) return;
        setLoadingMetrics(true);
        try {
            const res = await fetch(`/api/inventory/suppliers/${supplier.id}/metrics`);
            if (res.ok) {
                const data = await res.json();
                setPurchases(data.purchases || []);
                setClaims(data.claims || []);
                setMetrics(data.metrics || null);
            } else {
                toast.error("Error al cargar historial y métricas");
            }
        } catch (err) {
            console.error("Fetch metrics error:", err);
        } finally {
            setLoadingMetrics(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setActiveTab("general");
        fetchSupplierItems();
        fetchMetricsAndHistory();
    }, [supplier.id, open]);

    const handleUnlinkItem = async (itemId: string, itemName: string) => {
        if (!confirm(`¿Estás seguro de desvincular "${itemName}" de este proveedor?`)) {
            return;
        }

        try {
            const res = await fetch(`/api/inventory/suppliers/${supplier.id}/items?itemId=${itemId}`, {
                method: "DELETE"
            });
            if (res.ok) {
                toast.success("Insumo desvinculado con éxito");
                fetchSupplierItems();
            } else {
                const data = await res.json();
                toast.error(data.error || "Error al desvincular insumo");
            }
        } catch (err) {
            console.error("Unlink item error:", err);
            toast.error("Error de red al desvincular insumo");
        }
    };

    // PO Status translates and colors
    const getPoStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            DRAFT: "bg-gray-100 text-gray-800 border-gray-200",
            PENDING_APPROVAL: "bg-blue-50 text-blue-700 border-blue-200",
            APPROVED: "bg-purple-50 text-purple-700 border-purple-200",
            SENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
            PARTIALLY_RECEIVED: "bg-amber-50 text-amber-700 border-amber-200",
            CLOSED: "bg-emerald-50 text-emerald-700 border-emerald-200",
            RECEIVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
            CANCELLED: "bg-red-50 text-red-700 border-red-200",
        };
        const labels: Record<string, string> = {
            DRAFT: "Borrador",
            PENDING_APPROVAL: "Por Aprobar",
            APPROVED: "Aprobada",
            SENT: "Enviada",
            PARTIALLY_RECEIVED: "Recepción Parcial",
            CLOSED: "Cerrada",
            RECEIVED: "Recibida",
            CANCELLED: "Cancelada",
        };
        return (
            <Badge variant="outline" className={`font-mono text-xs ${colors[status] || ""}`}>
                {labels[status] || status}
            </Badge>
        );
    };

    // Claim Status translates
    const getClaimStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            OPEN: "bg-red-50 text-red-700 border-red-200",
            IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
            RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
            CLOSED: "bg-gray-100 text-gray-800 border-gray-200",
        };
        const labels: Record<string, string> = {
            OPEN: "Abierto",
            IN_PROGRESS: "En Proceso",
            RESOLVED: "Resuelto",
            CLOSED: "Cerrado",
        };
        return (
            <Badge variant="outline" className={`font-mono text-xs ${colors[status] || ""}`}>
                {labels[status] || status}
            </Badge>
        );
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col p-6">
                    <DialogHeader>
                        <div className="flex items-start justify-between">
                            <div className="space-y-1">
                                <DialogTitle className="text-xl flex items-center gap-2">
                                    <Building2 className="w-5 h-5 text-primary" />
                                    {supplier.name}
                                </DialogTitle>
                                <DialogDescription>
                                    Gestión completa, catálogo, compras e incidencias
                                </DialogDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                {!supplier.active && (
                                    <Badge variant="destructive">Inactivo</Badge>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onOpenChange(false)}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </DialogHeader>

                    <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 flex-1">
                        <TabsList className="grid grid-cols-4 w-full">
                            <TabsTrigger value="general">Información General</TabsTrigger>
                            <TabsTrigger value="catalog">Catálogo de Insumos</TabsTrigger>
                            <TabsTrigger value="purchases">Historial de Compras</TabsTrigger>
                            <TabsTrigger value="evaluation">Desempeño y Reclamos</TabsTrigger>
                        </TabsList>

                        {/* TAB 1: General Info */}
                        <TabsContent value="general" className="space-y-4 pt-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Building2 className="w-4 h-4 text-muted-foreground" />
                                            Identificación Fiscal
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm font-medium">RFC:</span>
                                            <span className="text-sm text-muted-foreground font-mono">{supplier.taxId || "No Registrado"}</span>
                                        </div>
                                        {supplier.contactName && (
                                            <div className="flex items-center gap-2">
                                                <Building2 className="w-4 h-4 text-muted-foreground" />
                                                <span className="text-sm font-medium">Contacto:</span>
                                                <span className="text-sm text-muted-foreground">{supplier.contactName}</span>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <Mail className="w-4 h-4 text-muted-foreground" />
                                            Contacto Comercial
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {supplier.email && (
                                            <div className="flex items-center gap-2">
                                                <Mail className="w-4 h-4 text-muted-foreground" />
                                                <span className="text-sm font-medium">Email:</span>
                                                <a href={`mailto:${supplier.email}`} className="text-sm text-blue-600 hover:underline">
                                                    {supplier.email}
                                                </a>
                                            </div>
                                        )}
                                        {supplier.phone && (
                                            <div className="flex items-center gap-2">
                                                <Phone className="w-4 h-4 text-muted-foreground" />
                                                <span className="text-sm font-medium">Teléfono:</span>
                                                <a href={`tel:${supplier.phone}`} className="text-sm text-blue-600 hover:underline">
                                                    {supplier.phone}
                                                </a>
                                            </div>
                                        )}
                                        {supplier.address && (
                                            <div className="flex items-center gap-2">
                                                <MapPin className="w-4 h-4 text-muted-foreground" />
                                                <span className="text-sm font-medium">Dirección:</span>
                                                <span className="text-sm text-muted-foreground">{supplier.address}</span>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>

                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-muted-foreground" />
                                        Registro en Sistema
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="text-muted-foreground block text-xs">Fecha de Alta</span>
                                        <span className="font-medium">{format(new Date(supplier.createdAt), "dd MMMM yyyy", { locale: es })}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block text-xs">Última Modificación</span>
                                        <span className="font-medium">{format(new Date(supplier.updatedAt), "dd MMMM yyyy HH:mm", { locale: es })}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* TAB 2: Catalog */}
                        <TabsContent value="catalog" className="space-y-4 pt-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-semibold">Productos Surtidos ({supplierItemsList.length})</h3>
                                <Button size="sm" className="gap-1" onClick={() => setIsLinkDialogOpen(true)}>
                                    <Plus className="w-4 h-4" /> Vincular Insumo
                                </Button>
                            </div>

                            {loadingItems ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : supplierItemsList.length === 0 ? (
                                <div className="text-center py-12 border border-dashed rounded-lg">
                                    <FileText className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                                    <p className="text-sm text-muted-foreground">No hay insumos vinculados a este proveedor.</p>
                                    <Button variant="outline" size="sm" className="mt-4" onClick={() => setIsLinkDialogOpen(true)}>
                                        Vincular primer insumo
                                    </Button>
                                </div>
                            ) : (
                                <div className="border rounded-md overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Nombre</TableHead>
                                                <TableHead>SKU Proveedor</TableHead>
                                                <TableHead>Presentación</TableHead>
                                                <TableHead>Costo Pactado</TableHead>
                                                <TableHead>Lead Time</TableHead>
                                                <TableHead className="text-right">Acción</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {supplierItemsList.map((item) => (
                                                <TableRow key={item.id}>
                                                    <TableCell className="font-medium">
                                                        <div>{item.name}</div>
                                                        <div className="text-[10px] text-muted-foreground capitalize">{item.category || "Insumo"} • {item.unit}</div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">{item.supplierSku || "—"}</TableCell>
                                                    <TableCell>{item.presentation || "—"}</TableCell>
                                                    <TableCell className="font-mono font-semibold">
                                                        {item.price ? `$${item.price.toFixed(2)}` : "—"}
                                                    </TableCell>
                                                    <TableCell className="font-mono">{item.leadTimeDays} días</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleUnlinkItem(item.itemId, item.name)}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </TabsContent>

                        {/* TAB 3: Purchases */}
                        <TabsContent value="purchases" className="space-y-4 pt-4">
                            <h3 className="text-sm font-semibold">Órdenes de Compra Realizadas ({purchases.length})</h3>

                            {loadingMetrics ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : purchases.length === 0 ? (
                                <div className="text-center py-12 border border-dashed rounded-lg">
                                    <History className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                                    <p className="text-sm text-muted-foreground">No hay órdenes de compra registradas para este proveedor.</p>
                                </div>
                            ) : (
                                <div className="border rounded-md overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Número de OC</TableHead>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead>Estado</TableHead>
                                                <TableHead className="text-right">Monto Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {purchases.map((po) => (
                                                <TableRow key={po.id}>
                                                    <TableCell className="font-bold">{po.poNumber}</TableCell>
                                                    <TableCell className="text-xs">
                                                        {format(new Date(po.createdAt), "dd/MM/yyyy HH:mm", { locale: es })}
                                                    </TableCell>
                                                    <TableCell>{getPoStatusBadge(po.status)}</TableCell>
                                                    <TableCell className="text-right font-mono font-bold">
                                                        ${po.totalAmount.toFixed(2)}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </TabsContent>

                        {/* TAB 4: Evaluation */}
                        <TabsContent value="evaluation" className="space-y-6 pt-4">
                            {loadingMetrics ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <>
                                    {/* Dashboard metrics widgets */}
                                    {metrics && (
                                        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                                            <Card className="bg-muted/10">
                                                <CardHeader className="pb-1">
                                                    <span className="text-xs text-muted-foreground">Efectividad de Entrega</span>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="text-2xl font-bold flex items-center gap-2">
                                                        <ClipboardCheck className={`w-5 h-5 ${metrics.accuracyRate > 90 ? "text-emerald-500" : metrics.accuracyRate > 75 ? "text-amber-500" : "text-destructive"}`} />
                                                        {metrics.accuracyRate}%
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-1">Órdenes sin incidencias</p>
                                                </CardContent>
                                            </Card>

                                            <Card className="bg-muted/10">
                                                <CardHeader className="pb-1">
                                                    <span className="text-xs text-muted-foreground">Monto de Compra Total</span>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="text-2xl font-bold flex items-center gap-2 text-primary">
                                                        <TrendingUp className="w-5 h-5" />
                                                        ${metrics.totalSpend.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-1">Excluye canceladas</p>
                                                </CardContent>
                                            </Card>

                                            <Card className="bg-muted/10">
                                                <CardHeader className="pb-1">
                                                    <span className="text-xs text-muted-foreground">Reclamos Registrados</span>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="text-2xl font-bold flex items-center gap-2">
                                                        <ShieldAlert className={`w-5 h-5 ${metrics.totalClaims > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
                                                        {metrics.totalClaims}
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-1">{metrics.resolvedClaims} resueltos</p>
                                                </CardContent>
                                            </Card>

                                            <Card className="bg-muted/10">
                                                <CardHeader className="pb-1">
                                                    <span className="text-xs text-muted-foreground">Impacto Financiero de Reclamos</span>
                                                </CardHeader>
                                                <CardContent>
                                                    <div className="text-2xl font-bold flex items-center gap-2 text-destructive">
                                                        <TrendingDown className="w-5 h-5" />
                                                        ${metrics.totalClaimImpact.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground mt-1">Pérdidas acumuladas</p>
                                                </CardContent>
                                            </Card>
                                        </div>
                                    )}

                                    {/* Claims Table */}
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-semibold flex items-center gap-2">
                                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                                            Reclamos e Incidencias en Recepción
                                        </h3>
                                        {claims.length === 0 ? (
                                            <div className="text-center py-8 border border-dashed rounded-lg text-xs text-muted-foreground">
                                                El proveedor tiene un desempeño excelente. Cero reclamos registrados.
                                            </div>
                                        ) : (
                                            <div className="border rounded-md overflow-hidden">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Código</TableHead>
                                                            <TableHead>Tipo</TableHead>
                                                            <TableHead>Detalle</TableHead>
                                                            <TableHead>Fecha</TableHead>
                                                            <TableHead>Estado</TableHead>
                                                            <TableHead className="text-right">Importe</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {claims.map((claim) => (
                                                            <TableRow key={claim.id} className="text-xs">
                                                                <TableCell className="font-bold">{claim.claimNumber}</TableCell>
                                                                <TableCell className="capitalize font-mono">{claim.type.toLowerCase()}</TableCell>
                                                                <TableCell className="max-w-[200px] truncate" title={claim.description || ""}>
                                                                    {claim.description || "Sin descripción"}
                                                                </TableCell>
                                                                <TableCell>
                                                                    {format(new Date(claim.createdAt), "dd/MM/yyyy")}
                                                                </TableCell>
                                                                <TableCell>{getClaimStatusBadge(claim.status)}</TableCell>
                                                                <TableCell className="text-right font-mono font-semibold text-destructive">
                                                                    ${claim.totalAmount.toFixed(2)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </TabsContent>
                    </Tabs>

                    <DialogFooter className="mt-6 border-t pt-4">
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cerrar
                        </Button>
                        <Button
                            onClick={() => {
                                onOpenChange(false);
                                onEdit?.();
                            }}
                            className="gap-2"
                        >
                            <Edit className="w-4 h-4" />
                            Editar Proveedor
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* SupplierItemDialog for linking items */}
            <SupplierItemDialog
                supplierId={supplier.id}
                open={isLinkDialogOpen}
                onOpenChange={setIsLinkDialogOpen}
                onSuccess={fetchSupplierItems}
            />
        </>
    );
}
