"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Smartphone, Monitor, AlertTriangle, CheckCircle2, Clock, MapPin, Thermometer, Camera, FileText, CheckSquare, Info, Minus, Mic, Video, Wrench, Megaphone, Bot } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { getStepCategory, normalizeOptions, STEP_TYPE_DISPLAY } from '@/lib/workflow-type-map';

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: any[];
  isCatalog?: boolean;
}

interface PreviewClientProps {
    template: WorkflowTemplate;
}

const STEP_ICONS: Record<string, any> = {
  'TimeField': Clock, 'TimerField': Clock, 'DateTime': Clock,
  'TIME': Clock, 'TIMER': Clock, 'DATE': Clock,
  'TemperatureField': Thermometer,
  'PhotoField': Camera, 'photo': Camera, 'Photo': Camera, 'PHOTO': Camera,
  'OPSLocationField': MapPin, 'GPSLocationField': MapPin, 'LOCATION': MapPin,
  'SignatureField': FileText, 'Signature': FileText, 'SIGNATURE': FileText,
  'YesNo': CheckCircle2, 'yes_no': CheckCircle2, 'YESNO': CheckCircle2,
  'TextField': FileText, 'Text': FileText, 'text': FileText, 'TEXT': FileText,
  'NumberField': FileText, 'Number': FileText, 'number': FileText, 'NUMBER': FileText,
  'ChecklistField': CheckSquare, 'Checkbox': CheckSquare, 'checklist': CheckSquare, 'CheckboxField': CheckSquare, 'CHECKBOX': CheckSquare,
  'Select': CheckCircle2, 'multiple_choice': CheckCircle2, 'Radio': CheckCircle2, 'SELECT': CheckCircle2,
  'Heading': Info, 'Title': Info, 'SubTitle': Info, 'Paragraph': Info, 'instruction': Info, 'INFO': Info,
  'Separator': Minus,
  'video': Video, 'Video': Video, 'VIDEO': Video,
  'audio': Mic, 'AUDIO': Mic,
};

export function PreviewClient({ template }: PreviewClientProps) {
    const [viewMode, setViewMode] = useState<'mobile' | 'desktop'>('mobile');
    const [currentStepIndex, setCurrentStepIndex] = useState(0);

    const currentStep = template.steps[currentStepIndex];
    const StepIcon = STEP_ICONS[currentStep?.type] || FileText;

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'CRITICAL': return 'text-destructive bg-destructive/10 border-destructive/30';
            case 'HIGH': return 'text-orange-600 bg-warning/10 border-warning/30';
            case 'WARNING': return 'text-warning bg-warning/10 border-warning/30';
            case 'PASS': return 'text-success bg-success/10 border-success/30';
            default: return 'text-muted-foreground bg-muted border-border';
        }
    };

    const getSeverityIcon = (severity: string) => {
        const className = "h-4 w-4";
        switch (severity) {
            case 'CRITICAL': return <AlertTriangle className={cn(className, "text-destructive")} />;
            case 'HIGH': return <AlertTriangle className={cn(className, "text-orange-600")} />;
            case 'WARNING': return <AlertTriangle className={cn(className, "text-warning")} />;
            case 'PASS': return <CheckCircle2 className={cn(className, "text-success")} />;
            default: return <FileText className={cn(className, "text-muted-foreground")} />;
        }
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <div className="border-b bg-card">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link href={template.isCatalog ? '/dashboard/builder/templates' : `/dashboard/builder/editor/${template.id}`}>
                                <Button variant="ghost" size="icon">
                                    <ArrowLeft className="h-4 w-4" />
                                </Button>
                            </Link>
                            <div>
                                <h1 className="text-xl font-semibold">{template.name}</h1>
                                <p className="text-sm text-muted-foreground">Modo de Vista Previa</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant={viewMode === 'mobile' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setViewMode('mobile')}
                            >
                                <Smartphone className="h-4 w-4 mr-2" />
                                Móvil
                            </Button>
                            <Button
                                variant={viewMode === 'desktop' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setViewMode('desktop')}
                            >
                                <Monitor className="h-4 w-4 mr-2" />
                                Escritorio
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Preview Container */}
            <div className="container mx-auto px-6 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Step List */}
                    <div className="lg:col-span-1">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm">Pasos del Flujo</CardTitle>
                                <CardDescription>{template.steps.length} pasos en total</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="divide-y">
                                    {template.steps.map((step, index) => {
                                        const Icon = STEP_ICONS[step.type] || FileText;
                                        return (
                                            <button
                                                key={step.id}
                                                onClick={() => setCurrentStepIndex(index)}
                                                className={cn(
                                                    "w-full text-left px-4 py-3 hover:bg-accent transition-colors",
                                                    currentStepIndex === index && "bg-accent/80 font-semibold text-primary"
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                                                        {index + 1}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <Icon className="h-3 w-3 text-muted-foreground" />
                                                            <p className="text-sm font-medium truncate">{step.title}</p>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">{STEP_TYPE_DISPLAY[step.type] || step.type}</p>
                                                        {step.logicRules && step.logicRules.length > 0 && (
                                                            <Badge variant="secondary" className="mt-1 text-xs">
                                                                {step.logicRules.length} regla{step.logicRules.length > 1 ? 's' : ''}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Mobile/Desktop Preview */}
                    <div className="lg:col-span-2">
                        <div className={cn(
                            "mx-auto transition-all",
                            viewMode === 'mobile' ? 'max-w-md' : 'max-w-4xl'
                        )}>
                            {/* Device Frame */}
                            <div className={cn(
                                "bg-card rounded-xl overflow-hidden border",
                                viewMode === 'mobile' && "border-8 border-border rounded-xl"
                            )}>
                                {/* Device Notch (Mobile only) */}
                                {viewMode === 'mobile' && (
                                    <div className="h-6 bg-muted flex items-center justify-center">
                                        <div className="w-32 h-4 bg-muted-foreground/20 rounded-full"></div>
                                    </div>
                                )}

                                {/* Content */}
                                <div className={cn(
                                    "bg-card",
                                    viewMode === 'mobile' ? 'h-[600px]' : 'min-h-[600px]',
                                    "overflow-y-auto"
                                )}>
                                    {/* Step Header */}
                                    <div className="sticky top-0 bg-card border-b z-10 px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                <StepIcon className="h-5 w-5 text-primary" />
                                            </div>
                                            <div className="flex-1">
                                                <h2 className="font-semibold">{currentStep?.title}</h2>
                                                <p className="text-xs text-muted-foreground">
                                                    Paso {currentStepIndex + 1} de {template.steps.length}
                                                </p>
                                            </div>
                                            {currentStep?.required && (
                                                <Badge variant="destructive">Obligatorio</Badge>
                                            )}
                                        </div>
                                        {currentStep?.description && (
                                            <p className="text-sm text-muted-foreground mt-2">
                                                {currentStep.description}
                                            </p>
                                        )}
                                    </div>

                                    {/* Step Content */}
                                    <div className="p-6 space-y-6">
                                        {/* Field Input Preview */}
                                        <Card className="border-2 border-primary/20">
                                            <CardHeader className="pb-3">
 <CardTitle className="text-sm flex items-center gap-2">
 <StepIcon className="h-4 w-4" />
 {STEP_TYPE_DISPLAY[currentStep?.type] || currentStep?.type}
                                                </CardTitle>
                                                <CardDescription className="text-xs">
                                                    Vista previa del campo
                                                </CardDescription>
                                            </CardHeader>
 <CardContent>
 {(() => {
 if (!currentStep) return null;
 const cat = getStepCategory(currentStep.type);

 if (cat === 'PHOTO' || cat === 'VIDEO') {
  return (
  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
  <Camera className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
  <p className="text-sm text-muted-foreground">{cat === 'VIDEO' ? 'Toca para grabar video' : 'Toca para tomar foto'}</p>
 </div>
 );
 }

 if (cat === 'NUMBER') {
 return (
  <div className="space-y-2">
  <label htmlFor={`${currentStep.id}-value`} className="text-sm font-medium">Ingresa valor</label>
  <div className="flex items-center gap-2">
  <input
  id={`${currentStep.id}-value`}
  type="number"
  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
  placeholder="0"
  disabled
  />
 {currentStep.type === 'TemperatureField' && (
 <span className="text-sm text-muted-foreground">°C</span>
 )}
 </div>
 </div>
 );
 }

 if (cat === 'TEXT') {
 return (
  <div className="space-y-2">
  <label htmlFor={`${currentStep.id}-text`} className="text-sm font-medium">Ingresa texto</label>
  <textarea
  id={`${currentStep.id}-text`}
  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
  placeholder="Escribe aquí..."
  disabled
  />
 </div>
 );
 }

 if (cat === 'YESNO') {
 return (
 <div className="space-y-2">
  <label className="text-sm font-medium">Selecciona opción</label>
 <div className="flex gap-2">
  <button className="flex-1 h-12 rounded-md border-2 border-success bg-success/10 text-success font-medium">
  ✓ Sí
  </button>
  <button className="flex-1 h-12 rounded-md border-2 border-destructive bg-destructive/10 text-destructive font-medium">
  ✗ No
  </button>
 </div>
 </div>
 );
 }

 if (cat === 'TIME' || cat === 'TIMER' || cat === 'DATE') {
 return (
  <div className="space-y-2">
  <label htmlFor={`${currentStep.id}-time`} className="text-sm font-medium">Selecciona {cat === 'DATE' ? 'fecha/hora' : cat === 'TIMER' ? 'temporizador' : 'hora'}</label>
  <input
  id={`${currentStep.id}-time`}
  type={cat === 'DATE' ? 'datetime-local' : 'time'}
  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
  disabled
  />
 </div>
 );
 }

 if (cat === 'LOCATION') {
  return (
  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
  <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
  <p className="text-sm text-muted-foreground">Toca para capturar ubicación</p>
 <p className="text-xs text-muted-foreground mt-1">Se registrarán las coordenadas GPS</p>
 </div>
 );
 }

 if (cat === 'SIGNATURE') {
  return (
  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
  <p className="text-sm text-muted-foreground">Toca para firmar</p>
 </div>
 );
 }

 if (cat === 'CHECKBOX') {
 const items = normalizeOptions(currentStep.options || currentStep.config?.options);
 return (
  <div className="space-y-2">
  <label className="text-sm font-medium">Elementos de lista</label>
  <div className="space-y-2">
  {items.length > 0 ? items.map((option: string, i: number) => (
  <div key={i} className="flex items-center gap-2 p-2 border rounded">
  <input id={`${currentStep.id}-check-${i}`} type="checkbox" className="h-4 w-4" disabled />
  <label htmlFor={`${currentStep.id}-check-${i}`} className="text-sm">{option}</label>
 </div>
 )) : (
 <>
  <div className="flex items-center gap-2 p-2 border rounded">
  <input id={`${currentStep.id}-check-0`} type="checkbox" className="h-4 w-4" disabled />
  <label htmlFor={`${currentStep.id}-check-0`} className="text-sm">Item 1</label>
  </div>
  <div className="flex items-center gap-2 p-2 border rounded">
  <input id={`${currentStep.id}-check-1`} type="checkbox" className="h-4 w-4" disabled />
  <label htmlFor={`${currentStep.id}-check-1`} className="text-sm">Item 2</label>
  </div>
 </>
 )}
 </div>
 </div>
 );
 }

 if (cat === 'SELECT') {
 const options = normalizeOptions(currentStep.options || currentStep.config?.options);
 return (
  <div className="space-y-2">
  <label htmlFor={`${currentStep.id}-select`} className="text-sm font-medium">Selecciona opción</label>
  <select id={`${currentStep.id}-select`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" disabled>
  <option>Elige una opción...</option>
 {options.map((option: string, i: number) => (
 <option key={i}>{option}</option>
 ))}
 </select>
 </div>
 );
 }

 if (cat === 'AUDIO') {
  return (
  <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
  <Mic className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
  <p className="text-sm text-muted-foreground">Nota de audio</p>
 </div>
 );
 }

 if (cat === 'INFO') {
  if (currentStep.type === 'Separator') {
  return <hr className="border-t border-border my-2" />;
  }
  const content = currentStep.config?.content || (currentStep as any).text || currentStep.description || currentStep.title;
  return (
  <div className="bg-accent border border-accent rounded-lg p-4">
  <p className="text-sm text-accent-foreground">{content}</p>
 </div>
 );
 }

 return (
  <div className="space-y-2">
  <label htmlFor={`${currentStep.id}-response`} className="text-sm font-medium">Respuesta</label>
  <input
  id={`${currentStep.id}-response`}
  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
  placeholder="Escribe respuesta..."
  disabled
  />
 <p className="text-xs text-muted-foreground">Tipo: {currentStep.type}</p>
 </div>
 );
 })()}
 </CardContent>
                                        </Card>
                                        {/* AI Verification */}
                                        {currentStep?.aiVerification?.enabled && (
                                            <Card className="border-primary/20 bg-primary/5">
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-sm flex items-center gap-2">
                                                        <Bot className="h-4 w-4 text-primary" />
                                                        Verificación IA Activada
                                                    </CardTitle>
                                                </CardHeader>
                                                <CardContent className="text-xs space-y-2">
                                                    {currentStep.aiVerification.prompt && (
                                                        <p className="text-muted-foreground">
                                                            <strong>Prompt:</strong> {currentStep.aiVerification.prompt}
                                                        </p>
                                                    )}
                                                    {currentStep.aiVerification.expectedConditions && (
                                                        <div>
                                                            <strong>Condiciones Esperadas:</strong>
                                                            <ul className="list-disc list-inside mt-1">
                                                                {currentStep.aiVerification.expectedConditions.map((cond: string, i: number) => (
                                                                    <li key={i}>{cond}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        )}

                                        {/* Validation Rules */}
                                        {currentStep?.validation && (
                                            <Card>
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-sm">Reglas de Validación</CardTitle>
                                                </CardHeader>
                                                <CardContent className="text-xs space-y-1">
                                                    {currentStep.validation.min !== undefined && (
                                                        <p>• Mínimo: {currentStep.validation.min}</p>
                                                    )}
                                                    {currentStep.validation.max !== undefined && (
                                                        <p>• Máximo: {currentStep.validation.max}</p>
                                                    )}
                                                    {currentStep.validation.minTime && (
                                                        <p>• Hora más temprana: {currentStep.validation.minTime}</p>
                                                    )}
                                                    {currentStep.validation.maxTime && (
                                                        <p>• Hora más tardía: {currentStep.validation.maxTime}</p>
                                                    )}
                                                    {currentStep.validation.radiusMeters && (
                                                        <p>• Radio de ubicación: {currentStep.validation.radiusMeters}m</p>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        )}

                                        {/* Logic Rules */}
                                        {currentStep?.logicRules && currentStep.logicRules.length > 0 && (
                                            <div className="space-y-3">
                                                <h3 className="font-semibold text-sm">Reglas Lógicas e Incidentes</h3>
                                                {currentStep.logicRules.map((rule: any, index: number) => (
                                                    <Card key={rule.id || index} className={cn("border-2", getSeverityColor(rule.severity))}>
                                                        <CardHeader className="pb-3">
                                                            <div className="flex items-start gap-2">
                                                                {getSeverityIcon(rule.severity)}
                                                                <div className="flex-1">
                                                                    <CardTitle className="text-sm">
                                                                        Alerta {rule.severity}
                                                                    </CardTitle>
                                                                    <CardDescription className="text-xs mt-1">
                                                                        {rule.message}
                                                                    </CardDescription>
                                                                </div>
                                                            </div>
                                                        </CardHeader>
                                                        <CardContent className="space-y-3">
                                                            <div className="text-xs">
                                                                <strong>Condición:</strong>
                                                                <code className="ml-2 bg-muted px-2 py-0.5 rounded text-xs">
                                                                    {rule.condition}
                                                                </code>
                                                            </div>

                                                            {/* Remediation */}
                                                            {rule.remediationProtocol?.enabled && (
                                                                <div className="border-t pt-3">
                                                                    <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Wrench className="h-3 w-3" /> Protocolo de Remedio</p>
                                                                    <div className="space-y-2">
                                                                        <p className="text-xs text-muted-foreground">
                                                                            Intentos máx.: {rule.remediationProtocol.maxAttempts} •
                                                                            Tiempo límite: {rule.remediationProtocol.timeoutMinutes} min
                                                                        </p>
                                                                        {rule.remediationProtocol.steps?.map((step: any, i: number) => (
                                                                            <div key={i} className="bg-muted p-2 rounded text-xs">
                                                                                <strong>Step {i + 1}:</strong> {step.instruction}
                                                                                {step.waitSeconds && (
                                                                                    <p className="text-muted-foreground mt-1">
                                                                                        Espera: {step.waitSeconds}s
                                                                                    </p>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* Escalation */}
                                                            {rule.escalationChain && rule.escalationChain.length > 0 && (
                                                                <div className="border-t pt-3">
                                                                    <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Megaphone className="h-3 w-3" /> Cadena de Escalación</p>
                                                                    <div className="space-y-2">
                                                                        {rule.escalationChain.map((esc: any, i: number) => (
                                                                            <div key={i} className="bg-muted p-2 rounded text-xs">
                                                                                <div className="flex items-center gap-2 mb-1">
                                                                                    <Badge variant="outline" className="text-xs">
                                                                                        Nivel {esc.level}
                                                                                    </Badge>
                                                                                    <span className="text-muted-foreground">
                                                                                        Después de {esc.triggerAfterMinutes} min
                                                                                    </span>
                                                                                </div>
                                                                                <p><strong>Notificar a:</strong> {esc.notifyRoles?.join(', ')}</p>
                                                                                <p><strong>Canal:</strong> {esc.channel}</p>
                                                                                <p className="mt-1 italic">"{esc.message}"</p>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </CardContent>
                                                    </Card>
                                                ))}
                                            </div>
                                        )}

                                        {/* Navigation */}
                                        <div className="flex gap-2 pt-4">
                                            <Button
                                                variant="outline"
                                                className="flex-1"
                                                disabled={currentStepIndex === 0}
                                                onClick={() => setCurrentStepIndex(prev => Math.max(0, prev - 1))}
                                            >
                                                Anterior
                                            </Button>
                                            <Button
                                                className="flex-1"
                                                disabled={currentStepIndex === template.steps.length - 1}
                                                onClick={() => setCurrentStepIndex(prev => Math.min(template.steps.length - 1, prev + 1))}
                                            >
                                                Siguiente
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Device Home Indicator (Mobile only) */}
                                {viewMode === 'mobile' && (
                                    <div className="h-6 bg-white flex items-center justify-center">
                                        <div className="w-32 h-1 bg-border rounded-full"></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
