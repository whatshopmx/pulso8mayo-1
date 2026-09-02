import { test, expect } from "@playwright/test";
import { COMPANY_ID } from "./support/constants";
import {
  deleteTestBranch,
  deleteTestSalesCuts,
  getTenantFinanceConfig,
  seedSalesCutConIva,
  seedTestBranch,
  setTenantFinanceConfig,
} from "./support/db";
import { getPnLByBranch } from "../lib/services/pnl-service";
import { buildLaborBurden } from "../lib/services/labor-burden";
import { resolveSalesBase } from "../lib/services/sales-base";

/**
 * Fase 3 / F5 · F6 — la base de los números.
 *
 * `daily_sales_cuts.total_sales` es la venta **con IVA**, pero dos comentarios
 * del repo afirmaban que era neta (`labor-cost-service.ts:533`, encabezado de
 * `pnl-service.ts`) y todos los porcentajes del módulo se dividían entre ella:
 * un food cost real del 34.8% se presentaba como 30%, justo del lado verde del
 * semáforo. El insumo correcto —`tax_amount`— ya se leía del archivo del POS y
 * se acumulaba; el `INSERT` simplemente no lo guardaba.
 *
 * Y el objetivo de nómina (`laborCostTargetPercent`, default 28.00) es un número
 * de industria **cargado**, mientras que lo medido es bruto: el semáforo pintaba
 * verde un 22% bruto que cargado ronda el 29%.
 *
 * No necesita servidor ni Inngest:
 *   pnpm exec playwright test --no-deps --project=chromium tests/base-venta-neta.spec.ts
 */

/** Período fijo, fuera de julio–agosto de 2026, que es lo que ocupa el seed. */
const INICIO = "2026-11-02";
const FIN = "2026-11-08";

let sucursal: string;
let configPrevia: Awaited<ReturnType<typeof getTenantFinanceConfig>>;

test.describe("Fase 3 · la base de los porcentajes", () => {
  test.beforeAll(async () => {
    configPrevia = await getTenantFinanceConfig(COMPANY_ID);
  });

  test.beforeEach(async () => {
    sucursal = await seedTestBranch(COMPANY_ID, "base neta");
  });

  test.afterEach(async () => {
    await deleteTestBranch(sucursal);
    await deleteTestSalesCuts();
  });

  test.afterAll(async () => {
    // La configuración del inquilino es compartida: dejarla movida rompería
    // specs que no tienen nada que ver.
    if (configPrevia) await setTenantFinanceConfig(COMPANY_ID, configPrevia);
  });

  test("un corte con IVA capturado produce base neta MEDIDA", async () => {
    // $11,600 con $1,600 de IVA: la base neta son $10,000 exactos.
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: INICIO,
      totalCents: 1_160_000,
      taxCents: 160_000,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal);
    expect(mia, "el P&L no devolvió la sucursal sembrada").toBeTruthy();

    expect(mia!.salesBase?.kind).toBe("NET_MEASURED");
    expect(mia!.salesBase?.baseCents).toBe(1_000_000);
    // El renglón de ventas sigue mostrando el importe BRUTO: es el dinero que
    // entró y es lo que la dueña reconoce. Lo que cambia es el divisor.
    expect(mia!.sales.cents).toBe(1_160_000);
    expect(mia!.sales.note).toContain("venta neta");
  });

  test("sin IVA capturado se estima con la tasa del grupo y se declara DERIVED", async () => {
    await setTenantFinanceConfig(COMPANY_ID, { vatRatePercent: "16.00" });
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: INICIO,
      totalCents: 1_160_000,
      taxCents: null,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal)!;

    expect(mia.salesBase?.kind).toBe("NET_DERIVED");
    // 1,160,000 / 1.16 = 1,000,000
    expect(mia.salesBase?.baseCents).toBe(1_000_000);
    expect(mia.salesBase?.note).toMatch(/supuesto|estima/i);
  });

  test("con la estimación apagada la base es bruta y lo dice", async () => {
    await setTenantFinanceConfig(COMPANY_ID, { vatRatePercent: null });
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: INICIO,
      totalCents: 1_160_000,
      taxCents: null,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal)!;

    expect(mia.salesBase?.kind).toBe("GROSS_DECLARED");
    expect(mia.salesBase?.baseCents).toBe(1_160_000);
    // Honesto en vez de silencioso: la nota nombra la base que se usó.
    expect(mia.salesBase?.note).toMatch(/CON IVA/i);
  });

  test("un período que mezcla cortes con y sin IVA se resuelve hacia abajo", async () => {
    await setTenantFinanceConfig(COMPANY_ID, { vatRatePercent: "16.00" });
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: INICIO,
      totalCents: 1_160_000,
      taxCents: 160_000,
    });
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: "2026-11-03",
      totalCents: 1_160_000,
      taxCents: null,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal)!;

    // Una suma con un sumando estimado es una estimación completa: es lo más
    // fuerte que se puede afirmar de ella, y el mismo criterio de `weakestOf`.
    expect(mia.salesBase?.kind).toBe("NET_DERIVED");
    expect(mia.salesBase?.cutsWithTax).toBe(1);
    expect(mia.salesBase?.cutsCount).toBe(2);
  });

  test("la utilidad operativa sale de la venta neta, no de la bruta", async () => {
    await seedSalesCutConIva({
      companyId: COMPANY_ID,
      branchId: sucursal,
      businessDate: INICIO,
      totalCents: 1_160_000,
      taxCents: 160_000,
    });

    const pnl = await getPnLByBranch(COMPANY_ID, INICIO, FIN);
    const mia = pnl.find((b) => b.branchId === sucursal)!;

    // El IVA trasladado no es dinero del restaurante: se cobra y se entera al
    // SAT. Restarle los costos a la venta CON IVA inflaba la utilidad
    // exactamente en el impuesto.
    const costos =
      mia.foodCost.cents +
      mia.waste.cents +
      mia.labor.cents +
      mia.operatingExpenses.cents +
      (mia.commissions?.cents ?? 0) +
      (mia.pettyCash?.cents ?? 0);

    expect(mia.operatingProfit.cents).toBe(1_000_000 - costos);
  });
});

test.describe("Fase 3 · resolveSalesBase como función pura", () => {
  test("sin ventas no afirma una base", () => {
    const base = resolveSalesBase({
      grossCents: 0,
      taxCents: 0,
      cutsWithTax: 0,
      cutsCount: 0,
      vatRatePercent: 16,
    });
    expect(base.kind).toBe("GROSS_DECLARED");
    expect(base.note).toMatch(/Sin ventas/i);
  });

  test("una tasa en cero se lee como 'no estimes'", () => {
    const base = resolveSalesBase({
      grossCents: 1_160_000,
      taxCents: 0,
      cutsWithTax: 0,
      cutsCount: 3,
      vatRatePercent: 0,
    });
    expect(base.kind).toBe("GROSS_DECLARED");
    expect(base.baseCents).toBe(1_160_000);
  });
});

test.describe("Fase 3 · carga patronal (A3.3)", () => {
  test("sin factor capturado la nota dice BRUTA y no hay total", () => {
    const b = buildLaborBurden(null, null);
    expect(b.totalPercent).toBeNull();
    expect(b.nota).toMatch(/BRUTA/);
    // El punto de A3.3: la nota explica por qué el semáforo no pinta.
    expect(b.nota).toMatch(/objetivo de industria/i);
  });

  test("el ISN estatal es línea propia dentro del factor", () => {
    // Nuevo León cobra 3%. No es constante de módulo: la CDMX cobra 4% y
    // Jalisco 2%, y un grupo con sucursales en dos estados no tiene una tasa.
    const b = buildLaborBurden(25, 3);
    expect(b.totalPercent).toBe(28);
    expect(b.nota).toMatch(/25% de carga patronal/);
    expect(b.nota).toMatch(/3% de ISN estatal/);
    expect(b.nota).toMatch(/no un cálculo de IMSS/i);
  });

  test("sólo el ISN también cuenta", () => {
    const b = buildLaborBurden(null, 3);
    expect(b.totalPercent).toBe(3);
    expect(b.nota).toMatch(/CARGADA/);
  });
});
