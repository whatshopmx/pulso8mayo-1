/**
 * Pilar 2 — Column-level cipher for classified PII/financial fields.
 *
 * Source: docs/pulso-executive-os-security.md §6.1, §6.3.
 *
 * Format persisted to the column: `enc::<base64(iv(12) || ciphertext || tag(16))>`
 * — AES-256-GCM with a per-value IV. The `enc::` prefix lets `decryptColumn`
 * transparently handle legacy plaintext rows (no prefix ⇒ return as-is), so
 * the Sprint 2 backfill can run incrementally without a flag day.
 *
 * The DEK is resolved per company via `DekService` (lib/security/dek.ts). Call
 * sites that touch several columns of the same row should resolve the DEK once
 * and use the `*WithDek` variants to avoid N+1 unwraps.
 *
 * Sprint 1 scaffold: NO column is wired to this yet. Sprint 2 migrates
 * `employees.clabe`, `card_number`, `salary_history.*`, `cfdi_invoices.*` and
 * ships the backfill Inngest job + masking middleware (docs §10 Sprint 2 row).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DekService } from "./dek";
import { ENC_PREFIX } from "./dek";

const IV_LEN = 12;

function dekToAesKey(dek: Buffer): Buffer {
  // DEK is already 32 bytes (see dek.ts); pass through. Buffer.subarray keeps
  // it 32 bytes without copying when dek is exactly KEY_LEN.
  return dek.length === 32 ? dek : dek.subarray(0, 32);
}

/** Encrypt a plaintext string with a resolved DEK → "enc::<base64>". */
export function encryptColumnWithDek(plaintext: string, dek: Buffer): string {
  const iv = createIv();
  const cipher = createCipheriv("aes-256-gcm", dekToAesKey(dek), iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, ct, tag]).toString("base64");
}

/** Decrypt a column value. Legacy plaintext (no `enc::` prefix) passes through. */
export function decryptColumnWithDek(value: string | null, dek: Buffer): string | null {
  if (value == null) return null;
  if (!value.startsWith(ENC_PREFIX)) return value; // legacy plaintext
  const buf = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(IV_LEN, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", dekToAesKey(dek), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ct),
    decipher.final(),
  ]).toString("utf8");
}

/** Convenience: resolve the DEK for a company then encrypt. */
export async function encryptColumn(companyId: string, plaintext: string): Promise<string> {
  const dek = await DekService.getDek(companyId);
  return encryptColumnWithDek(plaintext, dek);
}

/** Convenience: resolve the DEK for a company then decrypt. */
export async function decryptColumn(companyId: string, value: string | null): Promise<string | null> {
  const dek = await DekService.getDek(companyId);
  return decryptColumnWithDek(value, dek);
}

/** Is a stored value already encrypted (has the `enc::` prefix)? */
export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENC_PREFIX);
}

// Minimal IV helper. randomBytes imported at top for lint compliance.
function createIv(): Buffer {
  return randomBytes(IV_LEN);
}