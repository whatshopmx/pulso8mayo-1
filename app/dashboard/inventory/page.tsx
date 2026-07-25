"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2, Package, PackagePlus, ArrowRight, AlertTriangle, ClipboardList, FileText, ChefHat, TrendingUp, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useBranch } from "@/lib/branch-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { useInventory, useCreateProduct, useDashboard } from "@/hooks/queries";
import { DashboardKpis } from "@/components/inventory/dashboard-kpis";
import { DashboardCharts } from "@/components/inventory/dashboard-charts";
import { QuickAlerts } from "@/components/inventory/quick-alerts";
import { ProductPhotoUpload } from "@/components/inventory/product-photo-upload";
import { CATEGORIES, UNITS } from "@/lib/inventory/constants";

export default function InventoryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [formName, setFormName] = useState("");
  const [formSku, setFormSku] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formUnit, setFormUnit] = useState("KG");
  const [formMinLevel, setFormMinLevel] = useState("");
  const [formMaxLevel, setFormMaxLevel] = useState("");
  const [formSupplierId, setFormSupplierId] = useState("");
  const [formLastCost, setFormLastCost] = useState("");
  const [formShelfLife, setFormShelfLife] = useState("");
  const [formStorage, setFormStorage] = useState("");
  const [formAllergenInfo, setFormAllergenInfo] = useState("");
  const [formPhotoUrl, setFormPhotoUrl] = useState<string | null>(null);
  const { selectedBranchId, selectedBranch } = useBranch();

  const { data: products = [], isLoading: loading } = useInventory(selectedBranchId || undefined);
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard(selectedBranchId || undefined);
  const createProduct = useCreateProduct();

  useEffect(() => {
    fetch("/api/inventory/suppliers")
      .then((res) => res.ok && res.json())
      .then((data) => setSuppliers(data.suppliers || []))
      .catch(() => {});
  }, []);

  const resetForm = () => {
    setFormName("");
    setFormSku("");
    setFormBarcode("");
    setFormCategory("");
    setFormUnit("KG");
    setFormMinLevel("");
    setFormMaxLevel("");
    setFormSupplierId("");
    setFormLastCost("");
    setFormShelfLife("");
    setFormStorage("");
    setFormAllergenInfo("");
    setFormPhotoUrl(null);
  };

  const handleCreateProduct = async () => {
    if (!formName.trim()) {
      toast.error("El nombre es requerido");
      return;
    }
    const body: Record<string, unknown> = {
      name: formName.trim(),
      unit: formUnit,
    };
    if (formSku.trim()) body.sku = formSku.trim();
    if (formBarcode.trim()) body.barcode = formBarcode.trim();
    if (formCategory) body.category = formCategory;
    if (formMinLevel && Number(formMinLevel) > 0) body.minLevel = Number(formMinLevel);
    if (formMaxLevel && Number(formMaxLevel) > 0) body.maxLevel = Number(formMaxLevel);
    if (formSupplierId) body.supplierId = formSupplierId;
    if (formLastCost && Number(formLastCost) > 0) body.lastCost = Math.round(Number(formLastCost) * 100);
    if (formShelfLife && Number(formShelfLife) > 0) body.typicalShelfLifeDays = Number(formShelfLife);
    if (formStorage.trim()) body.storageRequirements = formStorage.trim();
    if (formAllergenInfo.trim()) body.allergenInfo = formAllergenInfo.trim();
    if (formPhotoUrl) body.photoUrl = formPhotoUrl;

    createProduct.mutate(body, {
      onSuccess: () => {
        toast.success("Producto creado");
        setDialogOpen(false);
        resetForm();
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : "Error al crear producto");
      },
    });
  };

  const filteredProducts = products.filter((product) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      product.name?.toLowerCase().includes(q) ||
      product.sku?.toLowerCase().includes(q) ||
      product.category?.toLowerCase().includes(q)
    );
  });

  return (
    <PageContainer>
      <PageHeader
        title="Gestión de Inventario"
        description="Gestiona productos, niveles de stock y recepciones"
        icon={Package}
        branchName={selectedBranch?.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/inventory/receiving">
              <Button variant="outline" size="sm" className="gap-2">
                <PackagePlus className="h-4 w-4" />
                Recepción
              </Button>
            </Link>
            <Link href="/dashboard/inventory/suppliers">
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowRight className="h-4 w-4" />
                Proveedores
              </Button>
            </Link>
            <Link href="/dashboard/inventory/waste">
              <Button variant="outline" size="sm" className="gap-2">
                <AlertTriangle className="h-4 w-4" />
                Merma
              </Button>
            </Link>
            <Link href="/dashboard/inventory/stock-count">
              <Button variant="outline" size="sm" className="gap-2">
                <ClipboardList className="h-4 w-4" />
                Conteo
              </Button>
            </Link>
            <Link href="/dashboard/inventory/movements">
              <Button variant="outline" size="sm" className="gap-2">
                <Package className="h-4 w-4" />
                Movimientos
              </Button>
            </Link>
            <Link href="/dashboard/inventory/purchase-orders">
              <Button variant="outline" size="sm" className="gap-2">
                <FileText className="h-4 w-4" />
                Órdenes de Compra
              </Button>
            </Link>
            <Link href="/dashboard/inventory/recipes">
              <Button variant="outline" size="sm" className="gap-2">
                <ChefHat className="h-4 w-4" />
                Recetas & BOM
              </Button>
            </Link>
            <Link href="/dashboard/inventory/invoices">
              <Button variant="outline" size="sm" className="gap-2">
                <Upload className="h-4 w-4" />
                Cargar XML
              </Button>
            </Link>
            <Link href="/dashboard/inventory/reports">
              <Button variant="outline" size="sm" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Mermas
              </Button>
            </Link>
            <Button onClick={() => setDialogOpen(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" /> Agregar Producto
            </Button>
          </div>
        }
      />

      <DashboardKpis data={dashboardData} loading={dashboardLoading} />

      <DashboardCharts
        stockByCategory={dashboardData?.stockByCategory}
        recentMovements={dashboardData?.recentMovements}
      />

      <QuickAlerts
        topLowStock={dashboardData?.topLowStock}
        topExpiring={dashboardData?.topExpiring}
      />

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar productos..."
            className="pl-8 sm:w-[300px] md:w-[200px] lg:w-[300px]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
          <CardDescription>
            Lista de todos los artículos del inventario
            {selectedBranch && ` para ${selectedBranch.name}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Unidad</TableHead>
                  {selectedBranchId && <TableHead>Stock Actual</TableHead>}
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={selectedBranchId ? 6 : 5} className="text-center py-16">
                      {searchQuery.trim() && products.length > 0 ? (
                        <EmptyState
                          icon={Search}
                          title="Sin resultados"
                          description={`No hay productos que coincidan con "${searchQuery}".`}
                        />
                      ) : (
                        <EmptyState
                          icon={Package}
                          title="No se encontraron productos"
                          description="Agrega tu primer producto para comenzar a gestionar el inventario."
                          action={{ label: "Agregar Producto", onClick: () => setDialogOpen(true) }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                    filteredProducts.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          {product.photoUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={product.photoUrl} alt="" className="h-8 w-8 rounded object-cover border" />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-balance">{product.name}</span>
                          {product.isLowStock && selectedBranchId && (
                            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{product.sku}</TableCell>
                      <TableCell>{product.category}</TableCell>
                      <TableCell>{product.unit}</TableCell>
                      {selectedBranchId && (
                        <TableCell>
                          <span className={product.isLowStock ? "text-amber-600 font-medium" : ""}>
                            {product.currentStock || 0}
                          </span>
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Link href={`/dashboard/inventory/${product.id}`}>
                          <Button variant="ghost" size="sm">
                            Ver
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agregar Producto</DialogTitle>
            <DialogDescription>
              Ingresa los datos del nuevo producto
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="product-name">Nombre *</Label>
              <Input
                id="product-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre del producto"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="product-sku">SKU</Label>
                <Input
                  id="product-sku"
                  value={formSku}
                  onChange={(e) => setFormSku(e.target.value)}
                  placeholder="HAR-001"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-barcode">Código de Barras</Label>
                <Input
                  id="product-barcode"
                  value={formBarcode}
                  onChange={(e) => setFormBarcode(e.target.value)}
                  placeholder="750100123456"
                />
              </div>
              <div className="grid gap-2">
                <Label>Categoría</Label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>Unidad</Label>
                <Select value={formUnit} onValueChange={setFormUnit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar unidad" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-min-level">Stock Mínimo</Label>
                <Input
                  id="product-min-level"
                  type="number"
                  min="0"
                  value={formMinLevel}
                  onChange={(e) => setFormMinLevel(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-max-level">Stock Máximo</Label>
                <Input
                  id="product-max-level"
                  type="number"
                  min="0"
                  value={formMaxLevel}
                  onChange={(e) => setFormMaxLevel(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div className="grid gap-2">
                <Label htmlFor="product-shelf-life">Vida Útil (días)</Label>
                <Input
                  id="product-shelf-life"
                  type="number"
                  min="0"
                  value={formShelfLife}
                  onChange={(e) => setFormShelfLife(e.target.value)}
                  placeholder="Ej: 365"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-storage">Requisitos de Almacenamiento</Label>
                <Input
                  id="product-storage"
                  value={formStorage}
                  onChange={(e) => setFormStorage(e.target.value)}
                  placeholder="Ej: Temperatura ambiente < 25°C"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="product-allergen">Información de Alérgenos</Label>
              <Input
                id="product-allergen"
                value={formAllergenInfo}
                onChange={(e) => setFormAllergenInfo(e.target.value)}
                placeholder="Ej: Contiene gluten, lácteos"
              />
            </div>

            <ProductPhotoUpload
              currentPhotoUrl={null}
              onPhotoChange={setFormPhotoUrl}
            />

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div className="grid gap-2">
                <Label htmlFor="product-supplier">Proveedor Preferido</Label>
                <Select value={formSupplierId} onValueChange={setFormSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar Proveedor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.length > 0 ? (
                      suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))
                    ) : (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No hay proveedores registrados
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-cost">Costo Unitario</Label>
                <Input
                  id="product-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formLastCost}
                  onChange={(e) => setFormLastCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button onClick={handleCreateProduct} disabled={createProduct.isPending}>
              {createProduct.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Producto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
