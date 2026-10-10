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

/**
 * Cadena de consulta que es a la vez encadenable y *promesa*.
 *
 * Dos razones por las que el arnés anterior se quedó corto:
 *
 * 1. `getLivePulse` termina varias consultas con `.catch(() => [])` para que un
 *    fallo de una fuente no tumbe el semáforo entero. Un objeto plano no tiene
 *    `catch`, y la suite moría con `.catch is not a function` en
 *    `live-command-service.ts:213`. Esta cadena implementa `then`/`catch`, así
 *    que sirve tanto para el `Promise.allSettled` como para el `.catch()`.
 * 2. `plannedShifts` se añadió como séptima consulta y el arnés, que fijaba
 *    datos por número de `select`, seguía devolviendo una cadena distinta para
 *    cada índice. Aquí el orden se declara una vez, junto a los datos.
 */
function cadenaDeSelect(valor: unknown) {
  const promesa = Promise.resolve(valor);
  const cadena: Record<string, unknown> = {
    then: (...args: unknown[]) => promesa.then(...(args as never[])),
    catch: (...args: unknown[]) => promesa.catch(...(args as never[])),
    finally: (...args: unknown[]) => promesa.finally(...(args as never[])),
  };

  for (const metodo of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin", "groupBy", "having"]) {
    cadena[metodo] = () => cadena;
  }

  return cadena;
}

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

    // El orden importa y es el de `getLivePulse`: sucursales, sesiones,
    // temperaturas, cortes, incidentes, workflows de hoy, dotación publicada.
    const respuestas = [
      branchesData,
      sessionData,
      tempData,
      salesData,
      incidentData,
      workflowData,
      [], // plannedShifts publicados: este escenario no los usa
    ];

    let selectCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      return cadenaDeSelect(respuestas[selectCount++] ?? []);
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
