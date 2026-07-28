"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle, CheckCircle, PlusCircle, FileText, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

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

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const [altasRes, bajasRes, employeesRes] = await Promise.all([
                    fetch("/api/imss/altas"),
                    fetch("/api/imss/bajas"),
                    fetch("/api/employees"),
                ]);

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
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Integración IMSS</h1>
                <p className="text-muted-foreground">
                    Cumplimiento y reportes ante el Instituto Mexicano del Seguro Social
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Empleados Activos</CardTitle>
                            <Users className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.totalEmployees}</div>
                            <p className="text-xs text-muted-foreground">
                                Registrados ante IMSS
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Altas Pendientes</CardTitle>
                            <AlertTriangle className="h-4 w-4 text-orange-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-orange-600">{stats.pendingAltas}</div>
                            <p className="text-xs text-muted-foreground">
                                Need IMSS registration
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Bajas Pendientes</CardTitle>
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-red-600">{stats.pendingBajas}</div>
                            <p className="text-xs text-muted-foreground">
                                Need IMSS deregistration
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Estado de Cumplimiento</CardTitle>
                            <CheckCircle className="h-4 w-4 text-success" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-green-600">
                                {stats.totalEmployees > 0
                                    ? Math.round(((stats.totalEmployees - stats.overdueAltas - stats.overdueBajas) / stats.totalEmployees) * 100)
                                    : 100}%
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Empleados en cumplimiento
                            </p>
                        </CardContent>
                    </Card>
                </div>
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
                                    Desregistro de empleados ante IMSS
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
