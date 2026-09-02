/**
 * Pilar 2 — Employee-domain column cipher adoption (Sprint 2 Track B Task 2).
 *
 * Source: docs/pulso-executive-os-security.md §6.1, §6.3.
 *
 * Wraps `lib/security/column-cipher.ts` for the employee_profiles PII fields.
 * The cipher is text→text (AES-256-GCM, `enc::` prefix), so ONLY text columns
 * are candidates here. Scope note: the security plan's §2.2 inventory also lists
 * `employees.date_of_birth` (timestamp), `employees.address` (jsonb) and
 * `salary_history.previous_salary`/`new_salary` (integer) — those column TYPES
 * cannot host ciphertext without a schema migration to text/bytea, so they are
 * DEFERRED from this slice (tracked as TODO; the text PII fields below are the
 * Sprint 2 adoption set).
 *
 * Encrypted text PII fields (employee_profiles):
 *   SENSITIVE: curp, rfc, nss, personal_email, personal_phone,
 *              emergency_contact_phone, emergency_contact_email
 *   FINANCIAL: clabe, card_number, bank_name
 *
 * Safety model (so adoption cannot break prod by default):
 *   - `decryptProfileRecord` is a TRUE no-op when no field carries the `enc::`
 *     prefix — it does not even resolve the DEK. Reads therefore behave
 *     identically before the backfill runs (plaintext rows) and after (enc::
 *     rows decrypt transparently). It is safe to apply at every reader today.
 *   - `encryptProfileRecord` encrypts non-empty, non-already-`enc::` values.
 *     It is gated behind the `PULSO_ENCRYPT_PII` feature flag (Rule 3); OFF by
 *     default so writes keep storing plaintext until ops run the backfill and
 *     flip the flag (see backfill-encrypt-employees Inngest job).
 *
 * Known limitation (documented, not fixed here): encrypting `personal_email`
 * degrades the employee-search `ilike(personalEmail,…)` branch (ciphertext is
 * not searchable). The OR with name/department/position keeps search working;
 * a blind-index for personalEmail is Sprint 3 search-infrastructure work.
 */
import { DekService } from "./dek";
import {
  encryptColumnWithDek,
  decryptColumnWithDek,
  isEncrypted,
} from "./column-cipher";
import { ENC_PREFIX } from "./dek";

/** employee_profiles text PII field keys (camelCase JS aliases). */
export const EMPLOYEE_PII_FIELDS = [
  "curp",
  "rfc",
  "nss",
  "personalEmail",
  "personalPhone",
  "emergencyContactPhone",
  "emergencyContactEmail",
  "bankName",
  "clabe",
  "cardNumber",
] as const;

export type EmployeePiiField = (typeof EMPLOYEE_PII_FIELDS)[number];

/** Feature flag: when truthy, writes encrypt the PII fields. Default OFF. */
export function isPiiEncryptionEnabled(): boolean {
  return process.env.PULSO_ENCRYPT_PII === "true";
}

/** Shallow-copy `obj` encrypting every present PII text field. No-op when flag OFF. */
export async function encryptProfileRecord<T extends Record<string, unknown>>(
  companyId: string,
  obj: T,
): Promise<T> {
  if (!isPiiEncryptionEnabled()) return obj;
  // Resolve DEK only when at least one present field needs encrypting.
  const needsEncrypt = EMPLOYEE_PII_FIELDS.some((f) => {
    const v = obj[f];
    return typeof v === "string" && v.length > 0 && !v.startsWith(ENC_PREFIX);
  });
  if (!needsEncrypt) return obj;
  const dek = await DekService.getDek(companyId);
  const out: Record<string, unknown> = { ...obj };
  for (const field of EMPLOYEE_PII_FIELDS) {
    const v = out[field];
    if (typeof v === "string" && v.length > 0 && !v.startsWith(ENC_PREFIX)) {
      out[field] = encryptColumnWithDek(v, dek);
    }
  }
  return out as T;
}

/**
 * Versión por lote de `decryptProfileRecord`: un solo desenvuelto del DEK para
 * todas las filas.
 *
 * Existe porque el layout de dispersión de nómina resuelve la CLABE de **cada
 * empleado** de la corrida: llamar a la versión de una fila por empleado hacía
 * una consulta a `tenant_keys` por recibo. Mismo criterio y misma salvedad —es
 * un no-op verdadero cuando ninguna fila trae el prefijo `enc::`.
 */
export async function decryptProfileRecords<T extends Record<string, unknown>>(
  companyId: string,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const anyEncrypted = rows.some((row) =>
    EMPLOYEE_PII_FIELDS.some((f) => isEncrypted(row[f] as string | null | undefined)),
  );
  if (!anyEncrypted) return rows; // plaintext passthrough — no DEK needed

  const dek = await DekService.getDek(companyId);
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const field of EMPLOYEE_PII_FIELDS) {
      out[field] = decryptColumnWithDek(
        (out[field] as string | null | undefined) ?? null,
        dek,
      );
    }
    return out as T;
  });
}

/**
 * Shallow-copy `row`, decrypting any PII field carrying the `enc::` prefix.
 * TRUE no-op (no DEK, no copy) when no field is encrypted — safe to apply at
 * every reader unconditionally.
 */
export async function decryptProfileRecord<T extends Record<string, unknown>>(
  companyId: string,
  row: T,
): Promise<T> {
  let anyEncrypted = false;
  for (const field of EMPLOYEE_PII_FIELDS) {
    if (isEncrypted(row[field] as string | null | undefined)) {
      anyEncrypted = true;
      break;
    }
  }
  if (!anyEncrypted) return row; // plaintext passthrough — no DEK needed
  const dek = await DekService.getDek(companyId);
  const out: Record<string, unknown> = { ...row };
  for (const field of EMPLOYEE_PII_FIELDS) {
    out[field] = decryptColumnWithDek(
      (out[field] as string | null | undefined) ?? null,
      dek,
    );
  }
  return out as T;
}