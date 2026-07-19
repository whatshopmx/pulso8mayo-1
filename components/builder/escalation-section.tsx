"use client";

import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { EscalationStep } from './builder-context';

interface EscalationSectionProps {
    escalationChain: EscalationStep[];
    onUpdate: (chain: EscalationStep[]) => void;
}

const ROLES = ['EMPLEADO', 'GERENTE', 'OWNER', 'SUPERVISOR'];
const CHANNELS = ['whatsapp', 'call_priority', 'email', 'sms'];
const TRIGGER_CONDITIONS = ['immediate', 'remediation_failed', 'no_response', 'no_technician_response'];

export function EscalationSection({ escalationChain, onUpdate }: EscalationSectionProps) {
    const [expanded, setExpanded] = useState(false);

    const addLevel = () => {
        if (escalationChain.length >= 3) return; // Max 3 levels

        const newLevel: EscalationStep = {
            level: escalationChain.length + 1,
            triggerAfterMinutes: 0,
            triggerCondition: 'immediate',
            notifyRoles: [],
            channel: 'whatsapp',
            message: '',
            includeData: {}
        };

        onUpdate([...escalationChain, newLevel]);
    };

    const updateLevel = (index: number, updates: Partial<EscalationStep>) => {
        const newChain = [...escalationChain];
        newChain[index] = { ...newChain[index], ...updates };
        onUpdate(newChain);
    };

    const removeLevel = (index: number) => {
        const newChain = escalationChain.filter((_, i) => i !== index);
        // Re-number levels
        newChain.forEach((level, idx) => {
            level.level = idx + 1;
        });
        onUpdate(newChain);
    };

    const toggleRole = (levelIndex: number, role: string) => {
        const level = escalationChain[levelIndex];
        const roles = level.notifyRoles.includes(role)
            ? level.notifyRoles.filter(r => r !== role)
            : [...level.notifyRoles, role];
        updateLevel(levelIndex, { notifyRoles: roles });
    };

    return (
        <div className="border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
                <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => setExpanded(!expanded)}
                >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <Label className="text-xs font-semibold cursor-pointer">
                        Escalation Chain ({escalationChain.length}/3)
                    </Label>
                </div>
                {escalationChain.length < 3 && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={addLevel}
                        className="h-6 text-xs"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Level
                    </Button>
                )}
            </div>

            {expanded && escalationChain.length > 0 && (
                <div className="space-y-2 pl-2">
                    {escalationChain.map((level, idx) => (
                        <div key={idx} className="border rounded p-2 space-y-2 bg-muted/20">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold">Level {level.level}</span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => removeLevel(idx)}
                                    className="h-5 w-5 p-0"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-[10px]">Trigger After (min)</Label>
                                    <Input
                                        type="number"
                                        value={level.triggerAfterMinutes}
                                        onChange={(e) => updateLevel(idx, { triggerAfterMinutes: parseInt(e.target.value) })}
                                        className="text-xs h-7"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[10px]">Trigger Condition</Label>
                                    <Select
                                        value={level.triggerCondition}
                                        onValueChange={(v) => updateLevel(idx, { triggerCondition: v })}
                                    >
                                        <SelectTrigger className="text-xs h-7">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TRIGGER_CONDITIONS.map(cond => (
                                                <SelectItem key={cond} value={cond} className="text-xs">
                                                    {cond.replace(/_/g, ' ')}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-[10px]">Notify Roles</Label>
                                <div className="flex flex-wrap gap-1">
                                    {ROLES.map(role => (
                                        <button
                                            key={role}
                                            onClick={() => toggleRole(idx, role)}
                                            className={`text-[10px] px-2 py-1 rounded border ${level.notifyRoles.includes(role)
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'bg-background'
                                                }`}
                                        >
                                            {role}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-[10px]">Channel</Label>
                                <Select
                                    value={level.channel}
                                    onValueChange={(v) => updateLevel(idx, { channel: v })}
                                >
                                    <SelectTrigger className="text-xs h-7">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CHANNELS.map(ch => (
                                            <SelectItem key={ch} value={ch} className="text-xs">
                                                {ch}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-[10px]">Message</Label>
                                <Input
                                    placeholder="Alert message..."
                                    value={level.message}
                                    onChange={(e) => updateLevel(idx, { message: e.target.value })}
                                    className="text-xs h-7"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
