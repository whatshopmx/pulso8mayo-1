'use client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, FileText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared';
import { ImssSummaryCards } from '@/components/compliance/imss-status';
import { ImssSubNav } from '@/components/compliance/imss-sub-nav';
export default function IMSSPage() {
    return <div className="space-y-6"><PageHeader title="Integración IMSS" description="Estado afiliatorio, movimientos y archivos de trabajo" icon={ShieldCheck} /><ImssSubNav /><ImssSummaryCards />
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
                                    Archivos de actualización salarial
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
                                <p className="font-medium">Historial de Archivos</p>
                                <p className="text-sm text-muted-foreground">
                                    Archivos IDSE y SUA generados, con su estado ante el IMSS
                                </p>
                            </div>
                            <Link href="/dashboard/compliance/imss/reports">
                                <Button size="sm" variant="outline">
                                    <FileText className="h-4 w-4 mr-2" />
                                    Ver Historial
                                </Button>
                            </Link>
                        </div>
                    </div>
                </CardContent>
            </Card>
    </div>;
}
