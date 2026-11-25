import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  buildPayrollSnapshotCsv,
  computePayrollInputFingerprint,
  summarizePayslipTotals,
  type ApprovedPayrollSnapshotBundle,
  type OrdinaryPayrollPayslipSnapshot,
} from "../payroll-snapshot-service";

const { mockRequirePermissionApi, mockReadApprovedSnapshot } = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockReadApprovedSnapshot: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/payroll-snapshot-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-snapshot-service")>();
  return {
    ...actual,
    readApprovedPayrollSnapshot: mockReadApprovedSnapshot,
  };
});

import { POST as exportRoutePost } from "@/app/api/payroll/export/route";
import { ApiError } from "@/lib/api/error";

function makePayslip(overrides: Partial<OrdinaryPayrollPayslipSnapshot> = {}): OrdinaryPayrollPayslipSnapshot {
  const base = 750_000;
  const isr = 71_000;
  const imss = 20_500;
  const totalPercepcionesCents = base;
  const totalDeduccionesCents = isr + imss;
  return {
    userId: "usr-1",
    employeeNumber: "EMP-001",
    employeeName: "Ana López",
    rfc: "LOPA900101XXX",
    curp: "LOPA900101MDFRRL01",
    nss: "12345678901",
    dailySalaryCents: 50_000,
    payableDays: 15,
    baseSalaryCents: base,
    propinasCents: 0,
    holidayPayCents: 0,
    overtimePayCents: 0,
    vacationPrimeCents: 0,
    bonusesAndIncidencesCents: 0,
    isrRetenidoCents: isr,
    imssObreroCents: imss,
    loanDeductionsCents: 0,
    incidenceDeductionsCents: 0,
    totalPercepcionesCents,
    totalDeduccionesCents,
    netPayCents: totalPercepcionesCents - totalDeduccionesCents,
    employerSocialSecurityCents: 215_000,
    desglosePercepciones: [],
    desgloseDeducciones: [],
    completeness: {
      canApprove: true,
      canStamp: true,
      blockingIssues: [],
      zeroJustifications: [],
    },
    ...overrides,
  };
}

describe("NOM-03 & NOM-04.a — Snapshot inmutable, recibos y exportación unificados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("V1: fingerprint cambia ante cualquier edición de entrada y los totales cuadran exactamente con el CSV", () => {
    const p1 = makePayslip({ userId: "usr-1" });
    const p2 = makePayslip({
      userId: "usr-2",
      employeeNumber: "EMP-002",
      employeeName: "Carlos Ruiz",
      bonusesAndIncidencesCents: 100_000,
      totalPercepcionesCents: 850_000,
      netPayCents: 850_000 - 91_500,
    });
    const ruleVersions = {
      isrTableVersion: "RMF_2026_ANEXO_8_ART_96",
      imssRuleVersion: "LSS_2026_OBRERO_V1",
      umaDailyCents: 11_731,
    };

    const fp1 = computePayrollInputFingerprint({
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      ruleVersions,
      payslips: [p1, p2],
    });
    const fpEdited = computePayrollInputFingerprint({
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      ruleVersions,
      payslips: [{ ...p1, baseSalaryCents: 700_000, totalPercepcionesCents: 700_000, netPayCents: 608_500 }, p2],
    });
    expect(fp1).not.toBe(fpEdited);

    const totals = summarizePayslipTotals([p1, p2]);
    expect(totals.totalPercepcionesCents).toBe(1_600_000);
    expect(totals.totalDeduccionesCents).toBe(183_000);
    expect(totals.totalNetoCents).toBe(1_417_000);

    const bundle: ApprovedPayrollSnapshotBundle = {
      runId: "11111111-1111-4111-8111-111111111111",
      status: "APPROVED",
      snapshotVersion: 2,
      header: {
        schemaVersion: 1,
        snapshotVersion: 2,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        inputFingerprint: fp1,
        ruleVersions,
        totals,
        approvedBy: "admin-1",
        approvedAt: "2026-05-16T10:00:00.000Z",
      },
      payslips: [p1, p2],
    };

    const csv1 = buildPayrollSnapshotCsv(bundle);
    const csv2 = buildPayrollSnapshotCsv(bundle);
    // Reexportar devuelve exactamente el mismo CSV sin recalcular
    expect(csv1).toBe(csv2);
    const lines = csv1.split("\r\n");
    expect(lines).toHaveLength(3); // cabecera + 2 empleados
    expect(lines[1]).toContain("EMP-001");
    expect(lines[1]).toContain("7500.00");
    expect(lines[1]).toContain("6585.00"); // 7500 - 710 - 205
    expect(lines[2]).toContain("EMP-002");
    expect(lines[2]).toContain("7585.00"); // 8500 - 915
  });

  it("V3 API: POST /api/payroll/export sirve CSV desde snapshot aprobado, rechaza sin permiso (403) y sin snapshot (409)", async () => {
    // 403 sin permiso SENSITIVE
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso SENSITIVE"));
    const denied = await exportRoutePost(
      new NextRequest("http://localhost:3000/api/payroll/export", {
        method: "POST",
        body: JSON.stringify({ runId: "11111111-1111-4111-8111-111111111111" }),
      })
    );
    expect(denied.status).toBe(403);

    // 200 con snapshot aprobado
    const p1 = makePayslip();
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: "00000000-0000-0000-0000-000000000001", userId: "admin-1" },
    });
    mockReadApprovedSnapshot.mockResolvedValueOnce({
      runId: "11111111-1111-4111-8111-111111111111",
      status: "APPROVED",
      snapshotVersion: 2,
      header: {
        schemaVersion: 1,
        snapshotVersion: 2,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        inputFingerprint: "fp-1",
        ruleVersions: {
          isrTableVersion: "RMF_2026_ANEXO_8_ART_96",
          imssRuleVersion: "LSS_2026_OBRERO_V1",
          umaDailyCents: 11_731,
        },
        totals: summarizePayslipTotals([p1]),
        approvedBy: "admin-1",
        approvedAt: "2026-05-16T10:00:00.000Z",
      },
      payslips: [p1],
    });

    const okRes = await exportRoutePost(
      new NextRequest("http://localhost:3000/api/payroll/export", {
        method: "POST",
        body: JSON.stringify({ runId: "11111111-1111-4111-8111-111111111111" }),
      })
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("X-Payroll-Snapshot-Version")).toBe("2");
    const text = await okRes.text();
    expect(text).toContain("EMP-001");
    expect(text).toContain("6585.00");

    // 409 si la corrida no está aprobada
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: "00000000-0000-0000-0000-000000000001", userId: "admin-1" },
    });
    mockReadApprovedSnapshot.mockRejectedValueOnce(
      ApiError.conflict("La corrida no tiene snapshot aprobado")
    );
    const conflictRes = await exportRoutePost(
      new NextRequest("http://localhost:3000/api/payroll/export", {
        method: "POST",
        body: JSON.stringify({ runId: "11111111-1111-4111-8111-111111111111" }),
      })
    );
    expect(conflictRes.status).toBe(409);
  });
});
