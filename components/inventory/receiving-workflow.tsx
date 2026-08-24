"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDesc, AlertDialogFooter as AlertDialogFt, AlertDialogHeader as AlertDialogHd, AlertDialogTitle as AlertDialogTl } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Scan, PackagePlus, Trash2, CheckCircle, AlertCircle, Loader2, Barcode, Package } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReceivingItem {
    itemId: string;
    itemName: string;
    sku?: string;
    quantity: number;
    orderedQuantity?: number;
    receivedQuantity?: number;
    batchNumber: string;
    expirationDate?: string;
    productionDate?: string;
    unitCost?: number;
    unit?: string;
    temperature?: number | "";
    ocrData?: boolean;
}

interface ReceivingWorkflowProps {
    suppliers?: Array<{ id: string; name: string }>;
    items?: Array<{ id: string; name: string; sku?: string; unit?: string; barcode?: string }>;
    onComplete?: (receiving: any) => void;
    initialPOId?: string;
    /** Alcance del header; la ruta lo valida con enforceBranchScope. */
    branchId?: string;
}

export function ReceivingWorkflow({ suppliers = [], items = [], onComplete, initialPOId, branchId }: ReceivingWorkflowProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isOCRing, setIsOCRing] = useState(false);
    const [receivingItems, setReceivingItems] = useState<ReceivingItem[]>([]);
    const [selectedSupplier, setSelectedSupplier] = useState<string>("");
    const [purchaseOrdersList, setPurchaseOrdersList] = useState<any[]>([]);
    const [selectedPOId, setSelectedPOId] = useState<string>("");
    const [invoicesList, setInvoicesList] = useState<any[]>([]);
    const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
    const [notes, setNotes] = useState<string>("");
    const [scanMode, setScanMode] = useState(false);
    const [scannedBarcode, setScannedBarcode] = useState("");
    const [step, setStep] = useState<"supplier-po" | "items-scan" | "review-submit">("supplier-po");
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [hasPreselected, setHasPreselected] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            handleReset();
        } else {
            setIsDialogOpen(true);
        }
    };

    const handleClose = () => {
        handleReset();
    };

    const resetForm = () => {
        setReceivingItems([]);
        setSelectedSupplier("");
        setSelectedPOId("");
        setNotes("");
        setStep("supplier-po");
        setIsDialogOpen(false);
        setShowCloseConfirm(false);
    };

    const handleReset = () => {
        if (receivingItems.length > 0 || selectedSupplier || selectedPOId || notes) {
            setShowCloseConfirm(true);
        } else {
            resetForm();
        }
    };

    // Fetch open POs on mount
    useEffect(() => {
        fetch("/api/inventory/purchase-orders")
            .then(res => res.ok && res.json())
            .then(data => {
                const poList = data.orders || [];
                const filtered = poList.filter((row: any) => {
                    const po = row.po || row;
                    return ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(po.status);
                }).map((row: any) => {
                    const po = row.po || row;
                    return {
                         id: po.id,
                         poNumber: po.poNumber,
                         supplierName: row.supplierName,
                         supplierId: po.supplierId,
                    };
                });
                setPurchaseOrdersList(filtered);
            })
            .catch(() => {});

        // Candidatas: facturas sin reporte de recepción vinculado todavía
        fetch("/api/inventory/invoices")
            .then(res => res.ok && res.json())
            .then(data => {
                const list = (data.invoices || []).filter((inv: any) => !inv.receivingReportId);
                setInvoicesList(list);
            })
            .catch(() => {});
    }, []);

    const handlePOChange = async (poId: string) => {
        setSelectedPOId(poId === "none" ? "" : poId);
        if (poId === "none" || !poId) {
            setReceivingItems([]);
            return;
        }

        try {
            const res = await fetch(`/api/inventory/purchase-orders/${poId}`);
            if (!res.ok) throw new Error("Failed to fetch PO details");
            const poData = await res.json();
            
            if (poData.supplierId) {
                setSelectedSupplier(poData.supplierId);
                setSelectedInvoiceId("");
            }

            if (poData.items) {
                const mapped: ReceivingItem[] = poData.items.map((poItem: any) => {
                    const matchedItem = items.find(i => i.id === poItem.itemId);
                    const remaining = poItem.orderedQuantity - (poItem.receivedQuantity || 0);
                    return {
                        itemId: poItem.itemId,
                        itemName: matchedItem ? matchedItem.name : (poItem.itemName || "Insumo"),
                        sku: matchedItem?.sku,
                        unit: matchedItem?.unit || "unidades",
                        quantity: Math.max(0, remaining),
                        orderedQuantity: poItem.orderedQuantity,
                        receivedQuantity: poItem.receivedQuantity || 0,
                        batchNumber: `BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        expirationDate: "",
                        productionDate: "",
                        unitCost: poItem.unitCost ? poItem.unitCost / 100 : 0,
                        temperature: "",
                    };
                });
                setReceivingItems(mapped);
            }
        } catch (err) {
            console.error(err);
            toast.error("Error al cargar detalles de la orden de compra");
        }
    };

    useEffect(() => {
        if (initialPOId && items.length > 0 && !hasPreselected) {
            setHasPreselected(true);
            setSelectedPOId(initialPOId);
            handlePOChange(initialPOId);
            setIsDialogOpen(true);
            setStep("items-scan");
        }
    }, [initialPOId, items, hasPreselected]);

    // Add item to receiving list
    const addItem = useCallback(() => {
        setReceivingItems(prev => [
            ...prev,
            {
                itemId: "",
                itemName: "",
                quantity: 0,
                batchNumber: `BATCH-${Date.now()}`,
                expirationDate: "",
                productionDate: "",
                unitCost: 0,
                temperature: "",
            }
        ]);
    }, []);

    // Handle OCR file upload via Moondream
    const handleOCRUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = async () => {
            setIsOCRing(true);
            try {
                const response = await fetch('/api/inventory/ocr', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: reader.result })
                });
                const res = await response.json();
                
                if (!response.ok) throw new Error(res.error || 'Failed to process OCR');
                
                if (res.data?.items) {
                    const newItems: ReceivingItem[] = res.data.items.map((ocrItem: any) => {
                        const matchedItem = items.find(i => i.name.toLowerCase().includes(String(ocrItem.name).toLowerCase()));
                        return {
                            itemId: matchedItem ? matchedItem.id : "",
                            itemName: ocrItem.name || "Desconocido",
                            quantity: Number(ocrItem.quantity) || 1,
                            batchNumber: `BATCH-OCR-${Date.now()}`,
                            expirationDate: "",
                            unitCost: Number(ocrItem.unitPrice) || 0,
                            temperature: "",
                            ocrData: true,
                        };
                    });
                    
                    setReceivingItems(prev => [...prev, ...newItems]);
                    toast.success("Factura escaneada y productos agregados");
                    if (res.data.poNumber && purchaseOrdersList.length > 0) {
                        const matched = purchaseOrdersList.find((p: any) => p.poNumber === res.data.poNumber);
                        if (matched) setSelectedPOId(matched.id);
                    }
                    // Automatically go to step 2 after scanning OCR
                    setStep("items-scan");
                } else {
                    toast.warning("No se encontraron productos en la imagen");
                }
            } catch (error: any) {
                console.error("OCR Error:", error);
                toast.error(error.message || "Error al procesar la imagen con OCR");
            } finally {
                setIsOCRing(false);
                e.target.value = '';
            }
        };
        reader.readAsDataURL(file);
    };

    // Remove item from list
    const removeItem = useCallback((index: number) => {
        setReceivingItems(prev => prev.filter((_, i) => i !== index));
    }, []);

    // Update item field
    const updateItem = useCallback((index: number, field: keyof ReceivingItem, value: any) => {
        setReceivingItems(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            
            if (field === "itemId") {
                const selectedItem = items.find(item => item.id === value);
                if (selectedItem) {
                    updated[index].itemName = selectedItem.name;
                    updated[index].sku = selectedItem.sku;
                    updated[index].unit = selectedItem.unit || "unidades";
                }
            }
            
            return updated;
        });
    }, [items]);

    // Handle barcode scanning
    const handleBarcodeScanned = useCallback((barcode: string) => {
        const foundItem = items.find(item => item.barcode === barcode);
        if (foundItem) {
            const existingIndex = receivingItems.findIndex(
                item => item.itemId === foundItem.id && !item.quantity
            );
            
            if (existingIndex >= 0) {
                updateItem(existingIndex, "quantity", 1);
            } else {
                setReceivingItems(prev => [
                    ...prev,
                    {
                        itemId: foundItem.id,
                        itemName: foundItem.name,
                        sku: foundItem.sku,
                        quantity: 1,
                        batchNumber: `BATCH-${Date.now()}`,
                        expirationDate: "",
                        unit: foundItem.unit || "unidades",
                    }
                ]);
            }
            toast.success(`Item escaneado: ${foundItem.name}`);
        } else {
            toast.error("Barcode no encontrado");
        }
        setScannedBarcode("");
    }, [items, receivingItems, updateItem]);

    // Handle keyboard input for barcode scanner
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && scanMode && scannedBarcode) {
            e.preventDefault();
            handleBarcodeScanned(scannedBarcode);
        }
    }, [scanMode, scannedBarcode, handleBarcodeScanned]);

    // Submit receiving
    const handleSubmit = async () => {
        if (receivingItems.length === 0) {
            toast.error("Agrega al menos un item");
            return;
        }

        const invalidItems = receivingItems.filter(item => !item.itemId || item.quantity <= 0);
        if (invalidItems.length > 0) {
            toast.error("Completa todos los campos requeridos (item y cantidad)");
            return;
        }

        setIsSubmitting(true);

        try {
            const response = await fetch("/api/inventory/receiving", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: receivingItems.map(item => ({
                        itemId: item.itemId,
                        quantity: item.quantity,
                        unit: item.unit || undefined,
                        batchNumber: item.batchNumber,
                        expirationDate: item.expirationDate || undefined,
                        productionDate: item.productionDate || undefined,
                        unitCost: item.unitCost,
                        temperature: item.temperature !== "" ? Number(item.temperature) : undefined,
                    })),
                    supplierId: selectedSupplier || undefined,
                    purchaseOrderId: selectedPOId || undefined,
                    invoiceId: selectedInvoiceId || undefined,
                    branchId: branchId || undefined,
                    notes: notes || undefined,
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Failed to process receiving");
            }

            toast.success("Recepción completada exitosamente");
            
            if (onComplete) {
                onComplete(result.receiving);
            }

            resetForm();
        } catch (error: any) {
            console.error("Receiving error:", error);
            toast.error(error.message || "Error al procesar recepción");
        } finally {
            setIsSubmitting(false);
        }
    };

    const isStep2Valid = receivingItems.length > 0 && receivingItems.every(item => item.itemId && item.quantity > 0);

    // Facturas sin conciliar del proveedor seleccionado
    const availableInvoices = selectedSupplier
        ? invoicesList.filter((inv: any) => inv.supplierId === selectedSupplier)
        : [];

    return (
        <>
            <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
                <DialogTrigger asChild>
                    <Button className="gap-2">
                        <PackagePlus className="w-4 h-4" />
                        Nueva Recepción
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Recepción de Inventario</DialogTitle>
                        <DialogDescription>
                            Registra la recepción de mercancía y controla la calidad de los alimentos.
                        </DialogDescription>
                    </DialogHeader>

                    {/* Stepper Progress Bar */}
                    <div className="flex items-center justify-between border-b pb-4 mb-4">
                        {[
                            { stepKey: "supplier-po", label: "Proveedor & OC" },
                            { stepKey: "items-scan", label: "Insumos & Cantidad" },
                            { stepKey: "review-submit", label: "Calidad & Confirmar" }
                        ].map((s, idx) => {
                            const stepNames = ["supplier-po", "items-scan", "review-submit"];
                            const isActive = step === s.stepKey;
                            const isDone = stepNames.indexOf(step) > idx;
                            return (
                                <div key={s.stepKey} className="flex items-center gap-2">
                                    <span className={cn(
                                        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold border",
                                        isActive && "bg-primary border-primary text-primary-foreground",
                                        isDone && "bg-emerald-100 border-emerald-300 text-emerald-700",
                                        !isActive && !isDone && "bg-muted text-muted-foreground border-border"
                                    )}>
                                        {isDone ? "✓" : idx + 1}
                                    </span>
                                    <span className={cn(
                                        "text-xs font-medium",
                                        isActive && "text-foreground font-semibold",
                                        (isDone || (!isActive && !isDone)) && "text-muted-foreground"
                                    )}>
                                        {s.label}
                                    </span>
                                    {idx < 2 && <span className="text-muted-foreground text-xs mx-1">→</span>}
                                </div>
                            );
                        })}
                    </div>

                    {/* Wizard Step Content */}
                    {step === "supplier-po" && (
                        <div className="space-y-6 py-4">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="supplier">Proveedor *</Label>
                                    <Select
                                        value={selectedSupplier}
                                        onValueChange={(v) => {
                                            setSelectedSupplier(v);
                                            setSelectedInvoiceId("");
                                        }}
                                    >
                                        <SelectTrigger id="supplier">
                                            <SelectValue placeholder="Seleccionar proveedor" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {suppliers.map(supplier => (
                                                <SelectItem key={supplier.id} value={supplier.id}>
                                                    {supplier.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="po">Orden de Compra (Opcional)</Label>
                                    <Select value={selectedPOId || "none"} onValueChange={handlePOChange}>
                                        <SelectTrigger id="po">
                                            <SelectValue placeholder="Seleccionar orden..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">Ninguna (Entrada manual)</SelectItem>
                                            {purchaseOrdersList.map(po => (
                                                <SelectItem key={po.id} value={po.id}>
                                                    {po.poNumber} ({po.supplierName || 'Proveedor'})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="invoice">Factura / CFDI (Opcional)</Label>
                                <Select
                                    value={selectedInvoiceId || "none"}
                                    onValueChange={(v) => setSelectedInvoiceId(v === "none" ? "" : v)}
                                >
                                    <SelectTrigger id="invoice">
                                        <SelectValue placeholder="Seleccionar factura..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Sin factura</SelectItem>
                                        {availableInvoices.map((inv: any) => (
                                            <SelectItem key={inv.id} value={inv.id}>
                                                {inv.serie && `${inv.serie}-`}{inv.folio || 'S/F'}
                                                {' — $'}{((inv.total || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {availableInvoices.length === 0 && selectedSupplier
                                        ? "No hay facturas sin conciliar para este proveedor."
                                        : "Al confirmar la recepción se ejecutará la conciliación (PO vs recepción vs factura)."}
                                </p>
                            </div>

                            <div className="border border-dashed rounded-lg p-6 flex flex-col items-center justify-center bg-muted/30">
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    id="ocr-upload" 
                                    onChange={handleOCRUpload} 
                                    disabled={isOCRing}
                                />
                                <Label htmlFor="ocr-upload" className={cn("cursor-pointer w-full text-center flex flex-col items-center gap-2", isOCRing && "opacity-50 cursor-not-allowed")}>
                                    {isOCRing ? (
                                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                    ) : (
                                        <Scan className="w-8 h-8 text-muted-foreground" />
                                    )}
                                    <span className="font-semibold text-sm">Escaneo de Remisión / Factura con IA</span>
                                    <span className="text-xs text-muted-foreground">Sube una foto de la remisión y la IA extraerá los productos automáticamente</span>
                                </Label>
                            </div>
                        </div>
                    )}

                    {step === "items-scan" && (
                        <div className="space-y-4 py-4">
                            {/* Scan Mode */}
                            <div className="flex items-center gap-2 border-b pb-4">
                                <Button
                                    type="button"
                                    variant={scanMode ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setScanMode(!scanMode)}
                                    className="gap-2"
                                >
                                    <Barcode className="w-4 h-4" />
                                    Modo Escaneo: {scanMode ? "Activado" : "Desactivado"}
                                </Button>
                                {scanMode && (
                                    <Input
                                        placeholder="Escanear barcode..."
                                        value={scannedBarcode}
                                        onChange={(e) => setScannedBarcode(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        className="max-w-xs"
                                        autoFocus
                                    />
                                )}
                            </div>

                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold">Productos a Recibir</h4>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={addItem}
                                    className="gap-2"
                                >
                                    <PackagePlus className="w-4 h-4" />
                                    Agregar Insumo
                                </Button>
                            </div>

                            {receivingItems.length === 0 ? (
                                <div className="p-8 text-center border rounded-lg bg-muted/20 text-muted-foreground text-sm flex flex-col items-center gap-2">
                                    <Package className="w-8 h-8 text-muted-foreground/60" />
                                    <span>No hay productos en la lista. Agrégalos manualmente o activa el Modo Escaneo.</span>
                                </div>
                            ) : (
                                <div className="border rounded-lg divide-y bg-card">
                                    {receivingItems.map((item, index) => (
                                        <div key={index} className="flex items-center justify-between p-4 gap-4">
                                            <div className="flex-1 grid gap-4 sm:grid-cols-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Producto *</Label>
                                                    <Select
                                                        value={item.itemId}
                                                        onValueChange={(value) => updateItem(index, "itemId", value)}
                                                    >
                                                        <SelectTrigger className="h-9">
                                                            <SelectValue placeholder="Seleccionar item" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {items.map(i => (
                                                                <SelectItem key={i.id} value={i.id}>
                                                                    {i.name} {i.sku && `(${i.sku})`}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="flex justify-between items-center text-xs w-full">
                                                        <span>Cantidad ({item.unit || 'unidades'}) *</span>
                                                        {item.ocrData && (
                                                            <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                                                OCR
                                                            </Badge>
                                                        )}
                                                        {item.orderedQuantity !== undefined && (
                                                            <span className="text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono">
                                                                Ord: {item.orderedQuantity} (Rec: {item.receivedQuantity || 0})
                                                            </span>
                                                        )}
                                                    </Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity || ""}
                                                        onChange={(e) => updateItem(index, "quantity", Number(e.target.value))}
                                                        placeholder="0"
                                                        className={cn(
                                                            "h-9",
                                                            item.orderedQuantity !== undefined && 
                                                            item.quantity !== (item.orderedQuantity - (item.receivedQuantity || 0)) 
                                                            ? "border-amber-500 focus-visible:ring-amber-500 bg-amber-50/20" 
                                                            : ""
                                                        )}
                                                    />
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeItem(index)}
                                                className="text-muted-foreground hover:text-destructive shrink-0 mt-6"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {step === "review-submit" && (
                        <div className="space-y-4 py-4">
                            <h4 className="text-sm font-semibold">Datos de Control de Calidad y Costos</h4>
                            
                            <div className="space-y-4">
                                {receivingItems.map((item, index) => {
                                    const isCold = item.itemName?.toLowerCase().includes("refriger") || 
                                                   item.itemName?.toLowerCase().includes("fres") ||
                                                   item.itemName?.toLowerCase().includes("láct") ||
                                                   item.itemName?.toLowerCase().includes("ques") ||
                                                   item.itemName?.toLowerCase().includes("carne");
                                    return (
                                        <div key={index} className="p-4 border rounded-lg bg-card space-y-3">
                                            <div className="flex justify-between items-center border-b pb-2">
                                                <span className="font-semibold text-sm">{item.itemName || "Insumo sin seleccionar"}</span>
                                                <span className="text-xs text-muted-foreground font-mono">Cant: {item.quantity} {item.unit || "unidades"}</span>
                                            </div>

                                            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Lote</Label>
                                                    <Input
                                                        value={item.batchNumber}
                                                        onChange={(e) => updateItem(index, "batchNumber", e.target.value)}
                                                        placeholder="BATCH-001"
                                                        className="h-9 text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Fecha de Caducidad</Label>
                                                    <Input
                                                        type="date"
                                                        value={item.expirationDate || ""}
                                                        onChange={(e) => updateItem(index, "expirationDate", e.target.value)}
                                                        className="h-9 text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Costo Unitario ($)</Label>
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.unitCost || ""}
                                                        onChange={(e) => updateItem(index, "unitCost", Number(e.target.value))}
                                                        placeholder="0.00"
                                                        className="h-9 text-xs"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Temp. (°C) {isCold && "*"}</Label>
                                                    <Input
                                                        type="number"
                                                        step="0.1"
                                                        value={item.temperature ?? ""}
                                                        onChange={(e) => updateItem(index, "temperature", e.target.value === "" ? "" : Number(e.target.value))}
                                                        placeholder="Ej. 4.0"
                                                        className={cn(
                                                            "h-9 text-xs",
                                                            typeof item.temperature === 'number' && item.temperature > 4 
                                                            ? "border-destructive focus-visible:ring-destructive bg-destructive/10" 
                                                            : ""
                                                        )}
                                                    />
                                                </div>
                                            </div>

                                            {item.orderedQuantity !== undefined && item.quantity !== (item.orderedQuantity - (item.receivedQuantity || 0)) && (
                                                <div className="text-xs text-amber-600 bg-amber-50/50 p-2 rounded border border-amber-100 flex items-center gap-1.5 mt-2">
                                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                                    <span>
                                                        Se registrará una <strong>discrepancia</strong>: quedan {item.orderedQuantity - (item.receivedQuantity || 0) - item.quantity} unidades pendientes.
                                                    </span>
                                                </div>
                                            )}

                                            {typeof item.temperature === 'number' && item.temperature > 4 && (
                                                <Alert variant="destructive" className="mt-2 py-2">
                                                    <AlertCircle className="h-4 w-4" />
                                                    <AlertDescription className="text-xs">
                                                        Temperatura fuera de rango ( &gt; 4°C ). Este producto será enviado a <strong>CUARENTENA</strong> (Auto-rechazo).
                                                    </AlertDescription>
                                                </Alert>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="space-y-2 pt-2">
                                <Label htmlFor="notes" className="text-xs">Notas / Comentarios</Label>
                                <Textarea
                                    id="notes"
                                    placeholder="Notas adicionales sobre esta recepción..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </div>
                        </div>
                    )}

                    {/* Dialog Footer Actions */}
                    <DialogFooter className="mt-6 border-t pt-4 flex items-center justify-between gap-2 sm:justify-between">
                        {step === "supplier-po" && (
                            <>
                                <Button variant="outline" onClick={handleClose}>
                                    Cancelar
                                </Button>
                                <Button 
                                    disabled={!selectedSupplier} 
                                    onClick={() => setStep("items-scan")}
                                >
                                    Siguiente
                                </Button>
                            </>
                        )}

                        {step === "items-scan" && (
                            <>
                                <Button variant="outline" onClick={() => setStep("supplier-po")}>
                                    Atrás
                                </Button>
                                <Button 
                                    disabled={!isStep2Valid} 
                                    onClick={() => setStep("review-submit")}
                                >
                                    Siguiente
                                </Button>
                            </>
                        )}

                        {step === "review-submit" && (
                            <>
                                <Button variant="outline" onClick={() => setStep("items-scan")} disabled={isSubmitting}>
                                    Atrás
                                </Button>
                                <Button
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || receivingItems.length === 0}
                                    className="gap-2"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Procesando...
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle className="w-4 h-4" />
                                            Confirmar Recepción
                                        </>
                                    )}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
                <AlertDialogContent>
                    <AlertDialogHd>
                        <AlertDialogTl>¿Salir de la recepción?</AlertDialogTl>
                        <AlertDialogDesc>
                            Perderás todos los datos ingresados en esta recepción si cierras sin confirmar.
                        </AlertDialogDesc>
                    </AlertDialogHd>
                    <AlertDialogFt>
                        <AlertDialogCancel>Seguir editando</AlertDialogCancel>
                        <AlertDialogAction onClick={resetForm}>Salir y descartar</AlertDialogAction>
                    </AlertDialogFt>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
