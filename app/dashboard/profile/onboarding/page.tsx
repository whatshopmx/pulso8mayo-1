"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/hooks/use-session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  Circle,
  FileUp,
  Clock,
  Calendar,
  Sparkles,
  ChevronRight,
  Info,
  Loader2,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { DocumentUpload } from "@/components/labor/document-upload";

export default function EmployeeOnboardingPortal() {
  const { session } = useSession();
  const [onboarding, setOnboarding] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStep, setUpdatingStep] = useState<string | null>(null);
  const [uploadingStepId, setUploadingStepId] = useState<string | null>(null);

  const fetchOnboarding = async () => {
    if (!session?.user?.id || !session?.user?.companyId) return;
    try {
      const res = await fetch(`/api/employees/lifecycle?userId=${session.user.id}&companyId=${session.user.companyId}&type=onboarding`);
      if (res.ok) {
        const data = await res.json();
        // data.data.onboardings is an array
        setOnboarding(data.data.onboardings?.[0] || null);
      }
    } catch (e) {
      console.error("Error fetching onboarding:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOnboarding();
  }, [session]);

  const handleCompleteStep = async (stepId: string) => {
    setUpdatingStep(stepId);
    try {
      const res = await fetch(`/api/employees/lifecycle?type=onboarding-step`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          status: "COMPLETED",
          completedBy: session?.user?.id,
        }),
      });

      if (res.ok) {
        toast.success("¡Paso completado!");
        fetchOnboarding();
      } else {
        toast.error("No se pudo actualizar el paso");
      }
    } catch (e) {
      toast.error("Error de conexión");
    } finally {
      setUpdatingStep(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Cargando tu proceso de bienvenida...</p>
      </div>
    );
  }

  if (!onboarding) {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="pt-12 pb-12 flex flex-col items-center text-center space-y-4">
          <div className="bg-primary/10 p-4 rounded-full">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Bienvenido a Pulso</CardTitle>
          <CardDescription>
            No tienes un proceso de onboarding activo asignado en este momento. 
            Si crees que esto es un error, contacta a Recursos Humanos.
          </CardDescription>
          <Button variant="outline" asChild>
            <a href="/dashboard">Ir al Tablero Principal</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const nextStep = onboarding.steps?.find((s: any) => s.status !== "COMPLETED");
  const completedCount = onboarding.steps?.filter((s: any) => s.status === "COMPLETED").length || 0;
  const totalCount = onboarding.steps?.length || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-4 lg:p-8">
      {/* Welcome Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/90 to-primary p-8 md:p-12 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold">¡Hola, {session?.user?.name}! 👋</h1>
            <p className="text-primary-foreground/80 max-w-md">
              Estamos muy emocionados de tenerte en el equipo. Completa tus pasos de bienvenida para empezar al 100%.
            </p>
          </div>
          <div className="bg-white/20 backdrop-blur-md rounded-2xl p-6 border border-white/20 min-w-[200px]">
            <div className="flex justify-between items-end mb-2">
              <span className="text-sm font-medium">Progreso General</span>
              <span className="text-2xl font-bold">{onboarding.progressPercentage}%</span>
            </div>
            <Progress value={onboarding.progressPercentage} className="h-2 bg-white/20" />
            <p className="text-xs mt-3 opacity-80 uppercase tracking-wider font-bold">
              {completedCount} de {totalCount} pasos listos
            </p>
          </div>
        </div>
        {/* Decorative elements */}
        <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[-20%] left-[-10%] w-64 h-64 bg-primary-foreground/10 rounded-full blur-3xl" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Steps List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2 px-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" /> Mi Guía de Inicio
          </h2>
          
          <div className="space-y-3">
            {onboarding.steps?.map((step: any, idx: number) => (
              <Card 
                key={step.id} 
                className={`transition-all border-none shadow-sm hover:shadow-md ${
                  step.status === "COMPLETED" ? "opacity-70 bg-slate-50" : "bg-white"
                }`}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center ${
                    step.status === "COMPLETED" ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
                  }`}>
                    {step.status === "COMPLETED" ? <CheckCircle2 className="h-6 w-6" /> : <span className="font-bold">{idx + 1}</span>}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm font-semibold truncate ${step.status === "COMPLETED" ? "text-muted-foreground line-through" : ""}`}>
                      {step.stepName}
                    </h3>
                    <div className="flex items-center gap-3 mt-1">
                      <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 uppercase font-bold text-muted-foreground">
                        {step.stepCategory}
                      </Badge>
                      {step.dueDate && (
                        <span className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> 
                          Vence {format(new Date(step.dueDate), "dd MMM", { locale: es })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {step.status !== "COMPLETED" ? (
                      <div className="flex flex-col items-end gap-2">
                        {step.stepCategory === "DOCUMENTS" ? (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8 text-xs"
                            onClick={() => setUploadingStepId(uploadingStepId === step.id ? null : step.id)}
                          >
                            <FileUp className="mr-2 h-3.5 w-3.5" />
                            {uploadingStepId === step.id ? "Cancelar" : "Subir Documento"}
                          </Button>
                        ) : (
                          <Button 
                            size="sm" 
                            variant={idx === (onboarding.steps.findIndex((s:any) => s.status !== "COMPLETED")) ? "default" : "outline"}
                            className="h-8 text-xs px-3"
                            disabled={updatingStep === step.id}
                            onClick={() => handleCompleteStep(step.id)}
                          >
                            {updatingStep === step.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Completar"
                            )}
                            <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="text-green-600 p-1.5">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                </CardContent>
                
                {uploadingStepId === step.id && (
                  <CardFooter className="pt-0 pb-4 border-t px-4">
                    <div className="w-full pt-4">
                      <DocumentUpload 
                        documentType={step.stepCategory === "DOCUMENTS" ? "OTHER" : step.stepCategory}
                        documentName={step.stepName}
                        employeeId={session?.user?.id || ""}
                        companyId={session?.user?.companyId}
                        isRequired={true}
                        onSuccess={() => {
                          handleCompleteStep(step.id);
                          setUploadingStepId(null);
                        }}
                        onCancel={() => setUploadingStepId(null)}
                      />
                    </div>
                  </CardFooter>
                )}
              </Card>
            ))}
          </div>
        </div>

        {/* Sidebar Context */}
        <div className="space-y-6">
          {/* Next Task Card */}
          {nextStep && (
            <Card className="bg-primary/5 border-primary/20 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Siguiente Paso
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm font-medium">{nextStep.stepName}</p>
                <Button className="w-full" onClick={() => handleCompleteStep(nextStep.id)}>
                  Completar Ahora
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Mentors Card */}
          <Card className="shadow-none border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Users className="h-4 w-4" /> Tu Equipo Solar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${onboarding.assignedBuddyId || 'buddy'}`} alt="Buddy" className="w-full h-full" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold">Tu Buddy</p>
                  <p className="text-xs text-muted-foreground">Te ayudará el día a día</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${onboarding.assignedMentorId || 'mentor'}`} alt="Mentor" className="w-full h-full" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold">Tu Mentor</p>
                  <p className="text-xs text-muted-foreground">Guía en tu carrera</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-blue-50/50 border-blue-100 shadow-none">
            <CardContent className="p-4 flex gap-3 text-blue-900">
              <Info className="h-5 w-5 shrink-0" />
              <div className="text-xs space-y-1">
                <p className="font-bold uppercase tracking-tight">Recuerda:</p>
                <p>Tus documentos serán validados por RRHH en un plazo de 24-48 horas hábiles.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
