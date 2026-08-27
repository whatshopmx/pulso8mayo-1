// lib/services/__tests__/executive-consolidation.test.ts
import { describe, it, expect } from "vitest";

describe("Executive Group Consolidation & Prime Cost Semaphores (Módulo 8)", () => {
  it("computes prime cost percentage and resolves operational semaphores accurately", () => {
    const evaluatePrimeCost = (foodCostPct: number, laborCostPct: number) => {
      const primeCost = Number((foodCostPct + laborCostPct).toFixed(1));
      let status: "OPTIMO" | "ATENCION" | "CRITICO" = "OPTIMO";

      if (primeCost > 65) {
        status = "CRITICO";
      } else if (primeCost > 58) {
        status = "ATENCION";
      }

      return { primeCost, status };
    };

    // San Pedro: 28% Food + 24% Labor = 52% (Óptimo)
    const resSanPedro = evaluatePrimeCost(28.0, 24.0);
    expect(resSanPedro.primeCost).toBe(52.0);
    expect(resSanPedro.status).toBe("OPTIMO");

    // Cumbres: 32% Food + 29% Labor = 61% (Atención)
    const resCumbres = evaluatePrimeCost(32.0, 29.0);
    expect(resCumbres.primeCost).toBe(61.0);
    expect(resCumbres.status).toBe("ATENCION");

    // Tecnológico: 36% Food + 32% Labor = 68% (Crítico)
    const resTec = evaluatePrimeCost(36.0, 32.0);
    expect(resTec.primeCost).toBe(68.0);
    expect(resTec.status).toBe("CRITICO");
  });

  it("consolidates multi-branch financial totals across 3 to 15 branches", () => {
    const branches = [
      { name: "San Pedro", salesCents: 15000000, foodCostCents: 4200000, laborCents: 3600000 },
      { name: "Cumbres", salesCents: 12000000, foodCostCents: 3840000, laborCents: 3480000 },
      { name: "Contry", salesCents: 10000000, foodCostCents: 3100000, laborCents: 2700000 },
    ];

    const totalSales = branches.reduce((acc, b) => acc + b.salesCents, 0);
    const totalFoodCost = branches.reduce((acc, b) => acc + b.foodCostCents, 0);
    const totalLabor = branches.reduce((acc, b) => acc + b.laborCents, 0);

    const groupFoodCostPct = Number(((totalFoodCost / totalSales) * 100).toFixed(1));
    const groupLaborPct = Number(((totalLabor / totalSales) * 100).toFixed(1));
    const groupPrimeCostPct = Number((groupFoodCostPct + groupLaborPct).toFixed(1));

    expect(totalSales).toBe(37000000);
    expect(groupFoodCostPct).toBe(30.1);
    expect(groupLaborPct).toBe(26.4);
    expect(groupPrimeCostPct).toBe(56.5); // <= 58% (Group is Óptimo)
  });
});
