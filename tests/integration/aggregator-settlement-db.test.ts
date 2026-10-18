import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aggregatorSettlements, branches, companies, dailySalesCuts } from "@/lib/db/schema";
import { createAndReconcileAggregatorSettlement } from "@/lib/services/aggregator-settlement-service";

/**
 * Conciliación de liquidaciones contra base Postgres real.
 *
 * El bug que se blinda: `posSalesCents` sumaba `SUM(total_sales)` del periodo de
 * la sucursal SIN filtrar por canal, así que la liquidación de Rappi se comparaba
 * contra la venta completa del restaurante. Aquí se comprueba, con cortes reales,
 * que la suma es la del canal y no la del negocio entero.
 *
 * También cubre la normalización de llaves (`ubereats` → `uber`, la llave que
 * guarda el corte) y el aislamiento por empresa/sucursal/periodo.
 *
 * Requiere `TEST_DATABASE_URL` (ver `tests/integration/setup.ts`).
 */

type Fixtures = {
  companyId: string;
  branchId: string;
  otherBranchId: string;
};

const PERIOD_START = "2026-01-05";
const PERIOD_END = "2026-01-06";

async function seedFixtures(): Promise<Fixtures> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const otherBranchId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `ISO conciliación ${companyId.slice(0, 8)}` });
  await db.insert(branches).values([
    { id: branchId, companyId, name: "Sucursal A" },
    { id: otherBranchId, companyId, name: "Sucursal B" },
  ]);

  const cut = (overrides: Partial<typeof dailySalesCuts.$inferInsert>) => ({
    companyId,
    branchId,
    shift: "COMPLETO" as const,
    source: "MANUAL_FORM" as const,
    ...overrides,
  });

  await db.insert(dailySalesCuts).values([
    // 2026-01-05 — SALON (efectivo + tarjeta) sin agregadores.
    cut({
      businessDate: "2026-01-05",
      channel: "SALON",
      totalSales: 100_000,
      cashSales: 40_000,
      cardSales: 60_000,
      aggregatorSales: null,
    }),
    // 2026-01-05 — DELIVERY con desglose por agregador.
    cut({
      businessDate: "2026-01-05",
      channel: "DELIVERY",
      totalSales: 50_000,
      otherPayments: 50_000,
      aggregatorSales: { rappi: 30_000, uber: 15_000, didi: 5_000 },
    }),
    // 2026-01-06 — SALON.
    cut({
      businessDate: "2026-01-06",
      channel: "SALON",
      totalSales: 30_000,
      cashSales: 10_000,
      cardSales: 20_000,
      aggregatorSales: null,
    }),
    // 2026-01-06 — DELIVERY sólo con Rappi.
    cut({
      businessDate: "2026-01-06",
      channel: "DELIVERY",
      totalSales: 20_000,
      otherPayments: 20_000,
      aggregatorSales: { rappi: 20_000 },
    }),
    // Otra sucursal: NO debe contaminar la suma de la sucursal A.
    cut({
      branchId: otherBranchId,
      businessDate: "2026-01-05",
      channel: "SALON",
      totalSales: 999_999,
      cardSales: 999_999,
      aggregatorSales: null,
    }),
    // Fuera del periodo: NO debe contar.
    cut({
      businessDate: "2025-12-31",
      channel: "DELIVERY",
      totalSales: 777_777,
      otherPayments: 777_777,
      aggregatorSales: { rappi: 777_777 },
    }),
  ]);

  return { companyId, branchId, otherBranchId };
}

async function cleanup(f: Fixtures) {
  await db.delete(aggregatorSettlements).where(eq(aggregatorSettlements.companyId, f.companyId));
  await db.delete(dailySalesCuts).where(eq(dailySalesCuts.companyId, f.companyId));
  await db.delete(branches).where(eq(branches.companyId, f.companyId));
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

/** Registra una liquidación y devuelve la fila persistida. */
async function reconcile(
  f: Fixtures,
  input: Partial<Parameters<typeof createAndReconcileAggregatorSettlement>[0]> & { channel: string },
) {
  return createAndReconcileAggregatorSettlement({
    companyId: f.companyId,
    branchId: f.branchId,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    grossSalesCents: 0,
    commissionCents: 0,
    netDepositedCents: 0,
    ...input,
  });
}

describe("Conciliación de liquidaciones sobre base real", () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await seedFixtures();
  });

  afterEach(async () => {
    await cleanup(f);
  });

  it("suma la venta del canal y no la del negocio entero", async () => {
    // Rappi: 30,000 (05) + 20,000 (06) = 50,000. El total del negocio es 200,000.
    const rappi = await reconcile(f, { channel: "rappi" });
    expect(rappi.posSalesCents).toBe(50_000);

    // Uber 15,000 y DiDi 5,000 — cada uno su propia llave, sin arrastrar el resto.
    expect((await reconcile(f, { channel: "uber" })).posSalesCents).toBe(15_000);
    expect((await reconcile(f, { channel: "didi" })).posSalesCents).toBe(5_000);
  });

  it("normaliza ubereats a la llave uber que guarda el corte", async () => {
    const uber = await reconcile(f, { channel: "ubereats" });
    expect(uber.channel).toBe("uber");
    expect(uber.posSalesCents).toBe(15_000);
  });

  it("concilia la terminal contra card_sales y el efectivo contra cash_sales", async () => {
    // TPV: 60,000 + 20,000 = 80,000.
    expect((await reconcile(f, { channel: "TPV" })).posSalesCents).toBe(80_000);
    // Mostrador (efectivo): 40,000 + 10,000 = 50,000. `efectivo` es alias.
    const mostrador = await reconcile(f, { channel: "efectivo" });
    expect(mostrador.channel).toBe("mostrador");
    expect(mostrador.posSalesCents).toBe(50_000);
  });

  it("el canal total suma la venta completa del periodo", async () => {
    expect((await reconcile(f, { channel: "total" })).posSalesCents).toBe(200_000);
  });

  it("marca discrepancia cuando el depósito no cuadra con el corte", async () => {
    // Vendimos 50,000 en Rappi; la plataforma retuvo 5,000 y depositó 40,000.
    const row = await reconcile(f, {
      channel: "rappi",
      grossSalesCents: 50_000,
      commissionCents: 5_000,
      netDepositedCents: 40_000,
    });
    expect(row.posSalesCents).toBe(50_000);
    expect(row.varianceCents).toBe(-5_000); // 40,000 + 5,000 − 50,000
    expect(row.status).toBe("DISCREPANCY");
  });

  it("marca conciliado cuando el neto más la comisión iguala el corte", async () => {
    const row = await reconcile(f, {
      channel: "rappi",
      grossSalesCents: 50_000,
      commissionCents: 5_000,
      netDepositedCents: 45_000,
    });
    expect(row.varianceCents).toBe(0);
    expect(row.status).toBe("RECONCILED");
  });

  it("respeta el alcance de sucursal: la otra sucursal no contamina", async () => {
    const other = await createAndReconcileAggregatorSettlement({
      companyId: f.companyId,
      branchId: f.otherBranchId,
      channel: "tpv",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      grossSalesCents: 0,
      commissionCents: 0,
      netDepositedCents: 0,
    });
    expect(other.posSalesCents).toBe(999_999);
  });
});
