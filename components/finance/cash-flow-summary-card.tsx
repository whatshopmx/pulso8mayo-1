"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/utils";
import type { CashFlowDay, CashFlowProjection } from "@/components/finance/cash-flow-calendar";
import { ArrowRight, Calendar, Loader2, RefreshCw, TrendingDown } from "lucide-react";

/**
 * Resumen compacto de tesorería para la portada. No reemplaza a
 * `/dashboard/finance/cash-flow` — responde la pregunta de la portada ("¿me
 * alcanza?") y lleva al calendario completo para el detalle.
 */

const HORIZON_DAYS = 30;

interface Summary {
  /** `null` cuando nadie lo ha capturado: no hay constante de respaldo. */
  initialBalanceCents: number | null;
  totalOutflowCents: number;
  /** `null` cuando no hay entradas estimadas y por lo tanto no hay saldo proyectado. */
  endingBalanceCents: number | null;
  /** Día con el saldo acumulado más bajo del horizonte. */
  worstDay: CashFlowDay | null;
  overdueCount: number;
  overdueCents: number;
}

/** `getCashFlowProjection` puede devolver el objeto completo o solo los días. */
function toSummary(payload: CashFlowProjection | CashFlowDay[]): Summary | null {
  const days = Array.isArray(payload) ? payload : payload.days;
  if (!days || days.length === 0) return null;

  const overdue = Array.isArray(payload) ? [] : (payload.overdueItems ?? []);

  // Sin cortes de venta el servicio no estima entradas y el saldo acumulado
  // llega en `null`. Un `null` comparado con `<` se lee como cero y pintaría el
  // peor día en rojo con una cifra que nadie calculó.
  const conSaldo = days.filter((d) => d.cumulativeBalanceCents !== null);

  const worstDay = conSaldo.reduce<CashFlowDay | null>(
    (worst, d) =>
      worst === null || d.cumulativeBalanceCents! < worst.cumulativeBalanceCents!
        ? d
        : worst,
    null,
  );

  return {
    initialBalanceCents: Array.isArray(payload) ? null : payload.initialBalanceCents,
    totalOutflowCents: days.reduce((sum, d) => sum + d.projectedOutflowCents, 0),
    endingBalanceCents: conSaldo.length
      ? conSaldo[conSaldo.length - 1].cumulativeBalanceCents
      : null,
    worstDay,
    overdueCount: overdue.length,
    overdueCents: overdue.reduce((sum, o) => sum + o.amountCents, 0),
  };
}

export function CashFlowSummaryCard({ branchId }: { branchId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/finance/cash-flow", window.location.origin);
      url.searchParams.set("days", String(HORIZON_DAYS));
      if (branchId !== "ALL") url.searchParams.set("branchId", branchId);

      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setSummary(toSummary(json.data));
      } else {
        setError(json?.error || "No se pudo calcular la proyección de tesorería.");
        setSummary(null);
      }
    } catch (err) {
      console.error("Failed to load cash flow summary:", err);
      setError("Error de conexión al calcular la proyección.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" /> Tesorería · próximos {HORIZON_DAYS} días
            </CardTitle>
            <CardDescription className="text-xs mt-0.5 max-w-[70ch]">
              Lo que sale contra lo que hay. El detalle día por día vive en el calendario.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild className="self-start">
            <Link href="/dashboard/finance/cash-flow">
              Ver calendario <ArrowRight className="w-4 h-4 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-6 flex justify-center text-sm text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Proyectando tesorería...
          </div>
        ) : error ? (
          <div className="py-4 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          </div>
        ) : !summary ? (
          <p className="py-4 text-sm text-muted-foreground text-center">
            Sin salidas proyectadas en el horizonte. Registra gastos operativos y órdenes de compra
            para que la proyección tenga base.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Saldo inicial</p>
                {summary.initialBalanceCents === null ? (
                  <p className="text-lg font-bold text-muted-foreground">
                    Sin capturar
                  </p>
                ) : (
                  <p className="text-lg font-bold tabular-nums">
                    {formatCents(summary.initialBalanceCents)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Salidas proyectadas</p>
                <p className="text-lg font-bold tabular-nums text-destructive">
                  −{formatCents(summary.totalOutflowCents)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Saldo al día {HORIZON_DAYS}</p>
                {summary.endingBalanceCents === null ? (
                  <p className="text-lg font-bold text-muted-foreground">
                    Sin estimar
                  </p>
                ) : (
                  <p
                    className={`text-lg font-bold tabular-nums ${
                      summary.endingBalanceCents < 0 ? "text-destructive" : "text-success"
                    }`}
                  >
                    {formatCents(summary.endingBalanceCents)}
                  </p>
                )}
              </div>
            </div>

            {/* El día más bajo es la pregunta real: no importa terminar en verde
                si a mitad del mes el saldo cruza a negativo. */}
            {summary.worstDay && summary.worstDay.cumulativeBalanceCents! < 0 && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <TrendingDown className="w-4 h-4 text-destructive shrink-0 mt-px" />
                <span>
                  El saldo proyectado cruza a negativo el{" "}
                  <span className="font-semibold">{summary.worstDay.date}</span>, hasta{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCents(summary.worstDay.cumulativeBalanceCents)}
                  </span>
                  . Revisa el calendario para anticipar cobranza o reprogramar pagos.
                </span>
              </div>
            )}

            {summary.overdueCount > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                <TrendingDown className="w-4 h-4 text-warning-text shrink-0 mt-px" />
                <span>
                  <span className="font-semibold">{summary.overdueCount}</span> partida
                  {summary.overdueCount === 1 ? "" : "s"} ya vencida
                  {summary.overdueCount === 1 ? "" : "s"} por{" "}
                  <span className="font-semibold tabular-nums">
                    {formatCents(summary.overdueCents)}
                  </span>
                  .
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
