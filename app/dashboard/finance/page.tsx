"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { FinancialKpiCards } from "@/components/sales/financial-kpi-cards";
import { MoneyAttentionPanel } from "@/components/finance/money-attention-panel";
import { CashFlowSummaryCard } from "@/components/finance/cash-flow-summary-card";
import { PnlBranchTable } from "@/components/finance/pnl-branch-table";
import { useBranch } from "@/lib/branch-context";
import {
  ArrowRight,
  Calendar,
  Coins,
  FileText,
  Receipt,
  Shield,
  Target,
  Wallet,
} from "lucide-react";

/**
 * Portada del módulo de Finanzas.
 *
 * Antes de esta pantalla, "Finanzas" en la navegación llevaba a
 * `/dashboard/sales` y el módulo era siete rutas sueltas: cortes, mapeo POS,
 * caja chica, gastos, flujo, control interno y fiscal. Ninguna respondía la
 * pregunta con la que el dueño abre el sistema — ¿cómo vamos de dinero? — y el
 * P&L por sucursal, que es el entregable central del M16, solo existía como un
 * bloque al fondo del dashboard ejecutivo.
 *
 * Esta página no calcula nada propio: compone lo que ya existe en el orden en
 * que se pregunta. Cómo vamos (KPIs) → qué necesita mi firma (atención) → me
 * alcanza (tesorería) → dónde gano y dónde pierdo (P&L).
 */

/** Accesos a las pantallas de captura y detalle del módulo. */
const SUBSECTIONS = [
  {
    title: "Cortes de Ventas",
    description: "Ingesta diaria del POS y arqueo de caja",
    href: "/dashboard/sales",
    icon: Coins,
  },
  {
    title: "Gastos Operativos",
    description: "Captura y autorización por nivel",
    href: "/dashboard/finance/expenses",
    icon: Receipt,
  },
  {
    title: "Cuentas por Pagar",
    description: "Lo que se debe, con antigüedad y vencimientos",
    href: "/dashboard/finance/payables",
    icon: FileText,
  },
  {
    title: "Caja Chica",
    description: "Fondo por sucursal y reposiciones",
    href: "/dashboard/finance/petty-cash",
    icon: Wallet,
  },
  {
    title: "Flujo de Efectivo",
    description: "Calendario de salidas a 30 días",
    href: "/dashboard/finance/cash-flow",
    icon: Calendar,
  },
  {
    title: "Control Interno",
    description: "Bitácora de autorizaciones y excepciones",
    href: "/dashboard/finance/control-interno",
    icon: Shield,
  },
  {
    title: "Fiscal y Facturación",
    description: "Validación CFDI y timbrado de nómina",
    href: "/dashboard/finance/fiscal",
    icon: Receipt,
  },
  {
    // Los objetivos se leen arriba en cada semáforo; el camino para cambiarlos
    // debe salir de aquí y no de buscarlos en Organización.
    title: "Objetivos de Costo",
    description: "Umbrales de food cost, labor cost y margen",
    href: "/dashboard/company/operating-config",
    icon: Target,
  },
] as const;

export default function FinanceOverviewPage() {
  // Mismo scope que el resto del módulo: el control del encabezado manda.
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Coins className="h-7 w-7 text-primary" /> Finanzas
        </h1>
        <p className="text-sm text-muted-foreground">
          Cómo vamos de dinero: costos contra objetivo, lo que espera tu firma, la tesorería del mes
          y la utilidad por sucursal.
        </p>
      </div>

      {/* 1. ¿Cómo vamos? — costos contra el objetivo del grupo, con tendencia. */}
      <FinancialKpiCards branchId={selectedBranch} />

      {/* 2. ¿Qué necesita mi firma hoy? */}
      <MoneyAttentionPanel branchId={selectedBranch} />

      {/* 3. ¿Me alcanza? */}
      <CashFlowSummaryCard branchId={selectedBranch} />

      {/* 4. ¿Dónde gano y dónde pierdo? El P&L es por sucursal a propósito: es
          la comparación que el dueño usa para decidir. No se filtra por el
          scope del encabezado porque su valor está justamente en verlas juntas. */}
      <PnlBranchTable />

      {/* Accesos al detalle y a la captura. */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Detalle y captura</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUBSECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 shrink-0 rounded-md border border-border p-2 text-primary">
                    <section.icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{section.title}</p>
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" aria-hidden />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
