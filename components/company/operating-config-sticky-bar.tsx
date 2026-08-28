"use client";

import { Button } from "@/components/ui/button";
import { Save, Loader2, RotateCcw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface OperatingConfigStickyBarProps {
  isDirty: boolean;
  loading: boolean;
  disabled: boolean;
  onReset: () => void;
}

export function OperatingConfigStickyBar({
  isDirty,
  loading,
  disabled,
  onReset,
}: OperatingConfigStickyBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-4 z-40 p-4 rounded-xl border transition-all duration-300 backdrop-blur-md shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3",
        isDirty
          ? "bg-card/95 border-primary/40 ring-1 ring-primary/20"
          : "bg-card/80 border-border/80"
      )}
    >
      <div className="flex items-center gap-2.5 text-xs">
        {isDirty ? (
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
            </span>
            <span className="font-semibold text-foreground">
              Tienes cambios sin guardar
            </span>
            <span className="text-muted-foreground hidden md:inline">
              — Guarda para aplicar las nuevas políticas al grupo
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500/70" />
            <span>Configuración sincronizada con base de datos</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
        {isDirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground h-9"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Descartar Cambios
          </Button>
        )}

        <Button
          type="submit"
          size="sm"
          disabled={loading || disabled || !isDirty}
          className="text-xs font-semibold h-9 px-4"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Guardando...
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5 mr-1.5" /> Guardar Configuración
            </>
          )}
        </Button>
      </div>

      {disabled && isDirty && (
        <div className="w-full sm:hidden flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3 h-3" />
          <span>Corrige las inconsistencias en los objetivos de costo para guardar.</span>
        </div>
      )}
    </div>
  );
}
