'use client';

import { useState } from 'react';
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
import { CheckCircle2, XCircle, AlertCircle, AlertTriangle, ArrowRight, ArrowLeft, Camera, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

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
    onSubmitStep: (stepIndex: number, evidence: unknown) => Promise<{ success: boolean; message?: string }>;
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
    const [stepResult, setStepResult] = useState<{ success: boolean; message?: string } | null>(null);

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

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setStepResult(null);

        try {
            const result = await onSubmitStep(activeStep, evidence);
            setStepResult(result);

            if (result.success) {
                // Move to next step or complete
                if (activeStep < steps.length - 1) {
                    setTimeout(() => {
                        setActiveStep(activeStep + 1);
                        setEvidence('');
                        setStepResult(null);
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
            setEvidence('');
            setStepResult(null);
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

                {/* Evidence Input */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Evidencia / Notas</label>
                    <Textarea
                        placeholder="Describe lo que hiciste o pega la URL de la evidencia..."
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                        rows={4}
                        disabled={isSubmitting}
                    />
                    {currentStepData.validationCriteria?.type === 'photo' && (
                        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Camera className="h-3.5 w-3.5" />
                            Este paso requiere evidencia fotográfica para validarse.
                        </p>
                    )}
                </div>

                {/* Step Result */}
                {stepResult && (
                    <Alert variant={stepResult.success ? 'default' : 'destructive'}>
                        {stepResult.success ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                            <XCircle className="h-4 w-4" />
                        )}
                        <AlertDescription>
                            {stepResult.message || (stepResult.success ? '¡Paso completado correctamente!' : 'La validación del paso falló')}
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
                    disabled={!evidence.trim() || isSubmitting}
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
        </Card>
    );
}
