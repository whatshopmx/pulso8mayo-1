"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, CalendarClock, Loader2 } from "lucide-react";

/**
 * Acciones en línea sobre un gasto: marcarlo pagado o moverle el vencimiento.
 *
 * Sólo aplican a gastos operativos: las órdenes de compra y las facturas de
 * procurement no tienen estos endpoints, y ofrecer un botón que va a fallar es
 * peor que no ofrecerlo.
 *
 * Los estados de carga y error son **por fila**: un error global no dice cuál
 * de las seis filas falló, que es justo lo que hace falta saber.
 */

interface Props {
  expenseId: string;
  /** Estado actual: sólo se paga lo aprobado (lo exige también el servicio). */
  status: string;
  /** Fecha mínima admisible para reprogramar (hoy, en la zona de la operación). */
  minDate: string;
  onDone: () => void;
}

export function ExpenseRowActions({ expenseId, status, minDate, onDone }: Props) {
  const [cargando, setCargando] = useState<"pago" | "reprogramar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevaFecha, setNuevaFecha] = useState(minDate);
  const [popoverAbierto, setPopoverAbierto] = useState(false);

  const llamar = async (
    accion: "pago" | "reprogramar",
    url: string,
    body: Record<string, unknown>
  ) => {
    setCargando(accion);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "No se pudo completar la acción.");
        return;
      }
      setPopoverAbierto(false);
      onDone();
    } catch {
      setError("Error de conexión.");
    } finally {
      setCargando(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-1">
        {status === "APPROVED" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={cargando !== null}
            onClick={() => llamar("pago", `/api/expenses/${expenseId}/pay`, {})}
          >
            {cargando === "pago" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            <span className="ml-1">Pagado</span>
          </Button>
        )}

        <Popover open={popoverAbierto} onOpenChange={setPopoverAbierto}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={cargando !== null}
            >
              <CalendarClock className="w-3 h-3" />
              <span className="ml-1">Reprogramar</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="end">
            <p className="text-xs font-medium">Nueva fecha de vencimiento</p>
            <Input
              type="date"
              value={nuevaFecha}
              min={minDate}
              onChange={(e) => setNuevaFecha(e.target.value)}
              className="text-xs"
              aria-label="Nueva fecha de vencimiento"
            />
            <p className="text-xs text-muted-foreground">
              No puede ser anterior a hoy.
            </p>
            <Button
              size="sm"
              className="w-full"
              disabled={cargando !== null}
              onClick={() =>
                llamar("reprogramar", `/api/expenses/${expenseId}/reschedule`, {
                  dueDate: nuevaFecha,
                })
              }
            >
              {cargando === "reprogramar" && (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              )}
              Guardar
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      {/* El error se queda pegado a su fila: uno global no diría cuál falló. */}
      {error && (
        <p className="text-xs text-destructive max-w-[16rem] text-right" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
