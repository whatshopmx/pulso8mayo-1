"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateRangePicker, type DateRange } from "@/components/shared/date-range-picker";
import { AlertCircle, Loader2, Users } from "lucide-react";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { costStatus, type SemaphoreStatus } from "@/lib/services/financial-kpi-types";
import type { BranchLaborRatio, LaborCostSource } from "@/lib/services/labor-cost-types";

const STATUS_STYLE: Record<SemaphoreStatus, { badge: string; label: string; text: string }> = {
  OK: { badge: statusBadgeClasses("success"), label: "Saludable", text: "text-success" },
  WARNING: { badge: statusBadgeClasses("warning"), label: "Precaución", text: "text-warning-text" },
  CRITICAL: { badge: statusBadgeClasses("destructive"), label: "Crítico", text: "text-destructive" },
};

/**
 * Procedencia con el mismo vocabulario que el P&L, pero sin colapsar
 * `CONTRACT_ONLY` en "derivado": la diferencia entre un ratio medido sobre
 * asistencia y uno calculado sobre plantilla contratada es justo lo que esta
 * pantalla existe para mostrar.
 */
const SOURCE_BADGE: Record<LaborCostSource, { label: string; className: string; hint: string }> = {
  MEASURED: {
    label: "Medido",
    className: statusBadgeClasses("success"),
    hint: "Calculado con la asistencia realmente capturada (turnos completados).",
  },
  CONTRACT_ONLY: {
    label: "Plantilla",
    className: statusBadgeClasses("warning"),
    hint:
      "Plantilla contratada, no asistencia real: contratos vigentes × días laborables. " +
      "No incluye faltas ni horas extra. Captura los turnos para que el ratio sea medido.",
  },
  SECTOR_DEFAULT: {
    label: "Sectorial",
    className: statusBadgeClasses("neutral"),
    hint: "Constante sectorial HORECA: NO se calcula con tus datos.",
  },
  NO_DATA: {
    label: "Sin datos",
    className: statusBadgeClasses("neutral"),
    hint: "Sin contratos vigentes en el período. No hay base para calcular la nómina.",
  },
};

/** Nota accesible: Tooltip Radix (foco de teclado + táctil) en vez de `title`. */
function NoteTip({ note, children }: { note?: string | null; children: ReactNode }) {
  if (!note) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{note}</TooltipContent>
    </Tooltip>
  );
}

interface LaborCostReportPayload {
  branches: BranchLaborRatio[];
  targets: { laborCostTargetPercent: number; laborCostWarnPercent: number };
  period: { startDate: string; endDate: string; days: number };
}

function toDayParam(date: Date): string {
  // Fecha local, no `toISOString()`: en México UTC adelanta el día después de
  // las 18:00 y el rango pedido no sería el que el usuario seleccionó.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function LaborCostTable() {
  const [data, setData] = useState<LaborCostReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);

  const loadLaborCost = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const params = new URLSearchParams();
      if (range) {
        params.set("from", toDayParam(range.startDate));
        params.set("to", toDayParam(range.endDate));
      }
      const qs = params.toString();
      const res = await fetch(`/api/finance/labor-cost${qs ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFailed(true);
        return;
      }
      setData(json.data ?? null);
    } catch (err) {
      console.error("Failed to load labor cost data:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    loadLaborCost();
  }, [loadLaborCost]);

  // Memoizado: el fallback `?? []` construye un arreglo nuevo en cada render y
  // dejaría sin efecto los dos `useMemo` de abajo, que dependen de él.
  const branches = useMemo(() => data?.branches ?? [], [data]);
  const targets = data?.targets;
  const period = data?.period;

  // Total del grupo. Solo entran las sucursales que tienen ambos lados: sumar
  // el costo de una sucursal sin ventas capturadas al numerador y nada al
  // denominador inventa un ratio de grupo peor que el real.
  const totals = useMemo(() => {
    let cost = 0;
    let sales = 0;
    let headcount = 0;
    let comparable = 0;
    for (const b of branches) {
      headcount += b.headcount;
      if (b.source === "NO_DATA" || b.salesCents === null) continue;
      cost += b.laborCostCents;
      sales += b.salesCents;
      comparable += 1;
    }
    return {
      cost,
      sales,
      headcount,
      comparable,
      ratioPercent: sales > 0 ? Number(((cost / sales) * 100).toFixed(1)) : null,
      partial: branches.length > 0 && comparable < branches.length,
    };
  }, [branches]);

  const footnotes = useMemo(() => {
    const lines: string[] = [];
    if (branches.some((b) => b.source === "CONTRACT_ONLY")) {
      lines.push(
        "Plantilla = contratos vigentes × días laborables, no asistencia real. " +
          "No incluye faltas ni horas extra; captura los turnos para que el ratio sea medido.",
      );
    }
    if (branches.some((b) => b.source === "NO_DATA")) {
      lines.push(
        'Un guion en Nómina = sin contratos vigentes en el período. No es un cero: es un dato que falta.',
      );
    }
    if (branches.some((b) => b.salesCents === null)) {
      lines.push(
        "Una sucursal sin cortes de venta capturados no tiene ratio: falta el denominador, " +
          "no es que su costo laboral sea 0%.",
      );
    }
    lines.push(
      "Es sueldo bruto: no incluye IMSS, INFONAVIT ni provisiones (aguinaldo, vacaciones, prima). " +
        "El número de tu contador será mayor.",
    );
    return lines;
  }, [branches]);

  const statusOf = (ratio: number | null): SemaphoreStatus | null =>
    ratio === null || !targets
      ? null
      : costStatus(ratio, targets.laborCostTargetPercent, targets.laborCostWarnPercent);

  return (
    <Card className="w-full">
      <CardHeader className="pb-3 flex flex-col md:flex-row md:items-start md:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Costo Laboral por Sucursal
          </CardTitle>
          <CardDescription className="text-xs mt-0.5 max-w-[70ch]">
            Nómina bruta sobre venta neta, comparada contra el objetivo del grupo.
            {targets && (
              <>
                {" "}
                Objetivo: ≤{targets.laborCostTargetPercent}% · tolerable hasta{" "}
                {targets.laborCostWarnPercent}%.
              </>
            )}
            {period && (
              <>
                {" "}
                <span className="font-medium text-foreground">
                  Período: {period.startDate} a {period.endDate} ({period.days} días).
                </span>
              </>
            )}
          </CardDescription>
        </div>
        <div className="self-start md:self-auto">
          <DateRangePicker value={range} onChange={setRange} align="end" />
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="py-8 flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculando costo laboral...
          </div>
        ) : failed ? (
          <EmptyState
            icon={AlertCircle}
            title="No se pudo cargar el costo laboral"
            description="Error al conectar con el servicio de finanzas. Revisa tu conexión e intenta de nuevo."
            action={
              <Button variant="outline" size="sm" onClick={loadLaborCost}>
                Reintentar
              </Button>
            }
          />
        ) : branches.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sin sucursales para mostrar"
            description="Registra al menos una sucursal para ver el costo laboral del grupo."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Nómina (bruta)</TableHead>
                    <TableHead className="text-right">Venta Neta</TableHead>
                    <TableHead className="text-right">Ratio</TableHead>
                    <TableHead className="text-right">Desviación</TableHead>
                    <TableHead className="text-center">Empleados</TableHead>
                    <TableHead>Procedencia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.map((b) => {
                    const status = statusOf(b.ratioPercent);
                    const badge = SOURCE_BADGE[b.source];
                    const deviation =
                      b.ratioPercent !== null && targets
                        ? Number((b.ratioPercent - targets.laborCostTargetPercent).toFixed(1))
                        : null;

                    return (
                      <TableRow key={b.branchId}>
                        <TableCell className="font-medium">{b.branchName}</TableCell>

                        <TableCell className="text-right tabular-nums">
                          {b.source === "NO_DATA" ? (
                            <NoteTip note={b.note}>
                              <span className="text-muted-foreground">—</span>
                            </NoteTip>
                          ) : (
                            <NoteTip note={b.note}>{formatCents(b.laborCostCents)}</NoteTip>
                          )}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {b.salesCents === null ? (
                            <NoteTip note="Sin cortes de venta capturados en el período.">
                              <span className="text-muted-foreground">—</span>
                            </NoteTip>
                          ) : (
                            <NoteTip note={`${b.salesDaysCovered} día(s) con corte registrado.`}>
                              {formatCents(b.salesCents)}
                            </NoteTip>
                          )}
                        </TableCell>

                        <TableCell className="text-right tabular-nums font-semibold">
                          {b.ratioPercent === null || !status ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={STATUS_STYLE[status].text}>{b.ratioPercent}%</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {deviation === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={deviation > 0 ? "text-destructive" : "text-success"}>
                              {deviation > 0 ? "+" : ""}
                              {deviation} pp
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="text-center tabular-nums">
                          {b.headcount || <span className="text-muted-foreground">—</span>}
                        </TableCell>

                        <TableCell>
                          <NoteTip note={badge.hint}>
                            <Badge variant="outline" className={`text-xs ${badge.className}`}>
                              {badge.label}
                            </Badge>
                          </NoteTip>
                          {status && (
                            <Badge
                              variant="outline"
                              className={`text-xs ml-1.5 ${STATUS_STYLE[status].badge}`}
                            >
                              {STATUS_STYLE[status].label}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  <TableRow className="border-t-2 font-semibold bg-muted/30">
                    <TableCell>
                      TOTAL GRUPO
                      {totals.partial && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          ({totals.comparable} de {branches.length} sucursales comparables)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totals.comparable > 0 ? (
                        formatCents(totals.cost)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totals.comparable > 0 ? (
                        formatCents(totals.sales)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(() => {
                        const status = statusOf(totals.ratioPercent);
                        return totals.ratioPercent === null || !status ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={STATUS_STYLE[status].text}>{totals.ratioPercent}%</span>
                        );
                      })()}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-center tabular-nums">
                      {totals.headcount || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 space-y-1">
              {footnotes.map((n) => (
                <p key={n} className="text-xs text-muted-foreground max-w-[85ch]">
                  {n}
                </p>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
