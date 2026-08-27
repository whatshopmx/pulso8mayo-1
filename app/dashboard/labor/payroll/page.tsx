"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  Calculator, 
  ShieldAlert, 
  UserX, 
  Percent, 
  DollarSign, 
  FileCheck2 
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
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
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationData, setValidationData] = useState<ValidationData | null>(null);
  const [running, setRunning] = useState(false);
  
  const { toast } = useToast();

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
    fetchRuns();
  }, [fetchRuns]);

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
        body: JSON.stringify({ startDate, endDate }),
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
    } catch (err: any) {
      toast({
        title: "Error de Validación",
        description: err.message,
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
        body: JSON.stringify({ startDate, endDate })
      });
      const data = await res.json();
      
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Error ejecutando nómina");
      }
      
      const hasErrors = data.data.results.some((r: any) => !r.success);
      
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
    } catch (err: any) {
      toast({
        title: "Bloqueo de Ejecución",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nómina y Timbrado (CFDI)</h1>
        <p className="text-muted-foreground mt-2">
          Calcula la nómina sumando sueldo base y propinas auditadas, y genera los recibos timbrados (Art. 346 LFT).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Nuevo Cálculo
            </CardTitle>
            <CardDescription>Generar nómina para un periodo</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRunPayroll} className="space-y-4">
              <div className="space-y-2">
                <Label>Fecha Inicio</Label>
                <Input 
                  type="date" 
                  required 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha Fin</Label>
                <Input 
                  type="date" 
                  required 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-full text-xs font-semibold gap-1.5"
                  onClick={handleValidate}
                  disabled={validating || !startDate || !endDate}
                >
                  {validating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Auditando Checador...
                    </>
                  ) : (
                    <>
                      <FileCheck2 className="h-3.5 w-3.5 text-primary" />
                      1. Validar Pre-Timbrado & Checador
                    </>
                  )}
                </Button>
              </div>

              {validationData && (
                <div className="space-y-3 pt-2 border-t text-xs">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Resultado Auditoría:</span>
                    {validationData.canStamp ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="mr-1 h-3 w-3" /> Aprobada para Timbrar
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <ShieldAlert className="h-3 w-3" /> {validationData.blockingErrorsCount} Bloqueos
                      </Badge>
                    )}
                  </div>

                  <div className="bg-muted/40 p-2.5 rounded-lg space-y-1.5 border">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Empleados Activos:</span>
                      <span className="font-semibold">{validationData.totalActiveEmployees}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Verificados sin Incidencia:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {validationData.verifiedEmployees} / {validationData.totalActiveEmployees}
                      </span>
                    </div>
                    <div className="flex justify-between border-t pt-1">
                      <span className="text-muted-foreground">Sueldo Bruto Nómina:</span>
                      <span className="font-medium">${formatCents(validationData.financialSummary.totalGrossSalaryCents)}</span>
                    </div>
                    <div className="flex justify-between text-amber-700 dark:text-amber-400 font-medium">
                      <span>Carga Social Real Patronal (IMSS/ISN ~35%):</span>
                      <span>+${formatCents(validationData.financialSummary.totalEmployerSocialSecurityCents)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-1 font-bold text-foreground">
                      <span>Costo Laboral Total Empresa:</span>
                      <span>${formatCents(validationData.financialSummary.totalRealLaborCostCents)}</span>
                    </div>
                  </div>

                  {validationData.validationErrors.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      <p className="font-semibold text-destructive flex items-center gap-1">
                        <UserX className="h-3.5 w-3.5" /> Incidencias del Checador / RFC:
                      </p>
                      {validationData.validationErrors.map((err, i) => (
                        <div key={i} className="bg-destructive/10 p-1.5 rounded border border-destructive/20 text-[11px] leading-tight">
                          <span className="font-bold">{err.employeeName}:</span> {err.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full" 
                disabled={running || (validationData ? !validationData.canStamp : false)}
              >
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando y Timbrando...
                  </>
                ) : (
                  "2. Ejecutar y Timbrar Nómina"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Historial de Procesos</CardTitle>
            <CardDescription>Registros de cálculo de nómina y estado del CFDI.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center p-8 border border-dashed rounded-md text-muted-foreground">
                No hay nóminas generadas.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Periodo</TableHead>
                      <TableHead>Fecha Ejecución</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">
                          {format(new Date(run.periodStart), "dd MMM", { locale: es })} - {" "}
                          {format(new Date(run.periodEnd), "dd MMM yyyy", { locale: es })}
                        </TableCell>
                        <TableCell>
                          {format(new Date(run.createdAt), "dd MMM yyyy HH:mm", { locale: es })}
                        </TableCell>
                        <TableCell>
                          {run.status === 'COMPLETED' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                              <CheckCircle className="mr-1 h-3 w-3" /> Exitoso
                            </Badge>
                          ) : run.status === 'COMPLETED_WITH_ERRORS' ? (
                            <Badge variant="destructive">
                              Con Errores
                            </Badge>
                          ) : (
                            <Badge variant="secondary">{run.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm">Ver Detalles</Button>
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
    </div>
  );
}
