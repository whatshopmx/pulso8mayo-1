"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { LogicRule, RuleAction } from './builder-context';
import { RemediationSection } from './remediation-section';
import { EscalationSection } from './escalation-section';
import { STEP_ACTION_TYPES, getStepActionType } from '@/lib/workflow-actions';

interface LogicRuleCardProps {
    rule: LogicRule;
    onUpdate: (updates: Partial<LogicRule>) => void;
    onDelete: () => void;
}

export function LogicRuleCard({ rule, onUpdate, onDelete }: LogicRuleCardProps) {
    const [expanded, setExpanded] = useState(true);

    return (
        <Card className="mb-3">
            <CardHeader className="p-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {rule.name ? rule.name : `Regla: ${rule.condition || 'Nueva Regla'}`}
                    </CardTitle>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="h-6 w-6"
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                </div>
            </CardHeader>

            {expanded && (
                <CardContent className="p-3 pt-0 space-y-3">
                    {/* Rule Name */}
                    <div className="space-y-2">
                        <Label className="text-xs">Nombre de la Regla (Opcional)</Label>
                        <Input
                            placeholder="Ej. Regla de Temperatura"
                            value={rule.name || ""}
                            onChange={(e) => onUpdate({ name: e.target.value })}
                            className="text-sm font-medium"
                        />
                    </div>

                    {/* Condition Builder */}
                    <div className="space-y-2">
                        <Label className="text-xs">Condición</Label>
                        <Input
                            placeholder="Ej. valor > 5"
                            value={rule.condition}
                            onChange={(e) => onUpdate({ condition: e.target.value })}
                            className="text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                            Usa "value" para referenciar el valor del campo
                        </p>
                    </div>

                    {/* Severity */}
                    <div className="space-y-2">
                        <Label className="text-xs">Severidad</Label>
                        <Select value={rule.severity} onValueChange={(v) => onUpdate({ severity: v as any })}>
                            <SelectTrigger className="text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="PASS">✅ Aprobado</SelectItem>
                                <SelectItem value="WARNING">⚠️ Advertencia</SelectItem>
                                <SelectItem value="HIGH">🔶 Alta</SelectItem>
                                <SelectItem value="CRITICAL">🔴 Crítica</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Message */}
                    <div className="space-y-2">
                        <Label className="text-xs">Mensaje</Label>
                        <Input
                            placeholder="La temperatura excede el límite seguro"
                            value={rule.message}
                            onChange={(e) => onUpdate({ message: e.target.value })}
                            className="text-sm"
                        />
                    </div>

                    {/* Remediation Protocol */}
                    <RemediationSection
                        remediation={rule.remediationProtocol}
                        onUpdate={(remediation) => onUpdate({ remediationProtocol: remediation })}
                    />

                    {/* Escalation Chain */}
                    <EscalationSection
                        escalationChain={rule.escalationChain || []}
                        onUpdate={(chain) => onUpdate({ escalationChain: chain })}
                    />

                    {/* Automated Actions */}
                    <div className="border-t pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold">Acciones Automáticas</Label>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    const newAction: RuleAction = {
                                        type: 'AUTO_REMINDER',
                                        delay: 30,
                                        message: ''
                                    };
                                    onUpdate({ actions: [...(rule.actions || []), newAction] });
                                }}
                                className="h-6 text-xs"
                            >
                                <Plus className="h-3 w-3 mr-1" />
                                Agregar Acción
                            </Button>
                        </div>

                        {rule.actions && rule.actions.length > 0 && (
                            <div className="space-y-2 pl-2">
                                {rule.actions.map((action, idx) => {
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
                                                        const newActions = rule.actions!.filter((_, i) => i !== idx);
                                                        onUpdate({ actions: newActions });
                                                    }}
                                                    className="h-5 w-5 p-0"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            <Select
                                                value={action.type}
                                                onValueChange={(v) => {
                                                    const newActions = [...rule.actions!];
                                                    newActions[idx] = { type: v } as RuleAction;
                                                    onUpdate({ actions: newActions });
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
                                                                const newActions = [...rule.actions!];
                                                                newActions[idx] = { ...newActions[idx], [field.name]: e.target.value };
                                                                onUpdate({ actions: newActions });
                                                            }}
                                                        />
                                                    )}
                                                    {field.type === 'number' && (
                                                        <Input
                                                            type="number"
                                                            className="text-xs h-7"
                                                            value={(action as any)[field.name] ?? field.defaultValue ?? ''}
                                                            onChange={(e) => {
                                                                const newActions = [...rule.actions!];
                                                                newActions[idx] = { ...newActions[idx], [field.name]: parseInt(e.target.value) };
                                                                onUpdate({ actions: newActions });
                                                            }}
                                                        />
                                                    )}
                                                    {field.type === 'multiline' && (
                                                        <Textarea
                                                            className="text-xs min-h-[50px]"
                                                            placeholder={field.placeholder}
                                                            value={(action as any)[field.name] || ''}
                                                            onChange={(e) => {
                                                                const newActions = [...rule.actions!];
                                                                newActions[idx] = { ...newActions[idx], [field.name]: e.target.value };
                                                                onUpdate({ actions: newActions });
                                                            }}
                                                        />
                                                    )}
                                                    {field.type === 'select' && field.options && (
                                                        <Select
                                                            value={(action as any)[field.name] || field.defaultValue || ''}
                                                            onValueChange={(v) => {
                                                                const newActions = [...rule.actions!];
                                                                newActions[idx] = { ...newActions[idx], [field.name]: v };
                                                                onUpdate({ actions: newActions });
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
                        )}
                    </div>
                </CardContent>
            )}
        </Card>
    );
}
