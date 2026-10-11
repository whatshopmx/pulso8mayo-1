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
import { mencionaRegla, sinMarcadores } from "@/lib/labor/shift-rules";
import { concederExcepcionJornada, puedeAutorizarExcepciones } from "@/app/actions/shift-overrides";
import { format } from "date-fns";

interface ShiftEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CreateShiftInput) => void | Promise<void>;
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
  });
  const [shiftType, setShiftType] = useState<ShiftTypeKey | "CUSTOM">("MATUTINO");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Excepción de jornada: por qué se rechazó, si este usuario puede levantarla y
  // el motivo que está escribiendo.
  const [puedeAutorizar, setPuedeAutorizar] = useState(false);
  const [motivoExcepcion, setMotivoExcepcion] = useState("");
  const [autorizando, setAutorizando] = useState(false);
  const [errorAutorizacion, setErrorAutorizacion] = useState<string | null>(null);

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
      });
    } else if (selectedDate) {
      setFormData((prev) => ({
        ...prev,
        shiftDate: format(selectedDate, "yyyy-MM-dd"),
      }));
    }
    setSaveError(null);
    setMotivoExcepcion("");
    setErrorAutorizacion(null);
  }, [shift, selectedDate, isOpen]);

  // Se pregunta una sola vez al abrir: el botón de autorización sólo aparece si
  // va a funcionar. Un botón que promete y devuelve 403 no es un control de
  // acceso, es una trampa con texto.
  useEffect(() => {
    if (!isOpen) return;
    let vigente = true;
    void puedeAutorizarExcepciones()
      .then((puede) => {
        if (vigente) setPuedeAutorizar(puede);
      })
      .catch(() => {
        if (vigente) setPuedeAutorizar(false);
      });
    return () => {
      vigente = false;
    };
  }, [isOpen]);

  /**
   * Un turno sin empleado, sucursal u rol no se manda.
   *
   * Antes el formulario se enviaba siempre y el `companyId` salía vacío
   * porque el contenedor no lo tenía. Con C02 el servidor rechaza el destino,
   * pero el operador veía un error genérico por algo que el formulario ya sabía:
   * le faltan tres campos. Deshabilitar es la versión honesta de esa validación.
   */
  const faltaAlgo =
    !formData.userId || !formData.branchId || !formData.role || !formData.shiftDate;
  const sinOpcionesParaElegir =
    employees.length === 0 || branches.length === 0 || roles.length === 0;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (faltaAlgo || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(formData);
      onClose();
    } catch (error) {
      // El diálogo se queda abierto con el motivo: cerrarlo al fallar hacía
      // perder todo lo capturado y obliga a reconstruir el turno.
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar el turno.");
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Autoriza la excepción y reintenta el guardado.
   *
   * El reintento es la parte que importa: levantar la excepción sin volver a
   * guardar dejaría al operador con un turno que "ya debería existir" y una
   * pantalla que no lo muestra. O se guarda, o no se autorizó nada.
   */
  const handleAutorizarExcepcion = async () => {
    if (motivoExcepcion.trim().length < 10 || autorizando) return;

    setAutorizando(true);
    setErrorAutorizacion(null);
    try {
      await concederExcepcionJornada({
        userId: formData.userId,
        shiftDate: formData.shiftDate,
        reason: motivoExcepcion,
      });

      setSaveError(null);
      setIsSaving(true);
      await onSave(formData);
      onClose();
    } catch (error) {
      setErrorAutorizacion(
        error instanceof Error ? error.message : "No se pudo autorizar la excepción."
      );
    } finally {
      setAutorizando(false);
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{shift ? "Editar Turno" : "Nuevo Turno"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {sinOpcionesParaElegir && (
            <p className="text-sm text-destructive">
              Falta información para construir el turno: la empresa necesita
              personal, sucursales y roles registrados.
            </p>
          )}

          {saveError && (
            <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {/* El marcador de regla no se muestra: `sinMarcadores` lo quita
                  y deja el texto que el operador puede entender. */}
              {sinMarcadores(saveError)}
            </div>
          )}

          {saveError && mencionaRegla(saveError, "MAX_DAILY_HOURS") && (
            <div className="rounded-md border px-3 py-3 space-y-3">
              <div className="text-sm">
                <p className="font-medium">Este turno excede la jornada de 8 horas.</p>
                <p className="text-muted-foreground mt-1">
                  {puedeAutorizar
                    ? "Puedes autorizar la excepción: quedará registrada con tu nombre, el motivo y la fecha, y se puede revocar después."
                    : "Necesitas que el propietario de la empresa autorice la excepción. Queda registrada con su nombre y el motivo."}
                </p>
              </div>

              {puedeAutorizar && (
                <div className="space-y-2">
                  <Label htmlFor="motivo-excepcion" className="text-sm">
                    Motivo de la excepción
                  </Label>
                  <Input
                    id="motivo-excepcion"
                    value={motivoExcepcion}
                    onChange={(e) => setMotivoExcepcion(e.target.value)}
                    placeholder="Ej. Temporada alta con cierre doble los sábados."
                    maxLength={200}
                  />
                  {errorAutorizacion && (
                    <p role="alert" className="text-sm text-destructive">
                      {sinMarcadores(errorAutorizacion)}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAutorizarExcepcion}
                    disabled={motivoExcepcion.trim().length < 10 || autorizando || isSaving}
                  >
                    {autorizando ? "Autorizando…" : "Autorizar excepción y guardar"}
                  </Button>
                </div>
              )}
            </div>
          )}
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
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={faltaAlgo || sinOpcionesParaElegir || isSaving}
              title={
                faltaAlgo
                  ? "Elige empleado, sucursal, rol y fecha"
                  : undefined
              }
            >
              {isSaving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
