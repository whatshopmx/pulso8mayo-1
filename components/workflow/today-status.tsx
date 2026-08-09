"use client";

import { CheckCircle2, Clock, AlertTriangle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodayItemState } from "@/lib/workflows/today";

/**
 * Vocabulario de estado del tablero de hoy.
 *
 * Cada estado lleva icono Y palabra: el color nunca es el único portador del
 * significado, ni en pantalla ni bajo el reflejo del sol en una tablet.
 *
 * El rojo queda reservado para VENCIDO. En esta página rojo significa una sola
 * cosa, que es lo que lo hace legible de un vistazo.
 */
export const TODAY_STATE: Record<TodayItemState, {
    label: string;
    Icon: typeof CheckCircle2;
    text: string;
    dot: string;
}> = {
    VENCIDO: {
        label: "Vencido",
        Icon: AlertTriangle,
        text: "text-destructive",
        dot: "bg-destructive",
    },
    EN_CURSO: {
        label: "En curso",
        Icon: Clock,
        text: "text-foreground",
        dot: "bg-foreground/40",
    },
    PENDIENTE: {
        label: "Pendiente",
        Icon: Circle,
        text: "text-muted-foreground",
        dot: "bg-muted-foreground/40",
    },
    HECHO: {
        label: "Hecho",
        Icon: CheckCircle2,
        text: "text-emerald-600 dark:text-emerald-500",
        dot: "bg-emerald-600 dark:bg-emerald-500",
    },
};

/**
 * Bandas de turno. Los valores vienen de `assigned_shifts`, que el editor
 * escribe como morning/afternoon/night/all (workflow-settings-modal).
 * `all`, vacío o cualquier valor desconocido cae en una banda sin nombre.
 */
export const SHIFT_BANDS: { key: string; label: string }[] = [
    { key: "morning", label: "Matutino" },
    { key: "afternoon", label: "Vespertino" },
    { key: "night", label: "Nocturno" },
];

export function shiftBandKey(shift: string | null): string {
    if (!shift) return "sin-turno";
    const normalized = shift.trim().toLowerCase();
    return SHIFT_BANDS.some((b) => b.key === normalized) ? normalized : "sin-turno";
}

export function TodayStateBadge({
    state,
    detail,
    className,
}: {
    state: TodayItemState;
    /** Texto extra, p. ej. la hora en que se completó. */
    detail?: string | null;
    className?: string;
}) {
    const config = TODAY_STATE[state];
    return (
        <span className={cn("inline-flex items-center gap-1.5 text-sm", config.text, className)}>
            <config.Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="font-medium">{config.label}</span>
            {detail && <span className="text-muted-foreground font-normal">{detail}</span>}
        </span>
    );
}

/**
 * Avance de una sucursal. `role="img"` con etiqueta: un lector de pantalla
 * anuncia "6 de 8 completados", no una hilera de divs.
 */
export function TodayProgress({ done, expected }: { done: number; expected: number }) {
    const pct = expected === 0 ? 0 : Math.round((done / expected) * 100);
    return (
        <div className="flex items-center gap-2">
            <div
                className="h-1.5 w-20 rounded-full bg-muted overflow-hidden"
                role="img"
                aria-label={`${done} de ${expected} completados`}
            >
                <div
                    className={cn("h-full rounded-full transition-all", done === expected ? "bg-emerald-600 dark:bg-emerald-500" : "bg-foreground/50")}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
                {done}/{expected}
            </span>
        </div>
    );
}
