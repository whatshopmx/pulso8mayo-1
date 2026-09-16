import { describe, it, expect, vi, beforeEach } from "vitest";
import { LiveCommandService } from "../live-command-service";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn();
  return {
    db: {
      select: mockSelect,
    },
  };
});

describe("LiveCommandService (Centro de Comando QSR En Vivo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calcula correctamente el semáforo de aperturas, asistencia y ventas de hoy para la red de sucursales", async () => {
    const branchesData = [
      { id: "b-1", name: "Condesa", code: "CND" },
      { id: "b-2", name: "Roma Norte", code: "ROM" },
    ];

    const sessionData = [
      { id: "s-1", branchId: "b-1", status: "ACTIVE", startedAt: new Date("2026-09-16T11:15:00Z") },
      { id: "s-2", branchId: "b-1", status: "ACTIVE", startedAt: new Date("2026-09-16T11:15:00Z") },
      { id: "s-3", branchId: "b-2", status: "ACTIVE", startedAt: new Date("2026-09-16T11:45:00Z") },
    ];

    const tempData = [
      { id: "t-1", branchId: "b-1", readingValue: 2, isCompliant: true, timestamp: new Date() },
      { id: "t-2", branchId: "b-2", readingValue: 8, isCompliant: false, timestamp: new Date() }, // No conforme NOM
    ];

    const salesData = [
      { id: "cut-1", branchId: "b-1", totalSales: 2500000, status: "VALIDATED", businessDate: "2026-09-16" },
      { id: "cut-2", branchId: "b-2", totalSales: 1800000, status: "IN_PROGRESS", businessDate: "2026-09-16" },
    ];

    const incidentData = [
      { id: "inc-1", branchId: "b-2", title: "Cámara de refrigeración a 8°C", severity: "CRITICAL", status: "DETECTED", createdAt: new Date() },
    ];

    const workflowData = [
      { id: "wf-1", branchId: "b-1", status: "COMPLETED", createdAt: new Date("2026-09-16T11:15:00Z"), completedAt: new Date("2026-09-16T11:25:00Z") },
      { id: "wf-2", branchId: "b-2", status: "COMPLETED", createdAt: new Date("2026-09-16T11:45:00Z"), completedAt: new Date("2026-09-16T11:55:00Z") },
    ];

    let selectCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        // branches query
        return {
          from: () => ({
            where: vi.fn().mockResolvedValue(branchesData),
          }),
        } as any;
      }
      if (selectCount === 2) {
        // sessions query
        return {
          from: () => ({
            where: vi.fn().mockResolvedValue(sessionData),
          }),
        } as any;
      }
      if (selectCount === 3) {
        // temps query
        return {
          from: () => ({
            where: () => ({
              orderBy: vi.fn().mockResolvedValue(tempData),
            }),
          }),
        } as any;
      }
      if (selectCount === 4) {
        // sales cuts query
        return {
          from: () => ({
            where: vi.fn().mockResolvedValue(salesData),
          }),
        } as any;
      }
      if (selectCount === 5) {
        // incidents query
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: vi.fn().mockResolvedValue(incidentData),
              }),
            }),
          }),
        } as any;
      }
      if (selectCount === 6) {
        // workflows query
        return {
          from: () => ({
            where: vi.fn().mockResolvedValue(workflowData),
          }),
        } as any;
      }
      return {
        from: () => ({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any;
    });

    const pulse = await LiveCommandService.getLivePulse("company-1");

    expect(pulse.totalBranches).toBe(2);
    expect(pulse.openBranchesCount).toBe(2);
    expect(pulse.openRatePercent).toBe(100);
    expect(pulse.salesTodayCents).toBe(4300000); // 25k + 18k = 43k MXN
    expect(pulse.criticalAlertsCount).toBe(1);

    // Condesa: abrió a tiempo y temperatura en orden
    const condesa = pulse.branches.find((b) => b.branchName === "Condesa");
    expect(condesa).toBeDefined();
    expect(condesa?.nom251.status).toBe("OK");
    expect(condesa?.sales.cutStatus).toBe("VALIDATED");

    // Roma Norte: temperatura en alerta crítica
    const roma = pulse.branches.find((b) => b.branchName === "Roma Norte");
    expect(roma).toBeDefined();
    expect(roma?.nom251.status).toBe("CRITICAL");
    expect(roma?.activeAlerts.length).toBe(1);

    // Alerta de rush presente en la cabecera
    expect(pulse.rushAlerts.length).toBe(1);
    expect(pulse.rushAlerts[0].title).toBe("Cámara de refrigeración a 8°C");
  });
});
