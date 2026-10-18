/**
 * Estado operativo de un corte de ventas (registro de cortes).
 *
 * El registro diario acumula muchas filas; la celda de conciliación apilaba
 * formas de pago, arqueo y terminal en ~8 líneas por renglón, lo que hace la
 * lista inservible a escala de cadena (15 sucursales × 2 turnos × 30 días).
 *
 * Este módulo resume **qué necesita atención** en un solo estado, para que la
 * lista sea escaneable y el detalle viva en un panel. Puro y sin React para
 * probar la precedencia directamente: el efectivo faltante manda sobre la
 * diferencia de terminal, porque es dinero que desapareció de la caja y no un
 * depósito que aún no llega.
 */
import { formatCents } from "@/lib/utils";
import { computeCashVariance, computeTpvVariance } from "./cash-variance";

export type CutStatusTone = "ok" | "warning" | "danger" | "pending";

export type CutStatusKind =
  | "cuadrado"
  | "faltante_caja"
  | "sobrante_caja"
  | "diferencia_terminal"
  | "observacion"
  | "sin_conciliar";

export interface CutStatus {
  kind: CutStatusKind;
  tone: CutStatusTone;
  /** Texto del chip. */
  label: string;
  /** Contexto corto: de dónde viene la diferencia. */
  detail?: string;
  /** `true` cuando hay una diferencia que exige revisión (no sólo falta de dato). */
  needsAttention: boolean;
}

export interface CutStatusInput {
  status: "VALIDATED" | "PENDING_REVIEW";
  cashSales: number | null;
  cashCountedCents: number | null;
  cardSales: number | null;
  tpvDepositCents: number | null;
  commissionCents: number | null;
}

/**
 * Precedencia:
 *   1. Diferencia de **caja** (dinero contado ≠ declarado) — lo más grave.
 *   2. Diferencia de **terminal** (depósito + comisión ≠ venta con tarjeta).
 *   3. Corte en `PENDING_REVIEW` (observación del ingest).
 *   4. Tarjeta declarada **sin depósito capturado** → sin conciliar (no es error:
 *      las terminales liquidan con rezago).
 *   5. Todo lo demás → cuadrado.
 */
export function cutStatus(cut: CutStatusInput): CutStatus {
  const arqueo = computeCashVariance(cut);
  if (arqueo && arqueo.direction !== "cuadrado") {
    const faltante = arqueo.direction === "faltante";
    return {
      kind: faltante ? "faltante_caja" : "sobrante_caja",
      tone: faltante ? "danger" : "warning",
      label: `${faltante ? "Faltan" : "Sobran"} ${formatCents(Math.abs(arqueo.varianceCents))}`,
      detail: "Caja (arqueo)",
      needsAttention: true,
    };
  }

  const tpv = computeTpvVariance(cut);
  if (tpv && tpv.direction !== "cuadrado") {
    const faltante = tpv.direction === "faltante";
    return {
      kind: "diferencia_terminal",
      tone: "warning",
      label: `Terminal: ${faltante ? "faltan" : "sobran"} ${formatCents(Math.abs(tpv.varianceCents))}`,
      detail: tpv.commissionCaptured ? "Terminal (TPV)" : "incluye comisión sin capturar",
      needsAttention: true,
    };
  }

  if (cut.status === "PENDING_REVIEW") {
    return {
      kind: "observacion",
      tone: "warning",
      label: "Observación",
      detail: "Requiere revisión",
      needsAttention: true,
    };
  }

  if (cut.cardSales !== null && cut.cardSales > 0 && cut.tpvDepositCents === null) {
    return {
      kind: "sin_conciliar",
      tone: "pending",
      label: "Sin conciliar",
      detail: "Falta depósito de terminal",
      needsAttention: false,
    };
  }

  return { kind: "cuadrado", tone: "ok", label: "Cuadrado", needsAttention: false };
}

/** Clases del chip por tono, alineadas a los tokens de estado. */
export function cutStatusChipClass(tone: CutStatusTone): string {
  switch (tone) {
    case "danger":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "warning":
      return "bg-warning/10 text-warning-text border-warning/20";
    case "pending":
      return "bg-muted text-muted-foreground border-border";
    case "ok":
    default:
      // El caso normal no se pinta de verde: repetir un color en cada fila
      // entrena a ignorarlo. El color queda para la excepción.
      return "bg-transparent text-muted-foreground border-transparent";
  }
}
