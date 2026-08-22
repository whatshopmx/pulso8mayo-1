"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PettyCashHistoryTable, PettyCashTransactionItem } from "@/components/finance/petty-cash-history-table";
import { PettyCashRegister } from "@/components/finance/petty-cash-register";
import { useBranches } from "@/hooks/queries/use-branches";
import { useBranch } from "@/lib/branch-context";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { mensajeDeError } from "@/lib/api/client-error";
import {
  Wallet,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Coins,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

/** Estado de una sucursal dentro de la vista consolidada. Lo arma el servidor (A17). */
interface BranchFundRow {
  branchId: string;
  branchName: string;
  currentBalanceCents: number;
  fundAmountCents: number;
  lowThresholdCents: number;
  belowThreshold: boolean;
}

interface PettyFund {
  branchId?: string;
  branchName?: string;
  currentBalance: number;
  fundAmount: number;
  lowThreshold: number;
  /**
   * Solo en vista consolidada. El umbral NO es aditivo: sumarlo permitiría que
   * la cadena luzca sana mientras una sucursal está en cero, así que se reporta
   * cuántas sucursales están bajo su propio umbral — y cuáles.
   */
  consolidated?: {
    branchesBelowThreshold: number;
    branchesWithFund: number;
    rows: BranchFundRow[];
  };
}

export default function PettyCashPage() {
  // `useQuery` distingue "falló" de "no hay sucursales" con `isError` frente a
  // una lista vacía; se traduce a las mismas cuatro variables que la pantalla ya
  // usaba, y el mensaje sigue siendo el del servidor.
  const {
    data: branchesData,
    isLoading: branchesLoading,
    isError: branchesFailed,
    error: branchesFetchError,
    refetch: refetchBranches,
  } = useBranches();
  const branches = branchesData ?? [];
  const branchesError = branchesFailed
    ? branchesFetchError?.message || "No se pudieron cargar las sucursales."
    : null;
  // Scope único: el selector del header (`BranchScopeControl`) es la fuente de
  // verdad. `null` = todas las sucursales.
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";
  const [fund, setFund] = useState<PettyFund | null>(null);
  const [transactions, setTransactions] = useState<PettyCashTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundError, setFundError] = useState<string | null>(null);
  /**
   * Sucursales sin fondo abierto. Es un estado normal —el `GET` ya no inventa el
   * fondo—, y desde A17 lo dice el servidor: antes se deducía de qué respuestas
   * habían llegado, junto a las sucursales que no contestaron. Ese segundo caso
   * ya no existe: la petición es una y falla entera o no falla, así que un fallo
   * es el estado de error de la pantalla y no una nota al pie del saldo.
   */
  const [branchesWithoutFund, setBranchesWithoutFund] = useState<string[]>([]);
  /** A19 — Cuántos movimientos existen, para declarar los que no se muestran. */
  const [movimientosTotal, setMovimientosTotal] = useState(0);

  // El orden se invirtió con A17. Antes las sucursales iban primero porque sin
  // ellas no había a quién pedirle el fondo: la pantalla armaba el abanico de
  // peticiones a partir de esa lista. Ahora el consolidado lo resuelve el
  // servidor y `branches` sólo alimenta el diálogo de registro, así que el fallo
  // que le importa a quien mira el saldo es el del saldo.
  const error = fundError ?? branchesError;

  /**
   * A17 — Una sola petición, con alcance "todas" o con una sucursal.
   *
   * Antes esto era un abanico de dos peticiones **por sucursal** —30 con 15
   * sucursales, cada una pasando por el limitador de tasa y por una
   * verificación de sesión que es a su vez un `fetch` interno— y el saldo de la
   * cadena era la suma de las que alcanzaron a contestar.
   *
   * Ya no depende de `branches`: el servidor sabe qué sucursales hay, y el
   * alcance lo resuelve él desde la sesión. `branchId` viaja como petición, no
   * como orden.
   */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setFundError(null);
    try {
      const url = new URL("/api/petty-cash/consolidado", window.location.origin);
      if (selectedBranch !== "ALL") url.searchParams.set("branchId", selectedBranch);

      const res = await fetch(url.toString());
      const json = await res.json();

      if (!res.ok || !json.success) {
        // Un saldo que no cargó no es un saldo en cero: presentarlos igual diría
        // que la cadena no tiene efectivo. Es el mismo criterio de A10.
        setFundError(
          mensajeDeError(json, "El servidor no devolvió el estado de caja chica.")
        );
        setFund(null);
        setTransactions([]);
        setBranchesWithoutFund([]);
        setMovimientosTotal(0);
        return;
      }

      const data = json.data as {
        totals: {
          currentBalanceCents: number;
          fundAmountCents: number;
          branchesWithFund: number;
          branchesBelowThreshold: number;
        };
        rows: BranchFundRow[];
        branchesWithoutFund: Array<{ branchId: string; branchName: string }>;
        movimientos: { items: PettyCashTransactionItem[]; total: number; limit: number };
      };

      setBranchesWithoutFund(data.branchesWithoutFund.map((b) => b.branchName));
      setTransactions(data.movimientos.items);
      setMovimientosTotal(data.movimientos.total);

      if (data.rows.length === 0) {
        setFund(null);
        return;
      }

      if (data.rows.length > 1) {
        // El orden por urgencia y el conteo bajo umbral ya vienen resueltos: son
        // la respuesta a "¿a dónde mando dinero?" y no pueden depender de qué
        // respuestas llegaron primero.
        setFund({
          branchName: "Vista consolidada",
          currentBalance: data.totals.currentBalanceCents,
          fundAmount: data.totals.fundAmountCents,
          lowThreshold: 0, // no aplica en consolidado; ver `consolidated`
          consolidated: {
            branchesBelowThreshold: data.totals.branchesBelowThreshold,
            branchesWithFund: data.totals.branchesWithFund,
            rows: data.rows,
          },
        });
      } else {
        const fila = data.rows[0];
        setFund({
          branchId: fila.branchId,
          branchName: fila.branchName,
          currentBalance: fila.currentBalanceCents,
          fundAmount: fila.fundAmountCents,
          lowThreshold: fila.lowThresholdCents,
        });
      }
    } catch (err) {
      console.error("Error loading petty cash data:", err);
      setFundError("No se pudo cargar el estado de caja chica. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [selectedBranch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Un fondo de $0 no admite porcentaje: sin esta guarda el badge imprime "NaN%"
  // (el clamp de la barra ocultaba el síntoma, no la causa).
  const hasFundAmount = fund !== null && fund.fundAmount > 0;
  const balancePercentage = hasFundAmount
    ? Math.round((fund.currentBalance / fund.fundAmount) * 100)
    : null;
  const thresholdPercentage = hasFundAmount
    ? Math.round((fund.lowThreshold / fund.fundAmount) * 100)
    : null;

  const consolidated = fund?.consolidated;
  const isLowBalance = consolidated
    ? consolidated.branchesBelowThreshold > 0
    : fund
      ? fund.currentBalance <= fund.lowThreshold
      : false;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-7 w-7 text-primary" /> Control y Auditoría de Caja Chica
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitoreo en tiempo real de retiros, reposiciones, autorizaciones por rol y bitácora de comprobantes.
          </p>
        </div>

        {/* El registro ya no se esconde en vista consolidada: la acción por la que
            una gerente abre esta página no puede depender de que antes acierte con
            un filtro. La sucursal se elige dentro del diálogo. */}
        {branches.length > 0 && (
          <PettyCashRegister
            branches={branches}
            defaultBranchId={selectedBranchId}
            onSuccess={fetchData}
          />
        )}
      </div>

      {branchesLoading || loading ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando estado de caja chica...
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title="No se pudo cargar la caja chica"
          description={error}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Reintenta ambas cargas: al reponerse las sucursales, el efecto
                // vuelve a disparar la del fondo.
                refetchBranches();
                fetchData();
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
            </Button>
          }
        />
      ) : branches.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No hay sucursales registradas"
          description="La caja chica se administra por sucursal. Registra al menos una sucursal para poder abrir un fondo."
        />
      ) : fund ? (
        <>
          {/* Distilled status surface — one prominent figure + inline threshold bar + movements line */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardDescription className="text-xs font-medium">
                  Saldo Disponible{fund.branchName ? ` · ${fund.branchName}` : ""}
                </CardDescription>
                {isLowBalance ? (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 text-xs">
                    <AlertTriangle className="w-3 h-3" /> Reposición requerida
                    {consolidated
                      ? ` (${consolidated.branchesBelowThreshold} de ${consolidated.branchesWithFund} sucursales)`
                      : thresholdPercentage !== null
                        ? ` (<${thresholdPercentage}%)`
                        : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1 text-xs">
                    <CheckCircle2 className="w-3 h-3" /> Suficiente
                    {balancePercentage !== null ? ` (${balancePercentage}%)` : ""}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-3xl font-bold text-foreground pt-1">
                {formatCents(fund.currentBalance)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Inline threshold bar: currentBalance as % of fundAmount, mark at threshold */}
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Fondo total: {formatCents(fund.fundAmount)}</span>
                  <span>
                    {consolidated
                      ? `${consolidated.branchesBelowThreshold} de ${consolidated.branchesWithFund} sucursales bajo umbral`
                      : `Umbral de alerta: ${formatCents(fund.lowThreshold)}`}
                  </span>
                </div>
                <div className="relative w-full h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                      isLowBalance ? "bg-destructive" : "bg-success"
                    }`}
                    style={{ width: `${Math.min(Math.max(balancePercentage ?? 0, 0), 100)}%` }}
                  />
                  {/* Threshold mark — el umbral por sucursal no aplica al consolidado */}
                  {!consolidated && thresholdPercentage !== null && (
                    <div
                      className="absolute inset-y-0 w-px bg-foreground/40"
                      style={{ left: `${Math.min(Math.max(thresholdPercentage, 0), 100)}%` }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>

              {/* "3 de 7 bajo umbral" sin decir cuáles obliga a siete consultas
                  manuales en la página cuyo trabajo es decidir a dónde mandar
                  efectivo. Aquí van, las que menos tienen primero. */}
              {consolidated && (
                <ul className="divide-y rounded-md border">
                  {consolidated.rows.map((row) => (
                    <li
                      key={row.branchId}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <span className="font-medium truncate">{row.branchName}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="tabular-nums font-semibold">
                          {formatCents(row.currentBalanceCents)}
                        </span>
                        {row.belowThreshold ? (
                          <Badge
                            variant="outline"
                            className={`gap-1 text-xs ${statusBadgeClasses("destructive")}`}
                          >
                            <AlertTriangle className="w-3 h-3" /> Bajo umbral
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={`gap-1 text-xs ${statusBadgeClasses("success")}`}
                          >
                            <CheckCircle2 className="w-3 h-3" /> Suficiente
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* Una sucursal sin fondo abierto no es un error ni una omisión del
                  sistema: es efectivo que nadie ha entregado todavía. Se nombra
                  para que se vea a quién le falta, sin mezclarlo con las fallas. */}
              {branchesWithoutFund.length > 0 && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Wallet className="w-4 h-4 shrink-0 mt-px" />
                  {branchesWithoutFund.length === 1
                    ? "1 sucursal aún no tiene fondo abierto"
                    : `${branchesWithoutFund.length} sucursales aún no tienen fondo abierto`}{" "}
                  ({branchesWithoutFund.join(", ")}). Ábrelo con el efectivo que se les
                  entregó para que entren al saldo de la cadena.
                </p>
              )}

              {/* Movements as a demoted secondary line, not its own card.
                  Se cuenta cuántos traen comprobante en vez de afirmar que todos
                  lo traen: los movimientos previos al gate pueden no tenerlo. */}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
                <ShieldCheck className="w-4 h-4 text-success" />
                {/* A19 — El conteo es el de la cadena entera, no el de lo que se
                    alcanzó a traer: decir "100 movimientos" cuando hay 4,000 es
                    afirmar de menos sobre el propio libro. */}
                <span className="font-medium text-foreground">{movimientosTotal}</span>
                movimientos en la bitácora,{" "}
                <span className="font-medium text-foreground">
                  {transactions.filter((t) => t.evidenceUrl).length}
                </span>{" "}
                de los {transactions.length} más recientes con comprobante fotográfico.
              </div>
            </CardContent>
          </Card>

          {/* Audit History Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Coins className="w-5 h-5 text-primary" /> Bitácora Auditable de Transacciones
              </CardTitle>
              <CardDescription className="text-xs">
                {/* A19 — Decía "historial completo" y nunca lo fue: antes traía
                    todo lo que las N peticiones alcanzaran a devolver, y ahora
                    trae los más recientes. Se declara la cota en vez de
                    prometer una integridad que la tabla no tiene. */}
                {movimientosTotal > transactions.length
                  ? `Los ${transactions.length} movimientos más recientes de ${movimientosTotal}: quién solicitó, quién autorizó, motivo registrado y comprobante adjunto. Acota por sucursal desde el encabezado para ver los de una sola.`
                  : "Retiros e ingresos mostrando quién solicitó, quién autorizó, motivo registrado y comprobante adjunto."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PettyCashHistoryTable transactions={transactions} />
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState
          icon={Wallet}
          title={
            selectedBranch === "ALL"
              ? "Sin fondos de caja chica en la cadena"
              : "Sin caja chica en esta sucursal"
          }
          description={
            selectedBranch === "ALL"
              ? "Ninguna sucursal tiene un fondo de caja chica abierto. Abrir uno exige capturar el efectivo que se entregó: el sistema no inventa el monto."
              : "Esta sucursal aún no tiene fondo de caja chica. Ábrelo capturando el efectivo que se le entregó."
          }
          action={
            branches.length > 0 ? (
              <PettyCashRegister
                branches={branches}
                defaultBranchId={selectedBranchId}
                modes={["OPEN"]}
                onSuccess={fetchData}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
