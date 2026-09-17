"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowRight, Flame, Building, MousePointerClick } from "lucide-react";
import { PnlAuditDrawer } from "./pnl-audit-drawer";
import { cn } from "@/lib/utils";

interface LeakBranch {
  branchId: string;
  branchName: string;
  primeCostPercent: number;
  foodCostPercent: number;
  laborCostPercent: number;
}

interface PnlWaterfallProps {
  salesTotalCents: number;
  foodCostPercent: number;
  laborCostPercent: number;
  storeOpexPercent?: number;
  /** Sucursal con la mayor fuga de Prime Cost de la red (opcional). */
  leakBranch?: LeakBranch | null;
}

/** Escala base cuando la red todavía no captura ventas del periodo. */
const DEFAULT_SALES_CENTS = 100_000_000; // $1M MXN
/** Piso de rentabilidad: Prime Margin ≥ 40% (equivalente a Prime Cost ≤ 60%). */
const PRIME_MARGIN_FLOOR = 0.4;

type StepKind = "total" | "cost" | "result";

interface WaterfallStep {
  key: string;
  /** Etiqueta corta para el eje X. */
  name: string;
  /** Nombre completo para tooltips y lectura asistida. */
  label: string;
  caption: string;
  baseCents: number;
  valueCents: number;
  kind: StepKind;
  percentOfSales: number;
}

function fmtMxn(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
}

function fmtMxnCompact(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}$${(abs / 1e8).toFixed(1)}M`;
  if (abs >= 1e5) return `${sign}$${(abs / 1e5).toFixed(0)}K`;
  return `${sign}$${(abs / 100).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

interface WaterfallTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: WaterfallStep }>;
  leakBranch?: LeakBranch | null;
}

/**
 * Tooltip del puente deductivo: nombre completo del escalón, monto y —cuando el
 * escalón es un costo— la sucursal responsable de la mayor fuga de la red.
 */
function WaterfallTooltip({ active, payload, leakBranch }: WaterfallTooltipProps) {
  const step = payload?.[0]?.payload;
  if (!active || !step) return null;

  return (
    <div className="min-w-52 rounded-lg border border-border bg-popover p-3 text-xs">
      <p className="font-semibold text-foreground">{step.label}</p>
      <p className="mt-0.5 text-muted-foreground">{step.caption}</p>
      <p className="mt-1.5 font-mono font-medium tabular-nums text-foreground">
        {step.kind === "cost" ? `-${fmtMxn(step.valueCents)}` : fmtMxn(step.valueCents)}
        <span className="ml-1.5 font-sans font-normal text-muted-foreground">
          ({step.percentOfSales.toFixed(1)}% de ventas)
        </span>
      </p>
      {step.kind === "cost" && leakBranch && (
        <p className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">
          Mayor fuga:{" "}
          <span className="font-semibold text-foreground">{leakBranch.branchName}</span> con{" "}
          {leakBranch.primeCostPercent.toFixed(1)}% de Prime Cost
        </p>
      )}
    </div>
  );
}

/** Recharts 2.x tipa `radius` como `number | string` en `Cell`, aunque el
 *  renderizador de rectángulos acepta la tupla [sup-izq, sup-der, inf-der, inf-izq]. */
function cornerRadius(roundedOnTop: boolean): number {
  return (roundedOnTop ? [4, 4, 0, 0] : [0, 0, 4, 4]) as unknown as number;
}

/**
 * Puente deductivo del dinero: Ingresos Netos → −Insumos → =Margen Bruto →
 * −Nómina → =Prime Margin → −OpEx → =EBITDA.
 *
 * Se dibuja con dos series apiladas (base invisible + valor visible) para que
 * cada escalón flote donde corresponde y el ojo siga la merma de margen.
 */
export function PnlExecutiveWaterfall({
  salesTotalCents,
  foodCostPercent,
  laborCostPercent,
  storeOpexPercent = 18.0,
  leakBranch = null,
}: PnlWaterfallProps) {
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const safeSales = salesTotalCents > 0 ? salesTotalCents : DEFAULT_SALES_CENTS;
  const isEstimated = salesTotalCents <= 0;

  const foodCostCents = Math.round((foodCostPercent / 100) * safeSales);
  const laborCostCents = Math.round((laborCostPercent / 100) * safeSales);
  const storeOpexCents = Math.round((storeOpexPercent / 100) * safeSales);

  const grossMarginCents = safeSales - foodCostCents;
  const primeMarginCents = grossMarginCents - laborCostCents;
  const ebitdaCents = primeMarginCents - storeOpexCents;

  const ebitdaPercent = safeSales > 0 ? (ebitdaCents / safeSales) * 100 : 0;
  const primeMarginPercent = safeSales > 0 ? (primeMarginCents / safeSales) * 100 : 0;
  const isEbitdaPositive = ebitdaCents >= 0;

  const pct = (cents: number) => (safeSales > 0 ? (cents / safeSales) * 100 : 0);
  // Recharts separa las pilas por signo: la base (invisible) nunca es negativa.
  const floatingBase = (cents: number) => Math.max(0, Math.round(cents));

  const primeMarginFloorCents = safeSales * PRIME_MARGIN_FLOOR;

  const steps: WaterfallStep[] = [
    {
      key: "sales",
      name: "Ventas",
      label: "Ingresos Netos",
      caption: "Base de cálculo del periodo (100%)",
      baseCents: 0,
      valueCents: safeSales,
      kind: "total",
      percentOfSales: 100,
    },
    {
      key: "food",
      name: "Insumos",
      label: "Costo de Insumos (COGS)",
      caption: "Alimentos, bebidas y merma",
      baseCents: floatingBase(grossMarginCents),
      valueCents: foodCostCents,
      kind: "cost",
      percentOfSales: pct(foodCostCents),
    },
    {
      key: "gross",
      name: "M. Bruto",
      label: "Margen Bruto",
      caption: "Ventas menos costo de insumos",
      baseCents: 0,
      valueCents: grossMarginCents,
      kind: "result",
      percentOfSales: pct(grossMarginCents),
    },
    {
      key: "labor",
      name: "Nómina",
      label: "Mano de Obra Directa",
      caption: "Sueldos, IMSS e Infonavit de tienda",
      baseCents: floatingBase(primeMarginCents),
      valueCents: laborCostCents,
      kind: "cost",
      percentOfSales: pct(laborCostCents),
    },
    {
      key: "prime",
      name: "Prime",
      label: "Prime Margin",
      caption: "Umbral crítico: debe sostenerse en 40% o más de las ventas",
      baseCents: 0,
      valueCents: primeMarginCents,
      kind: "result",
      percentOfSales: primeMarginPercent,
    },
    {
      key: "opex",
      name: "OpEx",
      label: "Gastos Operativos de Tienda",
      caption: "Rentas, servicios, comisiones y mantenimiento",
      baseCents: floatingBase(ebitdaCents),
      valueCents: storeOpexCents,
      kind: "cost",
      percentOfSales: pct(storeOpexCents),
    },
    {
      key: "ebitda",
      name: "EBITDA",
      label: "EBITDA Operativo",
      caption: "Resultado operativo consolidado de la red",
      baseCents: 0,
      valueCents: ebitdaCents,
      kind: "result",
      percentOfSales: ebitdaPercent,
    },
  ];

  // Paleta escalonada: azul (ventas) → ámbar (insumos) → gris (subtotal) →
  // violeta (nómina) → Operational Red (Prime Margin, el KPI de la vista) →
  // teal (OpEx) → éxito/destructive (EBITDA).
  const stepFill = (step: WaterfallStep): string => {
    switch (step.key) {
      case "sales":
        return "var(--chart-4)";
      case "food":
        return "var(--chart-2)";
      case "gross":
        return "var(--muted-foreground)";
      case "labor":
        return "var(--chart-6)";
      case "prime":
        return "var(--primary)";
      case "opex":
        return "var(--chart-3)";
      default:
        return isEbitdaPositive ? "var(--success)" : "var(--destructive)";
    }
  };

  const stepAmountLabel = (step: WaterfallStep): string =>
    step.kind === "cost" ? `-${fmtMxn(step.valueCents)}` : fmtMxn(step.valueCents);

  /**
   * Abre la auditoría forense de P&L. Los escalones de costo y de resultado
   * quedan resaltados; el escalón base abre la vista general.
   */
  const handleSelectStep = (stepKey?: string) => {
    const step = steps.find((candidate) => candidate.key === stepKey);
    if (!step) return;
    setSelectedStepKey(step.kind === "total" ? null : step.key);
    setAuditOpen(true);
  };

  const selectedStep = steps.find((step) => step.key === selectedStepKey) ?? null;

  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader className="pb-3 border-b border-border">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Cascada de Rentabilidad & EBITDA de Red
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              Estructura consolidada de ingresos, prime margin y rendimiento operativo
              {isEstimated && (
                <Badge
                  variant="outline"
                  className="border-warning/40 text-xs font-medium text-warning-text"
                >
                  Escala estimada: aún sin ventas capturadas
                </Badge>
              )}
            </CardDescription>
          </div>
          <PnlAuditDrawer buttonText="Ver P&L por Sucursal" />
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 space-y-4">
        {/* Puente deductivo: cada escalón muestra dónde se pierde el margen */}
        <div className="h-72 min-h-[288px] w-full [&_.recharts-bar-rectangle]:cursor-pointer [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={steps} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12 }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={52}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(value: number) => fmtMxnCompact(Number(value))}
                width={64}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }}
                content={<WaterfallTooltip leakBranch={leakBranch} />}
              />
              {/* Piso de Prime Margin: 40% de las ventas (Prime Cost ≤ 60%) */}
              <ReferenceLine
                y={primeMarginFloorCents}
                stroke="var(--warning)"
                strokeDasharray="4 4"
                label={{
                  value: "Piso Prime Margin 40%",
                  position: "insideTopLeft",
                  fontSize: 12,
                  fill: "var(--warning-text)",
                }}
              />
              {/* Base invisible del escalón + valor visible */}
              <Bar dataKey="baseCents" stackId="bridge" fill="transparent" isAnimationActive={false} />
              <Bar
                dataKey="valueCents"
                stackId="bridge"
                isAnimationActive={false}
                onClick={(entry: unknown) => {
                  const payload = entry as WaterfallStep | undefined;
                  if (payload?.key) handleSelectStep(payload.key);
                }}
              >
                {steps.map((step) => (
                  <Cell
                    key={step.key}
                    fill={stepFill(step)}
                    radius={cornerRadius(step.valueCents >= 0)}
                    opacity={selectedStepKey === null || selectedStepKey === step.key ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Escalones del puente: lectura en 5 segundos y alternativa accesible */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSelectStep(step.key)}
                aria-label={`${step.label}: ${stepAmountLabel(step)}, ${step.percentOfSales.toFixed(1)}% de ventas. Abrir auditoría de P&L por sucursal`}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  step.kind === "cost"
                    ? "border-border bg-muted/30 hover:bg-muted/60"
                    : "border-border bg-background hover:bg-muted/40",
                  selectedStepKey === step.key && "ring-1 ring-primary"
                )}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: stepFill(step) }}
                  aria-hidden="true"
                />
                <span className="font-semibold text-foreground">
                  {step.kind === "cost" ? "− " : step.kind === "result" ? "= " : ""}
                  {step.name}
                </span>
                <span className="tabular-nums text-muted-foreground">{stepAmountLabel(step)}</span>
                <span className="font-semibold tabular-nums text-foreground/80">
                  {step.percentOfSales.toFixed(1)}%
                </span>
              </button>
              {index < steps.length - 1 && (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>

        {/* Mayor fuga de la red: acceso forense directo desde la cascada */}
        {leakBranch && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Flame className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                Mayor fuga de margen de la red
              </p>
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">{leakBranch.branchName}</strong> opera con{" "}
                {leakBranch.primeCostPercent.toFixed(1)}% de Prime Cost (Comida{" "}
                {leakBranch.foodCostPercent.toFixed(1)}% + Nómina{" "}
                {leakBranch.laborCostPercent.toFixed(1)}%).{" "}
                {selectedStep
                  ? `Escalón en foco: ${selectedStep.label}.`
                  : "Alinear recetas y plantilla de esta tienda es la vía más corta al EBITDA."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link href={`/dashboard/branches/${leakBranch.branchId}`}>
                  <Building className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Auditar Tienda
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Quick summary note */}
        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-1.5">
            <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <strong className="text-foreground">Estrategia de Rentabilidad:</strong> cada punto porcentual
              reducido en Prime Cost suma directamente al EBITDA de la marca. Haz clic en cualquier escalón para
              auditar el P&L tienda por tienda.
            </span>
          </span>
          {!leakBranch && <PnlAuditDrawer buttonText="Auditar por Tienda" className="h-7 text-xs" />}
        </div>

        {/* Drawer controlado: se abre desde cualquiera de los escalones de la cascada */}
        <PnlAuditDrawer open={auditOpen} onOpenChange={setAuditOpen} hideTrigger />
      </CardContent>
    </Card>
  );
}
