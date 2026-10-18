/**
 * Desglose por plataforma de un corte (Fase 2/3).
 *
 * Une los dos orígenes del mismo dato:
 *  - campos fijos heredados del formulario de corte (`rappi`, `uber`, `didi`);
 *  - el mapa que producen los pasos dinámicos `paso-plataformas-<canal>`, uno
 *    por plataforma activa.
 *
 * Sólo se guardan los canales con monto > 0: un cero no es un dato, y no se
 * inventan llaves para plataformas que no vendieron. Las llaves dinámicas se
 * normalizan a la canónica porque el formulario manda el label del paso.
 */
import { normalizeSettlementChannel } from "@/lib/services/aggregator-settlement-rules";

export interface AggregatorSalesInput {
  rappi?: number;
  uber?: number;
  didi?: number;
  /** canal (o label) → centavos. */
  plataformas?: Record<string, number>;
}

export function buildAggregatorSalesMap(
  input: AggregatorSalesInput,
): Record<string, number> | null {
  const out: Record<string, number> = {};

  const legado = [
    ["rappi", input.rappi],
    ["uber", input.uber],
    ["didi", input.didi],
  ] as const;
  for (const [key, cents] of legado) {
    if ((cents ?? 0) > 0) out[key] = cents!;
  }

  for (const [rawKey, cents] of Object.entries(input.plataformas ?? {})) {
    if (cents > 0) out[normalizeSettlementChannel(rawKey)] = cents;
  }

  return Object.keys(out).length > 0 ? out : null;
}
