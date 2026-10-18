import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  companies,
  inventoryBatches,
  inventoryItems,
  inventoryMovements,
  inventoryPeriods,
  inventoryPriceHistory,
  receivingReports,
  users,
} from "@/lib/db/schema";
import { processReceiving, type ReceivingActor } from "@/lib/services/receiving-service";
import { AuditService } from "@/lib/services/audit-service";

/**
 * REC-02b contra base Postgres real (Puerta 1).
 *
 * Los tests unitarios usan mocks y sólo prueban que se invoca `db.transaction`.
 * Aquí se verifica el comportamiento de Postgres: que un fallo intermedio
 * revierte de verdad todas las filas, y que dos peticiones simultáneas con la
 * misma clave de idempotencia producen UNA sola recepción.
 *
 * Requiere `TEST_DATABASE_URL` (ver `tests/integration/setup.ts`).
 */

type Fixtures = {
  companyId: string;
  branchId: string;
  userId: string;
  item1: { id: string };
  item2: { id: string };
  actor: ReceivingActor;
};

async function seedFixtures(): Promise<Fixtures> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `ISO ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: "Sucursal ISO" });
  await db.insert(users).values({
    id: userId,
    name: "Usuario ISO",
    email: `${userId}@iso.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });

  const [item1] = await db
    .insert(inventoryItems)
    .values({
      companyId,
      name: "Insumo ISO 1",
      unit: "KG",
      storageType: null,
      lastCost: 100,
      active: true,
    })
    .returning({ id: inventoryItems.id });

  const [item2] = await db
    .insert(inventoryItems)
    .values({
      companyId,
      name: "Insumo ISO 2",
      unit: "KG",
      storageType: null,
      lastCost: 100,
      active: true,
    })
    .returning({ id: inventoryItems.id });

  return {
    companyId,
    branchId,
    userId,
    item1,
    item2,
    actor: { user: { id: userId, companyId }, branchId, role: "ADMIN" },
  };
}

async function countReports(companyId: string) {
  const rows = await db
    .select({ id: receivingReports.id })
    .from(receivingReports)
    .where(eq(receivingReports.companyId, companyId));
  return rows.length;
}

describe("REC-02b sobre base real: atomicidad e idempotencia", () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await seedFixtures();
  });

  it("un fallo intermedio no deja reporte, lote, movimiento, período ni cambios de costo", async () => {
    // El primer ítem se procesa por completo (lote + movimiento + costo); el
    // segundo desborda numeric(12,4) dentro de la misma transacción. Postgres
    // debe revertir TODO, no sólo la última escritura.
    await expect(
      processReceiving(f.actor, {
        items: [
          { itemId: f.item1.id, quantity: 10, unitCost: 2 },
          // 1e12 excede numeric(12,4) → error de base a mitad de transacción.
          { itemId: f.item2.id, quantity: 1e12 },
        ],
        idempotencyKey: `rollback-${randomUUID()}`,
      }),
    ).rejects.toBeTruthy();

    expect(await countReports(f.companyId)).toBe(0);

    const batches = await db
      .select({ id: inventoryBatches.id })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.branchId, f.branchId));
    expect(batches).toHaveLength(0);

    const movements = await db
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.branchId, f.branchId));
    expect(movements).toHaveLength(0);

    // `ensureOpenPeriod` inserta un período dentro de la transacción: también
    // debe desaparecer.
    const periods = await db
      .select({ id: inventoryPeriods.id })
      .from(inventoryPeriods)
      .where(eq(inventoryPeriods.branchId, f.branchId));
    expect(periods).toHaveLength(0);

    // El costo del ítem 1 (que sí se había actualizado a 200) vuelve a 100.
    const item1 = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, f.item1.id),
    });
    expect(item1?.lastCost).toBe(100);

    const history = await db
      .select({ id: inventoryPriceHistory.id })
      .from(inventoryPriceHistory)
      .where(eq(inventoryPriceHistory.itemId, f.item1.id));
    expect(history).toHaveLength(0);
  });

  it("reenviar la misma clave devuelve la recepción existente sin duplicar", async () => {
    const idempotencyKey = `replay-${randomUUID()}`;
    const body = {
      items: [{ itemId: f.item1.id, quantity: 4 }],
      idempotencyKey,
    };

    const first = await processReceiving(f.actor, body);
    const second = await processReceiving(f.actor, body);

    expect(second.id).toBe(first.id);
    expect(await countReports(f.companyId)).toBe(1);

    const batches = await db
      .select({ id: inventoryBatches.id })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.branchId, f.branchId));
    expect(batches).toHaveLength(1);

    const movements = await db
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.branchId, f.branchId));
    expect(movements).toHaveLength(1);
  });

  it("dos peticiones simultáneas con la misma clave producen una sola recepción", async () => {
    const idempotencyKey = `race-${randomUUID()}`;
    const body = {
      items: [{ itemId: f.item1.id, quantity: 5 }],
      idempotencyKey,
    };

    const [a, b] = await Promise.all([
      processReceiving(f.actor, body),
      processReceiving(f.actor, body),
    ]);

    // Ambas resuelven a la MISMA recepción (el perdedor del 23505 hace replay).
    expect(a.id).toBe(b.id);

    const reports = await db
      .select({ id: receivingReports.id })
      .from(receivingReports)
      .where(
        and(
          eq(receivingReports.companyId, f.companyId),
          eq(receivingReports.idempotencyKey, idempotencyKey),
        ),
      );
    expect(reports).toHaveLength(1);

    const batches = await db
      .select({ id: inventoryBatches.id })
      .from(inventoryBatches)
      .where(eq(inventoryBatches.branchId, f.branchId));
    expect(batches).toHaveLength(1);

    const movements = await db
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.branchId, f.branchId));
    expect(movements).toHaveLength(1);
  });

  it("la misma clave en otra sucursal se rechaza con conflicto", async () => {
    const idempotencyKey = `cross-${randomUUID()}`;
    const body = {
      items: [{ itemId: f.item1.id, quantity: 3 }],
      idempotencyKey,
    };

    await processReceiving(f.actor, body);

    // Otra sucursal de la MISMA empresa intenta reutilizar la clave.
    const otherBranchId = randomUUID();
    await db.insert(branches).values({ id: otherBranchId, companyId: f.companyId, name: "Sucursal ISO 2" });
    const otherActor: ReceivingActor = {
      user: { id: f.userId, companyId: f.companyId },
      branchId: otherBranchId,
      role: "ADMIN",
    };

    await expect(processReceiving(otherActor, body)).rejects.toMatchObject({ statusCode: 409 });
    expect(await countReports(f.companyId)).toBe(1);
  });

  it("AUD-01: si la auditoría falla, la recepción completa revierte", async () => {
    const spy = vi
      .spyOn(AuditService, "logInventoryAction")
      .mockRejectedValueOnce(new Error("audit write down"));

    try {
      await expect(
        processReceiving(f.actor, {
          items: [{ itemId: f.item1.id, quantity: 7 }],
          idempotencyKey: `audit-${randomUUID()}`,
        }),
      ).rejects.toBeTruthy();

      // Nada de la recepción debe quedar: la bitácora es parte de la transacción.
      expect(await countReports(f.companyId)).toBe(0);

      const batches = await db
        .select({ id: inventoryBatches.id })
        .from(inventoryBatches)
        .where(eq(inventoryBatches.branchId, f.branchId));
      expect(batches).toHaveLength(0);

      const movements = await db
        .select({ id: inventoryMovements.id })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.branchId, f.branchId));
      expect(movements).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
