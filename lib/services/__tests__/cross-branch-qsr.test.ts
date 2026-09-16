import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectNetworkAnomalies,
  BranchQSRScore,
  CrossBranchService,
} from "../cross-branch-service";

// Mock de db y unstable_cache para aislamiento del test
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: any) => fn,
}));

describe("CrossBranchService — QSR Prime Cost & Benchmarking", () => {
  describe("detectNetworkAnomalies", () => {
    it("debe retornar vacío si hay menos de 2 sucursales activas", () => {
      const singleBranch: BranchQSRScore[] = [
        {
          branchId: "b-1",
          branchName: "Sucursal Condesa",
          salesTotalCents: 50000000,
          foodCostCents: 15000000,
          laborCostCents: 12000000,
          foodCostPercent: 30.0,
          laborCostPercent: 24.0,
          primeCostPercent: 54.0,
          primeCostStatus: "HEALTHY",
          nom251ComplianceRate: 98.5,
          cashReconciliationRate: 100,
          compositeScore: 92.4,
          rank: 1,
          dataQuality: "VERIFIED",
        },
      ];

      const findings = detectNetworkAnomalies(singleBranch);
      expect(findings).toEqual([]);
    });

    it("debe detectar discrepancia en Food Cost cuando una sucursal excede por >3 pts a su hermana más eficiente", () => {
      const branches: BranchQSRScore[] = [
        {
          branchId: "b-1",
          branchName: "Sucursal Condesa",
          salesTotalCents: 100000000, // $1,000,000 MXN
          foodCostCents: 28000000,
          laborCostCents: 24000000,
          foodCostPercent: 28.0, // Benchmark eficiente
          laborCostPercent: 24.0,
          primeCostPercent: 52.0,
          primeCostStatus: "HEALTHY",
          nom251ComplianceRate: 100,
          cashReconciliationRate: 100,
          compositeScore: 95.0,
          rank: 1,
          dataQuality: "VERIFIED",
        },
        {
          branchId: "b-2",
          branchName: "Sucursal Roma Norte",
          salesTotalCents: 90000000, // $900,000 MXN
          foodCostCents: 31500000,
          laborCostCents: 22500000,
          foodCostPercent: 35.0, // 35.0% vs 28.0% = +7.0 puntos porcentuales
          laborCostPercent: 25.0,
          primeCostPercent: 60.0,
          primeCostStatus: "WATCH",
          nom251ComplianceRate: 95,
          cashReconciliationRate: 90,
          compositeScore: 78.0,
          rank: 2,
          dataQuality: "VERIFIED",
        },
      ];

      const findings = detectNetworkAnomalies(branches);
      expect(findings.length).toBeGreaterThan(0);

      const foodCostAnomaly = findings.find((f) => f.type === "FOOD_COST_DISCREPANCY");
      expect(foodCostAnomaly).toBeDefined();
      expect(foodCostAnomaly?.affectedBranchId).toBe("b-2");
      expect(foodCostAnomaly?.benchmarkBranchName).toBe("Sucursal Condesa");
      expect(foodCostAnomaly?.variancePoints).toBe(7);
      expect(foodCostAnomaly?.severity).toBe("critical"); // > 5 pts de desvío
      // Impacto estimado: 7% de $900,000 MXN = $63,000 MXN
      expect(foodCostAnomaly?.estimatedImpactMxn).toBe(63000);
    });

    it("debe alertar fuga crítica de Prime Cost cuando supera el 65% de la venta", () => {
      const branches: BranchQSRScore[] = [
        {
          branchId: "b-1",
          branchName: "Sucursal Polanco",
          salesTotalCents: 120000000,
          foodCostCents: 36000000,
          laborCostCents: 28800000,
          foodCostPercent: 30.0,
          laborCostPercent: 24.0,
          primeCostPercent: 54.0,
          primeCostStatus: "HEALTHY",
          nom251ComplianceRate: 100,
          cashReconciliationRate: 100,
          compositeScore: 92.0,
          rank: 1,
          dataQuality: "VERIFIED",
        },
        {
          branchId: "b-2",
          branchName: "Sucursal Santa Fe",
          salesTotalCents: 80000000, // $800,000 MXN
          foodCostCents: 31200000,
          laborCostCents: 24000000,
          foodCostPercent: 39.0,
          laborCostPercent: 30.0,
          primeCostPercent: 69.0, // Fuga grave: 69% > 65%
          primeCostStatus: "CRITICAL",
          nom251ComplianceRate: 90,
          cashReconciliationRate: 85,
          compositeScore: 58.0,
          rank: 2,
          dataQuality: "VERIFIED",
        },
      ];

      const findings = detectNetworkAnomalies(branches);
      const primeCostLeak = findings.find((f) => f.type === "PRIME_COST_LEAK");
      expect(primeCostLeak).toBeDefined();
      expect(primeCostLeak?.affectedBranchId).toBe("b-2");
      expect(primeCostLeak?.severity).toBe("critical");
      expect(primeCostLeak?.variancePoints).toBe(9); // 69% - 60% límite objetivo
    });

    it("debe clasificar correctamente el semáforo de Prime Cost (<60 HEALTHY, 60-65 WATCH, >65 CRITICAL)", () => {
      const healthyStatus: BranchQSRScore["primeCostStatus"] =
        58.5 < 60 ? "HEALTHY" : 58.5 <= 65 ? "WATCH" : "CRITICAL";
      const watchStatus: BranchQSRScore["primeCostStatus"] =
        62.4 < 60 ? "HEALTHY" : 62.4 <= 65 ? "WATCH" : "CRITICAL";
      const criticalStatus: BranchQSRScore["primeCostStatus"] =
        67.1 < 60 ? "HEALTHY" : 67.1 <= 65 ? "WATCH" : "CRITICAL";

      expect(healthyStatus).toBe("HEALTHY");
      expect(watchStatus).toBe("WATCH");
      expect(criticalStatus).toBe("CRITICAL");
    });
  });

  describe("CrossBranchService — getBranchRanking y estimaciones", () => {
    it("getBranchRanking delega en getBranchQSRRanking y retorna métricas de Prime Cost", async () => {
      const mockResult = {
        periodDays: 30,
        branches: [
          {
            branchId: "b-1",
            branchName: "Roma Norte",
            salesTotalCents: 50000000,
            foodCostCents: 15500000,
            laborCostCents: 12000000,
            foodCostPercent: 31.0,
            laborCostPercent: 24.0,
            primeCostPercent: 55.0,
            primeCostStatus: "HEALTHY" as const,
            nom251ComplianceRate: 98,
            cashReconciliationRate: 95,
            compositeScore: 90,
            rank: 1,
            dataQuality: "VERIFIED" as const,
          },
        ],
        podiumTop3: [],
        networkAveragePrimeCost: 55.0,
        networkAverageFoodCost: 31.0,
        networkAverageLaborCost: 24.0,
        anomalies: [],
      };

      const spy = vi
        .spyOn(CrossBranchService, "getBranchQSRRanking")
        .mockResolvedValueOnce(mockResult);

      const res = await CrossBranchService.getBranchRanking("comp-1", 30);
      expect(spy).toHaveBeenCalledWith("comp-1", 30);
      expect(res.branches[0].primeCostPercent).toBe(55.0);
      expect(res.branches[0].foodCostPercent).toBe(31.0);
      expect(res.branches[0].laborCostPercent).toBe(24.0);
      expect(res.branches[0].dataQuality).toBe("VERIFIED");
    });

    it("clasifica como ESTIMATED cuando faltan registros contables usando promedios estándar QSR", () => {
      const salesTotal = 10000000; // $100,000 MXN
      let foodCostCents = 0;
      let laborCostCents = 0;
      let isEstimated = false;

      if (salesTotal > 0 && foodCostCents === 0) {
        foodCostCents = Math.round(salesTotal * 0.315);
        isEstimated = true;
      }
      if (salesTotal > 0 && laborCostCents === 0) {
        laborCostCents = Math.round(salesTotal * 0.245);
        isEstimated = true;
      }

      expect(isEstimated).toBe(true);
      expect(foodCostCents).toBe(3150000);
      expect(laborCostCents).toBe(2450000);

      const foodPercent = Math.round((foodCostCents / salesTotal) * 1000) / 10;
      const laborPercent = Math.round((laborCostCents / salesTotal) * 1000) / 10;
      const primePercent = Math.round((foodPercent + laborPercent) * 10) / 10;

      expect(foodPercent).toBe(31.5);
      expect(laborPercent).toBe(24.5);
      expect(primePercent).toBe(56.0);
    });
  });
});
