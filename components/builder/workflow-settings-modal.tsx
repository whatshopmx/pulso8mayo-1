"use client";

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Calendar, Clock, Users, Zap, Plus, X, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import {
    COMPLETION_ACTION_TYPES,
    ACTION_GROUP_LABELS,
    getCompletionActionType,
    getDefaultActionFields,
    type ActionGroup,
} from '@/lib/workflow-actions';

interface WorkflowSettingsModalProps {
    open: boolean;
    onClose: () => void;
    templateId: string;
    initialSettings?: {
        version?: number;
        activo?: boolean;
        requiereIA?: boolean;
        duracionEstimada?: string;
        cumplimientoNormativo?: string[];
        tags?: string[];
        aiConfig?: AICofig;
        complianceConfig?: ComplianceConfig;
        completionActions?: CompletionAction[];
        frequency?: string;
        days?: string[];
        assignedRoles?: string[];
        assignedShifts?: string[];
        shiftTimes?: Record<string, string>;
        triggers?: Trigger[];
    };
    /**
     * ADMIN+ (AD-3). El servidor rechaza con 403 los campos privilegiados por
     * debajo de ese rol, así que el cliente ni siquiera los manda: un Gerente
     * que solo cambia la programación no debe chocar contra el gate.
     */
    canEditPrivileged?: boolean;
}

interface AICofig {
    provider?: string;
    fallbackProvider?: string;
    maxRetries?: number;
}

interface ComplianceConfig {
    complianceType?: string;
    regulationSection?: string;
    requiredFrequency?: string;
    auditable?: boolean;
    evidenceRequired?: boolean;
    criticalForCompliance?: boolean;
}

interface CompletionAction {
    type: string;
    target?: string[];
    channel?: string;
    message?: string;
    status?: string;
    validFor?: number;
    template?: string;
    includePhotos?: boolean;
    workflowId?: string;
    delay?: number;
    priority?: string;
    assignTo?: string;
    item?: string;
    quantity?: number;
    requireMedicalClearance?: boolean;
}

const TAGS_SUGGESTIONS = [
    'higiene', 'seguridad', 'ia-verificacion', 'compliance', 'diario', 'semanal',
    'calidad', 'operaciones', 'mantenimiento', 'capacitacion', 'emergencia', 'inventario'
];

const FREQUENCIES = [
    { value: 'daily', label: 'Diario' },
    { value: 'weekly', label: 'Semanal' },
    { value: 'monthly', label: 'Mensual' },
    { value: 'on_demand', label: 'Bajo Demanda' }
];

const DAYS_OF_WEEK = [
    { value: 'monday', label: 'Lunes' },
    { value: 'tuesday', label: 'Martes' },
    { value: 'wednesday', label: 'Miércoles' },
    { value: 'thursday', label: 'Jueves' },
    { value: 'friday', label: 'Viernes' },
    { value: 'saturday', label: 'Sábado' },
    { value: 'sunday', label: 'Domingo' }
];

const ROLES = [
    { value: 'EMPLEADO', label: 'Empleado' },
    { value: 'CHEF', label: 'Chef' },
    { value: 'GERENTE', label: 'Gerente' },
    { value: 'SUPERVISOR', label: 'Supervisor' },
    { value: 'OWNER', label: 'Dueño' }
];

const SHIFTS = [
    { value: 'morning', label: 'Matutino (6AM - 2PM)' },
    { value: 'afternoon', label: 'Vespertino (2PM - 10PM)' },
    { value: 'night', label: 'Nocturno (10PM - 6AM)' },
    { value: 'all', label: 'Todos los Turnos' }
];

const EVENTS = [
    { value: 'INVENTORY_LOW', label: 'Alerta de Inventario Bajo' },
    { value: 'SHIFT_ENDED', label: 'Turno Finalizado' },
    { value: 'TEMPERATURE_ALERT', label: 'Temperatura Crítica' },
    { value: 'ONBOARDING_REQUIRED', label: 'Nuevo Empleado' },
    { value: 'INCIDENT_REPORTED', label: 'Incidente Reportado' }
];

// Compliance types for Mexican regulations
const COMPLIANCE_TYPES = [
    { value: 'NOM_251', label: 'NOM-251 (COFEPRIS - Buenas Prácticas)' },
    { value: 'NOM_035', label: 'NOM-035 (STPS - Factores de Riesgo Psicosocial)' },
    { value: 'NOM_030', label: 'NOM-030 (STPS - Servicios de Prevención)' },
    { value: 'NOM_019', label: 'NOM-019 (STPS - Seguridad y Salud)' },
    { value: 'NOM_017', label: 'NOM-017 (STPS - Equipo de Protección)' },
    { value: 'LFT', label: 'LFT (Ley Federal del Trabajo)' },
    { value: 'LSSN', label: 'LSSN (Ley del Seguro Social)' },
    { value: 'ISR', label: 'ISR (Impuesto sobre la Renta)' },
    { value: 'IVA', label: 'IVA (Impuesto al Valor Agregado)' },
    { value: 'INFONAVIT', label: 'INFONAVIT (Crédito de Vivienda)' },
    { value: 'FONACOT', label: 'FONACOT (Crédito para Trabajadores)' },
    { value: 'NONE', label: 'No aplica regulación específica' }
];

const REGULATION_SECTIONS = [
    { value: 'ARTICLE_132', label: 'Artículo 132 LFT (Obligaciones del patrón)' },
    { value: 'ARTICLE_134', label: 'Artículo 134 LFT (Trabajo de menores)' },
    { value: 'ARTICLE_153', label: 'Artículo 153 LFT (Trabajo peligroso)' },
    { value: 'CHAPTER_V', label: 'Capítulo V LFT (Trabajo de mujeres)' },
    { value: 'CHAPTER_VII', label: 'Capítulo VII LFT (Agencia de empleo)' },
    { value: 'CHAPTER_IX', label: 'Capítulo IX LFT (Subcontratación)' },
    { value: 'SECTION_I', label: 'Sección I NOM-251 (Higiene)' },
    { value: 'SECTION_II', label: 'Sección II NOM-251 (Calidad)' },
    { value: 'SECTION_III', label: 'Sección III NOM-251 (Seguridad)' },
    { value: 'ARTICLE_3', label: 'Artículo 3 NOM-035 (Identificación)' },
    { value: 'ARTICLE_4', label: 'Artículo 4 NOM-035 (Análisis)' },
    { value: 'ARTICLE_5', label: 'Artículo 5 NOM-035 (Medidas)' },
    { value: 'OTHER', label: 'Otra sección' }
];

const FREQUENCIES_COMPLIANCE = [
    { value: 'DAILY', label: 'Diario' },
    { value: 'WEEKLY', label: 'Semanal' },
    { value: 'BIWEEKLY', label: 'Quincenal' },
    { value: 'MONTHLY', label: 'Mensual' },
    { value: 'QUARTERLY', label: 'Trimestral' },
    { value: 'SEMIANNUAL', label: 'Semestral' },
    { value: 'ANNUAL', label: 'Anual' },
    { value: 'ON_DEMAND', label: 'Bajo demanda' }
];

interface Trigger {
    eventName: string;
    conditions: Record<string, any>;
}

export function WorkflowSettingsModal({ open, onClose, templateId, initialSettings, canEditPrivileged = false }: WorkflowSettingsModalProps) {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Workflow metadata
    const [version, setVersion] = useState(1);
    const [activo, setActivo] = useState(true);
    const [requiereIA, setRequiereIA] = useState(false);
    const [duracionEstimada, setDuracionEstimada] = useState('');
    const [cumplimientoNormativo, setCumplimientoNormativo] = useState<string[]>([]);
    const [tags, setTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState('');

    // AI Config
    const [aiProvider, setAiProvider] = useState('moondream');
    const [aiFallbackProvider, setAiFallbackProvider] = useState('openai');
    const [aiMaxRetries, setAiMaxRetries] = useState(2);

    // Compliance Config
    const [complianceType, setComplianceType] = useState('');
    const [regulationSection, setRegulationSection] = useState('');
    const [requiredFrequency, setRequiredFrequency] = useState('');
    const [auditable, setAuditable] = useState(false);
    const [evidenceRequired, setEvidenceRequired] = useState(false);
    const [criticalForCompliance, setCriticalForCompliance] = useState(false);

    // Completion Actions
    const [completionActions, setCompletionActions] = useState<CompletionAction[]>([]);

    // Scheduling settings
    const [enabled, setEnabled] = useState(true);
    const [frequency, setFrequency] = useState('daily');
    const [selectedDays, setSelectedDays] = useState<string[]>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);

    // Assignment settings
    const [assignedRoles, setAssignedRoles] = useState<string[]>(['EMPLEADO']);
    const [assignedShifts, setAssignedShifts] = useState<string[]>(['morning']);

    // Shift-specific times
    const [shiftTimes, setShiftTimes] = useState<Record<string, string>>({
        morning: '08:00',
        afternoon: '15:00',
        night: '23:00',
        all: '08:00'
    });

    const [autoAssign, setAutoAssign] = useState(true);

    // Trigger settings
    const [triggers, setTriggers] = useState<Trigger[]>([]);
    const [newTriggerEvent, setNewTriggerEvent] = useState('');

    useEffect(() => {
        if (open) {
            loadSettings();
        }
    }, [open, templateId]);

    // Initialize state from initialSettings prop when it changes or when modal opens
    useEffect(() => {
        if (initialSettings) {
            setVersion(initialSettings.version || 1);
            setActivo(initialSettings.activo ?? true);
            setRequiereIA(initialSettings.requiereIA ?? false);
            setDuracionEstimada(initialSettings.duracionEstimada || '');
            setCumplimientoNormativo(initialSettings.cumplimientoNormativo || []);
            setTags(initialSettings.tags || []);
            setCompletionActions(initialSettings.completionActions || []);

            if (initialSettings.aiConfig) {
                setAiProvider(initialSettings.aiConfig.provider || 'moondream');
                setAiFallbackProvider(initialSettings.aiConfig.fallbackProvider || 'openai');
                setAiMaxRetries(initialSettings.aiConfig.maxRetries || 2);
            }

            if (initialSettings.complianceConfig) {
                setComplianceType(initialSettings.complianceConfig.complianceType || '');
                setRegulationSection(initialSettings.complianceConfig.regulationSection || '');
                setRequiredFrequency(initialSettings.complianceConfig.requiredFrequency || '');
                setAuditable(initialSettings.complianceConfig.auditable ?? false);
                setEvidenceRequired(initialSettings.complianceConfig.evidenceRequired ?? false);
                setCriticalForCompliance(initialSettings.complianceConfig.criticalForCompliance ?? false);
            }

            setFrequency(initialSettings.frequency || "daily");
            setSelectedDays(initialSettings.days || []);
            setAssignedRoles(initialSettings.assignedRoles || []);
            setAssignedShifts(initialSettings.assignedShifts || []);
            setShiftTimes(initialSettings.shiftTimes || {
                morning: "08:00",
                afternoon: "14:00",
                night: "22:00",
            });
            setTriggers(initialSettings.triggers || []);
        }
    }, [initialSettings, open]);

    const loadSettings = async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/templates/${templateId}/settings`);
            if (response.ok) {
                const data = await response.json();
                if (data.settings) {
                    const s = data.settings;
                    setEnabled(s.enabled ?? true);
                    setFrequency(s.frequency || 'daily');
                    setVersion(s.version || 1);
                    setActivo(s.activo ?? true);
                    setRequiereIA(s.requiereIA ?? false);
                    setDuracionEstimada(s.duracionEstimada || '');
                    setCumplimientoNormativo(s.cumplimientoNormativo || []);
                    setTags(s.tags || []);
                    setCompletionActions(s.completionActions || []);

                    if (s.shiftTimes) {
                        setShiftTimes(s.shiftTimes);
                    } else if (s.time) {
                        setShiftTimes({ morning: s.time, afternoon: s.time, night: s.time, all: s.time });
                    }

                    setSelectedDays(s.days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
                    setAssignedRoles(s.assignedRoles || ['EMPLEADO']);
                    setAssignedShifts(s.assignedShifts || ['morning']);
                    setAutoAssign(s.autoAssign ?? true);
                    setTriggers(s.triggers || []);

                    if (s.aiConfig) {
                        setAiProvider(s.aiConfig.provider || 'moondream');
                        setAiFallbackProvider(s.aiConfig.fallbackProvider || 'openai');
                        setAiMaxRetries(s.aiConfig.maxRetries || 2);
                    }

                    if (s.complianceConfig) {
                        setComplianceType(s.complianceConfig.complianceType || '');
                        setRegulationSection(s.complianceConfig.regulationSection || '');
                        setRequiredFrequency(s.complianceConfig.requiredFrequency || '');
                        setAuditable(s.complianceConfig.auditable ?? false);
                        setEvidenceRequired(s.complianceConfig.evidenceRequired ?? false);
                        setCriticalForCompliance(s.complianceConfig.criticalForCompliance ?? false);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const response = await fetch(`/api/templates/${templateId}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // Campos privilegiados: solo se mandan si el rol los puede
                    // escribir. Mandarlos igualmente haría que el servidor
                    // devolviera 403 a un Gerente que solo tocó la programación.
                    ...(canEditPrivileged ? {
                        version,
                        activo,
                        cumplimientoNormativo,
                        aiConfig: {
                            provider: aiProvider,
                            fallbackProvider: aiFallbackProvider,
                            maxRetries: aiMaxRetries
                        },
                        complianceConfig: {
                            complianceType,
                            regulationSection,
                            requiredFrequency,
                            auditable,
                            evidenceRequired,
                            criticalForCompliance
                        },
                    } : {}),
                    duracionEstimada,
                    tags,
                    completionActions,
                    enabled,
                    frequency,
                    shiftTimes,
                    days: selectedDays,
                    assignedRoles,
                    assignedShifts,
                    autoAssign,
                    triggers
                })
            });

            if (!response.ok) throw new Error('Failed to save settings');

            toast.success('Configuración guardada correctamente');
            onClose();
        } catch (error) {
            toast.error('Error al guardar la configuración');
            console.error(error);
        } finally {
            setSaving(false);
        }
    };

    const toggleDay = (day: string) => {
        setSelectedDays(prev =>
            prev.includes(day)
                ? prev.filter(d => d !== day)
                : [...prev, day]
        );
    };

    const toggleRole = (role: string) => {
        setAssignedRoles(prev =>
            prev.includes(role)
                ? prev.filter(r => r !== role)
                : [...prev, role]
        );
    };

    const toggleShift = (shift: string) => {
        setAssignedShifts(prev =>
            prev.includes(shift)
                ? prev.filter(s => s !== shift)
                : [...prev, shift]
        );
    };

    const addTrigger = () => {
        if (!newTriggerEvent) return;
        setTriggers(prev => [...prev, { eventName: newTriggerEvent, conditions: {} }]);
        setNewTriggerEvent('');
    };

    const removeTrigger = (index: number) => {
        setTriggers(prev => prev.filter((_, i) => i !== index));
    };

    const toggleTag = (tag: string) => {
        setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    };

    const addCustomTag = () => {
        if (newTag.trim() && !tags.includes(newTag.trim())) {
            setTags(prev => [...prev, newTag.trim()]);
            setNewTag('');
        }
    };

    const addCompletionAction = (type: string) => {
        const defaults = getDefaultActionFields(type);
        const action: CompletionAction = { type, ...defaults };
        setCompletionActions(prev => [...prev, action]);
    };

    const removeCompletionAction = (index: number) => {
        setCompletionActions(prev => prev.filter((_, i) => i !== index));
    };

    const updateCompletionAction = (index: number, updates: Partial<CompletionAction>) => {
        setCompletionActions(prev => {
            const newActions = [...prev];
            newActions[index] = { ...newActions[index], ...updates };
            return newActions;
        });
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Configuración del Flujo</DialogTitle>
                    <DialogDescription>
                        Configura la programación y asignación de roles para este flujo de trabajo
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                ) : (
                    <div className="space-y-6 py-4">
                        {/* Enable/Disable */}
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label className="text-base">Activar Flujo</Label>
                                <p className="text-sm text-muted-foreground">
                                    Activa este flujo para programación automática
                                </p>
                            </div>
                            <Switch checked={enabled} onCheckedChange={setEnabled} />
                        </div>

                        {/* Workflow Metadata */}
                        <div className="space-y-4 border-t pt-4">
                            <h3 className="font-semibold">Metadatos del Flujo</h3>
                            <div className="grid grid-cols-4 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Versión</Label>
                                    <Input type="number" value={version} onChange={(e) => setVersion(parseInt(e.target.value))} className="text-sm" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Duración (est.)</Label>
                                    <Input value={duracionEstimada} onChange={(e) => setDuracionEstimada(e.target.value)} placeholder="5-10 min" className="text-sm" />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-2">
                                    <Label className="text-xs">Activo</Label>
                                    <Switch checked={activo} onCheckedChange={setActivo} disabled={!canEditPrivileged} />
                                </div>
                                {/* AD-4: derivado de los pasos, no editable. Como switch
                                    prometía un dato que ninguna columna guardaba. */}
                                <div className="flex items-center justify-between rounded-lg border p-2">
                                    <Label className="text-xs">Requiere IA</Label>
                                    <Badge variant={requiereIA ? 'default' : 'secondary'}>
                                        {requiereIA ? 'Sí' : 'No'}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs">Estándares de Cumplimiento (NOM-XXX)</Label>
                                <div className="flex flex-wrap gap-2">
                                    {['NOM-251', 'NOM-035', 'NOM-030', 'NOM-019', 'NOM-017', 'LFT'].map(norm => (
                                        <button key={norm} onClick={() => {
                                            setCumplimientoNormativo(prev => prev.includes(norm) ? prev.filter(n => n !== norm) : [...prev, norm]);
                                        }} className={`px-2 py-1 rounded-md text-xs border ${cumplimientoNormativo.includes(norm) ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
                                            {norm}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs">Etiquetas</Label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {TAGS_SUGGESTIONS.map(tag => (
                                        <button key={tag} onClick={() => toggleTag(tag)} className={`px-2 py-1 rounded-md text-xs border ${tags.includes(tag) ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
                                            {tag}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Agregar etiqueta..." className="text-sm" />
                                    <Button size="sm" onClick={addCustomTag} className="h-8">Agregar</Button>
                                </div>
                            </div>
                        </div>

                        {/* AI Configuration */}
                        <div className="space-y-4 border-t pt-4">
                            <h3 className="font-semibold">Configuración de IA</h3>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Proveedor</Label>
                                    <Select value={aiProvider} onValueChange={setAiProvider}>
                                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="moondream">Moondream</SelectItem>
                                            <SelectItem value="openai">OpenAI</SelectItem>
                                            <SelectItem value="gemini">Gemini</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Proveedor de Respaldo</Label>
                                    <Select value={aiFallbackProvider} onValueChange={setAiFallbackProvider}>
                                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="openai">OpenAI</SelectItem>
                                            <SelectItem value="moondream">Moondream</SelectItem>
                                            <SelectItem value="gemini">Gemini</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Máx. Reintentos</Label>
                                    <Input type="number" value={aiMaxRetries} onChange={(e) => setAiMaxRetries(parseInt(e.target.value))} className="text-sm" />
                                </div>
                            </div>
                        </div>

                        {/* Compliance Configuration */}
                        <div className="space-y-4 border-t pt-4">
                            <h3 className="font-semibold">Configuración de Cumplimiento</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Tipo de Cumplimiento</Label>
                                    <Select value={complianceType} onValueChange={setComplianceType}>
                                        <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                        <SelectContent>
                                            {COMPLIANCE_TYPES.map(c => (
                                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Sección Regulatoria</Label>
                                    <Select value={regulationSection} onValueChange={setRegulationSection}>
                                        <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                        <SelectContent>
                                            {REGULATION_SECTIONS.map(s => (
                                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Frecuencia Requerida</Label>
                                    <Select value={requiredFrequency} onValueChange={setRequiredFrequency}>
                                        <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                                        <SelectContent>
                                            {FREQUENCIES_COMPLIANCE.map(f => (
                                                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <div className="flex items-center gap-2">
                                    <Switch checked={auditable} onCheckedChange={setAuditable} />
                                    <Label className="text-xs">Auditable</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch checked={evidenceRequired} onCheckedChange={setEvidenceRequired} />
                                    <Label className="text-xs">Requiere Evidencia</Label>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch checked={criticalForCompliance} onCheckedChange={setCriticalForCompliance} />
                                    <Label className="text-xs">Crítico para Cumplimiento</Label>
                                </div>
                            </div>
                        </div>

                        {/* Completion Actions */}
                        <div className="space-y-4 border-t pt-4">
                            <h3 className="font-semibold">Acciones al Completar</h3>
                            <p className="text-xs text-muted-foreground">Acciones ejecutadas cuando el flujo se completa</p>

                            <div className="space-y-2">
                                <Select onValueChange={(v) => { addCompletionAction(v); }} value="">
                                    <SelectTrigger className="text-sm"><SelectValue placeholder="Agregar acción..." /></SelectTrigger>
                                    <SelectContent>
                                        {(Object.keys(ACTION_GROUP_LABELS) as ActionGroup[]).map(group => (
                                            <SelectGroup key={group}>
                                                <SelectLabel className="text-xs font-semibold text-muted-foreground">
                                                    {ACTION_GROUP_LABELS[group]}
                                                </SelectLabel>
                                                {COMPLETION_ACTION_TYPES
                                                    .filter(a => a.group === group)
                                                    .map(actionType => (
                                                        <SelectItem key={actionType.type} value={actionType.type}>
                                                            {actionType.label}
                                                        </SelectItem>
                                                    ))}
                                            </SelectGroup>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {completionActions.map((action, idx) => {
                                    const actionDef = getCompletionActionType(action.type);
                                    return (
                                        <div key={idx} className="border rounded p-3 space-y-2 bg-muted/20">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium">{actionDef?.label || action.type}</span>
                                                <Button size="sm" variant="ghost" onClick={() => removeCompletionAction(idx)} className="h-6 w-6 p-0"><Trash2 className="h-3 w-3" /></Button>
                                            </div>
                                            {actionDef && actionDef.fields.length > 0 ? (
                                                <div className="grid grid-cols-2 gap-2">
                                                    {actionDef.fields.map(field => (
                                                        <div key={field.name} className={field.type === 'multiline' || field.type === 'tags' ? 'col-span-2 space-y-1' : 'space-y-1'}>
                                                            <Label className="text-xs">
                                                                {field.label}
                                                                {field.required && <span className="text-destructive ml-0.5">*</span>}
                                                            </Label>
                                                            {field.type === 'text' && (
                                                                <Input
                                                                    value={(action as any)[field.name] || ''}
                                                                    onChange={(e) => updateCompletionAction(idx, { [field.name]: e.target.value } as any)}
                                                                    className="text-xs"
                                                                    placeholder={field.placeholder}
                                                                />
                                                            )}
                                                            {field.type === 'number' && (
                                                                <Input
                                                                    type="number"
                                                                    value={(action as any)[field.name] ?? field.defaultValue ?? ''}
                                                                    onChange={(e) => updateCompletionAction(idx, { [field.name]: parseFloat(e.target.value) } as any)}
                                                                    className="text-xs"
                                                                />
                                                            )}
                                                            {field.type === 'multiline' && (
                                                                <Textarea
                                                                    value={(action as any)[field.name] || ''}
                                                                    onChange={(e) => updateCompletionAction(idx, { [field.name]: e.target.value } as any)}
                                                                    className="text-xs min-h-[60px]"
                                                                    placeholder={field.placeholder}
                                                                />
                                                            )}
                                                            {field.type === 'boolean' && (
                                                                <div className="flex items-center gap-2 pt-1">
                                                                    <Switch
                                                                        checked={(action as any)[field.name] ?? field.defaultValue ?? false}
                                                                        onCheckedChange={(c) => updateCompletionAction(idx, { [field.name]: c } as any)}
                                                                    />
                                                                    <span className="text-xs text-muted-foreground">{(action as any)[field.name] ? 'Sí' : 'No'}</span>
                                                                </div>
                                                            )}
                                                            {field.type === 'tags' && (
                                                                <Input
                                                                    value={(() => {
                                                                        const v = (action as any)[field.name];
                                                                        return Array.isArray(v) ? v.join(', ') : v || '';
                                                                    })()}
                                                                    onChange={(e) => updateCompletionAction(idx, {
                                                                        [field.name]: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)
                                                                    } as any)}
                                                                    className="text-xs"
                                                                    placeholder={field.placeholder || 'Valores separados por coma'}
                                                                />
                                                            )}
                                                            {field.type === 'select' && field.options && (
                                                                <Select
                                                                    value={(action as any)[field.name] || field.defaultValue || ''}
                                                                    onValueChange={(v) => updateCompletionAction(idx, { [field.name]: v } as any)}
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
                                            ) : (
                                                <p className="text-xs text-muted-foreground">Sin configuración adicional requerida</p>
                                            )}
                                        </div>
                                    );
                                })}

                                {completionActions.length === 0 && (
                                    <p className="text-xs text-muted-foreground text-center py-4">
                                        No hay acciones configuradas. Agrega una desde el menú superior.
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Scheduling Section */}
                        <div className="space-y-4 border-t pt-4">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-muted-foreground" />
                                <h3 className="font-semibold">Programación</h3>
                            </div>

                            <div className="space-y-2">
                                <Label>Frecuencia</Label>
                                <Select value={frequency} onValueChange={setFrequency}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FREQUENCIES.map(f => (
                                            <SelectItem key={f.value} value={f.value}>
                                                {f.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {frequency === 'weekly' && (
                                <div className="space-y-2">
                                    <Label>Días de la Semana</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {DAYS_OF_WEEK.map(day => (
                                            <button
                                                key={day.value}
                                                onClick={() => toggleDay(day.value)}
                                                className={`px-3 py-1 rounded-md text-sm border ${selectedDays.includes(day.value)
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'bg-background'
                                                    }`}
                                            >
                                                {day.label.slice(0, 3)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Role Assignment Section */}
                        <div className="space-y-4 border-t pt-4">
                            <div className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-muted-foreground" />
                                <h3 className="font-semibold">Asignación de Roles</h3>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border p-3">
                                <Label className="text-sm">Auto-asignar a empleados disponibles</Label>
                                <Switch checked={autoAssign} onCheckedChange={setAutoAssign} />
                            </div>

                            <div className="space-y-2">
                                <Label>Roles Asignados</Label>
                                <div className="flex flex-wrap gap-2">
                                    {ROLES.map(role => (
                                        <button
                                            key={role.value}
                                            onClick={() => toggleRole(role.value)}
                                            className={`px-3 py-1.5 rounded-md text-sm border ${assignedRoles.includes(role.value)
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-background'
                                                }`}
                                        >
                                            {role.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Turnos Asignados</Label>
                                <p className="text-xs text-muted-foreground mb-3">
                                    Selecciona turnos y establece la hora de ejecución
                                </p>
                                <div className="space-y-3">
                                    {SHIFTS.map(shift => {
                                        const isSelected = assignedShifts.includes(shift.value);
                                        return (
                                            <div key={shift.value} className="flex items-center gap-3">
                                                <button
                                                    onClick={() => toggleShift(shift.value)}
                                                    className={`flex-1 px-3 py-2 rounded-md text-sm border text-left ${isSelected
                                                        ? 'bg-primary text-primary-foreground'
                                                        : 'bg-background'
                                                        }`}
                                                >
                                                    {shift.label}
                                                </button>
                                                {isSelected && (
                                                    <div className="flex items-center gap-2">
                                                        <Clock className="h-4 w-4 text-muted-foreground" />
                                                        <Input
                                                            type="time"
                                                            value={shiftTimes[shift.value] || '08:00'}
                                                            onChange={(e) => setShiftTimes(prev => ({
                                                                ...prev,
                                                                [shift.value]: e.target.value
                                                            }))}
                                                            className="w-32"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Event Triggers Section */}
                        <div className="space-y-4 border-t pt-4">
                            <div className="flex items-center gap-2">
                                <Zap className="h-5 w-5 text-muted-foreground" />
                                <h3 className="font-semibold">Disparadores de Eventos</h3>
                            </div>

                            <p className="text-sm text-muted-foreground">
                                Inicia este flujo automáticamente cuando ocurran eventos específicos.
                            </p>

                            <div className="space-y-3">
                                {triggers.map((trigger, index) => (
                                    <div key={index} className="flex items-center justify-between p-3 border rounded-md bg-muted/20">
                                        <div className="flex items-center gap-2">
                                            <Zap className="h-4 w-4 text-yellow-500" />
                                            <span className="font-medium">
                                                {EVENTS.find(e => e.value === trigger.eventName)?.label || trigger.eventName}
                                            </span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeTrigger(index)}
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}

                                <div className="flex gap-2">
                                    <Select value={newTriggerEvent} onValueChange={setNewTriggerEvent}>
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Seleccionar evento..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {EVENTS.map(e => (
                                                <SelectItem key={e.value} value={e.value}>
                                                    {e.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button onClick={addTrigger} disabled={!newTriggerEvent}>
                                        <Plus className="h-4 w-4 mr-2" />
                                        Agregar
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Summary */}
                        <div className="rounded-lg bg-muted p-4 space-y-2">
                                <p className="text-sm font-medium">Resumen</p>
                            <p className="text-xs text-muted-foreground">
                                Este flujo se ejecutará <strong>{frequency === 'daily' ? 'diario' : frequency === 'weekly' ? 'semanal' : frequency === 'monthly' ? 'mensual' : 'bajo demanda'}</strong>
                                {frequency === 'weekly' && ` los ${selectedDays.join(', ')}`}.
                                Será asignado a <strong>{assignedRoles.join(', ')}</strong> durante:
                            </p>
                            <ul className="text-xs text-muted-foreground list-disc list-inside pl-2">
                                {assignedShifts.map(shift => {
                                    const shiftLabel = SHIFTS.find(s => s.value === shift)?.label || shift;
                                    const time = shiftTimes[shift] || '08:00';
                                    return (
                                        <li key={shift}>
                                            <strong>{shiftLabel}</strong> at <strong>{time}</strong>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={onClose}>
                                Cancelar
                            </Button>
                            <Button onClick={handleSave} disabled={saving}>
                                {saving ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Guardando...
                                    </>
                                ) : (
                                    'Guardar Configuración'
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
