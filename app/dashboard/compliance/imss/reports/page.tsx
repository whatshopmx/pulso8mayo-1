"use client"

import { PageHeader } from "@/components/shared";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileDown, Calendar, TrendingUp, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { SUAFileGenerator } from "@/components/compliance/sua-file-generator";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

interface IMSSReport {
  id: string;
  type: string;
  period: string;
  generatedAt: string;
  status: string;
  employeeCount: number;
}

interface IMSSStats {
  suaCount: number;
  idseCount: number;
  totalContributions: number;
  complianceRate: number;
}

export default function IMSSReportsPage() {
  const [reports, setReports] = useState<IMSSReport[]>([]);
  const [stats, setStats] = useState<IMSSStats>({
    suaCount: 0,
    idseCount: 0,
    totalContributions: 0,
    complianceRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [generatingIdse, setGeneratingIdse] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [altasRes, bajasRes] = await Promise.all([
        fetch("/api/imss/altas"),
        fetch("/api/imss/bajas"),
      ]);

      const allReports: IMSSReport[] = [];
      let suaCount = 0;
      let idseCount = 0;

      if (altasRes.ok) {
        const altasData = await altasRes.json();
        const altas = (altasData.data || altasData.altas || []).map((a: any) => ({
          id: a.id,
          type: "IDSE Alta",
          period: a.period || a.fechaMovimiento || "",
          generatedAt: a.createdAt || a.requestedAt || new Date().toISOString(),
          status: a.status || "SUBMITTED",
          employeeCount: a.employeeCount || (a.employeeIds?.length) || 1,
        }));
        allReports.push(...altas);
        idseCount += altas.length;
      }

      if (bajasRes.ok) {
        const bajasData = await bajasRes.json();
        const bajas = (bajasData.data || bajasData.bajas || []).map((b: any) => ({
          id: b.id,
          type: "IDSE Baja",
          period: b.period || b.fechaMovimiento || "",
          generatedAt: b.createdAt || b.requestedAt || new Date().toISOString(),
          status: b.status || "SUBMITTED",
          employeeCount: b.employeeCount || (b.employeeIds?.length) || 1,
        }));
        allReports.push(...bajas);
        idseCount += bajas.length;
      }

      const sortedReports = allReports.sort(
        (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
      );

      const submittedCount = sortedReports.filter(r => r.status === "SUBMITTED" || r.status === "APPROVED").length;
      const complianceRate = sortedReports.length > 0
        ? Math.round((submittedCount / sortedReports.length) * 100)
        : 0;

      setReports(sortedReports);
      setStats({
        suaCount,
        idseCount,
        totalContributions: 0,
        complianceRate,
      });
    } catch (error) {
      console.error("Error fetching IMSS reports:", error);
      toast.error("Error al cargar reportes IMSS");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerateIdse = async (movementType: string) => {
    setGeneratingIdse(true);
    try {
      const res = await fetch("/api/imss/idse-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movementType }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error generando archivo");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IDSE_${movementType}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success("Archivo IDSE generado exitosamente");
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Error al generar archivo IDSE");
    } finally {
      setGeneratingIdse(false);
    }
  };

  const handleGenerateSUA = async () => {
    try {
      const res = await fetch("/api/imss/sua-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error generando archivo SUA");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SUA_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success("Archivo SUA generado exitosamente");
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Error al generar archivo SUA");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes y Archivos IMSS"
        description="Genera y gestiona archivos de cumplimiento IMSS"
        icon={FileDown}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Archivos SUA</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.suaCount}</div>
            <p className="text-xs text-muted-foreground">
              Generados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Archivos IDSE</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.idseCount}</div>
            <p className="text-xs text-muted-foreground">
              Movimientos de empleados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Reportes de Cuotas</CardTitle>
            <FileDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.totalContributions > 0
                ? `$${(stats.totalContributions / 1000000).toFixed(1)}M`
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              Cuotas totales
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Tasa de Cumplimiento</CardTitle>
            <AlertTriangle className={`h-4 w-4 ${stats.complianceRate >= 90 ? "text-green-500" : stats.complianceRate >= 70 ? "text-yellow-500" : "text-red-500"}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.complianceRate}%</div>
            <p className="text-xs text-muted-foreground">
              Archivos enviados a tiempo
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="generate" className="space-y-4">
        <TabsList>
          <TabsTrigger value="generate">Generar Archivos</TabsTrigger>
          <TabsTrigger value="history">Historial de Archivos</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Generar Archivo SUA</CardTitle>
              <CardDescription>
                Archivo de Actualización de Salarios para reporte mensual IMSS
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Genera el archivo SUA con las actualizaciones salariales del período seleccionado.
                Debe presentarse antes del día 17 de cada mes.
              </p>
              <Button onClick={handleGenerateSUA} disabled={generatingIdse}>
                <FileDown className="h-4 w-4 mr-2" />
                {generatingIdse ? "Generando..." : "Generar Archivo SUA"}
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">IDSE - Altas</CardTitle>
                <CardDescription>
                  Archivo de movimientos - Nuevos empleados dados de alta
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Reporta altas de empleados ante el IMSS dentro de los 5 días hábiles posteriores al inicio de labores.
                </p>
                <Button
                  onClick={() => handleGenerateIdse("08")}
                  disabled={generatingIdse}
                  className="w-full"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  {generatingIdse ? "Generando..." : "Generar IDSE Altas"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">IDSE - Bajas</CardTitle>
                <CardDescription>
                  Archivo de movimientos - Empleados dados de baja
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Reporta bajas de empleados ante el IMSS dentro de los 5 días hábiles posteriores a la separación.
                </p>
                <Button
                  onClick={() => handleGenerateIdse("02")}
                  disabled={generatingIdse}
                  className="w-full"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  {generatingIdse ? "Generando..." : "Generar IDSE Bajas"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">IDSE - Modificación Salarial</CardTitle>
                <CardDescription>
                  Archivo de movimientos - Cambios de salario
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Reporta modificaciones salariales de empleados ante el IMSS.
                </p>
                <Button
                  onClick={() => handleGenerateIdse("07")}
                  disabled={generatingIdse}
                  className="w-full"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  {generatingIdse ? "Generando..." : "Generar IDSE Mod. Salarial"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Historial de Archivos Generados</CardTitle>
                <CardDescription>
                  Ver y descargar archivos IMSS generados previamente
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : reports.length === 0 ? (
                <div className="text-center py-12">
                  <FileDown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">Sin archivos generados</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    No se han generado archivos IMSS aún. Usa la pestaña "Generar Archivos" para crear uno.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Generado</TableHead>
                      <TableHead>Empleados</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((report) => (
                      <TableRow key={report.id}>
                        <TableCell>
                          <Badge variant="outline">{report.type}</Badge>
                        </TableCell>
                        <TableCell>{report.period || "—"}</TableCell>
                        <TableCell>
                          {report.generatedAt
                            ? new Date(report.generatedAt).toLocaleDateString("es-MX")
                            : "—"}
                        </TableCell>
                        <TableCell>{report.employeeCount}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              report.status === "SUBMITTED" || report.status === "APPROVED"
                                ? "default"
                                : report.status === "PENDING"
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {report.status === "SUBMITTED" ? "Enviado" :
                             report.status === "APPROVED" ? "Aprobado" :
                             report.status === "PENDING" ? "Pendiente" :
                             report.status === "REJECTED" ? "Rechazado" : report.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
