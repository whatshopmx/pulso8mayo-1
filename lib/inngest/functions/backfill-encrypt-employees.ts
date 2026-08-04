/**
 * Inngest — Backfill employee_profiles PII columns to ciphertext (Sprint 2
 * Track B Task 2).
 *
 * Source: docs/pulso-executive-os-security.md §6.3 (chunked backfill).
 *
 * Event-triggered (`pii/employees.backfill`), NOT a cron — ops runs it once per
 * company after verifying the decrypt-on-read adoption is in place, then flips
 * `PULSO_ENCRYPT_PII=true` so future writes encrypt. The job is idempotent:
 * rows whose fields already carry the `enc::` prefix are skipped, so a retry
 * (or a second dispatch) never double-encrypts.
 *
 * Model: lib/inngest/functions/incident-escalation.ts + weekly-insights.ts
 * (chunked step.run pattern). Batches of 1000 rows per step; each company runs
 * in its own memoized step so one failure does not block the rest.
 *
 * Non-text fields (date_of_birth timestamp, address jsonb, salary_history
 * integer salaries) are out of scope here — they need a column type migration
 * to host ciphertext (tracked as TODO, deferred from this slice).
 */
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { employeeProfiles, users, companies } from "@/lib/db/schema";
import { eq, sql, isNull, or, isNotNull, and } from "drizzle-orm";
import { DekService, ENC_PREFIX } from "@/lib/security/dek";
import { encryptColumnWithDek } from "@/lib/security/column-cipher";
import { EMPLOYEE_PII_FIELDS } from "@/lib/security/employee-cipher";

const BATCH_SIZE = 1000;

interface BackfillRow {
  id: string;
  userId: string;
  [field: string]: unknown;
}

/** Columns to read + potentially encrypt (text PII). */
const PII_COLUMNS = EMPLOYEE_PII_FIELDS;

/** Does this row still carry any plaintext PII value? */
function hasPlaintextPii(row: BackfillRow): boolean {
  return PII_COLUMNS.some((f) => {
    const v = row[f];
    return (
      typeof v === "string" && v.length > 0 && !v.startsWith(ENC_PREFIX)
    );
  });
}

/** Build the SET clause values for a row needing encryption. */
function buildEncryptedValues(
  row: BackfillRow,
  dek: Buffer,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of PII_COLUMNS) {
    const v = row[field];
    if (typeof v === "string" && v.length > 0 && !v.startsWith(ENC_PREFIX)) {
      // map camelCase alias → snake_case column name
      const col = camelToSnake(field);
      values[col] = encryptColumnWithDek(v, dek);
    }
  }
  return values;
}

/** camelCase → snake_case for the PII field aliases. */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export const backfillEncryptEmployees = inngest.createFunction(
  {
    id: "backfill-encrypt-employees",
    triggers: [{ event: "pii/employees.backfill" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const eventCompany = (event?.data as { companyId?: string } | undefined)
      ?.companyId;

    // Determine the company set to backfill (one, or all).
    const companyIds: string[] = eventCompany
      ? [eventCompany]
      : (await db.select({ id: companies.id }).from(companies)).map((c) => c.id);

    const summary: { companyId: string; encrypted: number; skipped: number }[] =
      [];

    for (const companyId of companyIds) {
      const perCompany = await step.run(
        `backfill-company-${companyId}`,
        async () => {
          // Ensure a DEK exists for this company before encrypting.
          await DekService.ensureDek(companyId);
          const dek = await DekService.getDek(companyId);

          let encrypted = 0;
          let skipped = 0;
          let keepGoing = true;
          let lastId: string | null = null;

          while (keepGoing) {
            // Fetch the next batch of profiles for this company whose row has at
            // least one non-null PII column (cheap pre-filter at the DB).
            const rows = (await db
              .select({
                id: employeeProfiles.id,
                userId: employeeProfiles.userId,
                curp: employeeProfiles.curp,
                rfc: employeeProfiles.rfc,
                nss: employeeProfiles.nss,
                personalEmail: employeeProfiles.personalEmail,
                personalPhone: employeeProfiles.personalPhone,
                emergencyContactPhone: employeeProfiles.emergencyContactPhone,
                emergencyContactEmail: employeeProfiles.emergencyContactEmail,
                bankName: employeeProfiles.bankName,
                clabe: employeeProfiles.clabe,
                cardNumber: employeeProfiles.cardNumber,
              })
              .from(employeeProfiles)
              .innerJoin(
                users,
                eq(users.id, employeeProfiles.userId),
              )
              .where(
                and(
                  eq(users.companyId, companyId),
                  isNull(users.deletedAt),
                  // At least one PII column is non-null.
                  or(
                    isNotNull(employeeProfiles.curp),
                    isNotNull(employeeProfiles.rfc),
                    isNotNull(employeeProfiles.nss),
                    isNotNull(employeeProfiles.personalEmail),
                    isNotNull(employeeProfiles.personalPhone),
                    isNotNull(employeeProfiles.emergencyContactPhone),
                    isNotNull(employeeProfiles.emergencyContactEmail),
                    isNotNull(employeeProfiles.bankName),
                    isNotNull(employeeProfiles.clabe),
                    isNotNull(employeeProfiles.cardNumber),
                  ),
                  lastId
                    ? sql`${employeeProfiles.id} > ${lastId}`
                    : sql`true`,
                ),
              )
              .orderBy(employeeProfiles.id)
              .limit(BATCH_SIZE)) as BackfillRow[];

            if (rows.length === 0) {
              keepGoing = false;
              break;
            }

            for (const row of rows) {
              lastId = row.id;
              if (!hasPlaintextPii(row)) {
                // already encrypted (idempotent) — skip.
                skipped++;
                continue;
              }
              const values = buildEncryptedValues(row, dek);
              if (Object.keys(values).length === 0) {
                skipped++;
                continue;
              }
              await db
                .update(employeeProfiles)
                .set(values)
                .where(eq(employeeProfiles.id, row.id));
              encrypted++;
            }

            // Stop when the batch was smaller than BATCH_SIZE (no more rows).
            if (rows.length < BATCH_SIZE) keepGoing = false;
          }

          return { companyId, encrypted, skipped };
        },
      );
      summary.push(
        perCompany as { companyId: string; encrypted: number; skipped: number },
      );
    }

    return { success: true, companies: summary.length, summary };
  },
);