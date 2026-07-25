"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Edit, Calendar } from "lucide-react";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";

interface ProfessionalTabProps {
  profile: any;
  onEdit?: () => void;
  canEdit?: boolean;
}

const statusLabels: Record<string, string> = {
  ONBOARDING: "En Onboarding",
  ACTIVE: "Activo",
  ON_LEAVE: "Licencia / Permiso",
  SUSPENDED: "Suspendido",
  TERMINATED: "Baja / Finiquitado",
  RESIGNED: "Renuncia Voluntaria",
};

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ONBOARDING: "secondary",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  SUSPENDED: "destructive",
  TERMINATED: "destructive",
  RESIGNED: "destructive",
};

const terminationReasonLabels: Record<string, string> = {
  VOLUNTARY_RESIGNATION: "Renuncia Voluntaria",
  TERMINATION_WITH_CAUSE: "Rescisión con Causa Justificada",
  TERMINATION_WITHOUT_CAUSE: "Despido Injustificado / Finiquito",
  CONTRACT_EXPIRED: "Vencimiento de Contrato",
  RETIREMENT: "Jubilación / Retiro",
  DEATH: "Fallecimiento",
  MUTUAL_AGREEMENT: "Mutuo Acuerdo",
  OTHER: "Otro",
};

function InfoField({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-sm font-medium">
        {value || <span className="text-muted-foreground italic">No proporcionado</span>}
      </div>
    </div>
  );
}

function DateField({ label, date }: { label: string; date: any }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-sm font-medium">
        {date ? (
          format(new Date(date), "d 'de' MMM, yyyy", { locale: es })
        ) : (
          <span className="text-muted-foreground italic">No proporcionado</span>
        )}
      </div>
    </div>
  );
}

export function ProfessionalTab({ profile, onEdit, canEdit }: ProfessionalTabProps) {
  // Calculate probation end date if not provided
  const probationEndDate = profile.probationEndDate
    ? new Date(profile.probationEndDate)
    : profile.hireDate
      ? addDays(new Date(profile.hireDate), 90)
      : null;

  const today = new Date();
  const isProbationActive = probationEndDate ? today < probationEndDate : false;

  // Calculate seniority
  const hireDate = profile.hireDate ? new Date(profile.hireDate) : null;
  const seniorityYears = hireDate
    ? Math.floor((today.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 0;

  return (
    <div className="space-y-6">
      {/* Employment Details */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Detalles Laborales</CardTitle>
              <CardDescription>Puesto, departamento e información de contratación.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <InfoField label="Número de Empleado" value={profile.employeeNumber} />
            <InfoField label="Puesto / Cargo" value={profile.position} />
            <InfoField label="Departamento / Área" value={profile.department} />
            <DateField label="Fecha de Ingreso" date={profile.hireDate} />
            <DateField label="Fecha de Antigüedad" date={profile.seniorityDate} />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Antigüedad</Label>
              <div className="text-sm font-medium">
                {seniorityYears > 0 ? `${seniorityYears} año${seniorityYears !== 1 ? "s" : ""}` : "Menos de 1 año"}
              </div>
            </div>
          </div>

          {probationEndDate && (
            <>
              <Separator className="my-4" />
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Label className="text-xs text-muted-foreground">Periodo de Prueba:</Label>
                <Badge variant={isProbationActive ? "secondary" : "outline"}>
                  {isProbationActive
                    ? `Concluye el ${format(probationEndDate, "d 'de' MMM, yyyy", { locale: es })}`
                    : `Concluido el ${format(probationEndDate, "d 'de' MMM, yyyy", { locale: es })}`}
                </Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Employment Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Estado Laboral</CardTitle>
              <CardDescription>Estatus laboral actual e historial.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Actualizar Estatus
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Estatus</Label>
              <div>
                {profile.employeeStatus && (
                  <Badge variant={statusColors[profile.employeeStatus] || "outline"}>
                    {statusLabels[profile.employeeStatus] || profile.employeeStatus}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Activo</Label>
              <div className="text-sm font-medium">
                <Badge variant={profile.isActive ? "default" : "destructive"}>
                  {profile.isActive ? "Sí" : "No"}
                </Badge>
              </div>
            </div>
            <InfoField
              label="Elegible para Recontratación"
              value={
                profile.rehireEligible !== null && profile.rehireEligible !== undefined
                  ? profile.rehireEligible
                    ? "Sí"
                    : "No"
                  : null
              }
            />
          </div>

          {profile.terminationDate && (
            <>
              <Separator className="my-4" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <DateField label="Fecha de Baja" date={profile.terminationDate} />
                <InfoField
                  label="Motivo de Baja"
                  value={
                    profile.terminationReason
                      ? terminationReasonLabels[profile.terminationReason]
                      : null
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Work Schedule */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Jornada y Horario</CardTitle>
              <CardDescription>Horas de trabajo estándar y asignación de turno.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InfoField
              label="Horas Estándar por Semana"
              value={profile.standardHoursPerWeek ? `${profile.standardHoursPerWeek} hrs/semana` : "No especificado"}
            />
          </div>
        </CardContent>
      </Card>

      {/* Skills & Languages */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Habilidades e Idiomas</CardTitle>
              <CardDescription>Competencias del colaborador e idiomas comprobados.</CardDescription>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="mr-2 h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Habilidades y Competencias</Label>
              <div className="flex flex-wrap gap-2">
                {profile.skills && profile.skills.length > 0 ? (
                  profile.skills.map((skill: string, index: number) => (
                    <Badge key={index} variant="secondary">
                      {skill}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground italic">Sin habilidades registradas</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Idiomas</Label>
              <div className="flex flex-wrap gap-2">
                {profile.languages && profile.languages.length > 0 ? (
                  profile.languages.map((lang: string, index: number) => (
                    <Badge key={index} variant="outline">
                      {lang}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground italic">Sin idiomas registrados</span>
                )}
              </div>
            </div>
          </div>

          {profile.notes && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Notas de Recursos Humanos</Label>
                <div className="text-sm bg-muted p-3 rounded">
                  {profile.notes}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
