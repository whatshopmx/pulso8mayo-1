import { getCompanyProducts } from "@/app/actions/inventory";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";

export async function InventoryList({ companyId }: { companyId: string }) {
    const products = await getCompanyProducts(companyId);

    if (products.length === 0) {
        return (
            <div className="text-center py-12 border rounded-lg bg-muted/10">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-lg font-medium">No hay productos registrados</h3>
                <p className="text-muted-foreground mb-4">
                    Comienza agregando tus productos e insumos.
                </p>
                {/* Button is handled in parent page */}
            </div>
        );
    }

    return (
        <div className="border rounded-md overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Categoría</TableHead>
                        <TableHead>Unidad</TableHead>
                        <TableHead>Stock Mínimo</TableHead>
                        <TableHead>Estado</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {products.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>{item.sku || "-"}</TableCell>
                            <TableCell>{item.category || "General"}</TableCell>
                            <TableCell>{item.unit}</TableCell>
                            <TableCell>{item.minLevel}</TableCell>
                            <TableCell>
                                <Badge variant={item.active ? "default" : "secondary"}>
                                    {item.active ? "Activo" : "Inactivo"}
                                </Badge>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
