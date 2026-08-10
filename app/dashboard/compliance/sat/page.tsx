"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricGrid, MetricCard } from "@/components/ui/metric-card";
import { Button } from "@/components/ui/button";
import { FileText, Calculator, Loader2, LandPlot } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { PageHeader, ErrorState } from "@/components/shared";
import { toast } from "sonner";

interface SATStats {
    certificatesGenerated: number;
}

export default function SATPage() {
    const [stats, setStats] = useState<SATStats>({
        certificatesGenerated: 0,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const fetchStats = async () => {
        setLoading(true);
        setError(false);
        try {
            const certRes = await fetch("/api/sat/certificates");

            if (!certRes.ok) {
                throw new Error("Error al obtener datos del SAT");
            }

            const certData = await certRes.json();
            const certificatesGenerated = certData.generated || 0;

            setStats({ certificatesGenerated });
        } catch (e) {
            console.error("Error loading stats", e);
            toast.error("Error al cargar los datos del SAT");
            setError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
    }, []);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Integración SAT"
                description="Cumplimiento y reportes ante el Servicio de Administración Tributaria"
                icon={LandPlot}
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : error ? (
                <ErrorState
                    message="No se pudo obtener la información de constancias del SAT"
                    onRetry={fetchStats}
                />
            ) : (
                <MetricGrid columns={2}>
                    <MetricCard
                        label="Validación RFC/CURP"
                        value="Sin datos"
                        icon={<Calculator className="h-4 w-4" />}
                        subtitle="Valida los RFC/CURP de tus empleados para ver el estado"
                    >
                        <div className="mt-2">
                            <Link href="/dashboard/compliance/sat/validation">
                                <Button size="sm" variant="outline" className="h-7 text-xs">
                                    Validar RFC/CURP
                                </Button>
                            </Link>
                        </div>
                    </MetricCard>

                    <MetricCard
                        label="Constancias Anuales"
                        value={stats.certificatesGenerated}
                        icon={<FileText className="h-4 w-4" />}
                        subtitle="Generadas este año"
                    />
                </MetricGrid>
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