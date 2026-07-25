"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { IncidentTimeline } from "@/components/incidents/incident-timeline";
import { RemediationWizard } from "@/components/incidents/remediation-wizard";
import { useSession } from "@/hooks/use-session";
import {
    ArrowLeft,
    XCircle,
    AlertTriangle,
    AlertCircle,
    CheckCircle2,
    Loader2,
    Building2,
    User,
    Calendar,
    Clock,
    FileText,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const SEVERITY_LABELS: Record<string, string> = {
    CRITICAL: "Crítico",
    WARNING: "Advertencia",
    FATAL: "Fatal",
};

const STATUS_LABELS: Record<string, string> = {
    DETECTED: "Detectado",
    IN_REMEDIATION: "En remediación",
    AWAITING_EXTERNAL: "Esperando externo",
    CONFIRMED: "Confirmado",
    RESOLVED: "Resuelto",
    ESCALATED: "Escalado",
};

const severityVariants: Record<string, string> = {
    CRITICAL: "bg-destructive/10 text-destructive border-destructive/20",
    WARNING: "bg-warning/10 text-warning-foreground border-warning/20",
    FATAL: "bg-destructive/15 text-destructive border-destructive/30",
};

const statusVariants: Record<string, string> = {
    DETECTED: "bg-destructive/10 text-destructive border-destructive/20",
    IN_REMEDIATION: "bg-warning/10 text-warning-foreground border-warning/20",
    AWAITING_EXTERNAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    CONFIRMED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    RESOLVED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    ESCALATED: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
};

const severityIcons: Record<string, typeof XCircle> = {
    CRITICAL: XCircle,
    WARNING: AlertTriangle,
    FATAL: AlertCircle,
};

interface IncidentDetail {
    id: string;
    severity: "CRITICAL" | "WARNING" | "FATAL";
    status: "DETECTED" | "IN_REMEDIATION" | "AWAITING_EXTERNAL" | "CONFIRMED" | "RESOLVED" | "ESCALATED";
    title: string;
    description: string | null;
    branchId: string;
    instanceId: string;
    stepId: string;
    detectedBy: string | null;
    resolution: string | null;
    resolvedBy: string | null;
    resolvedAt: string | null;
    createdAt: string;
    remediationProtocol: { steps: Array<{ instruction: string; validationCriteria?: { type: "photo" | "value"; expectedValue?: unknown; aiPrompt?: string } }>; maxAttempts?: number } | null;
    metadata: Record<string, unknown> | null;
    branchName?: string;
    detectedByName?: string;
    resolvedByName?: string;
}

export default function IncidentDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { session, loading: sessionLoading } = useSession();
    const incidentId = params?.id as string;

    const [incident, setIncident] = useState<IncidentDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [showResolveDialog, setShowResolveDialog] = useState(false);
    const [resolutionNote, setResolutionNote] = useState("");
    const [isResolving, setIsResolving] = useState(false);

    const SeverityIcon = incident ? severityIcons[incident.severity] || AlertCircle : AlertCircle;

    const fetchIncident = useCallback(async () => {
        if (!incidentId || sessionLoading) return;
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch(`/api/incidents/${incidentId}`);
            if (!res.ok) {
                throw new Error(res.status === 404 ? "Incidente no encontrado" : "Error al cargar incidente");
            }
            const data = await res.json();
            setIncident(data.incident);
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Error al cargar el incidente";
            setLoadError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [incidentId, sessionLoading]);

    useEffect(() => {
        fetchIncident();
    }, [fetchIncident]);

    const handleBack = () => {
        router.push("/dashboard/incidents");
    };

    const handleResolve = async () => {
        if (!incident || !resolutionNote.trim() || !session?.user) return;
        setIsResolving(true);
        try {
            const res = await fetch(`/api/incidents/${incident.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    resolution: resolutionNote.trim(),
                    resolvedBy: session.user.id,
                }),
            });
            if (!res.ok) throw new Error(`Error ${res.status}`);
            toast.success(`Incidente resuelto: ${incident.title}`);
            setShowResolveDialog(false);
            setResolutionNote("");
            fetchIncident();
        } catch {
            toast.error("No se pudo resolver el incidente. Intenta de nuevo.");
        } finally {
            setIsResolving(false);
        }
    };

    const handleRemediationStepSubmit = async (stepIndex: number, evidence: unknown) => {
        if (!incident) return { success: false, message: "No incident data" };
        try {
            const res = await fetch(`/api/incidents/${incident.id}/remediate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    stepIndex,
                    evidence: typeof evidence === "string" ? evidence : JSON.stringify(evidence),
                    resolvedBy: session?.user?.id,
                }),
            });
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data = await res.json();
            fetchIncident();
            return { success: true, message: data.message };
        } catch {
            return { success: false, message: "Error al enviar evidencia" };
        }
    };

    const handleRemediationComplete = async () => {
        if (!incident || !session?.user) return;
        toast.success("Protocolo de remediación completado");
        fetchIncident();
    };

    // ── Loading state ────────────────────────────────────────────────

    if (loading || sessionLoading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-8 w-96" />
                <div className="grid gap-6 md:grid-cols-2">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
            </div>
        );
    }

    // ── Error state ──────────────────────────────────────────────────

    if (loadError || !incident) {
        return (
            <div className="text-center py-12">
                <AlertCircle className="mx-auto h-12 w-12 text-destructive mb-4" />
                <h3 className="text-lg font-semibold mb-2">No se pudo cargar el incidente</h3>
                <p className="text-muted-foreground mb-4">{loadError || "Incidente no encontrado"}</p>
                <div className="flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={handleBack}>
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Volver a incidentes
                    </Button>
                    <Button onClick={fetchIncident}>Reintentar</Button>
                </div>
            </div>
        );
    }

    const isResolved = incident.status === "RESOLVED";
    const hasRemediationProtocol = incident.remediationProtocol?.steps && incident.remediationProtocol.steps.length > 0;

    return (
        <div className="space-y-6">
            {/* Back button */}
            <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                Incidentes
            </Button>

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={severityVariants[incident.severity] || ""}>
                            <SeverityIcon className="h-3 w-3 mr-1" />
                            {SEVERITY_LABELS[incident.severity] || incident.severity}
                        </Badge>
                        <Badge variant="outline" className={statusVariants[incident.status] || ""}>
                            {STATUS_LABELS[incident.status] || incident.status}
                        </Badge>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">{incident.title}</h1>
                    {incident.description && (
                        <p className="text-muted-foreground max-w-2xl">{incident.description}</p>
                    )}
                </div>

                {!isResolved && (
                    <Button onClick={() => setShowResolveDialog(true)}>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Resolver incidente
                    </Button>
                )}
            </div>

            {/* Metadata cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center gap-2 pb-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">Sucursal</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm">{incident.branchName || incident.branchId}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2 pb-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">Detectado</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm">
                            {format(new Date(incident.createdAt), "d 'de' MMMM yyyy, HH:mm", { locale: es })}
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center gap-2 pb-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">Detectado por</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm">{incident.detectedByName || incident.detectedBy || "—"}</p>
                    </CardContent>
                </Card>

                {isResolved ? (
                    <Card>
                        <CardHeader className="flex flex-row items-center gap-2 pb-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <CardTitle className="text-sm font-medium">Resuelto</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            <p className="text-sm">
                                {incident.resolvedAt
                                    ? format(new Date(incident.resolvedAt), "d 'de' MMMM yyyy, HH:mm", { locale: es })
                                    : "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                por {incident.resolvedByName || incident.resolvedBy || "—"}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <CardHeader className="flex flex-row items-center gap-2 pb-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <CardTitle className="text-sm font-medium">Workflow</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm font-mono text-xs truncate" title={incident.instanceId}>
                                {incident.instanceId.slice(0, 12)}…
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Timeline + Resolution */}
            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Línea de tiempo</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <IncidentTimeline
                            status={incident.status}
                            createdAt={incident.createdAt}
                            resolvedAt={incident.resolvedAt}
                            resolution={incident.resolution}
                        />
                    </CardContent>
                </Card>

                {hasRemediationProtocol && !isResolved && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Protocolo de remediación</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <RemediationWizard
                                incident={{
                                    id: incident.id,
                                    title: incident.title,
                                    description: incident.description ?? undefined,
                                    remediationProtocol: incident.remediationProtocol!,
                                }}
                                onSubmitStep={handleRemediationStepSubmit}
                                onComplete={handleRemediationComplete}
                                onCancel={() => toast.info("Remediación cancelada")}
                            />
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Resolution note */}
            {isResolved && incident.resolution && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Nota de resolución</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm whitespace-pre-wrap">{incident.resolution}</p>
                    </CardContent>
                </Card>
            )}

            {/* ── Resolve confirmation dialog ────────────────────────── */}
            <AlertDialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Resolver este incidente?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Estás por marcar como resuelto: <strong>{incident.title}</strong>.
                            Describe qué se hizo para resolverlo.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <Textarea
                        placeholder="Describe la resolución del incidente..."
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        rows={3}
                        className="mt-2"
                    />

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isResolving}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleResolve}
                            disabled={isResolving || !resolutionNote.trim()}
                        >
                            {isResolving ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    Resolviendo…
                                </>
                            ) : (
                                "Confirmar resolución"
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}