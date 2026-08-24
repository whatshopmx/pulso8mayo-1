"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface HighValueItem {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  lastCost: number | null;
  averageCost: number | null;
  unitCostCents: number | null;
  lastCountedAt: string | null;
  daysSinceLastCount: number | null;
}

/**
 * Fase 4 (capa dinero): sección "SKUs de alto valor" (80/20) — muestra el
 * catálogo priorizado para el conteo semanal y la antigüedad del último
 * conteo por SKU.
 */
export function HighValueSkusSection({ branchId }: { branchId?: string }) {
  const [items, setItems] = useState<HighValueItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = branchId
      ? `/api/inventory/high-value?branchId=${encodeURIComponent(branchId)}`
      : "/api/inventory/high-value";
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  if (error) return null;

  const formatMXN = (cents: number | null) =>
    cents == null
      ? "—"
      : (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  const countBadge = (days: number | null, lastCountedAt: string | null) => {
    if (lastCountedAt == null) {
      return <Badge variant="outline" className="bg-muted/40 text-muted-foreground">Sin contar aún</Badge>;
    }
    if (days === null) return null;
    if (days > 14) return <Badge variant="destructive">{days} días sin contar</Badge>;
    if (days > 7) return <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">{days} días</Badge>;
    return <Badge variant="outline" className="text-success">Hace {days === 0 ? "hoy" : `${days} día${days > 1 ? "s" : ""}`}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Star className="h-4 w-4 text-primary" /> SKUs de alto valor
            {items != null && (
              <span className="text-xs font-normal text-muted-foreground">({items.length} de 30 máx.)</span>
            )}
          </CardTitle>
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
          <Link href="/dashboard/inventory/stock-count">
            Contear <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {items == null ? (
          <p className="text-sm text-muted-foreground py-4">Cargando SKUs de alto valor…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Aún no marcas SKUs de alto valor. Al dar de alta un producto, actívalo en el formulario para que entre
            al conteo semanal priorizado (80% del costo).
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.sku ? `${item.sku} · ` : ""}{item.unit}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">{formatMXN(item.unitCostCents)}</span>
                  {countBadge(item.daysSinceLastCount, item.lastCountedAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}