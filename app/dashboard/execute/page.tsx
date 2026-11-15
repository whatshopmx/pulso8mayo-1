"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { 
    Play, 
    Search, 
    Clock, 
    CheckCircle2, 
    Users, 
    Calendar,
    Zap,
    Share2,
    Loader2,
    Filter,
    Star
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SmartLinkGenerator } from "@/components/workflow/smart-link-generator";
import Link from "next/link";
import { useBranch } from "@/lib/branch-context";

interface WorkflowTemplate {
    id: string;
    name: string;
    description: string;
    stepsCount: number;
    estimatedDuration: number;
    category: string;
    isFavorite: boolean;
    executionsCount: number;
    lastExecuted?: Date;
}

interface QuickAssignment {
    templateId: string;
    assigneeId: string;
    dueDate: string;
    priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    notes: string;
}

export default function ExecutePage() {
    const router = useRouter();
    const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [assignees, setAssignees] = useState<{ id: string; name: string; role: string }[]>([]);
    const [assignment, setAssignment] = useState<QuickAssignment>({
        templateId: "",
        assigneeId: "",
        dueDate: "",
        priority: "MEDIUM",
        notes: "",
    });
    const [creating, setCreating] = useState<string | null>(null); // Track which template is being created
    const [smartLinkDetails, setSmartLinkDetails] = useState<{ instanceId: string; templateId: string } | null>(null);
    const { selectedBranchId } = useBranch();
    const userBranchId = selectedBranchId ?? "";

    useEffect(() => {
        fetchTemplates();
        fetchAssignees();
    }, []);

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/workflow-templates?active=true");
            if (response.ok) {
                const data = await response.json();
                setTemplates(data.data || []);
            }
        } catch (error) {
            console.error("Failed to fetch templates:", error);
            toast.error("Error al cargar plantillas");
        } finally {
            setLoading(false);
        }
    };

    const fetchAssignees = async () => {
        try {
            const response = await fetch("/api/users?active=true");
            if (response.ok) {
                const data = await response.json();
                const usersData = data.data || [];
                // Ensure assignees is always an array
                setAssignees(Array.isArray(usersData) ? usersData : []);
            }
        } catch (error) {
            console.error("Failed to fetch assignees:", error);
        }
    };

    const handleQuickStart = async (templateId: string) => {
        if (!userBranchId) {
            toast.error("No se pudo obtener la información de la sucursal");
            return;
        }

        setCreating(templateId);
        try {
            const res = await fetch("/api/workflows/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ templateId, branchId: userBranchId }),
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: "Failed to create workflow instance" }));
                throw new Error(error.message || "Failed to create workflow instance");
            }

            const execution = await res.json();
            router.push(`/dashboard/workflows/${execution.id}/execute`);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Error al iniciar workflow");
        } finally {
            setCreating(null);
        }
    };

    const handleAssign = async () => {
        if (!assignment.assigneeId || !assignment.dueDate) {
            toast.error("Por favor completa los campos requeridos");
            return;
        }

        setCreating("assigning");
        try {
            const res = await fetch("/api/workflows/assignments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...assignment,
                    templateId: selectedTemplate,
                }),
            });

            if (!res.ok) throw new Error("Failed to create assignment");

            toast.success("Tarea asignada exitosamente");
            setAssignDialogOpen(false);
            setAssignment({
                templateId: "",
                assigneeId: "",
                dueDate: "",
                priority: "MEDIUM",
                notes: "",
            });
        } catch (error) {
            console.error(error);
            toast.error("Error al asignar tarea");
        } finally {
            setCreating(null);
        }
    };

    const handleShare = async (templateId: string) => {
        if (!userBranchId) {
            toast.error("No se pudo obtener la información de la sucursal");
            return;
        }

        try {
            const res = await fetch("/api/workflows/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ templateId, branchId: userBranchId }),
            });

            if (!res.ok) {
                const error = await res.json().catch(() => ({ message: "Failed to create workflow instance" }));
                throw new Error(error.message || "Failed to create workflow instance");
            }

            const execution = await res.json();
            setSmartLinkDetails({ instanceId: execution.id, templateId });
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Error al preparar enlace compartido");
        }
    };

    const openAssignDialog = (templateId: string) => {
        setSelectedTemplate(templateId);
        setAssignment({ ...assignment, templateId });
        setAssignDialogOpen(true);
    };

    const safeTemplates = Array.isArray(templates) ? templates : [];
    const filteredTemplates = safeTemplates.filter((t) => {
        const matchesSearch = (t.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (t.description || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = categoryFilter === "all" || t.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    const categories = ["all", ...Array.from(new Set(safeTemplates.map((t) => t.category)))];

    const favoriteTemplates = safeTemplates.filter((t) => t.isFavorite);
    const recentTemplates = [...safeTemplates]
        .filter((t) => t.lastExecuted)
        .sort((a, b) => new Date(b.lastExecuted!).getTime() - new Date(a.lastExecuted!).getTime())
        .slice(0, 4);

    return (
        <div className="container mx-auto py-8 space-y-8">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Ejecución Rápida</h1>
                    <p className="text-muted-foreground mt-1">
                        Inicia workflows o asígnalos a tu equipo
                    </p>
                </div>
                <Button onClick={() => router.push("/dashboard/builder")}>
                    <Zap className="h-4 w-4 mr-2" />
                    Crear Nuevo Workflow
                </Button>
            </div>

            {/* Quick Actions */}
            <div className="grid gap-4 md:grid-cols-3">
                <Link href="/dashboard/my-tasks" className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><Card className="h-full transition-colors hover:bg-accent/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Mis Tareas</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Ver Tareas</div>
                        <p className="text-xs text-muted-foreground">
                            Gestiona tus workflows asignados
                        </p>
                    </CardContent>
                </Card></Link>
                <Link href="/dashboard/workflows/history" className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><Card className="h-full transition-colors hover:bg-accent/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Historial</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Ver Historial</div>
                        <p className="text-xs text-muted-foreground">
                            Consulta workflows ejecutados
                        </p>
                    </CardContent>
                </Card></Link>
                <Link href="/dashboard/evidence" className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><Card className="h-full transition-colors hover:bg-accent/30">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Evidencias</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">Ver Evidencias</div>
                        <p className="text-xs text-muted-foreground">
                            Galería de evidencias subidas
                        </p>
                    </CardContent>
                </Card></Link>
            </div>

            {/* Favorites */}
            {favoriteTemplates.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                        <h2 className="text-xl font-semibold">Favoritos</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {favoriteTemplates.map((template) => (
                            <Card key={template.id} className="border-yellow-200 dark:border-yellow-800">
                                <CardHeader>
                                    <CardTitle className="text-lg">{template.name}</CardTitle>
                                    <CardDescription className="text-sm line-clamp-2">
                                        {template.description}
                                    </CardDescription>
                                </CardHeader>
                                <CardFooter className="flex gap-2">
                                    <Button
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleQuickStart(template.id)}
                                        disabled={creating === template.id}
                                    >
                                        <Play className="h-4 w-4 mr-2" />
                                        Iniciar
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => openAssignDialog(template.id)}
                                    >
                                        <Users className="h-4 w-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            {/* Recent */}
            {recentTemplates.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Clock className="h-5 w-5 text-blue-500" />
                        <h2 className="text-xl font-semibold">Recientes</h2>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {recentTemplates.map((template) => (
                            <Card key={template.id}>
                                <CardHeader>
                                    <CardTitle className="text-lg">{template.name}</CardTitle>
                                    <CardDescription className="text-sm line-clamp-2">
                                        {template.description}
                                    </CardDescription>
                                </CardHeader>
                                <CardFooter className="flex gap-2">
                                    <Button
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleQuickStart(template.id)}
                                        disabled={creating === template.id}
                                    >
                                        <Play className="h-4 w-4 mr-2" />
                                        Iniciar
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleShare(template.id)}
                                    >
                                        <Share2 className="h-4 w-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </section>
            )}

            {/* All Templates */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Todas las Plantillas</h2>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar plantillas..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8 w-[250px]"
                            />
                        </div>
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Categoría" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas las categorías</SelectItem>
                                {categories.filter((c) => c !== "all").map((category) => (
                                    <SelectItem key={category} value={category}>
                                        {category}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                            <Search className="h-12 w-12 text-muted-foreground mb-4" />
                            <p className="text-muted-foreground">
                                No se encontraron plantillas con los filtros seleccionados
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredTemplates.map((template) => (
                            <Card key={template.id}>
                                <CardHeader>
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <CardTitle className="text-lg">{template.name}</CardTitle>
                                            <CardDescription className="text-sm line-clamp-2 mt-1">
                                                {template.description}
                                            </CardDescription>
                                        </div>
                                        {template.isFavorite && (
                                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Clock className="h-4 w-4" />
                                            {template.estimatedDuration} min
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <CheckCircle2 className="h-4 w-4" />
                                            {template.stepsCount} pasos
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Play className="h-4 w-4" />
                                            {template.executionsCount} ejecuciones
                                        </span>
                                    </div>
                                </CardContent>
                                <CardFooter className="flex gap-2">
                                    <Button
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => handleQuickStart(template.id)}
                                        disabled={creating === template.id}
                                    >
                                        {creating === template.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Play className="h-4 w-4 mr-2" />
                                                Iniciar
                                            </>
                                        )}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => openAssignDialog(template.id)}
                                    >
                                        <Users className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleShare(template.id)}
                                    >
                                        <Share2 className="h-4 w-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </section>

            {/* Assign Dialog */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Asignar Workflow</DialogTitle>
                        <DialogDescription>
                            Asigna este workflow a un miembro del equipo
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Asignar a *</Label>
                            <Select
                                value={assignment.assigneeId}
                                onValueChange={(value) => setAssignment({ ...assignment, assigneeId: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar usuario" />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.isArray(assignees) && assignees.map((user) => (
                                        <SelectItem key={user.id} value={user.id}>
                                            {user.name} - {user.role}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Fecha de Vencimiento *</Label>
                            <Input
                                type="datetime-local"
                                value={assignment.dueDate}
                                onChange={(e) => setAssignment({ ...assignment, dueDate: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Prioridad</Label>
                            <Select
                                value={assignment.priority}
                                onValueChange={(value: any) => setAssignment({ ...assignment, priority: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="LOW">Baja</SelectItem>
                                    <SelectItem value="MEDIUM">Media</SelectItem>
                                    <SelectItem value="HIGH">Alta</SelectItem>
                                    <SelectItem value="URGENT">Urgente</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Notas</Label>
                            <Textarea
                                value={assignment.notes}
                                onChange={(e) => setAssignment({ ...assignment, notes: e.target.value })}
                                placeholder="Instrucciones adicionales..."
                                rows={3}
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleAssign} disabled={creating !== null}>
                            {creating ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Users className="h-4 w-4 mr-2" />
                            )}
                            Asignar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* SmartLink Modal */}
            {smartLinkDetails && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-lg border shadow-xl w-full max-w-md relative overflow-hidden">
                        <div className="flex justify-between items-center p-4 border-b bg-muted/50">
                            <h3 className="text-lg font-semibold">Compartir Workflow</h3>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setSmartLinkDetails(null)}>
                                <span className="sr-only">Close</span>
                                <span aria-hidden="true">&times;</span>
                            </Button>
                        </div>
                        <div className="p-6">
                            <SmartLinkGenerator
                                instanceId={smartLinkDetails.instanceId}
                                templateId={smartLinkDetails.templateId}
                            />
                            <p className="text-sm text-muted-foreground mt-4 text-center">
                                Usa este enlace para realizar el workflow en un dispositivo móvil o compartirlo con un empleado.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
