'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, AlertTriangle, XCircle, CheckCircle2, Eye, ArrowUpDown, Search, Loader2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

// ── Spanish display labels ──────────────────────────────────────────

const SEVERITY_LABELS: Record<string, string> = {
    CRITICAL: 'Crítico',
    HIGH: 'Alto',
    WARNING: 'Advertencia',
    FATAL: 'Fatal',
};

const STATUS_LABELS: Record<string, string> = {
    DETECTED: 'Detectado',
    IN_REMEDIATION: 'En remediación',
    AWAITING_EXTERNAL: 'Esperando externo',
    CONFIRMED: 'Confirmado',
    RESOLVED: 'Resuelto',
    ESCALATED: 'Escalado',
};

// ── Visual mapping ──────────────────────────────────────────────────

const severityIcons: Record<string, typeof XCircle> = {
    CRITICAL: XCircle,
    HIGH: AlertTriangle,
    WARNING: AlertTriangle,
    FATAL: AlertCircle,
};

const severityVariants: Record<string, string> = {
    CRITICAL: 'bg-destructive/10 text-destructive border-destructive/20',
    HIGH: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
    WARNING: 'bg-warning/10 text-warning-foreground border-warning/20',
    FATAL: 'bg-destructive/15 text-destructive border-destructive/30',
};

const statusVariants: Record<string, string> = {
    DETECTED: 'bg-destructive/10 text-destructive border-destructive/20',
    IN_REMEDIATION: 'bg-warning/10 text-warning-foreground border-warning/20',
    AWAITING_EXTERNAL: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    CONFIRMED: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    RESOLVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    ESCALATED: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
};

// ── Types ───────────────────────────────────────────────────────────

interface Incident {
    id: string;
    severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'FATAL';
    title: string;
    status: 'DETECTED' | 'IN_REMEDIATION' | 'AWAITING_EXTERNAL' | 'CONFIRMED' | 'RESOLVED' | 'ESCALATED';
    createdAt: Date;
    instanceId: string;
}

interface IncidentListProps {
    incidents: Incident[];
    totalCount?: number;
    page?: number;
    totalPages?: number;
}

type SortField = 'severity' | 'createdAt' | 'status';
type SortDir = 'asc' | 'desc';

const SEVERITY_ORDER: Record<string, number> = { FATAL: 0, CRITICAL: 1, HIGH: 2, WARNING: 3 };

// ── Component ───────────────────────────────────────────────────────

export function IncidentList({ incidents, totalCount, page = 1, totalPages = 1 }: IncidentListProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    // Filters
    const [severityFilter, setSeverityFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Sort
    const [sortField, setSortField] = useState<SortField>('createdAt');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    // Resolve dialog
    const [resolveTarget, setResolveTarget] = useState<Incident | null>(null);
    const [resolutionNote, setResolutionNote] = useState('');
    const [isResolving, setIsResolving] = useState(false);

    // ── Handlers ────────────────────────────────────────────────────

    const handleViewDetails = (id: string) => {
        router.push(`/dashboard/incidents/${id}`);
    };

    const openResolveDialog = (incident: Incident) => {
        setResolveTarget(incident);
        setResolutionNote('');
    };

    const handleResolve = async () => {
        if (!resolveTarget) return;
        if (!resolutionNote.trim()) {
            toast.error('Escribe una nota de resolución antes de continuar.');
            return;
        }

        setIsResolving(true);
        try {
            const res = await fetch(`/api/incidents/${resolveTarget.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolution: resolutionNote.trim() }),
            });

            if (!res.ok) {
                throw new Error(`Error ${res.status}`);
            }

            toast.success(`Incidente resuelto: ${resolveTarget.title}`);
            setResolveTarget(null);
            startTransition(() => {
                router.refresh();
            });
        } catch (error) {
            toast.error('No se pudo resolver el incidente. Intenta de nuevo.');
        } finally {
            setIsResolving(false);
        }
    };

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDir(field === 'createdAt' ? 'desc' : 'asc');
        }
    };

    // ── Filter + sort pipeline ──────────────────────────────────────

    const filtered = incidents.filter((incident) => {
        if (severityFilter !== 'all' && incident.severity !== severityFilter) return false;
        if (statusFilter !== 'all' && incident.status !== statusFilter) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const matchesTitle = incident.title.toLowerCase().includes(q);
            const matchesSeverity = (SEVERITY_LABELS[incident.severity] || '').toLowerCase().includes(q);
            const matchesStatus = (STATUS_LABELS[incident.status] || '').toLowerCase().includes(q);
            if (!matchesTitle && !matchesSeverity && !matchesStatus) return false;
        }
        return true;
    });

    const sorted = [...filtered].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        switch (sortField) {
            case 'severity':
                return ((SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)) * dir;
            case 'status':
                return (a.status.localeCompare(b.status)) * dir;
            case 'createdAt':
            default:
                return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
        }
    });

    // ── Render ──────────────────────────────────────────────────────

    const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
        <button
            onClick={() => toggleSort(field)}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
            {children}
            <ArrowUpDown className={`h-3 w-3 ${sortField === field ? 'text-foreground' : 'text-muted-foreground/50'}`} />
        </button>
    );

    return (
        <>
            <div className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar incidentes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    <Select value={severityFilter} onValueChange={setSeverityFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Severidad" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas las severidades</SelectItem>
                            <SelectItem value="HIGH">Alto</SelectItem>
                            <SelectItem value="FATAL">Fatal</SelectItem>
                            <SelectItem value="CRITICAL">Crítico</SelectItem>
                            <SelectItem value="WARNING">Advertencia</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Estado" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos los estados</SelectItem>
                            <SelectItem value="DETECTED">Detectado</SelectItem>
                            <SelectItem value="IN_REMEDIATION">En remediación</SelectItem>
                            <SelectItem value="AWAITING_EXTERNAL">Esperando externo</SelectItem>
                            <SelectItem value="CONFIRMED">Confirmado</SelectItem>
                            <SelectItem value="ESCALATED">Escalado</SelectItem>
                            <SelectItem value="RESOLVED">Resuelto</SelectItem>
                        </SelectContent>
                    </Select>

                    {(severityFilter !== 'all' || statusFilter !== 'all' || searchQuery) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setSeverityFilter('all'); setStatusFilter('all'); setSearchQuery(''); }}
                            className="text-muted-foreground"
                        >
                            Limpiar filtros
                        </Button>
                    )}
                </div>

                {/* Result count */}
                <p className="text-sm text-muted-foreground">
                    {totalCount !== undefined && totalCount > incidents.length
                        ? `${sorted.length} de ${totalCount} incidentes`
                        : `${sorted.length} incidentes`}
                </p>

                {/* Table */}
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[120px]">
                                    <SortButton field="severity">Severidad</SortButton>
                                </TableHead>
                                <TableHead>Título</TableHead>
                                <TableHead className="w-[160px]">
                                    <SortButton field="status">Estado</SortButton>
                                </TableHead>
                                <TableHead className="w-[180px]">
                                    <SortButton field="createdAt">Fecha</SortButton>
                                </TableHead>
                                <TableHead className="text-right w-[140px]">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sorted.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                                        <div className="flex flex-col items-center justify-center py-12 gap-2">
                                            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                                            <p className="font-medium">Sin incidentes</p>
                                            <p className="text-sm">
                                                {searchQuery || severityFilter !== 'all' || statusFilter !== 'all'
                                                    ? 'No se encontraron incidentes con los filtros actuales.'
                                                    : 'No hay incidentes registrados. ¡Todo en orden!'}
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sorted.map((incident) => {
                                    const SeverityIcon = severityIcons[incident.severity] || AlertCircle;
                                    const createdDate = new Date(incident.createdAt);
                                    return (
                                        <TableRow key={incident.id} className="group">
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={severityVariants[incident.severity] || ''}
                                                >
                                                    <SeverityIcon className="h-3 w-3 mr-1" />
                                                    {SEVERITY_LABELS[incident.severity] || incident.severity}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-medium max-w-[300px] truncate">
                                                {incident.title}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={statusVariants[incident.status] || ''}
                                                >
                                                    {STATUS_LABELS[incident.status] || incident.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="text-sm text-muted-foreground cursor-default">
                                                            {formatDistanceToNow(createdDate, { addSuffix: true, locale: es })}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {format(createdDate, "d 'de' MMMM yyyy, HH:mm", { locale: es })}
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => handleViewDetails(incident.id)}
                                                                aria-label={`Ver detalles de: ${incident.title}`}
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Ver detalles</TooltipContent>
                                                    </Tooltip>

                                                    {incident.status !== 'RESOLVED' && (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => openResolveDialog(incident)}
                                                        >
                                                            Resolver
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* ── Pagination ──────────────────────────────────────────── */}
                {totalCount !== undefined && totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                        <p className="text-sm text-muted-foreground">
                            Página {page} de {totalPages}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page <= 1}
                                onClick={() => {
                                    const params = new URLSearchParams(window.location.search);
                                    params.set('page', String(page - 1));
                                    window.location.search = params.toString();
                                }}
                            >
                                Anterior
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= totalPages}
                                onClick={() => {
                                    const params = new URLSearchParams(window.location.search);
                                    params.set('page', String(page + 1));
                                    window.location.search = params.toString();
                                }}
                            >
                                Siguiente
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Resolve confirmation dialog ────────────────────────────── */}
            <AlertDialog open={!!resolveTarget} onOpenChange={(open) => { if (!open) setResolveTarget(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Resolver este incidente?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Estás por marcar como resuelto: <strong>{resolveTarget?.title}</strong>.
                            Esta acción no se puede deshacer fácilmente. Describe qué se hizo para resolverlo.
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
                                'Confirmar resolución'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

// ── Skeleton for Suspense fallback ──────────────────────────────────

export function IncidentListSkeleton() {
    return (
        <div className="space-y-4">
            {/* Filter skeleton */}
            <div className="flex gap-3">
                <Skeleton className="h-9 w-[200px]" />
                <Skeleton className="h-9 w-[180px]" />
                <Skeleton className="h-9 w-[180px]" />
            </div>
            <Skeleton className="h-4 w-32" />
            {/* Table skeleton */}
            <div className="rounded-md border">
                <div className="p-0">
                    {/* Header */}
                    <div className="flex items-center gap-4 border-b px-4 py-3">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                    {/* Rows */}
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-4 border-b last:border-0 px-4 py-3">
                            <Skeleton className="h-5 w-20 rounded-full" />
                            <Skeleton className="h-4 flex-1" />
                            <Skeleton className="h-5 w-24 rounded-full" />
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-8 w-20" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
