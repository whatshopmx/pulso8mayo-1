import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 0 / Tasks 5 y 7 — adaptadores.
 *
 * `@/lib/db` se reemplaza por un doble en memoria y las condiciones de
 * `drizzle-orm` por predicados evaluables, de modo que dos consultas a la misma
 * tabla con `where` distinto devuelven conjuntos distintos (caso `invoices`:
 * DISCREPANCY vs EXCEPTION_APPROVED).
 */

const TAG = "exception-adapters-test.pred";

const h = vi.hoisted(() => {
  const fixtures = new Map<string, Record<string, unknown>[]>();
  const raised = new Map<string, Record<string, unknown>>();
  return { fixtures, raised };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  const colKey = (col: unknown): string | null => {
    const name = (col as { name?: unknown })?.name;
    if (typeof name !== "string") return null;
    return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  };
  const evaluate = (cond: unknown, row: Record<string, unknown>): boolean => {
    if (!cond || typeof cond !== "object") return true;
    for (const s of Object.getOwnPropertySymbols(cond)) {
      const v = (cond as Record<symbol, unknown>)[s];
      if (typeof v === "function") return (v as (r: unknown) => boolean)(row);
    }
    return true;
  };
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({
      [Symbol.for("exception-adapters-test.pred")]: (row: Record<string, unknown>) =>
        row[colKey(col) as string] === val,
    }),
    ne: (col: unknown, val: unknown) => ({
      [Symbol.for("exception-adapters-test.pred")]: (row: Record<string, unknown>) =>
        row[colKey(col) as string] !== val,
    }),
    isNotNull: (col: unknown) => ({
      [Symbol.for("exception-adapters-test.pred")]: (row: Record<string, unknown>) =>
        row[colKey(col) as string] !== null &&
        row[colKey(col) as string] !== undefined,
    }),
    inArray: (col: unknown, vals: unknown[]) => ({
      [Symbol.for("exception-adapters-test.pred")]: (row: Record<string, unknown>) =>
        Array.isArray(vals) && vals.includes(row[colKey(col) as string]),
    }),
    and: (...conds: unknown[]) => ({
      [Symbol.for("exception-adapters-test.pred")]: (row: Record<string, unknown>) =>
        conds.filter(Boolean).every((c) => evaluate(c, row)),
    }),
    desc: (col: unknown) => ({ __desc: colKey(col) }),
  };
});

vi.mock("@/lib/db", () => {
  const evaluate = (cond: unknown, row: Record<string, unknown>): boolean => {
    if (!cond || typeof cond !== "object") return true;
    for (const s of Object.getOwnPropertySymbols(cond)) {
      const v = (cond as Record<symbol, unknown>)[s];
      if (typeof v === "function") return (v as (r: unknown) => boolean)(row);
    }
    return true;
  };
  const tableName = (table: unknown): string => {
    if (!table || typeof table !== "object") return "unknown";
    const sym = Object.getOwnPropertySymbols(table).find(
      (s) => s.toString() === "Symbol(drizzle:Name)",
    );
    return sym ? String((table as Record<symbol, unknown>)[sym]) : "unknown";
  };
  const makeSelect = () => {
    let table: unknown;
    let cond: unknown;
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      where(c: unknown) {
        cond = c;
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      then(resolve: (v: unknown) => unknown) {
        const rows = (h.fixtures.get(tableName(table)) ?? []).filter((r) =>
          evaluate(cond, r),
        );
        resolve(rows.map((r) => ({ ...r })));
      },
    };
    return chain;
  };
  return { db: { select: () => makeSelect() } };
});

vi.mock("@/lib/services/exception-service", () => ({
  ExceptionService: {
    raise: vi.fn(async (input: Record<string, unknown>) => {
      const key = `${input.companyId}|${input.subjectType}|${input.subjectId}`;
      if (h.raised.has(key)) return h.raised.get(key);
      const row = { id: `exc-${h.raised.size + 1}`, status: "OPEN", ...input };
      h.raised.set(key, row);
      return row;
    }),
    getBySubject: vi.fn(
      async (companyId: string, subjectType: string, subjectId: string) =>
        h.raised.get(`${companyId}|${subjectType}|${subjectId}`) ?? null,
    ),
    cancel: vi.fn(
      async (id: string, _companyId: string, _actorId: string, reason: string) => {
        for (const row of h.raised.values()) {
          if (row.id === id) {
            row.status = "CANCELLED";
            row.cancelReason = reason;
            return row;
          }
        }
        return { id, status: "CANCELLED" };
      },
    ),
  },
}));

import { ExceptionService } from "@/lib/services/exception-service";
import { incidentAdapter } from "../exception-adapters/incident";
import { inventoryAlertAdapter } from "../exception-adapters/inventory-alert";
import { complianceAlertAdapter } from "../exception-adapters/compliance-alert";
import { equipmentAlertAdapter } from "../exception-adapters/equipment-alert";
import { cashVarianceAdapter } from "../exception-adapters/cash-variance";
import { invoiceDiscrepancyAdapter } from "../exception-adapters/invoice-discrepancy";
import { runExceptionAdapters } from "../exception-adapters";

const COMPANY = "company-1";
const SCOPE = { companyId: COMPANY, branchId: null };

function lastRaiseCall() {
  const calls = vi.mocked(ExceptionService.raise).mock.calls;
  return calls[calls.length - 1][0] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  h.fixtures.clear();
  h.raised.clear();
  vi.clearAllMocks();
});

describe("incidentAdapter", () => {
  beforeEach(() => {
    h.fixtures.set("incidents", [
      {
        id: "i1",
        companyId: COMPANY,
        branchId: "b1",
        severity: "CRITICAL",
        status: "DETECTED",
        title: "Temperatura alta en cámara",
        description: "8°C",
        detectedAt: new Date(),
      },
    ]);
  });

  it("mapea a excepción de operación (INOCUIDAD por temperatura)", async () => {
    const count = await incidentAdapter.run(SCOPE);
    expect(count).toBe(1);
    const input = lastRaiseCall();
    expect(input.subjectType).toBe("incident");
    expect(input.subjectId).toBe("i1");
    expect(input.domain).toBe("operacion");
    expect(input.qsrCategory).toBe("INOCUIDAD");
    expect(input.severity).toBe("critical");
    expect(input.reason).toBe("Temperatura alta en cámara");
  });

  it("reejecutar no duplica (misma clave canónica)", async () => {
    await incidentAdapter.run(SCOPE);
    await incidentAdapter.run(SCOPE);
    expect(h.raised.size).toBe(1);
  });

  it("excluye incidentes RESOLVED", async () => {
    h.fixtures.set("incidents", [
      { ...h.fixtures.get("incidents")![0], id: "i2", status: "RESOLVED" },
    ]);
    const count = await incidentAdapter.run(SCOPE);
    expect(count).toBe(0);
    expect(h.raised.size).toBe(0);
  });
});

describe("inventoryAlertAdapter", () => {
  it("mapea ABASTO y reporta el insumo en la razón", async () => {
    h.fixtures.set("inventory_alerts", [
      {
        id: "ia1",
        companyId: COMPANY,
        branchId: "b1",
        severity: "ALTA",
        status: "ACTIVE",
        type: "LOW_STOCK",
        itemName: "Queso",
        notes: "bajo mínimo",
        detectedAt: new Date(),
      },
    ]);
    const count = await inventoryAlertAdapter.run(SCOPE);
    expect(count).toBe(1);
    const input = lastRaiseCall();
    expect(input.subjectType).toBe("inventory_alert");
    expect(input.domain).toBe("inventario");
    expect(input.qsrCategory).toBe("ABASTO");
    expect(input.severity).toBe("high");
    expect(String(input.reason)).toContain("Queso");
  });
});

describe("complianceAlertAdapter", () => {
  it("mapea cumplimiento/INOCUIDAD", async () => {
    h.fixtures.set("compliance_alerts", [
      {
        id: "ca1",
        companyId: COMPANY,
        branchId: "b1",
        severity: "WARNING",
        status: "ACTIVE",
        title: "Auditoría NOM-251 pendiente",
        description: null,
        complianceType: "NOM-251",
        detectedAt: new Date(),
      },
    ]);
    const count = await complianceAlertAdapter.run(SCOPE);
    expect(count).toBe(1);
    const input = lastRaiseCall();
    expect(input.subjectType).toBe("compliance_alert");
    expect(input.domain).toBe("cumplimiento");
    expect(input.qsrCategory).toBe("INOCUIDAD");
    expect(input.severity).toBe("warning");
  });
});

describe("equipmentAlertAdapter", () => {
  it("mapea equipos y severidad", async () => {
    h.fixtures.set("equipment_alerts", [
      {
        id: "ea1",
        companyId: COMPANY,
        branchId: "b1",
        severity: "HIGH",
        status: "ACTIVE",
        alertType: "MAINTENANCE_DUE",
        title: "Mantenimiento vencido: freidora",
        description: null,
        dueDate: new Date(),
        detectedAt: new Date(),
      },
    ]);
    const count = await equipmentAlertAdapter.run(SCOPE);
    expect(count).toBe(1);
    const input = lastRaiseCall();
    expect(input.subjectType).toBe("equipment_alert");
    expect(input.domain).toBe("equipos");
    expect(input.severity).toBe("high");
  });
});

describe("cashVarianceAdapter", () => {
  it("levanta excepción cuando el descuadre rebasa la tolerancia", async () => {
    h.fixtures.set("daily_sales_cuts", [
      {
        id: "cut1",
        companyId: COMPANY,
        branchId: "b1",
        businessDate: "2026-10-17",
        shift: "MATUTINO",
        cashSales: 200000,
        cashCountedCents: 185000,
        status: "PENDING_REVIEW",
        detectedAt: new Date(),
      },
    ]);
    const count = await cashVarianceAdapter.run(SCOPE);
    expect(count).toBe(1);
    const input = lastRaiseCall();
    expect(input.subjectType).toBe("cash_variance");
    expect(input.domain).toBe("finanzas");
    expect(input.qsrCategory).toBe("DINERO");
    expect(input.severity).toBe("high");
    expect(String(input.reason)).toContain("Faltante");
  });

  it("ignora cortes dentro de tolerancia", async () => {
    h.fixtures.set("daily_sales_cuts", [
      {
        id: "cut2",
        companyId: COMPANY,
        branchId: "b1",
        businessDate: "2026-10-17",
        shift: "VESPERTINO",
        cashSales: 100000,
        cashCountedCents: 96000,
        status: "CONFIRMED",
        detectedAt: new Date(),
      },
    ]);
    const count = await cashVarianceAdapter.run(SCOPE);
    expect(count).toBe(0);
    expect(h.raised.size).toBe(0);
  });
});

describe("invoiceDiscrepancyAdapter (Gate 0)", () => {
  const baseInvoice = {
    id: "inv1",
    companyId: COMPANY,
    branchId: "b1",
    uuid: "UUID-1",
    folio: "F-001",
    total: 150000,
    currency: "MXN",
    supplierId: "sup1",
  };

  it("DISCREPANCY → excepción finanzas/DINERO", async () => {
    h.fixtures.set("invoices", [{ ...baseInvoice, matchStatus: "DISCREPANCY" }]);
    const count = await invoiceDiscrepancyAdapter.run(SCOPE);
    expect(count).toBe(1);
    const input = lastRaiseCall();
    expect(input.subjectType).toBe("invoice_discrepancy");
    expect(input.subjectId).toBe("inv1");
    expect(input.domain).toBe("finanzas");
    expect(input.qsrCategory).toBe("DINERO");
    expect(input.severity).toBe("high");
    expect(String(input.reason)).toContain("F-001");
  });

  it("EXCEPTION_APPROVED cancela la excepción abierta, no la duplica", async () => {
    h.raised.set(`${COMPANY}|invoice_discrepancy|inv1`, {
      id: "exc-open",
      companyId: COMPANY,
      subjectType: "invoice_discrepancy",
      subjectId: "inv1",
      status: "OPEN",
    });
    h.fixtures.set("invoices", [
      { ...baseInvoice, matchStatus: "EXCEPTION_APPROVED" },
    ]);

    await invoiceDiscrepancyAdapter.run(SCOPE);

    expect(ExceptionService.cancel).toHaveBeenCalledTimes(1);
    const [id, , , reason] = vi.mocked(ExceptionService.cancel).mock.calls[0];
    expect(id).toBe("exc-open");
    expect(String(reason)).toContain("EXCEPTION_APPROVED");
    // No se creó una segunda excepción.
    expect(h.raised.size).toBe(1);
  });
});

describe("runExceptionAdapters", () => {
  it("aísla el fallo de un adaptador y continúa con los demás", async () => {
    for (const t of [
      "incidents",
      "inventory_alerts",
      "compliance_alerts",
      "equipment_alerts",
      "nom035_action_plans",
      "shift_approvals",
      "shift_change_requests",
      "daily_sales_cuts",
      "invoices",
    ]) {
      h.fixtures.set(t, []);
    }

    const spy = vi
      .spyOn(incidentAdapter, "run")
      .mockRejectedValueOnce(new Error("boom"));

    const outcomes = await runExceptionAdapters(SCOPE);
    expect(outcomes).toHaveLength(9);
    const failed = outcomes.find((o) => o.adapter === "incident");
    expect(failed?.error).toContain("boom");
    expect(outcomes.filter((o) => !o.error)).toHaveLength(8);
    spy.mockRestore();
  });
});
