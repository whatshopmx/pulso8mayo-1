import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmployeeDocumentManager } from "@/components/labor/employee-document-manager"
import { FileText, CheckCircle, AlertTriangle, Clock, Shield, Users } from "lucide-react"
import { auth } from "@/lib/auth"
import { requireTenant } from "@/lib/tenant-context"
import { db } from "@/lib/db"
import { employeeDocuments, users } from "@/lib/db/schema"
import { eq, and, sql, isNull } from "drizzle-orm"

import { headers } from "next/headers"

export default async function LaborDocumentsPage() {
    let summary = {
        totalDocuments: 0,
        validDocuments: 0,
        pendingDocuments: 0,
        expiredDocuments: 0,
        missingRequiredCount: 0,
        totalEmployees: 0,
        overallCompliance: 0
    }

    try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (!session || (session.user.role !== "ADMIN" && session.user.role !== "GERENTE")) {
            return (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                    <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold">Acceso Denegado</h1>
                    <p className="text-muted-foreground">No tienes los permisos necesarios para acceder a la gestión documental.</p>
                </div>
            );
        }

        const tenant = await requireTenant()
        
        // Get document stats directly from DB
        const docs = await db.select()
            .from(employeeDocuments)
            .where(eq(employeeDocuments.companyId, tenant.id));

        const totalDocuments = docs.length;
        const validDocuments = docs.filter(d => d.isValid && d.status === 'VALIDATED').length;
        const pendingDocuments = docs.filter(d => d.status === 'PENDING').length;
        const expiredDocuments = docs.filter(d => d.status === 'EXPIRED' || !d.isValid).length;

        // Get employee count directly from DB
        const employees = await db.select({ id: users.id })
            .from(users)
            .where(and(eq(users.companyId, tenant.id), isNull(users.deletedAt)));

        // Calculate missing required documents
        const requiredTypes = ['CONTRACT', 'ID', 'TAX_ID', 'BANK_INFO'] as const
        let missingRequiredCount = 0
        for (const emp of employees) {
            const empDocs = docs.filter(d => d.userId === emp.id && d.status === 'VALIDATED' && d.isValid)
            const existingTypes = new Set(empDocs.map(d => d.documentType))
            missingRequiredCount += requiredTypes.filter(type => !existingTypes.has(type)).length
        }

        const overallCompliance = employees.length > 0
            ? Math.round((employees.filter(emp => {
                const empDocs = docs.filter(d => d.userId === emp.id && d.status === 'VALIDATED' && d.isValid)
                const existingTypes = new Set(empDocs.map(d => d.documentType))
                return requiredTypes.every(type => existingTypes.has(type))
            }).length / employees.length) * 100)
            : 0

        summary = {
            totalDocuments,
            validDocuments,
            pendingDocuments,
            expiredDocuments,
            missingRequiredCount,
            totalEmployees: employees.length,
            overallCompliance
        }
    } catch (error) {
        console.error("Error loading document stats:", error)
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Expediente Laboral Digital</h1>
                <p className="text-muted-foreground">
                    Gestión documental de empleados para cumplimiento de auditorías
                </p>
            </div>

            {/* Info Cards */}
            <div className="grid gap-4 md:grid-cols-5">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Documentos</CardTitle>
                        <FileText className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.totalDocuments}</div>
                        <p className="text-xs text-muted-foreground">
                            Documentos cargados
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Válidos</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{summary.validDocuments}</div>
                        <p className="text-xs text-muted-foreground">
                            Documentos vigentes
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
                        <Clock className="h-4 w-4 text-yellow-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">{summary.pendingDocuments}</div>
                        <p className="text-xs text-muted-foreground">
                            Por validar
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Expirados</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{summary.expiredDocuments}</div>
                        <p className="text-xs text-muted-foreground">
                            Requieren renovación
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Cumplimiento</CardTitle>
                        <Shield className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.overallCompliance}%</div>
                        <p className="text-xs text-muted-foreground">
                            {summary.totalEmployees} empleados
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Document Manager Component */}
            <EmployeeDocumentManager />

            {/* Required Documents Info */}
            <Card>
                <CardHeader>
                    <CardTitle>Documentos Obligatorios por Ley</CardTitle>
                    <CardDescription>
                        Documentos mínimos requeridos para cada empleado según LFT
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-red-50">
                        <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                            <FileText className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                            <p className="font-medium text-red-900">Contrato Individual</p>
                            <p className="text-sm text-red-700">
                                Contrato individual de trabajo por escrito. Obligatorio según Artículo 25 LFT.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-orange-50">
                        <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                            <FileText className="h-5 w-5 text-orange-600" />
                        </div>
                        <div>
                            <p className="font-medium text-orange-900">Identificación Oficial</p>
                            <p className="text-sm text-orange-700">
                                INE, pasaporte o cédula profesional. Para verificación de identidad.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-blue-50">
                        <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <FileText className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="font-medium text-blue-900">RFC</p>
                            <p className="text-sm text-blue-700">
                                Registro Federal de Contribuyentes. Requerido para nómina y SAT.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3 p-4 border rounded-lg bg-green-50">
                        <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <FileText className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                            <p className="font-medium text-green-900">Información Bancaria</p>
                            <p className="text-sm text-green-700">
                                Cuenta bancaria para depósito de nómina. CLABE interbancaria.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Additional Documents */}
            <Card>
                <CardHeader>
                    <CardTitle>Documentos Adicionales Recomendados</CardTitle>
                    <CardDescription>
                        Otros documentos útiles para cumplimiento y operaciones
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <Shield className="h-5 w-5 text-purple-600" />
                        <div>
                            <p className="font-medium text-sm">Comprobante de Domicilio</p>
                            <p className="text-xs text-muted-foreground">
                                Para verificación de ubicación
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <CheckCircle className="h-5 w-5 text-indigo-600" />
                        <div>
                            <p className="font-medium text-sm">Certificados de Capacitación</p>
                            <p className="text-xs text-muted-foreground">
                                Constancias de cursos y entrenamientos
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <CheckCircle className="h-5 w-5 text-pink-600" />
                        <div>
                            <p className="font-medium text-sm">Exámenes Médicos</p>
                            <p className="text-xs text-muted-foreground">
                                Certificados de salud vigentes
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <CheckCircle className="h-5 w-5 text-cyan-600" />
                        <div>
                            <p className="font-medium text-sm">Permisos Especiales</p>
                            <p className="text-xs text-muted-foreground">
                                Licencias y permisos requeridos
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <CheckCircle className="h-5 w-5 text-amber-600" />
                        <div>
                            <p className="font-medium text-sm">Nóminas Firmadas</p>
                            <p className="text-xs text-muted-foreground">
                                Acuses de recibo de pago
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <CheckCircle className="h-5 w-5 text-emerald-600" />
                        <div>
                            <p className="font-medium text-sm">Otros Documentos</p>
                            <p className="text-xs text-muted-foreground">
                                Documentación adicional relevante
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Compliance Info */}
            <Card>
                <CardHeader>
                    <CardTitle>Importancia del Cumplimiento Documental</CardTitle>
                    <CardDescription>
                        Consecuencias de no mantener expedientes completos
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-foreground">Multas y Sanciones</p>
                            <p className="text-muted-foreground">
                                La STPS puede imponer multas de hasta 250 veces el UMA por no contar con expedientes completos.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-foreground">Problemas en Auditorías</p>
                            <p className="text-muted-foreground">
                                Documentación incompleta puede resultar en observaciones negativas durante inspecciones.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-foreground">Riesgos Legales</p>
                            <p className="text-muted-foreground">
                                En caso de controversias laborales, la falta de documentación puede perjudicar a la empresa.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
