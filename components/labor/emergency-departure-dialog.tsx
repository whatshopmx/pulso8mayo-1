'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, UserX, Loader2, ArrowRightLeft, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

interface Employee {
  id: string;
  name: string;
  role?: string;
  branchId?: string;
}

interface EmergencyDepartureDialogProps {
  employees: Employee[];
  branchId: string;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function EmergencyDepartureDialog({
  employees,
  branchId,
  trigger,
  onSuccess,
}: EmergencyDepartureDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [targetUserId, setTargetUserId] = useState<string>('AUTO');
  const [notes, setNotes] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUserId) {
      toast.error('Por favor seleccione al empleado que se retira');
      return;
    }

    if (!reason || reason.trim().length < 5) {
      toast.error('Indique un motivo válido (mínimo 5 caracteres)');
      return;
    }

    try {
      setLoading(true);

      const res = await fetch('/api/labor/emergency-departure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUserId,
          branchId,
          reason,
          targetUserId: targetUserId === 'AUTO' ? undefined : targetUserId,
          notes,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al procesar la salida de emergencia');
      }

      toast.success(data.message || 'Salida de emergencia registrada y tareas reasignadas');
      setOpen(false);
      // Reset form
      setSelectedUserId('');
      setReason('');
      setTargetUserId('AUTO');
      setNotes('');

      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Ocurrió un error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const selectedEmployee = employees.find((e) => e.id === selectedUserId);
  const availablePeers = employees.filter((e) => e.id !== selectedUserId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="destructive" className="gap-2 font-medium">
            <UserX className="h-4 w-4" />
            Salida de Emergencia
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            <DialogTitle>Registrar Salida de Emergencia</DialogTitle>
          </div>
          <DialogDescription>
            Registra la salida anticipada de un empleado en turno. El sistema reasignará automáticamente sus tareas del día y activará el protocolo de contingencia.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Empleado saliente */}
          <div className="space-y-2">
            <Label htmlFor="employee">Empleado en Turno *</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger id="employee">
                <SelectValue placeholder="Seleccionar empleado que se retira..." />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.name} {emp.role ? `(${emp.role})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Causa / Motivo */}
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo de Emergencia *</Label>
            <Input
              id="reason"
              placeholder="Ej. Emergencia médica, asunto familiar grave, etc."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          {/* Reasignación destino */}
          <div className="space-y-2">
            <Label htmlFor="target">Reasignación de Tareas Pendientes</Label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger id="target">
                <SelectValue placeholder="Seleccionar destino..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">
                  ✨ Automático (Balanceo al de menor carga o Supervisor)
                </SelectItem>
                {availablePeers.map((peer) => (
                  <SelectItem key={peer.id} value={peer.id}>
                    👤 Reasignar a {peer.name} {peer.role ? `(${peer.role})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notas adicionales */}
          <div className="space-y-2">
            <Label htmlFor="notes">Observaciones / Notas Adicionales</Label>
            <Textarea
              id="notes"
              placeholder="Detalles sobre entrega de caja, llaves o estación de trabajo..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {selectedEmployee && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong>Acciones automáticas al confirmar:</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>Se cerrará la sesión de turno de {selectedEmployee.name}.</li>
                  <li>Se creará una aprobación de permiso tipo <em>EARLY_DEPARTURE</em>.</li>
                  <li>Las tareas pendientes serán reasignadas inmediatamente.</li>
                  <li>Se enviará notificación urgente por WhatsApp a la gerencia.</li>
                </ul>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={loading} className="gap-2">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4" />
                  Confirmar y Reasignar
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
