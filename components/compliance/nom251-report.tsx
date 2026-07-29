"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
    FileText, 
    Download, 
    Loader2, 
    Calendar, 
    CheckCircle2, 
    AlertCircle,
    TrendingUp,
    Building2,
    FileSpreadsheet
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

export interface NOM251ReportData {
    companyInfo: {
        name: string;
        branchName: string;
        address?: string | null;
    };
    reportPeriod: {
        startDate: Date;
        endDate: Date;
    };
    summary: {
        totalInspections: number;
        completedInspections: number;
        complianceRate: number;
        byCategory: Record<string, { total: number; completed: number; rate: number }>;
    };
    inspections: Array<{
        id: string;
        workflowName: string;
        category: string;
        status: string;
        completedAt: Date | null;
        assigneeName: string | null;
        score: number | null;
        steps: Array<{
            stepName: string;
            status: string;
            value: any;
            aiAnalysis?: any;
            evidenceUrl?: string | null;
            comment?: string | null;
        }>;
    }>;
    digitalSignatures: {
        generatedBy: string;
        generatedAt: Date;
        digitalFingerprint: string;
    };
}

interface NOM251ReportProps {
    branchId: string;
    defaultStartDate?: Date;
    defaultEndDate?: Date;
}

export function NOM251Report({ branchId, defaultStartDate, defaultEndDate }: NOM251ReportProps) {
    const [loading, setLoading] = useState(false);
    const [generatingPdf, setGeneratingPdf] = useState(false);
    const [reportData, setReportData] = useState<NOM251ReportData | null>(null);
    const [startDate, setStartDate] = useState(
        defaultStartDate || new Date(new Date().setMonth(new Date().getMonth() - 1))
    );
    const [endDate, setEndDate] = useState(defaultEndDate || new Date());

    // Validación del período (T6): sin fechas futuras y fin >= inicio
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];
    const dateError =
        startStr > todayStr || endStr > todayStr
            ? "Las fechas no pueden ser posteriores a hoy"
            : endStr < startStr
              ? "La fecha de fin debe ser igual o posterior a la fecha de inicio"
              : null;

    const fetchReportData = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                branchId
            });

            const response = await fetch(`/api/reports/nom-251?${params}`);
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fetch report');
            }

            const data = await response.json();
            setReportData(data);
            toast.success("Reporte cargado exitosamente");
        } catch (error) {
            console.error('Error fetching report:', error);
            toast.error(error instanceof Error ? error.message : "Error al cargar el reporte");
            setReportData(null);
        } finally {
            setLoading(false);
        }
    };

    const downloadPDF = async () => {
        setGeneratingPdf(true);
        try {
            const response = await fetch('/api/reports/nom-251', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    branchId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to generate PDF');
            }

            // Create blob and download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `NOM-251-${branchId}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast.success("Reporte PDF descargado exitosamente");
        } catch (error) {
            console.error('Error downloading PDF:', error);
            toast.error(error instanceof Error ? error.message : "Error al descargar el PDF");
        } finally {
            setGeneratingPdf(false);
        }
    };

    const getComplianceColor = (rate: number) => {
        if (rate >= 90) return "text-green-600";
        if (rate >= 70) return "text-yellow-600";
        return "text-red-600";
    };

    const getComplianceBadgeVariant = (rate: number) => {
        if (rate >= 90) return "default" as const; // green
        if (rate >= 70) return "secondary" as const; // yellow
        return "destructive" as const; // red
    };

    const downloadExcel = () => {
        if (!reportData) return;
        try {
            // Generate CSV content client-side
            const BOM = '\uFEFF';
            const lines: string[] = [];

            lines.push('REPORTE DE CUMPLIMIENTO NOM-251');
            lines.push(`Sucursal,${reportData.companyInfo.branchName}`);
            lines.push(`Período,${startDate.toLocaleDateString("es-MX")} - ${endDate.toLocaleDateString("es-MX")}`);
            lines.push('');

            lines.push('RESUMEN EJECUTIVO');
            lines.push(`Total de Inspecciones,${reportData.summary.totalInspections}`);
            lines.push(`Inspecciones Completadas,${reportData.summary.completedInspections}`);
            lines.push(`Tasa de Cumplimiento,${reportData.summary.complianceRate}%`);
            lines.push('');

            lines.push('CUMPLIMIENTO POR CATEGORÍA');
            lines.push('Categoría,Total,Completadas,Cumplimiento %');
            Object.entries(reportData.summary.byCategory).forEach(([cat, data]) => {
                lines.push(`"${cat}",${data.total},${data.completed},${data.rate}%`);
            });
            lines.push('');

            lines.push('DETALLE DE INSPECCIONES');
            lines.push('Workflow,Categoría,Estado,Responsable,Puntuación');
            reportData.inspections.forEach(insp => {
                lines.push([
                    `"${insp.workflowName}"`,
                    `"${insp.category}"`,
                    insp.status,
                    `"${insp.assigneeName || 'No asignado'}"`,
                    insp.score !== null ? `${insp.score}/100` : 'N/A',
                ].join(','));
            });

            const csvContent = BOM + lines.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `NOM-251-${branchId}-${startDate.toISOString().split('T')[0]}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            toast.success("Reporte Excel descargado exitosamente");
        } catch (error) {
            toast.error("Error al descargar Excel");
        }
    };

    return (
        <div className="space-y-6">
            {/* Controls */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Generar Reporte NOM-251
                    </CardTitle>
                    <CardDescription>
                        Seleccione el período para generar el reporte de cumplimiento de higiene y salud
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="space-y-2">
                            <label htmlFor="nom251-start-date" className="text-sm font-medium">Fecha de Inicio</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    id="nom251-start-date"
                                    type="date"
                                    max={todayStr}
                                    value={startDate.toISOString().split('T')[0]}
                                    onChange={(e) => {
                                        const next = new Date(e.target.value);
                                        if (e.target.value && !Number.isNaN(next.getTime())) setStartDate(next);
                                    }}
                                    className="pl-10 h-10 px-3 py-2 border rounded-md bg-background text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="nom251-end-date" className="text-sm font-medium">Fecha de Fin</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    id="nom251-end-date"
                                    type="date"
                                    max={todayStr}
                                    value={endDate.toISOString().split('T')[0]}
                                    onChange={(e) => {
                                        const next = new Date(e.target.value);
                                        if (e.target.value && !Number.isNaN(next.getTime())) setEndDate(next);
                                    }}
                                    className="pl-10 h-10 px-3 py-2 border rounded-md bg-background text-sm"
                                />
                            </div>
                        </div>

                        {dateError && (
                            <p className="w-full text-sm text-destructive">{dateError}</p>
                        )}

                        <Button
                            onClick={fetchReportData}
                            disabled={loading || !!dateError}
                            className="gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Cargando...
                                </>
                            ) : (
                                <>
                                    <TrendingUp className="h-4 w-4" />
                                    Generar Vista Previa
                                </>
                            )}
                        </Button>

                        {reportData && (
                            <Button 
                                onClick={downloadPDF}
                                disabled={generatingPdf || !!dateError}
                                variant="default"
                                className="gap-2"
                            >
                                {generatingPdf ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Generando PDF...
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        Descargar PDF
                                    </>
                                )}
                            </Button>
                        )}

                        {reportData && (
                            <Button 
                                onClick={downloadExcel}
                                disabled={!!dateError}
                                variant="outline"
                                className="gap-2"
                            >
                                <FileSpreadsheet className="h-4 w-4" />
                                Descargar Excel
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Loading State */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center space-y-4">
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                        <p className="text-muted-foreground">Cargando datos del reporte...</p>
                    </div>
                </div>
            )}

            {/* Report Preview */}
            {reportData && !loading && (
                <>
                    {/* Company Info */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-muted-foreground" />
                                    <CardTitle>Información del Establecimiento</CardTitle>
                                </div>
                                <Badge variant="outline">
                                    {format(reportData.reportPeriod.startDate, "dd MMM yyyy", { locale: es })} - {format(reportData.reportPeriod.endDate, "dd MMM yyyy", { locale: es })}
                                </Badge>
                            </div>
                            <CardDescription>
                                {reportData.companyInfo.branchName}
                                {reportData.companyInfo.address && ` - ${reportData.companyInfo.address}`}
                            </CardDescription>
                        </CardHeader>
                    </Card>

                    {/* Executive Summary */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Resumen Ejecutivo
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-6 md:grid-cols-3">
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Total de Inspecciones</p>
                                    <p className="text-3xl font-bold">{reportData.summary.totalInspections}</p>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Completadas</p>
                                    <div className="flex items-center gap-2">
                                        <p className="text-3xl font-bold">{reportData.summary.completedInspections}</p>
                                        {reportData.summary.completedInspections === reportData.summary.totalInspections ? (
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                        ) : (
                                            <AlertCircle className="h-5 w-5 text-yellow-600" />
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Tasa de Cumplimiento</p>
                                    <div className="flex items-center gap-2">
                                        <p className={`text-3xl font-bold ${getComplianceColor(reportData.summary.complianceRate)}`}>
                                            {reportData.summary.complianceRate}%
                                        </p>
                                        <Badge variant={getComplianceBadgeVariant(reportData.summary.complianceRate)}>
                                            {reportData.summary.complianceRate >= 90 ? 'Excelente' : 
                                             reportData.summary.complianceRate >= 70 ? 'Bueno' : 'Crítico'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>

                            {/* Progress Bar */}
                            <div className="mt-6">
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="font-medium">Progreso del Período</span>
                                    <span className="text-muted-foreground">
                                        {reportData.summary.completedInspections} de {reportData.summary.totalInspections}
                                    </span>
                                </div>
                                <Progress 
                                    value={reportData.summary.complianceRate} 
                                    className="h-2"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Compliance by Category */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Cumplimiento por Categoría</CardTitle>
                            <CardDescription>
                                Desglose de cumplimiento por tipo de verificación
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {Object.entries(reportData.summary.byCategory).map(([category, data]) => (
                                    <div key={category} className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm font-medium">{category}</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-muted-foreground">
                                                    {data.completed}/{data.total}
                                                </span>
                                                <Badge 
                                                    variant={getComplianceBadgeVariant(data.rate)}
                                                    className={getComplianceColor(data.rate)}
                                                >
                                                    {data.rate}%
                                                </Badge>
                                            </div>
                                        </div>
                                        <Progress value={data.rate} className="h-2" />
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Inspections List */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Detalle de Inspecciones</CardTitle>
                            <CardDescription>
                                Lista completa de inspecciones realizadas en el período
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {reportData.inspections.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                        <p>No hay inspecciones registradas en este período</p>
                                    </div>
                                ) : (
                                    reportData.inspections.map((inspection, index) => (
                                        <div 
                                            key={inspection.id}
                                            className="border rounded-lg p-4 space-y-3"
                                        >
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h4 className="font-semibold">{inspection.workflowName}</h4>
                                                    <p className="text-sm text-muted-foreground">
                                                        {inspection.category}
                                                    </p>
                                                </div>
                                                <Badge 
                                                    variant={inspection.status === 'COMPLETED' ? 'default' : 'secondary'}
                                                    className={
                                                        inspection.status === 'COMPLETED' 
                                                            ? 'bg-green-600' 
                                                            : 'bg-yellow-600'
                                                    }
                                                >
                                                    {inspection.status === 'COMPLETED' ? 'Completada' : inspection.status}
                                                </Badge>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div>
                                                    <span className="text-muted-foreground">Responsable:</span>
                                                    <span className="ml-2">{inspection.assigneeName}</span>
                                                </div>
                                                {inspection.completedAt && (
                                                    <div>
                                                        <span className="text-muted-foreground">Completada:</span>
                                                        <span className="ml-2">
                                                            {format(inspection.completedAt, "dd MMM yyyy, HH:mm", { locale: es })}
                                                        </span>
                                                    </div>
                                                )}
                                                {inspection.score !== null && (
                                                    <div>
                                                        <span className="text-muted-foreground">Puntuación:</span>
                                                        <span className="ml-2 font-medium">{inspection.score}/100</span>
                                                    </div>
                                                )}
                                            </div>

                                            {inspection.steps.length > 0 && (
                                                <div className="border-t pt-3 mt-3">
                                                    <p className="text-sm font-medium mb-2">
                                                        Pasos ({inspection.steps.length})
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {inspection.steps.map((step, stepIndex) => (
                                                            <Badge 
                                                                key={stepIndex}
                                                                variant={step.status === 'COMPLETED' ? 'outline' : 'secondary'}
                                                                className="text-xs"
                                                            >
                                                                {step.status === 'COMPLETED' ? '✓' : '○'} {step.stepName}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Digital Signature */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5" />
                                Firma Digital y Validación
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-muted-foreground">Generado por:</span>
                                    <p className="font-medium">{reportData.digitalSignatures.generatedBy}</p>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">Fecha de generación:</span>
                                    <p className="font-medium">
                                        {format(reportData.digitalSignatures.generatedAt, "dd MMM yyyy, HH:mm:ss", { locale: es })}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-sm">Huella digital:</span>
                                <code className="block mt-1 p-2 bg-muted rounded text-xs font-mono break-all">
                                    {reportData.digitalSignatures.digitalFingerprint}
                                </code>
                            </div>
                            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                                <p className="text-xs text-muted-foreground italic">
                                    Este reporte se genera de manera automática y constituye un registro oficial de las actividades 
                                    de verificación realizadas en el establecimiento. La información contenida en este documento 
                                    es fiel reflejo de los datos capturados en el sistema Pulso HORECA durante el período indicado.
                                </p>
                                <p className="text-xs text-muted-foreground italic mt-2">
                                    Este documento cumple con los requisitos establecidos por la COFEPRIS para el registro 
                                    de actividades de control sanitario en establecimientos de alimentos y bebidas.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
