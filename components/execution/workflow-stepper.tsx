"use client";

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { defineStepper } from "@stepperize/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertCircle, Camera, ArrowRight, Trash2, Video, Mic, Info, CalendarIcon, Upload, MapPin } from "lucide-react";
import { toast } from "sonner";
import { CameraCapture } from "@/components/shared/camera-capture";
import { usePhotoUpload } from "@/components/shared/use-photo-upload";
import { useAudioRecorder } from "@/components/shared/use-audio-recorder";

import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// Interface for props
interface WorkflowStep {
    id: string;
    title: string;
    description: string;
    type: 'TEXT' | 'NUMBER' | 'SELECT' | 'CHECKBOX' | 'DATE' | 'INFO' | 'SIGNATURE' | 'PHOTO' | 'TIMER' | 'VIDEO' | 'AUDIO' | 'LOCATION';
    config?: Record<string, unknown>;
    required?: boolean;
}

interface WorkflowInstance {
    id: string;
    status: string;
    templateId: string;
    assignedTo: string;
    createdAt: string;
    completedAt?: string;
}

interface WorkflowStepExecution {
    id: string;
    stepId: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    value?: string;
    evidenceUrl?: string;
    completedAt?: string;
    aiVerification?: {
        passed: boolean;
        confidence: number;
        reason?: string;
    };
}

interface WorkflowStepperProps {
    instance: WorkflowInstance;
    steps: WorkflowStep[];
    existingSteps: WorkflowStepExecution[];
    token?: string;
    executionId?: string;
    mode?: 'execution' | 'preview';
}

interface StepOption {
    value?: string;
    label?: string;
}

interface RemediationState {
    active: boolean;
    instruction?: string;
    waitSeconds?: number;
    stepIndex?: number;
}

interface AIFeedback {
    passed: boolean;
    reason?: string;
}

// 1. Wrapper to handle dynamic step definition
export function WorkflowStepper({ steps, existingSteps, mode = 'execution', ...props }: WorkflowStepperProps) {
    if (!steps || steps.length === 0) {
        return (
            <div className="max-w-md mx-auto p-4">
                <Card>
                    <CardContent className="p-6 text-center text-muted-foreground">
                        No hay pasos definidos en este workflow.
                    </CardContent>
                </Card>
            </div>
        );
    }

    const { useStepper } = useMemo(() => {
        const stepDefs = steps.map(s => ({ id: s.id, title: s.title })) as [{ id: string, title: string }, ...{ id: string, title: string }[]];
        if (stepDefs.length === 0) {
            return defineStepper({ id: "empty", title: "No Steps" });
        }
        return defineStepper(...stepDefs);
    }, [steps]);

    const initialStepId = useMemo(() => {
        if (mode === 'preview') return steps[0]?.id;
        if (props.instance.status === 'COMPLETED') return steps[0]?.id;

        const firstIncomplete = steps.find(s => {
            const existing = existingSteps.find(es => es.stepId === s.id);
            return !existing || existing.status !== 'COMPLETED';
        });

        return firstIncomplete ? firstIncomplete.id : steps[steps.length - 1]?.id || steps[0]?.id;
    }, [steps, existingSteps, props.instance.status, mode]);

    if (props.instance.status === 'COMPLETED' && mode === 'execution') {
        return <CompletionScreen />;
    }

    const stepIdsKey = useMemo(() => steps.map(s => s.id).join(','), [steps]);

    return (
        <StepperContent
            key={stepIdsKey}
            useStepper={useStepper}
            steps={steps}
            initialStep={initialStepId}
            existingSteps={existingSteps}
            mode={mode}
            {...props}
        />
    );
}

// 2. Content Component
function StepperContent({ useStepper, steps, initialStep, token, executionId, existingSteps, mode, instance }: {
    useStepper: any;
    steps: WorkflowStep[];
    initialStep: string;
    token?: string;
    executionId?: string;
    existingSteps: WorkflowStepExecution[];
    mode: 'execution' | 'preview';
  instance: WorkflowInstance;
}) {
    const stepper = useStepper({ initialStep });

    // Force-set the initial step on mount (stepperize v6 may not apply initialStep reliably)
    useEffect(() => {
        if (!stepper.state.current && initialStep && stepper.navigation.goTo) {
            stepper.navigation.goTo(initialStep);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // All hooks MUST be called before any conditional returns
    // Form State
    const [value, setValue] = useState("");
    const [evidenceUrl, setEvidenceUrl] = useState<string | string[]>("");
    const [loading, setLoading] = useState(false);
    const [aiFeedback, setAiFeedback] = useState<{ passed: boolean; reason?: string } | null>(null);
    const [checkboxValues, setCheckboxValues] = useState<Record<string, boolean>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Auto-save functionality
    const [autoSaveLoading] = useState(false);
    const [lastSaved] = useState<Date | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const { uploadPhotos, uploading: uploadingPhotos, progress: uploadProgress } = usePhotoUpload();
  const audioRecorder = useAudioRecorder();

    // Remediation State
    const [remediation, setRemediation] = useState<{
        active: boolean;
        instruction?: string;
        waitSeconds?: number;
        stepIndex?: number;
    }>({ active: false });

    // Get current step definition — fallback to first step if stepper.state.current is null
    const currentStepDef = steps.find((s) => s.id === stepper.state.current?.id) || steps[0];

    // Auto-save effect
    const performAutoSave = useCallback(async () => {
        if (!currentStepDef || mode !== 'execution' || !hasUnsavedChanges) return;

        setHasUnsavedChanges(false);
        try {
            let submitValue = value;
            if (currentStepDef.type === 'CHECKBOX') {
                submitValue = JSON.stringify(checkboxValues);
            } else if (currentStepDef.type === 'INFO') {
                submitValue = "ACKNOWLEDGED";
            }

            let res;
            if (token) {
                res = await fetch(`/api/workflows/public/${token}/step`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        stepId: currentStepDef.id,
                        value: typeof submitValue === 'string' ? submitValue : JSON.stringify(submitValue),
                        evidenceUrl: Array.isArray(evidenceUrl) ? JSON.stringify(evidenceUrl) : evidenceUrl,
                        status: 'IN_PROGRESS'
                    })
                });
            } else if (executionId) {
                res = await fetch(`/api/workflows/executions/${executionId}/steps/${currentStepDef.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        value: typeof submitValue === 'string' ? submitValue : JSON.stringify(submitValue),
                        evidenceUrl: Array.isArray(evidenceUrl) ? JSON.stringify(evidenceUrl) : evidenceUrl,
                        status: 'IN_PROGRESS'
                    })
                });
            }

            if (res?.ok) {
                toast.success("Progreso guardado automáticamente");
            }
        } catch (error) {
            console.error("Auto-save failed:", error);
        }
    }, [currentStepDef, mode, hasUnsavedChanges, value, checkboxValues, token, executionId, evidenceUrl]);

    useEffect(() => {
        if (mode !== 'execution') return;

        const autoSaveInterval = setInterval(async () => {
            if (hasUnsavedChanges && currentStepDef) {
                await performAutoSave();
            }
        }, 30000); // 30 seconds

        return () => clearInterval(autoSaveInterval);
    }, [hasUnsavedChanges, currentStepDef, mode, performAutoSave]);

    const markAsUnsaved = () => {
        setHasUnsavedChanges(true);
    };

    // Progress calculation
    const progress = useMemo(() => {
        const total = steps.length;
        const currentIdx = steps.findIndex((s) => s.id === stepper.state.current?.id);
        return total > 0 ? ((currentIdx) / total) * 100 : 0;
    }, [stepper.state.current?.id, steps]);

    // Validation: can the current step be submitted?
    const canSubmit = useMemo(() => {
        if (!currentStepDef) return false;
        const type = currentStepDef.type;
        if (type === 'INFO') return true;
        if (type === 'CHECKBOX') {
            const items = currentStepDef.config?.options || currentStepDef.config?.items || [];
            if (Array.isArray(items) && items.length === 0) return true;
            return Object.values(checkboxValues).some(v => v);
        }
        if (type === 'PHOTO') {
            return Array.isArray(evidenceUrl) ? evidenceUrl.length > 0 : !!evidenceUrl;
        }
        return !!value || !!evidenceUrl;
    }, [currentStepDef, value, evidenceUrl, checkboxValues]);

    // Validation function
    const validateCurrentStep = () => {
        if (!currentStepDef) return false;
        if (!currentStepDef.required) return true;
        
        if (currentStepDef.type === 'CHECKBOX') {
            const items = currentStepDef.config?.options || currentStepDef.config?.items || [];
            if (Array.isArray(items) && items.length > 0) {
                return Object.values(checkboxValues).some(v => v);
            }
            return true;
        }
        if (currentStepDef.type === 'PHOTO') {
            return Array.isArray(evidenceUrl) ? evidenceUrl.length > 0 : !!evidenceUrl;
        }
        return !!value || !!evidenceUrl;
    };

    // File upload handler for PHOTO steps
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast.error("Solo se permiten imágenes");
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Imagen demasiado grande (máx 10MB)");
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    try {
      const results = await uploadPhotos(validFiles);
      const urls = results.map((r) => r.url);
      setEvidenceUrl(prev => {
        const current = Array.isArray(prev) ? prev : prev ? [prev] : [];
        return [...current, ...urls];
      });
    } catch {
      toast.error("Error al subir las fotos");
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadPhotos]);

  // Subida de un solo archivo de video o audio. /api/upload firma cualquier
  // content-type, así que el mismo presign de las fotos sirve aquí.
  const uploadMediaFile = useCallback(async (file: File, kind: 'video' | 'audio') => {
    const limitMb = kind === 'video' ? 100 : 25;
    if (file.size > limitMb * 1024 * 1024) {
      toast.error(
        kind === 'video'
          ? `El video pesa más de ${limitMb} MB. Graba uno más corto.`
          : `La nota de voz pesa más de ${limitMb} MB. Graba una más corta.`
      );
      return;
    }

    try {
      const [result] = await uploadPhotos([file]);
      if (!result) return;
      setValue(result.url);
      setEvidenceUrl(result.url);
      setHasUnsavedChanges(true);
    } catch {
      toast.error(
        kind === 'video'
          ? "No pudimos subir el video. Revisa tu conexión e inténtalo de nuevo."
          : "No pudimos subir la nota de voz. Revisa tu conexión e inténtalo de nuevo."
      );
    }
  }, [uploadPhotos]);

  const handleVideoSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadMediaFile(file, 'video');
    if (videoInputRef.current) videoInputRef.current.value = "";
  }, [uploadMediaFile]);

  // Captura de ubicación real. Antes este tipo de paso no tenía rama de render
  // en el stepper: el paso quedaba sin control, `canSubmit` nunca se cumplía y
  // la ejecución se atoraba ahí para siempre.
  const [capturingLocation, setCapturingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const captureLocation = useCallback(async () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocationError("Este navegador no puede obtener la ubicación. Abre el flujo desde otro dispositivo.");
      return;
    }

    setCapturingLocation(true);
    setLocationError(null);

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const { latitude, longitude, accuracy } = position.coords;
      // Guardamos la coordenada real: es la evidencia que se le muestra a un
      // inspector, no una marca de que "algo se capturó".
      setValue(JSON.stringify({
        latitude,
        longitude,
        accuracy,
        capturedAt: new Date().toISOString(),
      }));
      setHasUnsavedChanges(true);
    } catch (error) {
      const code = (error as GeolocationPositionError)?.code;
      setLocationError(
        code === 1
          ? "Permiso de ubicación denegado. Habilítalo en tu navegador y vuelve a intentarlo."
          : code === 3
            ? "La ubicación tardó demasiado. Sal al exterior o revisa la señal e inténtalo de nuevo."
            : "No pudimos obtener la ubicación. Inténtalo de nuevo."
      );
    } finally {
      setCapturingLocation(false);
    }
  }, []);

  const handleStopRecording = useCallback(async () => {
    const file = await audioRecorder.stop();
    if (!file) {
      toast.error("No se grabó audio. Inténtalo de nuevo.");
      return;
    }
    await uploadMediaFile(file, 'audio');
  }, [audioRecorder, uploadMediaFile]);

  const handleCameraConfirm = useCallback(async (files: File[]) => {
    try {
      const results = await uploadPhotos(files);
      const urls = results.map((r) => r.url);
      setEvidenceUrl(prev => {
        const current = Array.isArray(prev) ? prev : prev ? [prev] : [];
        return [...current, ...urls];
      });
    } catch {
      toast.error("Error al subir las fotos");
    }
  }, [uploadPhotos]);

    // Early return AFTER all hooks — only if we don't even have steps to fallback to
    if (!stepper.state.current && !currentStepDef) {
        return (
            <div className="max-w-md mx-auto p-4">
                <Card>
                    <CardContent className="p-6 text-center text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                        Cargando pasos...
                    </CardContent>
                </Card>
            </div>
        );
    }

    const handleNext = async () => {
        // Validate required fields before proceeding
        if (!validateCurrentStep()) {
            toast.error("Por favor completa todos los campos requeridos antes de continuar");
            return;
        }
        
        setLoading(true);
        setAiFeedback(null);
        setRemediation({ active: false });

        if (mode === 'preview') {
            await new Promise(resolve => setTimeout(resolve, 500));
            toast.success("Paso verificado (Modo Preview)");

            if (stepper.state.isLast) {
                toast.success("Workflow Completado (Preview)");
                stepper.navigation.goTo(steps[0].id);
            } else {
                stepper.navigation.next();
            }

            setValue("");
            setEvidenceUrl("");
            setCheckboxValues({});
            setLoading(false);
            return;
        }

        try {
            let submitValue = value;
            if (currentStepDef.type === 'CHECKBOX') {
                submitValue = JSON.stringify(checkboxValues);
            } else if (currentStepDef.type === 'INFO') {
                submitValue = "ACKNOWLEDGED";
            }

            let res;
            if (token) {
                res = await fetch(`/api/workflows/public/${token}/step`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        stepId: currentStepDef.id,
                        value: typeof submitValue === 'string' ? submitValue : JSON.stringify(submitValue),
                        evidenceUrl: Array.isArray(evidenceUrl) ? JSON.stringify(evidenceUrl) : evidenceUrl,
                        status: 'COMPLETED'
                    })
                });
            } else if (executionId) {
                res = await fetch(`/api/workflows/executions/${executionId}/steps/${currentStepDef.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        value: typeof submitValue === 'string' ? submitValue : JSON.stringify(submitValue),
                        evidenceUrl: Array.isArray(evidenceUrl) ? JSON.stringify(evidenceUrl) : evidenceUrl,
                        status: 'COMPLETED'
                    })
                });
            } else {
                throw new Error("No context (token or executionId) provided");
            }

            if (!res.ok) throw new Error("Failed to submit step");
            const data = await res.json();

            // Check for Remediation Protocols
            if (data.incidents && Array.isArray(data.incidents)) {
                const remediationInc = data.incidents.find((i: any) => i.status === 'IN_REMEDIATION');
                if (remediationInc && remediationInc.remediationProtocol) {
                    const remSteps = remediationInc.remediationProtocol.steps || [];
                    const firstStep = remSteps[0];

                    if (firstStep) {
                        toast.warning("Problema de cumplimiento detectado: se requiere remediación.");
                        setRemediation({
                            active: true,
                            instruction: firstStep.instruction,
                            waitSeconds: firstStep.waitSeconds || 0,
                            stepIndex: 0
                        });
                        setLoading(false);
                        return;
                    }
                }
            }

            // AI Check
            if (data.aiAnalysis) {
                if (!data.aiAnalysis.passed) {
                    setAiFeedback({ passed: false, reason: data.aiAnalysis.reason });
                    toast.error("Verificación IA fallida");
                    setLoading(false);
                    return;
                } else {
                    toast.success("✅ Verificación IA aprobada!");
                }
            }

            toast.success("Paso completado");
            setValue("");
            setEvidenceUrl("");
            setCheckboxValues({});
            setRemediation({ active: false });

        if (stepper.state.isLast) {
          const instanceId = instance?.id;
          if (instanceId) {
            try {
              const checkRes = await fetch(`/api/inventory/stock-count/${instanceId}`);
              if (checkRes.ok) {
                window.location.href = `/dashboard/inventory/stock-count/${instanceId}/results`;
                return;
              }
            } catch {}
          }
          window.location.reload();
        } else {
                stepper.navigation.next();
            }

        } catch (error) {
            console.error(error);
            toast.error("Error al enviar paso");
        } finally {
            setLoading(false);
        }
    };

    const handleRemediationRetry = () => {
        setRemediation({ active: false });
        setValue("");
        setEvidenceUrl("");
        setAiFeedback(null);
        toast.info("Corrige el problema e intenta de nuevo.");
    };

    const currentIdx = steps.findIndex((s: any) => s.id === (stepper.state.current?.id || steps[0]?.id));

    return (
        <div className="max-w-md mx-auto p-4 space-y-6">
            {/* Progress */}
            <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Paso {currentIdx + 1} de {steps.length}</span>
                    <span>{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
            </div>

            {/* Step Indicator Dots */}
            <div className="flex justify-center gap-1.5">
                {steps.map((s: any) => {
                    const existing = existingSteps.find((es: any) => es.stepId === s.id);
                    const isCompleted = existing?.status === 'COMPLETED';
                    const isCurrent = s.id === (stepper.state.current?.id || steps[0]?.id);
                    return (
                        <div
                            key={s.id}
                            className={`h-2 transition-all ${
                                isCurrent ? 'w-6 bg-primary' :
                                isCompleted ? 'w-2 bg-green-500' :
                                'w-2 bg-muted-foreground/20'
                            } rounded-full`}
                        />
                    );
                })}
            </div>

            <Card className="border-2 shadow-lg relative overflow-hidden">
                {/* Remediation Overlay */}
                {remediation.active && (
                    <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
                        <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600 mb-2">
                            <AlertCircle className="h-8 w-8" />
                        </div>
                        <h3 className="text-xl font-bold">Acción Requerida</h3>
                        <p className="text-muted-foreground max-w-[280px]">
                            {remediation.instruction || "Por favor corrige el problema antes de continuar."}
                        </p>
                        {remediation.waitSeconds && remediation.waitSeconds > 0 && (
                            <RemediationTimer seconds={remediation.waitSeconds} onComplete={() => { }} />
                        )}
                        <Button onClick={handleRemediationRetry} className="w-full max-w-xs mt-4">
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Ya lo corregí
                        </Button>
                    </div>
                )}

                <CardHeader>
                    <CardTitle className="text-xl">{currentStepDef?.title}</CardTitle>
                    <CardDescription className="text-base">{currentStepDef?.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Separator />

                    {/* ===== TEXT ===== */}
                    {currentStepDef.type === 'TEXT' && (
                        <div className="space-y-2">
                            <Label>Tu Respuesta</Label>
                            <Textarea value={value} onChange={e => setValue(e.target.value)} placeholder="Escribe aquí..." rows={4} />
                        </div>
                    )}

                    {/* ===== NUMBER ===== */}
                    {currentStepDef.type === 'NUMBER' && (
                        <div className="space-y-2">
                            <Label>Valor</Label>
                            {/* step="any": sin él el navegador trata 2.5 como
                                inválido y los spinners saltan de 1 en 1. */}
                            <Input type="number" step="any" value={value} onChange={e => setValue(e.target.value)} placeholder="0.00" />
                            {currentStepDef.config?.min !== undefined && currentStepDef.config?.max !== undefined && (
                                <p className="text-xs text-muted-foreground">
              Rango: {currentStepDef.config.min as number} - {currentStepDef.config.max as number}
              {currentStepDef.config.unit && ` ${currentStepDef.config.unit}`}
                                </p>
                            )}
                        </div>
                    )}

      {/* ===== SELECT (Radio ≤5, Dropdown >5) ===== */}
      {currentStepDef.type === 'SELECT' && currentStepDef.id === 'confirm-count' && (
        <StockCountConfirmSummary existingSteps={existingSteps} onConfirm={(val: string) => { setValue(val); setHasUnsavedChanges(true); }} value={value} />
      )}
      {currentStepDef.type === 'SELECT' && currentStepDef.id !== 'confirm-count' && (
        <div className="space-y-3">
          <Label>Selecciona una opción</Label>
          {((currentStepDef.config?.options as any[]) || []).length <= 5 ? (
            <RadioGroup value={value} onValueChange={setValue} className="space-y-2">
              {((currentStepDef.config?.options as any[]) || []).map((opt: any, idx: number) => {
                                        const optValue = typeof opt === 'string' ? opt : opt.value || opt.label;
                                        const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value;
                                        return (
                                            <div key={idx} className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                                                <RadioGroupItem value={optValue} id={`opt-${idx}`} />
                                                <Label htmlFor={`opt-${idx}`} className="flex-1 cursor-pointer font-normal">{optLabel}</Label>
                                            </div>
                                        );
                                    })}
                                </RadioGroup>
                            ) : (
                                <Select value={value} onValueChange={setValue}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona..." />
                                    </SelectTrigger>
                                    <SelectContent>
              {((currentStepDef.config?.options as any[]) || []).map((opt: any, idx: number) => {
                const optValue = typeof opt === 'string' ? opt : opt.value || opt.label;
                const optLabel = typeof opt === 'string' ? opt : opt.label || opt.value;
                return (
                  <SelectItem key={idx} value={optValue}>{optLabel}</SelectItem>
                );
              })}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    )}

      {/* ===== CHECKBOX (Checklist) ===== */}
      {currentStepDef.type === 'CHECKBOX' && (
        <div className="space-y-3">
          <Label>Marca los elementos completados</Label>
          {((currentStepDef.config?.options || currentStepDef.config?.items || []) as any[]).map((item: any, idx: number) => {
                                const itemLabel = typeof item === 'string' ? item : item.label || item.value;
                                const itemKey = typeof item === 'string' ? item : (item.value || item.label || `item-${idx}`);
                                return (
                                    <div key={idx} className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                                        <Checkbox
                                            id={`check-${idx}`}
                                            checked={!!checkboxValues[itemKey]}
                                            onCheckedChange={(checked) => {
                                                setCheckboxValues(prev => ({ ...prev, [itemKey]: !!checked }));
                                            }}
                                        />
                                        <Label htmlFor={`check-${idx}`} className="flex-1 cursor-pointer font-normal">{itemLabel}</Label>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ===== DATE ===== */}
                    {currentStepDef.type === 'DATE' && (
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <CalendarIcon className="h-4 w-4" />
                                Fecha
                            </Label>
                            <Input type="date" value={value} onChange={e => setValue(e.target.value)} />
                        </div>
                    )}

                    {/* ===== INFO (Read-only instruction) ===== */}
                    {currentStepDef.type === 'INFO' && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg flex gap-3 text-blue-700 dark:text-blue-300">
                            <Info className="h-5 w-5 shrink-0 mt-0.5" />
                            <div className="text-sm space-y-2">
                                <p>{String(currentStepDef.config?.content ?? "") || currentStepDef.description || "Lee esta información antes de continuar."}</p>
                            </div>
                        </div>
                    )}

                    {/* ===== SIGNATURE ===== */}
                    {currentStepDef.type === 'SIGNATURE' && (
                        <div className="space-y-3">
                            <Label>Firma Digital</Label>
                            <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
                                <p className="text-sm text-muted-foreground">
                                    Al escribir tu nombre completo, confirmas que has revisado y completado este workflow.
                                </p>
                                <Input
                                    value={value}
                                    onChange={e => setValue(e.target.value)}
                                    placeholder="Escribe tu nombre completo"
                                    className="text-center text-lg italic"
                                />
                                {value && (
                                    <p className="text-xs text-muted-foreground">
                                        Firmado digitalmente el {new Date().toLocaleDateString('es-MX', { dateStyle: 'long' })}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

        {/* ===== PHOTO (Live camera + gallery upload) ===== */}
        {currentStepDef.type === 'PHOTO' && (
          <div className="space-y-4">
            <Label>Evidencia Fotográfica</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            {uploadingPhotos && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Subiendo... {uploadProgress}%
              </div>
            )}
            {(Array.isArray(evidenceUrl) ? evidenceUrl : evidenceUrl ? [evidenceUrl] : []).length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {(Array.isArray(evidenceUrl) ? evidenceUrl : evidenceUrl ? [evidenceUrl] : []).map((url: string, idx: number) => (
                  <div key={idx} className="relative aspect-video rounded-lg overflow-hidden border group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Evidencia ${idx + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        const current = Array.isArray(evidenceUrl) ? evidenceUrl : [evidenceUrl];
                        const newUrls = current.filter((_, i) => i !== idx);
                        setEvidenceUrl(newUrls.length === 0 ? "" : newUrls);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="w-full h-12 gap-2" onClick={() => setCameraOpen(true)} disabled={uploadingPhotos}>
                <Camera className="w-4 h-4" />
                Abrir Cámara
              </Button>
              <Button variant="ghost" className="w-full h-10 gap-2 text-muted-foreground" onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute("capture");
                  fileInputRef.current.click();
                }
              }} disabled={uploadingPhotos}>
                <Upload className="w-4 h-4" />
                Subir desde Galería
              </Button>
            </div>
            <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen} onConfirm={handleCameraConfirm} maxPhotos={10} />
          </div>
        )}

                    {/* ===== TIMER ===== */}
                    {currentStepDef.type === 'TIMER' && (
                        <div className="space-y-4 text-center py-6">
                            <div className="flex flex-col items-center justify-center space-y-4">
                                <Label className="text-muted-foreground uppercase tracking-wider text-xs">Temporizador</Label>
                                <RemediationTimer
                                    seconds={Number(currentStepDef.config?.durationSeconds) || 60}
                                    onComplete={() => setValue("TIMER_COMPLETED")}
                                />
                                <p className="text-sm text-muted-foreground">Espera a que el temporizador termine.</p>
                            </div>
                        </div>
                    )}

                    {/* ===== LOCATION ===== */}
                    {currentStepDef.type === 'LOCATION' && (() => {
                        const fix = (() => {
                            try {
                                const parsed = value ? JSON.parse(value) : null;
                                return typeof parsed?.latitude === 'number' ? parsed : null;
                            } catch {
                                return null;
                            }
                        })();

                        return (
                            <div className="space-y-3">
                                <Label>Ubicación</Label>
                                {fix ? (
                                    <div className="rounded-lg border p-4 space-y-2">
                                        <div className="flex items-start gap-3">
                                            <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                                            <div className="min-w-0">
                                                <p className="font-mono text-sm">
                                                    {fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    Precisión aproximada: {Math.round(fix.accuracy)} m
                                                </p>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            className="w-full h-12"
                                            onClick={captureLocation}
                                            disabled={capturingLocation}
                                        >
                                            {capturingLocation && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                                            Volver a capturar
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-dashed p-6 flex flex-col items-center gap-4 text-center">
                                        <MapPin className="h-10 w-10 text-muted-foreground" />
                                        {locationError ? (
                                            <p className="text-sm text-destructive max-w-xs">{locationError}</p>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">
                                                Captura la ubicación para dejar constancia de dónde se hizo este paso.
                                            </p>
                                        )}
                                        <Button
                                            variant="outline"
                                            className="w-full max-w-xs h-12 gap-2"
                                            onClick={captureLocation}
                                            disabled={capturingLocation}
                                        >
                                            {capturingLocation
                                                ? <><Loader2 className="animate-spin h-4 w-4" /> Obteniendo ubicación…</>
                                                : <><MapPin className="h-4 w-4" /> {locationError ? "Reintentar" : "Capturar Ubicación"}</>}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* ===== VIDEO ===== */}
                    {currentStepDef.type === 'VIDEO' && (
                        <div className="space-y-4">
                            <Label>Evidencia de Video</Label>
                            {value ? (
                                <div className="aspect-video bg-black rounded-lg overflow-hidden relative group">
                                    <video src={value} controls className="w-full h-full" />
                                    <Button variant="destructive" size="icon" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => { setValue(""); setEvidenceUrl(""); }}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed p-6 flex flex-col items-center gap-4 text-center">
                                    <Video className="h-10 w-10 text-muted-foreground" />
                                    <p className="text-sm text-muted-foreground">
                                        Graba el video con la cámara o elige uno de la galería.
                                    </p>
                                    <input
                                        ref={videoInputRef}
                                        type="file"
                                        accept="video/*"
                                        className="hidden"
                                        onChange={handleVideoSelected}
                                    />
                                    {uploadingPhotos ? (
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Subiendo... {uploadProgress}%
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2 w-full max-w-xs">
                                            <Button
                                                variant="outline"
                                                className="w-full h-12 gap-2"
                                                onClick={() => {
                                                    videoInputRef.current?.setAttribute("capture", "environment");
                                                    videoInputRef.current?.click();
                                                }}
                                            >
                                                <Video className="h-4 w-4" />
                                                Grabar Video
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                className="w-full h-12 gap-2"
                                                onClick={() => {
                                                    videoInputRef.current?.removeAttribute("capture");
                                                    videoInputRef.current?.click();
                                                }}
                                            >
                                                <Upload className="h-4 w-4" />
                                                Subir desde Galería
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== AUDIO ===== */}
                    {currentStepDef.type === 'AUDIO' && (
                        <div className="space-y-4">
                            <Label>Nota de Voz</Label>
                            {value ? (
                                <div className="bg-secondary/50 p-4 rounded-lg flex items-center gap-4">
                                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                        <Mic className="h-5 w-5 text-primary" />
                                    </div>
                                    <audio src={value} controls className="flex-1" />
                                    <Button variant="ghost" size="icon" onClick={() => { setValue(""); setEvidenceUrl(""); }}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-dashed p-6 flex flex-col items-center gap-4 text-center">
                                    {audioRecorder.state === 'recording' ? (
                                        <>
                                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                                                <span className="h-3 w-3 rounded-full bg-destructive motion-safe:animate-pulse" />
                                            </span>
                                            <p className="font-mono text-lg tabular-nums">
                                                {Math.floor(audioRecorder.elapsed / 60)}:{String(audioRecorder.elapsed % 60).padStart(2, '0')}
                                            </p>
                                            <div className="flex flex-col gap-2 w-full max-w-xs">
                                                <Button className="w-full h-12 gap-2" onClick={handleStopRecording}>
                                                    Detener y Guardar
                                                </Button>
                                                <Button variant="ghost" className="w-full h-12" onClick={audioRecorder.cancel}>
                                                    Descartar
                                                </Button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <Mic className="h-10 w-10 text-muted-foreground" />
                                            {audioRecorder.state === 'denied' ? (
                                                <p className="text-sm text-destructive max-w-xs">
                                                    No pudimos usar el micrófono. Permite el acceso en tu navegador
                                                    y vuelve a intentarlo.
                                                </p>
                                            ) : audioRecorder.state === 'unsupported' ? (
                                                <p className="text-sm text-destructive max-w-xs">
                                                    Este navegador no puede grabar audio. Abre el flujo desde otro
                                                    dispositivo para completar este paso.
                                                </p>
                                            ) : (
                                                <p className="text-sm text-muted-foreground">
                                                    Graba una nota de voz para dejar constancia.
                                                </p>
                                            )}
                                            {uploadingPhotos ? (
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Subiendo... {uploadProgress}%
                                                </div>
                                            ) : (
                                                audioRecorder.state !== 'unsupported' && (
                                                    <Button
                                                        variant="outline"
                                                        className="w-full max-w-xs h-12 gap-2"
                                                        onClick={audioRecorder.start}
                                                    >
                                                        <Mic className="h-4 w-4" />
                                                        {audioRecorder.state === 'denied' ? "Reintentar" : "Grabar Nota de Voz"}
                                                    </Button>
                                                )
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* AI Feedback */}
                    {aiFeedback && !aiFeedback.passed && (
                        <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg flex gap-3 text-red-600 dark:text-red-400">
                            <AlertCircle className="h-5 w-5 shrink-0" />
                            <div className="text-sm">
                                <p className="font-semibold">Verificación Fallida</p>
                                <p>{aiFeedback.reason}</p>
                            </div>
                        </div>
                    )}

                </CardContent>
                <CardFooter className="flex justify-between gap-3">
                    <Button variant="ghost" onClick={stepper.navigation.prev} disabled={stepper.state.isFirst}>
                        Atrás
                    </Button>
                    <Button onClick={handleNext} disabled={loading || !canSubmit} className="flex-1">
                        {loading && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                        {stepper.state.isLast ? "Completar Workflow" : "Siguiente Paso"} <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}

function RemediationTimer({ seconds, onComplete }: { seconds: number, onComplete: () => void }) {
    const [timeLeft, setTimeLeft] = useState(seconds);

    useEffect(() => {
        const interval = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    onComplete();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [onComplete]);

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${m}:${rem.toString().padStart(2, '0')}`;
    };

    return (
        <div className="text-2xl font-mono font-bold text-orange-600 bg-orange-50 dark:bg-orange-950/30 px-4 py-2 rounded-md">
            {formatTime(timeLeft)}
        </div>
    );
}

function StockCountConfirmSummary({ existingSteps, onConfirm, value }: { existingSteps: WorkflowStepExecution[]; onConfirm: (val: string) => void; value: string }) {
  const countSteps = existingSteps.filter(s => s.stepId.startsWith("count-") && s.value);

  const rows = countSteps.map(s => {
    let systemQty = 0;
    let physicalQty = 0;
    let itemName = s.stepId.replace("count-", "");
    try {
      const parsed = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
      systemQty = parsed.systemQuantity || 0;
      physicalQty = parsed.inputValue ? parseFloat(String(parsed.inputValue)) : 0;
    } catch {
      physicalQty = parseFloat(String(s.value)) || 0;
    }
    // parseFloat, no parseInt: el resumen debe mostrar los 2.5 kg que se
    // guardan, no 2 (cf. StockCountService.completeStockCount).
    if (!Number.isFinite(physicalQty)) physicalQty = 0;
    const variance = Math.round((physicalQty - systemQty) * 10000) / 10000;
    const variancePercent = systemQty > 0 ? Math.abs(variance) / systemQty * 100 : (physicalQty > 0 ? 100 : 0);
    const isAlert = variancePercent > 10;

    return { stepId: s.stepId, itemName, systemQty, physicalQty, variance, variancePercent: Math.round(variancePercent), isAlert };
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 font-medium">Producto</th>
              <th className="text-right p-2 font-medium">Sistema</th>
              <th className="text-right p-2 font-medium">Físico</th>
              <th className="text-right p-2 font-medium">Diferencia</th>
              <th className="text-center p-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.stepId} className={`border-t ${row.isAlert ? 'bg-red-50 dark:bg-red-950/20' : ''}`}>
                <td className="p-2">{row.itemName}</td>
                <td className="text-right p-2">{row.systemQty}</td>
                <td className="text-right p-2">{row.physicalQty}</td>
                <td className={`text-right p-2 font-medium ${row.variance > 0 ? 'text-green-600' : row.variance < 0 ? 'text-red-600' : ''}`}>
                  {row.variance > 0 ? '+' : ''}{row.variance}
                </td>
                <td className="text-center p-2">
                  {row.isAlert ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      <AlertCircle className="h-3 w-3" /> {row.variancePercent}%
                    </span>
                  ) : row.variance === 0 ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">OK</span>
                  ) : (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">{row.variancePercent}%</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.some(r => r.isAlert) && (
        <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg flex gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>Se detectaron varianzas mayores al 10%. Revisa antes de confirmar.</span>
        </div>
      )}

      <div className="space-y-2 pt-2">
        <Label>Confirmación</Label>
        <div className="grid gap-2">
          <div
            className={`flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors ${value === 'yes' ? 'border-primary bg-primary/5' : ''}`}
            onClick={() => onConfirm('yes')}
          >
            <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${value === 'yes' ? 'border-primary' : 'border-muted-foreground'}`}>
              {value === 'yes' && <div className="h-2 w-2 rounded-full bg-primary" />}
            </div>
            <span className="font-medium">Sí, confirmar y generar ajustes</span>
          </div>
          <div
            className={`flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors ${value === 'no' ? 'border-primary bg-primary/5' : ''}`}
            onClick={() => onConfirm('no')}
          >
            <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${value === 'no' ? 'border-primary' : 'border-muted-foreground'}`}>
              {value === 'no' && <div className="h-2 w-2 rounded-full bg-primary" />}
            </div>
            <span>No, revisar conteo</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompletionScreen() {
    return (
        <div className="flex flex-col items-center justify-center p-6 text-center space-y-6 min-h-[50vh]">
            <div className="rounded-full bg-green-100 p-6 dark:bg-green-900/30">
                <CheckCircle2 className="h-16 w-16 text-green-600 dark:text-green-400" />
            </div>
            <div className="space-y-2">
                <h2 className="text-2xl font-bold">¡Workflow Completado!</h2>
                <p className="text-muted-foreground">Gracias. Tu envío ha sido registrado correctamente.</p>
            </div>
            <Button className="w-full max-w-xs" onClick={() => window.location.reload()}>
                Actualizar Estado
            </Button>
        </div>
    );
}
