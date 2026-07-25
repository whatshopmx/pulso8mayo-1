"use client";

import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { RemediationProtocol, RemediationStep } from './builder-context';

interface RemediationSectionProps {
    remediation?: RemediationProtocol;
    onUpdate: (remediation?: RemediationProtocol) => void;
}

export function RemediationSection({ remediation, onUpdate }: RemediationSectionProps) {
    const [expanded, setExpanded] = useState(false);

    const handleToggle = (enabled: boolean) => {
        if (enabled) {
            onUpdate({
                enabled: true,
                type: 'GUIDED_SELF_FIX',
                maxAttempts: 2,
                timeoutMinutes: 20,
                steps: []
            });
        } else {
            onUpdate(undefined);
        }
    };

    const addStep = () => {
        if (!remediation) return;
        const newStep: RemediationStep = {
            instruction: '',
            waitSeconds: 300,
            verification: { type: 'manual', targetCondition: '' }
        };
        onUpdate({
            ...remediation,
            steps: [...remediation.steps, newStep]
        });
    };

    const updateStep = (index: number, updates: Partial<RemediationStep>) => {
        if (!remediation) return;
        const newSteps = [...remediation.steps];
        newSteps[index] = { ...newSteps[index], ...updates };
        onUpdate({ ...remediation, steps: newSteps });
    };

    const removeStep = (index: number) => {
        if (!remediation) return;
        onUpdate({
            ...remediation,
            steps: remediation.steps.filter((_, i) => i !== index)
        });
    };

    return (
        <div className="border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Protocolo de Remedio</Label>
                <Switch
                    checked={remediation?.enabled || false}
                    onCheckedChange={handleToggle}
                />
            </div>

            {remediation?.enabled && (
                <div className="space-y-3 pl-2">
                    <div
                        className="flex items-center gap-2 cursor-pointer text-xs font-medium"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        Configurar Remedio
                    </div>

                    {expanded && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Máx. Intentos</Label>
                                    <Input
                                        type="number"
                                        value={remediation.maxAttempts}
                                        onChange={(e) => onUpdate({ ...remediation, maxAttempts: parseInt(e.target.value) })}
                                        className="text-xs h-7"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Tiempo límite (min)</Label>
                                    <Input
                                        type="number"
                                        value={remediation.timeoutMinutes}
                                        onChange={(e) => onUpdate({ ...remediation, timeoutMinutes: parseInt(e.target.value) })}
                                        className="text-xs h-7"
                                    />
                                </div>
                            </div>

                            {/* Remediation Steps */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Pasos</Label>
                                    <Button size="sm" variant="outline" onClick={addStep} className="h-6 text-xs">
                                        <Plus className="h-3 w-3 mr-1" />
                                        Agregar Paso
                                    </Button>
                                </div>

                                {remediation.steps.map((step, idx) => (
                                    <div key={idx} className="border rounded p-2 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium">Paso {idx + 1}</span>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => removeStep(idx)}
                                                className="h-5 w-5 p-0"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                        <Textarea
                                            placeholder="Instrucción para el empleado..."
                                            value={step.instruction}
                                            onChange={(e) => updateStep(idx, { instruction: e.target.value })}
                                            className="text-xs h-16"
                                        />
                                        <Input
                                            type="number"
                                            placeholder="Espera en segundos"
                                            value={step.waitSeconds}
                                            onChange={(e) => updateStep(idx, { waitSeconds: parseInt(e.target.value) })}
                                            className="text-xs h-7"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
