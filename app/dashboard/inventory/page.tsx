"use client";

import Link from "next/link";
import {
  Plus, Package, PackagePlus, ClipboardList, Trash2, ShoppingCart,
  ChevronRight, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useBranch } from "@/lib/branch-context";
import { PageHeader, PageContainer } from "@/components/shared";
import { useDashboard } from "@/hooks/queries";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { DashboardKpis } from "@/components/inventory/dashboard-kpis";
import { QuickAlerts } from "@/components/inventory/quick-alerts";
import { HighValueSkusSection } from "@/components/inventory/high-value-skus-section";

// Acciones del día — el gerente abre aquí para empezar a operar
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

export default function InventoryPage() {
  const { branches, selectedBranchId } = useBranch();

  // Scope now comes from the header BranchScopeControl (AD-1).
  // selectedBranchId = null => "Todas" => chain-wide rollup (Mariana's morning brief);
  // a specific id => per-branch view for the gerente.
  const isAll = selectedBranchId == null;
  const activeBranchId = isAll ? undefined : selectedBranchId;
  const activeBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  const { data: dashboardData, isLoading: dashboardLoading, isError: dashboardError, refetch: refetchDashboard } = useDashboard(activeBranchId);

  const updatedAt = useRelativeTime(dashboardData?.generatedAt);
  const retry = () => refetchDashboard();

  return (
    <PageContainer>
      <PageHeader
        title="Gestión de Inventario"
        description="Panel operativo y control de stock"
        icon={Package}
        badge={isAll && dashboardData && dashboardData.branchesWithStock > 0 ? `${dashboardData.branchesWithStock} sucursales con stock` : undefined}
        branchName={activeBranch?.name}
        actions={
          <div className="flex items-center gap-2">
            {/* Branch scope lives in the header BranchScopeControl (T1). */}
            <Button asChild size="sm">
              <Link href="/dashboard/inventory/new">
                <Plus className="mr-2 h-4 w-4" /> Agregar Producto
              </Link>
            </Button>
          </div>
        }
      />

      {updatedAt && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors -mt-3 mb-1"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                <span>Actualizado · {updatedAt}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px]">
              Última actualización del panel (refresco de datos), no del último conteo físico de inventario.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      <div className="space-y-6">
        {/* 1. El estado */}
        <DashboardKpis
          data={dashboardData}
          loading={dashboardLoading}
          isError={dashboardError}
          onRetry={retry}
          scopeLabel={isAll ? "todas las sucursales" : activeBranch?.name}
        />

        {/* 2. Qué necesita atención — el corazón del brief */}
        <QuickAlerts
          topLowStock={dashboardData?.topLowStock}
          topExpiring={dashboardData?.topExpiring}
          isError={dashboardError}
          onRetry={retry}
          showBranchAttribution={isAll}
        />

        {/* Fase 4: SKUs de alto valor (conteo semanal 80/20) */}
        <HighValueSkusSection key={activeBranchId ?? "all"} branchId={activeBranchId} />

        {/* 3. Dónde empiezo — strip delgado */}
        <section aria-label="Acciones del día">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Empezar el día</h2>
            <Link
              href="/dashboard/inventory/products"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              Catálogo completo <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {DAILY_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-center gap-3 rounded-lg border bg-card p-3 min-h-[56px] transition-colors hover:border-primary hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <action.icon className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-sm block leading-tight">{action.label}</span>
                  <span className="text-xs text-muted-foreground truncate block">{action.description}</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PageContainer>
  );
}