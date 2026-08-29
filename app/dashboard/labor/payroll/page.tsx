"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Loader2, 
  CheckCircle, 
  Calculator, 
  ShieldAlert, 
  UserX, 
  FileCheck2,
  Building2,
  Receipt,
  FileText
} from "lucide-react";
import { format, endOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { formatCents } from "@/lib/utils";

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
}

interface Payslip {
  id: string;
  userId: string;
  userName: string;
  baseSalaryCents: number;
  propinasCents: number;
  totalPercepcionesCents: number;
  cfdiUuid?: string;
  cfdiStatus: string;
}

interface ValidationData {
  canStamp: boolean;
  totalActiveEmployees: number;
  verifiedEmployees: number;
  blockingErrorsCount: number;
  validationErrors: Array<{
    userId: string;
    employeeName: string;
    error: string;
    code: string;
    severity: "BLOCKING" | "WARNING";
  }>;
  financialSummary: {
    totalGrossSalaryCents: number;
    totalTipsCents: number;
    totalEmployerSocialSecurityCents: number;
    totalRealLaborCostCents: number;
  };
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationData, setValidationData] = useState<ValidationData | null>(null);
  const [running, setRunning] = useState(false);

  // Payslip detail modal
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loadingPayslips, setLoadingPayslips] = useState(false);
  
  const { toast } = useToast();

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/branches");
      if (res.ok) {
        const data = await res.json();
        setBranches(data.data || data.branches || data || []);
      }
    } catch (err) {
      console.error("Error fetching branches:", err);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/payroll");
      const data = await res.json();
      if (res.ok && data.success) {
        setRuns(data.data || []);
      }
    } catch (err) {
      console.error("Error fetching payroll runs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
    fetchRuns();
  }, [fetchBranches, fetchRuns]);

  // Preset helpers for Mexican payroll cycles
  const applyPreset = (preset: "Q1" | "Q2" | "PREV_Q" | "LAST_WEEK") => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (preset === "Q1") {
      const start = new Date(year, month, 1);
      const end = new Date(year, month, 15);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    } else if (preset === "Q2") {
      const start = new Date(year, month, 16);
      const end = endOfMonth(now);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    } else if (preset === "PREV_Q") {
      const currentDay = now.getDate();
      if (currentDay <= 15) {
        const prevMonth = subMonths(now, 1);
        const start = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 16);
        const end = endOfMonth(prevMonth);
        setStartDate(start.toISOString().split("T")[0]);
        setEndDate(end.toISOString().split("T")[0]);
      } else {
        const start = new Date(year, month, 1);
        const end = new Date(year, month, 15);
        setStartDate(start.toISOString().split("T")[0]);
        setEndDate(end.toISOString().split("T")[0]);
      }
    } else if (preset === "LAST_WEEK") {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 7);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end.toISOString().split("T")[0]);
    }
    setValidationData(null);
  };

  const handleValidate = async () => {
    if (!startDate || !endDate) {
      toast({
        title: "Fechas requeridas",
        description: "Ingresa la fecha de inicio y fin del periodo a validar.",
        variant: "destructive",
      });
      return;
    }

    setValidating(true);
    try {
      const res = await fetch("/api/payroll/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          startDate, 
          endDate,
          branchId: selectedBranch !== "all" ? selectedBranch : undefined 
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setValidationData(data.data);
        if (data.data.canStamp) {
          toast({
            title: "Auditoría de Checador Aprobada",
            description: `Se verificaron ${data.data.verifiedEmployees} empleados sin incidencias bloqueantes.`,
          });
        } else {
          toast({
            title: "Incidencias Detectadas",
            description: `Se encontraron ${data.data.blockingErrorsCount} errores que bloquean el timbrado.`,
            variant: "destructive",
          });
        }
      } else {
        throw new Error(data.error?.message || "Error al validar nómina");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al validar nómina";
      toast({
        title: "Error de Validación",
        description: message,
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  const handleRunPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    
    setRunning(true);
    try {
      const res = await fetch("/api/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          startDate, 
          endDate,
          branchId: selectedBranch !== "all" ? selectedBranch : undefined
        })
      });
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Error ejecutando nómina");
      }
      
      const hasErrors = data.data.results?.some((r: { success?: boolean }) => !r.success);
      
      if (hasErrors) {
        toast({
          title: "Proceso completado con advertencias",
          description: "Algunos recibos presentaron advertencias fiscales.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Nómina timbrada exitosamente",
          description: "Los recibos CFDI 4.0 han sido generados y sellados.",
        });
      }
      
      fetchRuns();
      setValidationData(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error ejecutando nómina";
      toast({
        title: "Bloqueo de Ejecución",
        description: message,
        variant: "destructive"
      });
    } finally {
      setRunning(false);
    }
  };

  const handleOpenDetails = async (run: PayrollRun) => {
    setSelectedRun(run);
    setLoadingPayslips(true);
    try {
      const res = await fetch(`/api/payroll/${run.id}/payslips`);
      const data = await res.json();
      if (res.ok && data.success) {
        setPayslips(data.data || []);
      } else {
        setPayslips([]);
      }
    } catch (err) {
      console.error("Error fetching payslips:", err);
      setPayslips([]);
    } finally {
      setLoadingPayslips(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Nómina y Timbrado (CFDI 4.0)</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Auditoría de checador, cálculo de propinas (Art. 346 LFT), carga patronal IMSS/ISN y timbrado fiscal
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Payroll Form */}
        <Card className="md:col-span-1 border border-border bg-card">
          <CardHeader className="p-4 border-b border-border">
            <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Nuevo Cálculo de Periodo
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Selecciona el periodo y valida antes de timbrar
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Quincenal Presets */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Atajos de Periodo (México)</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs font-medium"
                  onClick={() => applyPreset("Q1")}
                >
                  1ª Quincena (1-15)
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs font-medium"
                  onClick={() => applyPreset("Q2")}
                >
                  2ª Quincena (16-Fin)
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs font-medium"
                  onClick={() => applyPreset("PREV_Q")}
                >
                  Quincena Anterior
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs font-medium"
                  onClick={() => applyPreset("LAST_WEEK")}
                >
                  Semana Pasada
                </Button>
              </div>
            </div>

            <form onSubmit={handleRunPayroll} className="space-y-3.5">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-foreground">Sucursal</Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger className="h-8 text-xs">
                    <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue placeholder="Todas las sucursales" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las sucursales</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-foreground">Fecha Inicio</Label>
                  <Input 
                    type="date" 
                    required 
                    className="h-8 text-xs font-mono"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setValidationData(null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-foreground">Fecha Fin</Label>
                  <Input 
                    type="date" 
                    required 
                    className="h-8 text-xs font-mono"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setValidationData(null);
                    }}
                  />
                </div>
              </div>
              
              <Button 
                type="button" 
                variant="outline" 
                className="w-full text-xs font-semibold gap-1.5 h-8"
                onClick={handleValidate}
                disabled={validating || !startDate || !endDate}
              >
                {validating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    Auditando Checador...
                  </>
                ) : (
                  <>
                    <FileCheck2 className="h-3.5 w-3.5 text-primary" />
                    1. Validar Pre-Timbrado & Checador
                  </>
                )}
              </Button>

              {/* Validation Summary */}
              {validationData && (
                <div className="space-y-3 pt-2 border-t border-border text-xs">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Resultado Auditoría:</span>
                    {validationData.canStamp ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs font-medium">
                        <CheckCircle className="mr-1 h-3 w-3 text-emerald-600" /> Aprobada para Timbrar
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs font-medium gap-1">
                        <ShieldAlert className="h-3 w-3" /> {validationData.blockingErrorsCount} Bloqueos
                      </Badge>
                    )}
                  </div>

                  <div className="bg-muted/40 p-2.5 rounded-lg space-y-1.5 border border-border">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Empleados Activos:</span>
                      <span className="font-mono font-semibold">{validationData.totalActiveEmployees}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Verificados sin Incidencia:</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {validationData.verifiedEmployees} / {validationData.totalActiveEmployees}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1">
                      <span className="text-muted-foreground">Sueldo Bruto:</span>
                      <span className="font-mono font-medium">${formatCents(validationData.financialSummary.totalGrossSalaryCents)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Propinas Auditadas (Art. 346):</span>
                      <span className="font-mono font-medium text-primary">+${formatCents(validationData.financialSummary.totalTipsCents)}</span>
                    </div>
                    <div className="flex justify-between text-amber-700 dark:text-amber-300 font-medium">
                      <span>Carga Social Patronal (~35%):</span>
                      <span className="font-mono">+${formatCents(validationData.financialSummary.totalEmployerSocialSecurityCents)}</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1 font-bold text-foreground">
                      <span>Costo Laboral Total:</span>
                      <span className="font-mono text-primary">${formatCents(validationData.financialSummary.totalRealLaborCostCents)}</span>
                    </div>
                  </div>

                  {validationData.validationErrors.length > 0 && (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      <p className="font-semibold text-destructive flex items-center gap-1">
                        <UserX className="h-3.5 w-3.5" /> Incidencias del Checador / RFC:
                      </p>
                      {validationData.validationErrors.map((err, i) => (
                        <div key={i} className="bg-destructive/10 p-1.5 rounded border border-destructive/20 text-xs leading-tight">
                          <span className="font-bold">{err.employeeName}:</span> {err.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full text-xs font-semibold h-9" 
                disabled={running || (validationData ? !validationData.canStamp : false)}
              >
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando y Timbrando CFDI...
                  </>
                ) : (
                  "2. Ejecutar y Timbrar Nómina"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* History Table */}
        <Card className="md:col-span-2 border border-border bg-card">
          <CardHeader className="p-4 border-b border-border">
            <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              Historial de Nóminas y Timbrado
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Registros de cálculo de nómina y estado del timbrado fiscal ante el SAT
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center p-12 space-y-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Cargando historial de nóminas...</p>
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center p-12 border border-dashed rounded-md text-xs text-muted-foreground">
                No hay nóminas generadas.
              </div>
            ) : (
              <div className="rounded-md border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs">Periodo</TableHead>
                      <TableHead className="text-xs">Fecha Ejecución</TableHead>
                      <TableHead className="text-xs">Estado CFDI</TableHead>
                      <TableHead className="text-xs text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-semibold font-mono">
                          {format(new Date(run.periodStart), "dd MMM", { locale: es })} - {" "}
                          {format(new Date(run.periodEnd), "dd MMM yyyy", { locale: es })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {format(new Date(run.createdAt), "dd MMM yyyy HH:mm", { locale: es })}
                        </TableCell>
                        <TableCell className="text-xs">
                          {run.status === 'COMPLETED' ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs font-medium">
                              <CheckCircle className="mr-1 h-3 w-3 text-emerald-600" /> Exitoso
                            </Badge>
                          ) : run.status === 'COMPLETED_WITH_ERRORS' ? (
                            <Badge variant="destructive" className="text-xs font-medium">
                              Con Errores
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">{run.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 text-xs"
                            onClick={() => handleOpenDetails(run)}
                          >
                            Ver Detalles
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payslip Details Modal */}
      <Dialog open={!!selectedRun} onOpenChange={(open) => !open && setSelectedRun(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Recibos de Nómina Timbrados
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {selectedRun && (
                <>
                  Periodo: {format(new Date(selectedRun.periodStart), "dd MMM yyyy", { locale: es })} al {format(new Date(selectedRun.periodEnd), "dd MMM yyyy", { locale: es })}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {loadingPayslips ? (
            <div className="flex flex-col items-center justify-center p-8 space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Cargando recibos timbrados...</p>
            </div>
          ) : payslips.length === 0 ? (
            <div className="p-8 text-center border border-dashed rounded-lg text-xs text-muted-foreground">
              No se encontraron recibos asociados a esta corrida.
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-x-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">Empleado</TableHead>
                    <TableHead className="text-xs text-right">Sueldo Base</TableHead>
                    <TableHead className="text-xs text-right">Propinas (Art. 346)</TableHead>
                    <TableHead className="text-xs text-right">Total Percepciones</TableHead>
                    <TableHead className="text-xs text-center">Estado Fiscal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-semibold">{p.userName}</TableCell>
                      <TableCell className="text-xs font-mono text-right">${formatCents(p.baseSalaryCents)}</TableCell>
                      <TableCell className="text-xs font-mono text-right text-primary">+${formatCents(p.propinasCents)}</TableCell>
                      <TableCell className="text-xs font-mono text-right font-bold">${formatCents(p.totalPercepcionesCents)}</TableCell>
                      <TableCell className="text-xs text-center">
                        {p.cfdiStatus === "STAMPED" ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 text-xs">
                            <CheckCircle className="h-3 w-3 mr-1 text-emerald-600" /> Sellado SAT
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {p.cfdiStatus || "PENDIENTE"}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
