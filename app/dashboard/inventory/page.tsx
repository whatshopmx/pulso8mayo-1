"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus, Search, Package, PackagePlus, ClipboardList, AlertTriangle, FileText,
  ArrowRight, Trash2, Factory, ShoppingCart, Lightbulb, Building2, Upload,
  MessageSquareWarning, Bell, Clock, History, ScrollText, BarChart3,
  PieChart, TrendingUp, Sparkles, ChefHat, MapPin, ChevronRight,
} from "lucide-react";
import { DataTableSkeleton } from "@/components/shared/skeletons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBranch } from "@/lib/branch-context";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { useInventory, useDashboard } from "@/hooks/queries";
import { DashboardKpis } from "@/components/inventory/dashboard-kpis";
import { DashboardCharts } from "@/components/inventory/dashboard-charts";
import { QuickAlerts } from "@/components/inventory/quick-alerts";
import { Badge } from "@/components/ui/badge";
import { ProductDetailDrawer } from "@/components/inventory/product-detail-drawer";

// Acciones diarias del gerente — un tap desde el home
const DAILY_ACTIONS = [
  {
    href: "/dashboard/inventory/receiving",
    icon: PackagePlus,
    label: "Recepción",
    description: "Registra la mercancía que llega del proveedor",
  },
  {
    href: "/dashboard/inventory/stock-count",
    icon: ClipboardList,
    label: "Conteo",
    description: "Cuenta el inventario físico y revisa diferencias",
  },
  {
    href: "/dashboard/inventory/waste",
    icon: Trash2,
    label: "Merma",
    description: "Da de baja producto vencido o dañado",
  },
  {
    href: "/dashboard/inventory/purchase-orders?new=1",
    icon: ShoppingCart,
    label: "Nueva OC",
    description: "Pide mercancía a tus proveedores",
  },
];

// Mapa completo del módulo, agrupado por tarea
const NAV_GROUPS: {
  title: string;
  items: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; description: string }[];
}[] = [
  {
    title: "Operar",
    items: [
      { href: "/dashboard/inventory/receiving", icon: PackagePlus, label: "Recepción", description: "Entradas de mercancía" },
      { href: "/dashboard/inventory/stock-count", icon: ClipboardList, label: "Conteo de Inventario", description: "Conteos físicos y ajustes" },
      { href: "/dashboard/inventory/waste", icon: Trash2, label: "Mermas", description: "Bajas por caducidad o daño" },
      { href: "/dashboard/inventory/transfers", icon: ArrowRight, label: "Transferencias", description: "Movimientos entre sucursales" },
      { href: "/dashboard/inventory/production", icon: Factory, label: "Producción", description: "Preparaciones y transformación" },
    ],
  },
  {
    title: "Comprar",
    items: [
      { href: "/dashboard/inventory/purchase-orders", icon: FileText, label: "Órdenes de Compra", description: "Pedidos a proveedores" },
      { href: "/dashboard/inventory/suggested-orders", icon: Lightbulb, label: "Órdenes Sugeridas", description: "Qué comprar según tus mínimos" },
      { href: "/dashboard/inventory/suppliers", icon: Building2, label: "Proveedores", description: "Contactos y precios" },
      { href: "/dashboard/inventory/invoices", icon: Upload, label: "Facturas (XML)", description: "Compara factura vs. lo recibido" },
      { href: "/dashboard/inventory/claims", icon: MessageSquareWarning, label: "Reclamos", description: "Problemas con entregas" },
    ],
  },
  {
    title: "Analizar",
    items: [
      { href: "/dashboard/inventory/alerts", icon: Bell, label: "Alertas de Stock", description: "Bajo stock y por vencer" },
      { href: "/dashboard/inventory/expirations", icon: Clock, label: "Vencimientos", description: "Lotes próximos a caducar" },
      { href: "/dashboard/inventory/movements", icon: History, label: "Movimientos", description: "Historial de entradas y salidas" },
      { href: "/dashboard/inventory/audit", icon: ScrollText, label: "Auditoría", description: "Quién cambió qué" },
      { href: "/dashboard/inventory/reports", icon: BarChart3, label: "Reportes", description: "Mermas y variaciones" },
      { href: "/dashboard/inventory/reports/executive", icon: PieChart, label: "Dashboard Ejecutivo", description: "Visión financiera" },
      { href: "/dashboard/inventory/menu-engineering", icon: TrendingUp, label: "Ingeniería de Menú", description: "Platillos rentables" },
      { href: "/dashboard/inventory/costing", icon: TrendingUp, label: "Costeo", description: "Configuración de costos" },
      { href: "/dashboard/inventory/intelligence", icon: Sparkles, label: "Pulso Intelligence", description: "Análisis inteligente" },
    ],
  },
  {
    title: "Configurar",
    items: [
      { href: "/dashboard/inventory/recipes", icon: ChefHat, label: "Recetas y Costeo", description: "Ingredientes por platillo" },
      { href: "/dashboard/inventory/locations", icon: MapPin, label: "Ubicaciones", description: "Almacenes y áreas" },
    ],
  },
];

export default function InventoryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "out">("all");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { selectedBranchId, selectedBranch } = useBranch();

  const { data: products = [], isLoading: loading } = useInventory(selectedBranchId || undefined);
  const { data: dashboardData, isLoading: dashboardLoading } = useDashboard(selectedBranchId || undefined);

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
        title="Gestión de Inventario"
        description="Panel operativo y control de stock"
        icon={Package}
        branchName={selectedBranch?.name}
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/inventory/new">
              <Plus className="mr-2 h-4 w-4" /> Agregar Producto
            </Link>
          </Button>
        }
      />

      {/* Acciones del día — un tap */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {DAILY_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex flex-col gap-1 rounded-lg border bg-card p-4 min-h-[88px] transition-colors hover:border-primary hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-2">
              <action.icon className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{action.label}</span>
              <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-muted-foreground">{action.description}</p>
          </Link>
        ))}
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

        {/* Catálogo de productos */}
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
                    <Badge variant="destructive" className="h-4 px-1 min-w-[16px] flex items-center justify-center text-xs rounded-full">
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

            {loading ? (
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
                            <span className="text-balance">{product.name}</span>
                            {product.isLowStock && selectedBranchId && (
                              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{product.sku || "—"}</TableCell>
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

        {/* Mapa del módulo — todas las herramientas agrupadas */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Todas las herramientas</CardTitle>
            <CardDescription>Cada rincón del módulo, agrupado por tarea</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {NAV_GROUPS.map((group) => (
                <div key={group.title}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {group.title}
                  </h3>
                  <ul className="space-y-1">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-2 rounded-md px-2 py-2 min-h-[40px] text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium">{item.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

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
