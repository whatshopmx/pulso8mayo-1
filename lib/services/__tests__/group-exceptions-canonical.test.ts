import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalExceptionToGroupException,
  isCanonicalReadEnabled,
} from "../group-exceptions-service";
import type { ExceptionRow } from "../exception-service";

/**
 * Phase 0 / Task 10 — mapeo canónico → feed y flag de rollout.
 */

function row(overrides: Partial<ExceptionRow> = {}): ExceptionRow {
  return {
    id: "exc-1",
    companyId: "company-1",
    branchId: "branch-1",
    domain: "finanzas",
    qsrCategory: "DINERO",
    severity: "high",
    subjectType: "invoice_discrepancy",
    subjectId: "inv-1",
    reason: "Factura con discrepancia",
    status: "ASSIGNED",
    ownerId: "owner-1",
    slaDueAt: new Date("2026-10-17T18:00:00Z"),
    actionMeta: null,
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    closedAt: null,
    evidenceId: null,
    reopenedFromId: null,
    metadata: null,
    createdAt: new Date("2026-10-17T12:00:00Z"),
    updatedAt: new Date("2026-10-17T12:00:00Z"),
    ...overrides,
  } as ExceptionRow;
}

afterEach(() => {
  delete process.env.EXCEPTIONS_CANONICAL_READ;
});

describe("isCanonicalReadEnabled", () => {
  it("solo con el flag en 'true'", () => {
    expect(isCanonicalReadEnabled()).toBe(false);
    process.env.EXCEPTIONS_CANONICAL_READ = "1";
    expect(isCanonicalReadEnabled()).toBe(false);
    process.env.EXCEPTIONS_CANONICAL_READ = "true";
    expect(isCanonicalReadEnabled()).toBe(true);
  });
});

describe("canonicalExceptionToGroupException", () => {
  it("usa la razón como título cuando no hay metadata", () => {
    const mapped = canonicalExceptionToGroupException(row(), "Sucursal Centro");
    expect(mapped.id).toBe("exc-1");
    expect(mapped.title).toBe("Factura con discrepancia");
    expect(mapped.domain).toBe("finanzas");
    expect(mapped.qsrCategory).toBe("DINERO");
    expect(mapped.severity).toBe("high");
    expect(mapped.sourceTable).toBe("invoice_discrepancy");
    expect(mapped.assignedTo).toBe("owner-1");
    expect(mapped.branchName).toBe("Sucursal Centro");
    expect(mapped.status).toBe("ASSIGNED");
    // Fallback de enlace por subject_type.
    expect(mapped.deepLinkUrl).toBe("/dashboard/inventory/invoices");
    // Datos de lifecycle para la UI.
    expect(mapped.lifecycle).toEqual({
      status: "ASSIGNED",
      ownerId: "owner-1",
      slaDueAt: new Date("2026-10-17T18:00:00Z"),
    });
  });

  it("prefiere metadata y action_meta cuando existen", () => {
    const mapped = canonicalExceptionToGroupException(
      row({
        metadata: { title: "Título enriquecido", description: "detalle", impact: "impacto" },
        actionMeta: {
          type: "RESOLVE_ALERT",
          label: "Revisar",
          url: "/dashboard/x",
        },
      }),
    );
    expect(mapped.title).toBe("Título enriquecido");
    expect(mapped.description).toBe("detalle");
    expect(mapped.estimatedImpact).toBe("impacto");
    expect(mapped.deepLinkUrl).toBe("/dashboard/x");
    expect(mapped.action?.label).toBe("Revisar");
  });

  it("sin sucursal deja branchName null", () => {
    const mapped = canonicalExceptionToGroupException(row({ branchId: null }));
    expect(mapped.branchId).toBeNull();
    expect(mapped.branchName).toBeNull();
  });
});
