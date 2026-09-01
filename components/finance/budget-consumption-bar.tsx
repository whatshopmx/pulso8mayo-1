"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertCircle, Loader2, PiggyBank, RefreshCw } from "lucide-react";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import type { BudgetConsumptionReport, CostCenterConsumption } from "@/lib/services/budget-service";

/**
 * Umbrales de color. Son los mismos que dispara la notificación al capturar un
 * gasto (`BUDGET_WARN_RATIO` en `expense-service.ts`): si la barra se pone ámbar
 * a un porcentaje distinto del que manda el WhatsApp, uno de los dos miente.
 */
const WARN_PERCENT = 80;
const OVER_PERCENT = 100;

type Nivel = "OK" | "WARNING" | "OVER";

function nivelDe(percent: number): Nivel {
  if (percent >= OVER_PERCENT) return "OVER";
  if (percent >= WARN_PERCENT) return "WARNING";
  return "OK";
}

const NIVEL_BARRA: Record<Nivel, string> = {
  OK: "bg-success",
  WARNING: "bg-warning",
  OVER: "bg-destructive",
};

const NIVEL_TEXTO: Record<Nivel, string> = {
  OK: "text-success",
  WARNING: "text-warning-text",
  OVER: "text-destructive",
};

/**
 * Mes local en `YYYY-MM`. No `toISOString()`: en México UTC ya adelantó el día
 * —y el día 31 después de las 18:00, el mes— así que el último día del mes se
 * consultaría contra el presupuesto del siguiente, que está vacío.
 */
function mesActual(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function mesLegible(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  return `${MESES[idx] ?? month} ${y}`;
}

type Payload = BudgetConsumptionReport & {
  scope: { branchId: string | null; kind: "ALL" | "BRANCH" | "NONE" };
};

interface BudgetConsumptionBarProps {
  /** Sucursal del encabezado; `"ALL"` o `null` = todo el alcance del rol. */
  branchId?: string | null;
  /** Cambia cuando se captura un gasto, para recargar el consumo. */
  reloadToken?: number;
  /** Partida activa en el filtro del listado, para resaltar el renglón. */
  selectedCostCenterId?: string;
  /** Clic en un renglón: filtra el listado por esa partida. */
  onSelectCostCenter?: (costCenterId: string) => void;
}

/**
 * Consumo del presupuesto del mes por centro de costo, con el renglón de gasto
 * sin clasificar.
 *
 * El renglón "sin clasificar" no es decorativo: mientras crece, el resto de la
 * tabla puede verse en verde con el dinero saliendo por un lado que no mira
 * ninguna barra. Por eso va con monto **y** porcentaje del gasto del mes.
 */
export function BudgetConsumptionBar({
  branchId,
  reloadToken,
  selectedCostCenterId,
  onSelectCostCenter,
}: BudgetConsumptionBarProps) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const month = useMemo(() => mesActual(), []);

  const cargar = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const url = new URL("/api/expenses/budget-consumption", window.location.origin);
      url.searchParams.set("month", month);
      if (branchId && branchId !== "ALL") {
        url.searchParams.set("branchId", branchId);
      }
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFailed(true);
        setData(null);
        return;
      }
      setData(json.data ?? null);
    } catch (err) {
      console.error("Error al cargar el consumo de presupuesto:", err);
      setFailed(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, month]);

  useEffect(() => {
    cargar();
  }, [cargar, reloadToken]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const sinClasificar = data?.unclassified;

  // Sólo cuenta el presupuesto de las partidas que sí lo tienen capturado:
  // sumar como 0 el de las que no lo tienen inflaría el consumo del grupo.
  const totales = useMemo(() => {
    let presupuesto = 0;
    let consumido = 0;
    let conPresupuesto = 0;
    for (const r of rows) {
      if (r.budgetedCents === null) continue;
      presupuesto += r.budgetedCents;
      consumido += r.consumedCents;
      conPresupuesto += 1;
    }
    return {
      presupuesto,
      consumido,
      percent: presupuesto > 0 ? Math.round((consumido / presupuesto) * 1000) / 10 : null,
      sinPresupuesto: rows.length - conPresupuesto,
    };
  }, [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <PiggyBank className="h-4 w-4 text-primary" />
            Consumo de presupuesto · {mesLegible(month)}
          </CardTitle>
          <CardDescription>
            Comprometido del mes por partida: gastos operativos capturados más órdenes de compra y
            de servicio. Es lo mismo que evalúa el aviso al 80%.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={cargar}
          disabled={loading}
          aria-label="Recargar consumo de presupuesto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Calculando consumo...</span>
          </div>
        ) : failed ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-muted-foreground">
              No se pudo calcular el consumo de presupuesto.
            </span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={cargar}>
              Reintentar
            </Button>
          </div>
        ) : data?.scope?.kind === "NONE" ? (
          <EmptyState
            bare
            icon={PiggyBank}
            title="Sin sucursal asignada"
            description="Tu usuario está acotado a una sucursal pero no tiene ninguna asignada. Pide a un administrador que te la asigne."
          />
        ) : rows.length === 0 && !sinClasificar?.amountCents ? (
          <EmptyState
            bare
            icon={PiggyBank}
            title="Sin presupuestos ni gasto este mes"
            description="Captura presupuestos por sucursal y partida para que este tablero avise antes de que el mes se pase, no después."
          />
        ) : (
          <div className="space-y-4">
            {rows.map((row) => (
              <ConsumptionRow
                key={row.costCenterId}
                row={row}
                selected={selectedCostCenterId === row.costCenterId}
                onSelect={onSelectCostCenter}
              />
            ))}

            {/* Sin clasificar. Va aparte y no como una partida más porque no
                tiene presupuesto contra el cual medirse: su referencia es el
                gasto total del mes. */}
            {sinClasificar && sinClasificar.amountCents > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-warning-text">Sin clasificar</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCents(sinClasificar.amountCents)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {sinClasificar.percentOfTotal}% del gasto del mes
                    </span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Gasto operativo sin centro de costo: no consume ningún presupuesto ni dispara
                  avisos. Mientras este renglón crezca, las barras de arriba dicen menos de lo que
                  parece.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>
                Gasto operativo del mes:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCents(data?.totalExpensesCents ?? 0)}
                </span>
                {totales.percent !== null && (
                  <>
                    {" · "}
                    Comprometido {formatCents(totales.consumido)} de{" "}
                    {formatCents(totales.presupuesto)} presupuestado ({totales.percent}%)
                  </>
                )}
              </span>
              {totales.sinPresupuesto > 0 && (
                <span>
                  {totales.sinPresupuesto} partida{totales.sinPresupuesto === 1 ? "" : "s"} con gasto
                  y sin presupuesto capturado
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConsumptionRow({
  row,
  selected,
  onSelect,
}: {
  row: CostCenterConsumption;
  selected: boolean;
  onSelect?: (costCenterId: string) => void;
}) {
  const sinPresupuesto = row.budgetedCents === null || row.percent === null;
  const nivel: Nivel = sinPresupuesto ? "OK" : nivelDe(row.percent as number);
  // El ancho se topa en 100: una barra al 140% se saldría de la tarjeta. El
  // exceso se lee en el porcentaje y en el color, no en el largo.
  const ancho = sinPresupuesto ? 0 : Math.min(100, Math.max(0, row.percent as number));

  const contenido = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">
          <span className="text-muted-foreground">{row.code}</span> · {row.name}
        </span>
        {sinPresupuesto ? (
          <span className="flex items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold">{formatCents(row.consumedCents)}</span>
            <Badge variant="outline" className={`text-xs ${statusBadgeClasses("neutral")}`}>
              Sin presupuesto
            </Badge>
          </span>
        ) : (
          <span className="text-sm tabular-nums">
            <span className={`font-semibold ${NIVEL_TEXTO[nivel]}`}>
              {formatCents(row.consumedCents)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              de {formatCents(row.budgetedCents as number)}
            </span>
            <span className={`ml-2 font-semibold ${NIVEL_TEXTO[nivel]}`}>{row.percent}%</span>
          </span>
        )}
      </div>

      {sinPresupuesto ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Esta partida tuvo gasto pero nadie le capturó presupuesto del mes: sin denominador no hay
          porcentaje, y eso no es lo mismo que 0%.
        </p>
      ) : (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={row.percent as number}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Consumo de ${row.name}`}
        >
          <div
            className={`h-full rounded-full ${NIVEL_BARRA[nivel]}`}
            style={{ width: `${ancho}%` }}
          />
        </div>
      )}

      {!sinPresupuesto && (row.percent as number) >= OVER_PERCENT && (
        <p className="mt-1 text-xs text-destructive">
          Excedido por {formatCents(row.consumedCents - (row.budgetedCents as number))}.
        </p>
      )}
    </>
  );

  const clases = `rounded-md border p-3 transition-colors ${
    selected ? "border-primary/40 bg-primary/5" : "border-transparent"
  }`;

  if (!onSelect) {
    return <div className={clases}>{contenido}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(row.costCenterId)}
      className={`${clases} w-full text-left hover:border-border hover:bg-muted/40`}
      aria-pressed={selected}
    >
      {contenido}
    </button>
  );
}
