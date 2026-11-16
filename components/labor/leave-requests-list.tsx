'use client';

import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Check, X, Ban, Loader2, CalendarRange } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { fetchAllLeaveRequests, overlappingRequests, type LeaveReviewRequest } from '@/lib/labor/leave-review';

export interface LeaveRequestItem {
  id: string;
  userId: string;
  userName: string | null;
  branchId?: string | null;
  branchName?: string | null;
  leaveTypeId: string;
  leaveTypeName: string | null;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | string;
  requestedAt: string;
  rejectionReason: string | null;
}

interface LeaveRequestsListProps {
  mode: 'mine' | 'approvals';
  userId?: string;
  refreshKey?: number;
  onActionComplete?: () => void;
  onPendingCountChange?: (count: number) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: 'Pendiente',
    className: 'bg-warning/15 text-warning-text border-warning/30',
  },
  APPROVED: {
    label: 'Aprobada',
    className: 'bg-success/15 text-success-text border-success/30',
  },
  REJECTED: {
    label: 'Rechazada',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
  },
  CANCELLED: {
    label: 'Cancelada',
    className: 'bg-muted text-muted-foreground border-border',
  },
};

export function LeaveRequestsList({
  mode,
  userId,
  refreshKey = 0,
  onActionComplete,
  onPendingCountChange,
}: LeaveRequestsListProps) {
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LeaveRequestItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [contextRequests, setContextRequests] = useState<LeaveReviewRequest[]>([]);
  const [contextError, setContextError] = useState(false);

  const fetchRequests = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(false);
      setContextError(false);
      setContextRequests([]);
      try {
        const params: Record<string, string> = {};
        if (mode === 'mine' && userId) {
          params.userId = userId;
        } else if (mode === 'approvals') {
          params.status = 'PENDING';
        }
        const items = await fetchAllLeaveRequests<LeaveRequestItem>(params, signal);
        if (signal?.aborted) return;
        setRequests(items);
        if (mode === 'approvals') {
          onPendingCountChange?.(items.length);
          if (items.length > 0) {
            try {
              const starts = items.map(item => item.startDate.slice(0, 10)).sort();
              const ends = items.map(item => item.endDate.slice(0, 10)).sort();
              const context = await fetchAllLeaveRequests({ startDate: starts[0], endDate: ends[ends.length - 1] }, signal);
              if (!signal?.aborted) setContextRequests(context);
            } catch (error) {
              if ((error as Error).name === 'AbortError') return;
              setContextError(true);
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Error fetching leave requests:', error);
        setError(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [mode, userId, onPendingCountChange]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchRequests(controller.signal);
    return () => controller.abort();
  }, [fetchRequests, refreshKey, retryKey]);

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      const response = await fetch(`/api/leave/requests?id=${id}&action=approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'No se pudo aprobar la solicitud');
        return;
      }
      toast.success('Solicitud aprobada');
      await fetchRequests();
      onActionComplete?.();
    } catch (error) {
      console.error('Error approving leave request:', error);
      toast.error('Error al aprobar la solicitud');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget) return;
    if (!rejectionReason.trim()) {
      toast.error('Ingresa el motivo del rechazo');
      return;
    }

    setProcessingId(rejectTarget.id);
    try {
      const response = await fetch(
        `/api/leave/requests?id=${rejectTarget.id}&action=reject`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rejectionReason: rejectionReason.trim() }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'No se pudo rechazar la solicitud');
        return;
      }
      toast.success('Solicitud rechazada');
      setRejectTarget(null);
      setRejectionReason('');
      await fetchRequests();
      onActionComplete?.();
    } catch (error) {
      console.error('Error rejecting leave request:', error);
      toast.error('Error al rechazar la solicitud');
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setProcessingId(id);
    try {
      const response = await fetch(`/api/leave/requests?id=${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'No se pudo cancelar la solicitud');
        return;
      }
      toast.success('Solicitud cancelada');
      await fetchRequests();
      onActionComplete?.();
    } catch (error) {
      console.error('Error cancelling leave request:', error);
      toast.error('Error al cancelar la solicitud');
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Cargando solicitudes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="space-y-3 py-6">
        <p className="text-sm">No pudimos cargar las solicitudes. Vuelve a intentarlo para revisar su estado.</p>
        <Button variant="outline" onClick={() => setRetryKey(key => key + 1)}>Reintentar solicitudes</Button>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <CalendarRange className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          {mode === 'approvals'
            ? 'No hay solicitudes de permiso pendientes'
            : 'Aún no has enviado solicitudes de permiso'}
        </p>
        <p className="text-xs text-muted-foreground">
          {mode === 'approvals'
            ? 'Cuando un colaborador solicite días libres aparecerán aquí para su autorización.'
            : 'Usa la pestaña "Solicitar permiso" para registrar una nueva solicitud.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {mode === 'approvals' && (
        <p className="text-sm text-muted-foreground mb-4">Revisa las coincidencias de permisos antes de decidir. Confirma también los turnos y la cobertura de la sucursal.</p>
      )}
      {mode === 'approvals' && contextError && (
        <div role="alert" className="space-y-2 mb-4 rounded-lg border p-4">
          <p className="text-sm">No pudimos consultar las ausencias coincidentes. La lista de solicitudes sí está disponible.</p>
          <Button variant="outline" size="sm" onClick={() => setRetryKey(key => key + 1)}>Reintentar coincidencias</Button>
        </div>
      )}
      <div className="divide-y divide-border">
        {requests.map((req) => {
          const statusInfo = STATUS_CONFIG[req.status] || {
            label: req.status,
            className: 'bg-muted text-muted-foreground',
          };
          const isBusy = processingId === req.id;
          const overlaps = overlappingRequests(req, contextRequests);

          return (
            <div
              key={req.id}
              className="flex flex-col gap-3 py-4 transition-colors hover:bg-muted/40 px-2 rounded-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {mode === 'approvals' && (
                    <span className="font-semibold text-sm break-words">
                      {req.userName || 'Colaborador'}
                    </span>
                  )}
                  <span className="text-sm font-medium text-foreground">
                    {req.leaveTypeName || 'Permiso'}
                  </span>
                  <Badge variant="outline" className={statusInfo.className}>
                    {statusInfo.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {req.totalDays} {req.totalDays === 1 ? 'día' : 'días'}
                  </span>
                </div>

                <p className="text-sm text-muted-foreground">
                  {format(new Date(`${req.startDate.slice(0, 10)}T12:00:00`), "d 'de' MMM, yyyy", { locale: es })} —{' '}
                  {format(new Date(`${req.endDate.slice(0, 10)}T12:00:00`), "d 'de' MMM, yyyy", { locale: es })}
                </p>

                <p className="text-sm text-foreground/90 break-words">{req.reason}</p>

                {mode === 'approvals' && (
                  <div className="rounded-md bg-muted/50 p-3 space-y-2 text-sm">
                    <p className="font-medium break-words">{req.branchName || 'Sucursal sin registrar'}</p>
                    {!req.branchId ? (
                      <p className="text-muted-foreground">Confirma la sucursal con el colaborador para revisar las coincidencias.</p>
                    ) : contextError ? (
                      <p className="text-muted-foreground">Coincidencias sin consultar.</p>
                    ) : overlaps.length === 0 ? (
                      <p className="text-muted-foreground">Sin otros permisos coincidentes registrados en esta sucursal. Confirma la cobertura del turno antes de aprobar.</p>
                    ) : (
                      <details>
                        <summary className="cursor-pointer py-1 font-medium focus-visible:outline-2 focus-visible:outline-ring">
                          {overlaps.length} {overlaps.length === 1 ? 'permiso coincidente' : 'permisos coincidentes'} en esta sucursal
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {overlaps.map(overlap => (
                            <li key={overlap.id} className="break-words">
                              <span className="font-medium">{overlap.userName || 'Colaborador'}</span>
                              {' · '}{overlap.status === 'APPROVED' ? 'Aprobada' : 'Pendiente'}
                              <span className="block text-muted-foreground">
                                {format(new Date(`${overlap.startDate.slice(0, 10)}T12:00:00`), 'd MMM yyyy', { locale: es })} — {format(new Date(`${overlap.endDate.slice(0, 10)}T12:00:00`), 'd MMM yyyy', { locale: es })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}

                {req.status === 'REJECTED' && req.rejectionReason && (
                  <p className="text-xs text-destructive">
                    Motivo de rechazo: {req.rejectionReason}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {mode === 'approvals' && req.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={processingId !== null}
                      onClick={() => handleApprove(req.id)}
                      className="min-h-11 sm:min-h-8 text-success-text hover:text-success-text hover:bg-success/10 border-success/30"
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-1" />
                      )}
                      Aprobar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={processingId !== null}
                      onClick={() => {
                        setRejectTarget(req);
                        setRejectionReason('');
                      }}
                      className="min-h-11 sm:min-h-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Rechazar
                    </Button>
                  </>
                )}

                {mode === 'mine' && req.status === 'PENDING' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={processingId !== null}
                    onClick={() => handleCancel(req.id)}
                    className="min-h-11 sm:min-h-8"
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Ban className="h-4 w-4 mr-1" />
                    )}
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={Boolean(rejectTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setRejectionReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar solicitud de permiso</DialogTitle>
            <DialogDescription>
              Indica el motivo del rechazo para que{' '}
              {rejectTarget?.userName || 'el colaborador'} lo pueda consultar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="leave-rejection-reason">Motivo del rechazo</Label>
            <Textarea
              id="leave-rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Ej. Cobertura insuficiente de turno en esas fechas..."
              className="resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectTarget(null)}
              disabled={processingId !== null}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={processingId !== null || !rejectionReason.trim()}
            >
              {processingId !== null && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
