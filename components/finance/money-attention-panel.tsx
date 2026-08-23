"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { computeCashVariance } from "@/lib/sales/cash-variance";
import type { Violation } from "@/components/finance/excepciones-panel";
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

export function MoneyAttentionPanel({ branchId }: { branchId: string }) {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const scoped = (path: string) => {
      const url = new URL(path, window.location.origin);
      if (branchId !== "ALL") url.searchParams.set("branchId", branchId);
      return url.toString();
    };

    try {
      const [violationsRes, expensesRes, cutsRes] = await Promise.all([
        fetch(scoped("/api/finance/control-interno/excepciones")),
        fetch(scoped("/api/expenses")),
        fetch(scoped("/api/sales/cuts")),
      ]);

      const [violationsJson, expensesJson, cutsJson] = await Promise.all([
        violationsRes.json(),
        expensesRes.json(),
        cutsRes.json(),
      ]);

      // Si las tres fuentes fallan no hay panel que mostrar: decirlo es mejor
      // que renderizar "todo en orden", que es una afirmación de cumplimiento
      // que nadie verificó.
      const anyOk =
        (violationsRes.ok && violationsJson.success) ||
        (expensesRes.ok && expensesJson.success) ||
        (cutsRes.ok && cutsJson.success);

      if (!anyOk) {
        setError("No se pudo consultar ninguna de las fuentes de alertas financieras.");
        setItems(null);
        return;
      }

      const collected: AttentionItem[] = [];

      // 1. Excepciones de control interno.
      if (violationsRes.ok && violationsJson.success) {
        const violations: Violation[] = violationsJson.data?.violations ?? [];
        for (const v of violations) {
          collected.push({
            id: `violation-${v.id}`,
            severity: v.severity,
            icon: <ShieldAlert className="w-4 h-4" />,
            title: v.description,
            detail: `${v.branchName} · ${v.detail}`,
            amountCents: v.amountCents,
            href: "/dashboard/finance/control-interno",
          });
        }
      }

      // 2. Gastos esperando autorización. La antigüedad marca la severidad:
      //    la política de control interno considera excepción a partir de 48h.
      if (expensesRes.ok && expensesJson.success) {
        // `/api/expenses` devuelve `{ items, scope, truncated }` desde que la
        // ruta rotula el alcance aplicado; antes era un arreglo pelado.
        const expenses: ExpenseRow[] = expensesJson.data?.items ?? [];
        const pending = expenses.filter((e) => e.status === "PENDING_APPROVAL");
        for (const e of pending) {
          const age = daysSince(e.createdAt);
          collected.push({
            id: `expense-${e.id}`,
            severity: age >= 2 ? "HIGH" : "MEDIUM",
            icon: <Clock className="w-4 h-4" />,
            title: "Gasto pendiente de autorización",
            detail:
              `${e.branchName} · ${e.category}` +
              (age > 0 ? ` · lleva ${age} día${age === 1 ? "" : "s"} esperando` : " · capturado hoy"),
            amountCents: e.amountCents,
            href: "/dashboard/finance/expenses",
          });
        }
      }

      // 3. Cortes cuyo arqueo no cuadra. Misma fuente de verdad que la tabla de
      //    /dashboard/sales, para que los dos conteos no puedan discrepar.
      if (cutsRes.ok && cutsJson.success) {
        // La ruta pagina: data es { items, total, scope }, no un arreglo.
        const rawCuts = cutsJson.data?.items;
        const cuts: CutRow[] = Array.isArray(rawCuts) ? rawCuts : [];
        for (const c of cuts) {
          const arqueo = computeCashVariance(c);
          if (!arqueo || arqueo.direction === "cuadrado") continue;
          collected.push({
            id: `cut-${c.id}`,
            // Un faltante es dinero que no está; un sobrante es un error de
            // captura o de cobro. No pesan igual.
            severity: arqueo.direction === "faltante" ? "HIGH" : "MEDIUM",
            icon: <Wallet className="w-4 h-4" />,
            title: `Arqueo con ${arqueo.direction}`,
            detail: `${c.branchName} · corte del ${c.businessDate}`,
            amountCents: arqueo.varianceCents,
            href: "/dashboard/sales",
          });
        }
      }

      collected.sort((a, b) => {
        const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (bySeverity !== 0) return bySeverity;
        return Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0);
      });

      setItems(collected);
    } catch (err) {
      console.error("Failed to load money attention panel:", err);
      setError("Error de conexión al consultar las alertas financieras.");
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
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
          {items !== null && items.length > 0 && (
            <span
              className={`self-start text-xs px-2 py-1 rounded-full border ${statusBadgeClasses(
                escalated ? "destructive" : "warning",
              )}`}
            >
              {items.length} pendiente{items.length === 1 ? "" : "s"}
              {escalated ? ` · ${highCount} crítico${highCount === 1 ? "" : "s"}` : ""}
            </span>
          )}
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
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          </div>
        ) : items && items.length === 0 ? (
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
                  <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
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
      </CardContent>
    </Card>
  );
}
