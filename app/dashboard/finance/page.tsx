"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { FinancialKpiCards } from "@/components/sales/financial-kpi-cards";
import { MoneyAttentionPanel } from "@/components/finance/money-attention-panel";
import { CashFlowSummaryCard } from "@/components/finance/cash-flow-summary-card";
import { PnlBranchTable } from "@/components/finance/pnl-branch-table";
import { PeriodSelector, getPresetRange, type DateRange } from "@/components/finance/period-selector";
import { useBranch } from "@/lib/branch-context";
import {
  ArrowRight,
  Calendar,
  Coins,
  FileCheck,
  FileText,
  Handshake,
  Landmark,
  Percent,
  Receipt,
  RefreshCw,
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
 * que se pregunta. Cómo vamos (KPIs) → dónde gano y dónde pierdo (P&L) → qué
 * necesita mi firma (atención) → me alcanza (tesorería).
 */

// --------------------------------------------------------------------------
//  Badges: conteos vivos para las tarjetas de navegación
// --------------------------------------------------------------------------

/** Mapa href → conteo pendiente. Solo se cuenta lo que tiene acción del dueño. */
type BadgeCounts = Record<string, number>;

function useBadgeCounts(branchId: string, refreshKey: number): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>({});

  useEffect(() => {
    const scoped = (path: string) => {
      const url = new URL(path, window.location.origin);
      if (branchId !== "ALL") url.searchParams.set("branchId", branchId);
      return url.toString();
    };

    // Lanzar las consultas en paralelo; si una falla el badge se queda en
    // cero, que es seguro (no afirma nada falso).
    Promise.allSettled([
      fetch(scoped("/api/expenses")).then((r) => r.json()),
      fetch(scoped("/api/finance/control-interno/excepciones")).then((r) => r.json()),
    ]).then(([expensesResult, violationsResult]) => {
      const next: BadgeCounts = {};

      if (expensesResult.status === "fulfilled" && expensesResult.value?.success) {
        const items = expensesResult.value.data?.items ?? [];
        const pending = items.filter((e: { status: string }) => e.status === "PENDING_APPROVAL");
        if (pending.length > 0) next["/dashboard/finance/expenses"] = pending.length;
      }

      if (violationsResult.status === "fulfilled" && violationsResult.value?.success) {
        const violations = violationsResult.value.data?.violations ?? [];
        if (violations.length > 0) next["/dashboard/finance/control-interno"] = violations.length;
      }

      setCounts(next);
    });
  }, [branchId, refreshKey]);

  return counts;
}

// --------------------------------------------------------------------------
//  Section navigation items
// --------------------------------------------------------------------------

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
      {
        title: "Comisiones por Canal",
        description: "Lo que se queda cada agregador y la terminal, y sus tarifas",
        href: "/dashboard/finance/commissions",
        icon: Percent,
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
        icon: Landmark,
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
        icon: FileCheck,
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

  // Refresh global: incrementar esta key fuerza la recarga de todos los hijos.
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(() => getPresetRange("this_month"));

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    // El estado de refreshing se limpia después de un tick para que el icono
    // haga un giro visual y la key ya esté propagada.
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  // Atajo de teclado global: Ctrl+Shift+R recarga todos los paneles.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refresh]);

  const badgeCounts = useBadgeCounts(selectedBranch, refreshKey);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="h-7 w-7 text-primary" /> Finanzas
          </h1>
          <p className="text-sm text-muted-foreground max-w-[70ch]">
            Cómo vamos de dinero: costos contra objetivo, lo que espera tu firma, la tesorería del mes
            y la utilidad por sucursal.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
          <PeriodSelector dateRange={dateRange} onDateRangeChange={setDateRange} disabled={refreshing} />
          <button
            type="button"
            onClick={refresh}
            className="self-start sm:self-center inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-input bg-background text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Recargar todos los paneles (Ctrl+Shift+R)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Recargar</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1 py-0.5 text-xs font-mono text-muted-foreground bg-muted border border-border rounded">
              Ctrl+⇧+R
            </kbd>
          </button>
        </div>
      </div>

      {/* Un solo rótulo deliberado abre la narrativa; los otros tres bloques
          ya se presentan solos con su título de card (Regla del anti-patrón
          "eyebrow en cada sección" de DESIGN.md).
          1. ¿Cómo vamos? — costos contra el objetivo del grupo, con tendencia. */}
      <section id="kpis">
        <h2 className="text-sm font-semibold text-foreground/80 mb-2">
          ¿Cómo vamos?
        </h2>
        <FinancialKpiCards key={`kpi-${refreshKey}`} branchId={selectedBranch} dateRange={dateRange} />
      </section>

      {/* 2. ¿Dónde gano y dónde pierdo? El P&L es la comparación que el dueño
          usa para decidir. No se filtra por el scope del encabezado porque su
          valor está justamente en verlas juntas. Movido a posición 2 para que
          el número más valioso esté visible sin scroll en 1440p. */}
      <section id="pnl">
        <PnlBranchTable key={`pnl-${refreshKey}`} dateRange={dateRange} />
      </section>

      {/* 3. ¿Qué necesita mi firma hoy? */}
      <section id="atencion">
        <MoneyAttentionPanel key={`att-${refreshKey}`} branchId={selectedBranch} dateRange={dateRange} />
      </section>

      {/* 4. ¿Me alcanza? */}
      <section id="tesoreria">
        <CashFlowSummaryCard key={`cash-${refreshKey}`} branchId={selectedBranch} dateRange={dateRange} />
      </section>

      {/* ── Corte visual: la sección de arriba es análisis; la de abajo es
          navegación. Sin esta separación las dos se leían al mismo volumen. */}
      <div className="relative py-2">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      </div>

      <section id="modulos">
        <h2 className="text-sm font-semibold text-foreground/80 mb-4">
          Accesos al módulo
        </h2>
        <div className="space-y-5">
          {SECTION_GROUPS.map((group) => (
            <section key={group.label}>
              <h2 className="text-sm font-semibold text-foreground/80 mb-3">{group.label}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.items.map((item) => {
                  const badgeCount = badgeCounts[item.href];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Card className="h-full transition-all duration-150 hover:bg-muted/40 hover:border-muted-foreground/30">
                        <CardContent className="flex items-start gap-3 p-4">
                          <span className="mt-0.5 shrink-0 rounded-md border border-border p-2 text-primary">
                            <item.icon className="w-4 h-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium flex items-center gap-2">
                              {item.title}
                              {badgeCount != null && badgeCount > 0 && (
                                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold rounded-full bg-destructive/15 text-destructive border border-destructive/20 tabular-nums">
                                  {badgeCount}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                          </div>
                          <ArrowRight
                            className="w-4 h-4 text-muted-foreground shrink-0 mt-1"
                            aria-hidden
                          />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
