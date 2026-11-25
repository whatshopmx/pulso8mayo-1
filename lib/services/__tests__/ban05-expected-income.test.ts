import { describe, expect, it } from "vitest";
import {
  buildExpectedIncomeRecord,
  evaluateExpectedIncomeAmbiguity,
} from "../expected-income-service";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";

describe("BAN-05 V1 — Identidad de ingresos esperados, separación de etapas y ambigüedad pendiente", () => {
  it("separa estrictamente venta (SALE), liquidación (SETTLEMENT) y depósito confirmado (DEPOSIT)", () => {
    const saleCut = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "SALES_CUT",
      sourceId: "cut-1",
      sourceChannel: "SALON",
      businessDate: "2026-07-10",
      settlementDate: null,
      grossAmountCents: 100_000,
      commissionCents: 0,
      expectedNetCents: 100_000,
      destinationBankAccountId: null,
    });
    expect(saleCut.stage).toBe("SALE");
    expect(saleCut.readiness).toBe("PENDING_SETTLEMENT");
    expect(saleCut.ambiguityReasons).toContain("SALE_NOT_YET_SETTLED");

    const settlementPendingDeposit = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "TERMINAL_GATEWAY",
      sourceId: "gw-1",
      sourceChannel: "CLIP",
      businessDate: "2026-07-10",
      settlementDate: "2026-07-11",
      grossAmountCents: 100_000,
      commissionCents: 3_600,
      feeVatCents: 576,
      expectedNetCents: 95_824,
      destinationBankAccountId: ACCOUNT_ID,
    });
    expect(settlementPendingDeposit.stage).toBe("SETTLEMENT");
    expect(settlementPendingDeposit.readiness).toBe("READY");
    expect(settlementPendingDeposit.destinationBankAccountId).toBe(ACCOUNT_ID);

    const confirmedDeposit = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "TERMINAL_GATEWAY",
      sourceId: "gw-1",
      sourceChannel: "CLIP",
      businessDate: "2026-07-10",
      settlementDate: "2026-07-11",
      grossAmountCents: 100_000,
      commissionCents: 3_600,
      feeVatCents: 576,
      expectedNetCents: 95_824,
      destinationBankAccountId: ACCOUNT_ID,
      confirmedBankTransactionId: "bt-1",
    });
    expect(confirmedDeposit.stage).toBe("DEPOSIT");
    expect(confirmedDeposit.readiness).toBe("DEPOSITED");
    // La identidad de origen permanece invariante entre SETTLEMENT y DEPOSIT
    expect(confirmedDeposit.identityKey).toBe(settlementPendingDeposit.identityKey);
  });

  it("mantiene pendiente cuando falta cuenta destino, fecha de liquidación o existe descuadre aritmético", () => {
    const noAccount = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "AGGREGATOR_SETTLEMENT",
      sourceId: "agg-1",
      sourceChannel: "Uber Eats",
      businessDate: "2026-07-01",
      settlementDate: "2026-07-07",
      grossAmountCents: 200_000,
      commissionCents: 60_000,
      expectedNetCents: 140_000,
      destinationBankAccountId: null,
    });
    expect(noAccount.sourceChannel).toBe("uber");
    expect(noAccount.readiness).toBe("PENDING_DESTINATION_ACCOUNT");
    expect(noAccount.ambiguityReasons).toContain("MISSING_DESTINATION_ACCOUNT");

    const discrepant = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "AGGREGATOR_SETTLEMENT",
      sourceId: "agg-2",
      sourceChannel: "Rappi",
      businessDate: "2026-07-01",
      settlementDate: "2026-07-07",
      grossAmountCents: 200_000,
      commissionCents: 50_000,
      expectedNetCents: 120_000, // faltan 30,000 no explicados
      destinationBankAccountId: ACCOUNT_ID,
    });
    expect(discrepant.readiness).toBe("DISCREPANT");
    expect(discrepant.ambiguityReasons).toContain("ARITHMETIC_NET_MISMATCH");
  });

  it("marca AMBIGUOUS ante múltiples candidatos del mismo neto/cuenta y GROUPED_UNSUPPORTED ante depósito agrupado", () => {
    const s1 = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "TERMINAL_GATEWAY",
      sourceId: "gw-a",
      sourceChannel: "CLIP",
      businessDate: "2026-07-10",
      settlementDate: "2026-07-11",
      grossAmountCents: 50_000,
      commissionCents: 1_800,
      feeVatCents: 288,
      expectedNetCents: 47_912,
      destinationBankAccountId: ACCOUNT_ID,
    });
    const s2 = buildExpectedIncomeRecord({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      sourceType: "TERMINAL_GATEWAY",
      sourceId: "gw-b",
      sourceChannel: "CLIP",
      businessDate: "2026-07-10",
      settlementDate: "2026-07-11",
      grossAmountCents: 50_000,
      commissionCents: 1_800,
      feeVatCents: 288,
      expectedNetCents: 47_912,
      destinationBankAccountId: ACCOUNT_ID,
    });

    // Empate 1↔2: ambos quedan AMBIGUOUS sin inventar vínculo
    const tieEval = evaluateExpectedIncomeAmbiguity(
      [s1, s2],
      [{ id: "dep-tie", sourceBankAccountId: ACCOUNT_ID, valueDate: "2026-07-11", amountCents: 47_912 }]
    );
    expect(tieEval.depositEvaluations[0]).toMatchObject({
      status: "AMBIGUOUS",
      reason: "MULTIPLE_EXPECTED_CANDIDATES",
    });
    expect(tieEval.records.every((r) => r.readiness === "AMBIGUOUS")).toBe(true);

    // Depósito agrupado (suma exacta de s1 + s2 = 95,824): queda GROUPED_UNSUPPORTED explícito
    const groupedEval = evaluateExpectedIncomeAmbiguity(
      [s1, s2],
      [{ id: "dep-grouped", sourceBankAccountId: ACCOUNT_ID, valueDate: "2026-07-11", amountCents: 95_824 }]
    );
    expect(groupedEval.depositEvaluations[0]).toMatchObject({
      status: "GROUPED_UNSUPPORTED",
      reason: "GROUPED_DEPOSIT_UNSUPPORTED",
    });
    expect(groupedEval.records.every((r) => r.readiness === "AMBIGUOUS")).toBe(true);
  });
});
