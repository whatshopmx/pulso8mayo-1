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
  Handshake,
  Receipt,
  Shield,
  Target,
  Users,
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

/** Accesos a las pantallas de captura y detalle del módulo, agrupados por
 *  la pregunta que responden: qué capturo hoy, a quién le pago, cómo cumplo. */
const SECTION_GROUPS = [
  {
    label: "Operación del día",
    items: [
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
        title: "Caja Chica",
        description: "Fondo por sucursal y reposiciones",
        href: "/dashboard/finance/petty-cash",
        icon: Wallet,
      },
      {
        title: "Costo Laboral",
        description: "Nómina sobre venta por sucursal, contra el objetivo",
        href: "/dashboard/finance/labor-cost",
        icon: Users,
      },
    ],
  },
  {
    label: "A quién le pago",
    items: [
      {
        title: "Cuentas por Pagar",
        description: "Lo que se debe, con antigüedad y vencimientos",
        href: "/dashboard/finance/payables",
        icon: FileText,
      },
      {
        title: "Contrapartes",
        description: "A quién se le paga: renta, luz, gas, servicios",
        href: "/dashboard/finance/payees",
        icon: Handshake,
      },
      {
        title: "Flujo de Efectivo",
        description: "Calendario de salidas a 30 días",
        href: "/dashboard/finance/cash-flow",
        icon: Calendar,
      },
      {
        title: "Tesorería",
        description: "Corridas de pago, dispersión SPEI y contratos fijos",
        href: "/dashboard/finance/treasury",
        icon: Wallet,
      },
    ],
  },
  {
    label: "Control y cumplimiento",
    items: [
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
    ],
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
        <p className="text-sm text-muted-foreground max-w-[70ch]">
          Cómo vamos de dinero: costos contra objetivo, lo que espera tu firma, la tesorería del mes
          y la utilidad por sucursal.
        </p>
      </div>

      {/* Un solo rótulo deliberado abre la narrativa; los otros tres bloques
          ya se presentan solos con su título de card (Regla del anti-patrón
          "eyebrow en cada sección" de DESIGN.md).
          1. ¿Cómo vamos? — costos contra el objetivo del grupo, con tendencia. */}
      <section>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
          ¿Cómo vamos?
        </p>
        <FinancialKpiCards branchId={selectedBranch} />
      </section>

      {/* 2. ¿Qué necesita mi firma hoy? */}
      <MoneyAttentionPanel branchId={selectedBranch} />

      {/* 3. ¿Me alcanza? */}
      <CashFlowSummaryCard branchId={selectedBranch} />

      {/* 4. ¿Dónde gano y dónde pierdo? El P&L es por sucursal a propósito: es
          la comparación que el dueño usa para decidir. No se filtra por el
          scope del encabezado porque su valor está justamente en verlas juntas. */}
      <PnlBranchTable />

      {/* Accesos al detalle y la captura, agrupados para que buscar un módulo
          sea recorrer tres rótulos y no nueve tarjetas sueltas. */}
      <div className="space-y-5">
        {SECTION_GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="text-sm font-semibold text-foreground/80 mb-3">{group.label}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.items.map((section) => (
                <Link
                  key={section.href}
                  href={section.href}
                  className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full transition-all duration-150 hover:bg-muted/40 hover:border-muted-foreground/30">
                    <CardContent className="flex items-start gap-3 p-4">
                      <span className="mt-0.5 shrink-0 rounded-md border border-border p-2 text-primary">
                        <section.icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{section.title}</p>
                        <p className="text-xs text-muted-foreground">{section.description}</p>
                      </div>
                      <ArrowRight
                        className="w-4 h-4 text-muted-foreground shrink-0 mt-1"
                        aria-hidden
                      />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
