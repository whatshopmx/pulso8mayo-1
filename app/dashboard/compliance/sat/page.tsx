"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

            <Card>
                <CardHeader>
                    <CardTitle>Gestión SAT</CardTitle>
                    <CardDescription>
                        Validaciones y constancias ante el SAT
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
                                    <Calculator className="h-4 w-4 mr-2" />
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
                                    <FileText className="h-4 w-4 mr-2" />
                                    Generar Constancias
                                </Button>
                            </Link>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}