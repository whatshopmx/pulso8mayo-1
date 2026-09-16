"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { computeCashVariance } from "@/lib/sales/cash-variance";
import type { Violation } from "@/components/finance/excepciones-panel";
import type { DateRange } from "@/components/finance/period-selector";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";

/**
 * "Requiere tu atención" — la única lista del módulo que mezcla las tres
 * fuentes de riesgo de dinero que hoy viven en pantallas separadas:
 * excepciones de control interno, gastos esperando autorización y cortes cuyo
 * arqueo no cuadra.
 *
 * El punto no es duplicar esas pantallas: es que el dueño no tenga que abrir
 * siete rutas para descubrir si algo necesita su firma hoy. Cada renglón lleva
 * a la pantalla que resuelve el caso.
 */

type Severity = "HIGH" | "MEDIUM" | "LOW";

interface AttentionItem {
  id: string;
  severity: Severity;
  icon: React.ReactNode;
  title: string;
  detail: string;
  amountCents: number | null;
  href: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const SEVERITY_TONE: Record<Severity, Parameters<typeof statusBadgeClasses>[0]> = {
  HIGH: "destructive",
  MEDIUM: "warning",
  LOW: "info",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  HIGH: "Crítico",
  MEDIUM: "Atención",
  LOW: "Informativo",
};

interface ExpenseRow {
  id: string;
  branchName: string;
  category: string;
  amountCents: number;
  status: string;
  createdAt: string;
  dueDate: string | null;
}

interface CutRow {
  id: string;
  branchName: string;
  businessDate: string;
  cashSales: number | null;
  cashCountedCents: number | null;
}

/** Días transcurridos desde una fecha ISO, con piso en cero. */
function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function MoneyAttentionPanel({ branchId, dateRange }: { branchId: string; dateRange?: DateRange }) {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Fuentes que fallaron sin tumbar el panel completo: la lista puede quedar corta. */
  const [failedSources, setFailedSources] = useState<string[]>([]);

  const startDate = dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const endDate = dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

  const load = useCallback(async (isCancelled?: () => boolean) => {
    setLoading(true);
    setError(null);
    setFailedSources([]);

    try {
      const url = new URL("/api/finance/attention", window.location.origin);
      if (branchId !== "ALL") url.searchParams.set("branchId", branchId);

      const res = await fetch(url.toString());
      const json = await res.json().catch(() => ({}));

      if (isCancelled?.()) return;

      if (res.ok && json.success) {
        const rawItems = json.data?.items ?? [];
        const statuses = json.data?.sourceStatuses ?? {};
        const failures: string[] = [];
        if (statuses.violations === "unavailable") failures.push("las excepciones de control interno");
        if (statuses.expenses === "unavailable") failures.push("los gastos por autorizar");
        if (statuses.cuts === "unavailable") failures.push("los arqueos y conciliaciones TPV");
        setFailedSources(failures);

        const collected: AttentionItem[] = rawItems.map(
          (item: {
            id: string;
            severity: Severity;
            sourceType: string;
            title: string;
            detail: string;
            amountCents: number | null;
            href: string;
          }) => {
            let icon = <ShieldAlert className="w-4 h-4 text-muted-foreground" />;
            if (item.sourceType === "expense") {
              icon = <Clock className="w-4 h-4 text-muted-foreground" />;
            } else if (item.sourceType === "cut_cash" || item.sourceType === "cut_tpv" || item.sourceType === "cut") {
              icon = <Wallet className="w-4 h-4 text-muted-foreground" />;
            }

            return {
              id: item.id,
              severity: item.severity,
              icon,
              title: item.title,
              detail: item.detail,
              amountCents: item.amountCents,
              href: item.href,
            };
          }
        );

        setItems(collected);
      } else {
        setError(json?.error || "No se pudo consultar ninguna de las fuentes de alertas financieras.");
        setItems(null);
      }
    } catch (err) {
      if (isCancelled?.()) return;
      console.error("Failed to load money attention panel:", err);
      setError("Error de conexión al consultar las alertas financieras.");
      setItems(null);
    } finally {
      if (!isCancelled?.()) {
        setLoading(false);
      }
    }
  }, [branchId]);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);



  const VISIBLE_LIMIT = 8;
  const visible = items?.slice(0, VISIBLE_LIMIT) ?? [];
  const highCount = items?.filter((i) => i.severity === "HIGH").length ?? 0;
  // Banda tonal en el encabezado cuando hay algo crítico: el estado del panel
  // se lee antes de leer cualquier renglón.
  const escalated = highCount > 0;

  return (
    <Card className={escalated ? "border-destructive/40" : undefined}>
      <CardHeader
        className={`pb-3 rounded-t-lg ${escalated ? "bg-destructive/5" : ""}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle
              className={`text-base font-bold flex items-center gap-2 ${
                escalated ? "text-destructive" : ""
              }`}
            >
              <AlertCircle className={`w-5 h-5 ${escalated ? "text-destructive" : "text-primary"}`} />{" "}
              Requiere tu atención
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Excepciones de control interno, gastos sin autorizar y arqueos que no cuadran.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            {items !== null && items.length > 0 && (
              <span
                className={`text-xs px-2 py-1 rounded-full border ${statusBadgeClasses(
                  escalated ? "destructive" : "warning",
                )}`}
              >
                {items.length} pendiente{items.length === 1 ? "" : "s"}
                {escalated ? ` · ${highCount} crítico${highCount === 1 ? "" : "s"}` : ""}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-8 flex justify-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Revisando alertas financieras...
          </div>
        ) : error ? (
          <div className="py-6 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {failedSources.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning-text">
                <AlertCircle className="w-4 h-4 mt-px shrink-0" />
                <span className="flex-1">
                  No se pudieron consultar {failedSources.join(" ni ")} — esta lista puede estar
                  incompleta.
                </span>
                <Button variant="outline" size="sm" onClick={() => load()} className="h-6 px-2 text-xs">
                  <RefreshCw className="w-3 h-3 mr-1" /> Reintentar
                </Button>
              </div>
            )}
            {items && items.length === 0 && failedSources.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="w-8 h-8 text-success" />
            <p className="text-sm font-medium">Nada pendiente de tu firma</p>
            <p className="text-xs text-muted-foreground max-w-md">
              Sin excepciones de control interno, sin gastos esperando autorización y sin arqueos
              con diferencia en el alcance seleccionado.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* El tono de severidad vive en el anillo; el glifo queda mudo
                    para que el rojo no se multiplique renglón tras renglón. */}
                <span
                  className={`mt-0.5 shrink-0 rounded-full border p-1.5 ${statusBadgeClasses(
                    SEVERITY_TONE[item.severity],
                  )}`}
                >
                  {item.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">{item.title}</span>
                    {item.amountCents !== null && (
                      <span className="text-sm font-semibold tabular-nums shrink-0">
                        {formatCents(item.amountCents)}
                      </span>
                    )}
                  </div>
                  {/* line-clamp y no truncate: la sucursal vive aquí adentro,
                      y cortarla a un renglón dejaba el caso sin identificar. */}
                  <p className="text-xs text-muted-foreground line-clamp-2">{item.detail}</p>
                </div>
                <span className="sr-only">Severidad: {SEVERITY_LABEL[item.severity]}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" aria-hidden />
              </Link>
            ))}

            {items && items.length > VISIBLE_LIMIT && (
              <p className="text-xs text-muted-foreground pt-1">
                Mostrando {VISIBLE_LIMIT} de {items.length}. Abre Control Interno o Gastos
                Operativos para ver el resto.
              </p>
            )}
          </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
