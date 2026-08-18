"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, CheckCircle, Calculator } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
}

export default function PayrollPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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
          title: "Proceso completado con errores",
          description: "Algunos empleados no se timbraron (ej. falta RFC). Revisa el detalle.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Nómina procesada",
          description: "El timbrado de CFDI se ejecutó exitosamente.",
        });
      }
      
      fetchRuns();
    } catch (err: any) {
      toast({
        title: "Error",
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
              
              <Alert className="bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border-amber-200">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Validación Pre-Vuelo</AlertTitle>
                <AlertDescription className="text-xs mt-1">
                  Los empleados deben tener configurado su <strong>RFC</strong> en su expediente antes de ejecutar. El proceso fallará para aquellos sin RFC.
                </AlertDescription>
              </Alert>

              <Button type="submit" className="w-full" disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando y Timbrando...
                  </>
                ) : (
                  "Ejecutar y Timbrar Nómina"
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
