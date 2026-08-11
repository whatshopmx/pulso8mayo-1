"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricGrid, MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle, CheckCircle, PlusCircle, FileText, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { PageHeader, ErrorState } from "@/components/shared";
import { toast } from "sonner";

interface IMSSStats {
    totalEmployees: number;
    pendingAltas: number;
    pendingBajas: number;
    overdueAltas: number;
    overdueBajas: number;
}

export default function IMSSPage() {
    const [stats, setStats] = useState<IMSSStats>({
        totalEmployees: 0,
        pendingAltas: 0,
        pendingBajas: 0,
        overdueAltas: 0,
        overdueBajas: 0,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchStats = async () => {
        setLoading(true);
        setError(false);
        try {
            const [altasRes, bajasRes, employeesRes] = await Promise.all([
                fetch("/api/imss/altas"),
                fetch("/api/imss/bajas"),
                fetch("/api/employees"),
            ]);

            if (!altasRes.ok && !bajasRes.ok && !employeesRes.ok) {
                throw new Error("No se pudo obtener la información de IMSS");
            }

            let pendingAltas = 0, pendingBajas = 0, overdueAltas = 0, overdueBajas = 0, totalEmployees = 0;

            if (altasRes.ok) {
                const altasData = await altasRes.json();
                pendingAltas = (altasData.summary?.ready || 0) + (altasData.summary?.pending || 0);
                overdueAltas = altasData.summary?.overdue || 0;
            }
            if (bajasRes.ok) {
                const bajasData = await bajasRes.json();
                pendingBajas = (bajasData.summary?.ready || 0) + (bajasData.summary?.pending || 0);
                overdueBajas = bajasData.summary?.overdue || 0;
            }
            if (employeesRes.ok) {
                const empData = await employeesRes.json();
                totalEmployees = empData.pagination?.total || 0;
            }

            setStats({
                totalEmployees,
                pendingAltas,
                pendingBajas,
                overdueAltas,
                overdueBajas,
            });
        } catch (e) {
            console.error("Error loading stats", e);
            toast.error("Error al cargar los datos del IMSS");
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, []);

    const complianceRate = stats.totalEmployees > 0
        ? Math.round(((stats.totalEmployees - stats.overdueAltas - stats.overdueBajas) / stats.totalEmployees) * 100)
        : 100;

    return (
        <div className="space-y-6">
            <PageHeader
                title="Integración IMSS"
                description="Cumplimiento y reportes ante el Instituto Mexicano del Seguro Social"
                icon={ShieldCheck}
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : error ? (
                <ErrorState
                    message="No se pudo obtener los indicadores de IMSS"
                    onRetry={fetchStats}
                />
            ) : (
                <MetricGrid columns={4}>
                    <MetricCard
                        label="Empleados Activos"
                        value={stats.totalEmployees}
                        icon={<Users className="h-4 w-4" />}
                        subtitle="Registrados ante IMSS"
                    />

                    <MetricCard
                        label="Altas Pendientes"
                        value={stats.pendingAltas}
                        icon={<AlertTriangle className="h-4 w-4" />}
                        tone={stats.pendingAltas > 0 ? "warning" : "neutral"}
                        subtitle="Requieren registro ante IMSS"
                    />

                    <MetricCard
                        label="Bajas Pendientes"
                        value={stats.pendingBajas}
                        icon={<AlertTriangle className="h-4 w-4" />}
                        tone={stats.pendingBajas > 0 ? "destructive" : "neutral"}
                        subtitle="Requieren baja ante IMSS"
                    />

                    <MetricCard
                        label="Estado de Cumplimiento"
                        value={`${complianceRate}%`}
                        icon={<CheckCircle className="h-4 w-4" />}
                        tone={complianceRate >= 90 ? "success" : complianceRate >= 70 ? "warning" : "destructive"}
                        subtitle="Empleados en cumplimiento"
                        progress={{ value: complianceRate }}
                    />
                </MetricGrid>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Gestión IMSS</CardTitle>
                    <CardDescription>
                        Administración de movimientos y archivos ante el IMSS
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">Altas de Empleados</p>
                                <p className="text-sm text-muted-foreground">
                                    Registro de empleados nuevos ante IMSS
                                </p>
                            </div>
                            <Link href="/dashboard/compliance/imss/altas">
                                <Button size="sm" variant="outline">
                                    <PlusCircle className="h-4 w-4 mr-2" />
                                    Gestionar Altas
                                </Button>
                            </Link>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">Bajas de Empleados</p>
                                <p className="text-sm text-muted-foreground">
                                    Baja de empleados ante IMSS
                                </p>
                            </div>
                            <Link href="/dashboard/compliance/imss/bajas">
                                <Button size="sm" variant="outline">
                                    <PlusCircle className="h-4 w-4 mr-2" />
                                    Gestionar Bajas
                                </Button>
                            </Link>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">Archivos SUA</p>
                                <p className="text-sm text-muted-foreground">
                                    Actualización salarial mensual ante IMSS
                                </p>
                            </div>
                            <Link href="/dashboard/compliance/imss/sua">
                                <Button size="sm" variant="outline">
                                    <FileText className="h-4 w-4 mr-2" />
                                    Generar SUA
                                </Button>
                            </Link>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium">Archivos IDSE y Reportes</p>
                                <p className="text-sm text-muted-foreground">
                                    Reporte de movimientos y resumen mensual de cumplimiento
                                </p>
                            </div>
                            <Link href="/dashboard/compliance/imss/reports">
                                <Button size="sm" variant="outline">
                                    <FileText className="h-4 w-4 mr-2" />
                                    Generar IDSE y Reportes
                                </Button>
                            </Link>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

