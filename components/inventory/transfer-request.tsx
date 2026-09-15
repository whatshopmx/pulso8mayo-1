"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, ArrowRight, Trash2, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface InventoryProduct {
    id: string;
    name: string;
    unit?: string;
    currentStock?: number;
}

interface TransferItem {
    id: string;
    itemId: string;
    itemName: string;
    quantity: number;
    batchId?: string;
    unit?: string;
    notes?: string;
}

interface TransferRequestProps {
    branches?: Array<{ id: string; name: string }>;
    items?: Array<{ id: string; name: string; unit?: string; stock?: number }>;
    onComplete?: (transfer: any) => void;
    /** Sucursal de origen (alcance del header); la ruta la valida con enforceBranchScope. */
    fromBranchId?: string;
    trigger?: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function TransferRequest({
    branches = [],
    items = [],
    onComplete,
    fromBranchId,
    trigger,
    open: externalOpen,
    onOpenChange: setExternalOpen
}: TransferRequestProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isDialogOpen = externalOpen !== undefined ? externalOpen : internalOpen;
    const setIsDialogOpen = setExternalOpen || setInternalOpen;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);
    const [availableItems, setAvailableItems] = useState<InventoryProduct[]>(items);
    const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>("");
    const [notes, setNotes] = useState<string>("");

    // Selected item IDs set for duplicate prevention
    const selectedItemIds = useMemo(() => {
        return new Set(transferItems.map(i => i.itemId).filter(Boolean));
    }, [transferItems]);

    // Destination branches excluding source branch
    const destinationBranches = branches.filter(b => !fromBranchId || b.id !== fromBranchId);

    // Fetch items from backend if not provided as prop
    useEffect(() => {
        if (items && items.length > 0) {
            setAvailableItems(items);
            return;
        }

        if (isDialogOpen) {
            fetchProducts();
        }
    }, [isDialogOpen, fromBranchId, items]);

    const fetchProducts = async () => {
        setIsLoadingProducts(true);
        try {
            const url = fromBranchId
                ? `/api/inventory/products?branchId=${encodeURIComponent(fromBranchId)}`
                : "/api/inventory/products";
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setAvailableItems(
                        data.map((p: any) => ({
                            id: p.id,
                            name: p.name,
                            unit: p.unit || "U",
                            currentStock: p.currentStock ?? p.stock,
                        }))
                    );
                }
            } else {
                toast.error("Error al cargar productos del inventario");
            }
        } catch (err) {
            console.error("Failed to load products for transfer request", err);
            toast.error("No se pudieron cargar los productos");
        } finally {
            setIsLoadingProducts(false);
        }
    };

    // Add item to transfer list
    const addItem = () => {
        setTransferItems(prev => [
            ...prev,
            {
                id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                itemId: "",
                itemName: "",
                quantity: 1,
                unit: "U",
            }
        ]);
    };

    // Remove item from list
    const removeItem = (id: string) => {
        setTransferItems(prev => prev.filter(i => i.id !== id));
    };

    // Update item field
    const updateItem = (id: string, field: keyof TransferItem, value: any) => {
        setTransferItems(prev => {
            return prev.map(item => {
                if (item.id !== id) return item;
                const updated = { ...item, [field]: value };
                if (field === "itemId") {
                    const selectedItem = availableItems.find(i => i.id === value);
                    if (selectedItem) {
                        updated.itemName = selectedItem.name;
                        updated.unit = selectedItem.unit || "U";
                    }
                }
                return updated;
            });
        });
    };

    // Submit transfer request
    const handleSubmit = async () => {
        if (!selectedBranch) {
            toast.error("Selecciona una sucursal de destino");
            return;
        }

        if (transferItems.length === 0) {
            toast.error("Agrega al menos un item a transferir");
            return;
        }

        const invalidItems = transferItems.filter(item => !item.itemId || item.quantity <= 0);
        if (invalidItems.length > 0) {
            toast.error("Completa todos los campos requeridos (item y cantidad > 0)");
            return;
        }

        setIsSubmitting(true);

        try {
            const response = await fetch("/api/inventory/transfers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fromBranchId: fromBranchId || undefined,
                    toBranchId: selectedBranch,
                    items: transferItems.map(item => ({
                        itemId: item.itemId,
                        requestedQuantity: item.quantity,
                        notes: item.notes,
                    })),
                    notes: notes || undefined,
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Error al crear solicitud de transferencia");
            }

            toast.success("Solicitud de transferencia creada exitosamente");
            
            if (onComplete) {
                onComplete(result.transfer);
            }

            // Reset form
            setTransferItems([]);
            setSelectedBranch("");
            setNotes("");
            setIsDialogOpen(false);

        } catch (error: any) {
            console.error("Transfer error:", error);
            toast.error(error.message || "Error al crear solicitud de transferencia");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            {trigger ? (
                <DialogTrigger asChild>{trigger}</DialogTrigger>
            ) : (
                <DialogTrigger asChild>
                    <Button className="gap-2 min-h-[44px]">
                        <ArrowRight className="w-4 h-4" />
                        Solicitar Transferencia
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Solicitar Transferencia de Inventario</DialogTitle>
                    <DialogDescription>
                        Solicita transferencia de items desde tu sucursal actual a otra sucursal.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Destination Branch */}
                    <div className="space-y-2">
                        <Label htmlFor="destination-branch">Sucursal de Destino *</Label>
                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                            <SelectTrigger id="destination-branch" className="min-h-[44px]">
                                <SelectValue placeholder="Seleccionar sucursal de destino" />
                            </SelectTrigger>
                            <SelectContent>
                                {destinationBranches.length === 0 ? (
                                    <div className="p-3 text-sm text-muted-foreground text-center">
                                        No hay otras sucursales disponibles
                                    </div>
                                ) : (
                                    destinationBranches.map(branch => (
                                        <SelectItem key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Items List */}
                    <Card className="border">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base font-semibold">Items a Transferir</CardTitle>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={addItem}
                                    className="gap-2 min-h-[36px]"
                                    disabled={isLoadingProducts}
                                >
                                    <Package className="w-4 h-4" />
                                    Agregar Item
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isLoadingProducts ? (
                                <div className="flex items-center justify-center p-6 text-sm text-muted-foreground gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                    Cargando catálogo de productos...
                                </div>
                            ) : transferItems.length === 0 ? (
                                <Alert className="bg-muted/30">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        No hay items agregados. Haz clic en "Agregar Item" para seleccionar productos.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                transferItems.map((item) => {
                                    const selectedProduct = availableItems.find(p => p.id === item.itemId);
                                    const isExceedingStock = selectedProduct?.currentStock !== undefined && item.quantity > selectedProduct.currentStock;

                                    return (
                                        <div
                                            key={item.id}
                                            className="p-4 border rounded-lg space-y-3 bg-muted/30"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 grid gap-3 md:grid-cols-3">
                                                    <div className="space-y-2">
                                                        <Label htmlFor={`select-item-${item.id}`}>Producto *</Label>
                                                        <Select
                                                            value={item.itemId}
                                                            onValueChange={(value) => updateItem(item.id, "itemId", value)}
                                                        >
                                                            <SelectTrigger id={`select-item-${item.id}`} className="min-h-[44px]">
                                                                <SelectValue placeholder="Seleccionar producto" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {availableItems.map(i => {
                                                                    const isSelectedElsewhere = selectedItemIds.has(i.id) && item.itemId !== i.id;
                                                                    return (
                                                                        <SelectItem key={i.id} value={i.id} disabled={isSelectedElsewhere}>
                                                                            {i.name} {i.currentStock !== undefined ? `(Stock: ${i.currentStock} ${i.unit || 'U'})` : ''}
                                                                        </SelectItem>
                                                                    );
                                                                })}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <Label htmlFor={`qty-item-${item.id}`}>Cantidad ({item.unit || 'U'}) *</Label>
                                                            {isExceedingStock && (
                                                                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                                                    Excede stock ({selectedProduct.currentStock})
                                                                </span>
                                                            )}
                                                        </div>
                                                        <Input
                                                            id={`qty-item-${item.id}`}
                                                            type="number"
                                                            min="0.01"
                                                            step="any"
                                                            value={item.quantity || ""}
                                                            onChange={(e) => updateItem(item.id, "quantity", Number(e.target.value))}
                                                            placeholder="1"
                                                            className={`min-h-[44px] ${isExceedingStock ? "border-amber-500 focus-visible:ring-amber-500" : ""}`}
                                                        />
                                                    </div>
                                                    <div className="flex items-end justify-between md:justify-end gap-2">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => removeItem(item.id)}
                                                            aria-label="Eliminar item"
                                                            className="shrink-0 h-11 w-11 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                        >
                                                            <Trash2 className="w-5 h-5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label htmlFor={`notes-item-${item.id}`}>Notas del Item (Opcional)</Label>
                                                <Input
                                                    id={`notes-item-${item.id}`}
                                                    value={item.notes || ""}
                                                    onChange={(e) => updateItem(item.id, "notes", e.target.value)}
                                                    placeholder="Ej. Lote preferente, empaque sellado..."
                                                    className="min-h-[40px]"
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>

                    {/* General Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="general-transfer-notes">Notas Generales de la Solicitud</Label>
                        <textarea
                            id="general-transfer-notes"
                            className="w-full min-h-[80px] p-3 border rounded-md bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="Notas o instrucciones especiales para el envío..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={() => setIsDialogOpen(false)}
                        disabled={isSubmitting}
                        className="min-h-[44px]"
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || transferItems.length === 0 || !selectedBranch}
                        className="gap-2 min-h-[44px]"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Enviando...
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4" />
                                Enviar Solicitud
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

