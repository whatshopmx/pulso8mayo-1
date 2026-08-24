"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, ArrowRight, Trash2, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TransferItem {
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
}

export function TransferRequest({ branches = [], items = [], onComplete, fromBranchId }: TransferRequestProps) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>("");
    const [notes, setNotes] = useState<string>("");

    // Add item to transfer list
    const addItem = () => {
        setTransferItems(prev => [
            ...prev,
            {
                itemId: "",
                itemName: "",
                quantity: 0,
                unit: "UNIT",
            }
        ]);
    };

    // Remove item from list
    const removeItem = (index: number) => {
        setTransferItems(prev => prev.filter((_, i) => i !== index));
    };

    // Update item field
    const updateItem = (index: number, field: keyof TransferItem, value: any) => {
        setTransferItems(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            
            // If updating itemId, also update itemName and unit from the items list
            if (field === "itemId") {
                const selectedItem = items.find(item => item.id === value);
                if (selectedItem) {
                    updated[index].itemName = selectedItem.name;
                    updated[index].unit = selectedItem.unit;
                }
            }
            
            return updated;
        });
    };

    // Submit transfer request
    const handleSubmit = async () => {
        // Validate
        if (!selectedBranch) {
            toast.error("Selecciona una sucursal de destino");
            return;
        }

        if (transferItems.length === 0) {
            toast.error("Agrega al menos un item");
            return;
        }

        const invalidItems = transferItems.filter(item => !item.itemId || item.quantity <= 0);
        if (invalidItems.length > 0) {
            toast.error("Completa todos los campos requeridos (item y cantidad)");
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
                throw new Error(result.error || "Failed to create transfer");
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
            <DialogTrigger asChild>
                <Button className="gap-2">
                    <ArrowRight className="w-4 h-4" />
                    Solicitar Transferencia
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Solicitar Transferencia de Inventario</DialogTitle>
                    <DialogDescription>
                        Solicita transferencia de items a otra sucursal
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Destination Branch */}
                    <div className="space-y-2">
                        <Label htmlFor="branch">Sucursal de Destino *</Label>
                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccionar sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map(branch => (
                                    <SelectItem key={branch.id} value={branch.id}>
                                        {branch.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Items List */}
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base">Items a Transferir</CardTitle>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={addItem}
                                    className="gap-2"
                                >
                                    <Package className="w-4 h-4" />
                                    Agregar Item
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {transferItems.length === 0 ? (
                                <Alert>
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        No hay items agregados. Usa "Agregar Item" para comenzar.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                transferItems.map((item, index) => (
                                    <div
                                        key={index}
                                        className="p-4 border rounded-lg space-y-3 bg-card"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 grid gap-3 md:grid-cols-3">
                                                <div className="space-y-2">
                                                    <Label>Item *</Label>
                                                    <Select
                                                        value={item.itemId}
                                                        onValueChange={(value) => updateItem(index, "itemId", value)}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Seleccionar item" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {items.map(i => (
                                                                <SelectItem key={i.id} value={i.id}>
                                                                    {i.name} {i.stock !== undefined && `(Stock: ${i.stock})`}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Cantidad ({item.unit || 'units'}) *</Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity || ""}
                                                        onChange={(e) => updateItem(index, "quantity", Number(e.target.value))}
                                                        placeholder="0"
                                                    />
                                                </div>
                                                <div className="flex items-end">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeItem(index)}
                                                        className="shrink-0"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Notas (Opcional)</Label>
                                            <Input
                                                value={item.notes || ""}
                                                onChange={(e) => updateItem(index, "notes", e.target.value)}
                                                placeholder="Notas adicionales sobre este item..."
                                            />
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    {/* General Notes */}
                    <div className="space-y-2">
                        <Label htmlFor="notes">Notas / Comentarios</Label>
                        <textarea
                            id="notes"
                            className="w-full min-h-[80px] p-3 border rounded-md bg-background text-sm resize-y"
                            placeholder="Notas generales sobre esta transferencia..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => setIsDialogOpen(false)}
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || transferItems.length === 0 || !selectedBranch}
                        className="gap-2"
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
