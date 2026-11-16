import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { branches } from "@/lib/db/schema";
import { saleRevenueComplete } from "../sale-revenue-coverage";

const fixture = vi.hoisted(() => ({ sales: [] as unknown[], fail: false, branchAllowed: true }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => {
  if (fixture.fail) throw new Error("consulta fallida");
  return fixture.sales;
} }) }) } }));
vi.mock("@/lib/db/tenant-context", () => ({
  withCompanyContext: async (_scope: unknown, fn: (tx: unknown) => unknown) => {
    if (fixture.fail) throw new Error("consulta fallida");
    return fn({ select: () => ({ from: (table: unknown) => ({ where: async () => table === branches ? (fixture.branchAllowed ? [{ id: "b" }] : []) : fixture.sales }) }) });
  },
}));
import { InventoryReportsService } from "../inventory-reports-service";
vi.mock("@/lib/tenant-context", () => ({
  requireTenant: async () => ({ id: "c" }),
  requireAuth: async () => ({ user: { role: "ADMIN", branchId: "b" } }),
}));
import { GET } from "@/app/api/inventory/reports/cogs/route";
import { NextRequest } from "next/server";

describe("INV-01.b4.coverage.cogs: cobertura canónica SQL", () => {
  const pg = new PGlite();
  beforeAll(async () => {
    await pg.exec(`CREATE TABLE sales_entries (company_id text, branch_id text, recipe_id text, sale_date timestamp, total_revenue int, quantity_sold numeric);
      CREATE TABLE sales_consumption_identities (id text, company_id text, branch_id text, sale_day date);
      CREATE TABLE sales_consumption_revisions (identity_id text, company_id text, branch_id text, recipe_id text, revision int, quantity_sold numeric, total_revenue int);`);
  }, 60_000);
  afterAll(() => pg.close());
  async function check(revisions: string, identities = "('i','c','b','2026-11-16')", revenue = 0, qty = 1) {
    await pg.exec("TRUNCATE sales_entries, sales_consumption_identities, sales_consumption_revisions");
    await pg.query("INSERT INTO sales_entries VALUES ('c','b','recipe','2026-11-16',$1,$2)", [revenue, qty]);
    if (identities) await pg.exec(`INSERT INTO sales_consumption_identities VALUES ${identities}`);
    if (revisions) await pg.exec(`INSERT INTO sales_consumption_revisions VALUES ${revisions}`);
    const query = new PgDialect().sqlToQuery(sql`SELECT ${saleRevenueComplete} AS complete FROM sales_entries`);
    return (await pg.query<{ complete: boolean }>(query.sql, query.params)).rows[0].complete;
  }
  it("no convierte ingreso ausente ni venta legada en cero confirmado", async () => {
    expect(await check("('i','c','b','recipe',1,1,null)")).toBe(false);
    expect(await check("", "")).toBe(false);
    expect(await check("", "", 900)).toBe(false);
  });
  it("acepta cero explícito y solo la revisión vigente", async () => {
    expect(await check("('i','c','b','recipe',1,1,0)")).toBe(true);
    expect(await check("('i','c','b','recipe',1,1,null),('i','c','b','recipe',2,1,900)", undefined, 900)).toBe(true);
    expect(await check("('i','c','b','recipe',1,1,900),('i','c','b','recipe',2,1,null)")).toBe(false);
  });
  it("no revive una revisión anterior después de remapear receta", async () => {
    expect(await check("('i','c','b','recipe',1,1,0),('i','c','b','other',2,1,0)")).toBe(false);
  });
  it("exige todas las fuentes y coherencia de importe y cantidad", async () => {
    const ids = "('i','c','b','2026-11-16'),('j','c','b','2026-11-16')";
    expect(await check("('i','c','b','recipe',1,1,900),('j','c','b','recipe',1,1,null)", ids, 900, 2)).toBe(false);
    expect(await check("('i','c','b','recipe',1,1,900)", undefined, 800)).toBe(false);
    expect(await check("('i','c','b','recipe',1,2,900)", undefined, 900)).toBe(false);
  });
  it("no toma cobertura de otra empresa, sucursal ni día", async () => {
    for (const [company, branch, day] of [["x", "b", "2026-11-16"], ["c", "x", "2026-11-16"], ["c", "b", "2026-11-15"]]) {
      expect(await check(`('i','${company}','${branch}','recipe',1,1,0)`, `('i','${company}','${branch}','${day}')`)).toBe(false);
    }
  });
});

describe("reporte COGS", () => {
  const costing = InventoryReportsService as unknown as {
    buildRecipeCostIndex: () => Promise<{
      nodes: Map<string, { leaves: Array<{ itemId: string; qtyPerYield: number }> }>;
      itemCosts: Map<string, number>;
    }>;
    fetchRecipeNames: () => Promise<Map<string, string>>;
  };
  async function report(sales: unknown[]) {
    fixture.sales = sales; fixture.fail = false; fixture.branchAllowed = true;
    vi.spyOn(costing, "buildRecipeCostIndex").mockResolvedValue({ nodes: new Map(), itemCosts: new Map() });
    vi.spyOn(costing, "fetchRecipeNames").mockResolvedValue(new Map());
    return InventoryReportsService.getCogsReport("c", "b", new Date("2026-11-16"), new Date("2026-11-17"));
  }
  it("conserva subtotal parcial sin publicar porcentaje", async () => {
    const result = await report([{ recipeId: "r", quantitySold: "2", revenue: 900, revenueComplete: false }]);
    expect(result).toMatchObject({ reportedRevenueCents: 900, revenueCents: null, foodCostPercent: null,
      revenueCoverage: { status: "PARTIAL", totalEntries: 1, completeEntries: 0 } });
  });
  it("vacío y cero explícito no tienen denominador para porcentaje", async () => {
    expect(await report([])).toMatchObject({ revenueCents: null, foodCostPercent: null, revenueCoverage: { status: "NO_DATA" } });
    expect(await report([{ recipeId: "r", quantitySold: "1", revenue: 0, revenueComplete: true }])).toMatchObject({ revenueCents: 0, foodCostPercent: null, revenueCoverage: { status: "COMPLETE" } });
  });
  it("calcula cero real de costo solo con ingreso completo positivo", async () => {
    expect(await report([{ recipeId: "r", quantitySold: "1", revenue: 900, revenueComplete: true }])).toMatchObject({ revenueCents: 900, foodCostPercent: 0 });
  });
  it("calcula porcentaje con costo e ingreso completos usando un oráculo independiente", async () => {
    await report([]);
    vi.spyOn(costing, "buildRecipeCostIndex").mockResolvedValue({
      nodes: new Map([["r", { leaves: [{ itemId: "ingredient", qtyPerYield: 0.5 }] }]]),
      itemCosts: new Map([["ingredient", 200]]),
    });
    fixture.sales = [{ recipeId: "r", quantitySold: "3", revenue: 1200, revenueComplete: true }];
    // Tres porciones × medio insumo × $2 = $3; $3 / $12 = 25%.
    expect(await InventoryReportsService.getCogsReport("c", "b", new Date("2026-11-16"), new Date("2026-11-17")))
      .toMatchObject({ cogsCents: 300, revenueCents: 1200, foodCostPercent: 25 });
  });
  it("propaga errores de consulta", async () => {
    fixture.fail = true;
    await expect(InventoryReportsService.getCogsReport("c", "b", new Date(), new Date())).rejects.toThrow("consulta fallida");
    fixture.fail = false;
  });
  it("rechaza una sucursal fuera de la empresa", async () => {
    fixture.branchAllowed = false;
    await expect(InventoryReportsService.getCogsReport("c", "foreign", new Date(), new Date())).rejects.toThrow("Sucursal fuera de la empresa");
    fixture.branchAllowed = true;
  });
  it("la ruta entrega cobertura parcial y rechaza sucursal ajena", async () => {
    await report([{ recipeId: "r", quantitySold: "1", revenue: 900, revenueComplete: false }]);
    const request = () => new NextRequest("http://localhost/api/inventory/reports/cogs?branchId=b&startDate=2026-11-16&endDate=2026-11-17");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).report).toMatchObject({ revenueCents: null, foodCostPercent: null, reportedRevenueCents: 900 });
    fixture.branchAllowed = false;
    const denied = await GET(request());
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("report");
    fixture.branchAllowed = true;
  });
});
