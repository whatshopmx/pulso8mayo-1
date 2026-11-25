import { describe, expect, it } from "vitest";
import {
  aggregateAmountSource,
  aggregateReconciliationStatus,
  commissionAmountSourceLabel,
  commissionReconciliationStatusLabel,
  formatCommissionProvenanceTag,
  type BranchCommissions,
  type CommissionAmountSource,
  type CommissionReconciliationStatus,
} from "@/lib/services/commission-types";
import { buildPnlCommissionPresentation } from "@/lib/services/pnl-service";
import { pnlLineSourceForCommission } from "@/lib/services/pnl-types";

describe("FIN-06.a — Separar importe reportado y conciliado (V1)", () => {
  it("genera etiquetas coherentes y separadas para procedencia y estado de conciliación", () => {
    const cases: Array<{
      amountSource: CommissionAmountSource;
      reconciliationStatus: CommissionReconciliationStatus;
      expectedTag: string;
    }> = [
      {
        amountSource: "RATE_ESTIMATE",
        reconciliationStatus: "PENDING",
        expectedTag: "Tarifa estimada · Pendiente de conciliar",
      },
      {
        amountSource: "CUT_REPORTED",
        reconciliationStatus: "PENDING",
        expectedTag: "Reportada en corte · Pendiente de conciliar",
      },
      {
        amountSource: "GATEWAY_REPORTED",
        reconciliationStatus: "PENDING",
        expectedTag: "Reportada por pasarela · Pendiente de conciliar",
      },
      {
        amountSource: "GATEWAY_REPORTED",
        reconciliationStatus: "DISCREPANT",
        expectedTag: "Reportada por pasarela · Discrepante",
      },
      {
        amountSource: "BANK_RECONCILED",
        reconciliationStatus: "CONFIRMED",
        expectedTag: "Conciliada en banco · Confirmada",
      },
      {
        amountSource: "AGGREGATOR_REPORTED",
        reconciliationStatus: "CONFIRMED",
        expectedTag: "Reportada por agregador · Confirmada",
      },
      {
        amountSource: "DOCUMENTED_ZERO",
        reconciliationStatus: "PENDING",
        expectedTag: "Comisión documentada cero · Pendiente de conciliar",
      },
      {
        amountSource: "DOCUMENTED_ZERO",
        reconciliationStatus: "CONFIRMED",
        expectedTag: "Comisión documentada cero · Confirmada",
      },
      {
        amountSource: "DOCUMENTED_ZERO",
        reconciliationStatus: "DISCREPANT",
        expectedTag: "Comisión documentada cero · Discrepante",
      },
      {
        amountSource: "DOCUMENTED_ZERO",
        reconciliationStatus: "NOT_APPLICABLE",
        expectedTag: "Comisión documentada cero",
      },
      {
        amountSource: "NO_DATA",
        reconciliationStatus: "PENDING",
        expectedTag: "Sin datos · Pendiente de conciliar",
      },
    ];

    for (const c of cases) {
      expect(formatCommissionProvenanceTag(c.amountSource, c.reconciliationStatus)).toBe(
        c.expectedTag,
      );
      expect(commissionAmountSourceLabel(c.amountSource).length).toBeGreaterThan(0);
      expect(commissionReconciliationStatusLabel(c.reconciliationStatus).length).toBeGreaterThan(0);
    }
  });

  it("aplica agregación conservadora para procedencia y estado de conciliación", () => {
    expect(aggregateReconciliationStatus(["CONFIRMED", "PENDING"])).toBe("PENDING");
    expect(aggregateReconciliationStatus(["CONFIRMED", "DISCREPANT", "PENDING"])).toBe(
      "DISCREPANT",
    );
    expect(aggregateReconciliationStatus(["CONFIRMED", "NOT_APPLICABLE"])).toBe("CONFIRMED");
    expect(aggregateReconciliationStatus([])).toBe("NOT_APPLICABLE");

    expect(aggregateAmountSource(["BANK_RECONCILED", "RATE_ESTIMATE"], false)).toBe(
      "RATE_ESTIMATE",
    );
    expect(aggregateAmountSource(["BANK_RECONCILED", "GATEWAY_REPORTED"], false)).toBe(
      "GATEWAY_REPORTED",
    );
    expect(aggregateAmountSource(["DOCUMENTED_ZERO", "DOCUMENTED_ZERO"], false)).toBe(
      "DOCUMENTED_ZERO",
    );
    expect(aggregateAmountSource([], true)).toBe("NO_DATA");
    expect(aggregateAmountSource([], false)).toBe("DOCUMENTED_ZERO");
  });

  it("preserva etiquetas idénticas entre API de comisiones y P&L sin marcar pendiente/discrepante como firme", () => {
    const makeBranch = (
      overrides: Partial<BranchCommissions> &
        Pick<
          BranchCommissions,
          "source" | "amountSource" | "reconciliationStatus" | "documentedZero"
        >,
    ): BranchCommissions => ({
      branchId: "branch-1",
      channels:
        overrides.source === "NO_DATA"
          ? []
          : [
              {
                channel: "tpv",
                baseSalesCents: 100_000,
                commissionCents: overrides.totalCommissionCents ?? 2_900,
                feeBaseCents: overrides.totalCommissionCents === 0 ? 0 : 2_500,
                feeVatCents: overrides.totalCommissionCents === 0 ? 0 : 400,
                expectedNetCents: 100_000 - (overrides.totalCommissionCents ?? 2_900),
                bankMatchedCents:
                  overrides.reconciliationStatus === "CONFIRMED"
                    ? 100_000 - (overrides.totalCommissionCents ?? 2_900)
                    : 0,
                measuredCents:
                  overrides.source === "ESTIMATED" ? 0 : (overrides.totalCommissionCents ?? 2_900),
                reportedCents: overrides.reportedCommissionCents ?? 0,
                reconciledCents: overrides.reconciledCommissionCents ?? 0,
                estimatedCents: overrides.estimatedCommissionCents ?? 0,
                discrepancyCents: overrides.discrepancyCents ?? 0,
                rateBps: overrides.source === "ESTIMATED" ? 250 : null,
                vatBps: overrides.source === "ESTIMATED" ? 1600 : null,
                source: overrides.source === "ESTIMATED" ? "ESTIMATED" : "MEASURED",
                amountSource: overrides.amountSource,
                reconciliationStatus: overrides.reconciliationStatus,
                amountSourceLabel: commissionAmountSourceLabel(overrides.amountSource),
                reconciliationStatusLabel: commissionReconciliationStatusLabel(
                  overrides.reconciliationStatus,
                ),
                documentedZero: overrides.documentedZero,
                cutsCount: 1,
              },
            ],
      totalCommissionCents: overrides.totalCommissionCents ?? 2_900,
      totalFeeBaseCents:
        overrides.source === "NO_DATA" || overrides.totalCommissionCents === 0 ? 0 : 2_500,
      totalFeeVatCents:
        overrides.source === "NO_DATA" || overrides.totalCommissionCents === 0 ? 0 : 400,
      totalExpectedNetCents:
        overrides.source === "NO_DATA" ? 0 : 100_000 - (overrides.totalCommissionCents ?? 2_900),
      totalBankMatchedCents:
        overrides.reconciliationStatus === "CONFIRMED"
          ? 100_000 - (overrides.totalCommissionCents ?? 2_900)
          : 0,
      reportedCommissionCents: overrides.reportedCommissionCents ?? 0,
      reconciledCommissionCents: overrides.reconciledCommissionCents ?? 0,
      estimatedCommissionCents: overrides.estimatedCommissionCents ?? 0,
      discrepancyCents: overrides.discrepancyCents ?? 0,
      coveredSalesCents: overrides.source === "NO_DATA" ? 0 : 100_000,
      uncoveredSalesCents: overrides.source === "NO_DATA" ? 100_000 : 0,
      source: overrides.source,
      amountSource: overrides.amountSource,
      reconciliationStatus: overrides.reconciliationStatus,
      amountSourceLabel: commissionAmountSourceLabel(overrides.amountSource),
      reconciliationStatusLabel: commissionReconciliationStatusLabel(
        overrides.reconciliationStatus,
      ),
      documentedZero: overrides.documentedZero,
      coveragePercent: overrides.source === "NO_DATA" ? 0 : 100,
      note: formatCommissionProvenanceTag(overrides.amountSource, overrides.reconciliationStatus),
    });

    // 1. Reportada en pasarela pendiente: NO es MEASURED firme en P&L
    const pending = makeBranch({
      source: "MEASURED",
      amountSource: "GATEWAY_REPORTED",
      reconciliationStatus: "PENDING",
      documentedZero: false,
      reportedCommissionCents: 2_900,
    });
    const pendingPnl = buildPnlCommissionPresentation(pending, 100_000);
    expect(pendingPnl.commissionsLine.source).toBe("DERIVED");
    expect(pendingPnl.commissionsLine.amountSource).toBe("GATEWAY_REPORTED");
    expect(pendingPnl.commissionsLine.reconciliationStatus).toBe("PENDING");
    expect(pendingPnl.commissionsLine.amountSourceLabel).toBe("Reportada por pasarela");
    expect(pendingPnl.commissionsLine.reconciliationStatusLabel).toBe("Pendiente de conciliar");
    expect(pendingPnl.commissionsByChannel?.[0].measured).toBe(false);

    // 2. Reportada con discrepancia bancaria: NO es MEASURED firme en P&L
    const discrepant = makeBranch({
      source: "MEASURED",
      amountSource: "GATEWAY_REPORTED",
      reconciliationStatus: "DISCREPANT",
      documentedZero: false,
      reportedCommissionCents: 2_900,
      discrepancyCents: -600,
    });
    const discrepantPnl = buildPnlCommissionPresentation(discrepant, 100_000);
    expect(discrepantPnl.commissionsLine.source).toBe("DERIVED");
    expect(discrepantPnl.commissionsLine.reconciliationStatus).toBe("DISCREPANT");
    expect(discrepantPnl.commissionsLine.reconciliationStatusLabel).toBe("Discrepante");
    expect(discrepantPnl.commissionsLine.discrepancyCents).toBe(-600);
    expect(discrepantPnl.commissionsByChannel?.[0].measured).toBe(false);

    // 3. Conciliada en banco confirmada: SÍ es MEASURED firme en P&L
    const confirmed = makeBranch({
      source: "MEASURED",
      amountSource: "BANK_RECONCILED",
      reconciliationStatus: "CONFIRMED",
      documentedZero: false,
      reconciledCommissionCents: 2_900,
    });
    const confirmedPnl = buildPnlCommissionPresentation(confirmed, 100_000);
    expect(confirmedPnl.commissionsLine.source).toBe("MEASURED");
    expect(confirmedPnl.commissionsLine.amountSource).toBe("BANK_RECONCILED");
    expect(confirmedPnl.commissionsLine.reconciliationStatus).toBe("CONFIRMED");
    expect(confirmedPnl.commissionsLine.amountSourceLabel).toBe("Conciliada en banco");
    expect(confirmedPnl.commissionsLine.reconciliationStatusLabel).toBe("Confirmada");
    expect(confirmedPnl.commissionsByChannel?.[0].measured).toBe(true);

    // 4. Comisión documentada cero: coherente tanto pendiente como confirmada, nunca NO_DATA
    const docZeroPending = makeBranch({
      source: "MEASURED",
      amountSource: "DOCUMENTED_ZERO",
      reconciliationStatus: "PENDING",
      documentedZero: true,
      totalCommissionCents: 0,
    });
    const docZeroPendingPnl = buildPnlCommissionPresentation(docZeroPending, 100_000);
    expect(docZeroPendingPnl.commissionsLine.source).toBe("DERIVED");
    expect(docZeroPendingPnl.commissionsLine.amountSource).toBe("DOCUMENTED_ZERO");
    expect(docZeroPendingPnl.commissionsLine.documentedZero).toBe(true);
    expect(docZeroPendingPnl.commissionsLine.cents).toBe(0);

    const docZeroConfirmed = makeBranch({
      source: "MEASURED",
      amountSource: "DOCUMENTED_ZERO",
      reconciliationStatus: "CONFIRMED",
      documentedZero: true,
      totalCommissionCents: 0,
    });
    const docZeroConfirmedPnl = buildPnlCommissionPresentation(docZeroConfirmed, 100_000);
    expect(docZeroConfirmedPnl.commissionsLine.source).toBe("MEASURED");
    expect(docZeroConfirmedPnl.commissionsLine.amountSource).toBe("DOCUMENTED_ZERO");
    expect(docZeroConfirmedPnl.commissionsLine.reconciliationStatus).toBe("CONFIRMED");
    expect(docZeroConfirmedPnl.commissionsLine.documentedZero).toBe(true);

    // 5. Dato faltante: NO_DATA, nunca documentado cero
    const missing = makeBranch({
      source: "NO_DATA",
      amountSource: "NO_DATA",
      reconciliationStatus: "PENDING",
      documentedZero: false,
      totalCommissionCents: 0,
    });
    const missingPnl = buildPnlCommissionPresentation(missing, 100_000);
    expect(missingPnl.commissionsLine.source).toBe("NO_DATA");
    expect(missingPnl.commissionsLine.amountSource).toBe("NO_DATA");
    expect(missingPnl.commissionsLine.documentedZero).toBe(false);
    expect(
      pnlLineSourceForCommission({
        source: "MEASURED",
        reconciliationStatus: "NOT_APPLICABLE",
        documentedZero: true,
      }),
    ).toBe("MEASURED");
  });
});
