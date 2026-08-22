"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SalesCutUpload } from "@/components/sales/sales-cut-upload";
import { SalesDashboard } from "@/components/sales/sales-dashboard";
import { FinancialKpiCards } from "@/components/sales/financial-kpi-cards";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Loader2,
  Coins,
  AlertCircle,
  CheckCircle,
  Settings2,
  BarChart3,
  FileSpreadsheet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { statusBadgeClasses, formatCents } from "@/lib/utils";
import { computeCashVariance, cashVarianceToneClass } from "@/lib/sales/cash-variance";
import { useBranches } from "@/hooks/queries/use-branches";
import { useBranch } from "@/lib/branch-context";
import Link from "next/link";

/** Alcance que `/api/sales/cuts` aplicó, tal como lo devuelve (A8). */
interface CutsScope {
  branchId: string | null;
  startDate: string | null;
  endDate: string | null;
  /** `true` si el rango lo puso la ruta (mes en curso) y no el usuario. */
  rangoPorDefecto: boolean;
  limit: number;
  offset: number;
  truncated: boolean;
}

interface SalesCut {
  id: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  shift: "MATUTINO" | "VESPERTINO" | "COMPLETO";
  channel: "SALON" | "DELIVERY" | "EVENTOS" | "TOTAL";
  totalSales: number;
  cashSales: number | null;
  cardSales: number | null;
  otherPayments: number | null;
  cashCountedCents: number | null;
  depositedCents: number | null;
  aggregatorSales: Record<string, number> | null;
  ticketCount: number | null;
  avgTicket: number | null;
  source: "UPLOAD" | "WHATSAPP" | "MANUAL_FORM";
  rawFileUrl: string | null;
  status: "VALIDATED" | "PENDING_REVIEW";
  validationNotes: string | null;
  receivedByName: string | null;
  receivedAt: string;
  createdAt: string;
}

/** El canal se guarda como enum; en pantalla se lee como lo nombra la operación. */
const CHANNEL_LABELS: Record<SalesCut["channel"], string> = {
  SALON: "Salón",
  DELIVERY: "Delivery",
  EVENTOS: "Eventos",
  TOTAL: "Total",
};

/**
 * `useSearchParams` exige un límite de Suspense: el rango de fechas ahora vive en
 * la URL que escribe `BranchScopeControl`, y sin esta frontera el prerender de la
 * ruta falla en build.
 */
export default function SalesDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto py-12 flex justify-center text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando ventas...
        </div>
      }
    >
      <SalesDashboardPageContent />
    </Suspense>
  );
}

function SalesDashboardPageContent() {
  const { toast } = useToast();
  const [cuts, setCuts] = useState<SalesCut[]>([]);
  const { data: branchesData } = useBranches();
  const branches = branchesData ?? [];
  const [loadingCuts, setLoadingCuts] = useState(true);
  /** Alcance que la ruta aplicó de verdad, y cuántos cortes existen en él (A8). */
  const [cutsScope, setCutsScope] = useState<CutsScope | null>(null);
  const [cutsTotal, setCutsTotal] = useState(0);
  /**
   * "Falló" y "no hay" son cosas distintas (A7). Esta pantalla pintaba la misma
   * tabla vacía para las dos, con un toast que se va solo a los segundos.
   */
  const [cutsError, setCutsError] = useState<string | null>(null);

  // Scope único para toda la página: sucursal desde el control del encabezado
  // (cookie) y rango de fechas desde la URL que ese mismo control escribe. Antes
  // esta pantalla llegaba a mostrar diez controles de alcance a la vez —dos en el
  // header y ocho propios— sin señal de cuál mandaba.
  const { selectedBranchId, setSelectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";
  const searchParams = useSearchParams();
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";

  // Fetch sales cuts
  const fetchCuts = useCallback(async () => {
    setLoadingCuts(true);
    setCutsError(null);
    try {
      let url = "/api/sales/cuts?";
      if (selectedBranch && selectedBranch !== "ALL") {
        url += `branchId=${selectedBranch}&`;
      }
      if (startDate) {
        url += `startDate=${startDate}&`;
      }
      if (endDate) {
        url += `endDate=${endDate}&`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("No se pudieron cargar los cortes de ventas.");
      }
      const data = await res.json();
      // La ruta pasó de devolver un arreglo pelado a `{ items, total, scope }`
      // (A8), para poder declarar el rango aplicado y lo que no cabe en la
      // página. `?? []` cubre el caso de una respuesta sin `items`.
      setCuts(data.data?.items ?? []);
      setCutsScope(data.data?.scope ?? null);
      setCutsTotal(data.data?.total ?? 0);
    } catch (err) {
      console.error(err);
      const mensaje =
        err instanceof Error ? err.message : "Error al conectar con el servidor.";
      setCutsError(mensaje);
      // Vaciar es parte del arreglo, no limpieza de más: sin esto, un fallo al
      // cambiar de sucursal dejaba en pantalla las filas de la **anterior**
      // bajo la etiqueta de alcance nueva. Cifras reales, sucursal equivocada.
      setCuts([]);
      setCutsScope(null);
      setCutsTotal(0);
      toast({
        title: "Error de Carga",
        description: mensaje,
        variant: "destructive",
      });
    } finally {
      setLoadingCuts(false);
    }
  }, [selectedBranch, startDate, endDate, toast]);

  useEffect(() => {
    fetchCuts();
  }, [fetchCuts]);

  const getSourceBadge = (source: SalesCut["source"]) => {
    switch (source) {
      case "UPLOAD":
        return <Badge variant="outline" className={statusBadgeClasses("info")}>Archivo POS</Badge>;
      case "WHATSAPP":
        return <Badge variant="outline" className={statusBadgeClasses("success")}>WhatsApp</Badge>;
      case "MANUAL_FORM":
        return <Badge variant="outline" className={statusBadgeClasses("warning")}>Manual</Badge>;
    }
  };

  const scopeLabel = (() => {
    const branchLabel =
      selectedBranch === "ALL"
        ? "todas las sucursales"
        : branches.find((b) => b.id === selectedBranch)?.name ?? "la sucursal en foco";

    // El rango se lee del alcance que **la ruta aplicó**, no del que pidió la
    // URL. Antes decía "todo el período" cuando no había fechas; desde A8 la
    // ruta acota al mes en curso, así que esa etiqueta habría pasado a ser
    // falsa justo en el caso por omisión.
    const desde = cutsScope?.startDate ?? startDate;
    const hasta = cutsScope?.endDate ?? endDate;
    const dateLabel = desde
      ? `${desde}${hasta && hasta !== desde ? ` a ${hasta}` : ""}${cutsScope?.rangoPorDefecto ? " (mes en curso)" : ""}`
      : "todo el período";

    return `${branchLabel} · ${dateLabel}`;
  })();

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {/* "(M13)" era un código interno de módulo filtrado al h1: lo primero
                que leía un gerente nuevo era jerga del backlog. */}
            <Coins className="h-7 w-7 text-primary" /> Ventas y Cortes de Caja
            {/* `button` en vez de `span`: un `title` sobre texto plano es
                inalcanzable por teclado y lo ignora el lector de pantalla. */}
            <button
              type="button"
              className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-muted-foreground/30 text-xs leading-none text-muted-foreground cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Módulo de ingesta de cortes de ventas desde archivos POS, WhatsApp o captura manual. Los datos alimentan KPIs financieros y la proyección de flujo de efectivo."
              aria-label="Qué es este módulo: ingesta de cortes de ventas desde archivos POS, WhatsApp o captura manual. Los datos alimentan KPIs financieros y la proyección de flujo de efectivo."
            >
              ?
            </button>
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingesta de cortes diarios, análisis por turno/canal y desglose de ventas totales.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/sales/mapping">
              <Settings2 className="w-4 h-4 mr-2" /> Plantillas POS
            </Link>
          </Button>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="analytics" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Analítica y KPIs
          </TabsTrigger>
          <TabsTrigger value="cuts" className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" /> Registro de Cortes
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Analytics & KPIs */}
        <TabsContent value="analytics" className="space-y-6">
          <FinancialKpiCards branchId={selectedBranch} />
          <SalesDashboard branchId={selectedBranch} />
        </TabsContent>

        {/* TAB 2: Ingestion & Cuts List */}
        <TabsContent value="cuts" className="space-y-6">
          <SalesCutUpload branches={branches} onUploadSuccess={fetchCuts} />

          {/* Fase 2: alerta de cortes con diferencia (arqueo vs efectivo declarado) */}
          {(() => {
            // Misma fuente de verdad que la celda de la tabla, para que el
            // conteo del banner no pueda discrepar de las filas en rojo.
            const diffCuts = cuts.filter((c) => {
              const arqueo = computeCashVariance(c);
              return arqueo !== null && arqueo.direction !== "cuadrado";
            });
            if (diffCuts.length === 0) return null;
            const byBranch = new Map<string, { id: string; count: number }>();
            for (const c of diffCuts) {
              const prev = byBranch.get(c.branchName);
              byBranch.set(c.branchName, { id: c.branchId, count: (prev?.count ?? 0) + 1 });
            }
            return (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-semibold text-destructive">
                    {diffCuts.length} corte{diffCuts.length !== 1 ? "s" : ""} con diferencia entre efectivo declarado y arqueo
                  </p>
                  {/* El banner nombraba las sucursales y no llevaba a ninguna: la
                      última pantalla que ve una gerente a las 11pm era una
                      acusación sin camino. Ahora cada nombre acota el alcance. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Ir a la sucursal:</span>
                    {Array.from(byBranch.entries()).map(([name, { id, count }]) => (
                      <Button
                        key={id}
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => setSelectedBranchId(id)}
                      >
                        {name} ({count})
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Cuts Table */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" /> Historial de Cortes Registrados
                </CardTitle>

                {/* Los ocho controles que vivían aquí duplicaban el alcance del
                    encabezado. Queda el eco de lo que se está viendo, para que la
                    tabla nunca se lea fuera de contexto. */}
                <p className="text-xs text-muted-foreground">
                  Mostrando <span className="font-medium text-foreground">{scopeLabel}</span>. Cambia
                  el alcance desde los controles del encabezado.
                </p>

                {/* Una lista acotada presentada como completa es una afirmación
                    falsa sobre cuántos cortes hay. Se dice cuántos se ven y
                    cuántos existen, como ya hace Control Interno. */}
                {cutsScope?.truncated && (
                  <p className="text-xs text-warning-text">
                    Se muestran {cuts.length} de {cutsTotal} cortes del período. Acota el rango
                    para ver el resto.
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loadingCuts ? (
                <div className="py-12 flex justify-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando cortes de ventas...
                </div>
              ) : cutsError ? (
                /* Un fallo no es un período sin ventas. Decirlo con la misma
                   pantalla vacía hace que quien mira concluya que no vendió. */
                <EmptyState
                  bare
                  icon={AlertCircle}
                  title="No se pudieron cargar los cortes"
                  description={`${cutsError} Los datos que había en pantalla se retiraron para no mezclarlos con el alcance actual.`}
                  action={
                    <Button variant="outline" size="sm" onClick={() => fetchCuts()}>
                      Reintentar
                    </Button>
                  }
                />
              ) : cuts.length === 0 ? (
                <EmptyState
                  bare
                  icon={Coins}
                  title="No se encontraron cortes de ventas en el período"
                  description="Sube un archivo exportado del POS o recibe cortes por WhatsApp para empezar a registrar la operación diaria."
                />
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableCaption className="sr-only">
                      Cortes de ventas registrados: fecha, sucursal, turno, canal, venta total,
                      formas de pago, tickets, arqueo de caja, origen del dato, estatus de
                      validación y quién lo recibió.
                    </TableCaption>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Fecha</TableHead>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Turno</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead className="text-right">Venta Total</TableHead>
                        <TableHead>Formas de Pago</TableHead>
                        <TableHead className="text-center">Tickets</TableHead>
                        <TableHead>Arqueo/Dif.</TableHead>
                        <TableHead>Origen</TableHead>
                        <TableHead>Estatus</TableHead>
                        <TableHead>Recibido por</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cuts.map((cut) => {
                        const paymentParts = [];
                        if (cut.cashSales !== null) paymentParts.push(`Efectivo: ${formatCents(cut.cashSales)}`);
                        if (cut.cardSales !== null) paymentParts.push(`Tarjeta: ${formatCents(cut.cardSales)}`);
                        if (cut.otherPayments !== null) paymentParts.push(`Otros: ${formatCents(cut.otherPayments)}`);

                        // Fase 2: arqueo = efectivo contado vs. efectivo declarado.
                        // `countedCents` puede existir sin contraparte declarada:
                        // en ese caso hay conteo que mostrar pero no diferencia.
                        const countedCents = cut.cashCountedCents;
                        const arqueo = computeCashVariance(cut);

                        return (
                          <TableRow key={cut.id} className="hover:bg-muted/40 transition">
                            <TableCell className="font-medium whitespace-nowrap">
                              {new Date(cut.businessDate + "T00:00:00").toLocaleDateString("es-MX", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </TableCell>
                            <TableCell className="font-medium">{cut.branchName}</TableCell>
                            {/* El turno es el campo que dice "restaurante": matutino
                                contra vespertino es la pregunta diaria de gerencia.
                                Se le da la misma jerarquía visual que al canal. */}
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-xs capitalize ${statusBadgeClasses(
                                  cut.shift === "MATUTINO" ? "info" : cut.shift === "VESPERTINO" ? "warning" : "neutral"
                                )}`}
                              >
                                {cut.shift.toLowerCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={cut.channel === "TOTAL" ? "secondary" : "outline"} className="text-xs">
                                {CHANNEL_LABELS[cut.channel]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-sm tabular-nums">
                              {formatCents(cut.totalSales)}
                            </TableCell>
                            <TableCell>
                              {paymentParts.length > 0 ? (
                                <div className="text-xs text-muted-foreground flex flex-col gap-0.5">
                                  {paymentParts.map((p, idx) => (
                                    <span key={idx}>{p}</span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center text-sm font-medium">
                              {cut.ticketCount !== null ? cut.ticketCount : <span className="text-muted-foreground/60">—</span>}
                            </TableCell>
                            <TableCell>
                              {countedCents !== null ? (
                                <div className="flex flex-col text-xs">
                                  <span className="text-muted-foreground">
                                    Contado: {formatCents(countedCents)}
                                  </span>
                                  {arqueo === null ? (
                                    <span className="text-muted-foreground/60">
                                      Diferencia: — (sin efectivo declarado)
                                    </span>
                                  ) : (
                                    <span className={`font-semibold ${cashVarianceToneClass(arqueo.direction)}`}>
                                      Diferencia:{" "}
                                      {arqueo.direction === "cuadrado"
                                        ? "cuadrado"
                                        : `${arqueo.varianceCents > 0 ? "+" : ""}${formatCents(arqueo.varianceCents)} (${arqueo.direction})`}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                            <TableCell>{getSourceBadge(cut.source)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {cut.status === "VALIDATED" ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-success font-semibold">
                                    <CheckCircle className="h-3 w-3" /> Validado
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs text-warning-text font-semibold">
                                    <AlertCircle className="h-3 w-3" /> Observación
                                  </span>
                                )}
                                {cut.validationNotes && (
                                  <span className="text-xs text-muted-foreground max-w-[200px] leading-tight block">
                                    {cut.validationNotes}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex flex-col">
                                {/* Sin nombre real se dice que no lo hay: inventar "Sistema"
                                    atribuye la recepción del corte a un actor que no existe. */}
                                {cut.receivedByName ? (
                                  <span className="font-medium text-foreground">{cut.receivedByName}</span>
                                ) : (
                                  <span className="text-muted-foreground/70">Sin registrar</span>
                                )}
                                <span className="text-xs text-muted-foreground/75">
                                  {new Date(cut.receivedAt).toLocaleDateString("es-MX", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fase 3: conciliación por agregador — venta reportada vs. liquidación */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" /> Conciliación por Agregador
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Compara la venta reportada en los cortes contra la liquidación del agregador (que llega neta de comisión). Captura el monto liquidado para ver la varianza.
                <span className="block mt-1 text-xs text-muted-foreground/80">
                  Los montos capturados aquí no se guardan: son una ayuda de cálculo de la sesión y se limpian al cambiar el filtro.
                </span>
              </p>
            </CardHeader>
            <CardContent>
              {/* `key` fuerza el remontaje al cambiar el filtro: sin esto, un monto
                  capturado bajo una sucursal seguía comparándose contra la venta
                  reportada de otra. */}
              <AggregatorConciliation
                key={`${selectedBranch}|${startDate}|${endDate}`}
                cuts={cuts}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Monto liquidado escrito por el usuario → centavos, o `null` si no es una cifra
 * de dinero utilizable.
 *
 * `parseFloat` acepta notación exponencial, así que teclear `1e5` en un
 * `input[type=number]` producía una retención de $100,000 con cuatro teclas.
 * Aquí solo se admiten dígitos con separadores y a lo más dos decimales.
 */
function parseLiquidatedCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function AggregatorConciliation({ cuts }: { cuts: SalesCut[] }) {
  // Sum reported sales per aggregator across the filtered cuts.
  const totals = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const cut of cuts) {
      if (!cut.aggregatorSales) continue;
      for (const [key, value] of Object.entries(cut.aggregatorSales)) {
        acc[key] = (acc[key] ?? 0) + value;
      }
    }
    return acc;
  }, [cuts]);

  const labels: Record<string, string> = {
    rappi: "Rappi",
    uber: "Uber Eats",
    didi: "Didi Food",
    justo: "Justo",
    sindelantal: "Sin Delantal",
    mercadopago: "Mercado Pago",
  };

  const [liquidated, setLiquidated] = useState<Record<string, string>>({});
  const keys = Object.keys(totals);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay ventas por agregador en los cortes del período filtrado. Captura un corte con Rappi/Uber/Didi desde el Smart Link para ver la conciliación.
      </p>
    );
  }

  const hasEntries = Object.values(liquidated).some((v) => v.trim() !== "");

  return (
    <div className="space-y-2">
      {/* Salida del borrador: los montos son de sesión, así que debe poder
          vaciarse sin recargar la página ni cambiar el filtro. */}
      {hasEntries && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => setLiquidated({})}
          >
            Limpiar montos capturados
          </Button>
        </div>
      )}
      <div className="border rounded-md overflow-x-auto">
      <Table>
        <TableCaption className="sr-only">
          Conciliación por agregador: venta reportada en los cortes, liquidación recibida
          capturada por el usuario y retención resultante.
        </TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Agregador</TableHead>
            <TableHead className="text-right">Venta reportada</TableHead>
            <TableHead className="text-right">Liquidación recibida</TableHead>
            <TableHead className="text-right">Retención (comisión y ajustes)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => {
            const reported = totals[key];
            const raw = liquidated[key] ?? "";
            const liquidatedCents = parseLiquidatedCents(raw);
            const valid = liquidatedCents !== null;
            const variance = valid ? reported - liquidatedCents : null;
            const pct = valid && reported > 0 ? ((variance! / reported) * 100).toFixed(1) : null;
            const label = labels[key] ?? key;
            return (
              <TableRow key={key} className="hover:bg-muted/40 transition">
                <TableCell className="font-medium">{label}</TableCell>
                <TableCell className="text-right font-semibold text-sm tabular-nums">
                  {formatCents(reported)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-xs text-muted-foreground" aria-hidden>$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="h-8 w-32 text-xs text-right tabular-nums"
                      aria-label={`Liquidación recibida de ${label}, en pesos`}
                      value={raw}
                      onChange={(e) => setLiquidated((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {valid && variance !== null ? (
                    // `reported > liquidated` es lo ESPERADO: la liquidación llega
                    // neta de comisión. Solo lo inverso (te liquidan más de lo que
                    // vendiste) es una anomalía. Sin una tasa de comisión esperada
                    // en el esquema no hay forma de juzgar si la retención es
                    // excesiva, así que se presenta como dato, no como error.
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${
                        variance < 0 ? "text-warning-text" : "text-foreground"
                      }`}
                    >
                      {variance > 0 ? "+" : ""}
                      {formatCents(variance)}
                      {pct !== null && (
                        <span className="text-xs text-muted-foreground">({pct}%)</span>
                      )}
                      {variance < 0 && (
                        <span className="text-xs font-normal">liquidación &gt; venta</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
