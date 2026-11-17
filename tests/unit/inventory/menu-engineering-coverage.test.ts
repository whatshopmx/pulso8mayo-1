import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fixture = vi.hoisted(() => ({
  recipes: [] as Array<{ id: string; name: string; calculatedCost: number | null }>,
  sales: [] as Array<{ recipeId: string; quantitySold: string; revenue: number | null; revenueComplete: boolean }>,
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => (table === schema.recipes ? fixture.recipes : fixture.sales),
        }),
      }),
    },
  };
});

vi.mock("@/lib/tenant-context", () => ({
  requireTenant: async () => ({ id: "c1000000-0000-4000-8000-000000000001" }),
  requireAuth: async () => ({ user: { role: "ADMIN" } }),
}));

vi.mock("@/lib/permissions", () => ({
  hasPermission: () => true,
}));

import { GET } from "@/app/api/inventory/menu-engineering/route";

const url = "http://localhost/api/inventory/menu-engineering?startDate=2026-11-01&endDate=2026-11-30";
const call = () => GET(new NextRequest(url));

beforeEach(() => {
  fixture.recipes = [
    { id: "r-complete", name: "Completo", calculatedCost: 100 },
    { id: "r-partial", name: "Parcial", calculatedCost: 100 },
  ];
  fixture.sales = [];
});

describe("menu-engineering — cobertura de ingreso", () => {
  it("no clasifica como rentabilidad medida un ingreso incompleto", async () => {
    fixture.sales = [
      { recipeId: "r-complete", quantitySold: "3", revenue: 1200, revenueComplete: true },
      { recipeId: "r-partial", quantitySold: "2", revenue: 300, revenueComplete: false },
    ];
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    const complete = body.items.find((i) => i.recipeId === "r-complete");
    const partial = body.items.find((i) => i.recipeId === "r-partial");

    // Costo 100/ud × 3 = 300 sobre ingreso firme 1200 = 25% food cost, 75% margen.
    expect(complete).toMatchObject({
      totalSold: 3,
      reportedRevenueCents: 1200,
      revenueCents: 1200,
      revenueCoverage: { status: "COMPLETE", totalEntries: 1, completeEntries: 1 },
      foodCostPercent: 25,
      marginPercent: 75,
      quadrant: "STAR",
    });

    // Ingreso parcial: subtotal 300 se conserva, pero ni total ni rentabilidad.
    expect(partial).toMatchObject({
      totalSold: 2,
      reportedRevenueCents: 300,
      revenueCents: null,
      revenueCoverage: { status: "PARTIAL", totalEntries: 1, completeEntries: 0 },
      foodCostPercent: null,
      marginPercent: null,
      quadrant: "UNCLASSIFIED",
    });
  });

  it("ignora ingresos null y no los convierte en cero", async () => {
    fixture.sales = [
      { recipeId: "r-complete", quantitySold: "1", revenue: 900, revenueComplete: true },
      { recipeId: "r-partial", quantitySold: "1", revenue: null, revenueComplete: false },
    ];
    const res = await call();
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    const partial = body.items.find((i) => i.recipeId === "r-partial");
    expect(partial).toMatchObject({ reportedRevenueCents: 0, revenueCents: null, foodCostPercent: null });
  });

  it("sin unidades vendidas no publica mediana de margen", async () => {
    fixture.sales = [];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [], medianPopularity: 0, medianMargin: null });
  });

  it("todo parcial deja medianMargin null y ningún cuadrante medido", async () => {
    fixture.sales = [
      { recipeId: "r-complete", quantitySold: "1", revenue: 900, revenueComplete: false },
      { recipeId: "r-partial", quantitySold: "2", revenue: 300, revenueComplete: false },
    ];
    const res = await call();
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; medianMargin: number | null };
    expect(body.medianMargin).toBeNull();
    expect(body.items.every((i) => i.quadrant === "UNCLASSIFIED")).toBe(true);
  });
});
