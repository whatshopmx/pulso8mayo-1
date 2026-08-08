"use client";

import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
    ArrowRight, Camera, CheckCircle2, FileText, Info,
    MapPin, Thermometer, Clock, Mic, Video, Upload, Trash2, Eye
} from "lucide-react";
import { toast } from "sonner";
import { WorkflowStep as BuilderWorkflowStep } from "@/components/builder/builder-context";
import { getStepCategory, normalizeOptions, STEP_TYPE_DISPLAY } from "@/lib/workflow-type-map";
import { Badge } from "@/components/ui/badge";

interface WorkflowPreviewModalProps {
 open: boolean;
 onClose: () => void;
 steps: BuilderWorkflowStep[];
 title: string;
}

function StepField({ step, value, onChange, evidenceUrl, onEvidenceChange, checkboxValues, onCheckboxChange }: {
 step: BuilderWorkflowStep;
 value: string;
 onChange: (v: string) => void;
 evidenceUrl: string[];
 onEvidenceChange: (urls: string[]) => void;
 checkboxValues: Record<string, boolean>;
 onCheckboxChange: (key: string, val: boolean) => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cat = getStepCategory(step.type);

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        Array.from(files).forEach(file => {
            if (file.size > 10 * 1024 * 1024) { toast.error("Imagen demasiado grande"); return; }
            const reader = new FileReader();
            reader.onload = () => onEvidenceChange([...evidenceUrl, reader.result as string]);
            reader.readAsDataURL(file);
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
    }, [evidenceUrl, onEvidenceChange]);

 if (cat === 'INFO') {
 if (step.type === 'Separator') {
 return <Separator className="my-2" />;
 }
 const content = step.config?.content as string || (step as any).text || step.description || step.title || "Lee esta información antes de continuar.";
 return (
 <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg flex gap-3 text-blue-700 dark:text-blue-300">
 <Info className="h-5 w-5 shrink-0 mt-0.5" />
 <p className="text-sm">{content}</p>
 </div>
 );
 }

    if (cat === 'TEXT') {
        return (
            <div className="space-y-2">
                <Label>Tu Respuesta</Label>
                <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder="Escribe aquí..." rows={3} />
            </div>
        );
    }

    if (cat === 'NUMBER') {
        const unit = step.type === 'TemperatureField' ? '°C' : (step.config?.unit as string || '');
        return (
            <div className="space-y-2">
                <Label className="flex items-center gap-2">
                    {step.type === 'TemperatureField' && <Thermometer className="h-4 w-4 text-orange-500" />}
                    Valor numérico
                </Label>
                <div className="flex items-center gap-2">
                    <Input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder="0" className="flex-1" />
                    {unit && <span className="text-sm text-muted-foreground font-medium">{unit}</span>}
                </div>
            </div>
        );
    }

    if (cat === 'YESNO') {
        return (
            <div className="space-y-2">
                <Label>Selecciona una opción</Label>
                <div className="flex gap-3">
                    <button
                        onClick={() => onChange('SI')}
                        className={`flex-1 h-12 rounded-lg border-2 font-semibold transition-colors ${value === 'SI' ? 'border-green-500 bg-green-100 text-green-700' : 'border-border hover:bg-muted'}`}
                    >
                        ✓ Sí
                    </button>
                    <button
                        onClick={() => onChange('NO')}
                        className={`flex-1 h-12 rounded-lg border-2 font-semibold transition-colors ${value === 'NO' ? 'border-red-500 bg-red-100 text-red-700' : 'border-border hover:bg-muted'}`}
                    >
                        ✗ No
                    </button>
                </div>
            </div>
        );
    }

    if (cat === 'SELECT') {
        const options: string[] = normalizeOptions(step.options || step.config?.options);
        return (
            <div className="space-y-2">
                <Label>Selecciona una opción</Label>
                {options.length <= 5 ? (
                    <RadioGroup value={value} onValueChange={onChange} className="space-y-2">
                        {options.map((opt, i) => (
                            <div key={i} className="flex items-center gap-2 border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                                <RadioGroupItem value={String(opt)} id={`opt-${i}`} />
                                <Label htmlFor={`opt-${i}`} className="flex-1 cursor-pointer font-normal">{String(opt)}</Label>
                            </div>
                        ))}
                    </RadioGroup>
                ) : (
                    <Select value={value} onValueChange={onChange}>
                        <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                        <SelectContent>
                            {options.map((opt, i) => (
                                <SelectItem key={i} value={String(opt)}>{String(opt)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>
        );
    }

    if (cat === 'CHECKBOX') {
        const items: string[] = normalizeOptions(step.options || step.config?.options || step.config?.items);
        return (
            <div className="space-y-2">
                <Label>Marca los elementos completados</Label>
                <div className="space-y-2">
                    {items.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">No hay ítems configurados</p>
                    ) : items.map((item, i) => (
                        <div key={i} className="flex items-center gap-3 border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                            <Checkbox
                                id={`chk-${i}`}
                                checked={!!checkboxValues[String(item)]}
                                onCheckedChange={v => onCheckboxChange(String(item), !!v)}
                            />
                            <Label htmlFor={`chk-${i}`} className="flex-1 cursor-pointer font-normal">{String(item)}</Label>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (cat === 'PHOTO') {
        return (
            <div className="space-y-3">
                <Label>Evidencia Fotográfica</Label>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload} />
                {evidenceUrl.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                        {evidenceUrl.map((url, i) => (
                            <div key={i} className="relative aspect-video rounded-lg overflow-hidden border group">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={`Evidencia ${i + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                                <button
                                    className="absolute top-1 right-1 h-6 w-6 rounded bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                    onClick={() => onEvidenceChange(evidenceUrl.filter((_, j) => j !== i))}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex flex-col gap-2">
                    <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                        <Camera className="h-4 w-4" /> Tomar / Subir Foto
                    </Button>
                </div>
            </div>
        );
    }

    if (cat === 'TIME') {
        return (
            <div className="space-y-2">
                <Label className="flex items-center gap-2"><Clock className="h-4 w-4" /> Hora</Label>
                <Input type="time" value={value} onChange={e => onChange(e.target.value)} />
            </div>
        );
    }

    if (cat === 'SIGNATURE') {
        return (
            <div className="space-y-3">
                <Label>Firma Digital</Label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">Escribe tu nombre completo para firmar digitalmente</p>
                    <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Nombre completo" className="text-center text-lg italic" />
                </div>
            </div>
        );
    }

    if (cat === 'LOCATION') {
        return (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Tap para capturar ubicación GPS</p>
                <Button variant="outline" className="mt-3 gap-2" onClick={() => onChange('GPS_CAPTURED')}>
                    <MapPin className="h-4 w-4" /> Capturar Ubicación (Preview)
                </Button>
            </div>
        );
    }

 if (cat === 'AUDIO') {
 return (
 <div className="border-2 border-dashed rounded-lg p-8 text-center">
 <Mic className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
 <p className="text-sm text-muted-foreground">Nota de voz</p>
 </div>
 );
 }

 if (cat === 'VIDEO') {
 return (
 <div className="border-2 border-dashed rounded-lg p-8 text-center">
 <Video className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
 <p className="text-sm text-muted-foreground">Grabar video</p>
 </div>
 );
 }

 if (cat === 'TIMER') {
 return (
 <div className="space-y-2">
 <Label className="flex items-center gap-2"><Clock className="h-4 w-4" /> Temporizador</Label>
 <Input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder="Segundos" />
 </div>
 );
 }

 if (cat === 'DATE') {
 return (
 <div className="space-y-2">
 <Label className="flex items-center gap-2"><Clock className="h-4 w-4" /> Fecha y hora</Label>
 <Input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} />
 </div>
 );
 }

    // Fallback
    return (
        <div className="space-y-2">
            <Label>Respuesta</Label>
            <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Ingresa tu respuesta..." />
            <p className="text-xs text-muted-foreground">Tipo: {step.type}</p>
        </div>
    );
}

const STEP_TYPE_ICON: Record<string, React.ReactNode> = {
  'TemperatureField': <Thermometer className="h-5 w-5 text-orange-500" />,
  'TimeField': <Clock className="h-5 w-5 text-blue-500" />,
  'TimerField': <Clock className="h-5 w-5 text-blue-500" />,
  'DateTime': <Clock className="h-5 w-5 text-blue-500" />,
  'PhotoField': <Camera className="h-5 w-5 text-purple-500" />,
  'photo': <Camera className="h-5 w-5 text-purple-500" />,
  'Photo': <Camera className="h-5 w-5 text-purple-500" />,
  'PHOTO': <Camera className="h-5 w-5 text-purple-500" />,
  'SignatureField': <FileText className="h-5 w-5 text-green-500" />,
  'Signature': <FileText className="h-5 w-5 text-green-500" />,
  'SIGNATURE': <FileText className="h-5 w-5 text-green-500" />,
  'OPSLocationField': <MapPin className="h-5 w-5 text-red-500" />,
  'GPSLocationField': <MapPin className="h-5 w-5 text-red-500" />,
  'LOCATION': <MapPin className="h-5 w-5 text-red-500" />,
  'video': <Video className="h-5 w-5 text-indigo-500" />,
  'Video': <Video className="h-5 w-5 text-indigo-500" />,
  'VIDEO': <Video className="h-5 w-5 text-indigo-500" />,
  'audio': <Mic className="h-5 w-5 text-pink-500" />,
  'AUDIO': <Mic className="h-5 w-5 text-pink-500" />,
  'YesNo': <CheckCircle2 className="h-5 w-5 text-green-500" />,
  'yes_no': <CheckCircle2 className="h-5 w-5 text-green-500" />,
  'YESNO': <CheckCircle2 className="h-5 w-5 text-green-500" />,
  'checklist': <Checkbox className="h-5 w-5 text-blue-500" />,
  'ChecklistField': <Checkbox className="h-5 w-5 text-blue-500" />,
  'Checkbox': <Checkbox className="h-5 w-5 text-blue-500" />,
  'CHECKBOX': <Checkbox className="h-5 w-5 text-blue-500" />,
  'Select': <CheckCircle2 className="h-5 w-5 text-indigo-500" />,
  'multiple_choice': <CheckCircle2 className="h-5 w-5 text-indigo-500" />,
  'Radio': <CheckCircle2 className="h-5 w-5 text-indigo-500" />,
  'SELECT': <CheckCircle2 className="h-5 w-5 text-indigo-500" />,
  'NumberField': <FileText className="h-5 w-5 text-primary" />,
  'Number': <FileText className="h-5 w-5 text-primary" />,
  'number': <FileText className="h-5 w-5 text-primary" />,
  'NUMBER': <FileText className="h-5 w-5 text-primary" />,
  'TextField': <FileText className="h-5 w-5 text-primary" />,
  'Text': <FileText className="h-5 w-5 text-primary" />,
  'text': <FileText className="h-5 w-5 text-primary" />,
  'TEXT': <FileText className="h-5 w-5 text-primary" />,
  'Heading': <Info className="h-5 w-5 text-blue-500" />,
  'Title': <Info className="h-5 w-5 text-blue-500" />,
  'SubTitle': <Info className="h-5 w-5 text-blue-500" />,
  'Paragraph': <Info className="h-5 w-5 text-blue-500" />,
  'Separator': <Separator className="h-5 w-5 text-muted-foreground" />,
  'instruction': <Info className="h-5 w-5 text-blue-500" />,
  'INFO': <Info className="h-5 w-5 text-blue-500" />,
  'timer': <Clock className="h-5 w-5 text-blue-500" />,
  'TIME': <Clock className="h-5 w-5 text-blue-500" />,
  'TIMER': <Clock className="h-5 w-5 text-blue-500" />,
  'DATE': <Clock className="h-5 w-5 text-blue-500" />,
};

export function WorkflowPreviewModal({ open, onClose, steps, title }: WorkflowPreviewModalProps) {
    const [currentIdx, setCurrentIdx] = useState(0);
    const [value, setValue] = useState("");
    const [evidenceUrl, setEvidenceUrl] = useState<string[]>([]);
    const [checkboxValues, setCheckboxValues] = useState<Record<string, boolean>>({});

    const currentStep = steps[currentIdx];
    const progress = steps.length > 0 ? ((currentIdx) / steps.length) * 100 : 0;
    const isFirst = currentIdx === 0;
    const isLast = currentIdx === steps.length - 1;
    const stepCategory = currentStep ? getStepCategory(currentStep.type) : 'TEXT';

    const canAdvance = (() => {
        if (!currentStep?.required) return true;
        if (stepCategory === 'INFO') return true;
        if (stepCategory === 'PHOTO') return evidenceUrl.length > 0;
        if (stepCategory === 'CHECKBOX') return Object.values(checkboxValues).some(Boolean);
        return !!value;
    })();

    const handleNext = () => {
        if (!canAdvance) { toast.error("Este campo es obligatorio"); return; }
        toast.success("Paso verificado ✓ (Preview)");
        if (isLast) {
            toast.success("🎉 Workflow completado (Preview)");
            setCurrentIdx(0);
        } else {
            setCurrentIdx(i => i + 1);
        }
        setValue(""); setEvidenceUrl([]); setCheckboxValues({});
    };

    const handlePrev = () => {
        if (!isFirst) { setCurrentIdx(i => i - 1); setValue(""); setEvidenceUrl([]); setCheckboxValues({}); }
    };

    if (!open) return null;

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        Vista Previa: {title}
                    </DialogTitle>
                    <DialogDescription>
                        Prueba tu workflow. Las acciones aquí no se guardan.
                    </DialogDescription>
                </DialogHeader>

                {steps.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                        <p>No hay pasos definidos en este workflow.</p>
                        <p className="text-sm mt-1">Agrega pasos desde el panel izquierdo.</p>
                    </div>
                ) : (
                    <div className="space-y-4 py-2">
                        {/* Progress */}
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Paso {currentIdx + 1} de {steps.length}</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                            <Progress value={progress} className="h-1.5" />
                        </div>

                        {/* Step dots */}
                        <div className="flex justify-center gap-1">
                            {steps.map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => { setCurrentIdx(i); setValue(""); setEvidenceUrl([]); setCheckboxValues({}); }}
                                    className={`h-1.5 rounded-full transition-all ${i === currentIdx ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/25'}`}
                                />
                            ))}
                        </div>

                        {/* Step card */}
                        {currentStep && (
                            <Card className="border-2">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start gap-3">
                                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                            {STEP_TYPE_ICON[currentStep.type] || <FileText className="h-5 w-5 text-primary" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <CardTitle className="text-base leading-snug">{currentStep.title || "Sin título"}</CardTitle>
                                            {currentStep.description && (
                                                <CardDescription className="text-sm mt-0.5">{currentStep.description}</CardDescription>
                                            )}
                                        </div>
                                        {currentStep.required && (
                                            <Badge variant="destructive" className="text-xs flex-shrink-0">Requerido</Badge>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Separator />
                                    <StepField
                                        step={currentStep}
                                        value={value}
                                        onChange={setValue}
                                        evidenceUrl={evidenceUrl}
                                        onEvidenceChange={setEvidenceUrl}
                                        checkboxValues={checkboxValues}
                                        onCheckboxChange={(k, v) => setCheckboxValues(prev => ({ ...prev, [k]: v }))}
                                    />

                                    {/* Logic Rules preview badge */}
                                    {currentStep.logicRules && currentStep.logicRules.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pt-1">
                                            {currentStep.logicRules.map((rule, i) => (
                                                <Badge key={i} variant="outline" className="text-xs gap-1">
                                                    {rule.severity === 'CRITICAL' ? '🔴' : rule.severity === 'HIGH' ? '🔶' : rule.severity === 'WARNING' ? '⚠️' : '✅'}
                                                    {rule.name || rule.condition || `Regla ${i + 1}`}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                                <CardFooter className="flex gap-2 pt-0">
                                    <Button variant="ghost" onClick={handlePrev} disabled={isFirst} className="flex-1">
                                        Atrás
                                    </Button>
                                    <Button onClick={handleNext} disabled={!canAdvance} className="flex-2">
                                        {isLast ? "Completar Workflow ✓" : <>Siguiente Paso <ArrowRight className="ml-1 h-4 w-4" /></>}
                                    </Button>
                                </CardFooter>
                            </Card>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
