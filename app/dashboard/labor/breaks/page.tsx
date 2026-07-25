"use client";

import { BreakManagementDashboard } from '@/components/labor/break-management-dashboard';
import { Coffee, Clock, AlertTriangle, CheckCircle, Users, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useRequireRole } from "@/hooks/use-session";

export default function LaborBreaksPage() {
    const { loading, session } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

    if (loading) {
        return null;
    }

    // Stats will be fetched client-side by the dashboard component
    const stats = {
        totalEmployees: 0,
        onBreak: 0,
        missedBreaks: 0,
        compliantBreaks: 0,
        complianceRate: 0,
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href="/dashboard/labor">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Volver a Labor
                        </Link>
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Administración de Breaks</h1>
                        <p className="text-muted-foreground">
                            Monitoreo de descansos de empleados por sucursal - NOM-035
                        </p>
                    </div>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Empleados Activos</CardTitle>
                        <Users className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalEmployees}</div>
                        <p className="text-xs text-muted-foreground">
                            En turno ahora
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">En Break Ahora</CardTitle>
                        <Coffee className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{stats.onBreak}</div>
                        <p className="text-xs text-muted-foreground">
                            Pausa activa
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Breaks Omitidos</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{stats.missedBreaks}</div>
                        <p className="text-xs text-muted-foreground">
                            &gt;5 horas sin descanso
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Cumplimiento</CardTitle>
                        <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.complianceRate}%</div>
                        <p className="text-xs text-muted-foreground">
                            NOM-035 hoy
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Dashboard Component */}
            <BreakManagementDashboard 
                companyId={session?.user?.companyId}
                userRole={session?.user?.role}
                userBranchId={session?.user?.branchId}
            />

            {/* Legal Requirements Info */}
            <Card>
                <CardHeader>
                    <CardTitle>Requisitos de Descanso según LFT</CardTitle>
                    <CardDescription>
                        Normativa aplicable para todas las sucursales
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-blue-50">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Coffee className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="font-medium text-blue-900">Break Obligatorio</p>
                            <p className="text-sm text-blue-700">
                                30 minutos mínimo después de 5 horas continuas de trabajo (Art. 63 LFT)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-green-50">
                        <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <Clock className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                            <p className="font-medium text-green-900">Jornada Máxima</p>
                            <p className="text-sm text-green-700">
                                8 horas diurnas, 7 horas nocturnas. Descanso obligatorio entre jornadas (12 hrs mín.)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-orange-50">
                        <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle className="h-5 w-5 text-orange-600" />
                        </div>
                        <div>
                            <p className="font-medium text-orange-900">Notificación Automática</p>
                            <p className="text-sm text-orange-700">
                                El sistema envía recordatorios por WhatsApp cuando el empleado lleva 4+ horas sin break
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
