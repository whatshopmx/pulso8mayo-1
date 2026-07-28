// Force Next.js Turbopack reload
import { InventoryService } from "@/lib/services/inventory-service";
import { getPriceHistory } from "@/app/actions/inventory";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { StockManager } from "@/components/inventory/stock-manager";
import { UnitConversionManager } from "@/components/inventory/unit-conversion-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Metadata } from "next";
import { PageHeader, PageContainer } from "@/components/shared";

interface Props {
    params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
    title: "Detalle de Producto | Pulso",
};

export default async function ProductDetailPage({ params }: Props) {
    const { id } = await params;
    const session = await getSession();

    if (!session?.user) {
        redirect("/sign-in");
    }

    // Default to first branch if not set? Or require branch context.
    // For now assuming user has a selected branch or we default to the first one available to them?
    const branchId = session.user.branchId;

    if (!branchId) {
        return (
            <div className="p-8 text-center">
                <h2 className="text-xl font-semibold">Selecciona una Sucursal</h2>
                <p>Necesitas estar en el contexto de una sucursal para ver el inventario.</p>
            </div>
        );
    }

    const item = await InventoryService.getItem(id);

    if (!item) {
        return <div>Producto no encontrado</div>;
    }

    const batches = await InventoryService.getBatches(id, branchId);
    const stock = await InventoryService.getStockLevel(id, branchId);
    const movements = await InventoryService.getMovements(id, branchId);
    const priceHistory = await getPriceHistory(id);

    return (
        <PageContainer>
            <PageHeader
                title={item.name}
                description={`${item.category} ${item.brand ? `• Marca: ${item.brand} ` : ""}${item.presentation ? `• ${item.presentation} ` : ""}• Unidad: ${item.unit}${item.lastCost ? ` • Costo Actual: $${(item.lastCost / 100).toFixed(2)}` : ""}`}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/dashboard/inventory">
                            <Button variant="ghost" size="icon">
                                <ChevronLeft className="w-5 h-5" />
                            </Button>
                        </Link>
                        <Link href={`/dashboard/inventory/${id}/edit`}>
                            <Button variant="outline">Editar Producto</Button>
                        </Link>
                    </div>
                }
            />
            {item.photoUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={item.photoUrl} alt={item.name} className="h-20 w-20 rounded-lg object-cover border shrink-0" />
            )}

            <Tabs defaultValue="stock" className="mt-6">
                <TabsList>
                    <TabsTrigger value="stock">Stock y Movimientos</TabsTrigger>
                    <TabsTrigger value="conversions">Conversiones de Unidad</TabsTrigger>
                </TabsList>
                <TabsContent value="stock">
                    <StockManager
                        branchId={branchId}
                        item={item}
                        batches={batches}
                        movements={movements}
                        totalStock={stock}
                        priceHistory={priceHistory}
                    />
                </TabsContent>
                <TabsContent value="conversions">
                    <UnitConversionManager />
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
}
