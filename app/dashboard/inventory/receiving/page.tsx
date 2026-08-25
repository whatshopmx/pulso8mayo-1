"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { ReceivingWorkflow } from "@/components/inventory/receiving-workflow";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PackagePlus, History } from "lucide-react";
import { DataTableSkeleton, PageHeaderSkeleton } from "@/components/shared/skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { PageHeader, PageContainer } from "@/components/shared";
import { useBranch } from "@/lib/branch-context";

interface Supplier {
    id: string;
    name: string;
}

interface InventoryItem {
    id: string;
    name: string;
    sku?: string;
    unit?: string;
    barcode?: string;
    category?: string;
}

interface ReceivingRecord {
    id: string;
    lotNumber: string;
    itemId: string;
    branchId: string;
    initialQuantity: number;
    receivedAt: string;
    expirationDate?: string;
    supplierId: string;
    supplierBatchInfo?: string;
    invoiceNumber?: string | null;
    item: {
        name: string;
        sku?: string;
    };
    supplier: {
        name: string;
    };
}

export default function ReceivingPage() {
    const searchParams = useSearchParams();
    const poId = searchParams.get("poId") || undefined;
    const { selectedBranchId } = useBranch();

    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [receivings, setReceivings] = useState<ReceivingRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("new");

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch suppliers
            const suppliersRes = await fetch("/api/inventory/suppliers");
            if (suppliersRes.ok) {
                const data = await suppliersRes.json();
                setSuppliers(data.suppliers || []);
            }

            // Fetch inventory items
            const itemsRes = await fetch("/api/inventory/products");
            if (itemsRes.ok) {
                const data = await itemsRes.json();
                setItems(data);
            }

            // Fetch receiving history
            const branchParam = selectedBranchId ? `&branchId=${encodeURIComponent(selectedBranchId)}` : "";
            const receivingRes = await fetch(`/api/inventory/receiving?limit=20&days=30${branchParam}`);
            if (receivingRes.ok) {
                const data = await receivingRes.json();
                if (data.error) {
                    setReceivings([]);
                } else {
                    setReceivings(data.receivings || []);
                }
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleReceivingComplete = async (receivingData: any) => {
        await fetchData();
        setActiveTab("history");
        return { success: true, data: receivingData };
    };

    if (loading) {
        return (
            <div className="p-6 space-y-6">
                <PageHeaderSkeleton />
                <DataTableSkeleton columns={5} rows={6} />
            </div>
        );
    }

    return (
        <PageContainer>
            <PageHeader
                title="Recepción de Inventario"
                description="Registra la entrada de mercancía de proveedores"
                icon={PackagePlus}
            />

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList className="grid w-full grid-cols-2 lg:w-auto lg:grid-cols-2">
                    <TabsTrigger value="new" className="gap-2">
                        <PackagePlus className="h-4 w-4" />
                        Nueva Recepción
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-2">
                        <History className="h-4 w-4" />
                        Historial
                    </TabsTrigger>
                </TabsList>

                {/* New Receiving Tab */}
                <TabsContent value="new" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Registrar Entrada de Inventario</CardTitle>
                            <CardDescription>
                                Escanea o selecciona los productos que estás recibiendo
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ReceivingWorkflow
                                suppliers={suppliers}
                                items={items}
                                onComplete={handleReceivingComplete}
                                initialPOId={poId}
                                branchId={selectedBranchId || undefined}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* History Tab */}
                <TabsContent value="history" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Historial de Recepciones</CardTitle>
                            <CardDescription>
                                Últimas recepciones de inventario
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {receivings.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground">
                                    <PackagePlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                    <p>No hay recepciones registradas</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                     {receivings.map((receiving, index) => {
                                         // Safety check - ensure receiving is a valid object
                                         if (!receiving || typeof receiving !== 'object' || !receiving.id) {
                                             console.error('Invalid receiving record:', receiving);
                                             return null;
                                         }

                                         return (
                                             <div
                                                 key={receiving.id || `receiving-${index}`}
                                                 className="border rounded-lg p-4 space-y-3"
                                             >
                                                 <div className="flex justify-between items-start">
                                                     <div>
                                                         <h4 className="font-semibold">
                                                             {receiving.item?.name || 'Producto desconocido'}
                                                         </h4>
                                                         <p className="text-sm text-muted-foreground">
                                                             Lote: {String(receiving.lotNumber || 'N/A')} • Proveedor: {receiving.supplier?.name || "No especificado"}
                                                             {receiving.invoiceNumber && (
                                                                 <> • Factura: <span className="font-medium text-foreground">{receiving.invoiceNumber}</span></>
                                                             )}
                                                         </p>
                                                         <p className="text-sm text-muted-foreground">
                                                             {receiving.receivedAt ? format(new Date(receiving.receivedAt), "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: es }) : 'Fecha desconocida'}
                                                         </p>
                                                     </div>
                                                     <Badge variant="outline">
                                                         {Number(receiving.initialQuantity || 0)} unidades
                                                     </Badge>
                                                 </div>

                                                 {receiving.supplierBatchInfo && (
                                                     <div className="space-y-2">
                                                         <p className="text-sm">
                                                             <span className="text-muted-foreground">Info del lote:</span> {String(receiving.supplierBatchInfo)}
                                                         </p>
                                                     </div>
                                                 )}

                                                 {receiving.expirationDate && (
                                                     <div className="space-y-2">
                                                         <p className="text-sm">
                                                             <span className="text-muted-foreground">Vencimiento:</span> {format(new Date(receiving.expirationDate), "dd/MM/yyyy", { locale: es })}
                                                         </p>
                                                     </div>
                                                 )}
                                             </div>
                                         );
                                     })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
}
