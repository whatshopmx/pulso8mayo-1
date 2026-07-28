import { Suspense } from "react";
import { SupplierList } from "@/components/inventory/supplier-list";
import { DataTableSkeleton } from "@/components/shared/skeletons";

export default function SuppliersPage() {
    return (
        <div className="flex-1 space-y-4 p-4 lg:p-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl lg:text-4xl text-foreground">
                    Proveedores
                </h1>
            </div>
            <Suspense fallback={<DataTableSkeleton columns={4} rows={6} />}>
                <SupplierList />
            </Suspense>
        </div>
    );
}
