"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Calculator, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

interface SATStats {
    certificatesGenerated: number;
}

export default function SATPage() {
    const [stats, setStats] = useState<SATStats>({
        certificatesGenerated: 0,
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const certRes = await fetch("/api/sat/certificates");

                let certificatesGenerated = 0;

                if (certRes.ok) {
                    const certData = await certRes.json();
                    certificatesGenerated = certData.generated || 0;
                }

                setStats({ certificatesGenerated });
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
                <h1 className="text-3xl font-bold">Integración SAT</h1>
                <p className="text-muted-foreground">
                    Cumplimiento y reportes ante el Servicio de Administración Tributaria
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Validación RFC/CURP</CardTitle>
                            <Calculator className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-muted-foreground">Sin datos</div>
                            <p className="text-xs text-muted-foreground mb-3">
                                Valida los RFC/CURP de tus empleados para ver el estado aquí
                            </p>
                            <Link href="/dashboard/compliance/sat/validation">
                                <Button size="sm" variant="outline">
                                    Validar RFC/CURP
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Constancias Anuales</CardTitle>
                            <FileText className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.certificatesGenerated}</div>
                            <p className="text-xs text-muted-foreground">
                                Generadas este año
                            </p>
                        </CardContent>
                    </Card>
                </div>
            )}

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Resumen</TabsTrigger>
                    <TabsTrigger value="validation">Validación RFC/CURP</TabsTrigger>
                    <TabsTrigger value="certificates">Constancias</TabsTrigger>
                    <TabsTrigger value="reports">Reportes</TabsTrigger>
                    <TabsTrigger value="settings">Configuración</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Resumen de Cumplimiento SAT</CardTitle>
                            <CardDescription>
                                Estado actual de validaciones y reportes ante el SAT
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">Validación RFC</p>
                                        <p className="text-sm text-muted-foreground">
                                            Todos los empleados deben tener RFC válido para efectos fiscales
                                        </p>
                                    </div>
                                    <Link href="/dashboard/compliance/sat/validation">
                                        <Button size="sm" variant="outline">
                                            Validar RFC/CURP
                                        </Button>
                                    </Link>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">Constancias de Retenciones</p>
                                        <p className="text-sm text-muted-foreground">
                                            Constancia de Retenciones e Ingresos para empleados
                                        </p>
                                    </div>
                                    <Link href="/dashboard/compliance/sat/certificates">
                                        <Button size="sm" variant="outline">
                                            Generar Constancias
                                        </Button>
                                    </Link>
                                </div>

                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">Resumen Fiscal Anual</p>
                                        <p className="text-sm text-muted-foreground">
                                            Resumen completo del año fiscal
                                        </p>
                                    </div>
                                    <Button size="sm" variant="outline" disabled>
                                        Generar Reporte
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="validation" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Validación RFC/CURP</CardTitle>
                            <CardDescription>
                                Valida RFC y CURP de empleados
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground mb-4">
                                Valida el formato de RFC y CURP de manera individual o masiva.
                            </p>
                            <Link href="/dashboard/compliance/sat/validation">
                                <Button>
                                    <Calculator className="h-4 w-4 mr-2" />
                                    Ir a Validación
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="certificates" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Constancias de Retenciones</CardTitle>
                            <CardDescription>
                                Genera constancias anuales de retenciones para empleados
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground mb-4">
                                Genera Constancia de Retenciones e Ingresos requerida por SAT.
                            </p>
                            <Link href="/dashboard/compliance/sat/certificates">
                                <Button>
                                    <FileText className="h-4 w-4 mr-2" />
                                    Ir a Constancias
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="reports" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Reportes SAT</CardTitle>
                            <CardDescription>
                                Genera reportes para cumplimiento fiscal
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 border rounded-lg">
                                        <h4 className="font-medium">Reporte ISR Mensual</h4>
                                        <p className="text-sm text-muted-foreground mb-2">
                                            Resumen de retenciones de ISR
                                        </p>
                                        <Button size="sm" variant="outline" disabled>
                                            Generar Reporte
                                        </Button>
                                    </div>

                                    <div className="p-4 border rounded-lg">
                                        <h4 className="font-medium">Annual Tax Summary</h4>
                                        <p className="text-sm text-muted-foreground mb-2">
                                            Complete tax year summary
                                        </p>
                                        <Button size="sm" variant="outline" disabled>
                                            Generate Report
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="settings" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Configuración SAT</CardTitle>
                            <CardDescription>
                                Configura la integración con el SAT
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground">
                                Configura el RFC de la empresa y preferencias de reporte.
                                Esta funcionalidad estará disponible en la siguiente versión.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}