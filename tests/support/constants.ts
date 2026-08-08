/**
 * Constantes compartidas por los specs E2E.
 *
 * Los IDs provienen de `scripts/seed-constants.ts` (base de desarrollo sembrada
 * con `pnpm seed`). Las credenciales las siembra `pnpm seed:pass`.
 */

export const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

export const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
export const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";
export const BRANCH_ROMA = "b1000001-0000-4000-8000-000000000003";

export const USER_SUPER_ADMIN = "u0000001-0000-4000-8000-000000000001";

/** Credenciales sembradas por `scripts/seed-passwords.ts`. */
export const ADMIN_EMAIL = process.env.E2E_EMAIL || "carlos@pulso.mx";
export const ADMIN_PASSWORD = process.env.E2E_PASSWORD || "123456";

/** Estado de sesión reutilizado por todos los specs. */
export const STORAGE_STATE = "tests/.auth/admin.json";

/**
 * Prefijo con el que se nombran todos los registros creados por los tests, para
 * poder limpiarlos sin tocar los datos sembrados.
 */
export const E2E_TAG = "[E2E]";
