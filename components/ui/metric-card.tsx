import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

/**
 * MetricCard — tarjeta canónica de KPI (plan-kpi-cards-unificados).
 *
 * Sustituye a StatCard, shared/kpi-card, HeroCard y a los cards inline de
 * labor/performance/compliance/equipment/inventory. Diseño alineado a
 * DESIGN.md: flat, sin sombras, capas tonales con tokens semánticos.
 *
 * Layout canónico:
 *   ┌──────────────────────────────┐
 *   │ Label del KPI           [◈]  │  label text-sm muted + icono en caja tonal
 *   │ 1,234.56                    │  value text-2xl bold font-mono
 *   │ Subtitle                     │  text-xs muted
 *   │ ▲ +12% vs. período anterior  │  delta opcional (success/destructive)
 *   │ ▓▓▓░░ Meta                   │  progress opcional (hacia meta)
 *   └──────────────────────────────┘
 *
 * El icono debe pasarse con tamaño `h-4 w-4` (p. ej. `<Wrench className="h-4 w-4" />`).
 */
export interface MetricCardProps {
  /** Etiqueta corta del KPI, en español ("Valor del Inventario"). */
  label: string;
  /** Valor formateado, número crudo o nodo con adornos (p. ej. dot de alerta). */
  value: ReactNode;
  /** Icono opcional; se muestra en caja tonal arriba-derecha (h-4 w-4). */
  icon?: ReactNode;
  /** Tono semántico: colorea icono, delta y barra de progreso. */
  tone?: "neutral" | "success" | "warning" | "destructive" | "info" | "primary";
  /** Subtítulo de contexto bajo el valor. */
  subtitle?: ReactNode;
  /** Variación vs. período anterior. `isPositive` es semántico: el
   *  llamador decide si el movimiento es bueno (lowerIsBetter → false). */
  delta?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
  /** Barra de progreso hacia una meta (0-100). `label` opcional: texto
   *  sobre la barra (p. ej. "Meta: 90%"), con el % calculado a la derecha. */
  progress?: {
    value: number;
    max?: number;
    label?: ReactNode;
  };
  /** Contenido extra bajo el delta/progress (p. ej. fila de tooltips,
   *  dot de alerta, fila de detalle). Se mantiene fuera del layout canónico. */
  children?: ReactNode;
  /** Convierte la tarjeta en un enlace (patrón alertas de inventario). */
  href?: string;
  /** Skeleton de carga inline. */
  loading?: boolean;
  className?: string;
}

const TONE_CLASSES: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  // `text-warning-text`, no `text-warning`: el ámbar de relleno no alcanza AA
  // como texto. Mismo criterio que statusBadgeClasses (lib/utils.ts).
  warning: "bg-warning/10 text-warning-text",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  primary: "bg-primary/10 text-primary",
};

const PROGRESS_FILL: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  primary: "bg-primary",
};

function MetricCardInner({ ...props }: MetricCardProps) {
  const {
    label,
    value,
    icon,
    tone = "neutral",
    subtitle,
    delta,
    progress,
    loading,
    className,
    children,
  } = props;

  if (loading) {
    return (
      <Card className={cn("py-5", className)} aria-busy="true">
        <CardContent className="space-y-3 px-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  const pct =
    progress && progress.max
      ? Math.min(100, Math.round((progress.value / progress.max) * 100))
      : progress
        ? Math.min(100, Math.round(progress.value))
        : null;

  const TrendIcon = !delta ? null : delta.value > 0 ? TrendingUp : delta.value < 0 ? TrendingDown : Minus;

  return (
    <Card className={cn("py-5", className)}>
      <CardContent className="px-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          {icon && (
            <span
              aria-hidden
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                TONE_CLASSES[tone]
              )}
            >
              {icon}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-mono text-2xl font-bold tracking-tight">{value}</span>
        </div>

        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}

        {delta && TrendIcon && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            <TrendIcon
              aria-hidden
              className={cn(
                "h-3.5 w-3.5",
                delta.value === 0
                  ? "text-muted-foreground"
                  : delta.isPositive
                    ? "text-success"
                    : "text-destructive"
              )}
            />
            <span
              className={cn(
                "font-semibold",
                delta.value === 0
                  ? "text-muted-foreground"
                  : delta.isPositive
                    ? "text-success"
                    : "text-destructive"
              )}
            >
              {delta.value > 0 ? "+" : ""}
              {delta.value}%
            </span>
            <span className="text-muted-foreground">{delta.label ?? "vs. período anterior"}</span>
          </div>
        )}

        {pct !== null && (
          <div className="mt-3">
            {progress?.label && (
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{progress.label}</span>
                <span>{pct}%</span>
              </div>
            )}
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn("h-full rounded-full transition-all duration-300", PROGRESS_FILL[tone])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {children && <div className="mt-3">{children}</div>}
      </CardContent>
    </Card>
  );
}

export function MetricCard(props: MetricCardProps) {
  if (props.href) {
    return (
      <Link
        href={props.href}
        aria-label={props.label}
        className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MetricCardInner {...props} />
      </Link>
    );
  }
  return <MetricCardInner {...props} />;
}

export interface MetricGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

const GRID_CLASSES: Record<NonNullable<MetricGridProps["columns"]>, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
};

export function MetricGrid({ children, columns = 4, className }: MetricGridProps) {
  return <div className={cn("grid gap-4", GRID_CLASSES[columns], className)}>{children}</div>;
}

/** Scaffold de carga para cuadrículas de MetricCard. */
export function MetricCardSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <MetricGrid className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <MetricCard key={i} label="" value="" loading />
      ))}
    </MetricGrid>
  );
}