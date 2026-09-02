'use client';

import { useRef, useState } from 'react';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, XCircle, AlertCircle, AlertTriangle, ArrowRight, ArrowLeft, Camera, Loader2, Upload, Sparkles, Trash2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { CameraCapture } from '@/components/shared/camera-capture';
import { usePhotoUpload } from '@/components/shared/use-photo-upload';

/** Veredicto que devuelve `/api/incidents/[id]/remediate` cuando hubo foto. */
export interface AiResult {
    passed?: boolean;
    reason?: string;
    details?: { confidence?: number };
}

/** Umbral de auto-aprobacion. Es el mismo que usa `/api/ai/verify` en workflows. */
const UMBRAL_AUTO_APROBACION = 0.85;

interface RemediationStep {
    instruction: string;
    validationCriteria?: {
        type: 'photo' | 'value';
        expectedValue?: unknown;
        aiPrompt?: string;
    };
}

interface RemediationWizardProps {
    incident: {
        id: string;
        title: string;
        description?: string;
        remediationProtocol?: {
            steps: RemediationStep[];
            maxAttempts?: number;
        };
    };
    currentStep?: number;
    currentAttempt?: number;
    /** Overrides protocol.maxAttempts when the server tracks its own limit. */
    maxAttempts?: number;
    onSubmitStep: (
        stepIndex: number,
        evidence: unknown
    ) => Promise<{ success: boolean; message?: string; aiResult?: AiResult | null }>;
    onComplete: () => void;
    onCancel: () => void;
}

export function RemediationWizard({
    incident,
    currentStep = 0,
    currentAttempt = 0,
    maxAttempts: maxAttemptsProp,
    onSubmitStep,
    onComplete,
    onCancel,
}: RemediationWizardProps) {
    const [activeStep, setActiveStep] = useState(currentStep);
    const [evidence, setEvidence] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [stepResult, setStepResult] = useState<{
        success: boolean;
        message?: string;
        aiResult?: AiResult | null;
    } | null>(null);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [cameraOpen, setCameraOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadPhotos, uploading, error: uploadError } = usePhotoUpload();

    const protocol = incident.remediationProtocol;
    const steps = protocol?.steps || [];
    const maxAttempts = maxAttemptsProp ?? protocol?.maxAttempts ?? 3;
    const progress = ((activeStep + 1) / steps.length) * 100;

    if (!protocol || steps.length === 0) {
        return (
            <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                    No hay un protocolo de remediación disponible para este incidente.
                </AlertDescription>
            </Alert>
        );
    }

    // ── Attempts exhausted: terminal state, no way to keep submitting ──
    if (currentAttempt >= maxAttempts) {
        return (
            <Card className="w-full max-w-2xl">
                <CardHeader>
                    <CardTitle>Protocolo de remediación</CardTitle>
                    <CardDescription>{incident.title}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                            <AlertTriangle className="h-6 w-6 text-destructive" />
                        </div>
                        <p className="font-medium">Se agotaron los intentos</p>
                        <p className="text-sm text-muted-foreground max-w-sm">
                            La evidencia no superó la validación después de {maxAttempts} intentos.
                            Avisa al gerente de sucursal para corregir el problema y verificarlo
                            manualmente.
                        </p>
                    </div>
                </CardContent>
                <CardFooter className="justify-end">
                    <Button variant="outline" onClick={onCancel}>
                        Cerrar protocolo
                    </Button>
                </CardFooter>
            </Card>
        );
    }

    const currentStepData = steps[activeStep];
    const requierePhoto = currentStepData.validationCriteria?.type === 'photo';

    /**
     * Un paso de foto se envia con la URL, no con el texto.
     *
     * El backend decide por la forma de la evidencia: si llega una URL, corre
     * la verificacion por IA (`/api/incidents/[id]/remediate`); si llega texto
     * libre, no. Mandar la nota escrita en un paso `type: 'photo'` hacia que la
     * validacion nunca se ejecutara y el paso pasara por descripcion.
     */
    const puedeEnviar = requierePhoto ? Boolean(photoUrl) : Boolean(evidence.trim());

    const limpiarPaso = () => {
        setEvidence('');
        setPhotoUrl(null);
        setStepResult(null);
    };

    const subirArchivos = async (files: File[]) => {
        if (files.length === 0) return;
        try {
            // Una sola foto por paso: el protocolo valida un estado, no una
            // secuencia, y varias fotos obligarian a decidir cual manda.
            const [subida] = await uploadPhotos([files[0]]);
            if (subida?.url) {
                setPhotoUrl(subida.url);
                setStepResult(null);
            }
        } catch {
            // `uploadError` del hook ya se muestra debajo del control.
        }
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setStepResult(null);

        try {
            const payload = requierePhoto
                ? { value: photoUrl, evidenceUrl: photoUrl, notes: evidence.trim() || undefined }
                : evidence;
            const result = await onSubmitStep(activeStep, payload);
            setStepResult(result);

            if (result.success) {
                // Move to next step or complete
                if (activeStep < steps.length - 1) {
                    setTimeout(() => {
                        setActiveStep(activeStep + 1);
                        limpiarPaso();
                    }, 1500);
                } else {
                    // All steps completed
                    setTimeout(() => {
                        onComplete();
                    }, 1500);
                }
            }
        } catch (error) {
            setStepResult({
                success: false,
                message: error instanceof Error ? error.message : 'No se pudo enviar la evidencia',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePrevious = () => {
        if (activeStep > 0) {
            setActiveStep(activeStep - 1);
            limpiarPaso();
        }
    };

    return (
        <Card className="w-full max-w-2xl">
            <CardHeader>
                <div className="flex items-center justify-between mb-2">
                    <CardTitle>Protocolo de remediación</CardTitle>
                    <Badge variant="outline">
                        Paso {activeStep + 1} de {steps.length}
                    </Badge>
                </div>
                <CardDescription>{incident.title}</CardDescription>
                <Progress value={progress} className="mt-2" />
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Attempt Counter */}
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Intento {currentAttempt + 1} de {maxAttempts}</span>
                    {currentAttempt >= maxAttempts - 1 && (
                        <Badge variant="destructive" className="text-xs">
                            Intento final
                        </Badge>
                    )}
                </div>

                {/* Current Step Instruction */}
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="font-medium">
                        {currentStepData.instruction}
                    </AlertDescription>
                </Alert>

                {/* Evidencia: foto cuando el paso la exige, texto en el resto */}
                {requierePhoto ? (
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Evidencia fotográfica</label>

                        {photoUrl ? (
                            <div className="space-y-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={photoUrl}
                                    alt="Evidencia de remediación"
                                    className="max-h-56 w-full rounded-md border bg-muted object-contain"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setPhotoUrl(null)}
                                    disabled={isSubmitting}
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Quitar foto
                                </Button>
                            </div>
                        ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setCameraOpen(true)}
                                    disabled={uploading || isSubmitting}
                                >
                                    <Camera className="h-4 w-4 mr-2" />
                                    Tomar foto
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading || isSubmitting}
                                >
                                    <Upload className="h-4 w-4 mr-2" />
                                    Subir foto
                                </Button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => {
                                        void subirArchivos(Array.from(e.target.files ?? []));
                                        e.target.value = '';
                                    }}
                                />
                            </div>
                        )}

                        {uploading && (
                            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Subiendo foto…
                            </p>
                        )}
                        {uploadError && (
                            <p className="text-xs text-destructive">
                                No se pudo subir la foto. Intenta de nuevo.
                            </p>
                        )}

                        <label className="text-sm font-medium">Notas (opcional)</label>
                        <Textarea
                            placeholder="Agrega contexto para quien revise…"
                            value={evidence}
                            onChange={(e) => setEvidence(e.target.value)}
                            rows={2}
                            disabled={isSubmitting}
                        />
                        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Sparkles className="h-3.5 w-3.5" />
                            La foto se verifica automáticamente. Arriba de{' '}
                            {Math.round(UMBRAL_AUTO_APROBACION * 100)}% de confianza el paso se
                            aprueba solo; por debajo queda para revisión manual.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Evidencia / Notas</label>
                        <Textarea
                            placeholder="Describe lo que hiciste o pega la URL de la evidencia…"
                            value={evidence}
                            onChange={(e) => setEvidence(e.target.value)}
                            rows={4}
                            disabled={isSubmitting}
                        />
                    </div>
                )}

                {/* Step Result */}
                {stepResult && (
                    <Alert variant={stepResult.success ? 'default' : 'destructive'}>
                        {stepResult.success ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                            <XCircle className="h-4 w-4" />
                        )}
                        <AlertDescription className="space-y-1">
                            <span className="block">
                                {stepResult.message || (stepResult.success ? '¡Paso completado correctamente!' : 'La validación del paso falló')}
                            </span>
                            {/*
                              * El score se muestra cuando la IA opinó. Sin esto,
                              * un rechazo por confianza baja se leía igual que un
                              * rechazo por criterio, y el empleado repetía el
                              * intento sin saber que lo que fallaba era la foto.
                              */}
                            {typeof stepResult.aiResult?.details?.confidence === 'number' && (
                                <span className="block text-xs opacity-90">
                                    Confianza de la IA:{' '}
                                    {Math.round(stepResult.aiResult.details.confidence * 100)}%
                                    {stepResult.aiResult.details.confidence >= UMBRAL_AUTO_APROBACION
                                        ? ' · aprobado automáticamente'
                                        : ' · queda para revisión manual'}
                                </span>
                            )}
                            {stepResult.aiResult?.reason && (
                                <span className="block text-xs opacity-90">
                                    {stepResult.aiResult.reason}
                                </span>
                            )}
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>

            <CardFooter className="flex justify-between">
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        onClick={handlePrevious}
                        disabled={activeStep === 0 || isSubmitting}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Anterior
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={onCancel}
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </Button>
                </div>

                <Button
                    onClick={handleSubmit}
                    disabled={!puedeEnviar || isSubmitting || uploading}
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Validando…
                        </>
                    ) : activeStep < steps.length - 1 ? (
                        <>
                            Siguiente paso
                            <ArrowRight className="h-4 w-4 ml-2" />
                        </>
                    ) : (
                        <>
                            Completar
                            <CheckCircle2 className="h-4 w-4 ml-2" />
                        </>
                    )}
                </Button>
            </CardFooter>

            <CameraCapture
                open={cameraOpen}
                onOpenChange={setCameraOpen}
                onConfirm={(files) => void subirArchivos(files)}
                maxPhotos={1}
            />
        </Card>
    );
}
