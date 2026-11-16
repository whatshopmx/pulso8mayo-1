import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, sql } from "drizzle-orm";
import { db as owner } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { ApplySaleConsumptionInput } from "@/lib/services/sale-consumption-service";
import { provisionRuntimeRole, runtimeUrl } from "./helpers/runtime-role";

type Runtime = ReturnType<typeof drizzle<typeof schema>>;
type Tx = Parameters<Parameters<typeof owner.transaction>[0]>[0];
let pool: Pool, runtime: Runtime;
let apply: typeof import("@/lib/services/sale-consumption-service").applySaleConsumption;
const runId = randomUUID();
const fixtures: { company: string[]; branch: string[]; item: string[]; recipe: string[]; batch: string[] }[] = [];
const observations: { pid: number; actor: string; isolation: string }[] = [];
const states: unknown[] = [];
let gate: (() => Promise<void>) | undefined;

async function fixture() {
  const ids = () => [randomUUID(), randomUUID()];
  const f = { company: ids(), branch: ids(), item: ids(), recipe: ids(), batch: ids() };
  await owner.transaction(async tx => {
    await tx.insert(schema.companies).values(f.company.map(id => ({ id, name: `INV01-C ${runId}` })));
    await tx.insert(schema.branches).values(f.branch.map((id, i) => ({ id, companyId: f.company[i], name: "Carrera sintética" })));
    await tx.insert(schema.inventoryItems).values(f.item.map((id, i) => ({ id, companyId: f.company[i], name: "Ingrediente carrera", unit: "KG" })));
    await tx.insert(schema.recipes).values(f.recipe.map((id, i) => ({ id, companyId: f.company[i], name: "Receta carrera", baseYield: "1", unit: "PORTION" })));
    await tx.insert(schema.recipeItems).values(f.recipe.map((recipeId, i) => ({ recipeId, itemId: f.item[i], quantity: "1", unit: "KG", yieldPercent: 100 })));
    await tx.insert(schema.inventoryBatches).values(f.batch.map((id, i) => ({ id, branchId: f.branch[i], itemId: f.item[i],
      initialQuantity: "20", currentQuantity: "20", status: "AVAILABLE" as const, expirationDate: new Date("2099-01-01") })));
  });
  // Los hechos append-only confirmados se conservan exclusivamente en la rama aislada.
  fixtures.push(f);
  return f;
}
function input(f: Awaited<ReturnType<typeof fixture>>, quantitySold = "10"): ApplySaleConsumptionInput {
  return { companyId: f.company[0], branchId: f.branch[0], recipeId: f.recipe[0], source: "pos:race", productKey: "SKU-1",
    saleDay: "2026-11-13", quantitySold, totalRevenueCents: Number(quantitySold) * 100, userId: `synthetic:${runId}` };
}
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  const [batch] = await owner.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, f.batch[0]));
  const sales = await owner.select().from(schema.salesEntries).where(and(eq(schema.salesEntries.companyId, f.company[0]), eq(schema.salesEntries.branchId, f.branch[0])));
  const revisions = await owner.select().from(schema.salesConsumptionRevisions).where(eq(schema.salesConsumptionRevisions.companyId, f.company[0]));
  const movements = await owner.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.branchId, f.branch[0]));
  const [foreign] = await owner.select().from(schema.inventoryBatches).where(eq(schema.inventoryBatches.id, f.batch[1]));
  expect(foreign.currentQuantity).toBe("20.0000");
  states.push({ companyId: f.company[0], stock: batch.currentQuantity, foreignStock: foreign.currentQuantity,
    sales: sales.map(row => ({ quantitySold: row.quantitySold, totalRevenue: row.totalRevenue, saleDate: row.saleDate })),
    revisions: revisions.map(row => ({ revision: row.revision, quantitySold: row.quantitySold, identityId: row.identityId })),
    movements: movements.map(row => ({ id: row.id, quantityChange: row.quantityChange, referenceId: row.referenceId })) });
  return { stock: batch.currentQuantity, sales, revisions, movements };
}
async function race(a: ApplySaleConsumptionInput, b: ApplySaleConsumptionInput, expectRetry = true) {
  let arrivals = 0, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const timeout = setTimeout(release, 10000);
  const start = observations.length;
  gate = async () => { if (++arrivals === 2) release(); await ready; };
  try {
    const results = await Promise.allSettled([apply(a), apply(b)]);
    const seen = observations.slice(start);
    expect(arrivals).toBeGreaterThanOrEqual(2);
    expect(new Set(seen.slice(0, 2).map(row => row.pid)).size).toBe(2);
    expect(seen.every(row => row.actor === "pulso_app" && row.isolation === "serializable")).toBe(true);
    // Ambas primeras transacciones toman snapshot antes de competir por el lock.
    if (expectRetry) expect(seen.length).toBeGreaterThanOrEqual(3);
    return results;
  } finally { clearTimeout(timeout); gate = undefined; }
}

describe("INV-01.c.races: commits concurrentes con runtime real", () => {
  beforeAll(async () => {
    const host = (value: string) => new URL(value).hostname.replace(/-pooler(?=\.)/, "");
    expect(host(process.env.TEST_DATABASE_URL!)).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");
    const operational = existsSync(".env") ? parse(readFileSync(".env")).DATABASE_URL : undefined;
    if (operational) expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(host(operational));
    await provisionRuntimeRole([]);
    const [role] = (await owner.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(sql`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='pulso_app'`)).rows;
    expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });
    pool = new Pool({ connectionString: runtimeUrl(), max: 4, allowExitOnIdle: true });
    runtime = drizzle(pool, { schema });
    const transaction = runtime.transaction.bind(runtime);
    // Sustituye solo la conexión. El writer, el planificador y los reintentos son de producción.
    vi.spyOn(runtime, "transaction").mockImplementation((callback, options) => transaction(async (tx: Tx) => {
      const row = (await tx.execute<{ pid: number; actor: string; isolation: string }>(sql`SELECT pg_backend_pid() AS pid,current_user AS actor,current_setting('transaction_isolation') AS isolation`)).rows[0];
      observations.push(row);
      await gate?.();
      return callback(tx);
    }, options));
    vi.doMock("@/lib/db", () => ({ db: runtime }));
    ({ applySaleConsumption: apply } = await import("@/lib/services/sale-consumption-service"));
  });
  afterAll(async () => {
    mkdirSync(".tmp", { recursive: true });
    const manifest = JSON.stringify({ runId, fixtures, observations, states, retained: "Fixtures sintéticas con historial append-only en rama aislada; no se deshabilitan protecciones" }, null, 2);
    writeFileSync(`.tmp/inv01-c-races-${runId}.json`, manifest);
    writeFileSync(".tmp/inv01-c-races.json", manifest);
    vi.doUnmock("@/lib/db");
    await pool?.end();
  });
  it("dos altas idénticas descuentan una sola vez y el reintento observa el commit", async () => {
    const f = await fixture();
    const results = await race(input(f), input(f));
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    expect(results.map(result => result.status === "fulfilled" && result.value.applied).sort()).toEqual([false, true]);
    const actual = await state(f);
    expect(actual.stock).toBe("10.0000"); expect(actual.revisions).toHaveLength(1); expect(actual.movements).toHaveLength(1);
    expect(actual.sales).toMatchObject([{ quantitySold: "10.00", totalRevenue: 1000 }]);
  });
  it("dos correcciones sobre el mismo head aceptan una y rechazan la revisión obsoleta", async () => {
    const f = await fixture(); await apply(input(f));
    const results = await race({ ...input(f, "12"), expectedRevision: 1 }, { ...input(f, "8"), expectedRevision: 1 });
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });
    const actual = await state(f);
    expect(actual.revisions).toHaveLength(2);
    const head = actual.revisions.find(row => row.revision === 2)!;
    expect(Number(actual.stock) + Number(head.quantitySold)).toBe(20);
    expect(actual.sales).toMatchObject([{ quantitySold: head.quantitySold, totalRevenue: head.totalRevenue }]);
  });
  it("dos productos conservan la proyección compartida sin perder cantidad ni ingreso", async () => {
    const f = await fixture();
    const results = await race(input(f, "4"), { ...input(f, "3"), productKey: "SKU-2" });
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const actual = await state(f);
    expect(actual.stock).toBe("13.0000"); expect(actual.revisions).toHaveLength(2); expect(actual.movements).toHaveLength(2);
    expect(actual.sales).toMatchObject([{ quantitySold: "7.00", totalRevenue: 700 }]);
  });
  it("dos días distintos que compiten por un lote nunca sobreconsumen su saldo", async () => {
    const f = await fixture();
    const results = await race(input(f, "15"), { ...input(f, "15"), saleDay: "2026-11-14" });
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "INSUFFICIENT_STOCK" } });
    const actual = await state(f);
    expect(actual.stock).toBe("5.0000"); expect(actual.revisions).toHaveLength(1); expect(actual.movements).toHaveLength(1);
    expect(actual.sales).toMatchObject([{ quantitySold: "15.00", totalRevenue: 1500 }]);
  });
  it("una venta histórica sin consumo demostrado sigue bloqueada ante dos intentos de reparación implícita", async () => {
    const f = await fixture();
    await owner.insert(schema.salesEntries).values({ companyId: f.company[0], branchId: f.branch[0], recipeId: f.recipe[0],
      saleDate: new Date("2026-11-13T00:00:00Z"), quantitySold: "1", totalRevenue: 100 });
    const before = await state(f);
    const results = await race(input(f, "1"), input(f, "1"), false);
    expect(results).toMatchObject([{ status: "rejected", reason: { code: "PENDING_RECOVERY" } }, { status: "rejected", reason: { code: "PENDING_RECOVERY" } }]);
    expect(await state(f)).toEqual(before);
    expect(await owner.select({ id: schema.salesConsumptionIdentities.id }).from(schema.salesConsumptionIdentities)
      .where(eq(schema.salesConsumptionIdentities.companyId, f.company[0]))).toEqual([]);
  });
});
