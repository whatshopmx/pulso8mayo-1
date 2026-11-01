"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { mensajeDeError } from "@/lib/api/client-error";
import { formatCents } from "@/lib/utils";
import type { getPnlDetail } from "@/lib/services/pnl-detail-service";
import type { PnLLine } from "@/lib/services/pnl-types";
import type { PnlCalculation } from "@/lib/services/pnl-derived-detail-service";

export const PNL_DETAIL_LABELS = {
  sales: "Ventas", foodCost: "Food cost", waste: "Merma", labor: "Nómina",
  operatingExpenses: "Gastos operativos", commissions: "Comisiones", pettyCash: "Caja chica",
  operatingProfit: "Utilidad operativa",
} as const;
export type PnlDetailLine = keyof typeof PNL_DETAIL_LABELS;
type Detail = Awaited<ReturnType<typeof getPnlDetail>>;
function hasComponents(value: { cents: number; note: string } | null): value is PnlCalculation {
  return value !== null && "components" in value && Array.isArray(value.components);
}
const sources = { MEASURED: "Medido", DERIVED: "Derivado", ESTIMATED: "Estimado con tarifa",
  SECTOR_DEFAULT: "Estimación sectorial", NO_DATA: "Sin datos" };
const statuses: Record<string, string> = { VALIDATED: "Validado", PENDING_REVIEW: "Por revisar",
  APPROVED: "Aprobado", PAID: "Pagado", PENDING_APPROVAL: "Por aprobar", OUT: "Salida",
  USAGE: "Consumo", WASTE: "Merma", RECEIVING: "Recepción" };
const origins: Record<PnlDetailLine, { path: string; label: string }> = {
  sales: { path: "/dashboard/sales", label: "Ver cortes de ventas" },
  foodCost: { path: "/dashboard/inventory/movements", label: "Ver movimientos de inventario" },
  waste: { path: "/dashboard/inventory/waste", label: "Ver registro de merma" },
  labor: { path: "/dashboard/finance/labor-cost", label: "Ver costo laboral" },
  operatingExpenses: { path: "/dashboard/finance/expenses", label: "Ver gastos operativos" },
  commissions: { path: "/dashboard/finance/commissions", label: "Ver comisiones por canal" },
  pettyCash: { path: "/dashboard/finance/petty-cash", label: "Ver caja chica" },
  operatingProfit: { path: "/dashboard/finance", label: "Ver finanzas" },
};

export function PnlSourceDetail({ branchId, branchName, line, expected, period, onLineChange, onClose }: {
  branchId: string; branchName: string; line: PnlDetailLine; expected: PnLLine;
  period: { startDate: string; endDate: string }; onLineChange: (line: PnlDetailLine) => void; onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const dates = { startDate: period.startDate, endDate: period.endDate };
  const query = new URLSearchParams({ branchId, line, ...dates, page: String(page), pageSize: "25" }).toString();
  const requestKey = `${query}:${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: Detail; error?: string } | null>(null);
  const current = result?.key === requestKey ? result : null;
  const data = current?.data;
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/finance/pnl/detail?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(mensajeDeError(body, "No se pudo consultar el detalle."));
        if (!controller.signal.aborted) setResult({ key: requestKey, data: body.data });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ key: requestKey,
          error: error instanceof Error ? error.message : "No se pudo consultar el detalle." });
      });
    return () => controller.abort();
  }, [query, requestKey]);
  const calculation = data && "calculation" in data ? data.calculation : null;
  const derivedCalculation = hasComponents(calculation) ? calculation : null;
  const components = derivedCalculation?.components ?? [];
  const origin = origins[line];
  const originQuery = new URLSearchParams({ branchId, ...dates });
  return (
    <section aria-labelledby="pnl-detail-heading" className="mt-6 space-y-4 rounded-lg border p-4 sm:p-6"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 basis-full space-y-1 sm:basis-auto sm:flex-1">
          <h3 id="pnl-detail-heading" ref={heading} tabIndex={-1} className="text-base font-semibold focus-visible:outline-none">
            {PNL_DETAIL_LABELS[line]} · {branchName}
          </h3>
          <p className="text-sm text-muted-foreground">{period.startDate} a {period.endDate} · MXN</p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>Cerrar detalle</Button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">Renglón
        <select aria-label="Renglón" value={line} onChange={event => onLineChange(event.target.value as PnlDetailLine)}
          className="min-h-10 max-w-full rounded-md border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {Object.entries(PNL_DETAIL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <div aria-live="polite" aria-busy={!current} className="space-y-4">
        {!current && <p role="status" className="text-sm text-muted-foreground">Consultando el origen de la cifra…</p>}
        {current?.error && <div role="alert" className="space-y-2 text-sm">
          <p>{current.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(a => a + 1)}>Reintentar detalle</Button>
        </div>}
        {data && <>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div><dt className="text-muted-foreground">Total del periodo</dt><dd className="font-semibold tabular-nums">
              {data.source === "NO_DATA" ? "Sin datos" : formatCents(data.totalCents)}</dd></div>
            <div><dt className="text-muted-foreground">Fuente</dt><dd>{sources[data.source]}</dd></div>
            <div><dt className="text-muted-foreground">Cobertura</dt><dd>{data.coveragePercent}%</dd></div>
          </dl>
          {(data.totalCents !== expected.cents || data.source !== expected.source || data.coveragePercent !== expected.coveragePercent) &&
            <p role="status" className="text-sm text-warning-text">La cifra o su cobertura cambió desde que cargaste Resultados. Este detalle muestra la consulta actual; actualiza Resultados para compararlos.</p>}
          {"valuation" in data && <p className="text-sm text-muted-foreground">
            Valoración al costo actual del artículo; no es un costo histórico congelado.
            {data.basis === "PURCHASES" && " Las compras se usan como aproximación del consumo."}
            {data.uncostedLines > 0 && ` Hay ${data.uncostedLines} movimientos sin costo capturado.`}
          </p>}
          {calculation && <div className="space-y-2 text-sm">
            <h4 className="font-medium">Cómo se calcula</h4><p className="max-w-prose text-muted-foreground">{calculation.note}</p>
            <dl className="divide-y">{components.map(component => <div key={component.key} className="flex flex-wrap justify-between gap-2 py-2">
              <dt>{component.label}<span className="block text-xs text-muted-foreground">{sources[component.source]}
                {component.baseCents !== undefined && ` · Base ${formatCents(component.baseCents)}`}
                {component.rateBps != null && ` · Tarifa ${component.rateBps / 100}%`}
                {component.vatBps != null && ` · IVA ${component.vatBps / 100}%`}</span></dt>
              <dd className="tabular-nums">{formatCents(component.cents)}</dd>
            </div>)}</dl>
            {derivedCalculation?.informative?.map(component =>
              <p key={component.key} className="text-muted-foreground">{component.label}: {formatCents(component.cents)}</p>)}
            {(derivedCalculation?.uncoveredSalesCents ?? 0) > 0 &&
              <p className="text-warning-text">Venta sin tarifa: {formatCents(derivedCalculation!.uncoveredSalesCents!)}. No está valuada en la comisión.</p>}
          </div>}
          {data.items.length > 0 ? <ul className="divide-y" aria-label="Movimientos del periodo">
            {data.items.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{item.label}</p>
                <p className="text-muted-foreground">{item.date} · {statuses[item.status] ?? item.status}</p>
                {item.costCenter && <p className="text-muted-foreground">{item.costCenter.code} · {item.costCenter.name}</p>}
                {"quantity" in item && <p className="text-muted-foreground">Cantidad: {item.quantity} · Costo unitario: {formatCents(item.unitCostCents)}</p>}
                <p className="break-all text-xs text-muted-foreground">Referencia: {item.id}</p>
                {line === "operatingExpenses" && <Link className="text-primary underline underline-offset-4"
                  href={`/dashboard/finance/expenses?focus=${encodeURIComponent(item.id)}`}>Abrir gasto y evidencia autorizada</Link>}
              </div><span className="shrink-0 tabular-nums">{formatCents(item.cents)}</span>
            </li>)}
          </ul> : !calculation && <p className="text-sm text-muted-foreground">
            {data.totalCount > 0 ? "No hay movimientos en esta página." : "No hay movimientos para este renglón en el periodo."}
          </p>}
          {data.totalCount > 0 && <nav aria-label="Páginas del detalle" className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>{data.totalCount} movimientos · Página {page} de {Math.ceil(data.totalCount / data.pageSize)}</p>
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior detalle</Button>
              <Button variant="outline" size="sm" disabled={!data.hasMore} onClick={() => setPage(p => p + 1)}>Siguiente detalle</Button></div>
          </nav>}
          <Link className="inline-block text-sm text-primary underline underline-offset-4" href={`${origin.path}?${originQuery}`}>
            {origin.label}
          </Link>
        </>}
      </div>
    </section>
  );
}
