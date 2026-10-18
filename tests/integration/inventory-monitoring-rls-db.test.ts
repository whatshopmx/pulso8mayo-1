import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  branches,
  companies,
  inventoryBatches,
  inventoryExpirationAlerts,
  inventoryItems,
  inventorySnapshots,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { RUNTIME_ROLE, provisionRuntimeRole, runtimeUrl } from "./helpers/runtime-role";

/**
 * SEC-05.inventario-monitoreo (Fase 2) — RLS sobre las salidas de monitoreo de
 * inventario (`inventory_snapshots`, `inventory_expiration_alerts`), ambas con
 * `company_id` directo, contra base Postgres real.
 *
 * Comprueba:
 * (1) cada empresa ve sólo sus filas y un filtro por la ajena no devuelve nada;
 * (2) sin contexto el rol runtime no ve ni escribe (rechazo por defecto);
 * (3) un job que recorre empresas escribe con el `companyId` explícito del
 *     evento y el upsert de snapshot es idempotente bajo ese contexto.
 *
 * El servicio (`InventorySnapshotService`) y el cron de vencimientos fijan el
 * contexto; ejecutarlos contra el rol runtime en un entorno desplegado es el
 * paso operativo (igual que la provisión de `pulso_app`).
 */

neonConfig.webSocketConstructor = ws;

const BATCH_TABLES = ["inventory_snapshots", "inventory_expiration_alerts"];
const SNAPSHOT_DATE = "2026-10-17";

type Tenant = { companyId: string; branchId: string; userId: string; itemId: string; batchId: string };

async function seedTenant(label: string): Promise<Tenant> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `INV-MON ${label} ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: `Sucursal ${label}` });
  await db.insert(users).values({
    id: userId,
    name: `Usuario ${label}`,
    email: `${userId}@invmon.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });

  const [item] = await db
    .insert(inventoryItems)
    .values({ companyId, name: `Insumo ${label}`, unit: "KG", isHighValue: true })
    .returning();

  const [batch] = await db
    .insert(inventoryBatches)
    .values({ itemId: item.id, branchId, initialQuantity: "10", currentQuantity: "10", status: "AVAILABLE" })
    .returning();

  return { companyId, branchId, userId, itemId: item.id, batchId: batch.id };
}

async function seedRows(t: Tenant, calculated: string, window: string) {
  await db.insert(inventorySnapshots).values({
    companyId: t.companyId,
    branchId: t.branchId,
    itemId: t.itemId,
    snapshotDate: SNAPSHOT_DATE,
    calculatedStock: calculated,
    countedStock: null,
  });
  await db.insert(inventoryExpirationAlerts).values({
    companyId: t.companyId,
    branchId: t.branchId,
    batchId: t.batchId,
    window,
  });
}

const runtimePool = new Pool({ connectionString: runtimeUrl(), max: 1, allowExitOnIdle: true });
const runtime = drizzle(runtimePool, { schema });

describe("SEC-05.inventario-monitoreo sobre base real: RLS de snapshots y alertas", () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    await provisionRuntimeRole(BATCH_TABLES);
    a = await seedTenant("A");
    b = await seedTenant("B");
    await seedRows(a, "10.0000", "H48");
    await seedRows(b, "20.0000", "H24");
  }, 60_000);

  afterAll(async () => {
    await runtimePool.end();
  });

  it("la política está activa en ambas tablas y el rol runtime no tiene bypass", async () => {
    const [{ relrowsecurity }] = (
      await db.execute(
        sql`SELECT bool_and(relrowsecurity) AS relrowsecurity FROM pg_class WHERE relname IN ('inventory_snapshots','inventory_expiration_alerts')`,
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

  it("cada empresa ve sólo sus snapshots y alertas; filtrar por la ajena no devuelve nada", async () => {
    const snapsA = await withCompanyContext(
      { companyId: a.companyId },
      (tx) => tx.select({ companyId: inventorySnapshots.companyId }).from(inventorySnapshots),
      runtime,
    );
    const alertsB = await withCompanyContext(
      { companyId: b.companyId },
      (tx) => tx.select({ companyId: inventoryExpirationAlerts.companyId }).from(inventoryExpirationAlerts),
      runtime,
    );
    expect(snapsA.map((r) => r.companyId)).toEqual([a.companyId]);
    expect(alertsB.map((r) => r.companyId)).toEqual([b.companyId]);

    // Filtro explícito por la otra empresa: 0 filas.
    const crossSnap = await withCompanyContext(
      { companyId: a.companyId },
      (tx) =>
        tx
          .select({ id: inventorySnapshots.id })
          .from(inventorySnapshots)
          .where(eq(inventorySnapshots.companyId, b.companyId)),
      runtime,
    );
    expect(crossSnap).toHaveLength(0);
  }, 60_000);

  it("sin contexto, el rol runtime no ve ni escribe en ninguna de las dos", async () => {
    expect(await runtime.select({ id: inventorySnapshots.id }).from(inventorySnapshots)).toHaveLength(0);
    expect(
      await runtime.select({ id: inventoryExpirationAlerts.id }).from(inventoryExpirationAlerts),
    ).toHaveLength(0);

    await expect(
      runtime.insert(inventorySnapshots).values({
        companyId: a.companyId,
        branchId: a.branchId,
        itemId: a.itemId,
        snapshotDate: SNAPSHOT_DATE,
        calculatedStock: "1",
      }),
    ).rejects.toBeTruthy();

    await expect(
      runtime.insert(inventoryExpirationAlerts).values({
        companyId: a.companyId,
        branchId: a.branchId,
        batchId: a.batchId,
        window: "EXPIRED",
      }),
    ).rejects.toBeTruthy();
  }, 60_000);

  it("un job escribe con alcance explícito y el upsert de snapshot no duplica", async () => {
    // El cron de vencimientos captura el `companyId` del lote y escribe bajo ese
    // contexto (no con un rol privilegiado).
    await withCompanyContext(
      { companyId: b.companyId, branchId: b.branchId },
      (tx) =>
        tx.insert(inventoryExpirationAlerts).values({
          companyId: b.companyId,
          branchId: b.branchId,
          batchId: b.batchId,
          window: "EXPIRED",
        }),
      runtime,
    );

    const alerts = await withCompanyContext(
      { companyId: b.companyId },
      (tx) =>
        tx
          .select({ window: inventoryExpirationAlerts.window })
          .from(inventoryExpirationAlerts)
          .where(eq(inventoryExpirationAlerts.companyId, b.companyId)),
      runtime,
    );
    expect(alerts.length).toBe(2); // H24 del seed + EXPIRED del job
    expect(alerts.map((r) => r.window).sort()).toEqual(["EXPIRED", "H24"]);

    // Upsert del snapshot con la misma clave: actualiza, no duplica.
    for (const calculated of ["11.0000", "12.0000"]) {
      await withCompanyContext(
        { companyId: a.companyId, branchId: a.branchId },
        (tx) =>
          tx
            .insert(inventorySnapshots)
            .values({
              companyId: a.companyId,
              branchId: a.branchId,
              itemId: a.itemId,
              snapshotDate: SNAPSHOT_DATE,
              calculatedStock: calculated,
            })
            .onConflictDoUpdate({
              target: [
                inventorySnapshots.companyId,
                inventorySnapshots.branchId,
                inventorySnapshots.itemId,
                inventorySnapshots.snapshotDate,
              ],
              set: { calculatedStock: sql`excluded.calculated_stock` },
            }),
        runtime,
      );
    }

    const snaps = await withCompanyContext(
      { companyId: a.companyId },
      (tx) =>
        tx
          .select({ calculatedStock: inventorySnapshots.calculatedStock })
          .from(inventorySnapshots)
          .where(eq(inventorySnapshots.companyId, a.companyId)),
      runtime,
    );
    expect(snaps).toHaveLength(1);
    expect(Number(snaps[0].calculatedStock)).toBe(12);
  }, 60_000);
});
