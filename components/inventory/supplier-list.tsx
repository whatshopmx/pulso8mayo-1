"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DataTableSkeleton } from "@/components/shared/skeletons";
import { 
    Plus, 
    Search, 
    Building2, 
    Mail, 
    Phone, 
    MapPin, 
    FileText,
    CalendarClock,
    Edit,
    Trash2,
    Eye,
    AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { SupplierForm } from "./supplier-form";
import { SupplierDetail } from "./supplier-detail";
import { paymentConditionsLabel } from "@/lib/inventory/supplier-payment";

interface Supplier {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxId?: string;
    active: boolean;
    matchTolerancePercent?: number;
    /** Días de crédito acordados. 0 = pago de contado. */
    paymentTermsDays?: number;
    /** Forma de pago acordada. null = sin especificar. */
    paymentMethod?: string | null;
    payeeId?: string | null;
    payeeName?: string | null;
    createdAt: string;
    updatedAt: string;
}

interface SupplierListProps {
    companyId?: string;
}

export function SupplierList({ companyId }: SupplierListProps) {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

    const fetchSuppliers = async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/inventory/suppliers?search=${searchTerm}&active=false`);
            const result = await response.json();

            if (response.ok) {
                setSuppliers(result.suppliers);
            } else {
                toast.error(result.error || "Failed to fetch suppliers");
            }
        } catch (error) {
            console.error("Fetch suppliers error:", error);
            toast.error("Error al cargar proveedores");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            fetchSuppliers();
        }, 300);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, companyId]);

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`¿Estás seguro de que quieres eliminar a "${name}"?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/inventory/suppliers/${id}`, {
                method: "DELETE",
            });

            if (response.ok) {
                toast.success("Proveedor eliminado exitosamente");
                fetchSuppliers();
            } else {
                const result = await response.json();
                toast.error(result.error || "Failed to delete supplier");
            }
        } catch (error) {
            console.error("Delete supplier error:", error);
            toast.error("Error al eliminar proveedor");
        }
    };

    const handleEdit = (supplier: Supplier) => {
        setEditingSupplier(supplier);
        setIsFormOpen(true);
    };

    const handleView = (supplier: Supplier) => {
        setSelectedSupplier(supplier);
        setIsDetailOpen(true);
    };

    const handleFormSuccess = () => {
        setIsFormOpen(false);
        setEditingSupplier(null);
        fetchSuppliers();
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por nombre, RFC, email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                </div>
                <Dialog open={isFormOpen} onOpenChange={(open) => {
                    setIsFormOpen(open);
                    if (!open) setEditingSupplier(null);
                }}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="w-4 h-4" />
                            Nuevo Proveedor
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
                            <DialogDescription>
                                {editingSupplier ? "Actualiza la información del proveedor" : "Agrega un nuevo proveedor a tu lista"}
                            </DialogDescription>
                        </DialogHeader>
                        <SupplierForm
                            supplier={editingSupplier || undefined}
                            onSuccess={handleFormSuccess}
                            onCancel={() => {
                                setIsFormOpen(false);
                                setEditingSupplier(null);
                            }}
                        />
                    </DialogContent>
                </Dialog>
            </div>

            {/* Suppliers List */}
            {loading ? (
                <DataTableSkeleton columns={4} rows={6} />
            ) : suppliers.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center">
                        <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                        <h3 className="text-lg font-semibold mb-2">No hay proveedores</h3>
                        <p className="text-muted-foreground mb-4">
                            {searchTerm 
                                ? "No se encontraron proveedores que coincidan con tu búsqueda."
                                : "Comienza agregando tu primer proveedor."
                            }
                        </p>
                        {!searchTerm && (
                            <Button onClick={() => setIsFormOpen(true)}>
                                <Plus className="w-4 h-4 mr-2" />
                                Agregar Proveedor
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {suppliers.map((supplier) => (
                        <Card key={supplier.id} className="relative">
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1 flex-1">
                                        <div className="flex items-center gap-2">
                                            <CardTitle className="text-lg">{supplier.name}</CardTitle>
                                            {!supplier.active && (
                                                <Badge variant="secondary" className="text-xs">
                                                    Inactivo
                                                </Badge>
                                            )}
                                        </div>
                                        {supplier.taxId && (
                                            <p className="text-xs text-muted-foreground">
                                                RFC: {supplier.taxId}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {supplier.contactName && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Building2 className="w-3 h-3" />
                                        <span>{supplier.contactName}</span>
                                    </div>
                                )}
                                {supplier.email && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Mail className="w-3 h-3" />
                                        <span className="truncate">{supplier.email}</span>
                                    </div>
                                )}
                                {supplier.phone && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Phone className="w-3 h-3" />
                                        <span>{supplier.phone}</span>
                                    </div>
                                )}
                                {supplier.address && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <MapPin className="w-3 h-3" />
                                        <span className="truncate">{supplier.address}</span>
                                    </div>
                                )}
                                {/* Condiciones de pago: de aquí sale el vencimiento de cada
                                    factura recibida, así que vale verlo sin abrir el detalle. */}
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <CalendarClock className="w-3 h-3" />
                                    <span>{paymentConditionsLabel(supplier.paymentTermsDays, supplier.paymentMethod)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs pt-1">
                                    <span className="text-muted-foreground">Contraparte:</span>
                                    {supplier.payeeName ? (
                                        <Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/5">
                                            {supplier.payeeName}
                                        </Badge>
                                    ) : (
                                        <span className="text-muted-foreground/50 italic">Sin vincular</span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleView(supplier)}
                                    >
                                        <Eye className="w-3 h-3" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleEdit(supplier)}
                                    >
                                        <Edit className="w-3 h-3" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleDelete(supplier.id, supplier.name)}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Detail Dialog */}
            {isDetailOpen && selectedSupplier && (
                <SupplierDetail
                    supplier={selectedSupplier}
                    open={isDetailOpen}
                    onOpenChange={setIsDetailOpen}
                    onEdit={() => {
                        setIsDetailOpen(false);
                        handleEdit(selectedSupplier);
                    }}
                />
            )}
        </div>
    );
}
