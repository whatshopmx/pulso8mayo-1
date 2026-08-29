import * as React from "react";
import Link from "next/link";
import { AIVerificationList, AIVerificationListItem, AIVerificationStatus } from "@/components/workflow/ai-verification-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  Filter,
  Download,
  BrainCog,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowRight,
  Search,
  Check,
  RotateCcw,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { useBranch } from "@/lib/branch-context";
import { exportToCSV, cn } from "@/lib/utils";
import { PageHeader, PageContainer, EmptyState, ErrorState } from "@/components/shared";

interface VerificationData {
    id: string;
    workflowName: string;
    instanceId: string;
    stepId: string;
    status: 'pending' | 'analyzing' | 'success' | 'failed' | 'escalated';
    confidence?: number;
    reason?: string;
    provider?: string;
    timestamp?: string;
    requiresManualReview?: boolean;
    escalated?: boolean;
    photoUrl?: string;
    assignee?: string;
    branch?: string;
}

export default function AIVerificationsPage() {
  const { session } = useSession();
  const { selectedBranchId, branches } = useBranch();

  const [verifications, setVerifications] = React.useState<VerificationData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'success' | 'failed' | 'escalated' | 'pending'>('all');
  const [busqueda, setBusqueda] = React.useState("");
  const [selectedVerification, setSelectedVerification] = React.useState<VerificationData | null>(null);
  const [actionProcessing, setActionProcessing] = React.useState<string | null>(null);

  const sucursalActiva = React.useMemo(() => {
    if (!selectedBranchId) return "Todas las sucursales";
    return branches.find((b) => b.id === selectedBranchId)?.name ?? "Sucursal seleccionada";
  }, [selectedBranchId, branches]);

  const loadVerifications = React.useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const params = new URLSearchParams();
      if (selectedBranchId) {
        params.set('branchId', selectedBranchId);
      } else if (session?.user?.branchId) {
        params.set('branchId', session.user.branchId);
      }
      const response = await fetch(`/api/dashboard/ai-verifications?${params.toString()}`);
      if (!response.ok) throw new Error('No se pudieron cargar las verificaciones de IA');
      const data = await response.json();
      const list: VerificationData[] = data.data || [];
      setVerifications(list);
      if (list.length > 0) {
        setSelectedVerification((prev) => (prev ? list.find((v) => v.id === prev.id) || list[0] : list[0]));
      } else {
        setSelectedVerification(null);
      }
    } catch (error: any) {
      console.error('Failed to load verifications:', error);
      setErrorMessage(error?.message || 'Error al cargar verificaciones');
      toast.error('Error al cargar verificaciones');
      setVerifications([]);
      setSelectedVerification(null);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, session?.user?.branchId]);

    React.useEffect(() => {
        loadVerifications();
    }, [loadVerifications]);

    // Búsqueda y filtrado compuesto
    const filteredVerifications = React.useMemo(() => {
        return verifications.filter((v) => {
            const matchesFilter = filter === 'all' || v.status === filter;
            if (!matchesFilter) return false;
            if (!busqueda.trim()) return true;
            const q = busqueda.toLowerCase();
            return (
                v.workflowName.toLowerCase().includes(q) ||
                (v.assignee && v.assignee.toLowerCase().includes(q)) ||
                (v.reason && v.reason.toLowerCase().includes(q)) ||
                (v.branch && v.branch.toLowerCase().includes(q))
            );
        });
    }, [verifications, filter, busqueda]);

    const verificationsForList: AIVerificationListItem[] = React.useMemo(() => {
        return filteredVerifications.map(v => ({
            id: v.id,
            workflowName: v.workflowName,
            status: {
                status: v.status,
                confidence: v.confidence,
                reason: v.reason,
                provider: v.provider,
                timestamp: v.timestamp ? new Date(v.timestamp) : undefined,
                requiresManualReview: v.requiresManualReview,
                escalated: v.escalated,
                photoUrl: v.photoUrl
            }
        }));
    }, [filteredVerifications]);

    const stats = React.useMemo(() => {
        return {
            total: verifications.length,
            success: verifications.filter(v => v.status === 'success').length,
            failed: verifications.filter(v => v.status === 'failed').length,
            escalated: verifications.filter(v => v.status === 'escalated').length,
            pending: verifications.filter(v => v.status === 'pending' || v.status === 'analyzing').length
        };
    }, [verifications]);

    const handleAprobarManualmente = async (v: VerificationData) => {
        setActionProcessing(v.id);
        try {
            // Actualización optimista de estado local
            setVerifications((prev) =>
                prev.map((item) =>
                    item.id === v.id
                        ? { ...item, status: 'success', requiresManualReview: false, escalated: false }
                        : item
                )
            );
            if (selectedVerification?.id === v.id) {
                setSelectedVerification((prev) =>
                    prev ? { ...prev, status: 'success', requiresManualReview: false, escalated: false } : null
                );
            }
            toast.success(`Evidencia aprobada manualmente por supervisor`);
        } catch (err: any) {
            toast.error(err?.message || "Error al registrar aprobación manual");
        } finally {
            setActionProcessing(null);
        }
    };

    const handleSolicitarNuevaFoto = async (v: VerificationData) => {
        toast.info(`Se notificará al responsable (${v.assignee || 'del turno'}) para recapturar evidencia`);
    };

    const handleExport = () => {
        exportToCSV(verifications as any[], [
            { key: "workflowName", label: "Flujo" },
            { key: "instanceId", label: "Instancia" },
            { key: "stepId", label: "Paso" },
            { key: "status", label: "Estado" },
            { key: "confidence", label: "Confianza" },
            { key: "reason", label: "Motivo" },
            { key: "provider", label: "Proveedor" },
            { key: "timestamp", label: "Fecha" },
            { key: "assignee", label: "Responsable" },
            { key: "branch", label: "Sucursal" },
        ], `verificaciones-ai-${Date.now()}`);
        toast.success("CSV exportado correctamente");
    };

    return (
        <PageContainer>
            <PageHeader
                title="Verificaciones AI"
                description={`Auditoría automatizada de evidencias fotográficas con visión artificial · ${sucursalActiva}.`}
                icon={BrainCog}
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={loadVerifications}
                            disabled={loading}
                            aria-label="Recargar verificaciones"
                        >
                            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        </Button>
                        <Button variant="outline" onClick={handleExport} disabled={verifications.length === 0}>
                            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                            Exportar CSV
                        </Button>
                    </div>
                }
            />

            {/* Tarjetas de Resumen Operativo */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center justify-between">
                            <span>Total Analizadas</span>
                            <BrainCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </CardDescription>
                        <CardTitle className="text-2xl font-bold font-mono">{stats.total}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center justify-between">
                            <span>Aprobadas automáticamente</span>
                            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                        </CardDescription>
                        <div className="flex items-baseline gap-2">
                            <CardTitle className="text-2xl font-bold font-mono">{stats.success}</CardTitle>
                            <span className="text-xs text-muted-foreground">
                                {stats.total > 0 ? `${Math.round((stats.success / stats.total) * 100)}%` : "—"}
                            </span>
                        </div>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center justify-between">
                            <span>Requieren Revisión / Escaladas</span>
                            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                        </CardDescription>
                        <div className="flex items-baseline gap-2">
                            <CardTitle className="text-2xl font-bold font-mono">{stats.escalated}</CardTitle>
                            <span className="text-xs text-muted-foreground">Atención requerida</span>
                        </div>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription className="flex items-center justify-between">
                            <span>Rechazadas / No conformes</span>
                            <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </CardDescription>
                        <div className="flex items-baseline gap-2">
                            <CardTitle className="text-2xl font-bold font-mono">{stats.failed}</CardTitle>
                            <span className="text-xs text-muted-foreground">
                                {stats.pending > 0 ? `+${stats.pending} en análisis` : "Sin pendientes"}
                            </span>
                        </div>
                    </CardHeader>
                </Card>
            </div>

            {/* Reglas y Umbrales de Visión Artificial */}
            <div className="rounded-lg border bg-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                    <span className="font-medium text-foreground">Regla de evaluación de IA:</span>
                    <span className="text-muted-foreground">Modelo multirango para NOM-251 y NOM-035</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-success" />
                        <span className="text-muted-foreground">&gt;85% Auto-aprobado</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-warning" />
                        <span className="text-muted-foreground">60%–84% Revisión manual</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full bg-destructive" />
                        <span className="text-muted-foreground">&lt;60% Rechazo / Incidente</span>
                    </div>
                </div>
            </div>

            {/* Barra de Filtros y Búsqueda */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span className="text-xs font-medium text-foreground">Estado:</span>
                    </div>
                    <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                        <SelectTrigger className="h-10 w-48 text-xs font-medium" aria-label="Filtrar por estado">
                            <SelectValue placeholder="Seleccionar estado" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas ({stats.total})</SelectItem>
                            <SelectItem value="success">Aprobadas ({stats.success})</SelectItem>
                            <SelectItem value="escalated">Escaladas / Revisión ({stats.escalated})</SelectItem>
                            <SelectItem value="failed">Rechazadas ({stats.failed})</SelectItem>
                            <SelectItem value="pending">En proceso ({stats.pending})</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            type="search"
                            placeholder="Buscar flujo, empleado o motivo…"
                            className="h-10 pl-9 text-xs"
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            aria-label="Buscar verificaciones"
                        />
                    </div>
                    <Badge variant="outline" className="w-fit text-xs font-normal shrink-0">
                        {filteredVerifications.length} resultado{filteredVerifications.length === 1 ? "" : "s"}
                    </Badge>
                </div>
            </div>

            {/* Contenido Principal */}
            {loading ? (
                <div className="flex items-center justify-center py-24 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mr-2 text-primary" />
                    <span className="text-sm">Cargando registros de verificación…</span>
                </div>
            ) : errorMessage ? (
                <ErrorState message={errorMessage} onRetry={loadVerifications} />
            ) : filteredVerifications.length === 0 ? (
                <EmptyState
                    icon={BrainCog}
                    title="No se encontraron verificaciones de IA"
                    description={
                        filter !== "all" || busqueda.trim()
                            ? "No hay registros que coincidan con los filtros o términos de búsqueda."
                            : "Las verificaciones de visión aparecerán aquí en cuanto el personal capture evidencia en flujos con análisis automático."
                    }
                />
            ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Lista de Verificaciones */}
                    <div className="lg:col-span-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Registro de evidencias</CardTitle>
                                <CardDescription>
                                    Selecciona una evidencia para examinar el análisis del modelo y la imagen capturada.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AIVerificationList
                                    verifications={verificationsForList}
                                    onVerificationClick={(id) => {
                                        const verification = verifications.find(v => v.id === id);
                                        if (verification) {
                                            setSelectedVerification(verification);
                                        }
                                    }}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    {/* Panel de Detalle */}
                    <div className="lg:col-span-1">
                        <Card className="sticky top-6">
                            <CardHeader>
                                <CardTitle className="text-base">Detalle de análisis</CardTitle>
                                <CardDescription className="text-pretty">
                                    {selectedVerification
                                        ? selectedVerification.workflowName
                                        : 'Selecciona una verificación de la lista'}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {selectedVerification ? (
                                    <div className="space-y-4">
                                        <AIVerificationStatus
                                            status={{
                                                status: selectedVerification.status,
                                                confidence: selectedVerification.confidence,
                                                reason: selectedVerification.reason,
                                                provider: selectedVerification.provider,
                                                timestamp: selectedVerification.timestamp
                                                    ? new Date(selectedVerification.timestamp)
                                                    : undefined,
                                                requiresManualReview: selectedVerification.requiresManualReview,
                                                escalated: selectedVerification.escalated,
                                                photoUrl: selectedVerification.photoUrl
                                            }}
                                        />

                                        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Responsable:</span>
                                                <span className="font-medium">{selectedVerification.assignee || 'Sin asignar'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Sucursal:</span>
                                                <span className="font-medium">{selectedVerification.branch || 'Todas'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Instancia:</span>
                                                <span className="font-mono text-muted-foreground truncate max-w-[150px]">
                                                    {selectedVerification.instanceId}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Paso:</span>
                                                <span className="font-mono text-muted-foreground truncate max-w-[150px]">
                                                    {selectedVerification.stepId}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Acciones de Resolución para Supervisores */}
                                        {(selectedVerification.status === 'escalated' ||
                                            selectedVerification.status === 'failed' ||
                                            selectedVerification.requiresManualReview) && (
                                            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                                                <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                                                    <AlertCircle className="h-4 w-4" />
                                                    Resolución de supervisor
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    Esta evidencia no alcanzó la meta automática de aprobación (&gt;85%).
                                                </p>
                                                <div className="flex gap-2 pt-1">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="flex-1 h-9 text-xs"
                                                        onClick={() => handleAprobarManualmente(selectedVerification)}
                                                        disabled={actionProcessing === selectedVerification.id}
                                                    >
                                                        <Check className="h-3.5 w-3.5 mr-1 text-success" />
                                                        Aprobar
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="flex-1 h-9 text-xs"
                                                        onClick={() => handleSolicitarNuevaFoto(selectedVerification)}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5 mr-1 text-warning" />
                                                        Recapturar
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-2 pt-2">
                                            <Button variant="outline" className="w-full h-10 text-xs" asChild>
                                                <Link href={`/dashboard/workflows`}>
                                                    Ver flujo de trabajo
                                                    <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                                                </Link>
                                            </Button>
                                            <Button variant="ghost" className="w-full h-10 text-xs text-muted-foreground hover:text-foreground" asChild>
                                                <Link href={`/dashboard/incidents`}>
                                                    Gestionar incidentes
                                                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-12 text-xs text-muted-foreground">
                                        Selecciona una verificación de la lista para ver el análisis detallado.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </PageContainer>
    );
}
