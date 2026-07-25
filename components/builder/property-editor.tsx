
"use client";

import React from 'react';
import { useBuilder } from './builder-context';
import { getStepCategory, STEP_TYPE_DISPLAY } from '@/lib/workflow-type-map';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Info, HelpCircle } from 'lucide-react';
import { LogicRule, RuleAction } from './builder-context';
import { LogicRuleCard } from './logic-rule-card';
import { STEP_ACTION_TYPES, getStepActionType } from '@/lib/workflow-actions';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

export function PropertyEditor() {
    const { steps, selectedStepId, updateStep, removeStep } = useBuilder();
    const step = steps.find(s => s.id === selectedStepId);

    if (!step) {
        return (
            <div className="w-80 flex-shrink-0 border-l bg-accent/10 p-6 flex flex-col justify-center items-center text-center">
                <p className="text-muted-foreground">Selecciona un paso para editar sus propiedades</p>
            </div>
        );
    }

    return (
        <div className="w-80 flex-shrink-0 border-l bg-background p-6 space-y-6 overflow-y-auto h-full">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">{STEP_TYPE_DISPLAY[step.type] || step.type}</h3>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>¿Eliminar este paso?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Se eliminará "{step.title}" y toda su configuración (reglas lógicas, verificación IA, ramas). Esta acción se puede deshacer con Ctrl+Z.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeStep(step.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Eliminar
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <Label>Título</Label>
                    <Input
                        value={step.title}
                        onChange={(e) => updateStep(step.id, { title: e.target.value })}
                    />
                </div>

                {(getStepCategory(step.type) === 'TEXT' || getStepCategory(step.type) === 'NUMBER' || getStepCategory(step.type) === 'TIME' || getStepCategory(step.type) === 'DATE') && (
                    <div className="space-y-2">
                        <Label>Placeholder</Label>
                        <Input
                            value={step.placeholder || ''}
                            onChange={(e) => updateStep(step.id, { placeholder: e.target.value })}
                            placeholder="Texto de referencia..."
                        />
                    </div>
                )}

                {!(getStepCategory(step.type) === 'INFO' || getStepCategory(step.type) === 'PHOTO' || getStepCategory(step.type) === 'SIGNATURE' || getStepCategory(step.type) === 'LOCATION' || getStepCategory(step.type) === 'TIMER') && (
                    <div className="space-y-2">
                        <Label>Valor por Defecto</Label>
                        <Input
                            value={step.defaultValue || ''}
                            onChange={(e) => updateStep(step.id, { defaultValue: e.target.value })}
                            placeholder="Valor predeterminado..."
                        />
                    </div>
                )}

                <div className="space-y-2">
                    <Label>Categoría</Label>
                    <Input
                        value={step.category || ''}
                        onChange={(e) => updateStep(step.id, { category: e.target.value })}
                        placeholder="Ej. Seguridad, Calidad, Capacitación"
                    />
                </div>

                <div className="space-y-2">
                    <Label>Descripción</Label>
                    {getStepCategory(step.type) === 'INFO' ? (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs">Texto Enriquecido</Label>
                                <Switch
                                    checked={step.config?.richText || false}
                                    onCheckedChange={(c) => updateStep(step.id, {
                                        config: { ...step.config, richText: c }
                                    })}
                                />
                            </div>
                            {step.config?.richText ? (
                                <Textarea
                                    value={step.description || ''}
                                    onChange={(e) => updateStep(step.id, { description: e.target.value })}
                                    className="min-h-[120px] font-mono text-sm"
                                    placeholder="Usa etiquetas HTML: &lt;strong&gt;negritas&lt;/strong&gt;, &lt;em&gt;cursiva&lt;/em&gt;, &lt;br&gt; para saltos, etc."
                                />
                            ) : (
                                <Textarea
                                    value={step.description || ''}
                                    onChange={(e) => updateStep(step.id, { description: e.target.value })}
                                    className="min-h-[80px]"
                                />
                            )}
                        </div>
                    ) : (
                        <Textarea
                            value={step.description || ''}
                            onChange={(e) => updateStep(step.id, { description: e.target.value })}
                            className="min-h-[80px]"
                        />
                    )}
                </div>

                {getStepCategory(step.type) !== 'INFO' && (
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <Label className="cursor-pointer" htmlFor="req-switch">Obligatorio</Label>
                        <Switch
                            id="req-switch"
                            checked={step.required}
                            onCheckedChange={(c: boolean) => updateStep(step.id, { required: c })}
                        />
                    </div>
                )}

                {getStepCategory(step.type) !== 'INFO' && (
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <Label className="cursor-pointer" htmlFor="readonly-switch">Solo Lectura</Label>
                        <Switch
                            id="readonly-switch"
                            checked={step.readOnly || false}
                            onCheckedChange={(c: boolean) => updateStep(step.id, { readOnly: c })}
                        />
                    </div>
                )}
            </div>

            {/* Validation Config */}
            {(getStepCategory(step.type) === 'NUMBER') && (
                <div className="space-y-4 border-t pt-4">
                    <h4 className="font-medium text-sm">Validación</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs">Valor Mín.</Label>
                            <Input
                                type="number"
                                value={step.validation?.min ?? ''}
                                onChange={(e) => updateStep(step.id, {
                                    validation: { ...step.validation, min: parseFloat(e.target.value) }
                                })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Valor Máx.</Label>
                            <Input
                                type="number"
                                value={step.validation?.max ?? ''}
                                onChange={(e) => updateStep(step.id, {
                                    validation: { ...step.validation, max: parseFloat(e.target.value) }
                                })}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Mensaje de Error</Label>
                        <Input
                            placeholder="Valor fuera de rango"
                            value={step.validation?.message || ''}
                            onChange={(e) => updateStep(step.id, {
                                validation: { ...step.validation, message: e.target.value }
                            })}
                        />
                    </div>
                </div>
            )}

            {/* Time Validation */}
            {(getStepCategory(step.type) === 'TIME' || getStepCategory(step.type) === 'TIMER' || getStepCategory(step.type) === 'DATE') && (
                <div className="space-y-4 border-t pt-4">
                    <h4 className="font-medium text-sm">Validación de Hora</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs">Hora Mín.</Label>
                            <Input
                                type="time"
                                value={step.validation?.minTime || ''}
                                onChange={(e) => updateStep(step.id, {
                                    validation: { ...step.validation, minTime: e.target.value }
                                })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Hora Máx.</Label>
                            <Input
                                type="time"
                                value={step.validation?.maxTime || ''}
                                onChange={(e) => updateStep(step.id, {
                                    validation: { ...step.validation, maxTime: e.target.value }
                                })}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs">Mensaje de Error</Label>
                        <Input
                            placeholder="Hora fuera de rango"
                            value={step.validation?.message || ''}
                            onChange={(e) => updateStep(step.id, {
                                validation: { ...step.validation, message: e.target.value }
                            })}
                        />
                    </div>
                </div>
            )}

            {/* GPS/Location Validation */}
            {(getStepCategory(step.type) === 'LOCATION') && (
                <div className="space-y-4 border-t pt-4">
                    <h4 className="font-medium text-sm">Validación de Ubicación</h4>
                    <div className="space-y-2">
                        <Label className="text-xs">Radio (metros)</Label>
                        <Input
                            type="number"
                            placeholder="100"
                            value={step.validation?.radiusMeters || ''}
                            onChange={(e) => updateStep(step.id, {
                                validation: { ...step.validation, radiusMeters: parseInt(e.target.value) }
                            })}
                        />
                    </div>
                </div>
            )}

            {/* Type specific config */}
            {(getStepCategory(step.type) === 'PHOTO') && (
                <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-sm">Verificación IA</h4>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
                            </TooltipTrigger>
                            <TooltipContent>
                                Analiza la foto con modelos de IA para validar automáticamente el cumplimiento.
                            </TooltipContent>
                        </Tooltip>
                    </div>

                    <div className="flex items-center justify-between">
                        <Label htmlFor="ai-enabled" className="text-xs">Activar Verificación IA</Label>
                        <Switch
                            id="ai-enabled"
                            checked={step.aiVerification?.enabled || false}
                            onCheckedChange={(c: boolean) => updateStep(step.id, {
                                aiVerification: { ...step.aiVerification, enabled: c }
                            })}
                        />
                    </div>

                    {(step.aiVerification?.enabled) && (
                        <div className="space-y-4 pt-2">
                            <div className="space-y-2">
                                <Label className="text-xs flex items-center gap-1">
                                    Instrucción del Prompt
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-pointer" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            Instrucciones para el modelo de IA. Ej: "Verifica que el termómetro muestre menos de 4°C".
                                        </TooltipContent>
                                    </Tooltip>
                                </Label>
                                <Textarea
                                    placeholder="Ej. Verifica que el empleado lleve red para el cabello..."
                                    className="h-20 text-sm"
                                    value={step.aiVerification?.prompt || ''}
                                    onChange={(e) => updateStep(step.id, {
                                        aiVerification: { ...step.aiVerification, enabled: true, prompt: e.target.value }
                                    })}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs flex items-center gap-1">
                                    Condiciones Esperadas
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-pointer" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            Lista de condiciones clave separadas por comas. Ej: "red_puesta, uniforme_limpio".
                                        </TooltipContent>
                                    </Tooltip>
                                </Label>
                                <Input
                                    placeholder="red_presente, uniforme_limpio"
                                    className="text-sm"
                                    value={step.aiVerification?.expectedConditions?.join(', ') || ''}
                                    onChange={(e) => updateStep(step.id, {
                                        aiVerification: {
                                            ...step.aiVerification,
                                            enabled: true,
                                            expectedConditions: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                        }
                                    })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs flex items-center gap-1">
                                        Umbral Confianza
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-pointer" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                Nivel de certeza mínimo (0.0 a 1.0) para que la verificación sea aprobada automáticamente.
                                            </TooltipContent>
                                        </Tooltip>
                                    </Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="1"
                                        className="text-sm"
                                        value={step.aiVerification?.threshold || 0.8}
                                        onChange={(e) => updateStep(step.id, {
                                            aiVerification: { ...step.aiVerification, enabled: true, threshold: parseFloat(e.target.value) }
                                        })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs flex items-center gap-1">
                                        Auto-Llenar Campo
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-pointer" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                Elige otro paso de tipo Texto para volcar automáticamente el resultado del análisis de IA.
                                            </TooltipContent>
                                        </Tooltip>
                                    </Label>
                                    <Select
                                        value={step.aiVerification?.autoFillField || ''}
                                        onValueChange={(v) => updateStep(step.id, {
                                            aiVerification: { ...step.aiVerification, enabled: true, autoFillField: v }
                                        })}
                                    >
                                        <SelectTrigger className="text-sm">
                                            <SelectValue placeholder="Ninguno" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">Ninguno</SelectItem>
                                            {steps.filter(s => s.id !== step.id).map(s => (
                                                <SelectItem key={s.id} value={s.id} className="text-sm">
                                                    {s.title || STEP_TYPE_DISPLAY[s.type] || s.type}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Conditional Branches */}
            {(getStepCategory(step.type) === 'YESNO' || getStepCategory(step.type) === 'SELECT' || getStepCategory(step.type) === 'CHECKBOX') && (
                <div className="space-y-4 border-t pt-4">
                    <h4 className="font-medium text-sm">Ramas Condicionales</h4>
                    <p className="text-xs text-muted-foreground">
                        Salta a un paso diferente según la respuesta
                    </p>

                    {step.branches && step.branches.length > 0 ? (
                        <div className="space-y-2">
                            {step.branches.map((branch, idx) => (
                                <div key={branch.id || idx} className="border rounded p-2 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium">Rama {idx + 1}</span>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                                const newBranches = step.branches!.filter((_, i) => i !== idx);
                                                updateStep(step.id, { branches: newBranches });
                                            }}
                                            className="h-6 w-6 p-0 text-destructive"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                            Condición de salto
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Define cuándo se debe realizar el salto al paso de destino.
                                                </TooltipContent>
                                            </Tooltip>
                                        </Label>
                                        {getStepCategory(step.type) === 'YESNO' ? (
                                            <Select
                                                value={branch.condition}
                                                onValueChange={(v) => {
                                                    const newBranches = [...step.branches!];
                                                    newBranches[idx] = { ...newBranches[idx], condition: v };
                                                    updateStep(step.id, { branches: newBranches });
                                                }}
                                            >
                                                <SelectTrigger className="text-xs">
                                                    <SelectValue placeholder="Selecciona una condición..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="valor == 'si'" className="text-xs">Si responde "Sí"</SelectItem>
                                                    <SelectItem value="valor == 'no'" className="text-xs">Si responde "No"</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        ) : (step.options && step.options.length > 0) ? (
                                            <Select
                                                value={branch.condition}
                                                onValueChange={(v) => {
                                                    const newBranches = [...step.branches!];
                                                    newBranches[idx] = { ...newBranches[idx], condition: v };
                                                    updateStep(step.id, { branches: newBranches });
                                                }}
                                            >
                                                <SelectTrigger className="text-xs">
                                                    <SelectValue placeholder="Selecciona una opción..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {step.options.map((opt) => (
                                                        <SelectItem key={opt} value={`valor == '${opt}'`} className="text-xs">
                                                            Si se selecciona "{opt}"
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Input
                                                placeholder="Condición (ej. valor == 'opcion')"
                                                value={branch.condition}
                                                onChange={(e) => {
                                                    const newBranches = [...step.branches!];
                                                    newBranches[idx] = { ...newBranches[idx], condition: e.target.value };
                                                    updateStep(step.id, { branches: newBranches });
                                                }}
                                                className="text-xs"
                                            />
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Paso destino</Label>
                                        <Select
                                            value={branch.targetStepId || ''}
                                            onValueChange={(v) => {
                                                const newBranches = [...step.branches!];
                                                newBranches[idx] = { ...newBranches[idx], targetStepId: v };
                                                updateStep(step.id, { branches: newBranches });
                                            }}
                                        >
                                            <SelectTrigger className="text-xs">
                                                <SelectValue placeholder="Selecciona un paso..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {steps.filter(s => s.id !== step.id).map(s => (
                                                    <SelectItem key={s.id} value={s.id} className="text-xs">
                                                        {s.title || STEP_TYPE_DISPLAY[s.type] || s.type}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            const currentBranches = step.branches || [];
                            updateStep(step.id, {
                                branches: [...currentBranches, {
                                    id: crypto.randomUUID(),
                                    condition: '',
                                    targetStepId: ''
                                }]
                            });
                        }}
                        className="h-7 text-xs"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        Agregar Rama
                    </Button>
                </div>
            )}

            {/* Checklist & Select Options */}
            {(getStepCategory(step.type) === 'CHECKBOX' || getStepCategory(step.type) === 'SELECT') && (
                <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">
                            {getStepCategory(step.type) === 'CHECKBOX' ? 'Opciones de Lista' : 'Opciones de Selección'}
                        </h4>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                const currentOptions = step.options || [];
                                updateStep(step.id, {
                                    options: [...currentOptions, `Opción ${currentOptions.length + 1}`]
                                });
                            }}
                            className="h-7 text-xs"
                        >
                            <Plus className="h-3 w-3 mr-1" />
                            Agregar Opción
                        </Button>
                    </div>

                    {step.options && step.options.length > 0 ? (
                        <div className="space-y-2">
                            {step.options.map((option, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <Input
                                        value={option}
                                        onChange={(e) => {
                                            const newOptions = [...step.options!];
                                            newOptions[idx] = e.target.value;
                                            updateStep(step.id, { options: newOptions });
                                        }}
                                        placeholder={`Opción ${idx + 1}`}
                                        className="text-sm"
                                    />
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => {
                                            const newOptions = step.options!.filter((_, i) => i !== idx);
                                            updateStep(step.id, { options: newOptions });
                                        }}
                                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground text-center py-4">
                            No hay opciones definidas. Haz clic en "Agregar Opción" para crear una.
                        </p>
                    )}
                </div>
            )}
            {/* Conditional Logic */}
            <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">Visibilidad Condicional</h4>
                    <Switch
                        checked={!!step.conditionalLogic}
                        onCheckedChange={(c) => updateStep(step.id, {
                            conditionalLogic: c ? { fieldId: '', operator: 'equals', value: '' } : undefined
                        })}
                    />
                </div>

                {step.conditionalLogic && (
                    <div className="space-y-3 pl-2">
                        <p className="text-xs text-muted-foreground">
                            Este paso solo se mostrará cuando se cumpla la condición
                        </p>
                        <div className="space-y-2">
                            <Label className="text-xs">Campo fuente</Label>
                            <Select
                                value={step.conditionalLogic.fieldId || ''}
                                onValueChange={(v) => updateStep(step.id, {
                                    conditionalLogic: { ...step.conditionalLogic, fieldId: v }
                                })}
                            >
                                <SelectTrigger className="text-sm">
                                    <SelectValue placeholder="Selecciona un paso..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {steps.filter(s => s.id !== step.id).map(s => (
                                        <SelectItem key={s.id} value={s.id} className="text-sm">
                                            {s.title || STEP_TYPE_DISPLAY[s.type] || s.type}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Operador</Label>
                            <Select
                                value={step.conditionalLogic.operator || 'equals'}
                                onValueChange={(v) => updateStep(step.id, {
                                    conditionalLogic: { ...step.conditionalLogic, operator: v }
                                })}
                            >
                                <SelectTrigger className="text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="equals">Igual a</SelectItem>
                                    <SelectItem value="not_equals">Diferente de</SelectItem>
                                    <SelectItem value="contains">Contiene</SelectItem>
                                    <SelectItem value="greater_than">Mayor que</SelectItem>
                                    <SelectItem value="less_than">Menor que</SelectItem>
                                    <SelectItem value="is_empty">Está vacío</SelectItem>
                                    <SelectItem value="is_not_empty">No está vacío</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Valor</Label>
                            {(() => {
                                const sourceStep = steps.find(s => s.id === step.conditionalLogic.fieldId);
                                if (sourceStep) {
                                    const sourceCat = getStepCategory(sourceStep.type);
                                    if (sourceCat === 'YESNO') {
                                        return (
                                            <Select
                                                value={step.conditionalLogic.value || ''}
                                                onValueChange={(v) => updateStep(step.id, {
                                                    conditionalLogic: { ...step.conditionalLogic, value: v }
                                                })}
                                            >
                                                <SelectTrigger className="text-sm">
                                                    <SelectValue placeholder="Selecciona valor..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="si">Sí</SelectItem>
                                                    <SelectItem value="no">No</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        );
                                    }
                                    if ((sourceCat === 'SELECT' || sourceCat === 'CHECKBOX') && sourceStep.options && sourceStep.options.length > 0) {
                                        return (
                                            <Select
                                                value={step.conditionalLogic.value || ''}
                                                onValueChange={(v) => updateStep(step.id, {
                                                    conditionalLogic: { ...step.conditionalLogic, value: v }
                                                })}
                                            >
                                                <SelectTrigger className="text-sm">
                                                    <SelectValue placeholder="Selecciona valor..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {sourceStep.options.map(opt => (
                                                        <SelectItem key={opt} value={opt}>
                                                            {opt}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        );
                                    }
                                }
                                return (
                                    <Input
                                        placeholder="Valor a comparar"
                                        value={step.conditionalLogic.value || ''}
                                        onChange={(e) => updateStep(step.id, {
                                            conditionalLogic: { ...step.conditionalLogic, value: e.target.value }
                                        })}
                                        className="text-sm"
                                    />
                                );
                            })()}
                        </div>
                    </div>
                )}
            </div>

            {/* Timer Options */}
            {(getStepCategory(step.type) === 'TIMER') && (
                <div className="space-y-4 border-t pt-4">
                    <h4 className="font-medium text-sm">Configuración de Temporizador</h4>
                    <div className="space-y-2">
                        <Label className="text-xs">Duración (segundos)</Label>
                        <Input
                            type="number"
                            min="1"
                            value={step.config?.durationSeconds || 60}
                            onChange={(e) => updateStep(step.id, {
                                config: { ...step.config, durationSeconds: parseInt(e.target.value) || 0 }
                            })}
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <Label htmlFor="auto-start" className="text-xs">Inicio Automático</Label>
                        <Switch
                            id="auto-start"
                            checked={step.config?.autoStart || false}
                            onCheckedChange={(c) => updateStep(step.id, {
                                config: { ...step.config, autoStart: c }
                            })}
                        />
                    </div>
                </div>
            )}
            {/* Advanced Logic Rules (Visual Editor) */}
            <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">Reglas Lógicas e Incidentes</h4>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            const newRule: LogicRule = {
                                id: crypto.randomUUID(),
                                condition: '',
                                severity: 'WARNING',
                                message: ''
                            };
                            updateStep(step.id, {
                                logicRules: [...(step.logicRules || []), newRule]
                            });
                        }}
                        className="h-7 text-xs"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        Agregar Regla
                    </Button>
                </div>

                {step.logicRules && step.logicRules.length > 0 ? (
                    <div className="space-y-2">
                        {step.logicRules.map((rule, idx) => (
                            <LogicRuleCard
                                key={rule.id}
                                rule={rule}
                                onUpdate={(updates) => {
                                    const newRules = [...step.logicRules!];
                                    newRules[idx] = { ...newRules[idx], ...updates };
                                    updateStep(step.id, { logicRules: newRules });
                                }}
                                onDelete={() => {
                                    const newRules = step.logicRules!.filter((_, i) => i !== idx);
                                    updateStep(step.id, { logicRules: newRules });
                                }}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">
                        No hay reglas lógicas definidas. Haz clic en "Agregar Regla" para crear una.
                    </p>
                )}
            </div>

            {/* Step-level Actions */}
            <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">Acciones del Paso</h4>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            const newAction: RuleAction = { type: 'SEND_NOTIFICATION' };
                            const current = Array.isArray(step.actions)
                                ? step.actions as RuleAction[]
                                : [];
                            updateStep(step.id, {
                                actions: [...current, newAction]
                            });
                        }}
                        className="h-7 text-xs"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        Agregar Acción
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Acciones que se ejecutan al completar este paso
                </p>

                {(() => {
                    const stepActions = Array.isArray(step.actions)
                        ? (step.actions as RuleAction[])
                        : [];

                    if (stepActions.length === 0) {
                        return (
                            <p className="text-xs text-muted-foreground text-center py-4">
                                No hay acciones definidas para este paso.
                            </p>
                        );
                    }

                    return (
                        <div className="space-y-2">
                            {stepActions.map((action, idx) => {
                                const actionDef = getStepActionType(action.type);
                                return (
                                    <div key={idx} className="border rounded p-2 space-y-2 bg-muted/20">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium">
                                                {actionDef?.label || action.type}
                                            </span>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => {
                                                    const newActions = [...stepActions];
                                                    newActions.splice(idx, 1);
                                                    updateStep(step.id, { actions: newActions });
                                                }}
                                                className="h-5 w-5 p-0"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                        <Select
                                            value={action.type}
                                            onValueChange={(v) => {
                                                const newActions = [...stepActions];
                                                newActions[idx] = { type: v };
                                                updateStep(step.id, { actions: newActions });
                                            }}
                                        >
                                            <SelectTrigger className="text-xs h-7">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {STEP_ACTION_TYPES.map(at => (
                                                    <SelectItem key={at.type} value={at.type}>
                                                        {at.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {actionDef && actionDef.fields.map(field => (
                                            <div key={field.name} className="space-y-1">
                                                <Label className="text-xs">{field.label}</Label>
                                                {field.type === 'text' && (
                                                    <Input
                                                        className="text-xs h-7"
                                                        placeholder={field.placeholder}
                                                        value={(action as any)[field.name] || ''}
                                                        onChange={(e) => {
                                                            const newActions = [...stepActions];
                                                            newActions[idx] = { ...newActions[idx], [field.name]: e.target.value };
                                                            updateStep(step.id, { actions: newActions });
                                                        }}
                                                    />
                                                )}
                                                {field.type === 'number' && (
                                                    <Input
                                                        type="number"
                                                        className="text-xs h-7"
                                                        value={(action as any)[field.name] ?? field.defaultValue ?? ''}
                                                        onChange={(e) => {
                                                            const newActions = [...stepActions];
                                                            newActions[idx] = { ...newActions[idx], [field.name]: parseInt(e.target.value) };
                                                            updateStep(step.id, { actions: newActions });
                                                        }}
                                                    />
                                                )}
                                                {field.type === 'multiline' && (
                                                    <Textarea
                                                        className="text-xs min-h-[50px]"
                                                        placeholder={field.placeholder}
                                                        value={(action as any)[field.name] || ''}
                                                        onChange={(e) => {
                                                            const newActions = [...stepActions];
                                                            newActions[idx] = { ...newActions[idx], [field.name]: e.target.value };
                                                            updateStep(step.id, { actions: newActions });
                                                        }}
                                                    />
                                                )}
                                                {field.type === 'select' && field.options && (
                                                    <Select
                                                        value={(action as any)[field.name] || field.defaultValue || ''}
                                                        onValueChange={(v) => {
                                                            const newActions = [...stepActions];
                                                            newActions[idx] = { ...newActions[idx], [field.name]: v };
                                                            updateStep(step.id, { actions: newActions });
                                                        }}
                                                    >
                                                        <SelectTrigger className="text-xs h-7">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {field.options.map(opt => (
                                                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}
