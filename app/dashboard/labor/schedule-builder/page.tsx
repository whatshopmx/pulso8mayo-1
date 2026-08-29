"use client";

import { UnifiedShiftScheduler } from "@/components/labor/unified-shift-scheduler";
import { useRequireRole } from "@/hooks/use-session";
import { CalendarDays } from "lucide-react";

export default function ScheduleBuilderPage() {
  const { loading } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

  if (loading) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary" />
          Constructor de Horarios y Turnos
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Planificación semanal de turnos, descansos obligatorios y verificación de límites de jornada (LFT)
        </p>
      </div>
      <UnifiedShiftScheduler />
    </div>
  );
}
