/**
 * Pilar 2 §6.2 — Response masking for classified (PII) fields.
 *
 * Source: docs/pulso-executive-os-security.md §6.2.
 *
 * `maskSensitive(obj, decision)` redacts the PII fields that appear in a
 * serialized API response when the ABAC `AccessDecision` flagged redaction
 * (decision.redactFields populated — the FINANCIAL allow+redact path for
 * non-gate roles, set in lib/rbac/abac.ts slice 1).
 *
 * Domain scoping (important): `decision.redactFields` is populated from
 * `FINANCIAL_FIELDS` (lib/db/schema/classification.ts), which mixes genuine PII
 * (clabe, card_number, bank_name, curp, rfc, nss, personal_email,
 * personal_phone, emergency_contact_*) with legitimate aggregate financial
 * metrics (base_salary, monthly_salary, weekly_salary, projected_cash_flow_cents,
 * upcoming_obligations_cents). Masking the aggregates would defeat the purpose
 * of a GERENTE reading the cash-flow / pnl / kpis routes — those figures ARE the
 * data they need. So this module only knows maskers for the PII FIELDS, and any
 * redactFields entry that is not a PII field (i.e. an aggregate metric with no
 * masker registered) is left untouched. Net effect today on the migrated
 * aggregate routes (cash-flow/pnl/kpis/control-interno/fiscal): they return no
 * PII keys, so masking is a no-op — plaintext-equivalent (matches the slice 1
 * gate-refine guarantee). Masking becomes observable once an employee-bearing
 * FINANCIAL/SENSITIVE route is wired in Sprint 3 (HR).
 *
 * Gate roles (SUPER_ADMIN/OWNER/ADMIN) receive an empty redactFields → no
 * masking → plaintext, per §6.2.
 */
import type { AccessDecision } from "./abac";

type Masker = (value: string) => string;

/** Keep the last 4 chars, mask the rest. For clabe/card_number/nss/phone. */
function maskLast4(value: string): string {
  if (value.length <= 4) return "****";
  return "****" + value.slice(-4);
}

/** RFC/CURP: keep first 4 + '***' + tail. */
function maskIdDoc(value: string, tailLen: number): string {
  if (value.length <= 4) return "****";
  const head = value.slice(0, 4);
  const tail = value.slice(-tailLen);
  return `${head}***${tail}`;
}

/** Email mask: first char + ***@domain. */
function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return "****";
  const local = value.slice(0, 1);
  const domain = value.slice(at);
  return `${local}***${domain}`;
}

/**
 * PII field maskers, keyed by the DB snake_case column name (the canonical key
 * in classification.ts). Response objects may use camelCase JS aliases; the
 * masker lookup normalizes the response key to snake_case before matching.
 */
const PII_MASKERS: Record<string, Masker> = {
  // FINANCIAL bank PII
  clabe: maskLast4,
  card_number: maskLast4,
  bank_name: () => "****",
  // SENSITIVE identity PII
  curp: (v) => maskIdDoc(v, 2),
  rfc: (v) => maskIdDoc(v, 3),
  nss: maskLast4,
  personal_email: maskEmail,
  personal_phone: maskLast4,
  emergency_contact_phone: maskLast4,
};

/** camelCase → snake_case (matches the classification DB column names). */
function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Redact PII fields present in `obj` when `decision.redactFields` is non-empty
 * (the FINANCIAL allow+redact path). Returns a shallow copy; fields with no PII
 * masker (aggregate metrics) and gate-role decisions (empty redactFields) are
 * returned verbatim. Non-string PII values are passed through (only strings are
 * masked — the text PII fields are all text).
 */
export function maskSensitive<T>(
  obj: T,
  decision: AccessDecision,
): T {
  if (!decision.redactFields || decision.redactFields.length === 0) {
    return obj; // gate role — plaintext
  }
  // Redaction is active → mask every PII field (with a registered masker) that
  // appears in the response, regardless of which specific aggregate names were
  // listed in redactFields (the lists are data-driven and broad; the PII masker
  // set is the authoritative "what gets redacted" table).
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    const snake = toSnake(key);
    const masker = PII_MASKERS[snake] ?? PII_MASKERS[key];
    if (!masker) continue;
    const v = out[key];
    if (typeof v === "string" && v.length > 0) {
      out[key] = masker(v);
    }
  }
  return out as T;
}

/**
 * Apply masking across a list of rows (list APIs). Each row is masked
 * independently with the same decision.
 */
export function maskSensitiveList<T>(
  rows: T[],
  decision: AccessDecision,
): T[] {
  if (!decision.redactFields || decision.redactFields.length === 0) return rows;
  return rows.map((row) => maskSensitive(row, decision));
}

export { PII_MASKERS };