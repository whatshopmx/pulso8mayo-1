"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Package, AlertTriangle, ChevronLeft } from "lucide-react";
import { DataTableSkeleton } from "@/components/shared/skeletons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBranch } from "@/lib/branch-context";
import { PageHeader, PageContainer, EmptyState, ErrorState } from "@/components/shared";
import { useInventory } from "@/hooks/queries";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductDetailDrawer } from "@/components/inventory/product-detail-drawer";

export default function ProductsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "out">("all");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { branches } = useBranch();

  const isMultiBranch = branches.length > 1;
  const [branchFilter, setBranchFilter] = useState<string>(
    isMultiBranch ? "all" : (branches[0]?.id ?? "all"),
  );
  const activeBranchId = branchFilter === "all" ? undefined : branchFilter;
  const activeBranch = branches.find((b) => b.id === branchFilter) ?? null;

  const { data: products = [], isLoading: loading, isError: productsError, refetch: refetchProducts } = useInventory(activeBranchId);

  const filteredProducts = products.filter((product) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      product.name?.toLowerCase().includes(q) ||
      product.sku?.toLowerCase().includes(q) ||
      product.category?.toLowerCase().includes(q)
    );
  });

  const tabFilteredProducts = filteredProducts.filter((product) => {
    if (activeTab === "out") {
      return (product.currentStock || 0) === 0;
    }
    return true;
  });

  const outOfStockCount = products.filter((p) => (p.currentStock || 0) === 0).length;

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de Productos"
        description="Insumos del inventario"
        icon={Package}
        badge={branchFilter === "all" ? "todas las sucursales" : activeBranch?.name}
        actions={
          <div className="flex items-center gap-2">
            {isMultiBranch && (
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="w-44 h-9">
                  <SelectValue placeholder="Sucursal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button asChild size="sm">
              <Link href="/dashboard/inventory/new">
                <Plus className="mr-2 h-4 w-4" /> Agregar Producto
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Productos en Almacén</CardTitle>
              <CardDescription>
                Consulta el catálogo de insumos
                {activeBranch && ` para ${activeBranch.name}`}
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/inventory">
                <ChevronLeft className="mr-1 h-4 w-4" /> Volver al panel
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div className="flex gap-2 p-1 bg-muted/40 rounded-lg border">
              <Button
                variant={activeTab === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("all")}
                className="text-xs font-semibold"
              >
                Todos
              </Button>
              <Button
                variant={activeTab === "out" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("out")}
                className="text-xs font-semibold flex items-center gap-1.5"
              >
                Sin stock
                {outOfStockCount > 0 && (
                  <Badge variant="warning" className="h-4 px-1 min-w-[16px] flex items-center justify-center text-xs rounded-full">
                    {outOfStockCount}
                  </Badge>
                )}
              </Button>
            </div>

            <div className="relative w-full sm:w-[250px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar productos..."
                className="pl-8 h-9 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {productsError ? (
            <ErrorState
              message="No se pudo cargar el catálogo de productos."
              onRetry={() => refetchProducts()}
            />
          ) : loading ? (
            <DataTableSkeleton columns={6} rows={8} className="border-0" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead>Stock Actual</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tabFilteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-16">
                      {searchQuery.trim() && products.length > 0 ? (
                        <EmptyState
                          icon={Search}
                          title="Sin resultados"
                          description={`No hay productos que coincidan con "${searchQuery}".`}
                          action={{ label: "Limpiar búsqueda", onClick: () => setSearchQuery("") }}
                        />
                      ) : (
                        <EmptyState
                          icon={Package}
                          title="No se encontraron productos"
                          description="No hay insumos para mostrar en esta pestaña."
                          action={{ label: "Agregar Producto", href: "/dashboard/inventory/new" }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  tabFilteredProducts.map((product) => (
                    <TableRow key={product.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          {product.photoUrl ? (
                            <Image
                              src={product.photoUrl}
                              alt=""
                              width={32}
                              height={32}
                              unoptimized
                              className="h-8 w-8 rounded object-cover border"
                            />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span>{product.name}</span>
                          {product.isLowStock && activeBranchId && (
                            <Badge variant="warning" className="gap-1">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              Bajo
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{product.sku || "—"}</TableCell>
                      <TableCell className="capitalize">{product.category || "General"}</TableCell>
                      <TableCell>{product.unit}</TableCell>
                      <TableCell className="font-mono">
                        {activeBranchId ? (
                          <span className={product.isLowStock ? "text-amber-600 font-bold" : ""}>
                            {product.currentStock || 0}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedProductId(product.id);
                            setDrawerOpen(true);
                          }}
                        >
                          Ver
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProductDetailDrawer
        productId={selectedProductId}
        branchId={activeBranchId || null}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </PageContainer>
  );
}