"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Play, Loader2, Share2, Layout, CheckCircle2, Clock, AlertCircle,
    Search, Filter, Plus, ArrowRight, Activity, FileText, Users, Zap
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { SmartLinkGenerator } from "@/components/workflow/smart-link-generator";
import { useBranch } from "@/lib/branch-context";
import Link from "next/link";

interface Template {
    id: string;
    name: string;
    title?: string;
    description?: string;
    category?: string;
    isCritical?: boolean;
    active?: boolean;
    steps?: any[];
}

interface Assignment {
    id: string;
    templateName: string;
    status: string;
    assigneeName: string;
    dueDate?: string;
    updatedAt?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    PENDING: { label: "Pendiente", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: <Clock className="h-3 w-3" /> },
    IN_PROGRESS: { label: "En Progreso", color: "bg-blue-500/10 text-blue-600 border-blue-500/20", icon: <Activity className="h-3 w-3" /> },
    COMPLETED: { label: "Completado", color: "bg-green-500/10 text-green-600 border-green-500/20", icon: <CheckCircle2 className="h-3 w-3" /> },
    FAILED: { label: "Fallido", color: "bg-red-500/10 text-red-600 border-red-500/20", icon: <AlertCircle className="h-3 w-3" /> },
};

const CATEGORY_COLORS: Record<string, string> = {
    GENERAL: "bg-slate-500/10 text-slate-600",
    SAFETY: "bg-red-500/10 text-red-600",
    QUALITY: "bg-purple-500/10 text-purple-600",
    INVENTORY: "bg-orange-500/10 text-orange-600",
    HR: "bg-cyan-500/10 text-cyan-600",
    COMPLIANCE: "bg-green-500/10 text-green-600",
};

export default function WorkflowsDashboard() {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [smartLinkDetails, setSmartLinkDetails] = useState<{ instanceId: string; templateId: string } | null>(null);
    const [sessionBranchId, setSessionBranchId] = useState<string>("");
    const router = useRouter();
    const { selectedBranchId } = useBranch();

    useEffect(() => {
        const load = async () => {
            try {
                const [tRes, aRes] = await Promise.all([
                    fetch("/api/workflow-templates"),
                    fetch("/api/workflows/assignments?limit=8"),
                ]);
                if (tRes.ok) {
                    const d = await tRes.json();
                    setTemplates(d.data || []);
                }
                if (aRes.ok) {
                    const d = await aRes.json();
                    setAssignments(d.data || d.assignments || []);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        load();
        // Branch fallback: the header BranchScopeControl can be "Todas" (null),
        // but execution always requires a concrete branch.
        fetch("/api/auth/get-session")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setSessionBranchId(d?.branchId || ""))
            .catch(() => {});
    }, []);

    const effectiveBranchId = selectedBranchId ?? sessionBranchId;

    const createInstance = async (templateId: string) => {
        if (!effectiveBranchId) throw new Error("NO_BRANCH");
        const res = await fetch("/api/workflows/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId, branchId: effectiveBranchId }),
        });
        if (!res.ok) throw new Error("Failed to create instance");
        return res.json();
    };

    const handleStart = async (templateId: string) => {
        setProcessingId(templateId);
        try {
            const ex = await createInstance(templateId);
            router.push(`/dashboard/workflows/${ex.id}/execute`);
        } catch (e) {
            toast.error(e instanceof Error && e.message === "NO_BRANCH"
                ? "Selecciona una sucursal antes de iniciar el workflow"
                : "Error al iniciar el workflow");
        } finally {
            setProcessingId(null);
        }
    };

    const handleShare = async (templateId: string) => {
        setProcessingId(templateId);
        try {
            const ex = await createInstance(templateId);
            setSmartLinkDetails({ instanceId: ex.id, templateId });
        } catch (e) {
            toast.error(e instanceof Error && e.message === "NO_BRANCH"
                ? "Selecciona una sucursal antes de generar el enlace"
                : "Error al generar el enlace");
        } finally {
            setProcessingId(null);
        }
    };

    const filtered = templates.filter(t =>
        (t.name || t.title || "").toLowerCase().includes(search.toLowerCase()) ||
        (t.description || "").toLowerCase().includes(search.toLowerCase())
    );

    // KPI counts
    const total = templates.length;
    const active = templates.filter(t => t.active !== false).length;
    const critical = templates.filter(t => t.isCritical).length;
    const pending = assignments.filter(a => a.status === "PENDING").length;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 p-4 lg:p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Layout className="h-6 w-6 text-primary" />
                        Dashboard de Workflows
                    </h1>
                    <p className="text-muted-foreground text-sm mt-0.5">
                        Gestiona y ejecuta los flujos de trabajo de tu operación
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/dashboard/workflows/history">
                            <FileText className="h-4 w-4 mr-2" /> Historial
                        </Link>
                    </Button>
                    <Button size="sm" asChild>
                        <Link href="/dashboard/builder">
                            <Plus className="h-4 w-4 mr-2" /> Nuevo Workflow
                        </Link>
                    </Button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: "Plantillas Totales", value: total, icon: <Layout className="h-5 w-5 text-primary" />, sub: "en el sistema" },
                    { label: "Plantillas Activas", value: active, icon: <CheckCircle2 className="h-5 w-5 text-green-500" />, sub: "disponibles" },
                    { label: "Críticos", value: critical, icon: <AlertCircle className="h-5 w-5 text-red-500" />, sub: "requieren atención" },
                    { label: "Pendientes Hoy", value: pending, icon: <Clock className="h-5 w-5 text-yellow-500" />, sub: "asignaciones" },
                ].map((kpi, i) => (
                    <Card key={i} className="border">
                        <CardContent className="pt-5 pb-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                                    <p className="text-3xl font-bold mt-1">{kpi.value}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                                </div>
                                <div className="p-2 bg-muted rounded-lg">{kpi.icon}</div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                    { label: "Constructor", desc: "Crea o edita plantillas", href: "/dashboard/builder", icon: <Zap className="h-5 w-5" />, color: "text-purple-600 bg-purple-500/10" },
                    { label: "Plantillas", desc: "Explora todas las plantillas", href: "/dashboard/builder/templates", icon: <FileText className="h-5 w-5" />, color: "text-blue-600 bg-blue-500/10" },
                    { label: "Historial", desc: "Revisa ejecuciones pasadas", href: "/dashboard/workflows/history", icon: <Activity className="h-5 w-5" />, color: "text-green-600 bg-green-500/10" },
                ].map((action, i) => (
                    <Link key={i} href={action.href}>
                        <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer group">
                            <div className={`p-2 rounded-lg ${action.color}`}>{action.icon}</div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">{action.label}</p>
                                <p className="text-xs text-muted-foreground">{action.desc}</p>
                            </div>
                            <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                        </div>
                    </Link>
                ))}
            </div>

            {/* Templates grid */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Plantillas Disponibles</h2>
                    <div className="relative w-56">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar workflow..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-8 h-8 text-sm"
                        />
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center text-muted-foreground">
                            <Layout className="h-12 w-12 mx-auto mb-3 opacity-30" />
                            <p className="font-medium">No se encontraron workflows</p>
                            <p className="text-sm mt-1">Crea uno desde el Constructor</p>
                            <Button className="mt-4" size="sm" asChild>
                                <Link href="/dashboard/builder"><Plus className="h-4 w-4 mr-2" /> Crear Workflow</Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filtered.map((t) => {
                            const name = t.name || t.title || "Sin nombre";
                            const steps = Array.isArray(t.steps) ? t.steps.length : 0;
                            const cat = t.category || "GENERAL";
                            const isProcessing = processingId === t.id;
                            return (
                                <Card key={t.id} className="hover:shadow-md transition-shadow border group">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <CardTitle className="text-sm font-semibold leading-snug line-clamp-2 flex-1">
                                                {name}
                                            </CardTitle>
                                            <div className="flex flex-col gap-1 items-end flex-shrink-0">
                                                {t.isCritical && (
                                                    <Badge variant="destructive" className="text-xs">Crítico</Badge>
                                                )}
                                                <Badge variant="outline" className={`text-xs ${CATEGORY_COLORS[cat] || CATEGORY_COLORS.GENERAL}`}>
                                                    {cat}
                                                </Badge>
                                            </div>
                                        </div>
                                        <CardDescription className="text-xs line-clamp-2 mt-1">
                                            {t.description || "Sin descripción"}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="pb-2">
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <FileText className="h-3 w-3" /> {steps} paso{steps !== 1 ? "s" : ""}
                                            </span>
                                            {t.active === false && (
                                                <Badge variant="secondary" className="text-xs">Inactivo</Badge>
                                            )}
                                        </div>
                                    </CardContent>
                                    <CardFooter className="flex gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => handleShare(t.id)}
                                            disabled={isProcessing}
                                        >
                                            {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3 mr-1" />}
                                            Compartir
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => handleStart(t.id)}
                                            disabled={isProcessing}
                                        >
                                            {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                                            Iniciar
                                        </Button>
                                    </CardFooter>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Recent Assignments */}
            {assignments.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Users className="h-5 w-5 text-muted-foreground" />
                            Asignaciones Recientes
                        </h2>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/dashboard/workflows/history">Ver todo <ArrowRight className="ml-1 h-4 w-4" /></Link>
                        </Button>
                    </div>
                    <Card>
                        <div className="divide-y">
                            {assignments.map((a) => {
                                const cfg = STATUS_CONFIG[a.status] || STATUS_CONFIG.PENDING;
                                return (
                                    <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{a.templateName || "Sin nombre"}</p>
                                            <p className="text-xs text-muted-foreground">{a.assigneeName || "Sin asignar"}</p>
                                        </div>
                                        <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
                                            {cfg.icon}{cfg.label}
                                        </Badge>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>
            )}

            {/* SmartLink Modal */}
            {smartLinkDetails && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-background rounded-lg border shadow-xl w-full max-w-md">
                        <div className="flex justify-between items-center p-4 border-b">
                            <h3 className="font-semibold">Compartir Workflow</h3>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSmartLinkDetails(null)}>✕</Button>
                        </div>
                        <div className="p-6">
                            <SmartLinkGenerator instanceId={smartLinkDetails.instanceId} templateId={smartLinkDetails.templateId} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
