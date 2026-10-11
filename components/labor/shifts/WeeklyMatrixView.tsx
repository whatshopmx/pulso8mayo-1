"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Calendar, Download } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shift, ShiftFilters } from "@/lib/types";
import { useShifts, useWeeklySchedule, useShiftExport } from "@/hooks";
import { ShiftCell } from "./ShiftCell";
import { ShiftEditorDialog } from "./ShiftEditorDialog";
import { FilterToolbar } from "./FilterToolbar";

interface WeeklyMatrixViewProps {
  branches: { id: string; name: string }[];
  roles: string[];
  employees: { id: string; name: string }[];
}

export function WeeklyMatrixView({ branches, roles, employees }: WeeklyMatrixViewProps) {
  const [filters, setFilters] = useState<ShiftFilters>({});
  const [editingShift, setEditingShift] = useState<Shift | undefined>();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [exportError, setExportError] = useState<string | null>(null);

  const { shifts, isLoading, isError, error, refetch, createShift, updateShift, deleteShift } = useShifts(filters);
  const { exportToCSV, isExporting } = useShiftExport();
  const {
  weekDays,
  weekLabel,
  isCurrentWeek,
  goToPreviousWeek,
  goToNextWeek,
  goToCurrentWeek,
  getShiftsForDay,
  getShiftsForWeek,
  weekStart,
  weekEnd,
  } = useWeeklySchedule();

  const weekShifts = getShiftsForWeek(shifts);

  const handleExport = () => {
    setExportError(null);
    try {
      exportToCSV(weekShifts, {
        filename: `turnos_${format(weekStart, "yyyy-MM-dd")}_${format(weekEnd, "yyyy-MM-dd")}.csv`,
      });
    } catch {
      setExportError("No pudimos exportar los turnos. Intenta descargar el archivo de nuevo.");
    }
  };

  const handleCellClick = (date: Date, existingShift?: Shift) => {
    setSelectedDate(date);
    setEditingShift(existingShift);
    setIsEditorOpen(true);
  };

  // El error sube al diálogo, que se queda abierto con el motivo: cerrarlo al
  // fallar hacía perder todo lo capturado (C08).
  const handleSave = async (data: Parameters<typeof createShift>[0]) => {
    if (editingShift) {
      await updateShift(editingShift.id, data);
    } else {
      await createShift(data);
    }
  };

  const handleDelete = async (shift: Shift) => {
    if (confirm("¿Eliminar este turno?")) {
      await deleteShift(shift.id);
    }
  };

  const handleDuplicate = async (shift: Shift) => {
    await createShift({
      userId: shift.userId,
      branchId: shift.branchId,
      role: shift.role,
      shiftDate: shift.shiftDate,
      startTime: shift.startTime,
      endTime: shift.endTime,
      notes: shift.notes || undefined,
      status: "DRAFT",
    });
  };

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={goToPreviousWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-lg min-w-[200px] text-center">{weekLabel}</span>
          <Button variant="outline" size="icon" aria-label="Semana siguiente" onClick={goToNextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {!isCurrentWeek && (
          <Button variant="outline" onClick={goToCurrentWeek}>
            <Calendar className="h-4 w-4 mr-2" />
            Semana actual
          </Button>
        )}
        <Button variant="outline" onClick={handleExport}
          disabled={isLoading || isError || isExporting || weekShifts.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <FilterToolbar
        filters={filters}
        onFiltersChange={setFilters}
        branches={branches}
        roles={roles}
      />

      {exportError && (
        <Alert variant="destructive"><AlertDescription>{exportError}</AlertDescription></Alert>
      )}
      {!isLoading && isError && (
        <Alert variant="destructive">
          <AlertDescription>
            No pudimos cargar los turnos. {error?.message}
            <Button variant="outline" size="sm" className="ml-2" onClick={() => refetch()}>Reintentar</Button>
          </AlertDescription>
        </Alert>
      )}
      {!isLoading && !isError && weekShifts.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          No hay turnos para exportar en esta semana con los filtros seleccionados.
        </p>
      )}

      {/* Weekly grid */}
      {isLoading ? (
        <div className="h-96 flex items-center justify-center text-muted-foreground">
          Cargando turnos...
        </div>
      ) : isError ? null : (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const dayShifts = getShiftsForDay(weekShifts, day.dateString);
            return (
              <div key={day.dateString} className="space-y-2">
                {/* Day header */}
                <div className="text-center py-2 bg-muted rounded-t-md">
                  <div className="font-medium capitalize">{day.dayName}</div>
                  <div className="text-sm text-muted-foreground">{day.dayNumber}</div>
                </div>
                {/* Shifts */}
                <div className="space-y-2">
                  {dayShifts.length > 0 ? (
                    dayShifts.map((shift) => (
                      <ShiftCell
                        key={shift.id}
                        shift={shift}
                        onEdit={(s) => handleCellClick(day.date, s)}
                        onDelete={handleDelete}
                        onDuplicate={handleDuplicate}
                      />
                    ))
                  ) : (
                    <ShiftCell isEmpty onEdit={() => handleCellClick(day.date)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor dialog */}
      <ShiftEditorDialog
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSave}
        shift={editingShift}
        employees={employees}
        branches={branches}
        roles={roles}
        selectedDate={selectedDate}
      />
    </div>
  );
}
