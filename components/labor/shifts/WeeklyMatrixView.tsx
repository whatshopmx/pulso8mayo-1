"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Shift, ShiftFilters } from "@/lib/types";
import { useShifts, useWeeklySchedule } from "@/hooks";
import { ShiftCell } from "./ShiftCell";
import { ShiftEditorDialog } from "./ShiftEditorDialog";
import { FilterToolbar } from "./FilterToolbar";

interface WeeklyMatrixViewProps {
  branches: { id: string; name: string }[];
  roles: string[];
  employees: { id: string; name: string }[];
  companyId?: string;
}

export function WeeklyMatrixView({ branches, roles, employees, companyId }: WeeklyMatrixViewProps) {
  const [filters, setFilters] = useState<ShiftFilters>({});
  const [editingShift, setEditingShift] = useState<Shift | undefined>();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  const { shifts, isLoading, createShift, updateShift, deleteShift } = useShifts(filters);
  const {
  weekDays,
  weekLabel,
  isCurrentWeek,
  goToPreviousWeek,
  goToNextWeek,
  goToCurrentWeek,
  getShiftsForDay,
  getShiftsForWeek,
  } = useWeeklySchedule();

  const weekShifts = getShiftsForWeek(shifts);

  const handleCellClick = (date: Date, existingShift?: Shift) => {
    setSelectedDate(date);
    setEditingShift(existingShift);
    setIsEditorOpen(true);
  };

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
      companyId: shift.companyId,
    });
  };

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPreviousWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-lg min-w-[200px] text-center">{weekLabel}</span>
          <Button variant="outline" size="icon" onClick={goToNextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {!isCurrentWeek && (
          <Button variant="outline" onClick={goToCurrentWeek}>
            <Calendar className="h-4 w-4 mr-2" />
            Semana actual
          </Button>
        )}
      </div>

      {/* Filters */}
      <FilterToolbar
        filters={filters}
        onFiltersChange={setFilters}
        branches={branches}
        roles={roles}
      />

      {/* Weekly grid */}
      {isLoading ? (
        <div className="h-96 flex items-center justify-center text-muted-foreground">
          Cargando turnos...
        </div>
      ) : (
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
        companyId={companyId || ""}
      />
    </div>
  );
}
