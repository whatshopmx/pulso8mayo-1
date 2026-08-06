"use client";

import { useEffect, useState } from "react";
import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SupplierVariance {
  supplierId: string;
  name: string;
  reports: number;
  shortQty: number;
  orderedQty: number;
  receivedQty: number;
  shortagePct: number;
  shortValueCents: number;
  byDay: Record<string, { shortQty: number; count: number }>;
  peakDay: { day: string; shortQty: number } | null;
}

/**
 * Fase 5 (capa dinero): card "Varianza por proveedor" — muestra el faltante
 * agregado (ordenado vs. recibido) y el día de la semana con más faltante.
 */
export function SupplierVarianceCard() {
  const [data, setData] = useState<SupplierVariance[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventory/supplier-variance")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((j) => {
        if (!cancelled) setData(j.suppliers ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;

  const withIssues = (data ?? []).filter(
    (s) => s.shortagePct >= 1 && s.shortQty > 0
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary" /> Faltantes por proveedor
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data == null ? (
          <p className="text-sm text-muted-foreground py-4">Consultando varianza por proveedor…</p>
        ) : withIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Sin faltantes relevantes en tus últimas recepciones de mercancía.
          </p>
        ) : (
          <ul className="divide-y">
            {withIssues.slice(0, 6).map((s) => (
              <li key={s.supplierId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.shortQty} uds. de faltante en {s.reports} recep{(s.reports === 1 ? "" : "iones")}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-sm font-semibold text-destructive">
                    −{s.shortagePct.toFixed(1)}%
                  </span>
                  {s.peakDay && (
                    <p className="text-xs text-muted-foreground capitalize">pico los {s.peakDay.day}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}