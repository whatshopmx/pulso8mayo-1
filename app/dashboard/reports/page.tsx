"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    FileText,
    Download,
    Calendar,
    TrendingUp,
    CheckCircle2,
    AlertTriangle,
    Users,
    Package,
    ClipboardList,
    Shield,
    Search,
    Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { PageHeader, PageContainer } from "@/components/shared";

const categoryGroups: Record<string, string[]> = {
    ALL: ["ALL"],
    OPERACIONES: ["WORKFLOWS", "EVIDENCE", "INCIDENTS"],
    CUMPLIMIENTO: ["COMPLIANCE"],
    INVENTARIO: ["INVENTORY"],
    PERSONAS: ["LABOR", "ANALYTICS"],
};

const categories = ["ALL", "OPERACIONES", "CUMPLIMIENTO", "INVENTARIO", "PERSONAS"];

const categoryLabels: Record<string, string> = {
    ALL: "Todos",
    OPERACIONES: "Operaciones",
    CUMPLIMIENTO: "Cumplimiento",
    INVENTARIO: "Inventario",
    PERSONAS: "Personas",
};

export default function ReportsPage() {
    const [dateRange, setDateRange] = useState({
        from: format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd"),
    });
    const [reportType, setReportType] = useState<"summary" | "detailed" | "compliance">("summary");
    const [branchId, setBranchId] = useState<string>("all");
    const [generating, setGenerating] = useState<string | null>(null);
    const [availableBranches, setAvailableBranches] = useState<{ id: string; name: string }[]>([]);
    const [scheduledReports, setScheduledReports] = useState<any[]>([]);
    const [scheduledLoading, setScheduledLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState("ALL");
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetch("/api/branches")
            .then((res) => res.json())
            .then((data) => {
                const branches = Array.isArray(data) ? data : data.branches || [];
                setAvailableBranches(branches.map((b: any) => ({ id: b.id, name: b.name })));
            })
            .catch(() => toast.error("Error al cargar sucursales"));
    }, []);

    useEffect(() => {
        setScheduledLoading(true);
        fetch("/api/reports/scheduled")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                setScheduledReports(Array.isArray(data) ? data : data?.reports ?? []);
            })
            .catch((err) => {
                setScheduledReports([]);
                toast.error("Error al cargar reportes programados");
            })
            .finally(() => setScheduledLoading(false));
    }, []);

    const reports = [
        {
            id: "workflow-summary",
            name: "Resumen de Workflows",
            description: "Resumen ejecutivo de todos los workflows ejecutados en el período seleccionado",
            icon: ClipboardList,
            category: "WORKFLOWS",
            formats: ["PDF", "Excel"],
        },
        {
            id: "workflow-detailed",
            name: "Reporte Detallado de Workflows",
            description: "Listado completo de workflows con estado, tiempos, asignados y resultados",
            icon: FileText,
            category: "WORKFLOWS",
            formats: ["PDF", "Excel", "CSV"],
        },
        {
            id: "evidence-report",
            name: "Reporte de Evidencias",
            description: "Catálogo de todas las evidencias subidas con verificación AI incluida",
            icon: CheckCircle2,
            category: "EVIDENCE",
            formats: ["PDF"],
        },
        {
            id: "compliance-nom251",
            name: "Cumplimiento NOM-251",
            description: "Reporte oficial de cumplimiento de higiene y salud (COFEPRIS)",
            icon: Shield,
            category: "COMPLIANCE",
            formats: ["PDF"],
            official: true,
        },
        {
            id: "compliance-nom035",
            name: "Cumplimiento NOM-035",
            description: "Reporte de factores de riesgo psicosocial (STPS)",
            icon: Users,
            category: "COMPLIANCE",
            formats: ["PDF"],
            official: true,
            comingSoon: true,
        },
        {
            id: "inventory-status",
            name: "Estado de Inventario",
            description: "Reporte de stock, mermas, caducidades y movimientos de inventario",
            icon: Package,
            category: "INVENTORY",
            formats: ["PDF", "Excel"],
        },
        {
            id: "labor-attendance",
            name: "Asistencia y Horas",
            description: "Reporte de asistencia, horas trabajadas, horas extras y retardos",
            icon: Calendar,
            category: "LABOR",
            formats: ["PDF", "Excel"],
        },
        {
            id: "performance-kpis",
            name: "KPIs de Rendimiento",
            description: "Indicadores clave de rendimiento con tendencias y comparativas",
            icon: TrendingUp,
            category: "ANALYTICS",
            formats: ["PDF", "Excel"],
        },
        {
            id: "incidents-report",
            name: "Reporte de Incidentes",
            description: "Listado de incidentes registrados con estado de resolución",
            icon: AlertTriangle,
            category: "INCIDENTS",
            formats: ["PDF"],
        },
    ];

    const handleGenerateReport = async (reportId: string, reportName: string, format: string) => {
        setGenerating(reportId);
        try {
            const response = await fetch("/api/reports/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reportId,
                    format,
                    dateFrom: dateRange.from,
                    dateTo: dateRange.to,
                    branchId: branchId === "all" ? null : branchId,
                    reportType,
                }),
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const ext = format.toLowerCase() === "excel" ? "xlsx" : "pdf";
                const safeName = reportName.replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, "").replace(/\s+/g, "-");
                a.download = `${safeName}-${new Date().toISOString().split('T')[0]}.${ext}`;
                a.click();
                window.URL.revokeObjectURL(url);
                toast.success(`Reporte generado: ${reportName}`);
            } else {
                throw new Error("Failed to generate report");
            }
        } catch (error) {
            console.error("Failed to generate report:", error);
            toast.error("Error al generar el reporte");
        } finally {
            setGenerating(null);
        }
    };

    const filteredReports = reports.filter((r) => {
        const matchesCategory =
            selectedCategory === "ALL" || categoryGroups[selectedCategory]?.includes(r.category);
        const matchesSearch =
            searchQuery === "" ||
            r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            r.description.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesSearch;
    });

    return (
        <PageContainer>
            <PageHeader
                title="Reportes"
                description="Genera y descarga reportes de todas las áreas del sistema"
                icon={FileText}
                actions={
                    <Button asChild variant="default">
                        <Link href="/dashboard/reports/custom">
                            <FileText className="h-4 w-4 mr-2" />
                            Constructor de Reportes
                        </Link>
                    </Button>
                }
            />

            {/* Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Configuración de Reportes</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <Label>Fecha desde</Label>
                            <Input
                                type="date"
                                value={dateRange.from}
                                onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Fecha hasta</Label>
                            <Input
                                type="date"
                                value={dateRange.to}
                                onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Sucursal</Label>
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todas las sucursales" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las sucursales</SelectItem>
                                    {availableBranches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id}>
                                            {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Tipo de Reporte</Label>
                            <Select value={reportType} onValueChange={(v: any) => setReportType(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="summary">Resumen</SelectItem>
                                    <SelectItem value="detailed">Detallado</SelectItem>
                                    <SelectItem value="compliance">Cumplimiento</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Search + Tabs */}
            <div className="flex flex-col gap-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar reportes por nombre o descripción..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>

                <Tabs defaultValue="ALL" value={selectedCategory} onValueChange={setSelectedCategory}>
                    <TabsList className="grid w-full grid-cols-5">
                        {categories.map((cat) => (
                            <TabsTrigger key={cat} value={cat}>
                                {categoryLabels[cat]}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value={selectedCategory} className="mt-6">
                        {filteredReports.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <FileText className="h-10 w-10 mb-2 opacity-50" />
                                <p>No se encontraron reportes</p>
                                <p className="text-sm">Intenta con otros filtros o términos de búsqueda</p>
                            </div>
                        ) : (
                            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                {filteredReports.map((report) => (
                                    <Card key={report.id} className={report.comingSoon ? "opacity-60" : ""}>
                                        <CardHeader>
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                        <report.icon className="h-5 w-5 text-primary" />
                                                    </div>
                                                    <div>
                                                        <CardTitle className="text-lg">{report.name}</CardTitle>
                                                        {report.official && (
                                                            <Badge className="mt-1 bg-blue-500 text-xs">
                                                                <Shield className="h-3 w-3 mr-1" />
                                                                Oficial
                                                            </Badge>
                                                        )}
                                                        {report.comingSoon && (
                                                            <Badge variant="secondary" className="mt-1 text-xs">
                                                                Próximamente
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <CardDescription className="text-sm mt-2">
                                                {report.description}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {report.formats.map((fmt) => (
                                                        <Badge key={fmt} variant="outline" className="text-xs">
                                                            {fmt}
                                                        </Badge>
                                                    ))}
                                                </div>
                                                <div className="flex gap-2 pt-2">
                                                    {!report.comingSoon &&
                                                        report.formats.map((fmt) => (
                                                            <Button
                                                                key={fmt}
                                                                variant="outline"
                                                                size="sm"
                                                                className="flex-1"
                                                                disabled={generating === report.id}
                                                                onClick={() =>
                                                                    handleGenerateReport(report.id, report.name, fmt)
                                                                }
                                                            >
                                                                {generating === report.id ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <>
                                                                        <Download className="h-4 w-4 mr-1" />
                                                                        {fmt}
                                                                    </>
                                                                )}
                                                            </Button>
                                                        ))}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* Scheduled Reports */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Reportes Programados
                    </CardTitle>
                    <CardDescription>
                        Configura reportes automáticos que se envían periódicamente
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {scheduledLoading ? (
                            <div className="flex items-center justify-center py-8 text-muted-foreground">
                                Cargando reportes programados...
                            </div>
                        ) : scheduledReports.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                <Calendar className="h-10 w-10 mb-2 opacity-50" />
                                <p>No hay reportes programados</p>
                                <p className="text-sm">Programa un reporte para recibirlo automáticamente</p>
                            </div>
                        ) : (
                            scheduledReports.map((report: any, idx: number) => {
                                const sched = report.schedule || {};
                                const freqLabel =
                                    { DAILY: "Diaria", WEEKLY: "Semanal", MONTHLY: "Mensual" }[sched.frequency] ||
                                    sched.frequency ||
                                    "Programado";
                                return (
                                    <div
                                        key={report.id || idx}
                                        className="flex items-center justify-between p-4 border rounded-lg"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                <ClipboardList className="h-5 w-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium">{report.name || "Reporte Programado"}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {freqLabel} — {sched.time || "07:00"} — {sched.format || "PDF"}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {report.lastRunStatus === "FAILED" ? (
                                                <Badge variant="destructive">Error</Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-green-600 border-green-600">
                                                    Activo
                                                </Badge>
                                            )}
                                            <Button variant="ghost" size="sm">
                                                Editar
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                        <Button variant="outline" className="w-full" asChild>
                            <Link href="/dashboard/reports/schedule">
                                <Calendar className="h-4 w-4 mr-2" />
                                Programar Nuevo Reporte
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </PageContainer>
    );
}
