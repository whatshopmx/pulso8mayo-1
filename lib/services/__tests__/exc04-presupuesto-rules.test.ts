import { describe, expect, it } from "vitest";
import {
  BUDGET_OVERRUN_RULE_CODE,
  BUDGET_OVERRUN_SUBJECT_TYPE,
  buildBudgetExceptionClosureReason,
  buildBudgetOverrunExceptionInput,
  evaluateOverbudgetRule,
  resolveBudgetExceptionOwnerId,
  resolveEffectiveOverbudgetRole,
} from "../budget-exception-rules";

describe("EXC-04.presupuesto — Reglas puras de excepción de presupuesto (V1)", () => {
  it("detecta sobre-presupuesto >100%, calcula excedente/severidad y conserva ruleSnapshot", () => {
    const within = evaluateOverbudgetRule({
      budgetedCents: 100_000,
      committedBeforeCents: 60_000,
      expenseAmountCents: 40_000,
      month: "2026-11",
      costCenterId: "cc-1",
      costCenterCode: "MANT",
      costCenterName: "Mantenimiento",
      amountRuleRole: "GERENTE",
      amountRuleId: "rule-1",
    });
    expect(within.isOverbudget).toBe(false);
    expect(within.ruleSnapshot).toBeNull();
    expect(within.consumedPercent).toBe(100);

    const overHigh = evaluateOverbudgetRule({
      budgetedCents: 100_000,
      committedBeforeCents: 90_000,
      expenseAmountCents: 20_000,
      month: "2026-11",
      costCenterId: "cc-1",
      costCenterCode: "MANT",
      costCenterName: "Mantenimiento",
      amountRuleRole: "GERENTE",
      amountRuleId: "rule-1",
    });
    expect(overHigh.isOverbudget).toBe(true);
    expect(overHigh.overByCents).toBe(10_000);
    expect(overHigh.consumedPercent).toBe(110);
    expect(overHigh.severity).toBe("high");
    expect(overHigh.requiredApproverRole).toBe("ADMIN");
    expect(overHigh.ruleSnapshot).toEqual({
      ruleCode: BUDGET_OVERRUN_RULE_CODE,
      thresholdPercent: 100,
      month: "2026-11",
      costCenterId: "cc-1",
      costCenterCode: "MANT",
      costCenterName: "Mantenimiento",
      budgetedCents: 100_000,
      committedBeforeCents: 90_000,
      expenseAmountCents: 20_000,
      committedAfterCents: 110_000,
      overByCents: 10_000,
      consumedPercent: 110,
      requiredApproverRole: "ADMIN",
      baseAmountRuleRole: "GERENTE",
      baseAmountRuleId: "rule-1",
    });

    const overCritical = evaluateOverbudgetRule({
      budgetedCents: 100_000,
      committedBeforeCents: 90_000,
      expenseAmountCents: 50_000,
      month: "2026-11",
      costCenterId: "cc-1",
      amountRuleRole: "OWNER",
    });
    expect(overCritical.isOverbudget).toBe(true);
    expect(overCritical.severity).toBe("critical");
    expect(overCritical.requiredApproverRole).toBe("OWNER");
  });

  it("no inventa excepción sin centro de costo o sin presupuesto capturado", () => {
    expect(
      evaluateOverbudgetRule({
        budgetedCents: null,
        committedBeforeCents: 0,
        expenseAmountCents: 50_000,
        month: "2026-11",
        costCenterId: "cc-1",
        amountRuleRole: "GERENTE",
      }).isOverbudget,
    ).toBe(false);

    expect(
      evaluateOverbudgetRule({
        budgetedCents: 100_000,
        committedBeforeCents: 99_000,
        expenseAmountCents: 50_000,
        month: "2026-11",
        costCenterId: null,
        amountRuleRole: "GERENTE",
      }).isOverbudget,
    ).toBe(false);
  });

  it("resolveEffectiveOverbudgetRole exige al menos ADMIN sin rebajar OWNER/SUPER_ADMIN", () => {
    expect(resolveEffectiveOverbudgetRole("GERENTE")).toBe("ADMIN");
    expect(resolveEffectiveOverbudgetRole("SUPERVISOR")).toBe("ADMIN");
    expect(resolveEffectiveOverbudgetRole("ADMIN")).toBe("ADMIN");
    expect(resolveEffectiveOverbudgetRole("OWNER")).toBe("OWNER");
    expect(resolveEffectiveOverbudgetRole("SUPER_ADMIN")).toBe("SUPER_ADMIN");
  });

  it("selecciona responsable respetando autoridad, segregación de funciones y usuarios activos", () => {
    const candidates = [
      { id: "u-req-admin", role: "ADMIN", branchId: "b1", active: true },
      { id: "u-inactive-admin", role: "ADMIN", branchId: "b1", active: false },
      { id: "u-admin-2", role: "ADMIN", branchId: null, active: true },
      { id: "u-owner", role: "OWNER", branchId: null, active: true },
      { id: "u-gerente", role: "GERENTE", branchId: "b1", active: true },
    ];

    // Prefiere ADMIN activo distinto de quien registró el gasto
    expect(
      resolveBudgetExceptionOwnerId(candidates, {
        branchId: "b1",
        branchManagerId: "u-gerente",
        requiredRole: "ADMIN",
        requestedBy: "u-req-admin",
      }),
    ).toBe("u-admin-2");

    // Cuando la regla requiere OWNER, elige OWNER
    expect(
      resolveBudgetExceptionOwnerId(candidates, {
        branchId: "b1",
        branchManagerId: "u-gerente",
        requiredRole: "OWNER",
        requestedBy: "u-req-admin",
      }),
    ).toBe("u-owner");

    // Si el único usuario con autoridad es quien solicitó y no hay gerente distinto, cae en el ejecutivo
    expect(
      resolveBudgetExceptionOwnerId(
        [{ id: "u-solo-owner", role: "OWNER", branchId: null, active: true }],
        {
          branchId: "b1",
          branchManagerId: null,
          requiredRole: "ADMIN",
          requestedBy: "u-solo-owner",
        },
      ),
    ).toBe("u-solo-owner");
  });

  it("buildBudgetOverrunExceptionInput conserva ruleSnapshot y ownerId originales ante repeticiones", () => {
    const firstEval = evaluateOverbudgetRule({
      budgetedCents: 100_000,
      committedBeforeCents: 80_000,
      expenseAmountCents: 35_000,
      month: "2026-11",
      costCenterId: "cc-1",
      costCenterCode: "SERV",
      costCenterName: "Servicios",
      amountRuleRole: "GERENTE",
      amountRuleId: "rule-initial",
    });

    const firstInput = buildBudgetOverrunExceptionInput({
      companyId: "comp-1",
      branchId: "branch-1",
      expenseId: "exp-1",
      category: "SERVICIOS",
      description: "Reparación eléctrica",
      amountCents: 35_000,
      requestedBy: "u-req",
      sourceStatus: "PENDING_OVERBUDGET_APPROVAL",
      evaluation: firstEval,
      ownerId: "u-admin-original",
      actorId: "u-req",
    });

    expect(firstInput.subjectType).toBe(BUDGET_OVERRUN_SUBJECT_TYPE);
    expect(firstInput.subjectId).toBe("exp-1");
    expect(firstInput.ownerId).toBe("u-admin-original");
    expect((firstInput.metadata as Record<string, unknown>).ruleSnapshot).toEqual(
      firstEval.ruleSnapshot,
    );

    // Una reevaluación posterior con presupuesto distinto NO debe pisar la regla ni el responsable originales
    const laterEval = evaluateOverbudgetRule({
      budgetedCents: 200_000,
      committedBeforeCents: 190_000,
      expenseAmountCents: 35_000,
      month: "2026-11",
      costCenterId: "cc-1",
      amountRuleRole: "OWNER",
    });

    const repeatInput = buildBudgetOverrunExceptionInput({
      companyId: "comp-1",
      branchId: "branch-1",
      expenseId: "exp-1",
      category: "SERVICIOS",
      description: "Reparación eléctrica",
      amountCents: 35_000,
      requestedBy: "u-req",
      sourceStatus: "PENDING_OVERBUDGET_APPROVAL",
      evaluation: laterEval,
      ownerId: "u-other-admin",
      existingMetadata: firstInput.metadata as Record<string, unknown>,
      existingOwnerId: "u-admin-original",
    });

    expect(repeatInput.ownerId).toBe("u-admin-original");
    expect((repeatInput.metadata as Record<string, unknown>).ruleSnapshot).toEqual(
      firstEval.ruleSnapshot,
    );
    expect((repeatInput.metadata as Record<string, unknown>).responsibleOwnerId).toBe(
      "u-admin-original",
    );
  });

  it("buildBudgetExceptionClosureReason siempre produce motivo AUD-02 >= 4 caracteres", () => {
    const approveNoNotes = buildBudgetExceptionClosureReason({
      decision: "APPROVED",
      approverRole: "ADMIN",
      notes: "",
      expenseId: "exp-1",
    });
    expect(approveNoNotes.length).toBeGreaterThanOrEqual(4);
    expect(approveNoNotes).toContain("ADMIN");

    const approveWithNotes = buildBudgetExceptionClosureReason({
      decision: "APPROVED",
      approverRole: "OWNER",
      notes: "Urgencia por falla de cámara fría",
      expenseId: "exp-1",
    });
    expect(approveWithNotes).toContain("Urgencia por falla de cámara fría");

    const rejectReason = buildBudgetExceptionClosureReason({
      decision: "REJECTED",
      approverRole: "ADMIN",
      notes: "Sin cotización previa",
      expenseId: "exp-2",
    });
    expect(rejectReason).toContain("Rechazo");
    expect(rejectReason).toContain("Sin cotización previa");
  });
});
