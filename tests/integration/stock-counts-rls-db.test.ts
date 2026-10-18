import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { branches, companies, inventoryItems, stockCounts, users } from "@/lib/db/schema";
import { withCompanyContext, withBranchContext } from "@/lib/db/tenant-context";
import { RUNTIME_ROLE, provisionRuntimeRole, runtimeUrl } from "./helpers/runtime-role";

/**
 * SEC-05.inventario-conteos (Fase 2) — RLS de `stock_counts` contra base real.
 *
 * Comprueba:
 * (1) cada empresa ve sólo sus conteos y filtrar por la ajena no devuelve nada;
 * (2) sin contexto el rol runtime no ve ni escribe (rechazo por defecto);
 * (3) `withBranchContext` resuelve la empresa de la sucursal y habilita lectura
 *     y alta legítimas, mientras un insert con empresa ajena se rechaza.
 */

neonConfig.webSocketConstructor = ws;

// `branches` se incluye porque `withBranchContext` la lee para resolver empresa.
const BATCH_TABLES = ["stock_counts", "branches"];

type Tenant = { companyId: string; branchId: string; userId: string; itemId: string };

async function seedTenant(label: string): Promise<Tenant> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `SC-RLS ${label} ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: `Sucursal ${label}` });
  await db.insert(users).values({
    id: userId,
    name: `Usuario ${label}`,
    email: `${userId}@scrls.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });
  const [item] = await db
    .insert(inventoryItems)
    .values({ companyId, name: `Insumo ${label}`, unit: "KG" })
    .returning();

  return { companyId, branchId, userId, itemId: item.id };
}

async function insertCount(t: Tenant, counted: string) {
  const [row] = await db
    .insert(stockCounts)
    .values({
      companyId: t.companyId,
      branchId: t.branchId,
      itemId: t.itemId,
      countedQuantity: counted,
      systemQuantity: "5",
      countDate: "2026-10-17",
    })
    .returning();
  return row;
}

const runtimePool = new Pool({ connectionString: runtimeUrl(), max: 1, allowExitOnIdle: true });
const runtime = drizzle(runtimePool, { schema });

describe("SEC-05.inventario-conteos sobre base real: RLS de stock_counts", () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    await provisionRuntimeRole(BATCH_TABLES);
    a = await seedTenant("A");
    b = await seedTenant("B");
    await insertCount(a, "4.5");
    await insertCount(b, "9.0");
  }, 60_000);

  afterAll(async () => {
    await runtimePool.end();
  });

  it("la política está activa y el rol runtime no tiene bypass", async () => {
    const [{ relrowsecurity }] = (
      await db.execute(
        sql`SELECT relrowsecurity FROM pg_class WHERE relname = 'stock_counts'`,
      )
    ).rows as Array<{ relrowsecurity: boolean }>;
    expect(relrowsecurity).toBe(true);

    const [{ rolbypassrls, rolsuper }] = (
      await db.execute(
        sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${RUNTIME_ROLE}`,
      )
    ).rows as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
    expect(rolbypassrls).toBe(false);
    expect(rolsuper).toBe(false);
  }, 60_000);

  it("cada empresa ve sólo sus conteos; filtrar por la ajena no devuelve nada", async () => {
    const seenA = await withCompanyContext(
      { companyId: a.companyId },
      (tx) => tx.select({ companyId: stockCounts.companyId }).from(stockCounts),
      runtime,
    );
    const seenB = await withCompanyContext(
      { companyId: b.companyId },
      (tx) => tx.select({ companyId: stockCounts.companyId }).from(stockCounts),
      runtime,
    );
    expect(seenA.map((r) => r.companyId)).toEqual([a.companyId]);
    expect(seenB.map((r) => r.companyId)).toEqual([b.companyId]);

    const cross = await withCompanyContext(
      { companyId: a.companyId },
      (tx) =>
        tx
          .select({ id: stockCounts.id })
          .from(stockCounts)
          .where(eq(stockCounts.companyId, b.companyId)),
      runtime,
    );
    expect(cross).toHaveLength(0);
  }, 60_000);

  it("sin contexto, el rol runtime no ve ni escribe", async () => {
    expect(await runtime.select({ id: stockCounts.id }).from(stockCounts)).toHaveLength(0);

    await expect(
      runtime.insert(stockCounts).values({
        companyId: a.companyId,
        branchId: a.branchId,
        itemId: a.itemId,
        countedQuantity: "1",
        systemQuantity: "1",
        countDate: "2026-10-18",
      }),
    ).rejects.toBeTruthy();
  }, 60_000);

  it("withBranchContext resuelve la empresa; alta legítima pasa y la ajena se rechaza", async () => {
    const countDate = "2026-10-19";
    await withBranchContext(
      a.branchId,
      (tx) =>
        tx.insert(stockCounts).values({
          companyId: a.companyId,
          branchId: a.branchId,
          itemId: a.itemId,
          countedQuantity: "6",
          systemQuantity: "4",
          countDate,
        }),
      runtime,
    );

    const read = await withBranchContext(
      a.branchId,
      (tx) =>
        tx
          .select({ countedQuantity: stockCounts.countedQuantity })
          .from(stockCounts)
          .where(eq(stockCounts.countDate, countDate)),
      runtime,
    );
    expect(read).toHaveLength(1);
    expect(Number(read[0].countedQuantity)).toBe(6);

    // Insert declarando la empresa AJENA bajo esta sucursal: WITH CHECK lo niega.
    await expect(
      withBranchContext(
        a.branchId,
        (tx) =>
          tx.insert(stockCounts).values({
            companyId: b.companyId,
            branchId: a.branchId,
            itemId: a.itemId,
            countedQuantity: "1",
            systemQuantity: "1",
            countDate: "2026-10-20",
          }),
        runtime,
      ),
    ).rejects.toBeTruthy();
  }, 60_000);
});
