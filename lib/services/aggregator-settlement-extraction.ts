/**
 * Extracción de una liquidación de plataforma desde los pasos de un workflow.
 *
 * El workflow semanal de conciliación ("Conciliación Semanal de Plataformas")
 * captura el resumen que manda cada agregador. Al completarse, su acción de
 * cierre necesita convertir esos pasos en el input de
 * `createAndReconcileAggregatorSettlement`. Eso es lo que hace este módulo.
 *
 * Puro y sin DB: los valores de paso llegan como `jsonb` con formas distintas
 * (número, string con comillas, foto como URL o como objeto), así que la
 * normalización es justo lo que conviene probar sin levantar Postgres.
 */
import { parseMoneyToCents } from "./pos-column-aliases";
import { normalizeSettlementChannel } from "./aggregator-settlement-rules";

export interface WorkflowStepValue {
  stepId: string;
  value: unknown;
}

export interface ExtractedAggregatorSettlement {
  channel: string;
  periodStart: string;
  periodEnd: string;
  grossSalesCents: number;
  commissionCents: number;
  netDepositedCents: number;
  evidenceUrls: string[];
  notes: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Texto limpio: recorta y quita las comillas con que el motor serializa strings. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^"+|"+$/g, "");
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** `YYYY-MM-DD`; acepta un ISO datetime y se queda con el día. */
function asDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const day = text.slice(0, 10);
  return DATE_RE.test(day) ? day : null;
}

/** Dinero en centavos: limpia las comillas del motor y acepta formato MX. */
function asMoney(value: unknown): number | null {
  const text = asText(value);
  if (text === null) return null;
  return parseMoneyToCents(text);
}

/** Las fotos pueden venir como URL, arreglo de URLs u objeto `{ url }`. */
function asEvidenceUrls(value: unknown): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") {
      const t = v.trim().replace(/^"+|"+$/g, "");
      if (t) urls.push(t);
      return;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const url = o.url ?? o.evidenceUrl ?? o.value;
      if (typeof url === "string" && url.trim()) urls.push(url.trim());
    }
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return urls;
}

/**
 * Devuelve la liquidación capturada, o `null` si el workflow no trae lo mínimo
 * para conciliar (canal y periodo). El llamador decide qué hacer con `null`:
 * sin canal no hay contra qué comparar, así que no se inventa una liquidación.
 */
export function extractAggregatorSettlement(
  steps: WorkflowStepValue[],
): ExtractedAggregatorSettlement | null {
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const value = (stepId: string) => byId.get(stepId)?.value;

  const channelRaw = asText(value("paso-canal"));
  if (!channelRaw) return null;
  const channel = normalizeSettlementChannel(channelRaw);

  const periodStart = asDate(value("paso-periodo-inicio"));
  const periodEnd = asDate(value("paso-periodo-fin"));
  if (!periodStart || !periodEnd) return null;
  if (periodStart > periodEnd) return null;

  const grossSalesCents = asMoney(value("paso-venta-bruta"));
  const netDepositedCents = asMoney(value("paso-neto"));
  if (grossSalesCents === null || netDepositedCents === null) return null;

  // La comisión es opcional: una plataforma sin cargo por transacción captura 0.
  const commissionCents = asMoney(value("paso-comision")) ?? 0;

  return {
    channel,
    periodStart,
    periodEnd,
    grossSalesCents,
    commissionCents,
    netDepositedCents,
    evidenceUrls: asEvidenceUrls(value("paso-evidencia")),
    notes: asText(value("paso-notas")),
  };
}
