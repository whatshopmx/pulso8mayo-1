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

export interface LeaveRequestItem {
  id: string;
  userId: string;
  userName: string | null;
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

  const fetchRequests = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (mode === 'mine' && userId) {
          params.set('userId', userId);
        } else if (mode === 'approvals') {
          params.set('status', 'PENDING');
        }

        const response = await fetch(`/api/leave/requests?${params.toString()}`, {
          signal,
        });
        if (!response.ok) {
          throw new Error('Error al cargar solicitudes');
        }
        const data = await response.json();
        const items: LeaveRequestItem[] = data.requests || [];
        setRequests(items);
        if (mode === 'approvals') {
          onPendingCountChange?.(items.length);
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Error fetching leave requests:', error);
        toast.error('No se pudieron cargar las solicitudes de permiso');
      } finally {
        setLoading(false);
      }
    },
    [mode, userId, onPendingCountChange]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchRequests(controller.signal);
    return () => controller.abort();
  }, [fetchRequests, refreshKey]);

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
      <div className="divide-y divide-border">
        {requests.map((req) => {
          const statusInfo = STATUS_CONFIG[req.status] || {
            label: req.status,
            className: 'bg-muted text-muted-foreground',
          };
          const isBusy = processingId === req.id;

          return (
            <div
              key={req.id}
              className="flex flex-col gap-3 py-4 transition-colors hover:bg-muted/40 px-2 rounded-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {mode === 'approvals' && (
                    <span className="font-semibold text-sm">
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
                  {format(new Date(req.startDate), "d 'de' MMM, yyyy", { locale: es })} —{' '}
                  {format(new Date(req.endDate), "d 'de' MMM, yyyy", { locale: es })}
                </p>

                <p className="text-sm text-foreground/90">{req.reason}</p>

                {req.status === 'REJECTED' && req.rejectionReason && (
                  <p className="text-xs text-destructive">
                    Motivo de rechazo: {req.rejectionReason}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {mode === 'approvals' && req.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
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
                      disabled={isBusy}
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
                    disabled={isBusy}
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
