/**
 * Data Classification metadata — Pilar 2 (Cifrado) / Pilar 3 (LFPDPPP).
 *
 * This module is NOT a database table. It is declarative metadata consumed by:
 *  - `evaluateAccess` (ABAC, Pilar 1) — gates SENSITIVE/FINANCIAL reads by role.
 *  - `masking` middleware (Pilar 2) — redacts fields in API responses.
 *  - `dataAccessLogs` (§9) — records READ of classified fields.
 *  - `cron-data-retention` (Pilar 3, Art. 16 LFPDPPP) — suppression targets.
 *
 * Source of truth: docs/pulso-executive-os-security.md §2.2 (inventario de datos
 * sensibles) y §7.1. Field names map 1:1 to Drizzle column names (snake_case
 * DB names, not the camelCase JS aliases).
 */

export type DataClassification =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'PERSONAL'
  | 'SENSITIVE'
  | 'FINANCIAL';

/**
 * Tables → list of DB column names that carry classified data.
 *
 * Why DB (snake_case) names: classification is matched at the data layer
 * (RLS, audit, masking) where raw row keys are snake_case. Components that
 * read serialized JS objects should map via the Drizzle alias.
 */
export const SENSITIVE_FIELDS: Record<string, readonly string[]> = {
  employees: [
    'curp',
    'rfc',
    'nss',
    'date_of_birth',
    'personal_email',
    'personal_phone',
    'address',
    'emergency_contact_phone',
    'emergency_contact_email',
  ],
  salary_history: ['previous_salary', 'new_salary'],
  cfdi_invoices: ['rfc_emisor', 'rfc_receptor'],
} as const;

export const FINANCIAL_FIELDS: Record<string, readonly string[]> = {
  employees: ['clabe', 'card_number', 'bank_name', 'base_salary', 'monthly_salary', 'weekly_salary'],
  salary_history: ['previous_salary', 'new_salary'],
  cfdi_invoices: ['rfc_emisor', 'rfc_receptor'],
  corporate_twins: ['projected_cash_flow_cents', 'upcoming_obligations_cents'],
} as const;

/** All fields that require encryption-at-rest (Pilar 2). SENSITIVE ∪ FINANCIAL. */
export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = mergeClassified(
  SENSITIVE_FIELDS,
  FINANCIAL_FIELDS,
);

/** Lookup: is a given column classified at or above the given level? */
export function classifyField(
  table: string,
  column: string,
): DataClassification | null {
  if (SENSITIVE_FIELDS[table]?.includes(column)) return 'SENSITIVE';
  if (FINANCIAL_FIELDS[table]?.includes(column)) return 'FINANCIAL';
  return null;
}

/** Roles permitted to read SENSITIVE/FINANCIAL data (Pilar 1 gate). */
export const SENSITIVE_GATE_ROLES = new Set([
  'SUPER_ADMIN',
  'OWNER',
  'ADMIN',
  // 'HR' is referenced by the security plan but is not yet in the DB role enum;
  // it is added in Sprint 3 together with mandatory 2FA. See docs §5.3.
]);

function mergeClassified(
  a: Record<string, readonly string[]>,
  b: Record<string, readonly string[]>,
): Record<string, readonly string[]> {
  const out: Record<string, string[]> = {};
  for (const [t, cols] of Object.entries(a)) (out[t] ??= []).push(...cols);
  for (const [t, cols] of Object.entries(b)) (out[t] ??= []).push(...cols);
  return out;
}