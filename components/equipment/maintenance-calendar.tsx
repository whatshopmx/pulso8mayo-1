"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  ChevronLeft, 
  ChevronRight, 
  CalendarDays,
  Wrench,
  AlertTriangle,
  Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/use-tenant";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from "date-fns";
import { es } from "date-fns/locale";

interface MaintenanceEvent {
  id: string;
  equipmentId: string;
  equipmentName: string;
  equipmentCode: string;
  date: Date;
  type: string;
  status: string;
  isOverdue: boolean;
}

export function MaintenanceCalendar({ branchId: propBranchId }: { branchId?: string | null } = {}) {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const branchId = propBranchId !== undefined ? propBranchId : tenant?.branchId;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (branchId) {
      fetchEvents();
    }
  }, [branchId, currentDate]);

  const fetchEvents = async () => {
    try {
      setIsLoading(true);
      // Get upcoming maintenance for the month
      const response = await fetch(`/api/equipment/maintenance/upcoming?branchId=${branchId}&days=60`);
      if (!response.ok) throw new Error("Failed to fetch maintenance");
      
      const data = await response.json();
      const events = (data.data || []).map((item: any) => ({
        id: item.maintenance.id,
        equipmentId: item.equipment.id,
        equipmentName: item.equipment.name,
        equipmentCode: item.equipment.equipmentCode,
        date: new Date(item.maintenance.scheduledDate),
        type: item.maintenance.maintenanceType,
        status: item.maintenance.status,
        isOverdue: new Date(item.maintenance.scheduledDate) < new Date() && 
                   item.maintenance.status === 'SCHEDULED',
      }));
      
      setEvents(events);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cargar el calendario de mantenimientos",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getEventsForDate = (date: Date) => {
    return events.filter(event => isSameDay(event.date, date));
  };

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const maintenanceTypeLabels: Record<string, string> = {
    PREVENTIVE: "Preventivo",
    CORRECTIVE: "Correctivo",
    INSPECTION: "Inspección",
    CLEANING: "Limpieza",
    CALIBRATION: "Calibración",
    EMERGENCY: "Emergencia",
  };

  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    SCHEDULED: { 
      color: "bg-blue-100 text-blue-800", 
      icon: <Clock className="w-3 h-3" /> 
    },
    IN_PROGRESS: { 
      color: "bg-yellow-100 text-yellow-800", 
      icon: <Wrench className="w-3 h-3" /> 
    },
    COMPLETED: { 
      color: "bg-green-100 text-green-800", 
      icon: <CalendarDays className="w-3 h-3" /> 
    },
    CANCELLED: { 
      color: "bg-gray-100 text-gray-800", 
      icon: <Clock className="w-3 h-3" /> 
    },
    OVERDUE: { 
      color: "bg-red-100 text-red-800", 
      icon: <AlertTriangle className="w-3 h-3" /> 
    },
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl flex items-center gap-2">
            <CalendarDays className="w-5 h-5" />
            Calendario de Mantenimientos
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-lg font-medium min-w-[150px] text-center">
              {format(currentDate, "MMMM yyyy", { locale: es })}
            </span>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                month={currentDate}
                onMonthChange={setCurrentDate}
                className="rounded-md border"
                modifiers={{
                  hasEvents: events.map(e => e.date),
                  overdue: events.filter(e => e.isOverdue).map(e => e.date),
                }}
                modifiersStyles={{
                  hasEvents: { fontWeight: "bold", backgroundColor: "#dbeafe" },
                  overdue: { fontWeight: "bold", backgroundColor: "#fee2e2", color: "#dc2626" },
                }}
              />
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-blue-100"></div>
                  <span>Programado</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-red-100"></div>
                  <span>Vencido</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-100"></div>
                  <span>Completado</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-medium text-lg">
                {selectedDate 
                  ? `Mantenimientos para ${format(selectedDate, "d 'de' MMMM", { locale: es })}`
                  : "Selecciona una fecha"
                }
              </h3>
              
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : selectedDateEvents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-lg">
                  <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No hay mantenimientos programados</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {selectedDateEvents.map((event) => {
                    const status = statusConfig[event.status] || statusConfig.SCHEDULED;
                    return (
                      <div
                        key={event.id}
                        className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium">{event.equipmentName}</p>
                            <p className="text-sm text-muted-foreground">
                              Código: {event.equipmentCode}
                            </p>
                          </div>
                          <Badge className={status.color}>
                            <span className="flex items-center gap-1">
                              {status.icon}
                              {event.isOverdue ? "Vencido" : maintenanceTypeLabels[event.type]}
                            </span>
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
