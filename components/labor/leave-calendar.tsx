'use client';

import { useEffect, useState } from 'react';
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

interface LeaveCalendarProps {
  companyId: string;
  refreshKey?: number;
}

export function LeaveCalendar({ companyId, refreshKey = 0 }: LeaveCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    const controller = new AbortController();
    const fetchLeaveRequests = async () => {
      setLoading(true);
      try {
        const startDate = format(monthStart, 'yyyy-MM-dd');
        const endDate = format(monthEnd, 'yyyy-MM-dd');

        const response = await fetch(
          `/api/leave/requests?companyId=${companyId}&startDate=${startDate}&endDate=${endDate}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        setLeaveRequests(data.requests || []);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        console.error('Error fetching leave requests:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaveRequests();
    return () => controller.abort();
  }, [companyId, currentDate, refreshKey]);

  // Normalize to YYYY-MM-DD strings so UTC midnight timestamps don't shift by 1 day in UTC-6
  const toDateKey = (value: string | Date) => {
    if (typeof value === 'string') return value.slice(0, 10);
    return format(value, 'yyyy-MM-dd');
  };

  const getLeaveRequestsForDay = (day: Date) => {
    const dayKey = format(day, 'yyyy-MM-dd');
    return leaveRequests.filter((request) => {
      if (request.status === 'REJECTED' || request.status === 'CANCELLED') {
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
      ) : (
        <>
          {/* Vista móvil: agenda de días con permisos */}
          <div className="space-y-2 md:hidden">
            {daysWithLeave.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin permisos programados para este mes.
              </p>
            ) : (
              daysWithLeave.map(({ day, requests }) => (
                <div
                  key={day.toISOString()}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                    isToday(day) ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <div className="text-sm font-medium capitalize shrink-0">
                    {format(day, 'EEE d', { locale: es })}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {requests.map((request) => (
                      <Badge
                        key={request.id}
                        variant="secondary"
                        className="text-xs"
                      >
                        {request.userName?.split(' ')[0] || 'Colaborador'}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
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

            {days.map((day) => {
              const requests = getLeaveRequestsForDay(day);
              const isTodayDay = isToday(day);

              return (
                <div
                  key={day.toISOString()}
                  className={`h-24 p-2 border rounded-lg ${
                    isTodayDay ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <div className="text-sm font-medium mb-1 tabular-nums">
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-1">
                    {requests.slice(0, 2).map((request) => (
                      <Badge
                        key={request.id}
                        variant="secondary"
                        className="text-xs block truncate"
                      >
                        {request.userName?.split(' ')[0] || 'Colaborador'}
                      </Badge>
                    ))}
                    {requests.length > 2 && (
                      <div className="text-xs text-muted-foreground">
                        +{requests.length - 2} más
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {Array.from({ length: 6 - monthEnd.getDay() }).map((_, i) => (
              <div key={`empty-end-${i}`} className="h-24" />
            ))}
          </div>
        </>
      )}

      {/* Leyenda */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded ring-2 ring-primary" />
          <span>Hoy</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Nombre
          </Badge>
          <span>Con permiso</span>
        </div>
      </div>
    </div>
  );
}
