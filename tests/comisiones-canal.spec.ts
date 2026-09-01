import { test, expect } from "@playwright/test";
import { BRANCH_ROMA, COMPANY_ID } from "./support/constants";
import {
  deleteTestCommissionRates,
  deleteTestSalesCuts,
  seedCommissionRate,
  seedCutConCanales,
} from "./support/db";
import { getCommissionsByBranch } from "../lib/services/commission-service";
import { computeTpvVariance } from "../lib/sales/cash-variance";

/**
 * Fase 4 — comisiones por canal y conciliación de terminal.
 *
 * Estos casos llaman al servicio directo: no necesitan servidor ni el dev de
 * Inngest, así que corren en segundos con
 * `pnpm exec playwright test --no-deps --project=chromium tests/comisiones-canal.spec.ts`.
 *
 * Las fechas de negocio van en **2029** a propósito. El seed ocupa julio y
 * agosto de 2026, y un caso que sume sus cortes a los sembrados sólo pasa contra
 * una base recién sembrada — verifica el estado de la base, no el código.
 */

const DIA = "2029-04-15";
const DIA_PREVIO = "2029-03-15";
const VIGENCIA = "2029-04-01";

test.describe("Comisiones por canal", () => {
  test.beforeEach(async () => {
    await deleteTestSalesCuts();
    await deleteTestCommissionRates();
  });

  test.afterAll(async () => {
    await deleteTestSalesCuts();
    await deleteTestCommissionRates();
  });

  test("la comisión se calcula con la tarifa vigente y el canal sin tarifa se omite", async () => {
    await seedCommissionRate({
      companyId: COMPANY_ID,
      channel: "rappi",
      rateBps: 2750,
      effectiveFrom: VIGENCIA,
    });

    await seedCutConCanales({
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      businessDate: DIA,
      cashSales: 500_000,
      cardSales: 300_000,
      aggregatorSales: { rappi: 1_000_000, uber: 400_000 },
    });

    const [fila] = (await getCommissionsByBranch(COMPANY_ID, DIA, DIA)).filter(
      (r) => r.branchId === BRANCH_ROMA,
    );

    const rappi = fila.channels.find((c) => c.channel === "rappi");
    expect(rappi?.commissionCents).toBe(275_000); // 27.50% de $10,000
    expect(rappi?.rateBps).toBe(2750);

    // Sin tarifa no se inventa una tasa de mercado: el canal no aparece y su
    // venta se declara como no cubierta.
    expect(fila.channels.some((c) => c.channel === "uber")).toBe(false);
    expect(fila.channels.some((c) => c.channel === "tpv")).toBe(false);
    expect(fila.uncoveredSalesCents).toBe(700_000); // Uber $4,000 + tarjeta $3,000

    // El efectivo no cobra comisión: no cuenta como hueco de información.
    expect(fila.channels.some((c) => c.channel === "mostrador")).toBe(false);

    // Es un cálculo, no una medición.
    expect(fila.source).toBe("ESTIMATED");
  });

  test("un corte anterior a la vigencia no se valúa con la tarifa de hoy", async () => {
    await seedCommissionRate({
      companyId: COMPANY_ID,
      channel: "rappi",
      rateBps: 2750,
      effectiveFrom: VIGENCIA,
    });

    await seedCutConCanales({
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      businessDate: DIA_PREVIO,
      aggregatorSales: { rappi: 1_000_000 },
    });

    const [fila] = (await getCommissionsByBranch(COMPANY_ID, DIA_PREVIO, DIA_PREVIO)).filter(
      (r) => r.branchId === BRANCH_ROMA,
    );

    // Recalcular el pasado con la tarifa nueva movería el histórico solo, que es
    // el problema que `pnl-snapshot-service` documenta para el food cost.
    expect(fila.channels).toHaveLength(0);
    expect(fila.source).toBe("NO_DATA");
    expect(fila.uncoveredSalesCents).toBe(1_000_000);
  });

  test("la comisión conciliada de la terminal desplaza a la estimada", async () => {
    await seedCommissionRate({
      companyId: COMPANY_ID,
      channel: "tpv",
      rateBps: 300,
      effectiveFrom: VIGENCIA,
    });

    await seedCutConCanales({
      companyId: COMPANY_ID,
      branchId: BRANCH_ROMA,
      businessDate: DIA,
      cardSales: 1_000_000,
      // La terminal cobró $270, no los $300 que dice la tarifa.
      commissionCents: 27_000,
      tpvDepositCents: 973_000,
    });

    const [fila] = (await getCommissionsByBranch(COMPANY_ID, DIA, DIA)).filter(
      (r) => r.branchId === BRANCH_ROMA,
    );

    const tpv = fila.channels.find((c) => c.channel === "tpv");
    expect(tpv?.commissionCents).toBe(27_000);
    expect(tpv?.measuredCents).toBe(27_000);
    expect(tpv?.estimatedCents).toBe(0);
    expect(fila.source).toBe("MEASURED");
  });
});

test.describe("Conciliación TPV", () => {
  test("la varianza sale de depósito + comisión contra la venta con tarjeta", () => {
    // El caso de verificación del plan: $10,000 de tarjeta, $9,700 de depósito y
    // $300 de comisión cuadran.
    expect(
      computeTpvVariance({
        cardSales: 1_000_000,
        tpvDepositCents: 970_000,
        commissionCents: 30_000,
      })?.varianceCents,
    ).toBe(0);

    const menor = computeTpvVariance({
      cardSales: 1_000_000,
      tpvDepositCents: 950_000,
      commissionCents: 30_000,
    })!;
    expect(menor.varianceCents).toBe(-20_000);
    expect(menor.direction).toBe("faltante");
  });

  test("sin depósito capturado no hay varianza (null no es cero)", () => {
    // Un corte sin conciliar no está cuadrado: pintarlo en $0.00 afirmaría que
    // el banco ya depositó.
    expect(
      computeTpvVariance({
        cardSales: 1_000_000,
        tpvDepositCents: null,
        commissionCents: 30_000,
      }),
    ).toBeNull();

    expect(
      computeTpvVariance({ cardSales: null, tpvDepositCents: 970_000, commissionCents: null }),
    ).toBeNull();
  });

  test("sin comisión capturada la varianza se declara incompleta", () => {
    // Un faltante del orden de la tasa negociada es lo ESPERADO cuando la
    // comisión no se capturó; la bandera es lo que deja a la UI decirlo en vez
    // de acusar.
    const sinComision = computeTpvVariance({
      cardSales: 1_000_000,
      tpvDepositCents: 970_000,
      commissionCents: null,
    })!;
    expect(sinComision.commissionCaptured).toBe(false);
    expect(sinComision.direction).toBe("faltante");
  });
});
