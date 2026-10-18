import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, evidence, users } from "@/lib/db/schema";
import { AuditService } from "@/lib/services/audit-service";

/**
 * AUD-01 contra base Postgres real (Fase 2).
 *
 * El contrato: con el `executor` de una transacción, la bitácora pertenece a la
 * mutación. Si la escritura de auditoría falla, la mutación NO se confirma.
 * Sin `executor` se conserva el best-effort previo (no lanza).
 *
 * Requiere `TEST_DATABASE_URL` (ver `tests/integration/setup.ts`).
 */

type Tenant = { companyId: string; branchId: string; userId: string };

async function seedTenant(): Promise<Tenant> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `AUD ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: "Sucursal AUD" });
  await db.insert(users).values({
    id: userId,
    name: "Usuario AUD",
    email: `${userId}@aud.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });

  return { companyId, branchId, userId };
}

/** Fila de mutación cualquiera para observar el rollback de la transacción. */
async function countMutation(companyId: string, entityId: string) {
  const rows = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.companyId, companyId), eq(evidence.entityId, entityId)));
  return rows.length;
}

// Un enum inválido hace fallar el INSERT de la bitácora a nivel de Postgres,
// simulando la caída de la escritura de auditoría sin mocks.
const BAD_ACTION = "NOPE" as never;

describe("AUD-01 sobre base real: auditoría transaccional", () => {
  let t: Tenant;

  beforeEach(async () => {
    t = await seedTenant();
  });

  it("con executor, un fallo de auditoría revierte la mutación de la misma transacción", async () => {
    const entityId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(evidence).values({
          companyId: t.companyId,
          branchId: t.branchId,
          entityType: "GENERAL",
          entityId,
          url: "companies/aud/x.jpg",
        });

        await AuditService.logInventoryAction(
          {
            companyId: t.companyId,
            branchId: t.branchId,
            action: BAD_ACTION,
            entityType: "RECEIVING",
            entityId,
            performedBy: t.userId,
          },
          tx,
        );
      }),
    ).rejects.toBeTruthy();

    // La mutación debe haber desaparecido con la transacción.
    expect(await countMutation(t.companyId, entityId)).toBe(0);
  });

  it("sin executor conserva el best-effort: no lanza y devuelve null", async () => {
    const entityId = randomUUID();

    const result = await AuditService.logInventoryAction({
      companyId: t.companyId,
      branchId: t.branchId,
      action: BAD_ACTION,
      entityType: "RECEIVING",
      entityId,
      performedBy: t.userId,
    });

    expect(result).toBeNull();
    expect(await countMutation(t.companyId, entityId)).toBe(0);
  });
});
