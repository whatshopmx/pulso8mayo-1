"use client";

import { useState, useEffect } from "react";
import { NOM251Report } from "@/components/compliance/nom251-report";
import { NOM035Report } from "@/components/compliance/nom035-report";
import { ComplianceDashboard } from "@/components/compliance/compliance-dashboard";
import { CorporateComplianceGrid } from "@/components/compliance/corporate-compliance-grid";
import { SUAGenerator } from "@/components/compliance/imss/sua-generator";
import { IDSEGenerator } from "@/components/compliance/imss/idse-generator";
import { PayrollExport } from "@/components/compliance/payroll-export";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import { FileText, Shield, TrendingUp, ClipboardCheck, Brain, Building2, DollarSign, ShieldCheck } from "lucide-react";

interface Branch {
  id?: string;
  branchId?: string;
  name: string;
}

export default function CompliancePage() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>("");

    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const res = await fetch("/api/branches");
                if (res.ok) {
                    const data = await res.json();
                    setBranches(data.branches || []);
                    if (data.branches && data.branches.length > 0) {
                        setSelectedBranch(data.branches[0].branchId || data.branches[0].id);
                    }
                }
            } catch (error) {
                console.error("Error fetching branches:", error);
            }
        };

        fetchBranches();
    }, []);

    return (
        <PageContainer>
            <PageHeader
                title="Compliance"
                description="Gestión de reportes de cumplimiento normativo"
                icon={Shield}
                badge="NOM-251 & NOM-035"
            >
                {branches.length > 0 && (
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                            <SelectTrigger className="w-[300px]">
                                <SelectValue placeholder="Seleccionar sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((branch) => (
                                    <SelectItem key={branch.branchId || branch.id} value={branch.branchId || branch.id}>
                                        {branch.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </PageHeader>

            <Tabs defaultValue="dashboard" className="space-y-4">
                <TabsList className="grid w-full grid-cols-3 lg:grid-cols-7">
                    <TabsTrigger value="dashboard">
                        <ClipboardCheck className="h-4 w-4 mr-2" />
                        Dashboard
                    </TabsTrigger>
                    {branches.length > 1 && (
                        <TabsTrigger value="corporate">
                            <Building2 className="h-4 w-4 mr-2" />
                            Vista Corporativa
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="nom251">
                        <FileText className="h-4 w-4 mr-2" />
                        NOM-251
                    </TabsTrigger>
                    <TabsTrigger value="nom035">
                        <Brain className="h-4 w-4 mr-2" />
                        NOM-035
                    </TabsTrigger>
                    <TabsTrigger value="imss">
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        IMSS
                    </TabsTrigger>
                    <TabsTrigger value="nomina">
                        <DollarSign className="h-4 w-4 mr-2" />
                        Nómina
                    </TabsTrigger>
                    <TabsTrigger value="info">
                        <FileText className="h-4 w-4 mr-2" />
                        Info
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="space-y-4">
                    <ComplianceDashboard />
                </TabsContent>

                {branches.length > 1 && (
                    <TabsContent value="corporate" className="space-y-4">
                        <CorporateComplianceGrid />
                    </TabsContent>
                )}

                <TabsContent value="nom251" className="space-y-4">
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-primary" />
                            <h2 className="text-2xl font-semibold">Reporte NOM-251</h2>
                        </div>
                        <p className="text-muted-foreground">
                            Genera reportes de cumplimiento de higiene y salud conforme a los requisitos de COFEPRIS.
                            Incluye todas las inspecciones realizadas, tasas de cumplimiento por categoría, y firma digital.
                        </p>

                        {selectedBranch ? (
                            <NOM251Report branchId={selectedBranch} />
                        ) : (
                            <Card>
                                <CardContent className="flex items-center justify-center py-12">
                                    <div className="text-center space-y-2">
                                        <Building2 className="h-12 w-12 mx-auto text-muted-foreground" />
                                        <p className="text-muted-foreground">Selecciona una sucursal para generar el reporte</p>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </section>
                </TabsContent>

                <TabsContent value="nom035" className="space-y-4">
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Brain className="h-5 w-5 text-info" />
                            <h2 className="text-2xl font-semibold">Reporte NOM-035 - Riesgos Psicosociales</h2>
                        </div>
                        <p className="text-muted-foreground">
                            Evaluación de factores de riesgo psicosocial en el trabajo conforme a la NOM-035-STPS-2018.
                            Incluye encuestas de estrés laboral, niveles de riesgo por empleado, y recomendaciones.
                        </p>

                        {selectedBranch ? (
                            <NOM035Report branchId={selectedBranch} />
                        ) : (
                            <Card>
                                <CardContent className="flex items-center justify-center py-12">
                                    <div className="text-center space-y-2">
                                        <Brain className="h-12 w-12 mx-auto text-muted-foreground" />
                                        <p className="text-muted-foreground">Selecciona una sucursal para generar el reporte</p>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </section>
                </TabsContent>

                <TabsContent value="imss" className="space-y-6">
                    <section className="space-y-4">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-green-600" />
                            <h2 className="text-2xl font-semibold">Integración IMSS</h2>
                        </div>
                        <p className="text-muted-foreground">
                            Genera archivos SUA e IDSE para reportar movimientos ante el IMSS.
                        </p>
                    </section>

                    <Tabs defaultValue="sua" className="space-y-4">
                        <TabsList>
                            <TabsTrigger value="sua">SUA (Salarios)</TabsTrigger>
                            <TabsTrigger value="idse">IDSE (Movimientos)</TabsTrigger>
                        </TabsList>
                        <TabsContent value="sua">
                            <SUAGenerator />
                        </TabsContent>
                        <TabsContent value="idse">
                            <IDSEGenerator />
                        </TabsContent>
                    </Tabs>
                </TabsContent>

                <TabsContent value="nomina" className="space-y-4">
                    <PayrollExport companyId={selectedBranch || ''} />
                </TabsContent>

                <TabsContent value="info">
                    <div className="grid gap-4 md:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Reportes Disponibles
                                </CardTitle>
                                <FileText className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">2</div>
                                <p className="text-xs text-muted-foreground">
                                    NOM-251 y NOM-035
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Requisitos Oficiales
                                </CardTitle>
                                <Shield className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">100%</div>
                                <p className="text-xs text-muted-foreground">
                                    Cumple con normativa vigente
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Validez Legal
                                </CardTitle>
                                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">Oficial</div>
                                <p className="text-xs text-muted-foreground">
                                    Firma digital incluida
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">
                                    Generación
                                </CardTitle>
                                <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">PDF</div>
                                <p className="text-xs text-muted-foreground">
                                    Descarga inmediata
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2 mt-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-primary" />
                                    NOM-251-STPS-2015
                                </CardTitle>
                                <CardDescription>
                                    Funciones de seguridad e higiene - Establecimientos de alimentos y bebidas
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">
                                    Requisitos mínimos de seguridad e higiene para establecimientos de alimentos y bebidas.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Brain className="h-5 w-5 text-info" />
                                    NOM-035-STPS-2018
                                </CardTitle>
                                <CardDescription>
                                    Factores de riesgo psicosocial en el trabajo
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">
                                    Identifica, analiza y previene factores de riesgo psicosocial en el trabajo.
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle>Beneficios Operativos</CardTitle>
                            <CardDescription>
                                El cumplimiento normativo como ventaja operativa
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <h4 className="font-semibold mb-2">Beneficios NOM-251:</h4>
                                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                                        <li>Operaciones más seguras y estandarizadas</li>
                                        <li>Mejora la seguridad alimentaria</li>
                                        <li>Confianza y reputación ante clientes</li>
                                        <li>Auditorías sanitarias siempre listas</li>
                                    </ul>
                                </div>
                                <div>
                                    <h4 className="font-semibold mb-2">Beneficios NOM-035:</h4>
                                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                                        <li>Entorno laboral saludable y productivo</li>
                                        <li>Mejora el bienestar del personal</li>
                                        <li>Reduce rotación de empleados</li>
                                        <li>Previene riesgos psicosociales</li>
                                    </ul>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </PageContainer>
    );
}
