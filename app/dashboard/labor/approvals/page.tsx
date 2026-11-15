"use client";

import { useRequireRole } from "@/hooks/use-session"
import { ApprovalManager } from "@/components/labor/approval-manager"
import { LeaveRequestsList } from "@/components/labor/leave-requests-list"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock, CheckCircle, AlertTriangle } from "lucide-react"

export default function LaborApprovalsPage() {
  const { loading, session } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

  if (loading) {
    return null;
  }

  const companyId = session?.user?.companyId;
  const userRole = session?.user?.role;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Aprobaciones de Turnos y Overtime</h1>
        <p className="text-muted-foreground">
          Gestiona las solicitudes de aprobación de horas extras, cambios de turno y permisos
        </p>
      </div>

      <ApprovalManager companyId={companyId} userRole={userRole} />

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes de Permisos Pendientes</CardTitle>
          <CardDescription>
            Autoriza o rechaza permisos y días libres solicitados por tus colaboradores
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeaveRequestsList mode="approvals" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tipos de Aprobación</CardTitle>
          <CardDescription>
            Las solicitudes que puedes gestionar
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="font-medium">Overtime</p>
              <p className="text-sm text-muted-foreground">
                Horas extras detectadas automáticamente
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="font-medium">Cambio de Turno</p>
              <p className="text-sm text-muted-foreground">
                Modificaciones de horario
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="font-medium">Permisos</p>
              <p className="text-sm text-muted-foreground">
                Time off y días libres
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="font-medium">Intercambios</p>
              <p className="text-sm text-muted-foreground">
                Swap entre empleados
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="font-medium">Salida Temprana</p>
              <p className="text-sm text-muted-foreground">
                Aprobaciones de salida anticipada
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
