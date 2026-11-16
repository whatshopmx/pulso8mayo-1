'use client';

import { useEffect, useRef, useState } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isToday,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchAllLeaveRequests, type LeaveReviewRequest } from '@/lib/labor/leave-review';

interface LeaveCalendarProps {
  companyId: string;
  refreshKey?: number;
}

export function LeaveCalendar({ companyId, refreshKey = 0 }: LeaveCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [leaveRequests, setLeaveRequests] = useState<LeaveReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const dayTrigger = useRef<HTMLButtonElement | null>(null);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    const controller = new AbortController();
    const fetchLeaveRequests = async () => {
      setLoading(true);
      setError(false);
      setSelectedDay(null);
      try {
        const startDate = format(startOfMonth(currentDate), 'yyyy-MM-dd');
        const endDate = format(endOfMonth(currentDate), 'yyyy-MM-dd');

        const requests = await fetchAllLeaveRequests({ companyId, startDate, endDate }, controller.signal);
        if (!controller.signal.aborted) setLeaveRequests(requests);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Error fetching leave requests:', error);
        setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchLeaveRequests();
    return () => controller.abort();
  }, [companyId, currentDate, refreshKey, retryKey]);

  // Normalize to YYYY-MM-DD strings so UTC midnight timestamps don't shift by 1 day in UTC-6
  const toDateKey = (value: string | Date) => {
    if (typeof value === 'string') return value.slice(0, 10);
    return format(value, 'yyyy-MM-dd');
  };

  const getLeaveRequestsForDay = (day: Date) => {
    const dayKey = format(day, 'yyyy-MM-dd');
    return leaveRequests.filter((request) => {
      if (request.status !== 'APPROVED' && request.status !== 'PENDING') {
        return false;
      }
      const startKey = toDateKey(request.startDate);
      const endKey = toDateKey(request.endDate);
      return dayKey >= startKey && dayKey <= endKey;
    });
  };

  const nextMonth = () => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
    );
  };

  const prevMonth = () => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
    );
  };

  const daysWithLeave = days
    .map((day) => ({ day, requests: getLeaveRequestsForDay(day) }))
    .filter((item) => item.requests.length > 0);

  const renderDay = (day: Date, requests: LeaveReviewRequest[], mobile = false) => (
    <button
      type="button"
      key={day.toISOString()}
      onClick={event => { dayTrigger.current = event.currentTarget; setSelectedDay(day); }}
      aria-label={`${format(day, "d 'de' MMMM", { locale: es })}: ${requests.length} ${requests.length === 1 ? 'permiso' : 'permisos'}. Ver detalle`}
      className={`min-w-0 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        mobile ? 'w-full space-y-2' : 'min-h-36'
      } ${isToday(day) ? 'border-primary bg-accent/30' : ''}`}
    >
      <span className="block text-sm font-medium capitalize tabular-nums mb-2">
        {format(day, mobile ? 'EEEE d' : 'd', { locale: es })}{isToday(day) && ' · Hoy'}
      </span>
      <span className="block space-y-2">
        {requests.slice(0, 2).map(request => (
          <span key={request.id} className="block min-w-0">
            <span className="block truncate text-sm" title={request.userName || 'Colaborador'}>{request.userName || 'Colaborador'}</span>
            <span className={`block text-xs ${request.status === 'PENDING' ? 'text-warning-text' : 'text-success-text'}`}>
              {request.status === 'PENDING' ? 'Pendiente' : 'Aprobada'}
            </span>
          </span>
        ))}
        {requests.length > 2 && <span className="block text-xs font-medium underline underline-offset-4">+{requests.length - 2} más · Ver detalle</span>}
        {requests.length === 0 && <span className="text-xs text-muted-foreground">Sin permisos</span>}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Encabezado del calendario */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize">
          {format(currentDate, 'MMMM yyyy', { locale: es })}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={prevMonth}
            aria-label="Mes anterior"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={nextMonth}
            aria-label="Mes siguiente"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Cargando calendario...</span>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-lg border p-6 space-y-3">
          <p className="text-sm">No pudimos cargar el calendario. No es posible confirmar las ausencias de este mes.</p>
          <Button variant="outline" onClick={() => setRetryKey(key => key + 1)}>Reintentar calendario</Button>
        </div>
      ) : (
        <>
          {/* Vista móvil: agenda de días con permisos */}
          <div className="space-y-2 md:hidden">
            {daysWithLeave.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin permisos programados para este mes.
              </p>
            ) : (
              daysWithLeave.map(({ day, requests }) => renderDay(day, requests, true))
            )}
          </div>

          {/* Vista escritorio: cuadrícula mensual de 7 columnas */}
          <div className="hidden md:grid grid-cols-7 gap-2">
            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day) => (
              <div key={day} className="text-center text-sm font-medium p-2">
                {day}
              </div>
            ))}

            {Array.from({ length: monthStart.getDay() }).map((_, i) => (
              <div key={`empty-start-${i}`} className="h-24" />
            ))}

            {days.map(day => renderDay(day, getLeaveRequestsForDay(day)))}

            {Array.from({ length: 6 - monthEnd.getDay() }).map((_, i) => (
              <div key={`empty-end-${i}`} className="h-24" />
            ))}
          </div>
        </>
      )}

      {/* Leyenda */}
      <p className="text-sm text-muted-foreground">Las solicitudes pendientes aún no están autorizadas. Selecciona un día para ver todas las personas y sus permisos.</p>
      <Dialog open={selectedDay !== null} onOpenChange={open => { if (!open) setSelectedDay(null); }}>
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto shadow-none"
          onCloseAutoFocus={event => { event.preventDefault(); dayTrigger.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>{selectedDay ? format(selectedDay, "d 'de' MMMM, yyyy", { locale: es }) : 'Detalle de permisos'}</DialogTitle>
            <DialogDescription>Permisos aprobados y solicitudes pendientes de este día.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border">
            {selectedDay && getLeaveRequestsForDay(selectedDay).map(request => (
              <li key={request.id} className="py-3 space-y-1 min-w-0">
                <p className="font-medium break-words">{request.userName || 'Colaborador'}</p>
                <Badge variant="outline" className={request.status === 'PENDING' ? 'bg-warning/15 text-warning-text' : 'bg-success/15 text-success-text'}>
                  {request.status === 'PENDING' ? 'Pendiente' : 'Aprobada'}
                </Badge>
                <p className="text-sm break-words">{request.leaveTypeName || 'Permiso'} · {request.branchName || 'Sucursal sin registrar'}</p>
                <p className="text-sm text-muted-foreground">{format(new Date(`${request.startDate.slice(0, 10)}T12:00:00`), 'd MMM yyyy', { locale: es })} — {format(new Date(`${request.endDate.slice(0, 10)}T12:00:00`), 'd MMM yyyy', { locale: es })}</p>
              </li>
            ))}
          </ul>
          {selectedDay && getLeaveRequestsForDay(selectedDay).length === 0 && <p className="text-sm text-muted-foreground">Sin permisos para este día.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
