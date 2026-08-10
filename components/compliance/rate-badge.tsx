import { Badge } from "@/components/ui/badge";

/**
 * RateBadge — dueño único de los umbrales de cumplimiento (D3, capa 2).
 *
 * Toda representación visual de un "compliance rate" en la superficie de
 * cumplimiento pasa por aquí: ≥90 → success/"Excelente", ≥70 →
 * warning/"Bueno", <70 → destructive/"Crítico". Sin fuente → "Sin datos"
 * (D2). NO introducir umbrales hardcodeados en otros archivos.
 */

export type RateTier = "high" | "mid" | "low";

/** Única definición de umbrales. Badges, colores de charts y labels derivan de aquí. */
export function getRateTier(rate: number): RateTier {
    if (rate >= 90) return "high";
    if (rate >= 70) return "mid";
    return "low";
}

const TIER_VARIANT = {
    high: "success",
    mid: "warning",
    low: "destructive",
} as const;

export function getRateBadgeVariant(tier: RateTier): "success" | "warning" | "destructive" {
    return TIER_VARIANT[tier];
}

const TIER_COLOR = {
    high: "oklch(0.60 0.16 150)",
    mid: "oklch(0.72 0.15 80)",
    low: "oklch(0.50 0.22 22)",
} as const;

export function getRateColor(tier: RateTier): string {
    return TIER_COLOR[tier];
}

const TIER_CLASSES = {
    high: "text-success bg-success/10 border-success/20",
    mid: "text-warning-text bg-warning/10 border-warning/20",
    low: "text-destructive bg-destructive/10 border-destructive/20",
} as const;

export function getRateClasses(tier: RateTier): string {
    return TIER_CLASSES[tier];
}

const TIER_TEXT_CLASS = {
    high: "text-success",
    mid: "text-warning-text",
    low: "text-destructive",
} as const;

export function getRateTextClass(tier: RateTier): string {
    return TIER_TEXT_CLASS[tier];
}

const TIER_PROGRESS_CLASSES = {
    high: "bg-success",
    mid: "bg-warning",
    low: "bg-destructive",
} as const;

export function getRateProgressClasses(tier: RateTier): string {
    return TIER_PROGRESS_CLASSES[tier];
}

const TIER_LABEL = {
    high: "Excelente",
    mid: "Bueno",
    low: "Crítico",
} as const;

interface RateBadgeProps {
    rate: number | null | undefined;
    /** Muestra la etiqueta cualitativa junto al número. Default: true. */
    showLabel?: boolean;
    className?: string;
}

export function RateBadge({ rate, showLabel = true, className }: RateBadgeProps) {
    if (rate === null || rate === undefined || Number.isNaN(rate)) {
        return (
            <Badge variant="outline" className={className}>
                Sin datos
            </Badge>
        );
    }

    const tier = getRateTier(rate);
    return (
        <Badge variant={TIER_VARIANT[tier]} className={className}>
            {showLabel ? `${TIER_LABEL[tier]} · ${rate}%` : `${rate}%`}
        </Badge>
    );
}

