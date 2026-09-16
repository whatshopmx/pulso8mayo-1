import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroupExceptionsService } from "../group-exceptions-service";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => {
  const mockSelect = vi.fn();
  return {
    db: {
      select: mockSelect,
    },
  };
});

describe("GroupExceptionsService (QSR Multi-Unit Risk Triage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clasifica excepciones en categorías QSR (DINERO, INOCUIDAD, ABASTO, PERSONAL) con metadatos de acción", async () => {
    const mockFrom = vi.fn();
    const mockInnerJoin = vi.fn();
    const mockLeftJoin = vi.fn();
    const mockWhere = vi.fn();

    // Setup chained mocks for each table query
    // 1. incidents (temperatura refrigerador -> INOCUIDAD)
    const incidentData = [
      {
        id: "inc-1",
        branchId: "b-1",
        branchName: "Condesa",
        severity: "CRITICAL",
        status: "DETECTED",
        title: "Temperatura de refrigerador fuera de rango",
        description: "Cámara fría a 8°C por más de 30 min",
        assignedTo: null,
        detectedAt: new Date("2026-09-16T10:00:00Z"),
        resolvedAt: null,
        resolution: null,
      },
    ];

    // 2. complianceAlerts (NOM-251 -> INOCUIDAD)
    const complianceData = [
      {
        id: "comp-1",
        branchId: "b-1",
        branchName: "Condesa",
        severity: "WARNING",
        status: "ACTIVE",
        title: "Verificación de cloro en agua pendiente",
        description: null,
        assignedTo: null,
        detectedAt: new Date("2026-09-16T09:00:00Z"),
        resolvedAt: null,
        resolution: null,
      },
    ];

    // 3. equipmentAlerts (Mantenimiento freidora -> INOCUIDAD)
    const equipmentData = [];

    // 4. nom035 (Plan de acción -> PERSONAL)
    const nom035Data = [];

    // 5. shiftApprovals (Turno pendiente -> PERSONAL)
    const shiftApprovalData = [
      {
        id: "shift-app-1",
        branchId: "b-2",
        branchName: "Roma Norte",
        title: "Aprobación de turno vespertino",
        description: "Dotación de 4 parrilleros",
        requestedFor: "user-123",
        detectedAt: new Date("2026-09-16T08:30:00Z"),
      },
    ];

    // 6. shiftChange (Cambio de turno -> PERSONAL)
    const shiftChangeData = [];

    // 7. inventoryAlerts (Stock bajo carne -> ABASTO)
    const inventoryData = [
      {
        id: "inv-1",
        branchId: "b-1",
        branchName: "Condesa",
        severity: "ALTA",
        status: "ACTIVE",
        type: "LOW_STOCK",
        detectedAt: new Date("2026-09-16T11:00:00Z"),
        resolvedAt: null,
        resolvedBy: null,
        notes: "Solo quedan 5 kg de carne marinada para el rush",
      },
    ];

    // 8. dailySalesCuts (Faltante de caja -$250 MXN -> DINERO)
    const salesCutData = [
      {
        id: "cut-1",
        branchId: "b-2",
        branchName: "Roma Norte",
        businessDate: "2026-09-15",
        shift: "VESPERTINO",
        status: "PENDING_REVIEW",
        cashSales: 50000, // $500.00 MXN esperado
        cashCountedCents: 25000, // $250.00 MXN contado (faltante $250.00 MXN)
        totalSales: 150000,
        detectedAt: new Date("2026-09-16T01:00:00Z"),
      },
    ];

    const responses = [
      incidentData,
      complianceData,
      equipmentData,
      nom035Data,
      shiftApprovalData,
      shiftChangeData,
      inventoryData,
      salesCutData,
    ];

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      const currentIdx = callCount++;
      const currentResponse = responses[currentIdx] || [];
      return {
        from: () => ({
          innerJoin: () => ({
            where: vi.fn().mockResolvedValue(currentResponse),
          }),
          leftJoin: () => ({
            where: vi.fn().mockResolvedValue(currentResponse),
          }),
        }),
      } as any;
    });

    const exceptions = await GroupExceptionsService.listOpen("company-1");

    expect(exceptions.length).toBe(5);

    // Verificar clasificación por categorías QSR
    const categories = exceptions.map((e) => e.qsrCategory);
    expect(categories).toContain("INOCUIDAD");
    expect(categories).toContain("ABASTO");
    expect(categories).toContain("PERSONAL");
    expect(categories).toContain("DINERO");

    // Verificar que el faltante de caja está en DINERO y tiene acción de auditar caja
    const cashException = exceptions.find((e) => e.qsrCategory === "DINERO");
    expect(cashException).toBeDefined();
    expect(cashException?.action?.type).toBe("AUDIT_DRAWER");
    expect(cashException?.title).toContain("Faltante de caja en turno VESPERTINO");

    // Verificar que el stock bajo está en ABASTO y tiene acción de transferir insumos
    const stockException = exceptions.find((e) => e.qsrCategory === "ABASTO");
    expect(stockException).toBeDefined();
    expect(stockException?.action?.type).toBe("TRANSFER_STOCK");

    // Verificar ordenamiento: el incidente crítico de frío debe encabezar la lista
    expect(exceptions[0].severity).toBe("critical");
    expect(exceptions[0].qsrCategory).toBe("INOCUIDAD");
  });

  it("permite filtrar exclusivamente por categoría QSR (opts.qsrCategory)", async () => {
    let callCount = 0;
    const inventoryOnly = [
      {
        id: "inv-2",
        branchId: "b-1",
        branchName: "Condesa",
        severity: "CRITICA",
        status: "ACTIVE",
        type: "OUT_OF_STOCK",
        detectedAt: new Date(),
        resolvedAt: null,
        resolvedBy: null,
        notes: "Sin pan brioche",
      },
    ];

    vi.mocked(db.select).mockImplementation(() => {
      const currentIdx = callCount++;
      const currentResponse = currentIdx === 6 ? inventoryOnly : [];
      return {
        from: () => ({
          innerJoin: () => ({
            where: vi.fn().mockResolvedValue(currentResponse),
          }),
          leftJoin: () => ({
            where: vi.fn().mockResolvedValue(currentResponse),
          }),
        }),
      } as any;
    });

    const abastoExceptions = await GroupExceptionsService.listOpen("company-1", {
      qsrCategory: "ABASTO",
    });

    expect(abastoExceptions.length).toBe(1);
    expect(abastoExceptions[0].qsrCategory).toBe("ABASTO");
    expect(abastoExceptions[0].title).toBe("Desabasto de insumo en turno");
  });
});
