"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Circle,
  Clock,
  AlertCircle,
  Calendar,
  User,
  FileUp,
} from "lucide-react";
import { DocumentUpload } from "@/components/labor/document-upload";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface OnboardingTabProps {
  onboarding: any;
  steps: any[];
}

const stepStatusIcons: Record<string, typeof CheckCircle> = {
  COMPLETED: CheckCircle,
  IN_PROGRESS: Clock,
  PENDING: Circle,
  OVERDUE: AlertCircle,
};

const stepCategoryColors: Record<string, string> = {
  DOCUMENTS: "bg-blue-100 text-blue-800",
  TRAINING: "bg-green-100 text-green-800",
  SETUP: "bg-orange-100 text-orange-800",
  COMPLIANCE: "bg-red-100 text-red-800",
  ORIENTATION: "bg-purple-100 text-purple-800",
};

const stepCategoryLabels: Record<string, string> = {
  DOCUMENTS: "Documentación",
  TRAINING: "Capacitación",
  SETUP: "Equipamiento / Accesos",
  COMPLIANCE: "Cumplimiento NOM",
  ORIENTATION: "Inducción",
};

export function OnboardingTab({ onboarding, steps }: OnboardingTabProps) {
  const [uploadingStepId, setUploadingStepId] = useState<string | null>(null);

  if (!onboarding) {
    return (
      <div className="text-center py-12">
        <Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Sin Registro de Onboarding</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Este colaborador aún no ha sido inscrito en un proceso de inducción y onboarding.
        </p>
        <Button>Iniciar Onboarding</Button>
      </div>
    );
  }

  const progressPercentage = onboarding.progressPercentage || 0;
  const completedSteps = onboarding.completedSteps || 0;
  const totalSteps = onboarding.totalSteps || steps?.length || 0;

  return (
    <div className="space-y-6">
      {/* Onboarding Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Progreso del Onboarding</CardTitle>
          <CardDescription>
            Seguimiento al cumplimiento del plan de incorporación e inducción
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">
                  {completedSteps} de {totalSteps} pasos completados
                </Label>
                <div className="text-xs text-muted-foreground mt-1">
                  Iniciado el{" "}
                  {onboarding.startDate
                    ? format(new Date(onboarding.startDate), "d 'de' MMM, yyyy", { locale: es })
                    : "N/A"}
                </div>
              </div>
              <Badge
                variant={
                  onboarding.status === "COMPLETED"
                    ? "default"
                    : onboarding.status === "IN_PROGRESS"
                      ? "secondary"
                      : "outline"
                }
              >
                {onboarding.status === "COMPLETED"
                  ? "Completado"
                  : onboarding.status === "IN_PROGRESS"
                    ? "En Progreso"
                    : onboarding.status || "N/A"}
              </Badge>
            </div>
            <Progress value={progressPercentage} className="h-3" />

            {onboarding.targetEndDate && (
              <div className="text-sm text-muted-foreground">
                Fecha objetivo de conclusión:{" "}
                {format(new Date(onboarding.targetEndDate), "d 'de' MMM, yyyy", { locale: es })}
              </div>
            )}

            {/* Assigned Buddy/Mentor */}
            {(onboarding.assignedBuddyId || onboarding.assignedMentorId) && (
              <>
                <Separator className="my-4" />
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Acompañamiento Asignado</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {onboarding.assignedBuddyId && (
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <Avatar>
                          <AvatarFallback>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="text-sm font-medium">Buddy (Compañero de Apoyo)</div>
                          <div className="text-xs text-muted-foreground">
                            ID Usuario: {onboarding.assignedBuddyId}
                          </div>
                        </div>
                      </div>
                    )}
                    {onboarding.assignedMentorId && (
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                        <Avatar>
                          <AvatarFallback>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="text-sm font-medium">Mentor Asignado</div>
                          <div className="text-xs text-muted-foreground">
                            ID Usuario: {onboarding.assignedMentorId}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step Checklist */}
      <Card>
        <CardHeader>
          <CardTitle>Lista de Pasos e Inducción</CardTitle>
          <CardDescription>
            Tareas y evidencias del expediente de onboarding
          </CardDescription>
        </CardHeader>
        <CardContent>
          {steps && steps.length > 0 ? (
            <div className="space-y-2">
              {steps.map((step: any, index: number) => {
                const StatusIcon = stepStatusIcons[step.status] || Circle;
                const categoryColor =
                  stepCategoryColors[step.stepCategory] || "bg-gray-100 text-gray-800";

                return (
                  <div
                    key={step.id || index}
                    className={`p-4 border rounded-lg ${
                      step.status === "COMPLETED"
                        ? "bg-green-50 border-green-200"
                        : step.status === "OVERDUE"
                          ? "bg-red-50 border-red-200"
                          : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <StatusIcon
                          className={`h-5 w-5 mt-0.5 ${
                            step.status === "COMPLETED"
                              ? "text-green-600"
                              : step.status === "OVERDUE"
                                ? "text-red-600"
                                : step.status === "IN_PROGRESS"
                                  ? "text-blue-600"
                                  : "text-muted-foreground"
                          }`}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{step.stepName}</span>
                            <Badge className={categoryColor} variant="outline">
                              {stepCategoryLabels[step.stepCategory] || step.stepCategory}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            {step.dueDate && (
                              <span>
                                Vencimiento:{" "}
                                {format(new Date(step.dueDate), "d 'de' MMM, yyyy", {
                                  locale: es,
                                })}
                              </span>
                            )}
                            {step.completedDate && (
                              <span>
                                Completado:{" "}
                                {format(new Date(step.completedDate), "d 'de' MMM, yyyy", {
                                  locale: es,
                                })}
                              </span>
                            )}
                          </div>
                          {step.notes && (
                            <div className="text-xs text-muted-foreground mt-2">
                              {step.notes}
                            </div>
                          )}
                        </div>
                      </div>
                      {step.status === "PENDING" || step.status === "IN_PROGRESS" ? (
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex gap-2">
                             {step.stepCategory === "DOCUMENTS" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setUploadingStepId(uploadingStepId === step.id ? null : step.id)}
                              >
                                <FileUp className="h-4 w-4 mr-2" />
                                {uploadingStepId === step.id ? "Cancelar" : "Subir Evidencia"}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const response = await fetch(
                                    "/api/employees/lifecycle?type=onboarding-step",
                                    {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({
                                        stepId: step.id,
                                        status: "COMPLETED",
                                      }),
                                    }
                                  );
                                  if (response.ok) {
                                    window.location.reload();
                                  }
                                } catch (error) {
                                  console.error("Error updating step:", error);
                                }
                              }}
                            >
                              Marcar Completado
                            </Button>
                          </div>
                          
                          {uploadingStepId === step.id && (
                            <div className="w-[300px] mt-2 p-4 border rounded-lg bg-white shadow-lg z-10">
                              <DocumentUpload 
                                documentType={step.stepCategory === "DOCUMENTS" ? "OTHER" : step.stepCategory}
                                documentName={step.stepName}
                                employeeId={onboarding.userId}
                                companyId={onboarding.companyId}
                                isRequired={true}
                                onSuccess={() => window.location.reload()}
                                onCancel={() => setUploadingStepId(null)}
                              />
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <Circle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Sin Pasos Configurados</h3>
              <p className="text-muted-foreground text-sm">
                No se han registrado pasos de onboarding para este colaborador.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
