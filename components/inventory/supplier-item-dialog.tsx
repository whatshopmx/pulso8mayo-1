"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SupplierItemDialogProps {
    supplierId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

interface Product {
    id: string;
    name: string;
    unit: string;
    category?: string;
}

export function SupplierItemDialog({ supplierId, open, onOpenChange, onSuccess }: SupplierItemDialogProps) {
    const [products, setProducts] = useState<Product[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form states
    const [selectedItemId, setSelectedItemId] = useState("");
    const [supplierSku, setSupplierSku] = useState("");
    const [price, setPrice] = useState("");
    const [presentation, setPresentation] = useState("");
    const [leadTimeDays, setLeadTimeDays] = useState("3");

    useEffect(() => {
        if (!open) return;

        const fetchProducts = async () => {
            setLoadingProducts(true);
            try {
                const res = await fetch("/api/inventory/products");
                if (res.ok) {
                    const data = await res.json();
                    setProducts(data || []);
                } else {
                    toast.error("Error al cargar productos");
                }
            } catch (err) {
                console.error("Fetch products error:", err);
                toast.error("Error de red al cargar productos");
            } finally {
                setLoadingProducts(false);
            }
        };

        fetchProducts();

        // Reset form
        setSelectedItemId("");
        setSupplierSku("");
        setPrice("");
        setPresentation("");
        setLeadTimeDays("3");
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedItemId) {
            toast.error("Debes seleccionar un insumo");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/inventory/suppliers/${supplierId}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    itemId: selectedItemId,
                    supplierSku: supplierSku || undefined,
                    price: price ? Number(price) : undefined,
                    presentation: presentation || undefined,
                    leadTimeDays: Number(leadTimeDays),
                }),
            });

            const data = await res.json();
            if (res.ok && data.success) {
                toast.success("Insumo vinculado al proveedor");
                onSuccess?.();
                onOpenChange(false);
            } else {
                toast.error(data.error || "Error al vincular insumo");
            }
        } catch (err) {
            console.error("Link item error:", err);
            toast.error("Error de red al vincular insumo");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Vincular Insumo a Proveedor</DialogTitle>
                    <DialogDescription>
                        Asocia un insumo de tu inventario maestro con este proveedor y define su precio y presentación.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-2">
                    <div className="space-y-2">
                        <Label htmlFor="item-select">Insumo del Inventario *</Label>
                        <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                            <SelectTrigger className="w-full min-h-[44px]">
                                <SelectValue placeholder={loadingProducts ? "Cargando..." : "Selecciona un insumo..."} />
                            </SelectTrigger>
                            <SelectContent className="max-h-[200px]">
                                {products.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.name} ({p.unit})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="supplierSku">SKU del Proveedor</Label>
                            <Input
                                id="supplierSku"
                                value={supplierSku}
                                onChange={(e) => setSupplierSku(e.target.value)}
                                placeholder="Ej: PROV-123"
                                className="min-h-[44px]"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="price">Costo Pactado ($)</Label>
                            <Input
                                id="price"
                                type="number"
                                step="0.01"
                                min="0"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0.00"
                                className="min-h-[44px]"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="presentation">Presentación de Compra</Label>
                            <Input
                                id="presentation"
                                value={presentation}
                                onChange={(e) => setPresentation(e.target.value)}
                                placeholder="Ej: Saco 25kg, Caja 10L"
                                className="min-h-[44px]"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="leadTimeDays">Lead Time (Días)</Label>
                            <Input
                                id="leadTimeDays"
                                type="number"
                                min="0"
                                value={leadTimeDays}
                                onChange={(e) => setLeadTimeDays(e.target.value)}
                                className="min-h-[44px]"
                            />
                        </div>
                    </div>

                    <DialogFooter className="pt-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={submitting || loadingProducts}>
                            {submitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Guardando...
                                </>
                            ) : (
                                "Guardar Insumo"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
