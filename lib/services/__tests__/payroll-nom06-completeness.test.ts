import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { evaluatePayrollCompleteness } from "../payroll-completeness-service";
import { resolveOrdinaryIsrForPeriod } from "../payroll-isr-service";
import {
  resolveEmployerSocialSecurityForPeriod,
  resolveWorkerImssForPeriod,
} from "../payroll-imss-service";

const { mockRequirePermissionApi } = vi.hoisted(() => ({
  mockRequirePermissionApi: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

import { POST as validateRoutePost } from "@/app/api/payroll/validate/route";
import { POST as runRoutePost } from "@/app/api/payroll/run/route";
import { ApiError } from "@/lib/api/error";

describe("NOM-06 — Bloqueo de resultados incompletos y justificación de ceros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("V1: cada cero válido tiene causa explícita y habilita aprobación/timbrado", () => {
    const isr = resolveOrdinaryIsrForPeriod({
      taxableBaseCents: 250_000, // Base baja quincenal: cubierto 100% por subsidio al empleo
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      periodicity: "QUINCENAL",
    });
    const imss = resolveWorkerImssForPeriod({
      dailySalaryCents: 31_504,
      minimumWageDailyCents: 31_504,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });
    const employer = resolveEmployerSocialSecurityForPeriod({
      dailySalaryCents: 31_504,
      minimumWageDailyCents: 31_504,
      isnTaxableBaseCents: 472_560,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
      workRiskPremiumPercent: 0.54355,
      statePayrollTaxPercent: 3.0,
    });

    const report = evaluatePayrollCompleteness({
      overtimeBreakdown: { totalPayCents: 0, justification: "SIN_HORAS_EXTRA" },
      vacationBreakdown: {
        hasVacations: false,
        vacationPrimeCents: 0,
        vacationBalanceStatus: "AVAILABLE",
        vacationRequestsStatus: "AVAILABLE",
        justification: "SIN_VACACIONES",
      },
      leaveBreakdown: { leavesStatus: "AVAILABLE" },
      adjustmentsBreakdown: { status: "AVAILABLE" },
      isrBreakdown: isr,
      imssWorkerBreakdown: imss,
      loansBreakdown: { status: "AVAILABLE" },
      employerSocialSecurityBreakdown: employer,
    });

    expect(report.canApprove).toBe(true);
    expect(report.canStamp).toBe(true);
    expect(report.blockingIssues).toEqual([]);
    expect(report.zeroJustifications.length).toBeGreaterThanOrEqual(4);
    expect(report.zeroJustifications.every((z) => z.valid)).toBe(true);
  });

  it("V1: ausencia de configuración fiscal, historial o fallos de lectura bloquean con mensaje recuperable", () => {
    const report = evaluatePayrollCompleteness({
      vacationBreakdown: {
        hasVacations: true,
        vacationPrimeCents: 0,
        vacationBalanceStatus: "MISSING",
        vacationRequestsStatus: "AVAILABLE",
        vacationSource: "VERIFIED_HISTORY",
        justification: "VACATION_BALANCE_MISSING",
      },
      leaveBreakdown: { leavesStatus: "QUERY_ERROR" },
      adjustmentsBreakdown: { status: "QUERY_ERROR" },
      isrBreakdown: resolveOrdinaryIsrForPeriod({
        taxableBaseCents: 750_000,
        periodStart: "2027-05-01",
        periodEnd: "2027-05-15",
      }),
      imssWorkerBreakdown: resolveWorkerImssForPeriod({
        dailySalaryCents: 50_000,
        minimumWageDailyCents: 31_504,
        periodStart: "2027-05-01",
        periodEnd: "2027-05-15",
      }),
      loansBreakdown: { status: "QUERY_ERROR" },
      employerSocialSecurityBreakdown: resolveEmployerSocialSecurityForPeriod({
        dailySalaryCents: 50_000,
        minimumWageDailyCents: 31_504,
        isnTaxableBaseCents: 750_000,
        periodStart: "2027-05-01",
        periodEnd: "2027-05-15",
      }),
    });

    expect(report.canApprove).toBe(false);
    expect(report.canStamp).toBe(false);
    const codes = report.blockingIssues.map((i) => i.code);
    expect(codes).toContain("VACATION_BALANCE_MISSING");
    expect(codes).toContain("LEAVES_QUERY_ERROR");
    expect(codes).toContain("ADJUSTMENTS_QUERY_ERROR");
    expect(codes).toContain("MISSING_ISR_CONFIG");
    expect(codes).toContain("MISSING_IMSS_CONFIG");
    expect(codes).toContain("LOANS_QUERY_ERROR");
    expect(codes).toContain("MISSING_EMPLOYER_BURDEN_CONFIG");
    expect(report.blockingIssues.every((i) => i.recoveryAction.trim().length > 10)).toBe(true);
  });

  it("V1: conflicto histórico de vacaciones bloquea aprobación", () => {
    const report = evaluatePayrollCompleteness({
      vacationBreakdown: {
        hasVacations: false,
        vacationPrimeCents: 0,
        vacationBalanceStatus: "CONFLICT",
        vacationRequestsStatus: "AVAILABLE",
        vacationSource: "VERIFIED_HISTORY",
        justification: "VACATION_HISTORY_CONFLICT",
      },
    });
    expect(report.canApprove).toBe(false);
    expect(report.blockingIssues[0].code).toBe("VACATION_HISTORY_CONFLICT");
  });

  it("V3 API: POST /api/payroll/validate rechaza rol sin permiso (403) y valida formato de período (400)", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso FINANCIAL"));
    const deniedReq = new NextRequest("http://localhost:3000/api/payroll/validate", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-05-01", endDate: "2026-05-15" }),
    });
    const deniedRes = await validateRoutePost(deniedReq);
    expect(deniedRes.status).toBe(403);

    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: { userCompanyId: "00000000-0000-0000-0000-000000000001", userId: "admin-1" },
    });
    const badReq = new NextRequest("http://localhost:3000/api/payroll/validate", {
      method: "POST",
      body: JSON.stringify({ startDate: "invalid", endDate: "2026-05-15" }),
    });
    const badRes = await validateRoutePost(badReq);
    expect(badRes.status).toBe(400);
  });

  it("V3 API: POST /api/payroll/run deniega rol sin reports:manage (403)", async () => {
    mockRequirePermissionApi.mockRejectedValueOnce(ApiError.forbidden("Sin permiso reports:manage"));
    const req = new NextRequest("http://localhost:3000/api/payroll/run", {
      method: "POST",
      body: JSON.stringify({ startDate: "2026-05-01", endDate: "2026-05-15" }),
    });
    const res = await runRoutePost(req);
    expect(res.status).toBe(403);
  });
});
