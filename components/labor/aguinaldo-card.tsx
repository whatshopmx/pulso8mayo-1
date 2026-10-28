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
import { Loader2, CheckCircle, AlertCircle, Gift, Banknote, Landmark, Building2, HandCoins } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { formatCents } from "@/lib/utils";
// Cálculo puro (sin DB): la UI recalcula al editar "días a considerar".
import { calcularAguinaldoAnual } from "@/lib/services/aguinaldo-service";
import { calcularPagoAguinaldo, hoyCivilAguinaldo } from "@/lib/services/aguinaldo-payment";

interface AguinaldoRow {
  userId: string;
  name: string;
  rfc: string | null;
  salarioDiarioCents: number;
  /** Task 11: salario efectivo real; formal = igual al registrado. */
  salarioEfectivoCents: number;
  gapSalarioCents: number;
  esFormal: boolean;
  diasCalendario: number;
  diasLaborados: number;
  /** DIA-02: MANUAL sólo si el admin tocó el campo; el resto es propuesta/calendario. */
  fuenteDias?: "MANUAL" | "PROPUESTA_AUDITABLE" | "CALENDARIO";
  diasAutomaticos: number | null;
  /** DIA-02: auditoría de la propuesta (corte, zona, pendientes, proyección). */
  propuestaDias?: {
    desde: string;
    hasta: string;
    fechaCorte: string;
    zona: string;
    diasCalendario: number;
    diasNoComputables: number;
    diasPropuestos: number;
    diasConTurno: number;
    pendientes: number;
    conflictos: number;
    requiereRevision: boolean;
    contieneProyeccion: boolean;
    coberturaFuentes: "PARCIAL";
    fechasNoComputables: string[];
  };
  fechaAntiguedad: string | null;
  calculo: {
    brutoCents: number;
    exentoCents: number;
    gravadoCents: number;
    diasAguinaldo: number;
  } | null;
  diferenciaCents: number;
  error?: string;
}

interface AguinaldoPreview {
  anioFiscal: number;
  fechaPago: string;
  rows: AguinaldoRow[];
  estatusLegal: { fuente: "LEY_VIGENTE" | "PROYECCION"; basis: string; diasLegalesVigente: number };
  aguinaldoDaysMxn: number;
  umaDailyCents: number | null;
  /** Task 11: base configurada del inquilino y práctica de nómina. */
  base: "REGISTERED" | "EFFECTIVE";
  practiceMode: "FORMAL" | "MIXED";
  totalBrutoCents: number;
  totalExentoCents: number;
  totalGravadoCents: number;
  totalDiferenciaCents: number;
  empleadosATimbrar: number;
  empleadosSinRFC: number;
  /** DIA-02: avisos de cobertura/zona; informativos, no bloquean por sí solos. */
  advertenciasDias?: string[];
}

interface DispersionBitacora {
  id: string;
  userName: string | null;
  montoCents: number;
  motivo: string;
  source: string;
  fechaDispersion: string;
}

interface AguinaldoRun {
  id: string;
  aguinaldoFiscalYear: number | null;
  status: string;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  aguinaldoSnapshot?: { version: number; fechaPago: string } | null;
}

interface Branch {
  id: string;
  name: string;
}

export function AguinaldoCard() {
  const currentYear = new Date().getFullYear();
  const [anioFiscal, setAnioFiscal] = useState<number>(currentYear);
  const [fechaPago, setFechaPago] = useState(hoyCivilAguinaldo);
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
  const [recoveringRunId, setRecoveringRunId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ runId: string; message: string; errors: string[] } | null>(null);
  // Task 11 (Q5): dispersión manual del excedente en efectivo (sin CFDI).
  const [dispUserId, setDispUserId] = useState<string>("");
  const [dispMonto, setDispMonto] = useState<string>("");
  const [dispMotivo, setDispMotivo] = useState<string>("");
  const [dispensing, setDispensing] = useState(false);
  const [bitacora, setBitacora] = useState<DispersionBitacora[]>([]);

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

  const cargarPreview = useCallback(async (signal?: AbortSignal) => {
    setLoadingPreview(true);
    setPreview(null);
    try {
      const params = new URLSearchParams({ anioFiscal: String(anioFiscal), fechaPago });
      if (selectedBranch !== "all") params.set("branchId", selectedBranch);
      const res = await fetch(`/api/payroll/aguinaldo?${params.toString()}`, { signal });
      const data = await res.json();
      if (signal?.aborted) return;
      if (res.ok && data.success) {
        const p = data.data as AguinaldoPreview;
        setPreview(p);
        // DIA-02: la propuesta auditable es el valor por omisión; el estado de
        // overrides arranca VACÍO para no enviar como MANUAL lo que nadie tocó.
        setDiasEditados({});
      } else {
        throw new Error(data.error?.message || "Error en la preview de aguinaldo");
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      setPreview(null);
      toast({
        title: "Error de Preview",
        description: err instanceof Error ? err.message : "No se pudo calcular la preview",
        variant: "destructive",
      });
    } finally {
      if (!signal?.aborted) setLoadingPreview(false);
    }
  }, [anioFiscal, selectedBranch, fechaPago, toast]);

  useEffect(() => {
    fetchBranches();
    fetchRuns();
  }, [fetchBranches, fetchRuns]);

  const fetchBitacora = useCallback(async () => {
    try {
      const res = await fetch(`/api/payroll/aguinaldo?anioFiscal=${anioFiscal}&dispersiones=1`);
      const data = await res.json();
      if (res.ok && data.success) {
        setBitacora((data.data.dispersiones ?? []) as DispersionBitacora[]);
      }
    } catch (err) {
      console.error("Error fetching dispersiones:", err);
    }
  }, [anioFiscal]);

  useEffect(() => {
    fetchBitacora();
  }, [fetchBitacora]);

  const handleRecovery = async (run: AguinaldoRun) => {
    if (running || recoveringRunId) return;
    setRecoveringRunId(run.id);
    setRecovery({ runId: run.id, message: "Recuperando con la fecha y los importes autorizados…", errors: [] });
    try {
      const res = await fetch("/api/payroll/aguinaldo", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECOVER", runId: run.id }) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || "No se pudo recuperar la corrida.");
      const results = data.data.results as Array<{ success: boolean; employeeName?: string; error?: string }>;
      const errors = results.filter((result) => !result.success).map((result) => `${result.employeeName ?? "Empleado"}: ${result.error ?? "Requiere revisión."}`);
      setRecovery({ runId: run.id, message: errors.length ? `Recibos por revisar: ${errors.length}.` : "Recuperación completada. Los recibos confirmados se conservaron.", errors });
      await Promise.all([fetchRuns(), fetchBitacora()]);
    } catch (error) {
      setRecovery({ runId: run.id, message: "No se pudo completar la recuperación.", errors: [error instanceof Error ? error.message : "Error de conexión. Puedes volver a consultar la corrida."] });
    } finally { setRecoveringRunId(null); }
  };

  const handleDispersionManual = async () => {
    const montoCents = Math.round(Number(dispMonto) * 100);
    if (!dispUserId || !Number.isFinite(montoCents) || montoCents <= 0 || !dispMotivo.trim()) {
      toast({
        title: "Datos de dispersión incompletos",
        description: "Selecciona empleado, captura un monto mayor a cero y escribe el motivo.",
        variant: "destructive",
      });
      return;
    }
    setDispensing(true);
    try {
      const res = await fetch("/api/payroll/aguinaldo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anioFiscal,
          action: "DISPERSION",
          dispersion: { userId: dispUserId, montoCents, motivo: dispMotivo.trim() },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Error registrando la dispersión en efectivo");
      }
      toast({
        title: "Excedente registrado en bitácora",
        description: "Dispersión en efectivo sin CFDI: queda con empleado, monto, fecha, autorizador y motivo.",
      });
      setDispMonto("");
      setDispMotivo("");
      fetchBitacora();
    } catch (err: unknown) {
      toast({
        title: "No se pudo registrar",
        description: err instanceof Error ? err.message : "Error de dispersión manual",
        variant: "destructive",
      });
    } finally {
      setDispensing(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    cargarPreview(controller.signal);
    return () => controller.abort();
  }, [cargarPreview]);

  const handleEjecutar = async () => {
    if (!preview || loadingPreview || preview.fechaPago !== fechaPago || preview.anioFiscal !== anioFiscal) return;
    setRunning(true);
    try {
      const res = await fetch("/api/payroll/aguinaldo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anioFiscal,
          fechaPago: preview.fechaPago,
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
          // Timbrado ≠ pago: el CFDI 002 acredita la nómina extraordinaria, no
          // la entrega del dinero. La dispersión real se registra aparte.
          title: "Aguinaldo timbrado · pago sin confirmar",
          description: `${ok} CFDI 002 extraordinarios generados (tipo E por año fiscal). El timbre no acredita la entrega del dinero: registra la dispersión cuando haya salido.`,
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

  /** Recalcula localmente la fila al editar los días (el cálculo es puro). */
  const calculoLocal = (row: AguinaldoRow) => {
    if (!preview || !row.calculo) return null;
    const dias = diasEditados[row.userId] ?? row.diasLaborados;
    const calculo = calcularAguinaldoAnual({
      anioFiscal: preview.anioFiscal,
      salarioDiarioCents: row.salarioDiarioCents,
      diasLaborados: dias,
      aguinaldoDaysMxn: preview.aguinaldoDaysMxn,
      umaDailyCents: preview.umaDailyCents,
      base: "REGISTERED",
    });
    const calculoEfectivo = row.esFormal
      ? null
      : calcularAguinaldoAnual({
          anioFiscal: preview.anioFiscal,
          salarioDiarioCents: row.salarioEfectivoCents,
          diasLaborados: dias,
          aguinaldoDaysMxn: preview.aguinaldoDaysMxn,
          umaDailyCents: preview.umaDailyCents,
          base: "EFFECTIVE",
        });
    let pago: ReturnType<typeof calcularPagoAguinaldo> | null = null;
    let error: string | undefined;
    try {
      pago = calcularPagoAguinaldo(calculo, row.salarioDiarioCents, preview.fechaPago);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      calculo,
      pago,
      error,
      brutoEfectivo: calculoEfectivo?.brutoCents ?? null,
      diferencia: calculoEfectivo ? calculoEfectivo.brutoCents - calculo.brutoCents : 0,
    };
  };
  /** DIA-02: un bloqueo por revisión se confirma con el override manual, no se oculta. */
  const revisionConfirmada = (row: AguinaldoRow) =>
    !!row.propuestaDias?.requiereRevision && Object.hasOwn(diasEditados, row.userId);

  const errorFila = (row: AguinaldoRow): string | undefined =>
    calculoLocal(row)?.error
    ?? (row.error && !revisionConfirmada(row) ? row.error : undefined)
    ?? (row.rfc ? undefined : "Falta RFC para timbrar.");

  const rowsTimbrables = preview?.rows.filter((r) => !errorFila(r) && calculoLocal(r)?.pago && r.rfc) ?? [];
  const hayBloqueos = preview?.rows.some((r) => !!errorFila(r) || !r.rfc || !calculoLocal(r)?.pago) ?? true;
  const totales = rowsTimbrables.reduce(
    (acc, r) => {
      const c = calculoLocal(r);
      if (c) {
        acc.bruto += c.calculo.brutoCents;
        acc.exento += c.calculo.exentoCents;
        acc.gravado += c.calculo.gravadoCents;
        acc.deducciones += c.pago?.totalDeduccionesCents ?? 0;
        acc.neto += c.pago?.netoCents ?? 0;
        acc.diferencia += c.diferencia;
      }
      return acc;
    },
    { bruto: 0, exento: 0, gravado: 0, deducciones: 0, neto: 0, diferencia: 0 }
  );

  /** DIA-02: explicación corta de la procedencia de los días de la fila. */
  const textoDias = (row: AguinaldoRow) => {
    const editado = Object.hasOwn(diasEditados, row.userId);
    const p = row.propuestaDias;
    const partes: string[] = [
      editado ? "ajuste manual" : row.fuenteDias === "PROPUESTA_AUDITABLE" ? "propuesta auditable" : "calendario",
    ];
    if (p) {
      partes.push(`calendario ${p.diasCalendario}`);
      if (p.diasNoComputables > 0) partes.push(`−${p.diasNoComputables} no computables`);
      partes.push(`corte ${p.fechaCorte} · ${p.zona}`);
    } else {
      partes.push(`calendario ${row.diasCalendario}`);
    }
    return partes.join(" · ");
  };

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
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">
              Fecha de pago
              <Input type="date" className="h-8 w-40 text-xs" value={fechaPago}
                onChange={(e) => { setPreview(null); setFechaPago(e.target.value); }} disabled={running} />
            </label>
            {preview?.estatusLegal.fuente === "LEY_VIGENTE" ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs font-medium">
                <CheckCircle className="mr-1 h-3 w-3 text-emerald-600" /> Ley vigente: 15 días (Art. 87)
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-xs font-medium">Cálculo NO vigente</Badge>
            )}
            <Select value={selectedBranch} disabled={running} onValueChange={(value) => { setPreview(null); setSelectedBranch(value); }}>
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
            <Select value={String(anioFiscal)} disabled={running} onValueChange={(v) => { setPreview(null); setAnioFiscal(Number(v)); }}>
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
                  <TableHead className="text-xs text-right">Bruto (registro)</TableHead>
                  <TableHead className="text-xs text-right">Exento (30 UMA)</TableHead>
                  <TableHead className="text-xs text-right">Gravado</TableHead>
                  <TableHead className="text-xs text-right">ISR retenido</TableHead>
                  <TableHead className="text-xs text-right">Neto (registro)</TableHead>
                  <TableHead className="text-xs text-right">Bruto (efectivo)</TableHead>
                  <TableHead className="text-xs text-right">{preview?.base === "EFFECTIVE" ? "Excedente en efectivo" : "Liabilidad contingente"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.userId} className="hover:bg-muted/30">
                    <TableCell className="text-xs">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-muted-foreground font-mono">
                        {row.rfc ?? "sin RFC"} · SD {formatCents(row.salarioDiarioCents)}
                        {row.gapSalarioCents !== 0 && (
                          <span className="text-amber-600 dark:text-amber-400" title="Salario efectivo: incluye la parte fuera de nómina">
                            {" ·"} real {formatCents(row.salarioEfectivoCents)} (gap +{formatCents(row.gapSalarioCents)})
                          </span>
                        )}
                      </div>
                      {errorFila(row) && (
                        <div className="text-destructive flex items-start gap-1 mt-0.5">
                          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span className="leading-tight">{errorFila(row)}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {!row.calculo ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          max={366}
                          step={1}
                          disabled={running}
                          className="h-7 w-20 text-xs font-mono text-center mx-auto"
                          value={diasEditados[row.userId] ?? row.diasLaborados}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isInteger(v)) setDiasEditados((prev) => ({ ...prev, [row.userId]: Math.max(0, Math.min(366, v)) }));
                          }}
                          aria-label={`Días a considerar para ${row.name}`}
                        />
                      )}
                      {calculoLocal(row) && (
                        <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
                          = {(calculoLocal(row)!.calculo.diasAguinaldo).toFixed(2)} días agui. ·{" "}
                          <span title={row.propuestaDias?.fechasNoComputables.join(", ")}>{textoDias(row)}</span>
                        </div>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1">
                        {row.propuestaDias?.requiereRevision && (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-medium border-amber-500/50 text-amber-700 dark:text-amber-300"
                            title={`${row.propuestaDias.pendientes} permiso(s) sin clasificar · ${row.propuestaDias.conflictos} conflicto(s)`}
                          >
                            {Object.hasOwn(diasEditados, row.userId) ? "Revisión confirmada manualmente" : "Revisar días"}
                          </Badge>
                        )}
                        {row.propuestaDias?.contieneProyeccion && (
                          <Badge variant="outline" className="text-[10px] font-medium" title="El corte es anterior al cierre del año: los días posteriores no son faltas.">
                            Proyección
                          </Badge>
                        )}
                        {row.propuestaDias?.diasConTurno === 0 && row.propuestaDias.diasNoComputables === 0 && (
                          <Badge variant="outline" className="text-[10px] font-medium" title="Sin turnos capturados: la propuesta usa el calendario, no una lista de faltas.">
                            Sin checadas
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right font-semibold">
                      {calculoLocal(row) ? formatCents(calculoLocal(row)!.calculo.brutoCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right text-emerald-600 dark:text-emerald-400">
                      {calculoLocal(row) ? formatCents(calculoLocal(row)!.calculo.exentoCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right">
                      {calculoLocal(row) ? formatCents(calculoLocal(row)!.calculo.gravadoCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right">
                      {calculoLocal(row)?.pago ? formatCents(calculoLocal(row)!.pago!.totalDeduccionesCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right font-semibold">
                      {calculoLocal(row)?.pago ? formatCents(calculoLocal(row)!.pago!.netoCents) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right">
                      {calculoLocal(row)?.brutoEfectivo != null
                        ? formatCents(calculoLocal(row)!.brutoEfectivo!)
                        : <span className="text-muted-foreground" title="Formal: efectivo = registro">=</span>}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right">
                      {calculoLocal(row) && calculoLocal(row)!.diferencia > 0 ? (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">{formatCents(calculoLocal(row)!.diferencia)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell className="text-xs">Totales ({rowsTimbrables.length} timbrables)</TableCell>
                  <TableCell />
                  <TableCell className="text-xs font-mono text-right font-bold">{formatCents(totales.bruto)}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCents(totales.exento)}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-bold">{formatCents(totales.gravado)}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-bold">{formatCents(totales.deducciones)}</TableCell>
                  <TableCell className="text-xs font-mono text-right font-bold">{formatCents(totales.neto)}</TableCell>
                  <TableCell />
                  <TableCell className="text-xs font-mono text-right font-bold text-amber-600 dark:text-amber-400">{formatCents(totales.diferencia)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>

        {/* Panel de ejecución e historial */}
        <div className="space-y-4">
          {preview && preview.advertenciasDias && preview.advertenciasDias.length > 0 && (
            <div role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-semibold text-foreground">Días propuestos: cobertura y límites</div>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                {preview.advertenciasDias.map((advertencia, index) => (
                  <li key={index}>{advertencia}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" /> Bruto (registro)
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
              <span className="text-muted-foreground">Gravado de ISR</span>
              <span className="font-mono font-medium">{formatCents(totales.gravado)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">ISR retenido (Art. 174)</span>
              <span className="font-mono">{formatCents(totales.deducciones)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold">
              <span>Neto a pagar (registro)</span>
              <span className="font-mono">{formatCents(totales.neto)}</span>
            </div>
            {hayBloqueos && preview && <p role="status" className="text-destructive">Resuelve los bloqueos (incluidos los días por revisar) antes de ejecutar.</p>}
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Timbrables / Sin RFC:</span>
              <span className="font-mono">{preview ? `${rowsTimbrables.length} / ${preview.empleadosSinRFC}` : "—"}</span>
            </div>
            {preview && totales.diferencia > 0 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200">
                {preview.base === "EFFECTIVE" ? (
                  <>
                    <strong>Base EFFECTIVE:</strong> el excedente de {formatCents(totales.diferencia)} se dispersa
                    en efectivo con bitácora; el CFDI 002 sólo cubre la parte registrada.
                  </>
                ) : (
                  <>
                    <strong>Base REGISTERED:</strong> gap de {formatCents(totales.diferencia)} NO se paga:
                    liabilidad contingente (prescripción 1 año, LFT art. 516; base real: J. 1a./J. 24/2023).
                  </>
                )}
              </div>
            )}
            <Button
              onClick={handleEjecutar}
              className="w-full text-xs font-semibold h-9 mt-1"
              disabled={running || !!recoveringRunId || loadingPreview || !preview || preview.fechaPago !== fechaPago || hayBloqueos || rowsTimbrables.length === 0}
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

          {/* Task 11 (Q5): dispersión manual del excedente (sin CFDI), sólo base EFFECTIVE */}
          {preview?.base === "EFFECTIVE" && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <HandCoins className="h-3.5 w-3.5" /> Excedente en efectivo (bitácora, sin CFDI)
              </div>
              <p className="text-muted-foreground leading-tight">
                La parte del aguinado que excede lo timbrable se paga fuera de nómina y queda
                registrada con fecha, autorizador y motivo. Nunca se disfraza de percepción timbrada.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Select value={dispUserId} onValueChange={setDispUserId}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Empleado" />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.rows.map((r) => (
                      <SelectItem key={r.userId} value={r.userId}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-7 text-xs font-mono"
                  placeholder="Monto (MXN)"
                  value={dispMonto}
                  onChange={(e) => setDispMonto(e.target.value)}
                  aria-label="Monto de la dispersión en pesos"
                />
              </div>
              <Input
                className="h-7 text-xs"
                placeholder="Motivo (obligatorio) — p. ej. aguinado real pagado fuera de nómina"
                value={dispMotivo}
                onChange={(e) => setDispMotivo(e.target.value)}
                aria-label="Motivo de la dispersión"
              />
              <Button
                onClick={handleDispersionManual}
                className="w-full text-xs font-semibold h-8"
                variant="outline"
                disabled={dispensing}
              >
                {dispensing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Registrar en bitácora
              </Button>
              {bitacora.length > 0 && (
                <div className="max-h-32 overflow-y-auto divide-y divide-border border border-border rounded">
                  {bitacora.map((b) => (
                    <div key={b.id} className="px-2 py-1.5 flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-semibold">{formatCents(b.montoCents)} · {b.userName ?? b.id}</div>
                        <div className="text-xs text-muted-foreground leading-tight">{b.motivo}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {format(new Date(`${b.fechaDispersion.slice(0, 19)}Z`), "dd MMM yyyy", { locale: es })} · {b.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
                  <div key={r.id} className="px-3 py-2 space-y-2 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-semibold">{r.aguinaldoFiscalYear} ({format(new Date(`${r.createdAt.slice(0, 10)}T12:00:00Z`), "dd MMM yyyy", { locale: es })})</div>
                      <div className="text-muted-foreground font-mono">{r.periodStart} – {r.periodEnd}</div>
                      {r.aguinaldoSnapshot && <div className="text-muted-foreground">Pago autorizado: {r.aguinaldoSnapshot.fechaPago}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={
                        r.status === "COMPLETED"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0 text-xs"
                      }
                    >
                      {r.status === "COMPLETED" ? "Exitoso" : r.status === "COMPLETED_WITH_ERRORS" ? "Con errores" : r.status}
                    </Badge>
                    {r.status !== "COMPLETED" && r.aguinaldoSnapshot?.version === 1 && <Button variant="outline" size="sm"
                      className="text-xs" disabled={running || !!recoveringRunId}
                      aria-label={`${recoveringRunId === r.id ? "Recuperando" : "Recuperar"} corrida ${r.aguinaldoFiscalYear}`}
                      onClick={() => handleRecovery(r)}>
                      {recoveringRunId === r.id && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                      {recoveringRunId === r.id ? "Recuperando…" : "Recuperar"}
                    </Button>}
                    </div>
                    </div>
                    {recovery?.runId === r.id && <div role="status" aria-live="polite" className="space-y-1 break-words text-muted-foreground">
                      <p>{recovery.message}</p>
                      {recovery.errors.length > 0 && <ul className="list-disc space-y-1 pl-4 text-destructive">
                        {recovery.errors.map((error, index) => <li key={index}>{error}</li>)}
                      </ul>}
                    </div>}
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
