/**
 * Pilar 2 — Data Encryption Key (DEK) lifecycle for a tenant.
 *
 * Source: docs/pulso-executive-os-security.md §6.3 (KMS).
 *
 * Hierarchy:
 *   KEK (env PULSO_KEK, never persisted) ── wraps ──→ DEK (per company, in
 *   `tenant_keys.encrypted_dek`) ── encrypts ──→ classified columns.
 *
 * Sprint 1 scaffold: `ensureDek(companyId)` creates a DEK for a company if one
 * does not exist, wraps it with the KEK (AES-256-GCM), and stores the envelope
 * in `tenant_keys`. `getDek(companyId)` unwraps it in runtime. No column is
 * encrypted yet — Sprint 2 calls these from the Drizzle column-cipher layer
 * for `employees.clabe`, `card_number`, `salary_history.*` (docs §6.1).
 *
 * Wire format for `tenant_keys.encrypted_dek`:
 *   base64( iv(12) || ciphertext || tag(16) )   ← AES-256-GCM of the 32-byte DEK
 * The KEK is stretched to 32 bytes via SHA-256 so any ≥32-char env value works.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { tenantKeys } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { resolveKek } from "./kek";

const IV_LEN = 12;
const KEY_LEN = 32; // AES-256
const TAG_LEN = 16;

const ENC_PREFIX = "enc::";

function kekToAesKey(kek: string): Buffer {
  // SHA-256 → 32 bytes. Keeps the KEK usage stable regardless of input length.
  return createHash("sha256").update(kek).digest();
}

/** AES-256-GCM wrap a 32-byte DEK with the KEK → base64 envelope. */
function wrapDek(dek: Buffer, kek: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", kekToAesKey(kek), iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/** Inverse of `wrapDek`: returns the raw 32-byte DEK. */
function unwrapDek(envelopeB64: string, kek: string): Buffer {
  const buf = Buffer.from(envelopeB64, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", kekToAesKey(kek), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export const DekService = {
  /** Create a DEK for a company if none exists. Idempotent. */
  async ensureDek(companyId: string): Promise<void> {
    const existing = await db.query.tenantKeys.findFirst({
      where: eq(tenantKeys.companyId, companyId),
    });
    if (existing) return;
    const kek = resolveKek();
    const dek = randomBytes(KEY_LEN);
    await db.insert(tenantKeys).values({
      companyId,
      encryptedDek: wrapDek(dek, kek),
      dekVersion: 1,
    });
  },

  /** Unwrap the latest DEK for a company. Throws if none exists. */
  async getDek(companyId: string): Promise<Buffer> {
    const row = await db.query.tenantKeys.findFirst({
      where: eq(tenantKeys.companyId, companyId),
    });
    if (!row) {
      throw new Error(
        `[security] No DEK for company ${companyId}. Call ensureDek() first.`,
      );
    }
    return unwrapDek(row.encryptedDek, resolveKek());
  },

  /** Rotate a company's DEK (re-wrap a fresh key; column re-encrypt is Sprint 2). */
  async rotateDek(companyId: string): Promise<void> {
    const kek = resolveKek();
    const dek = randomBytes(KEY_LEN);
    await db
      .update(tenantKeys)
      .set({
        encryptedDek: wrapDek(dek, kek),
        dekVersion: 1, // bumped per rotation; track history in a later slice
        rotatedAt: new Date(),
      })
      .where(eq(tenantKeys.companyId, companyId));
  },

  /** Is a DEK provisioned for this company? */
  async hasDek(companyId: string): Promise<boolean> {
    const row = await db.query.tenantKeys.findFirst({
      where: eq(tenantKeys.companyId, companyId),
      columns: { companyId: true },
    });
    return !!row;
  },
} as const;

export { ENC_PREFIX };