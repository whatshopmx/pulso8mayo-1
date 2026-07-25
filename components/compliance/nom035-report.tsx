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
    Users,
    AlertTriangle,
    Brain,
    FileSpreadsheet
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import type { RiskLevel } from "@/lib/services/ComplianceReportService";

export interface NOM035ReportData {
    companyInfo: {
        name: string;
        branchName: string;
        address?: string | null;
        rfc?: string | null;
    };
    reportPeriod: {
        startDate: Date;
        endDate: Date;
    };
    summary: {
        totalSurveys: number;
        completedSurveys: number;
        averageScore: number;
        riskDistribution: Record<RiskLevel, number>;
        byDepartment: Record<string, { total: number; averageScore: number; riskLevel: RiskLevel }>;
        criticalFactors: Array<{ factor: string; averageScore: number }>;
    };
    employeeEvaluations: Array<{
        employeeId: string;
        employeeName: string;
        department: string;
        position: string;
        overallScore: number;
        riskLevel: RiskLevel;
        factors: {
            entornoOrganizacional: number;
            cargasTrabajo: number;
            liderazgo: number;
            comunicacion: number;
            desarrolloProfesional: number;
            climaLaboral: number;
        };
        recommendations: string[];
        evaluationHistory: Array<{
            date: Date;
            score: number;
            riskLevel: RiskLevel;
        }>;
    }>;
    recommendations: {
        general: string[];
        byRiskLevel: Record<RiskLevel, string[]>;
        priorityActions: string[];
    };
    digitalSignatures: {
        generatedBy: string;
        generatedAt: Date;
        digitalFingerprint: string;
    };
}

interface NOM035ReportProps {
    branchId: string;
    defaultStartDate?: Date;
    defaultEndDate?: Date;
}

export function NOM035Report({ branchId, defaultStartDate, defaultEndDate }: NOM035ReportProps) {
    const [loading, setLoading] = useState(false);
    const [generatingPdf, setGeneratingPdf] = useState(false);
    const [reportData, setReportData] = useState<NOM035ReportData | null>(null);
    const [startDate, setStartDate] = useState(
        defaultStartDate || new Date(new Date().setMonth(new Date().getMonth() - 1))
    );
    const [endDate, setEndDate] = useState(defaultEndDate || new Date());

    const fetchReportData = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                branchId
            });

            const response = await fetch(`/api/reports/nom-035?${params}`);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to fetch report');
            }

            const data = await response.json();
            setReportData(data);
            toast.success("Reporte NOM-035 cargado exitosamente");
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
            const response = await fetch('/api/reports/nom-035', {
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
            link.download = `NOM-035-${branchId}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}.pdf`;
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

    const getRiskLevelColor = (level: RiskLevel) => {
        switch (level) {
            case 'MUY_ALTO': return 'text-red-700 bg-red-100 border-red-300';
            case 'ALTO': return 'text-orange-700 bg-orange-100 border-orange-300';
            case 'MEDIO': return 'text-yellow-700 bg-yellow-100 border-yellow-300';
            case 'BAJO': return 'text-green-700 bg-green-100 border-green-300';
            case 'MINIMO': return 'text-emerald-700 bg-emerald-100 border-emerald-300';
        }
    };

    const getRiskLevelBadgeVariant = (level: RiskLevel) => {
        switch (level) {
            case 'MUY_ALTO':
            case 'ALTO': return 'destructive' as const;
            case 'MEDIO': return 'secondary' as const;
            case 'BAJO':
            case 'MINIMO': return 'default' as const;
        }
    };

    const getRiskLevelName = (level: RiskLevel | number): string => {
        if (typeof level === 'number') {
            if (level < 20) return 'MINIMO';
            if (level < 40) return 'BAJO';
            if (level < 60) return 'MEDIO';
            if (level < 80) return 'ALTO';
            return 'MUY_ALTO';
        }
        const names: Record<RiskLevel, string> = {
            MINIMO: 'Mínimo',
            BAJO: 'Bajo',
            MEDIO: 'Medio',
            ALTO: 'Alto',
            MUY_ALTO: 'Muy Alto'
        };
        return names[level];
    };

    const getFactorName = (key: string): string => {
        const names: Record<string, string> = {
            entornoOrganizacional: 'Entorno Organizacional',
            cargasTrabajo: 'Cargas de Trabajo',
            liderazgo: 'Liderazgo',
            comunicacion: 'Comunicación',
            desarrolloProfesional: 'Desarrollo Profesional',
            climaLaboral: 'Clima Laboral'
        };
        return names[key] || key;
    };

    const downloadExcel = () => {
        if (!reportData) return;
        try {
            const BOM = '\uFEFF';
            const lines: string[] = [];

            lines.push('REPORTE NOM-035 - RIESGOS PSICOSOCIALES');
            lines.push(`Sucursal,${reportData.companyInfo.branchName}`);
            lines.push(`Período,${startDate.toLocaleDateString("es-MX")} - ${endDate.toLocaleDateString("es-MX")}`);
            lines.push('');

            lines.push('RESUMEN EJECUTIVO');
            lines.push(`Total Evaluaciones,${reportData.summary.totalSurveys}`);
            lines.push(`Completadas,${reportData.summary.completedSurveys}`);
            lines.push(`Puntuación Promedio,${reportData.summary.averageScore}`);
            lines.push('');

            lines.push('DISTRIBUCIÓN DE RIESGOS');
            lines.push('Nivel,Cantidad,Porcentaje');
            (Object.entries(reportData.summary.riskDistribution) as [string, number][]).forEach(([level, count]) => {
                const pct = reportData.summary.totalSurveys > 0
                    ? Math.round((count / reportData.summary.totalSurveys) * 100)
                    : 0;
                lines.push(`${getRiskLevelName(level as any)},${count},${pct}%`);
            });
            lines.push('');

            lines.push('EVALUACIONES POR EMPLEADO');
            lines.push('Nombre,Departamento,Puesto,Score Global,Nivel Riesgo,Entorno Org,Cargas Trabajo,Liderazgo,Comunicación,Desarrollo Prof,Clima Laboral');
            reportData.employeeEvaluations.forEach(emp => {
                lines.push([
                    `"${emp.employeeName}"`,
                    `"${emp.department}"`,
                    `"${emp.position}"`,
                    emp.overallScore,
                    getRiskLevelName(emp.riskLevel),
                    emp.factors.entornoOrganizacional,
                    emp.factors.cargasTrabajo,
                    emp.factors.liderazgo,
                    emp.factors.comunicacion,
                    emp.factors.desarrolloProfesional,
                    emp.factors.climaLaboral,
                ].join(','));
            });
            lines.push('');

            if (reportData.recommendations.priorityActions.length > 0) {
                lines.push('ACCIONES PRIORITARIAS');
                reportData.recommendations.priorityActions.forEach(action => {
                    lines.push(`"${action}"`);
                });
            }

            const csvContent = BOM + lines.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `NOM-035-${branchId}-${startDate.toISOString().split('T')[0]}.csv`;
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
                    <div className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-600" />
                        <CardTitle>Generar Reporte NOM-035 - Riesgos Psicosociales</CardTitle>
                    </div>
                    <CardDescription>
                        Evaluación de factores de riesgo psicosocial en el trabajo (STPS)
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-4 items-end">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Fecha de Inicio</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="date"
                                    value={startDate.toISOString().split('T')[0]}
                                    onChange={(e) => setStartDate(new Date(e.target.value))}
                                    className="pl-10 h-10 px-3 py-2 border rounded-md bg-background text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Fecha de Fin</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input
                                    type="date"
                                    value={endDate.toISOString().split('T')[0]}
                                    onChange={(e) => setEndDate(new Date(e.target.value))}
                                    className="pl-10 h-10 px-3 py-2 border rounded-md bg-background text-sm"
                                />
                            </div>
                        </div>

                        <Button
                            onClick={fetchReportData}
                            disabled={loading}
                            className="gap-2"
                            variant="default"
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
                                disabled={generatingPdf}
                                variant="outline"
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
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-purple-600" />
                        <p className="text-muted-foreground">Cargando datos del reporte NOM-035...</p>
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
                                    <CardTitle>Información del Centro de Trabajo</CardTitle>
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
                            <div className="grid gap-6 md:grid-cols-4">
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Total Evaluaciones</p>
                                    <p className="text-3xl font-bold">{reportData.summary.totalSurveys}</p>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Completadas</p>
                                    <div className="flex items-center gap-2">
                                        <p className="text-3xl font-bold">{reportData.summary.completedSurveys}</p>
                                        {reportData.summary.completedSurveys === reportData.summary.totalSurveys ? (
                                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                                        ) : (
                                            <AlertCircle className="h-5 w-5 text-yellow-600" />
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Puntuación Promedio</p>
                                    <p className="text-3xl font-bold">{reportData.summary.averageScore}</p>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Riesgo Promedio</p>
                                    <Badge
                                        variant={getRiskLevelBadgeVariant(
                                            getRiskLevelName(reportData.summary.averageScore) as RiskLevel
                                        )}
                                        className={getRiskLevelColor(
                                            getRiskLevelName(reportData.summary.averageScore) as RiskLevel
                                        )}
                                    >
                                        {getRiskLevelName(reportData.summary.averageScore)}
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Risk Distribution */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                Distribución de Riesgos por Nivel
                            </CardTitle>
                            <CardDescription>
                                Número de empleados por categoría de riesgo psicosocial
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-4 md:grid-cols-5">
                                {(Object.entries(reportData.summary.riskDistribution) as Array<[RiskLevel, number]>).map(([level, count]) => (
                                    <div
                                        key={level}
                                        className={`border rounded-lg p-4 text-center ${getRiskLevelColor(level)}`}
                                    >
                                        <p className="text-sm font-medium mb-2">{getRiskLevelName(level)}</p>
                                        <p className="text-4xl font-bold">{count}</p>
                                        <p className="text-xs mt-2 opacity-80">
                                            {reportData.summary.totalSurveys > 0
                                                ? Math.round((count / reportData.summary.totalSurveys) * 100)
                                                : 0}% del total
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Critical Factors */}
                    {reportData.summary.criticalFactors.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                                    Factores Críticos
                                </CardTitle>
                                <CardDescription>
                                    Factores de riesgo con puntuaciones más altas
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {reportData.summary.criticalFactors.map((factor, index) => (
                                        <div key={factor.factor} className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-medium">
                                                    {index + 1}. {factor.factor}
                                                </span>
                                                <Badge
                                                    variant={
                                                        factor.averageScore >= 60 ? 'destructive' :
                                                        factor.averageScore >= 40 ? 'secondary' : 'default'
                                                    }
                                                >
                                                    {factor.averageScore} puntos
                                                </Badge>
                                            </div>
                                            <Progress
                                                value={factor.averageScore}
                                                className="h-3"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* By Department */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Análisis por Departamento</CardTitle>
                            <CardDescription>
                                Riesgos psicosociales agrupados por departamento
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {Object.entries(reportData.summary.byDepartment).map(([dept, data]) => (
                                    <div key={dept} className="border rounded-lg p-4">
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="font-semibold">{dept}</h4>
                                            <Badge variant={getRiskLevelBadgeVariant(data.riskLevel)}>
                                                {getRiskLevelName(data.riskLevel)}
                                            </Badge>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Empleados:</span>
                                                <p className="font-medium">{data.total}</p>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Score Prom.:</span>
                                                <p className="font-medium">{data.averageScore}</p>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Riesgo:</span>
                                                <p className={`font-medium ${getRiskLevelColor(data.riskLevel)}`}>
                                                    {getRiskLevelName(data.riskLevel)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Employee Evaluations */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5" />
                                Evaluaciones por Empleado
                            </CardTitle>
                            <CardDescription>
                                Detalle individual de riesgos psicosociales
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {reportData.employeeEvaluations.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                        <p>No hay evaluaciones registradas en este período</p>
                                    </div>
                                ) : (
                                    reportData.employeeEvaluations.map((employee, index) => (
                                        <div
                                            key={employee.employeeId}
                                            className="border rounded-lg p-4 space-y-3"
                                        >
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h4 className="font-semibold">{employee.employeeName}</h4>
                                                    <p className="text-sm text-muted-foreground">
                                                        {employee.position} - {employee.department}
                                                    </p>
                                                </div>
                                                <Badge
                                                    variant={getRiskLevelBadgeVariant(employee.riskLevel)}
                                                    className={getRiskLevelColor(employee.riskLevel)}
                                                >
                                                    {getRiskLevelName(employee.riskLevel)} ({employee.overallScore})
                                                </Badge>
                                            </div>

                                            {/* Factors Grid */}
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {Object.entries(employee.factors).map(([key, value]) => (
                                                    <div key={key} className="space-y-1">
                                                        <p className="text-xs text-muted-foreground">
                                                            {getFactorName(key)}
                                                        </p>
                                                        <div className="flex items-center gap-2">
                                                            <Progress value={value} className="flex-1 h-2" />
                                                            <span className="text-xs font-medium w-6 text-right">
                                                                {value}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Recommendations */}
                                            {employee.recommendations.length > 0 && (
                                                <div className="border-t pt-3 mt-3">
                                                    <p className="text-sm font-medium mb-2 text-purple-700">
                                                        Recomendaciones:
                                                    </p>
                                                    <ul className="space-y-1">
                                                        {employee.recommendations.map((rec, idx) => (
                                                            <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                                                <span className="text-purple-600 mt-1">•</span>
                                                                {rec}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {/* History */}
                                            <div className="border-t pt-3 mt-3">
                                                <p className="text-sm font-medium mb-2">Historial de Evaluaciones:</p>
                                                <div className="flex gap-4">
                                                    {employee.evaluationHistory.map((hist, idx) => (
                                                        <div key={idx} className="text-center">
                                                            <p className="text-xs text-muted-foreground">
                                                                {format(hist.date, "MMM yyyy", { locale: es })}
                                                            </p>
                                                            <Badge
                                                                variant={getRiskLevelBadgeVariant(hist.riskLevel)}
                                                                className="mt-1"
                                                            >
                                                                {hist.score} pts
                                                            </Badge>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Recommendations */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Brain className="h-5 w-5" />
                                Recomendaciones Generales
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Priority Actions */}
                            {reportData.recommendations.priorityActions.length > 0 && (
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <h4 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4" />
                                        Acciones Prioritarias
                                    </h4>
                                    <ul className="space-y-2">
                                        {reportData.recommendations.priorityActions.map((action, idx) => (
                                            <li key={idx} className="text-sm text-red-700 flex items-start gap-2">
                                                <span>⚠</span>
                                                {action}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* General Recommendations */}
                            <div>
                                <h4 className="font-semibold mb-2">Recomendaciones Generales:</h4>
                                <ul className="space-y-2">
                                    {reportData.recommendations.general.map((rec, idx) => (
                                        <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                            <span className="text-purple-600 mt-1">•</span>
                                            {rec}
                                        </li>
                                    ))}
                                </ul>
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
                                    Este reporte se genera en cumplimiento a la NOM-035-STPS-2018:
                                    Factores de riesgo psicosocial en el trabajo - Identificación, análisis y prevención.
                                </p>
                                <p className="text-xs text-muted-foreground italic mt-2">
                                    Este documento constituye un registro oficial para fines de auditoría ante la STPS
                                    y debe conservarse como parte de la documentación de seguridad e higiene del centro de trabajo.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
