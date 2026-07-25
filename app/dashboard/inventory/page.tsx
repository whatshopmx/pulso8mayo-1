"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2, Package, PackagePlus, ArrowRight, AlertTriangle, ClipboardList, FileText, ChefHat, Upload, Building2, ChevronRight } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { ProductDetailDrawer } from "@/components/inventory/product-detail-drawer";

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
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [suppliersError, setSuppliersError] = useState(false);
  
  // Dashboard Refactor State variables
  const [activeTab, setActiveTab] = useState<"all" | "low" | "expiring" | "inactive">("all");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { selectedBranchId, selectedBranch } = useBranch();

  const { data: products = [], isLoading: loading } = useInventory(selectedBranchId || undefined);
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard(selectedBranchId || undefined);
  const createProduct = useCreateProduct();

  const isDirty = formName !== "" || formSku !== "" || formBarcode !== "" || formCategory !== "" || formUnit !== "KG" || formMinLevel !== "" || formMaxLevel !== "" || formSupplierId !== "" || formLastCost !== "" || formShelfLife !== "" || formStorage !== "" || formAllergenInfo !== "" || formPhotoUrl !== null;

  const fetchSuppliers = () => {
    setSuppliersError(false);
    fetch("/api/inventory/suppliers")
      .then((res) => {
        if (!res.ok) throw new Error("Error al cargar proveedores");
        return res.json();
      })
      .then((data) => setSuppliers(data.suppliers || []))
      .catch(() => {
        setSuppliersError(true);
        toast.error("Error al cargar proveedores");
      });
  };

  useEffect(fetchSuppliers, []);

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

  const tabFilteredProducts = filteredProducts.filter((product) => {
    if (activeTab === "low") {
      return product.isLowStock;
    }
    if (activeTab === "inactive") {
      return (product.currentStock || 0) === 0 && !product.isLowStock;
    }
    if (activeTab === "expiring") {
      const expiringIds = (dashboardData?.topExpiring || []).map((e: { itemId: string }) => e.itemId);
      return expiringIds.includes(product.id);
    }
    return true;
  });

  return (
    <PageContainer>
      <PageHeader
        title="Gestión de Inventario"
        description="Dashboard operativo y control de stock"
        icon={Package}
        branchName={selectedBranch?.name}
        actions={
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" /> Agregar Producto
          </Button>
        }
      />

      {/* Hub de Operaciones */}
      <div className="space-y-3 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-primary/30 bg-primary/[0.02] hover:border-primary hover:scale-[1.02] transition-all cursor-pointer">
            <Link href="/dashboard/inventory/receiving" className="h-full flex flex-col justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                  <PackagePlus className="h-5 w-5" />
                </div>
                <span className="font-semibold">Recepción</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Registra entradas de stock con lectura de código de barras.</p>
            </Link>
          </Card>

          <Card className="border-primary/30 bg-primary/[0.02] hover:border-primary hover:scale-[1.02] transition-all cursor-pointer">
            <Link href="/dashboard/inventory/stock-count" className="h-full flex flex-col justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <span className="font-semibold">Auditorías / Conteo</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Realiza conteos físicos regulares (soporta Conteo sin Stock Esperado).</p>
            </Link>
          </Card>

          <Card className="border-primary/30 bg-primary/[0.02] hover:border-primary hover:scale-[1.02] transition-all cursor-pointer">
            <Link href="/dashboard/inventory/purchase-orders" className="h-full flex flex-col justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <span className="font-semibold">Órdenes de Compra</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Genera solicitudes de compra en PDF y compártelas en WhatsApp.</p>
            </Link>
          </Card>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Card className="hover:border-primary/40 hover:scale-[1.01] transition-all cursor-pointer bg-card">
            <Link href="/dashboard/inventory/transfers" className="h-full flex flex-col justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <ArrowRight className="h-5 w-5" />
                </div>
                <span className="font-semibold text-sm">Transferencias</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Envía o recibe mercancías entre tus sucursales.</p>
            </Link>
          </Card>

          <Card className="hover:border-primary/40 hover:scale-[1.01] transition-all cursor-pointer bg-card">
            <Link href="/dashboard/inventory/waste" className="h-full flex flex-col justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <span className="font-semibold text-sm">Mermas y Consumos</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Reporta mermas por caducidad, mermas de tránsito o consumo de staff.</p>
            </Link>
          </Card>

          <Card className="hover:border-primary/40 hover:scale-[1.01] transition-all cursor-pointer bg-card">
            <Link href="/dashboard/inventory/invoices" className="h-full flex flex-col justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Upload className="h-5 w-5" />
                </div>
                <span className="font-semibold text-sm">Cargar Factura XML</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Carga archivos CFDI para realizar la conciliación de 3 vías.</p>
            </Link>
          </Card>
        </div>

        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1 py-1 select-none">
            <ChevronRight className="h-3.5 w-3.5 group-open:rotate-90 transition-transform" />
            Más operaciones
          </summary>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            <Card className="hover:border-primary/40 hover:scale-[1.01] transition-all cursor-pointer bg-card">
              <Link href="/dashboard/inventory/recipes" className="h-full flex flex-col justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <ChefHat className="h-5 w-5" />
                  </div>
                  <span className="font-semibold text-sm">Recetas & Fórmulas</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Monitorea el costeo de ingredientes y fórmulas de recetas.</p>
              </Link>
            </Card>

            <Card className="hover:border-primary/40 hover:scale-[1.01] transition-all cursor-pointer bg-card">
              <Link href="/dashboard/inventory/suppliers" className="h-full flex flex-col justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <span className="font-semibold text-sm">Proveedores</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Administra contactos comerciales e historiales de precios.</p>
              </Link>
            </Card>
          </div>
        </details>
      </div>

      <div className="space-y-6">
        <DashboardKpis data={dashboardData} loading={dashboardLoading} />

        <DashboardCharts
          stockByCategory={dashboardData?.stockByCategory}
          recentMovements={dashboardData?.recentMovements}
        />

        <QuickAlerts
          topLowStock={dashboardData?.topLowStock}
          topExpiring={dashboardData?.topExpiring}
        />

        {/* Tab-filtered Products List Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Productos en Almacén</CardTitle>
                <CardDescription>
                  Consulta el catálogo de insumos
                  {selectedBranch && ` para ${selectedBranch.name}`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Filter tab bar */}
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
                  variant={activeTab === "low" ? "secondary" : "ghost"} 
                  size="sm" 
                  onClick={() => setActiveTab("low")}
                  className="text-xs font-semibold flex items-center gap-1.5"
                >
                  Bajo Stock 
                  {products.filter(p => p.isLowStock).length > 0 && (
                    <Badge variant="destructive" className="h-4 px-1 min-w-[16px] flex items-center justify-center text-xs rounded-full">
                      {products.filter(p => p.isLowStock).length}
                    </Badge>
                  )}
                </Button>
                <Button 
                  variant={activeTab === "expiring" ? "secondary" : "ghost"} 
                  size="sm" 
                  onClick={() => setActiveTab("expiring")}
                  className="text-xs font-semibold flex items-center gap-1.5"
                >
                  Por Vencer
                  {(dashboardData?.topExpiring || []).length > 0 && (
                    <Badge variant="warning" className="h-4 px-1 min-w-[16px] flex items-center justify-center text-xs rounded-full">
                      {(dashboardData?.topExpiring || []).length}
                    </Badge>
                  )}
                </Button>
                <Button 
                  variant={activeTab === "inactive" ? "secondary" : "ghost"} 
                  size="sm" 
                  onClick={() => setActiveTab("inactive")}
                  className="text-xs font-semibold"
                >
                  Inactivos
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

            {loading ? (
              <div className="flex justify-center p-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
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
                            action={{ label: "Agregar Producto", onClick: () => setDialogOpen(true) }}
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
                        <TableCell className="font-mono text-xs">{product.sku || "N/A"}</TableCell>
                        <TableCell className="capitalize">{product.category || "General"}</TableCell>
                        <TableCell>{product.unit}</TableCell>
                        <TableCell className="font-mono">
                          {selectedBranchId ? (
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open && isDirty) { setConfirmDiscardOpen(true); } else { setDialogOpen(open); } }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-background">
          <DialogHeader>
            <DialogTitle>Agregar Producto</DialogTitle>
            <DialogDescription>
              Ingresa los datos del nuevo producto para el catálogo.
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
                    {suppliersError ? (
                      <div className="p-3 text-sm text-center space-y-2">
                        <p className="text-destructive">Error al cargar</p>
                        <Button variant="outline" size="sm" onClick={fetchSuppliers}>
                          Reintentar
                        </Button>
                      </div>
                    ) : suppliers.length > 0 ? (
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

      <Dialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>¿Descartar cambios?</DialogTitle>
            <DialogDescription>
              Los datos ingresados se perderán si cierras el formulario.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscardOpen(false)}>
              Seguir editando
            </Button>
            <Button variant="destructive" onClick={() => { setConfirmDiscardOpen(false); setDialogOpen(false); resetForm(); }}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Side-over detail Drawer */}
      <ProductDetailDrawer
        productId={selectedProductId}
        branchId={selectedBranchId || null}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </PageContainer>
  );
}
