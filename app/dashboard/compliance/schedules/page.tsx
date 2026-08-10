"use client";

import { PageHeader } from "@/components/shared";
import { Calendar } from "lucide-react";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Clock, Plus, Trash2 } from "lucide-react";

interface ShiftTemplate {
    id: string;
    name: string;
    role: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    isActive: boolean;
}

interface Branch {
    id: string;
    name: string;
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default function SchedulesPage() {
    const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        role: "COCINERO",
        startTime: "08:00",
        endTime: "16:00",
        daysOfWeek: [1, 2, 3, 4, 5] as number[],
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [templatesRes, branchesRes] = await Promise.all([
                    fetch("/api/shift-templates"),
                    fetch("/api/branches"),
                ]);
                if (templatesRes.ok) {
                    const tData = await templatesRes.json();
                    setTemplates(tData.templates || []);
                }
                if (branchesRes.ok) {
                    const bData = await branchesRes.json();
                    setBranches(bData.branches || []);
                }
            } catch (e) {
                toast.error("Error al cargar datos");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const toggleDay = (day: number) => {
        setFormData(prev => ({
            ...prev,
            daysOfWeek: prev.daysOfWeek.includes(day)
                ? prev.daysOfWeek.filter(d => d !== day)
                : [...prev.daysOfWeek, day].sort(),
        }));
    };

    const createTemplate = async () => {
        if (!formData.name || formData.daysOfWeek.length === 0) {
            toast.error("Completa todos los campos");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/shift-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
            if (res.ok) {
                toast.success("Plantilla creada");
                const updated = await fetch("/api/shift-templates");
                if (updated.ok) {
                    const data = await updated.json();
                    setTemplates(data.templates || []);
                }
                setDialogOpen(false);
                setFormData({
                    name: "",
                    role: "COCINERO",
                    startTime: "08:00",
                    endTime: "16:00",
                    daysOfWeek: [1, 2, 3, 4, 5],
                });
            } else {
                toast.error("Error al crear");
            }
        } catch (e) {
            toast.error("Error al crear");
        } finally {
            setSaving(false);
        }
    };

    const toggleTemplate = async (id: string, isActive: boolean) => {
        try {
            const res = await fetch(`/api/shift-templates/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: !isActive }),
            });
            if (res.ok) {
                setTemplates(prev =>
                    prev.map(t =>
                        t.id === id ? { ...t, isActive: !isActive } : t
                    )
                );
            }
        } catch (e) {
            toast.error("Error al actualizar");
        }
    };

    const deleteTemplate = async (id: string) => {
        try {
            const res = await fetch(`/api/shift-templates/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setTemplates(prev => prev.filter(t => t.id !== id));
                toast.success("Eliminado");
            }
        } catch (e) {
            toast.error("Error al eliminar");
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Horarios y Turnos"
                description="Configura plantillas de turnos y turnos"
                icon={Calendar}
            />

            <div className="flex justify-end">
                <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Nueva Plantilla
                </Button>
            </div>

            {templates.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {templates.map(template => (
                        <Card
                            key={template.id}
                            className={
                                template.isActive ? "" : "opacity-50"
                            }
                        >
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-base">
                                        {template.name}
                                    </CardTitle>
                                    <Badge
                                        variant={
                                            template.isActive
                                                ? "default"
                                                : "secondary"
                                        }
                                    >
                                        {template.isActive ? "Activo" : "Inactivo"}
                                    </Badge>
                                </div>
                                <CardDescription>
                                    {template.role}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-mono">
                                        {template.startTime} - {template.endTime}
                                    </span>
                                </div>
                                <div className="flex gap-1 flex-wrap">
                                    {DAYS.map((day, i) => (
                                        <Badge
                                            key={i}
                                            variant={
                                                template.daysOfWeek.includes(i)
                                                    ? "default"
                                                    : "outline"
                                            }
                                            className="text-xs"
                                        >
                                            {day}
                                        </Badge>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() =>
                                            toggleTemplate(
                                                template.id,
                                                template.isActive
                                            )
                                        }
                                    >
                                        {template.isActive
                                            ? "Desactivar"
                                            : "Activar"}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        aria-label="Eliminar plantilla"
                                        onClick={() =>
                                            setTemplateToDelete(template.id)
                                        }
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <Card>
                    <CardContent className="flex items-center justify-center py-12">
                        <div className="text-center text-muted-foreground">
                            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No hay plantillas de turnos</p>
                            <Button
                                variant="outline"
                                className="mt-4"
                                onClick={() => setDialogOpen(true)}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Crear Plantilla
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Configuración Legal</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="bg-muted p-4 rounded-lg">
                        <h4 className="font-medium mb-2">
                            Límites Según la Ley (México):
                        </h4>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li>• Jornada diurna: 8 horas máximo</li>
                            <li>• Jornada nocturna: 7 horas máximo</li>
                            <li>• Jornada mixta: 7.5 horas máximo</li>
                            <li>• Descanso entre jornadas: Mínimo 12 horas</li>
                            <li>• Descanso semanal: Mínimo 1 día</li>
                        </ul>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Nueva Plantilla de Turno</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Nombre</Label>
                            <Input
                                value={formData.name}
                                onChange={e =>
                                    setFormData(prev => ({
                                        ...prev,
                                        name: e.target.value,
                                    }))
                                }
                                placeholder="Ej: Turno Mañana Cocina"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Rol</Label>
                            <Select
                                value={formData.role}
                                onValueChange={v =>
                                    setFormData(prev => ({ ...prev, role: v }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="COCINERO">Cocinero</SelectItem>
                                    <SelectItem value="MESERO">Mesero</SelectItem>
                                    <SelectItem value="CAJERO">Cajero</SelectItem>
                                    <SelectItem value="GERENTE">Gerente</SelectItem>
                                    <SelectItem value="SUPERVISOR">
                                        Supervisor
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Hora Inicio</Label>
                                <Input
                                    type="time"
                                    value={formData.startTime}
                                    onChange={e =>
                                        setFormData(prev => ({
                                            ...prev,
                                            startTime: e.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Hora Fin</Label>
                                <Input
                                    type="time"
                                    value={formData.endTime}
                                    onChange={e =>
                                        setFormData(prev => ({
                                            ...prev,
                                            endTime: e.target.value,
                                        }))
                                    }
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Días de la Semana</Label>
                            <div className="flex gap-2 flex-wrap">
                                {DAYS.map((day, i) => (
                                    <Button
                                        key={i}
                                        size="sm"
                                        variant={
                                            formData.daysOfWeek.includes(i)
                                                ? "default"
                                                : "outline"
                                        }
                                        aria-pressed={formData.daysOfWeek.includes(i)}
                                        aria-label={`Día ${day}`}
                                        onClick={() => toggleDay(i)}
                                    >
                                        {day}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDialogOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button onClick={createTemplate} disabled={saving}>
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Crear"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog
                open={!!templateToDelete}
                onOpenChange={open => !open && setTemplateToDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar plantilla de turno?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Se eliminará la plantilla de turno seleccionada.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (templateToDelete) {
                                    deleteTemplate(templateToDelete);
                                    setTemplateToDelete(null);
                                }
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}