"use client";

import * as React from "react";
import { AIVerificationList, AIVerificationListItem, AIVerificationStatus } from "@/components/workflow/ai-verification-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Filter, Download, BrainCog } from "lucide-react";
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
import { exportToCSV } from "@/lib/utils";

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
  const [verifications, setVerifications] = React.useState<VerificationData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<'all' | 'success' | 'failed' | 'escalated' | 'pending'>('all');
  const [selectedVerification, setSelectedVerification] = React.useState<VerificationData | null>(null);

  const loadVerifications = React.useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (session?.user?.branchId) {
        params.set('branchId', session.user.branchId);
      }
      const response = await fetch(`/api/dashboard/ai-verifications?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setVerifications(data.data || []);
    } catch (error) {
      console.error('Failed to load verifications:', error);
      toast.error('Error al cargar verificaciones');
      setVerifications([]);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.branchId]);

    React.useEffect(() => {
        loadVerifications();
    }, [loadVerifications]);

    const filteredVerifications = React.useMemo(() => {
        if (filter === 'all') {
            return verifications;
        }
        return verifications.filter(v => v.status === filter);
    }, [verifications, filter]);

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

    const handleExport = () => {
        exportToCSV(verifications as any[], [
            { key: "workflowName", label: "Workflow" },
            { key: "instanceId", label: "Instancia" },
            { key: "stepId", label: "Paso" },
            { key: "status", label: "Estado" },
            { key: "confidence", label: "Confianza" },
            { key: "reason", label: "Motivo" },
            { key: "provider", label: "Proveedor" },
            { key: "timestamp", label: "Fecha" },
        ], `verificaciones-ai-${Date.now()}`);
        toast.success("CSV exportado correctamente");
    };

    return (
        <div className="container mx-auto py-8 space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Verificaciones AI</h1>
                    <p className="text-muted-foreground mt-1">
                        Estado de verificaciones de evidencia con inteligencia artificial
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={loadVerifications}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                    <Button variant="outline" onClick={handleExport}>
                        <Download className="h-4 w-4 mr-2" />
                        Exportar
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Total</CardDescription>
                        <CardTitle className="text-3xl">{stats.total}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Aprobados</CardDescription>
                        <CardTitle className="text-3xl text-green-600">{stats.success}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Fallidos</CardDescription>
                        <CardTitle className="text-3xl text-red-600">{stats.failed}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Escalados</CardDescription>
                        <CardTitle className="text-3xl text-orange-600">{stats.escalated}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Pendientes</CardDescription>
                        <CardTitle className="text-3xl text-blue-600">{stats.pending}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Filtrar:</span>
                </div>
                <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                    <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Seleccionar estado" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="success">Aprobados</SelectItem>
                        <SelectItem value="failed">Fallidos</SelectItem>
                        <SelectItem value="escalated">Escalados</SelectItem>
                        <SelectItem value="pending">Pendientes</SelectItem>
                    </SelectContent>
                </Select>
                <div className="ml-auto flex items-center gap-2">
                    <Badge variant="outline">
                        {filteredVerifications.length} resultados
                    </Badge>
                </div>
            </div>

            {/* Main Content */}
            <div className="grid gap-6 lg:grid-cols-3">
                {/* Verification List */}
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Lista de Verificaciones</CardTitle>
                            <CardDescription>
                                Haz clic en una verificación para ver detalles
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : filteredVerifications.length === 0 ? (
              <div className="text-center py-12">
                <BrainCog className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium">No hay verificaciones</h3>
                <p className="text-muted-foreground mb-4">
                  {filter !== 'all'
                    ? 'No se encontraron verificaciones con el filtro seleccionado'
                    : 'Las verificaciones de IA aparecerán aquí cuando se ejecuten workflows con análisis de evidencia'}
                </p>
              </div>
            ) : (
                                <AIVerificationList
                                    verifications={verificationsForList}
                                    onVerificationClick={(id) => {
                                        const verification = verifications.find(v => v.id === id);
                                        if (verification) {
                                            setSelectedVerification(verification);
                                        }
                                    }}
                                />
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Detail View */}
                <div className="lg:col-span-1">
                    <Card className="sticky top-8">
                        <CardHeader>
                            <CardTitle>Detalles</CardTitle>
                            <CardDescription>
                                {selectedVerification
                                    ? selectedVerification.workflowName
                                    : 'Selecciona una verificación'}
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
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Asignado a:</span>
                                            <span className="font-medium">{selectedVerification.assignee || 'N/A'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Sucursal:</span>
                                            <span className="font-medium">{selectedVerification.branch || 'N/A'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Instancia:</span>
                                            <span className="font-medium font-mono text-xs">{selectedVerification.instanceId}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Step:</span>
                                            <span className="font-medium font-mono text-xs">{selectedVerification.stepId}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-4">
                                        <Button variant="outline" className="flex-1">
                                            Ver Workflow
                                        </Button>
                                        <Button variant="outline" className="flex-1">
                                            Ver Incidente
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    Selecciona una verificación de la lista para ver los detalles
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(' ');
}
