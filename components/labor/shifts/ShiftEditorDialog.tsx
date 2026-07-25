"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shift, CreateShiftInput, SHIFT_TYPES, ShiftTypeKey } from "@/lib/types";
import { format } from "date-fns";

interface ShiftEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CreateShiftInput) => void;
  companyId: string;
  shift?: Shift;
  employees: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  roles: string[];
  selectedDate?: Date;
}

export function ShiftEditorDialog({
  isOpen,
  onClose,
  onSave,
  shift,
  employees,
  branches,
  roles,
  selectedDate,
}: ShiftEditorDialogProps) {
  const [formData, setFormData] = useState<CreateShiftInput>({
    userId: "",
    branchId: "",
    role: "",
    shiftDate: selectedDate ? format(selectedDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
    startTime: "09:00",
    endTime: "17:00",
    status: "DRAFT",
    companyId: "",
  });
  const [shiftType, setShiftType] = useState<ShiftTypeKey | "CUSTOM">("MATUTINO");

  useEffect(() => {
    if (shift) {
      setFormData({
        userId: shift.userId,
        branchId: shift.branchId,
        role: shift.role,
        shiftDate: shift.shiftDate,
        startTime: shift.startTime,
        endTime: shift.endTime,
        notes: shift.notes,
        status: (shift.status === "DRAFT" || shift.status === "PUBLISHED") ? shift.status : "DRAFT",
        companyId: shift.companyId,
      });
    } else if (selectedDate) {
      setFormData((prev) => ({
        ...prev,
        shiftDate: format(selectedDate, "yyyy-MM-dd"),
      }));
    }
  }, [shift, selectedDate, isOpen]);

  const handleShiftTypeChange = (type: ShiftTypeKey | "CUSTOM") => {
    setShiftType(type);
    if (type !== "CUSTOM") {
      const schedule = SHIFT_TYPES[type];
      setFormData((prev) => ({
        ...prev,
        startTime: schedule.start,
        endTime: schedule.end,
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{shift ? "Editar Turno" : "Nuevo Turno"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Empleado</Label>
              <Select
                value={formData.userId}
                onValueChange={(v) => setFormData({ ...formData, userId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sucursal</Label>
              <Select
                value={formData.branchId}
                onValueChange={(v) => setFormData({ ...formData, branchId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tipo de Turno</Label>
            <Select value={shiftType} onValueChange={(v) => handleShiftTypeChange(v as ShiftTypeKey | "CUSTOM")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SHIFT_TYPES) as ShiftTypeKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SHIFT_TYPES[key].label} ({SHIFT_TYPES[key].start} - {SHIFT_TYPES[key].end})
                  </SelectItem>
                ))}
                <SelectItem value="CUSTOM">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={formData.shiftDate}
                onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Inicio</Label>
              <Input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Fin</Label>
              <Input
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Input
              value={formData.notes || ""}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Notas opcionales..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
