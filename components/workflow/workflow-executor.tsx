"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Camera, FileText, Calendar, Hash, ListChecks, Loader2, Package, MapPin, Mic, Video } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AIVerificationStatus, AIVerificationStatusProps } from "@/components/workflow/ai-verification-status";
import { WorkflowStep } from "@/lib/types/workflow";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CameraCapture } from "@/components/shared/camera-capture";
import { usePhotoUpload } from "@/components/shared/use-photo-upload";

function StockCountConfirmSummary({ steps, onConfirm, value }: { steps: WorkflowStepData[]; onConfirm: (val: string) => void; value: string }) {
  const countSteps = steps.filter(s => s.stepId.startsWith("count-") && s.value);

  const rows = countSteps.map(s => {
    let systemQty = 0;
    let physicalQty = 0;
    let itemName = s.stepId.replace("count-", "");
    try {
      const parsed = typeof s.value === 'string' ? JSON.parse(s.value as string) : s.value;
      systemQty = (parsed as any).systemQuantity || 0;
      physicalQty = (parsed as any).inputValue ? parseInt(String((parsed as any).inputValue), 10) : 0;
    } catch {
      physicalQty = parseInt(String(s.value), 10) || 0;
    }
    const variance = physicalQty - systemQty;
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

export interface WorkflowStepData {
    id: string;
    stepId: string;
    status: string;
    value: unknown;
    aiAnalysis: AIVerificationStatusProps | null;
    evidenceUrl: string | null;
    comment: string | null;
    completedAt: Date | null;
}

export interface WorkflowExecutionData {
  id: string;
  workflowTemplateId: string;
  status: string;
  currentStepId: string | null;
  score: number | null;
  template: {
    name: string;
    description: string | null;
    steps: WorkflowStep[];
  };
  steps: WorkflowStepData[];
}

export interface WorkflowExecutorProps {
  execution: WorkflowExecutionData;
  onStepComplete?: (stepId: string, data: Record<string, unknown>) => void;
  onComplete?: () => void;
  className?: string;
}

export function WorkflowExecutor({
  execution,
  onStepComplete,
  onComplete,
  className
}: WorkflowExecutorProps) {
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  const [stepData, setStepData] = React.useState<Record<string, any>>({});
  const [evidenceFiles, setEvidenceFiles] = React.useState<File[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [aiVerification, setAIVerification] = React.useState<AIVerificationStatusProps['status'] | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const { uploadPhotos, uploading: uploadingPhotos } = usePhotoUpload();

  const steps = execution.template.steps;
  const currentStep = steps[currentStepIndex];
  const currentStepInstance = execution.steps.find(s => s.stepId === currentStep?.id);

  const progress = Math.round(
    (execution.steps.filter(s => s.status === 'COMPLETED' || s.status === 'SKIPPED').length / steps.length) * 100
  );

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      setAIVerification(null);
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      setAIVerification(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setEvidenceFiles(files);
    }
  };

  const uploadFiles = async (files: File[]): Promise<{ url: string; name: string }[]> => {
    const results = await uploadPhotos(files);
    return results.map((r) => ({ url: r.url, name: r.name }));
  };

  const handleCameraConfirm = async (files: File[]) => {
    try {
      const results = await uploadPhotos(files);
      const newFiles = results.map((r) => {
        return new File([], r.name);
      });
      setEvidenceFiles((prev) => [...(Array.isArray(prev) ? prev : []), ...newFiles]);
    } catch {
      toast.error("Error al subir las fotos");
    }
  };

  const handleSubmitStep = async () => {
    if (!currentStep) return;

    setSubmitting(true);
    try {
      let evidenceUrl = currentStepInstance?.evidenceUrl || null;
      let value = stepData[currentStep.id] || null;

      // Upload files if present
      if (evidenceFiles.length > 0) {
        setUploading(true);
        const uploads = await uploadFiles(evidenceFiles);
        const urls = uploads.map(u => u.url);
        evidenceUrl = urls.length === 1 ? urls[0] : JSON.stringify(urls);
        setUploading(false);
      }

      // Determine status
      const status = 'COMPLETED';

      // Call API to update step
      const response = await fetch(`/api/workflows/executions/${execution.id}/steps/${currentStep.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value,
          evidenceUrl,
          status,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update step');
      }

      const result = await response.json();

      // Check if AI verification was performed
      if (result.step?.aiAnalysis) {
        setAIVerification({
          status: result.step.aiAnalysis.passed ? 'success' : 'failed',
          confidence: result.step.aiAnalysis.confidence,
          reason: result.step.aiAnalysis.reason,
          provider: result.step.aiAnalysis.provider,
          timestamp: new Date(),
        });
      }

      toast.success('Paso completado exitosamente');

      // Notify parent
      onStepComplete?.(currentStep.id, result);

      // Check if remediation is required
      if (result.remediationRequired) {
        toast.warning('Se requiere remediación para este paso', {
          description: 'Se ha creado un incidente que debe ser atendido.',
        });
      }

      // Clear files
      setEvidenceFiles([]);

      // Auto-advance to next step or complete
      if (currentStepIndex < steps.length - 1) {
        setTimeout(() => {
          handleNext();
        }, 1000);
      } else {
        onComplete?.();
      }
    } catch (error: unknown) {
      toast.error('Error al completar el paso', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const renderStepInput = (step: WorkflowStep) => {
    const stepValue = stepData[step.id] || currentStepInstance?.value;

    switch (step.type) {
      case 'TEXT':
        return (
          <Textarea
            placeholder="Ingresa la información solicitada..."
            value={stepValue || ''}
            onChange={(e) => setStepData({ ...stepData, [step.id]: e.target.value })}
            className="min-h-[100px]"
          />
        );

      case 'NUMBER':
        return (
          <div className="space-y-3">
            {step.id.startsWith('count-') && currentStepInstance?.value && (() => {
              try {
                const parsed = typeof currentStepInstance.value === 'string' ? JSON.parse(currentStepInstance.value) : currentStepInstance.value;
                const sysQty = (parsed as any)?.systemQuantity;
                const unit = (parsed as any)?.unit || '';
                if (sysQty !== undefined) {
                  return (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Stock en sistema:</span>
                      <span className="text-sm font-semibold">{sysQty} {unit}</span>
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}
            <Input
              type="number"
              placeholder="0"
              value={stepValue || ''}
              onChange={(e) => setStepData({ ...stepData, [step.id]: e.target.value })}
            />
          </div>
        );

      case 'SELECT':
      if (step.id === 'confirm-count') {
        return <StockCountConfirmSummary steps={execution.steps} onConfirm={(val: string) => setStepData({ ...stepData, [step.id]: val })} value={stepData[step.id] || currentStepInstance?.value || ''} />;
      }
      const options = (step.config?.options || []) as any[];
        return (
          <Select
            value={stepValue || ''}
            onValueChange={(value) => setStepData({ ...stepData, [step.id]: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona una opción..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((option: any) => {
                const optValue = typeof option === 'string' ? option : option.value;
                const optLabel = typeof option === 'string' ? option : option.label;
                return (
                  <SelectItem key={optValue} value={optValue}>
                    {optLabel}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );

      case 'CHECKBOX':
        return (
          <div className="space-y-3">
            {((step.config?.options || []) as any[]).map((option: any) => {
              const optValue = typeof option === 'string' ? option : option.value;
              const optLabel = typeof option === 'string' ? option : option.label;
              return (
                <div key={optValue} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${step.id}-${optValue}`}
                    checked={(stepValue || []).includes(optValue)}
                    onCheckedChange={(checked) => {
                      const currentValues = stepValue || [];
                      const newValues = checked
                        ? [...currentValues, optValue]
                        : currentValues.filter((v: string) => v !== optValue);
                      setStepData({ ...stepData, [step.id]: newValues });
                    }}
                  />
                  <Label htmlFor={`${step.id}-${optValue}`}>{optLabel}</Label>
                </div>
              );
            })}
          </div>
        );

      case 'DATE':
        return (
          <Input
            type="date"
            value={stepValue || ''}
            onChange={(e) => setStepData({ ...stepData, [step.id]: e.target.value })}
          />
        );

      case 'PHOTO':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-center w-full">
              <label
                htmlFor={`${step.id}-file-upload`}
                className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted/70 transition-colors"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Camera className="w-10 h-10 mb-3 text-muted-foreground" />
                  <p className="mb-2 text-sm text-muted-foreground">
                    <span className="font-semibold">Haz clic para subir</span> o arrastra y suelta
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG o WEBP (MAX. 10MB)
                  </p>
                </div>
                <input
                  id={`${step.id}-file-upload`}
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleFileSelect}
                />
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="outline" className="w-full gap-2" onClick={() => setCameraOpen(true)} disabled={uploadingPhotos}>
            <Camera className="w-4 h-4" />
            Abrir Cámara
          </Button>
        </div>
        {uploadingPhotos && (
          <p className="text-sm text-muted-foreground text-center">Subiendo fotos...</p>
        )}

        {evidenceFiles.length > 0 && (
              <div className="space-y-2">
                <Label>Archivos seleccionados:</Label>
                {evidenceFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded">
                    <FileText className="w-4 h-4" />
                    <span className="text-sm">{file.name}</span>
                    <Badge variant="secondary">{(file.size / 1024).toFixed(1)} KB</Badge>
                  </div>
                ))}
              </div>
            )}

            {currentStepInstance?.evidenceUrl && !evidenceFiles.length && (
              <div className="space-y-2">
                <Label>Evidencia previa:</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    try {
                      const urls = currentStepInstance.evidenceUrl.startsWith('[')
                        ? JSON.parse(currentStepInstance.evidenceUrl)
                        : [currentStepInstance.evidenceUrl];
                      return urls.map((url: string, index: number) => (
                        <img
                          key={index}
                          src={url}
                          alt={`Evidencia ${index + 1}`}
                          className="w-full h-32 object-cover rounded"
                        />
                      ));
                    } catch {
                      return (
                        <img
                          src={currentStepInstance.evidenceUrl}
                          alt="Evidencia"
                          className="w-full h-32 object-cover rounded"
                        />
                      );
                    }
                  })()}
                </div>
              </div>
        )}
        <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen} onConfirm={handleCameraConfirm} maxPhotos={10} />
      </div>
    );

  case 'INFO':
        return (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Información Importante</AlertTitle>
            <AlertDescription>{step.description}</AlertDescription>
          </Alert>
        );

 case 'SIGNATURE':
 return (
 <div className="space-y-2">
 <Label>Firma digital</Label>
 <div className="border-2 border-dashed rounded-lg p-8 text-center bg-muted/50">
 <p className="text-muted-foreground">
 La firma se capturará automáticamente al completar este paso
 </p>
 </div>
 </div>
 );

 case 'YESNO':
 return (
 <div className="flex gap-3">
 <button
 onClick={() => setStepData({ ...stepData, [step.id]: 'SI' })}
 className={`flex-1 h-12 rounded-lg border-2 font-semibold transition-colors ${stepValue === 'SI' ? 'border-green-500 bg-green-100 text-green-700' : 'border-border hover:bg-muted'}`}
 >
 ✓ Sí
 </button>
 <button
 onClick={() => setStepData({ ...stepData, [step.id]: 'NO' })}
 className={`flex-1 h-12 rounded-lg border-2 font-semibold transition-colors ${stepValue === 'NO' ? 'border-red-500 bg-red-100 text-red-700' : 'border-border hover:bg-muted'}`}
 >
 ✗ No
 </button>
 </div>
 );

 case 'TIME':
 return (
 <Input
 type="time"
 value={stepValue || ''}
 onChange={(e) => setStepData({ ...stepData, [step.id]: e.target.value })}
 />
 );

 case 'TIMER':
 return (
 <div className="space-y-2">
 <Label>Temporizador (segundos)</Label>
 <Input
 type="number"
 placeholder="0"
 value={stepValue || ''}
 onChange={(e) => setStepData({ ...stepData, [step.id]: e.target.value })}
 />
 </div>
 );

 case 'LOCATION':
 return (
 <div className="space-y-4">
 <div className="flex items-center justify-center w-full">
 <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted/70 transition-colors">
 <div className="flex flex-col items-center justify-center pt-5 pb-6">
 <MapPin className="w-10 h-10 mb-3 text-muted-foreground" />
 <p className="mb-2 text-sm text-muted-foreground">
 <span className="font-semibold">Capturar ubicación GPS</span>
 </p>
 </div>
 </label>
 </div>
 <Button variant="outline" className="w-full gap-2" onClick={() => setStepData({ ...stepData, [step.id]: 'GPS_CAPTURED' })}>
 <MapPin className="h-4 w-4" /> Capturar Ubicación
 </Button>
 </div>
 );

 case 'AUDIO':
 return (
 <div className="space-y-4">
 <div className="flex items-center justify-center w-full">
 <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted/70 transition-colors">
 <div className="flex flex-col items-center justify-center pt-5 pb-6">
 <Mic className="w-10 h-10 mb-3 text-muted-foreground" />
 <p className="mb-2 text-sm text-muted-foreground">
 <span className="font-semibold">Grabar nota de voz</span>
 </p>
 </div>
 </label>
 </div>
 </div>
 );

 case 'VIDEO':
 return (
 <div className="space-y-4">
 <div className="flex items-center justify-center w-full">
 <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer bg-muted/50 hover:bg-muted/70 transition-colors">
 <div className="flex flex-col items-center justify-center pt-5 pb-6">
 <Video className="w-10 h-10 mb-3 text-muted-foreground" />
 <p className="mb-2 text-sm text-muted-foreground">
 <span className="font-semibold">Grabar video</span>
 </p>
 </div>
 </label>
 </div>
 </div>
 );

 default:
        return (
          <Textarea
            placeholder="Ingresa la información solicitada..."
            value={stepValue || ''}
            onChange={(e) => setStepData({ ...stepData, [step.id]: e.target.value })}
            className="min-h-[100px]"
          />
        );
    }
  };

const getStepIcon = (type: string) => {
 switch (type) {
 case 'TEXT':
 return <FileText className="h-5 w-5" />;
 case 'NUMBER':
 return <Hash className="h-5 w-5" />;
 case 'SELECT':
 case 'YESNO':
 return <ListChecks className="h-5 w-5" />;
 case 'PHOTO':
 case 'VIDEO':
 return <Camera className="h-5 w-5" />;
 case 'CHECKBOX':
 return <Checkbox className="h-5 w-5" />;
 case 'DATE':
 case 'TIME':
 case 'TIMER':
 return <Calendar className="h-5 w-5" />;
 case 'INFO':
 return <AlertCircle className="h-5 w-5" />;
 case 'SIGNATURE':
 return <FileText className="h-5 w-5" />;
 case 'LOCATION':
 return <MapPin className="h-5 w-5" />;
 case 'AUDIO':
 return <Mic className="h-5 w-5" />;
 default:
 return <FileText className="h-5 w-5" />;
 }
 };

  const isStepCompleteable = () => {
    if (!currentStep) return false;
 if (currentStep.type === 'INFO') return true;

 const value = stepData[currentStep.id] || currentStepInstance?.value;
 const hasEvidence = evidenceFiles.length > 0 || currentStepInstance?.evidenceUrl;

 if (currentStep.type === 'PHOTO' || currentStep.type === 'VIDEO' || currentStep.type === 'LOCATION') {
 return hasEvidence || !!value;
 }

 if (currentStep.type === 'AUDIO') {
 return !!value;
 }

    if (currentStep.required) {
      return value && (typeof value === 'string' ? value.trim() : value.length > 0);
    }

    return true;
  };

  if (!currentStep) {
    return (
      <Card className={className}>
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
          <h3 className="text-xl font-semibold mb-2">Workflow Completado</h3>
          <p className="text-muted-foreground">
            Todos los pasos han sido completados exitosamente.
          </p>
          <Button onClick={onComplete} className="mt-4">
            Volver al Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Progress Header */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <CardTitle className="text-2xl">{execution.template.name}</CardTitle>
              {execution.template.description && (
                <CardDescription className="mt-1">
                  {execution.template.description}
                </CardDescription>
              )}
            </div>
            <Badge variant={execution.status === 'COMPLETED' ? 'default' : 'secondary'}>
              {execution.status === 'COMPLETED' ? 'Completado' : 'En Progreso'}
            </Badge>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progreso</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardHeader>
      </Card>

      {/* Step Navigation Tabs */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            {steps.map((step, index) => {
              const stepInstance = execution.steps.find(s => s.stepId === step.id);
              const isCompleted = stepInstance?.status === 'COMPLETED' || stepInstance?.status === 'SKIPPED';
              const isCurrent = index === currentStepIndex;
              const isFailed = stepInstance?.status === 'FAILED';

              return (
                <button
                  key={step.id}
                  onClick={() => {
                    setCurrentStepIndex(index);
                    setAIVerification(null);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isCurrent && "bg-primary text-primary-foreground",
                    isCompleted && !isCurrent && "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
                    isFailed && "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
                    !isCurrent && !isCompleted && !isFailed && "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isFailed ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <span className="h-4 w-4 flex items-center justify-center rounded-full border-2 border-current text-xs">
                      {index + 1}
                    </span>
                  )}
                  <span className="hidden sm:inline truncate max-w-[150px]">{step.title}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Current Step */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              {getStepIcon(currentStep.type)}
            </div>
            <div>
              <CardTitle className="text-xl">
                Paso {currentStepIndex + 1} de {steps.length}
              </CardTitle>
              <CardDescription>{currentStep.title}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentStep.description && (
            <p className="text-sm text-muted-foreground">{currentStep.description}</p>
          )}

          <Separator />

          {renderStepInput(currentStep)}

          {/* AI Verification Status */}
          {aiVerification && (
            <AIVerificationStatus status={aiVerification} />
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStepIndex === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Anterior
          </Button>

          <Button
            onClick={handleSubmitStep}
            disabled={!isStepCompleteable() || submitting || uploading}
          >
            {(submitting || uploading) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting || uploading ? 'Procesando...' : currentStepIndex === steps.length - 1 ? 'Completar' : 'Siguiente'}
            {!submitting && !uploading && currentStepIndex < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 ml-2" />
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
