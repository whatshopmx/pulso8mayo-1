"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Upload, Check, AlertTriangle, ArrowRight, Loader2, RefreshCw, Eye, AlertCircle, CheckCircle2, TrendingUp, Printer } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface InvoiceConcepto {
    claveProdServ: string;
    noIdentificacion?: string;
    cantidad: number;
    claveUnidad: string;
    unidad?: string;
    descripcion: string;
    valorUnitario: number;
    importe: number;
}

interface MatchedItem {
    concepto: InvoiceConcepto;
    matchedItemId: string | null;
    matchedItemName: string | null;
    matchedItemSku: string | null;
    matchStatus: 'MATCHED' | 'UNMATCHED';
}

interface ParsedInvoice {
    id?: string;
    uuid?: string;
    folio?: string;
    serie?: string;
    fecha: string;
    subTotal: number;
    total: number;
    moneda: string;
    rfcEmisor: string;
    nombreEmisor: string;
    rfcReceptor: string;
    nombreReceptor: string;
}

interface Supplier {
    id: string;
    name: string;
    taxId?: string;
}

interface InventoryProduct {
    id: string;
    name: string;
    sku?: string;
    unit?: string;
}

export default function InvoiceUploadPage() {
    const [activeTab, setActiveTab] = useState<string>("upload");
    
    // Upload & Match State
    const [file, setFile] = useState<File | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [parsedData, setParsedData] = useState<{
        invoice: ParsedInvoice;
        supplier: Supplier | null;
        purchaseOrders: Array<{ id: string; poNumber: string; status: string; total: number }>;
        items: MatchedItem[];
    } | null>(null);

    const [dbItems, setDbItems] = useState<InventoryProduct[]>([]);
    const [selectedPOId, setSelectedPOId] = useState<string>("none");
    const [mappedItems, setMappedItems] = useState<Record<number, string>>({}); // index -> inventoryItemId

    // History State
    const [invoicesList, setInvoicesList] = useState<any[]>([]);
    const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
    const [selectedInvoiceDetail, setSelectedInvoiceDetail] = useState<any | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isClaimOpen, setIsClaimOpen] = useState(false);

    // Credit Notes State
    const [creditNotesList, setCreditNotesList] = useState<any[]>([]);
    const [isLoadingCreditNotes, setIsLoadingCreditNotes] = useState(false);
    const [isCreatingCreditNote, setIsCreatingCreditNote] = useState(false);

    useEffect(() => {
        // Fetch inventory products for manual mapping dropdown
        fetch("/api/inventory/products")
            .then(res => res.ok && res.json())
            .then(data => setDbItems(data || []))
            .catch(err => console.error("Error loading products:", err));
    }, []);

    const fetchInvoices = async () => {
        setIsLoadingInvoices(true);
        try {
            const res = await fetch("/api/inventory/invoices");
            const data = await res.json();
            if (res.ok && data.success) {
                setInvoicesList(data.invoices);
            } else {
                throw new Error(data.error || "Error al cargar facturas");
            }
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Error al cargar historial de facturas");
        } finally {
            setIsLoadingInvoices(false);
        }
    };

    const fetchCreditNotes = async () => {
        setIsLoadingCreditNotes(true);
        try {
            const res = await fetch("/api/inventory/credit-notes");
            const data = await res.json();
            if (res.ok && data.success) {
                setCreditNotesList(data.data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoadingCreditNotes(false);
        }
    };

    useEffect(() => {
        if (activeTab === "history") {
            fetchInvoices();
        }
        if (activeTab === "credit-notes") {
            fetchCreditNotes();
        }
    }, [activeTab]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setParsedData(null);
            setMappedItems({});
        }
    };

    const handleParseInvoice = async () => {
        if (!file) {
            toast.error("Selecciona un archivo XML");
            return;
        }

        setIsParsing(true);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/api/inventory/invoices/upload", {
                method: "POST",
                body: formData,
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Error al procesar XML");

            setParsedData(result);
            
            // Auto initialize mapped items state
            const initialMapping: Record<number, string> = {};
            result.items.forEach((item: MatchedItem, index: number) => {
                if (item.matchedItemId) {
                    initialMapping[index] = item.matchedItemId;
                }
            });
            setMappedItems(initialMapping);

            if (result.purchaseOrders && result.purchaseOrders.length > 0) {
                setSelectedPOId(result.purchaseOrders[0].id);
                toast.success("Factura cargada. Orden de compra encontrada automáticamente.");
            } else {
                setSelectedPOId("none");
                toast.success("Factura cargada correctamente.");
            }

        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Error al procesar factura");
        } finally {
            setIsParsing(false);
        }
    };

    const handleItemMapChange = (index: number, itemId: string) => {
        setMappedItems(prev => ({
            ...prev,
            [index]: itemId,
        }));
    };

    const handleProcessReceiving = async () => {
        if (!parsedData) return;

        // Verify all items are mapped
        const unmappedCount = parsedData.items.filter((_, idx) => !mappedItems[idx]).length;
        if (unmappedCount > 0) {
            toast.error(`Por favor asocia todos los productos de la factura (${unmappedCount} pendientes)`);
            return;
        }

        setIsSubmitting(true);

        try {
            const receivingItems = parsedData.items.map((item, index) => {
                return {
                    itemId: mappedItems[index],
                    quantity: item.concepto.cantidad,
                    unitCost: item.concepto.valorUnitario,
                    batchNumber: `XML-${parsedData.invoice.folio || 'LOTE'}-${Date.now().toString(36).slice(-4)}`,
                    expirationDate: undefined,
                    productionDate: undefined,
                };
            });

            const res = await fetch("/api/inventory/receiving", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: receivingItems,
                    supplierId: parsedData.supplier?.id || undefined,
                    purchaseOrderId: selectedPOId !== "none" ? selectedPOId : undefined,
                    invoiceId: parsedData.invoice.id,
                    notes: `Carga automática de XML. Factura: ${parsedData.invoice.serie || ''}-${parsedData.invoice.folio || ''}`,
                }),
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.error || "Error al registrar recepción");

            toast.success("Recepción registrada correctamente a partir del XML");
            setParsedData(null);
            setFile(null);
            setMappedItems({});
            setActiveTab("history"); // Redirect to history to see 3-way match
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Error al procesar la entrada");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleViewInvoiceDetail = async (id: string) => {
        setIsLoadingDetail(true);
        try {
            const res = await fetch(`/api/inventory/invoices?id=${id}`);
            const data = await res.json();
            if (res.ok && data.success) {
                setSelectedInvoiceDetail(data);
                setIsDetailOpen(true);
            } else {
                throw new Error(data.error || "No se pudo cargar el detalle");
            }
        } catch (err: any) {
            console.error(err);
            toast.error(err.message || "Error al cargar detalle");
        } finally {
            setIsLoadingDetail(false);
        }
    };

    const handleOpenClaimDialog = () => {
        setIsClaimOpen(true);
    };

    const handleCreateCreditNote = async () => {
        if (!selectedInvoiceDetail) return;
        setIsCreatingCreditNote(true);
        try {
            const res = await fetch("/api/inventory/credit-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    invoiceId: selectedInvoiceDetail.invoice.id,
                    reason: "Discrepancias detectadas en conciliación 3-way",
                }),
            });
            const result = await res.json();
            if (res.ok && result.success) {
                toast.success("Nota de crédito generada correctamente");
                setIsClaimOpen(false);
                fetchCreditNotes();
            } else {
                throw new Error(result.error || "Error al generar nota de crédito");
            }
        } catch (err: any) {
            toast.error(err.message || "Error al generar nota de crédito");
        } finally {
            setIsCreatingCreditNote(false);
        }
    };

    const handleShareClaimWhatsApp = () => {
        if (!selectedInvoiceDetail) return;
        const supplierName = selectedInvoiceDetail.supplier?.name || selectedInvoiceDetail.invoice.nombreEmisor || "Proveedor";
        const invoiceFolio = `${selectedInvoiceDetail.invoice.serie || ''}-${selectedInvoiceDetail.invoice.folio || ''}`;
        
        let text = `Estimado equipo de *${supplierName}*,\n\nLe escribimos de *Pulso Horeca* en relación a la Factura *${invoiceFolio}*.\n\nHemos detectado las siguientes discrepancias en el recibo de mercancía:\n\n`;
        
        selectedInvoiceDetail.matchDetails?.discrepancies.forEach((dis: any) => {
            text += `• ${dis.description}\n`;
        });
        
        text += `\nSolicitamos de su apoyo para la corrección/nota de crédito correspondiente. Agradecemos su pronta atención.\n\nAtentamente,\nControl de Calidad, Pulso Horeca`;
        
        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
    };

    const getMatchStatusBadge = (status: string) => {
        switch (status) {
            case "MATCHED":
                return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 flex items-center gap-1 w-fit"><Check className="w-3 h-3" /> Conciliada</Badge>;
            case "DISCREPANCY":
                return <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 flex items-center gap-1 w-fit"><AlertTriangle className="w-3 h-3" /> Discrepancia</Badge>;
            default:
                return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 flex items-center gap-1 w-fit"><RefreshCw className="w-3 h-3 animate-spin" /> Pendiente</Badge>;
        }
    };

    return (
        <PageContainer>
            <PageHeader
                title="Conciliación de Facturas"
                description="Gestión y cotejo automático entre facturas (XML CFDI), órdenes de compra y recepciones físicas."
                icon={FileText}
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
                <TabsList className="grid w-full max-w-lg grid-cols-3">
                    <TabsTrigger value="upload" className="gap-2">
                        <Upload className="w-4 h-4" /> Cargar Factura (XML)
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-2">
                        <FileText className="w-4 h-4" /> Historial y Conciliación
                    </TabsTrigger>
                    <TabsTrigger value="credit-notes" className="gap-2">
                        <FileText className="w-4 h-4" /> Notas de Crédito
                    </TabsTrigger>
                </TabsList>

                {/* TAB 1: UPLOAD AND MAP */}
                <TabsContent value="upload" className="space-y-6 mt-6">
                    {!parsedData ? (
                        <Card className="max-w-2xl mx-auto">
                            <CardHeader>
                                <CardTitle>Subir Archivo XML</CardTitle>
                                <CardDescription>
                                    Selecciona el archivo XML oficial de la factura mexicana (CFDI 4.0 o 3.3). El sistema extraerá de forma precisa el emisor, los precios, cantidades e items.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer relative">
                                    <input
                                        type="file"
                                        accept=".xml"
                                        onChange={handleFileChange}
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                    />
                                    <Upload className="w-10 h-10 text-slate-400 mb-4" />
                                    {file ? (
                                        <div className="text-center">
                                            <p className="font-semibold text-slate-700">{file.name}</p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {(file.size / 1024).toFixed(2)} KB
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="text-center">
                                            <p className="font-medium text-slate-700">Haz clic o arrastra un archivo XML aquí</p>
                                            <p className="text-xs text-muted-foreground mt-1">Formatos permitidos: .xml</p>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                            <CardFooter className="flex justify-end gap-3">
                                <Button
                                    onClick={handleParseInvoice}
                                    disabled={!file || isParsing}
                                    className="gap-2"
                                >
                                    {isParsing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Analizando XML...
                                        </>
                                    ) : (
                                        <>
                                            Analizar Factura
                                            <ArrowRight className="w-4 h-4" />
                                        </>
                                    )}
                                </Button>
                            </CardFooter>
                        </Card>
                    ) : (
                        <div className="grid gap-6 lg:grid-cols-3">
                            {/* Invoice Meta Summary Card */}
                            <div className="lg:col-span-1 space-y-6">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center justify-between">
                                            <span>Resumen del CFDI</span>
                                            <Badge variant="secondary" className="font-mono">
                                                {parsedData.invoice.folio || 'Sin Folio'}
                                            </Badge>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4 text-sm">
                                        <div className="grid grid-cols-2 gap-2 border-b pb-2">
                                            <span className="text-muted-foreground">Emisor:</span>
                                            <span className="font-medium text-right truncate" title={parsedData.invoice.nombreEmisor}>
                                                {parsedData.invoice.nombreEmisor}
                                            </span>
                                            <span className="text-muted-foreground">RFC Emisor:</span>
                                            <span className="font-mono text-right">{parsedData.invoice.rfcEmisor}</span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 border-b pb-2">
                                            <span className="text-muted-foreground">Proveedor del Sistema:</span>
                                            <span className="font-medium text-right">
                                                {parsedData.supplier ? (
                                                    <span className="text-emerald-700 font-semibold">{parsedData.supplier.name}</span>
                                                ) : (
                                                    <span className="text-amber-700 flex items-center gap-1 justify-end">
                                                        <AlertTriangle className="w-3.5 h-3.5" /> No registrado
                                                    </span>
                                                )}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 border-b pb-2">
                                            <span className="text-muted-foreground">Fecha:</span>
                                            <span className="text-right">
                                                {new Date(parsedData.invoice.fecha).toLocaleDateString()}
                                            </span>
                                            <span className="text-muted-foreground">Moneda:</span>
                                            <span className="text-right">{parsedData.invoice.moneda}</span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 pt-2 text-base font-semibold">
                                            <span>Total Factura:</span>
                                            <span className="text-right text-emerald-600">
                                                ${parsedData.invoice.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* PO Association Card */}
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-base">Asociar Orden de Compra</CardTitle>
                                        <CardDescription>
                                            Elige la PO a cerrar con esta factura
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Select value={selectedPOId} onValueChange={setSelectedPOId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Seleccionar orden..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Sin orden (Entrada directa)</SelectItem>
                                                {parsedData.purchaseOrders.map(po => (
                                                    <SelectItem key={po.id} value={po.id}>
                                                        {po.poNumber} (${po.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </CardContent>
                                </Card>

                                <div className="flex gap-3">
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setParsedData(null);
                                            setFile(null);
                                        }}
                                        className="w-full gap-2"
                                    >
                                        <RefreshCw className="w-4 h-4" /> Cancelar
                                    </Button>
                                    <Button
                                        onClick={handleProcessReceiving}
                                        disabled={isSubmitting}
                                        className="w-full gap-2"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Registrando...
                                            </>
                                        ) : (
                                            <>
                                                <Check className="w-4 h-4" /> Registrar Entrada
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>

                            {/* Conceptos & Matching Table Card */}
                            <div className="lg:col-span-2">
                                <Card className="h-full flex flex-col">
                                    <CardHeader>
                                        <CardTitle>Conceptos de Factura vs Insumos de Inventario</CardTitle>
                                        <CardDescription>
                                            Asocia cada ítem del XML con un insumo de tu catálogo. El sistema recordará la asociación.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex-1 space-y-4">
                                        <div className="space-y-4">
                                            {parsedData.items.map((item, index) => {
                                                const currentMappedId = mappedItems[index] || "";

                                                return (
                                                    <div
                                                        key={index}
                                                        className={cn(
                                                            "p-4 border rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors",
                                                            currentMappedId ? "border-emerald-100 bg-emerald-50/10" : "border-amber-100 bg-amber-50/10"
                                                        )}
                                                    >
                                                        {/* Concepto Info */}
                                                        <div className="space-y-1 flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className="font-mono text-xs">
                                                                    Cant: {item.concepto.cantidad}
                                                                </Badge>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {item.concepto.claveProdServ} • {item.concepto.unidad || 'U'}
                                                                </span>
                                                            </div>
                                                            <p className="font-medium text-sm text-slate-800 truncate" title={item.concepto.descripcion}>
                                                                {item.concepto.descripcion}
                                                            </p>
                                                            <p className="text-xs text-slate-500">
                                                                Costo unitario: ${item.concepto.valorUnitario.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                            </p>
                                                        </div>

                                                        {/* System Match Action */}
                                                        <div className="flex flex-col md:w-72 shrink-0 space-y-1.5">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-xs text-muted-foreground">Vincular a:</Label>
                                                                {currentMappedId ? (
                                                                    <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                                                                        <Check className="w-3.5 h-3.5" /> Vinculado
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-xs text-amber-600 font-semibold flex items-center gap-1">
                                                                        <AlertTriangle className="w-3.5 h-3.5" /> Requiere mapeo
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <Select
                                                                value={currentMappedId}
                                                                onValueChange={(val) => handleItemMapChange(index, val)}
                                                            >
                                                                <SelectTrigger className="h-9">
                                                                    <SelectValue placeholder="Seleccionar insumo de inventario" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {dbItems.map(dbItem => (
                                                                        <SelectItem key={dbItem.id} value={dbItem.id}>
                                                                            {dbItem.name} {dbItem.sku && `(${dbItem.sku})`}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    )}
                </TabsContent>

                {/* TAB 2: HISTORIAL AND MATCH DETAIL */}
                <TabsContent value="history" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Facturas Registradas</CardTitle>
                            <CardDescription>
                                Consulta la lista de CFDIs cargados en el sistema y verifica sus discrepancias de costo y cantidad.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoadingInvoices ? (
                                <div className="flex items-center justify-center p-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : invoicesList.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border border-dashed rounded-lg">
                                    <FileText className="w-10 h-10 mb-2 opacity-50" />
                                    <p className="font-medium">No hay facturas cargadas</p>
                                    <p className="text-xs mt-1">Sube tus archivos XML en la pestaña de carga.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Folio / Serie</TableHead>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead>Emisor / Proveedor</TableHead>
                                                <TableHead>PO Asociada</TableHead>
                                                <TableHead className="text-right">Monto Total</TableHead>
                                                <TableHead>Estatus Match</TableHead>
                                                <TableHead className="w-[100px]"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {invoicesList.map((invoice) => (
                                                <TableRow key={invoice.id}>
                                                    <TableCell className="font-medium">
                                                        {invoice.serie && `${invoice.serie}-`}
                                                        {invoice.folio || 'S/F'}
                                                    </TableCell>
                                                    <TableCell>
                                                        {new Date(invoice.fecha).toLocaleDateString()}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-semibold text-slate-700">{invoice.supplierName || 'Desconocido'}</div>
                                                        <div className="text-xs text-muted-foreground">Emisor: {invoice.nombreEmisor || 'N/A'}</div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        {invoice.poNumber || 'Entrada Directa'}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">
                                                        ${(invoice.total / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {invoice.currency}
                                                    </TableCell>
                                                    <TableCell>
                                                        {getMatchStatusBadge(invoice.matchStatus)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => handleViewInvoiceDetail(invoice.id)}
                                                            disabled={isLoadingDetail}
                                                        >
                                                            <Eye className="w-4 h-4" />
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
                </TabsContent>

                {/* TAB 3: CREDIT NOTES */}
                <TabsContent value="credit-notes" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Notas de Crédito</CardTitle>
                            <CardDescription>
                                Notas de crédito generadas a partir de discrepancias en conciliación de facturas.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {isLoadingCreditNotes ? (
                                <div className="flex items-center justify-center p-8">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : creditNotesList.length === 0 ? (
                                <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border border-dashed rounded-lg">
                                    <FileText className="w-10 h-10 mb-2 opacity-50" />
                                    <p className="font-medium">No hay notas de crédito registradas</p>
                                    <p className="text-xs mt-1">Las notas de crédito se generan automáticamente al reportar una discrepancia en una factura.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Folio</TableHead>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead>Proveedor</TableHead>
                                                <TableHead>Factura Relacionada</TableHead>
                                                <TableHead>Motivo</TableHead>
                                                <TableHead className="text-right">Monto Total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {creditNotesList.map((note) => (
                                                <TableRow key={note.id}>
                                                    <TableCell className="font-medium">
                                                        {note.serie && `${note.serie}-`}{note.folio || 'S/F'}
                                                    </TableCell>
                                                    <TableCell>{new Date(note.fecha).toLocaleDateString()}</TableCell>
                                                    <TableCell>{note.supplierName || '—'}</TableCell>
                                                    <TableCell className="text-xs font-mono">
                                                        {note.invoiceSerie && `${note.invoiceSerie}-`}{note.invoiceFolio || 'S/F'}
                                                    </TableCell>
                                                    <TableCell className="max-w-xs truncate">{note.reason || '—'}</TableCell>
                                                    <TableCell className="text-right font-medium">
                                                        ${(note.total / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {note.currency}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* DETALLADO DIALOG (3-WAY MATCH COMPARE) */}
            <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                    {selectedInvoiceDetail && (
                        <div className="space-y-6">
                            <DialogHeader>
                                <DialogTitle className="flex items-center justify-between border-b pb-4">
                                    <div className="space-y-1">
                                        <span className="text-xl font-bold">
                                            Factura: {selectedInvoiceDetail.invoice.serie && `${selectedInvoiceDetail.invoice.serie}-`}
                                            {selectedInvoiceDetail.invoice.folio || 'Sin Folio'}
                                        </span>
                                        <p className="text-xs text-muted-foreground font-mono">UUID: {selectedInvoiceDetail.invoice.uuid}</p>
                                    </div>
                                    <div className="mr-6">
                                        {getMatchStatusBadge(selectedInvoiceDetail.invoice.matchStatus)}
                                    </div>
                                </DialogTitle>
                                <DialogDescription className="hidden" />
                            </DialogHeader>

                            {/* Summary Metadata */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-b pb-4">
                                <div>
                                    <span className="text-muted-foreground block">Fecha Factura</span>
                                    <span className="font-semibold">{new Date(selectedInvoiceDetail.invoice.fecha).toLocaleDateString()}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block">Proveedor</span>
                                    <span className="font-semibold block truncate" title={selectedInvoiceDetail.supplier?.name || selectedInvoiceDetail.invoice.nombreEmisor}>
                                        {selectedInvoiceDetail.supplier?.name || selectedInvoiceDetail.invoice.nombreEmisor}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block">Orden de Compra</span>
                                    <span className="font-mono font-semibold">{selectedInvoiceDetail.purchaseOrder?.poNumber || 'N/A'}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground block">Recepción</span>
                                    <span className="font-semibold text-slate-700">
                                        {selectedInvoiceDetail.receivingReport ? `Reporte #${selectedInvoiceDetail.receivingReport.id.slice(-6).toUpperCase()}` : 'N/A'}
                                    </span>
                                </div>
                            </div>

                            {/* Discrepancy Alerts */}
                            {selectedInvoiceDetail.invoice.matchStatus === "DISCREPANCY" && selectedInvoiceDetail.matchDetails && (
                                <div className="p-4 bg-rose-50 border border-rose-100 rounded-lg flex gap-3 text-rose-800 text-sm">
                                    <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
                                    <div className="space-y-1">
                                        <p className="font-semibold">Discrepancias detectadas en la conciliación:</p>
                                        <ul className="list-disc list-inside space-y-1 text-rose-700 text-xs">
                                            {selectedInvoiceDetail.matchDetails.discrepancies.map((dis: any, idx: number) => (
                                                <li key={idx}>
                                                    {dis.description}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}

                            {selectedInvoiceDetail.invoice.matchStatus === "MATCHED" && (
                                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-lg flex gap-3 text-emerald-800 text-sm">
                                    <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
                                    <div>
                                        <p className="font-semibold">Conciliación Perfecta</p>
                                        <p className="text-xs text-emerald-700 mt-0.5">Las cantidades y costos unitarios coinciden perfectamente entre la Factura XML, la Orden de Compra y la Recepción en Sucursal.</p>
                                    </div>
                                </div>
                            )}

                            {/* Main Comparison Table */}
                            <div className="space-y-2">
                                <h3 className="font-bold text-sm text-slate-800">Cotejo Detallado por Concepto (Factura vs PO vs Recepción)</h3>
                                <div className="border rounded-lg overflow-hidden">
                                    <Table>
                                        <TableHeader className="bg-slate-50/50">
                                            <TableRow>
                                                <TableHead>Insumo</TableHead>
                                                <TableHead className="text-center">Cant. Factura</TableHead>
                                                <TableHead className="text-center">Cant. PO</TableHead>
                                                <TableHead className="text-center">Cant. Recibida</TableHead>
                                                <TableHead className="text-right">Costo Factura</TableHead>
                                                <TableHead className="text-right">Costo PO</TableHead>
                                                <TableHead className="text-right">Costo Recibido</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedInvoiceDetail.matchDetails && selectedInvoiceDetail.matchDetails.itemComparisons ? (
                                                selectedInvoiceDetail.matchDetails.itemComparisons.map((comp: any, index: number) => (
                                                    <TableRow key={index} className="text-sm">
                                                        <TableCell>
                                                            <div className="font-semibold">{comp.itemName}</div>
                                                            <div className="text-xs text-muted-foreground font-mono">SKU: {comp.sku || 'N/A'}</div>
                                                        </TableCell>
                                                        <TableCell className={cn("text-center", !comp.qtyMatches && "text-rose-600 font-semibold bg-rose-50/20")}>
                                                            {comp.invoiceQty}
                                                        </TableCell>
                                                        <TableCell className="text-center text-muted-foreground">
                                                            {comp.poQty}
                                                        </TableCell>
                                                        <TableCell className={cn("text-center", !comp.qtyMatches && "text-rose-600 font-semibold bg-rose-50/20")}>
                                                            {comp.receivedQty}
                                                        </TableCell>
                                                        <TableCell className={cn("text-right font-medium", !comp.priceMatches && "text-rose-600 font-semibold bg-rose-50/20")}>
                                                            ${comp.invoicePrice.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                        <TableCell className="text-right text-muted-foreground">
                                                            ${comp.poPrice.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                        <TableCell className={cn("text-right font-medium", !comp.priceMatches && "text-rose-600 font-semibold bg-rose-50/20")}>
                                                            ${comp.receivedPrice.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            ) : (
                                                // Fallback table view from raw invoice lines
                                                selectedInvoiceDetail.lines.map((line: any, index: number) => (
                                                    <TableRow key={index} className="text-sm">
                                                        <TableCell>
                                                            <div className="font-semibold">{line.descripcion}</div>
                                                            <div className="text-xs text-muted-foreground">Clave SAT: {line.claveProdServ}</div>
                                                        </TableCell>
                                                        <TableCell className="text-center font-semibold">
                                                            {parseFloat(line.cantidad)}
                                                        </TableCell>
                                                        <TableCell className="text-center text-muted-foreground">-</TableCell>
                                                        <TableCell className="text-center text-muted-foreground">-</TableCell>
                                                        <TableCell className="text-right font-semibold">
                                                            ${(line.valorUnitario / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                                                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>

                            {/* Total summary / Actions */}
                            <div className="flex justify-between items-center pt-4 border-t print:hidden">
                                <div>
                                    {selectedInvoiceDetail.invoice.matchStatus === "DISCREPANCY" && (
                                        <Button 
                                            variant="outline" 
                                            className="gap-2 text-rose-700 border-rose-200 bg-rose-50/50 hover:bg-rose-100" 
                                            onClick={handleOpenClaimDialog}
                                        >
                                            <AlertTriangle className="w-4 h-4" /> Generar Reclamo a Proveedor
                                        </Button>
                                    )}
                                </div>
                                <div className="flex gap-6 text-sm">
                                    <div className="text-right">
                                        <span className="text-muted-foreground block">Subtotal</span>
                                        <span className="font-semibold text-base">${(selectedInvoiceDetail.invoice.subtotal / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-muted-foreground block">IVA / Impuestos</span>
                                        <span className="font-semibold text-base">${(selectedInvoiceDetail.invoice.taxAmount / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-muted-foreground block text-emerald-700 font-semibold">Total Factura</span>
                                        <span className="font-bold text-lg text-emerald-600">${(selectedInvoiceDetail.invoice.total / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* CLAIM DIALOG */}
            <Dialog open={isClaimOpen} onOpenChange={setIsClaimOpen}>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto print-claim-container">
                    <style>{`
                        @media print {
                            body * {
                                visibility: hidden;
                            }
                            .print-claim-container, .print-claim-container * {
                                visibility: visible;
                            }
                            .print-claim-container {
                                position: absolute;
                                left: 0;
                                top: 0;
                                width: 100% !important;
                                padding: 0 !important;
                                margin: 0 !important;
                                box-shadow: none !important;
                                border: none !important;
                            }
                            .print\\:hidden {
                                display: none !important;
                            }
                        }
                    `}</style>
                    {selectedInvoiceDetail && (
                        <div className="space-y-6 p-4">
                            <div className="flex justify-between items-start border-b pb-4">
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-800">RECLAMO FORMAL A PROVEEDOR</h1>
                                    <p className="text-sm text-slate-500 mt-1">Pulso HORECA - Control de Calidad</p>
                                </div>
                                <div className="text-right text-sm">
                                    <p className="font-semibold">Fecha: {new Date().toLocaleDateString()}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">Referencia: REC-{selectedInvoiceDetail.invoice.id.slice(-6).toUpperCase()}</p>
                                </div>
                            </div>

                            <div className="space-y-2 text-sm text-slate-700">
                                <p><strong>Para:</strong> {selectedInvoiceDetail.supplier?.name || selectedInvoiceDetail.invoice.nombreEmisor}</p>
                                <p><strong>De:</strong> Control de Inventarios, Pulso HORECA</p>
                                <p><strong>Asunto:</strong> Reporte de Discrepancias en Factura {selectedInvoiceDetail.invoice.serie || ''}-{selectedInvoiceDetail.invoice.folio || ''}</p>
                            </div>

                            <div className="text-sm text-slate-700 leading-relaxed space-y-4">
                                <p>Estimado Proveedor,</p>
                                <p>Por medio del presente documento, le notificamos de manera formal que durante nuestro proceso de control de calidad y conciliación automatizada, se han identificado discrepancias significativas entre las cantidades/precios facturados y la mercancía físicamente recibida.</p>
                                <p>Detalle de las discrepancias identificadas:</p>
                            </div>

                            {/* Discrepancies list */}
                            <div className="p-4 bg-rose-50 border border-rose-100 rounded-lg text-rose-800 text-sm">
                                <ul className="list-disc list-inside space-y-2">
                                    {selectedInvoiceDetail.matchDetails?.discrepancies.map((dis: any, idx: number) => (
                                        <li key={idx} className="leading-relaxed">
                                            {dis.description}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Verification Table */}
                            <div className="space-y-2">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cotejo de Ítems Afectados</p>
                                <div className="border rounded-lg overflow-hidden">
                                    <Table>
                                        <TableHeader className="bg-slate-50">
                                            <TableRow>
                                                <TableHead>Producto</TableHead>
                                                <TableHead className="text-center">Facturado</TableHead>
                                                <TableHead className="text-center">Recibido</TableHead>
                                                <TableHead className="text-right">Precio Factura</TableHead>
                                                <TableHead className="text-right">Precio PO</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedInvoiceDetail.matchDetails?.itemComparisons
                                                .filter((comp: any) => !comp.qtyMatches || !comp.priceMatches)
                                                .map((comp: any, index: number) => (
                                                    <TableRow key={index} className="text-xs">
                                                        <TableCell className="font-semibold text-slate-800">
                                                            {comp.itemName}
                                                        </TableCell>
                                                        <TableCell className={cn("text-center", !comp.qtyMatches && "text-rose-600 font-semibold")}>
                                                            {comp.invoiceQty}
                                                        </TableCell>
                                                        <TableCell className={cn("text-center", !comp.qtyMatches && "text-rose-600 font-semibold")}>
                                                            {comp.receivedQty}
                                                        </TableCell>
                                                        <TableCell className={cn("text-right", !comp.priceMatches && "text-rose-600 font-semibold")}>
                                                            ${comp.invoicePrice.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                        <TableCell className="text-right text-muted-foreground">
                                                            ${comp.poPrice.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            }
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>

                            <div className="text-sm text-slate-700 leading-relaxed space-y-4 pt-4">
                                <p>Solicitamos atentamente su apoyo para realizar la revisión de los puntos anteriores y proceder con la emisión de la nota de crédito correspondiente o la reposición física del producto a la brevedad posible.</p>
                                <p>Agradecemos de antemano su colaboración.</p>
                                <div className="pt-8 flex justify-between">
                                    <div className="border-t border-slate-300 w-48 text-center pt-2">
                                        <p className="font-semibold text-xs">Firma Sucursal</p>
                                        <p className="text-xs text-muted-foreground">Recibido de Almacén</p>
                                    </div>
                                    <div className="border-t border-slate-300 w-48 text-center pt-2">
                                        <p className="font-semibold text-xs">Firma Autorizada</p>
                                        <p className="text-xs text-muted-foreground">Control de Inventarios</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t print:hidden">
                                <Button variant="outline" onClick={() => setIsClaimOpen(false)}>
                                    Cerrar
                                </Button>
                                <Button variant="outline" onClick={() => window.print()} className="gap-2">
                                    <Printer className="w-4 h-4" /> Imprimir Documento
                                </Button>
                                <Button onClick={handleCreateCreditNote} disabled={isCreatingCreditNote} className="gap-2">
                                    {isCreatingCreditNote ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <FileText className="w-4 h-4" />
                                    )}
                                    {isCreatingCreditNote ? "Generando..." : "Generar Nota de Crédito"}
                                </Button>
                                <Button onClick={handleShareClaimWhatsApp} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                                    <svg className="h-4 w-4 fill-white" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.713-1.458L0 24zM6.59 19.842c1.617.959 3.01 1.458 4.887 1.458 5.48 0 9.943-4.444 9.947-9.913.002-2.65-1.02-5.14-2.88-7.006C16.68 2.516 14.19 1.49 11.54 1.49 6.06 1.49 1.597 5.936 1.594 11.405c-.001 1.83.483 3.197 1.42 4.793L2.012 21.8l5.885-1.543a9.88 9.88 0 0 0-1.307-.415z"/>
                                    </svg>
                                    Compartir por WhatsApp
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </PageContainer>
    );
}
