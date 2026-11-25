"use client";

import { Button } from "@/components/ui/button";
import { Save, Loader2, RotateCcw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface OperatingConfigStickyBarProps {
  isDirty: boolean;
  loading: boolean;
  disabled: boolean;
  onReset: () => void;
  /** Por qué no se puede guardar todavía; se nombra el campo cuando se puede. */
  disabledMessage?: string;
}

/**
 * Barra de guardado de esta sección.
 *
 * La página tiene cinco guardados independientes (umbrales, canales, matriz de
 * compras, solicitud y emisión). El texto de la barra nombra sólo lo que este
 * formulario escribe; antes prometía «aplicar las nuevas políticas al grupo» y
 * un operador podía creer que la matriz de compras ya había quedado guardada.
 */
export function OperatingConfigStickyBar({
  isDirty,
  loading,
  disabled,
  onReset,
  disabledMessage = "Corrige las inconsistencias antes de guardar.",
}: OperatingConfigStickyBarProps) {
  const bloqueado = disabled || !isDirty;

  return (
    <div
      className={cn(
        "sticky bottom-4 z-40 flex flex-col items-center justify-between gap-3 rounded-xl border bg-card p-4 transition-colors sm:flex-row",
        isDirty ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
      )}
    >
      <div className="flex items-center gap-2.5 text-xs">
        {isDirty ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
            <span className="font-semibold text-foreground">
              Cambios sin guardar en umbrales y parámetros
            </span>
            <span className="hidden text-muted-foreground md:inline">
              — Las demás tarjetas se guardan por separado.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            <span>Umbrales y parámetros sincronizados</span>
          </div>
        )}
      </div>

      <div className="flex w-full items-center justify-end gap-2.5 sm:w-auto">
        {isDirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={loading}
            className="h-11 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Descartar cambios
          </Button>
        )}

        <Button
          type="submit"
          size="sm"
          disabled={loading}
          aria-disabled={bloqueado}
          aria-describedby={disabled && isDirty ? "config-save-reason" : undefined}
          className="h-11 px-4 text-xs font-semibold aria-disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Guardando…
            </>
          ) : (
            <>
              <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Guardar umbrales y parámetros
            </>
          )}
        </Button>
      </div>

      {disabled && isDirty && (
        <div
          id="config-save-reason"
          role="status"
          aria-live="polite"
          className="flex w-full items-center gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{disabledMessage}</span>
        </div>
      )}
    </div>
  );
}
