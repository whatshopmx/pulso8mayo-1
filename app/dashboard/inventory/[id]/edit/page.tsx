import { ProductForm } from "@/components/inventory/product-form";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSuppliers } from "@/app/actions/inventory";
import { InventoryService } from "@/lib/services/inventory-service";

interface Props {
    params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: Props) {
    const { id } = await params;
    const session = await getSession();

    if (!session?.user?.companyId) {
        redirect("/sign-in");
    }

    const item = await InventoryService.getItem(id);

    if (!item) {
        return <div>Producto no encontrado</div>;
    }

    const suppliers = await getSuppliers(session.user.companyId);

    return (
        <div className="max-w-7xl mx-auto p-6">
            <h1 className="text-2xl font-bold mb-6">Editar Producto</h1>
            <ProductForm suppliers={suppliers} initialData={item} />
        </div>
    );
}
