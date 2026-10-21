"use client";

/**
 * Bloque "Aguinaldo {año}" del módulo de nómina (Task 7 del plan
 * tasks/plan-aguinaldo.md): preview por empleado con la columna editable
 * "días a considerar", dispersión extraordinaria (c_TipoNomina E, CFDI 002),
 * historial de runs de aguinaldo y el estatus legal del cálculo [H04] — la
 * iniciativa de 30 días por antigüedad se muestra siempre como NO vigente.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle, AlertCircle, Gift, Banknote, Landmark, Building2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { formatCents } from "@/lib/utils";
// Cálculo puro (sin DB): la UI recalcula al editar "días a considerar".
import { calcularAguinaldoAnual } from "@/lib/services/aguinaldo-service";

interface AguinaldoRow {
  userId: string;
  name: string;
  rfc: string | null;
  salarioDiarioCents: number;
  diasCalendario: number;
  diasLaborados: number;
  fechaAntiguedad: string | null;
  calculo: {
    brutoCents: number;
    exentoCents: number;
    gravadoCents: number;
    diasAguinaldo: number;
  } | null;
  error?: string;
}

interface AguinaldoPreview {
  anioFiscal: number;
  rows: AguinaldoRow[];
  estatusLegal: { fuente: "LEY_VIGENTE" | "PROYECCION"; basis: string; diasLegalesVigente: number };
  aguinaldoDaysMxn: number;
  umaDailyCents: number | null;
  totalBrutoCents: number;
  totalExentoCents: number;
  totalGravadoCents: number;
  empleadosATimbrar: number;
  empleadosSinRFC: number;
}

interface AguinaldoRun {
  id: string;
  aguinaldoFiscalYear: number | null;
  status: string;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
}

interface Branch {
  id: string;
  name: string;
}

export function AguinaldoCard() {
  const currentYear = new Date().getFullYear();
  const [anioFiscal, setAnioFiscal] = useState<number>(currentYear);
  const anios = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  const [preview, setPreview] = useState<AguinaldoPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  /** Ajuste manual de "días a considerar" por empleado (criterio PROFEDET). */
  const [diasEditados, setDiasEditados] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<AguinaldoRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  const { toast } = useToast();

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/branches");
      const data = await res.json();
      if (res.ok) setBranches(data.data || data.branches || data || []);
    } catch (err) {
      console.error("Error fetching branches:", err);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/payroll");
      const data = await res.json();
      if (res.ok && data.success) {
        setRuns(((data.data || []) as AguinaldoRun[]).filter((r) => r.aguinaldoFiscalYear != null));
      }
    } catch (err) {
      console.error("Error fetching aguinaldo runs:", err);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const cargarPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({ anioFiscal: String(anioFiscal) });
      if (selectedBranch !== "all") params.set("branchId", selectedBranch);
      const res = await fetch(`/api/payroll/aguinaldo?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const p = data.data as AguinaldoPreview;
        setPreview(p);
        setDiasEditados(
          Object.fromEntries(p.rows.filter((r) => !r.error).map((r) => [r.userId, r.diasLaborados]))
        );
      } else {
        throw new Error(data.error?.message || "Error en la preview de aguinaldo");
      }
    } catch (err: unknown) {
      setPreview(null);
      toast({
        title: "Error de Preview",
        description: err instanceof Error ? err.message : "No se pudo calcular la preview",
        variant: "destructive",
      });
    } finally {
      setLoadingPreview(false);
    }
  }, [anioFiscal, selectedBranch, toast]);

  useEffect(() => {
    fetchBranches();
    fetchRuns();
  }, [fetchBranches, fetchRuns]);

  useEffect(() => {
    cargarPreview();
  }, [cargarPreview]);

  const handleEjecutar = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/payroll/aguinaldo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anioFiscal,
          branchId: selectedBranch !== "all" ? selectedBranch : undefined,
          diasLaboradosPorUsuario: Object.keys(diasEditados).length > 0 ? diasEditados : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Error ejecutando la dispersión de aguinaldo");
      }

      const results = data.data.results as Array<{ success?: boolean; error?: string }>;
      const ok = results.filter((r) => r.success).length;
      const fallos = results.filter((r) => !r.success);

      if (fallos.length > 0) {
        toast({
          title: `${ok} recibos timbrados, con errores`,
          description: fallos.map((f) => f.error).slice(0, 3).join(" · ") || "Timbrado incompleto",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Aguinaldo disperso y timbrado",
          description: `${ok} CFDI 002 extraordinarios generados (tipo E por año fiscal).`,
        });
      }

      if (data.data.windowWarning) {
        setTimeout(() => {
          toast({ title: "Fuera de ventana de diciembre", description: data.data.windowWarning });
        }, 400);
      }

      fetchRuns();
    } catch (err: unknown) {
      toast({
        title: "Bloqueo de Dispersión",
        description: err instanceof Error ? err.message : "Error ejecutando el run de aguinaldo",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const rowsTimbrables = preview?.rows.filter((r) => !r.error) ?? [];

  /** Recalcula localmente la fila al editar los días (el cálculo es puro). */
  const calculoLocal = (row: AguinaldoRow) => {
    if (!preview || row.error) return null;
    const dias = diasEditados[row.userId] ?? row.diasLaborados;
    return calcularAguinaldoAnual({
      anioFiscal: preview.anioFiscal,
      salarioDiarioCents: row.salarioDiarioCents,
      diasLaborados: dias || undefined,
      aguinaldoDaysMxn: preview.aguinaldoDaysMxn,
      umaDailyCents: preview.umaDailyCents,
    });
  };
  const totales = rowsTimbrables.reduce(
    (acc, r) => {
      const c = calculoLocal(r);
      if (c) {
        acc.bruto += c.brutoCents;
        acc.exento += c.exentoCents;
        acc.gravado += c.gravadoCents;
      }
      return acc;
    },
    { bruto: 0, exento: 0, gravado: 0 }
  );

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="p-4 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Aguinaldo {anioFiscal} · CFDI 002 (Nómina Extraordinaria)
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Art. 87 LFT: 15 días por año, prorrateados por tiempo trabajado en el año · límite de dispersión: 19-dic
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {preview?.estatusLegal.fuente === "LEY_VIGENTE" ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs font-medium">
                <CheckCircle className="mr-1 h-3 w-3 text-emerald-600" /> Ley vigente: 15 días (Art. 87)
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-xs font-medium">Cálculo NO vigente</Badge>
            )}
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Todas las sucursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(anioFiscal)} onValueChange={(v) => setAnioFiscal(Number(v))}>
              <SelectTrigger className="h-7 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anios.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    Aguinaldo {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* [H04]: la iniciativa en el catálogo nunca se minimiza */}
        <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
          30 días por antigüedad: NO vigente (solo iniciativa ante el Congreso). Los cálculos a 15 días son los únicos
          legales; cualquier proyección a 30 días es estimación, no desembolso.
        </p>
      </CardHeader>
      <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tabla preview */}
        <div className="lg:col-span-2 rounded-md border border-border overflow-x-auto">
          {loadingPreview ? (
            <div className="flex flex-col items-center justify-center p-10 space-y-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Calculando aguinaldo por empleado...</p>
            </div>
          ) : !preview ? (
            <div className="text-center p-10 border border-dashed text-xs text-muted-foreground">
              No hay preview disponible.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Empleado</TableHead>
                  <TableHead className="text-xs text-center">Días a considerar</TableHead>
                  <TableHead className="text-xs text-right">Bruto</TableHead>
                  <TableHead className="text-xs text-right">Exento (30 UMA)</TableHead>
                  <TableHead className="text-xs text-right">Gravado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.userId} className="hover:bg-muted/30">
                    <TableCell className="text-xs">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-muted-foreground font-mono">
                        {row.rfc ?? "sin RFC"} · SD {formatCents(row.salarioDiarioCents)}
                      </div>
                      {row.error && (
                        <div className="text-destructive flex items-start gap-1 mt-0.5">
                          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="leading-tight">{row.error}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.error ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          max={366}
                          className="h-7 w-20 text-xs font-mono text-center mx-auto"
                          value={diasEditados[row.userId] ?? row.diasLaborados}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isNaN(v)) setDiasEditados((prev) => ({ ...prev, [row.userId]: Math.max(0, Math.min(366, v)) }));
                          }}
                          aria-label={`Días a considerar para ${row.name}`}
                        />
                      )}
                      {calculoLocal(row) && !row.error && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          = {(calculoLocal(row)!.diasAguinaldo).toFixed(2)} días agui. · calendario {row.diasCalendario}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right font-semibold">
                      {calculoLocal(row) ? formatCents(calculoLocal(row)!.brutoCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right text-emerald-600 dark:text-emerald-400">
                      {calculoLocal(row) ? formatCents(calculoLocal(row)!.exentoCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right">
                      {calculoLocal(row) ? formatCents(calculoLocal(row)!.gravadoCents) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell className="text-xs">Totales ({rowsTimbrables.length} timbrables)</TableCell>
                  <TableCell />
                  <TableCell className="text-xs font-mono text-right font-bold">{formatCents(totales.bruto)}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCents(totales.exento)}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-bold">{formatCents(totales.gravado)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>

        {/* Panel de ejecución e historial */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" /> Total a dispersar (bruto)
              </span>
              <span className="font-mono font-bold text-foreground">{formatCents(totales.bruto)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Landmark className="h-3.5 w-3.5" /> Exento (cap 30 UMA {preview?.umaDailyCents ? `· UMA ${formatCents(preview.umaDailyCents)}` : ""})
              </span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatCents(totales.exento)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Gravado de ISR (retención: futura, Art. 174 RLISR)</span>
              <span className="font-mono font-medium">{formatCents(totales.gravado)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Timbrables / Sin RFC:</span>
              <span className="font-mono">{preview ? `${preview.empleadosATimbrar} / ${preview.empleadosSinRFC}` : "—"}</span>
            </div>
            <Button
              onClick={handleEjecutar}
              className="w-full text-xs font-semibold h-9 mt-1"
              disabled={running || !preview || preview.empleadosATimbrar === 0}
            >
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Timbrando CFDI 002...
                </>
              ) : (
                `Ejecutar Dispersión ${anioFiscal}`
              )}
            </Button>
          </div>

          <div className="rounded-md border border-border">
            <div className="px-3 py-2 border-b border-border text-xs font-bold text-foreground">
              Historial de Runs de Aguinaldo
            </div>
            {loadingRuns ? (
              <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando...
              </div>
            ) : runs.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">No hay runs de aguinaldo.</div>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-border">
                {runs.map((r) => (
                  <div key={r.id} className="px-3 py-2 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono font-semibold">{r.aguinaldoFiscalYear} ({format(new Date(`${r.createdAt.slice(0, 10)}T12:00:00Z`), "dd MMM yyyy", { locale: es })})</div>
                      <div className="text-muted-foreground font-mono">{r.periodStart} – {r.periodEnd}</div>
                    </div>
                    <Badge
                      className={
                        r.status === "COMPLETED"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0 text-xs"
                      }
                    >
                      {r.status === "COMPLETED" ? "Exitoso" : r.status === "COMPLETED_WITH_ERRORS" ? "Con errores" : r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
