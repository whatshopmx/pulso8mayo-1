/**
 * BAN-05 — Identidad canónica de ingresos esperados (corte, terminal y agregador).
 *
 * Reglas:
 * 1. Cada fuente (`SALES_CUT`, `TERMINAL_GATEWAY`, `AGGREGATOR_SETTLEMENT`) conserva
 *    su identidad estable, fuente/canal, fecha operativa/liquidación, importe bruto,
 *    comisión (+ IVA), neto esperado y cuenta destino declarada.
 * 2. Nunca se equiparan las tres etapas del ingreso:
 *    - `SALE`: venta registrada en corte POS (aún sin liquidación ni depósito).
 *    - `SETTLEMENT`: liquidación documentada por terminal o agregador (neto esperado,
 *      todavía NO confirmado en banco).
 *    - `DEPOSIT`: abono bancario confirmado vía cruce real en `bank_transactions`.
 * 3. Cualquier ambigüedad (falta de cuenta destino, falta de fecha de liquidación,
 *    descuadre aritmético, múltiples candidatos del mismo neto/cuenta o depósito
 *    agrupado 1↔N) permanece explícitamente `PENDING` / `AMBIGUOUS` sin fabricar
 *    vínculos ni borrar la identidad original.
 */

import { createHash } from "node:crypto";
import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { withCompanyContext } from "@/lib/db/tenant-context";
import {
  aggregatorSettlements,
  bankTransactions,
  dailySalesCuts,
  gatewayTransactions,
} from "@/lib/db/schema";
import { normalizeSettlementChannel } from "./aggregator-settlement-rules";

export type ExpectedIncomeSourceType =
  | "SALES_CUT"
  | "TERMINAL_GATEWAY"
  | "AGGREGATOR_SETTLEMENT";

/** Etapas estrictamente separadas: venta ≠ liquidación ≠ depósito bancario. */
export type IncomeLifecycleStage = "SALE" | "SETTLEMENT" | "DEPOSIT";

export type ExpectedIncomeReadiness =
  | "READY"
  | "PENDING_SETTLEMENT"
  | "PENDING_DESTINATION_ACCOUNT"
  | "PENDING_SETTLEMENT_DATE"
  | "AMBIGUOUS"
  | "DISCREPANT"
  | "DEPOSITED";

export interface ExpectedIncomeInput {
  companyId: string;
  branchId: string;
  sourceType: ExpectedIncomeSourceType;
  sourceId: string;
  sourceChannel: string;
  businessDate: string;
  settlementDate: string | null;
  grossAmountCents: number;
  commissionCents: number;
  feeVatCents?: number;
  expectedNetCents: number;
  destinationBankAccountId: string | null;
  confirmedBankTransactionId?: string | null;
}

export interface ExpectedIncomeRecord {
  identityKey: string;
  companyId: string;
  branchId: string;
  sourceType: ExpectedIncomeSourceType;
  sourceId: string;
  sourceChannel: string;
  stage: IncomeLifecycleStage;
  businessDate: string;
  settlementDate: string | null;
  grossAmountCents: number;
  commissionCents: number;
  feeVatCents: number;
  expectedNetCents: number;
  destinationBankAccountId: string | null;
  confirmedBankTransactionId: string | null;
  readiness: ExpectedIncomeReadiness;
  ambiguityReasons: string[];
}

export function buildExpectedIncomeIdentityKey(input: {
  companyId: string;
  branchId: string;
  sourceType: ExpectedIncomeSourceType;
  sourceId: string;
  sourceChannel: string;
  businessDate: string;
}): string {
  const canonical = [
    input.companyId,
    input.branchId,
    input.sourceType,
    input.sourceId,
    input.sourceChannel,
    input.businessDate,
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Construye el registro canónico de ingreso esperado preservando etapa,
 * desglose bruto/comisión/IVA/neto y diagnósticos explícitos de ambigüedad.
 */
export function buildExpectedIncomeRecord(input: ExpectedIncomeInput): ExpectedIncomeRecord {
  const feeVatCents = input.feeVatCents ?? 0;
  const sourceChannel = normalizeSettlementChannel(input.sourceChannel);
  const confirmedBankTransactionId = input.confirmedBankTransactionId ?? null;

  const stage: IncomeLifecycleStage = confirmedBankTransactionId
    ? "DEPOSIT"
    : input.sourceType === "SALES_CUT"
      ? "SALE"
      : "SETTLEMENT";

  const ambiguityReasons: string[] = [];

  const arithmeticDelta =
    input.grossAmountCents - input.commissionCents - feeVatCents - input.expectedNetCents;
  if (input.sourceType !== "SALES_CUT" && Math.abs(arithmeticDelta) > 1) {
    ambiguityReasons.push("ARITHMETIC_NET_MISMATCH");
  }

  if (stage === "SALE") {
    ambiguityReasons.push("SALE_NOT_YET_SETTLED");
  } else if (stage === "SETTLEMENT") {
    if (!input.destinationBankAccountId) {
      ambiguityReasons.push("MISSING_DESTINATION_ACCOUNT");
    }
    if (!input.settlementDate) {
      ambiguityReasons.push("MISSING_SETTLEMENT_DATE");
    }
  }

  let readiness: ExpectedIncomeReadiness;
  if (stage === "DEPOSIT") {
    readiness = "DEPOSITED";
  } else if (ambiguityReasons.includes("ARITHMETIC_NET_MISMATCH")) {
    readiness = "DISCREPANT";
  } else if (stage === "SALE") {
    readiness = "PENDING_SETTLEMENT";
  } else if (!input.destinationBankAccountId) {
    readiness = "PENDING_DESTINATION_ACCOUNT";
  } else if (!input.settlementDate) {
    readiness = "PENDING_SETTLEMENT_DATE";
  } else {
    readiness = "READY";
  }

  return {
    identityKey: buildExpectedIncomeIdentityKey({
      companyId: input.companyId,
      branchId: input.branchId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceChannel,
      businessDate: input.businessDate,
    }),
    companyId: input.companyId,
    branchId: input.branchId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceChannel,
    stage,
    businessDate: input.businessDate,
    settlementDate: input.settlementDate,
    grossAmountCents: input.grossAmountCents,
    commissionCents: input.commissionCents,
    feeVatCents,
    expectedNetCents: input.expectedNetCents,
    destinationBankAccountId: input.destinationBankAccountId,
    confirmedBankTransactionId,
    readiness,
    ambiguityReasons,
  };
}

export interface BankDepositCandidateInput {
  id: string;
  sourceBankAccountId: string | null;
  valueDate: string;
  amountCents: number;
}

export interface DepositAmbiguityEvaluation {
  bankTransactionId: string;
  status: "UNIQUE_CANDIDATE" | "AMBIGUOUS" | "GROUPED_UNSUPPORTED" | "UNMATCHED";
  candidateIdentityKeys: string[];
  reason: string | null;
}

/**
 * Evalúa candidatos de depósito bancario contra ingresos esperados SIN confirmar
 * ni inventar vínculos. Cualquier empate (2+ liquidaciones con igual neto/cuenta),
 * falta de cuenta destino o depósito agrupado (suma de 2+ liquidaciones) queda
 * explícitamente pendiente/ambiguo.
 */
export function evaluateExpectedIncomeAmbiguity(
  expectedRecords: readonly ExpectedIncomeRecord[],
  bankDeposits: readonly BankDepositCandidateInput[],
  windowDays = 5
): {
  records: ExpectedIncomeRecord[];
  depositEvaluations: DepositAmbiguityEvaluation[];
} {
  const readySettlements = expectedRecords.filter(
    (r) => r.stage === "SETTLEMENT" && r.readiness === "READY"
  );

  const ambiguousIdentityKeys = new Set<string>();
  const depositEvaluations: DepositAmbiguityEvaluation[] = [];

  for (const dep of bankDeposits) {
    if (dep.amountCents <= 0) continue;

    if (!dep.sourceBankAccountId) {
      depositEvaluations.push({
        bankTransactionId: dep.id,
        status: "AMBIGUOUS",
        candidateIdentityKeys: [],
        reason: "MISSING_BANK_ACCOUNT",
      });
      continue;
    }

    const depTime = Date.parse(`${dep.valueDate}T00:00:00Z`);
    const sameAccountInWindow = readySettlements.filter((r) => {
      if (r.destinationBankAccountId !== dep.sourceBankAccountId) return false;
      if (!r.settlementDate) return false;
      const diffDays = Math.abs(
        Math.round((Date.parse(`${r.settlementDate}T00:00:00Z`) - depTime) / 86_400_000)
      );
      return diffDays <= windowDays;
    });

    const exactMatches = sameAccountInWindow.filter((r) => r.expectedNetCents === dep.amountCents);

    if (exactMatches.length === 1) {
      depositEvaluations.push({
        bankTransactionId: dep.id,
        status: "UNIQUE_CANDIDATE",
        candidateIdentityKeys: [exactMatches[0].identityKey],
        reason: null,
      });
      continue;
    }

    if (exactMatches.length > 1) {
      for (const m of exactMatches) ambiguousIdentityKeys.add(m.identityKey);
      depositEvaluations.push({
        bankTransactionId: dep.id,
        status: "AMBIGUOUS",
        candidateIdentityKeys: exactMatches.map((m) => m.identityKey),
        reason: "MULTIPLE_EXPECTED_CANDIDATES",
      });
      continue;
    }

    // Verificar si el depósito parece un depósito agrupado (suma de 2+ liquidaciones)
    const sumWindow = sameAccountInWindow.reduce((acc, r) => acc + r.expectedNetCents, 0);
    if (sameAccountInWindow.length >= 2 && sumWindow === dep.amountCents) {
      for (const m of sameAccountInWindow) ambiguousIdentityKeys.add(m.identityKey);
      depositEvaluations.push({
        bankTransactionId: dep.id,
        status: "GROUPED_UNSUPPORTED",
        candidateIdentityKeys: sameAccountInWindow.map((m) => m.identityKey),
        reason: "GROUPED_DEPOSIT_UNSUPPORTED",
      });
      continue;
    }

    depositEvaluations.push({
      bankTransactionId: dep.id,
      status: "UNMATCHED",
      candidateIdentityKeys: [],
      reason: "NO_EXACT_SETTLEMENT_CANDIDATE",
    });
  }

  const records = expectedRecords.map((r) => {
    if (!ambiguousIdentityKeys.has(r.identityKey)) return r;
    const reasons = r.ambiguityReasons.includes("CANDIDATE_AMBIGUITY")
      ? r.ambiguityReasons
      : [...r.ambiguityReasons, "CANDIDATE_AMBIGUITY"];
    return {
      ...r,
      readiness: "AMBIGUOUS" as const,
      ambiguityReasons: reasons,
    };
  });

  return { records, depositEvaluations };
}

/**
 * Lee y unifica la identidad de ingresos esperados desde las 3 fuentes reales
 * (`daily_sales_cuts`, `gateway_transactions`, `aggregator_settlements`) y cruces
 * bancarios confirmados (`bank_transactions`), conservando separación de etapas
 * y ambigüedad pendiente bajo contexto tenant (`pulso_app`).
 */
export async function listExpectedIncomes(
  params: {
    companyId: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance?: any
): Promise<{
  records: ExpectedIncomeRecord[];
  depositEvaluations: DepositAmbiguityEvaluation[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (tx: any) => {
    const cutConditions = [eq(dailySalesCuts.companyId, params.companyId)];
    if (params.branchId) cutConditions.push(eq(dailySalesCuts.branchId, params.branchId));
    if (params.startDate) cutConditions.push(gte(dailySalesCuts.businessDate, params.startDate));
    if (params.endDate) cutConditions.push(lte(dailySalesCuts.businessDate, params.endDate));

    const gwConditions = [eq(gatewayTransactions.companyId, params.companyId)];
    if (params.branchId) gwConditions.push(eq(gatewayTransactions.branchId, params.branchId));

    const aggConditions = [eq(aggregatorSettlements.companyId, params.companyId)];
    if (params.branchId) aggConditions.push(eq(aggregatorSettlements.branchId, params.branchId));
    if (params.startDate) aggConditions.push(gte(aggregatorSettlements.periodEnd, params.startDate));
    if (params.endDate) aggConditions.push(lte(aggregatorSettlements.periodStart, params.endDate));

    const [cuts, gateways, aggregators, matchedBankDeposits, unmatchedBankDeposits] = await Promise.all([
      tx
        .select({
          id: dailySalesCuts.id,
          branchId: dailySalesCuts.branchId,
          businessDate: dailySalesCuts.businessDate,
          channel: dailySalesCuts.channel,
          totalSales: dailySalesCuts.totalSales,
        })
        .from(dailySalesCuts)
        .where(and(...cutConditions)),
      tx
        .select({
          id: gatewayTransactions.id,
          branchId: gatewayTransactions.branchId,
          acquirer: gatewayTransactions.acquirer,
          transactionDate: gatewayTransactions.transactionDate,
          settlementDate: gatewayTransactions.settlementDate,
          grossAmountCents: gatewayTransactions.grossAmountCents,
          feeAmountCents: gatewayTransactions.feeAmountCents,
          feeVatCents: gatewayTransactions.feeVatCents,
          netAmountCents: gatewayTransactions.netAmountCents,
          destinationBankAccountId: gatewayTransactions.destinationBankAccountId,
        })
        .from(gatewayTransactions)
        .where(and(...gwConditions)),
      tx
        .select({
          id: aggregatorSettlements.id,
          branchId: aggregatorSettlements.branchId,
          channel: aggregatorSettlements.channel,
          periodStart: aggregatorSettlements.periodStart,
          periodEnd: aggregatorSettlements.periodEnd,
          grossSalesCents: aggregatorSettlements.grossSalesCents,
          commissionCents: aggregatorSettlements.commissionCents,
          netDepositedCents: aggregatorSettlements.netDepositedCents,
          destinationBankAccountId: aggregatorSettlements.destinationBankAccountId,
        })
        .from(aggregatorSettlements)
        .where(and(...aggConditions)),
      tx
        .select({
          id: bankTransactions.id,
          matchedGatewayTransactionId: bankTransactions.matchedGatewayTransactionId,
        })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.companyId, params.companyId),
            eq(bankTransactions.matchStatus, "MATCHED"),
            isNotNull(bankTransactions.matchedGatewayTransactionId)
          )
        ),
      tx
        .select({
          id: bankTransactions.id,
          sourceBankAccountId: bankTransactions.sourceBankAccountId,
          valueDate: bankTransactions.valueDate,
          amountCents: bankTransactions.amountCents,
        })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.companyId, params.companyId),
            eq(bankTransactions.matchStatus, "UNMATCHED")
          )
        ),
    ]);

    const matchedByGateway = new Map<string, string>();
    for (const m of matchedBankDeposits) {
      if (m.matchedGatewayTransactionId) {
        matchedByGateway.set(m.matchedGatewayTransactionId, m.id);
      }
    }

    const baseRecords: ExpectedIncomeRecord[] = [];

    for (const c of cuts) {
      const grossCents = Math.round(Number(c.totalSales ?? 0));
      baseRecords.push(
        buildExpectedIncomeRecord({
          companyId: params.companyId,
          branchId: c.branchId,
          sourceType: "SALES_CUT",
          sourceId: c.id,
          sourceChannel: c.channel || "total",
          businessDate: String(c.businessDate),
          settlementDate: null,
          grossAmountCents: grossCents,
          commissionCents: 0,
          feeVatCents: 0,
          expectedNetCents: grossCents,
          destinationBankAccountId: null,
          confirmedBankTransactionId: null,
        })
      );
    }

    for (const g of gateways) {
      const txDay =
        g.transactionDate instanceof Date
          ? g.transactionDate.toISOString().slice(0, 10)
          : String(g.transactionDate).slice(0, 10);
      if (params.startDate && txDay < params.startDate) continue;
      if (params.endDate && txDay > params.endDate) continue;

      baseRecords.push(
        buildExpectedIncomeRecord({
          companyId: params.companyId,
          branchId: g.branchId,
          sourceType: "TERMINAL_GATEWAY",
          sourceId: g.id,
          sourceChannel: g.acquirer,
          businessDate: txDay,
          settlementDate: g.settlementDate ? String(g.settlementDate) : null,
          grossAmountCents: g.grossAmountCents,
          commissionCents: g.feeAmountCents,
          feeVatCents: g.feeVatCents,
          expectedNetCents: g.netAmountCents,
          destinationBankAccountId: g.destinationBankAccountId,
          confirmedBankTransactionId: matchedByGateway.get(g.id) ?? null,
        })
      );
    }

    for (const a of aggregators) {
      baseRecords.push(
        buildExpectedIncomeRecord({
          companyId: params.companyId,
          branchId: a.branchId,
          sourceType: "AGGREGATOR_SETTLEMENT",
          sourceId: a.id,
          sourceChannel: a.channel,
          businessDate: String(a.periodStart),
          settlementDate: String(a.periodEnd),
          grossAmountCents: a.grossSalesCents,
          commissionCents: a.commissionCents,
          feeVatCents: 0,
          expectedNetCents: a.netDepositedCents,
          destinationBankAccountId: a.destinationBankAccountId,
          confirmedBankTransactionId: null,
        })
      );
    }

    return evaluateExpectedIncomeAmbiguity(baseRecords, unmatchedBankDeposits);
  };

  if (dbInstance) {
    return run(dbInstance);
  }
  return withCompanyContext({ companyId: params.companyId }, run);
}
