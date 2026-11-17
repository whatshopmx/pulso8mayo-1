import { describe, expect, it } from "vitest";
import {
  ExecutiveReportService,
  computeRevenueCoverage,
  mergeCoverage,
  foodCostPercentOf,
  type BranchKPI,
  type RevenueCoverage,
} from "../executive-report-service";

function kpi(partial: {
  foodCostPercent?: number | null;
  cogsCents?: number;
  reportedRevenueCents?: number;
  revenueCents?: number | null;
  revenueCoverage?: RevenueCoverage;
  inventoryTurnover?: number;
  stockDays?: number;
  shrinkagePercent?: number;
  fillRate?: number;
}): BranchKPI {
  return {
    branchId: "b",
    branchName: "Sucursal",
    foodCostPercent: partial.foodCostPercent ?? null,
    cogsCents: partial.cogsCents ?? 0,
    reportedRevenueCents: partial.reportedRevenueCents ?? 0,
    revenueCents: partial.revenueCents ?? null,
    revenueCoverage: partial.revenueCoverage ?? { status: "NO_DATA", totalEntries: 0, completeEntries: 0 },
    inventoryTurnover: partial.inventoryTurnover ?? 0,
    stockDays: partial.stockDays ?? 0,
    shrinkagePercent: partial.shrinkagePercent ?? 0,
    fillRate: partial.fillRate ?? 100,
    countAccuracy: null,
  };
}

describe("computeRevenueCoverage", () => {
  it("vacío es NO_DATA sin denominador", () => {
    expect(computeRevenueCoverage([])).toEqual({
      reportedRevenueCents: 0,
      revenueCents: null,
      coverage: { status: "NO_DATA", totalEntries: 0, completeEntries: 0 },
    });
  });

  it("ingreso null no se convierte en cero ni en completo", () => {
    const r = computeRevenueCoverage([{ revenue: null, revenueComplete: false }]);
    expect(r).toMatchObject({
      reportedRevenueCents: 0,
      revenueCents: null,
      coverage: { status: "PARTIAL", totalEntries: 1, completeEntries: 0 },
    });
  });

  it("cero explícito completo es COMPLETE sin porcentaje", () => {
    const r = computeRevenueCoverage([{ revenue: 0, revenueComplete: true }]);
    expect(r).toMatchObject({
      reportedRevenueCents: 0,
      revenueCents: 0,
      coverage: { status: "COMPLETE", totalEntries: 1, completeEntries: 1 },
    });
  });

  it("una fila incompleta contamina el subtotal", () => {
    const r = computeRevenueCoverage([
      { revenue: 900, revenueComplete: true },
      { revenue: null, revenueComplete: false },
    ]);
    expect(r).toMatchObject({
      reportedRevenueCents: 900,
      revenueCents: null,
      coverage: { status: "PARTIAL", totalEntries: 2, completeEntries: 1 },
    });
  });
});

describe("mergeCoverage", () => {
  it("lista vacía es NO_DATA", () => {
    expect(mergeCoverage([])).toEqual({ status: "NO_DATA", totalEntries: 0, completeEntries: 0 });
  });

  it("COMPLETE + NO_DATA consolida COMPLETE", () => {
    expect(
      mergeCoverage([
        { status: "COMPLETE", totalEntries: 2, completeEntries: 2 },
        { status: "NO_DATA", totalEntries: 0, completeEntries: 0 },
      ]),
    ).toEqual({ status: "COMPLETE", totalEntries: 2, completeEntries: 2 });
  });

  it("una sucursal parcial contamina el total", () => {
    expect(
      mergeCoverage([
        { status: "COMPLETE", totalEntries: 2, completeEntries: 2 },
        { status: "PARTIAL", totalEntries: 1, completeEntries: 0 },
      ]),
    ).toEqual({ status: "PARTIAL", totalEntries: 3, completeEntries: 2 });
  });
});

describe("foodCostPercentOf", () => {
  it("nunca calcula contra subtotal (null) ni contra cero", () => {
    expect(foodCostPercentOf(300, null)).toBeNull();
    expect(foodCostPercentOf(300, 0)).toBeNull();
  });

  it("calcula solo con total firme positivo", () => {
    expect(foodCostPercentOf(300, 1200)).toBe(25);
  });
});

describe("consolidateKPIs (propagación a consolidado)", () => {
  const consolidate = ExecutiveReportService as unknown as {
    consolidateKPIs: (branches: BranchKPI[], startDate: Date, endDate: Date) => BranchKPI;
  };

  it("consolidado COMPLETE con revenue firme y food cost", () => {
    const out = consolidate.consolidateKPIs(
      [
        kpi({ reportedRevenueCents: 900, revenueCents: 900, cogsCents: 180, revenueCoverage: { status: "COMPLETE", totalEntries: 2, completeEntries: 2 }, foodCostPercent: 20 }),
        kpi({ reportedRevenueCents: 0, revenueCents: null, cogsCents: 0, revenueCoverage: { status: "NO_DATA", totalEntries: 0, completeEntries: 0 } }),
      ],
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    expect(out.revenueCoverage).toEqual({ status: "COMPLETE", totalEntries: 2, completeEntries: 2 });
    expect(out.reportedRevenueCents).toBe(900);
    expect(out.revenueCents).toBe(900);
    expect(out.foodCostPercent).toBe(20);
  });

  it("consolidado PARTIAL no publica revenue firme ni food cost", () => {
    const out = consolidate.consolidateKPIs(
      [
        kpi({ reportedRevenueCents: 900, revenueCents: 900, cogsCents: 180, revenueCoverage: { status: "COMPLETE", totalEntries: 2, completeEntries: 2 } }),
        kpi({ reportedRevenueCents: 300, revenueCents: null, cogsCents: 120, revenueCoverage: { status: "PARTIAL", totalEntries: 1, completeEntries: 0 } }),
      ],
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    expect(out.revenueCoverage).toEqual({ status: "PARTIAL", totalEntries: 3, completeEntries: 2 });
    expect(out.reportedRevenueCents).toBe(1200);
    expect(out.revenueCents).toBeNull();
    expect(out.foodCostPercent).toBeNull();
  });
});
