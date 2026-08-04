/**
 * Pilar 2 — Key Encryption Key (KEK) resolution.
 *
 * Source: docs/pulso-executive-os-security.md §6.3 (KMS).
 *
 * Hierarchy:
 *   KEK (env var PULSO_KEK, never persisted)  ──┐
 *                                                ├─→ decrypts per-tenant DEK
 *   DEK (table tenant_keys.encrypted_dek)     ──┘    → encrypts classified columns
 *
 * Sprint Sec-0 only ships the resolution guard: no encryption is performed yet
 * (no columns have been migrated to `enc::` ciphertext). The first consumer
 * is the column cipher + DEK population scheduled in Sprint 1/2.
 *
 * Fail-closed: in production a missing or short KEK throws at boot rather than
 * silently degrading to plaintext. In dev/test we fall back to a throwaway key
 * so the app still boots without secrets.
 */
export const PULSO_KEK_ENV = "PULSO_KEK";

/** Minimum entropy we accept for a production KEK (32 bytes base64 ≈ 44 chars). */
const MIN_KEK_LENGTH = 32;

export function resolveKek(): string {
  const kek = process.env[PULSO_KEK_ENV];
  const isProd = process.env.NODE_ENV === "production";
  const hasKek = typeof kek === "string" && kek.length >= MIN_KEK_LENGTH;

  if (hasKek) return kek!;

  if (isProd) {
    throw new Error(
      `[security] ${PULSO_KEK_ENV} is missing or shorter than ${MIN_KEK_LENGTH} chars. ` +
        `Column-level encryption (Pilar 2) cannot run without a KEK. Set ${PULSO_KEK_ENV} ` +
        `(32+ random bytes, base64) before starting the app in production.`,
    );
  }

  // Dev/test throwaway KEK — never used for real data, only so the app boots.
  return "dev-only-insecure-kek-do-not-use-in-production-0123456789ab";
}

/** True when a real (non-dev-fallback) KEK is configured. Used by health checks. */
export function isKekConfigured(): boolean {
  const kek = process.env[PULSO_KEK_ENV];
  return typeof kek === "string" && kek.length >= MIN_KEK_LENGTH;
}