import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/error";
import { construirPayloadNomina } from "../fiscal-service";
import {
  buildTimbradoInputFromPayslipSnapshot,
  summarizePayslipTotals,
  type OrdinaryPayrollPayslipSnapshot,
  type OrdinaryPayrollRunSnapshot,
} from "../payroll-snapshot-service";

const { mockRequirePermissionApi, mockStampApprovedSnapshot, mockTimbrarNomina } = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
  mockStampApprovedSnapshot: vi.fn(),
  mockTimbrarNomina: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/services/payroll-snapshot-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-snapshot-service")>();
  return {
    ...actual,
    stampApprovedPayrollSnapshot: mockStampApprovedSnapshot,
  };
});

vi.mock("@/lib/services/fiscal-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../fiscal-service")>();
  return {
    ...actual,
    timbrarNomina: mockTimbrarNomina,
  };
});

import { POST as timbrarRoutePost } from "@/app/api/finance/fiscal/timbrar-nomina/route";

function makePayslip(
  overrides: Partial<OrdinaryPayrollPayslipSnapshot> = {}
): OrdinaryPayrollPayslipSnapshot {
  return {
    userId: "usr-1",
    employeeNumber: "EMP-001",
    employeeName: "Karina Fuentes",
    rfc: "FUNK671228PH6",
    curp: "FUNK671228MDFRRL01",
    nss: "12345678901",
    dailySalaryCents: 50_000,
    payableDays: 15,
    baseSalaryCents: 750_000,
    propinasCents: 0,
    holidayPayCents: 0,
    overtimePayCents: 0,
    vacationPrimeCents: 0,
    bonusesAndIncidencesCents: 50_000,
    isrRetenidoCents: 75_000,
    imssObreroCents: 20_500,
    loanDeductionsCents: 0,
    incidenceDeductionsCents: 0,
    totalPercepcionesCents: 800_000,
    totalDeduccionesCents: 95_500,
    netPayCents: 704_500,
    employerSocialSecurityCents: 215_000,
    desglosePercepciones: [
      {
        earningTypeCode: "001",
        code: "001",
        concept: "Sueldos, salarios, rayas y jornales",
        taxedAmount: 750_000,
        exemptAmount: 0,
      },
      {
        earningTypeCode: "038",
        code: "038",
        concept: "Bono de puntualidad",
        taxedAmount: 50_000,
        exemptAmount: 0,
      },
    ],
    desgloseDeducciones: [
      { deductionTypeCode: "002", code: "002", concept: "ISR retenido", amount: 75_000 },
      { deductionTypeCode: "001", code: "001", concept: "Seguridad social IMSS", amount: 20_500 },
    ],
    completeness: {
      canApprove: true,
      canStamp: true,
      blockingIssues: [],
      zeroJustifications: [],
    },
    ...overrides,
  };
}

function makeHeader(payslips: OrdinaryPayrollPayslipSnapshot[]): OrdinaryPayrollRunSnapshot {
  return {
    schemaVersion: 1,
    snapshotVersion: 2,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-15",
    inputFingerprint: "fp-abc",
    ruleVersions: {
      isrTableVersion: "RMF_2026_ANEXO_8_ART_96",
      imssRuleVersion: "LSS_2026_OBRERO_V1",
      umaDailyCents: 11_731,
    },
    totals: summarizePayslipTotals(payslips),
    approvedBy: "admin-1",
    approvedAt: "2026-05-16T10:00:00.000Z",
  };
}

describe("NOM-04.b — Timbrado CFDI desde snapshot inmutable aprobado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("V1: el mismo snapshot aprobado alimenta el payload CFDI con sumas y neto exactos", () => {
    const payslip = makePayslip();
    const header = makeHeader([payslip]);

    const timbradoInput = buildTimbradoInputFromPayslipSnapshot({
      companyId: "00000000-0000-0000-0000-000000000001",
      performedBy: "admin-1",
      header,
      payslip,
    });

    expect(timbradoInput.periodo).toBe("2026-05-01 - 2026-05-15");
    expect(timbradoInput.totalPercepciones).toBe(800_000);
    expect(timbradoInput.totalDeducciones).toBe(95_500);
    expect(timbradoInput.desglosePercepciones).toHaveLength(2);
    expect(timbradoInput.desgloseDeducciones).toHaveLength(2);

    const { expectedTotal } = construirPayloadNomina(timbradoInput);
    expect(Math.round(expectedTotal * 100)).toBe(payslip.netPayCents);
  });

  it("V1: rechaza snapshot incompleto (NOM-06) o sin RFC válido antes de contactar al PAC", () => {
    const incomplete = makePayslip({
      completeness: {
        canApprove: false,
        canStamp: false,
        blockingIssues: [
          {
            domain: "ISR",
            code: "MISSING_ISR_CONFIG",
            message: "Falta tabla ISR",
            recoveryAction: "Configurar tabla ISR",
          },
        ],
        zeroJustifications: [],
      },
    });
    expect(() =>
      buildTimbradoInputFromPayslipSnapshot({
        companyId: "00000000-0000-0000-0000-000000000001",
        header: makeHeader([incomplete]),
        payslip: incomplete,
      })
    ).toThrow(/NOM-06/);

    const badRfc = makePayslip({ rfc: "INVALIDO" });
    expect(() =>
      buildTimbradoInputFromPayslipSnapshot({
        companyId: "00000000-0000-0000-0000-000000000001",
        header: makeHeader([badRfc]),
        payslip: badRfc,
      })
    ).toThrow(/RFC válido/);
  });

  it("V3 API: POST /api/finance/fiscal/timbrar-nomina con runId exige permiso (403), snapshot aprobado (409) y devuelve UUID/estado (200)", async () => {
    const runId = "11111111-1111-4111-8111-111111111111";

    // 403 sin reports:manage
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso"));
    const denied = await timbrarRoutePost(
      new NextRequest("http://localhost:3000/api/finance/fiscal/timbrar-nomina", {
        method: "POST",
        body: JSON.stringify({ runId }),
      })
    );
    expect(denied.status).toBe(403);

    // 409 si no hay snapshot aprobado
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: "00000000-0000-0000-0000-000000000001", userId: "admin-1" },
      decision: { allowed: true, maskedFields: [] },
    });
    mockStampApprovedSnapshot.mockRejectedValueOnce(
      ApiError.conflict("La corrida no tiene snapshot aprobado")
    );
    const conflict = await timbrarRoutePost(
      new NextRequest("http://localhost:3000/api/finance/fiscal/timbrar-nomina", {
        method: "POST",
        body: JSON.stringify({ runId }),
      })
    );
    expect(conflict.status).toBe(409);

    // 200 timbrado desde snapshot aprobado
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: "00000000-0000-0000-0000-000000000001", userId: "admin-1" },
      decision: { allowed: true, maskedFields: [] },
    });
    mockStampApprovedSnapshot.mockResolvedValueOnce({
      runId,
      snapshotVersion: 2,
      inputFingerprint: "fp-abc",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      results: [
        {
          userId: "usr-1",
          empleadoRfc: "FUNK671228PH6",
          empleadoNombre: "Karina Fuentes",
          status: "TIMBRADO",
          uuid: "11111111-2222-3333-4444-555555555555",
          selloDigital: "SELLO-SAT-OK",
          fechaTimbrado: "2026-05-16T12:00:00.000Z",
          totalPercepcionesCents: 800_000,
          totalDeduccionesCents: 95_500,
          netPayCents: 704_500,
        },
      ],
    });

    const ok = await timbrarRoutePost(
      new NextRequest("http://localhost:3000/api/finance/fiscal/timbrar-nomina", {
        method: "POST",
        body: JSON.stringify({ runId }),
      })
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("X-Payroll-Run-Id")).toBe(runId);
    expect(ok.headers.get("X-Payroll-Snapshot-Version")).toBe("2");
    const json = await ok.json();
    expect(json.data.results[0].status).toBe("TIMBRADO");
    expect(json.data.results[0].uuid).toBe("11111111-2222-3333-4444-555555555555");
  });
});
