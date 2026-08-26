"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { useBudgets, useSaveBudget, type BudgetRow } from "@/hooks/queries/use-budgets";
import { useSession } from "@/hooks/use-session";
import { useBranch } from "@/lib/branch-context";
import { roleIsAtLeast } from "@/lib/permissions";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Wallet,
  PiggyBank,
} from "lucide-react";
import { toast } from "sonner";

// ── Utilidades de mes y dinero ──

/** Mes corriente en zona horaria local (no UTC: evita corrimiento de día/mes). */
function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

/** Valor editable del input: pesos planos para que el round-trip sea exacto. */
function centsToInputValue(cents: number): string {
  return (cents / 100).toString();
}

/** Pesos → centavos con Math.round(parseFloat*100); null si no es un monto válido. */
function pesosToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const cellKey = (branchId: string, costCenterId: string) => `${branchId}:${costCenterId}`;

interface BranchCol {
  id: string;
  name: string;
  code: string | null;
}

interface CostCenterCol {
  id: string;
  code: string | null;
  name: string;
}

/**
 * Presupuestos mensuales por sucursal × centro de costo (Task 9).
 * El API entrega el grid completo en formato largo; aquí se pivota.
 * Edición solo ADMIN+; el alcance fijo de sucursal por rol lo impone el servidor.
 */
export default function BudgetsPage() {
  // Scope único: el control de sucursal del header manda (convención Finanzas);
  // el alcance fijo por rol lo impone además el servidor.
  const { selectedBranchId } = useBranch();
  const [month, setMonth] = useState(currentMonthValue);

  const budgets = useBudgets(month, selectedBranchId ?? undefined);

  // ADMIN+ edita; el resto ve valores + barras de consumo. Durante SSR/hidratación
  // session aún es null → se renderiza solo lectura y habilita al hidratar (gotcha #5).
  const { session } = useSession();
  const isAdmin = !!session?.user?.role && roleIsAtLeast(session.user.role, "ADMIN");

  const { branches, costCenters, cells } = useMemo(() => {
    const branchList: BranchCol[] = [];
    const ccList: CostCenterCol[] = [];
    const map = new Map<string, BudgetRow>();
    for (const r of budgets.data?.rows ?? []) {
      if (!branchList.some((b) => b.id === r.branchId)) {
        branchList.push({ id: r.branchId, name: r.branchName, code: r.branchCode });
      }
      if (!ccList.some((c) => c.id === r.costCenterId)) {
        ccList.push({ id: r.costCenterId, code: r.costCenterCode, name: r.costCenterName });
      }
      map.set(cellKey(r.branchId, r.costCenterId), r);
    }
    return { branches: branchList, costCenters: ccList, cells: map };
  }, [budgets.data]);

  const totals = useMemo(() => {
    let budgeted = 0;
    let committed = 0;
    let alerts = 0;
    for (const row of budgets.data?.rows ?? []) {
      budgeted += row.budgeted;
      committed += row.committed;
      if (row.alert) alerts += 1;
    }
    return { budgeted, committed, available: budgeted - committed, alerts };
  }, [budgets.data]);

  const isLoading = budgets.isLoading;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PiggyBank className="h-7 w-7 text-primary" /> Presupuestos
          </h1>
          <p className="text-sm text-muted-foreground">
            Presupuesto mensual por sucursal y centro de costo; el consumo refleja OC/OS aprobadas del mes.
          </p>
        </div>
        {/* Navegación de mes: re-dispara la query; el grid se re-monta vía key y pierde borradores */}
        <div className="flex items-center gap-1.5" role="group" aria-label="Selector de mes">
          <Button variant="outline" size="icon" aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label="Mes del presupuesto"
            className="w-44"
          />
          <Button variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando presupuestos de {monthLabel(month)}…
        </div>
      ) : budgets.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudieron cargar los presupuestos"
          description={budgets.error instanceof Error ? budgets.error.message : "Intenta de nuevo."}
          action={
            <Button variant="outline" size="sm" onClick={() => budgets.refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : branches.length === 0 || costCenters.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Sin datos para presupuestar"
          description="Necesitas al menos una sucursal activa y un centro de costo activo en la empresa."
        />
      ) : (
        <>
          {/* Resumen del mes visible + alertas ≥90% (color + texto accesible) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span className="capitalize font-medium text-foreground">{monthLabel(month)}</span>
            <span className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" /> Presupuestado {formatCurrency(totals.budgeted)}
            </span>
            <span>Comprometido {formatCurrency(totals.committed)}</span>
            <span className={totals.available < 0 ? "text-destructive font-medium" : undefined}>
              Disponible {formatCurrency(totals.available)}
            </span>
            {totals.alerts > 0 && (
              <Badge variant="warning" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {totals.alerts} partida(s) ≥90%
                <span className="sr-only">partidas con consumo igual o mayor al 90% del presupuesto</span>
              </Badge>
            )}
            {!isAdmin && (
              <span className="ml-auto text-xs">Solo lectura · la captura requiere rol ADMIN</span>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold">Grid mensual</CardTitle>
              <CardDescription className="text-xs">
                Filas = sucursales, columnas = centros de costo activos. Montos en pesos MX; el compromiso
                (barra) proviene de OC/OS aprobadas con atribución a este mes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* El estado de borradores vive DENTRO del componente keyed: cambiar de
                  mes o sucursal re-monta la tabla y descarta ediciones no guardadas. */}
              <BudgetsTable
                key={`${month}:${selectedBranchId ?? "ALL"}`}
                month={month}
                isAdmin={isAdmin}
                branches={branches}
                costCenters={costCenters}
                cells={cells}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** Grid pivoteado con borrador derivado (gotcha #15): draft[key] ?? valor del servidor,
 *  guardado explícito por fila. Se monta con key por mes+sucursal. */
function BudgetsTable({
  month,
  isAdmin,
  branches,
  costCenters,
  cells,
}: {
  month: string;
  isAdmin: boolean;
  branches: BranchCol[];
  costCenters: CostCenterCol[];
  cells: Map<string, BudgetRow>;
}) {
  const saveBudget = useSaveBudget();
  // Borradores de celdas: cellKey → texto en pesos (sin useEffect — gotcha #7).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingBranch, setSavingBranch] = useState<string | null>(null);

  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: value }));

  /** Guarda todas las celdas modificadas de una fila (PUT secuencial por celda). */
  const saveRow = async (branch: BranchCol) => {
    const dirtyCells = costCenters
      .map((cc) => ({ cc, key: cellKey(branch.id, cc.id), raw: drafts[cellKey(branch.id, cc.id)] }))
      .filter((c) => c.raw !== undefined);
    if (dirtyCells.length === 0) return;

    const parsed = dirtyCells.map((c) => ({ ...c, amount: pesosToCents(c.raw!) }));
    if (parsed.some((c) => c.amount === null)) {
      toast.error("Hay montos inválidos en la fila; corrígelos antes de guardar.");
      return;
    }

    setSavingBranch(branch.id);
    try {
      for (const c of parsed) {
        await saveBudget.mutateAsync({
          branchId: branch.id,
          costCenterId: c.cc.id,
          month,
          amount: c.amount!,
        });
      }
      setDrafts((prev) => {
        const next = { ...prev };
        for (const c of parsed) delete next[c.key];
        return next;
      });
      toast.success(`Presupuesto de ${branch.name} actualizado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el presupuesto");
    } finally {
      setSavingBranch(null);
    }
  };

  const hasDraftsFor = (branchId: string) =>
    costCenters.some((cc) => drafts[cellKey(branchId, cc.id)] !== undefined);
  const hasInvalidFor = (branchId: string) =>
    costCenters.some((cc) => {
      const raw = drafts[cellKey(branchId, cc.id)];
      return raw !== undefined && pesosToCents(raw) === null;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className="text-left font-medium py-2 pr-4 sticky left-0 bg-card">
              Sucursal
            </th>
            {costCenters.map((cc) => (
              <th scope="col" key={cc.id} className="text-right font-medium py-2 px-3 min-w-44">
                <div>{cc.code ?? cc.name}</div>
                {cc.code && (
                  <div className="text-xs font-normal text-muted-foreground max-w-44 truncate" title={cc.name}>
                    {cc.name}
                  </div>
                )}
              </th>
            ))}
            {isAdmin && <th scope="col" className="py-2 pl-3" aria-label="Acciones" />}
          </tr>
        </thead>
        <tbody>
          {branches.map((branch) => {
            const saving = savingBranch === branch.id;
            const invalid = hasInvalidFor(branch.id);
            return (
              <tr key={branch.id} className="border-b last:border-b-0 align-top">
                <td className="py-3 pr-4 sticky left-0 bg-card">
                  <p className="font-medium leading-tight">{branch.name}</p>
                  {branch.code && <p className="text-xs text-muted-foreground">{branch.code}</p>}
                </td>
                {costCenters.map((cc) => {
                  const key = cellKey(branch.id, cc.id);
                  const row = cells.get(key);
                  const budgeted = row?.budgeted ?? 0;
                  const committed = row?.committed ?? 0;
                  const alert = row?.alert ?? false;
                  const usedPct =
                    budgeted > 0 ? Math.min(100, Math.round((committed / budgeted) * 100)) : 0;

                  if (!isAdmin) {
                    return (
                      <td key={cc.id} className={`py-3 px-3 text-right ${alert ? "bg-warning/10" : ""}`}>
                        <BudgetCellView
                          budgeted={budgeted}
                          committed={committed}
                          usedPct={usedPct}
                          alert={alert}
                        />
                      </td>
                    );
                  }

                  const raw = drafts[key] ?? centsToInputValue(budgeted);
                  const isInvalid = drafts[key] !== undefined && pesosToCents(raw) === null;
                  return (
                    <td key={cc.id} className={`py-3 px-3 ${alert ? "bg-warning/10" : ""}`}>
                      <div className="flex flex-col items-end gap-1">
                        <Input
                          inputMode="decimal"
                          value={raw}
                          onChange={(e) => setDraft(key, e.target.value)}
                          aria-label={`Presupuesto de ${branch.name}, centro ${cc.name}`}
                          aria-invalid={isInvalid || undefined}
                          disabled={saving}
                          className={`h-8 w-32 text-right tabular-nums ${isInvalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        />
                        {isInvalid && (
                          <p className="text-xs text-destructive">Monto inválido</p>
                        )}
                        <ConsumptionHint usedPct={usedPct} committed={committed} budgeted={budgeted} />
                      </div>
                    </td>
                  );
                })}
                {isAdmin && (
                  <td className="py-3 pl-3">
                    {hasDraftsFor(branch.id) && (
                      <Button
                        size="sm"
                        onClick={() => saveRow(branch)}
                        disabled={saving || invalid || saveBudget.isPending}
                      >
                        {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Guardar
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {isAdmin && (
        <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
          El guardado es explícito por fila. Un campo vacío o inválido bloquea el guardado
          (usa 0 para presupuesto en cero).
        </p>
      )}
    </div>
  );
}

/** Celda de solo lectura: monto presupuestado (o consumido si no hay presupuesto) + barra. */
function BudgetCellView({
  budgeted,
  committed,
  usedPct,
  alert,
}: {
  budgeted: number;
  committed: number;
  usedPct: number;
  alert: boolean;
}) {
  return (
    <div className="inline-flex flex-col items-end gap-1 min-w-28">
      {budgeted > 0 ? (
        <>
          <span className={`tabular-nums font-medium ${alert ? "text-amber-700 dark:text-amber-400" : ""}`}>
            {formatCurrency(budgeted)}
          </span>
          <ConsumptionHint usedPct={usedPct} committed={committed} budgeted={budgeted} />
        </>
      ) : (
        <span className="text-xs text-muted-foreground tabular-nums">
          Sin presupuesto{committed > 0 ? ` · gastado ${formatCurrency(committed)}` : ""}
        </span>
      )}
    </div>
  );
}

/** Barra de consumo + comprometido; ámbar al ≥90% (mismo criterio que BudgetHint). */
function ConsumptionHint({
  usedPct,
  committed,
  budgeted,
}: {
  usedPct: number;
  committed: number;
  budgeted: number;
}) {
  if (budgeted <= 0) return null;
  const high = usedPct >= 90;
  return (
    <div className="w-full space-y-0.5">
      <Progress value={usedPct} className="h-1" aria-label={`${usedPct}% consumido`} />
      <p className={`text-[11px] tabular-nums ${high ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
        {usedPct}% · {formatCurrency(committed)}
      </p>
    </div>
  );
}
