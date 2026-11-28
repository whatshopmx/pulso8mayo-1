import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import {
  listBankExceptions,
  recordBankDiscrepancyException,
  resolveBankExceptionOnReconciliation,
  syncCompanyBankExceptions,
} from "@/lib/services/bank-exception-service";
import type { BankExceptionSourceKind } from "@/lib/services/bank-exception-rules";

const sourceKindSchema = z.enum([
  "BANK_OUTFLOW",
  "BANK_DEPOSIT",
  "PAYMENT_RUN_ITEM",
  "GATEWAY_TRANSACTION",
]);

const discrepancyCodeSchema = z.enum([
  "PENDING_OVERDUE",
  "AMOUNT_DIFFERENCE",
  "GROUPED_DEPOSIT_UNSUPPORTED",
  "MISSING_DESTINATION_ACCOUNT",
  "ARITHMETIC_NET_MISMATCH",
  "UNMATCHED_AFTER_CORRECTION",
]);

const dispositionSchema = z.enum([
  "EXACT_MATCH",
  "EXPLAINED_FEE",
  "WRITE_OFF",
  "PENDING_ADJUSTMENT",
  "IGNORED_WITH_REASON",
]);

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SYNC"),
    nowIso: z.string().datetime().optional(),
    pendingThresholdDays: z.number().int().min(0).max(90).optional(),
  }),
  z.object({
    action: z.literal("REPORT_DISCREPANCY"),
    branchId: z.string().uuid().optional().nullable(),
    sourceKind: sourceKindSchema,
    sourceId: z.string().uuid(),
    sourceBankAccountId: z.string().uuid().optional().nullable(),
    direction: z.enum(["OUTFLOW", "INFLOW"]),
    valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountCents: z.number().int(),
    expectedAmountCents: z.number().int().optional().nullable(),
    differenceCents: z.number().int(),
    discrepancyCode: discrepancyCodeSchema,
    reference: z.string().max(200).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    nowIso: z.string().datetime().optional(),
  }),
  z.object({
    action: z.literal("RESOLVE_WITH_TRACE"),
    sourceKind: sourceKindSchema,
    sourceId: z.string().uuid(),
    matchedTargetType: z.enum([
      "PAYMENT_RUN_ITEM",
      "GATEWAY_TRANSACTION",
      "MANUAL_DISPOSITION",
    ]),
    matchedTargetId: z.string().uuid().optional().nullable(),
    bankAmountCents: z.number().int(),
    targetAmountCents: z.number().int(),
    disposition: dispositionSchema.optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    nowIso: z.string().datetime().optional(),
  }),
]);

/**
 * GET /api/finance/bank-transactions/exceptions
 * Lista excepciones bancarias canónicas con fuente, antigüedad, diferencia y traza.
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") || undefined;
    const sourceKindRaw = sp.get("sourceKind");
    const sourceKind = sourceKindRaw
      ? (sourceKindSchema.parse(sourceKindRaw) as BankExceptionSourceKind)
      : undefined;
    const limit = sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined;

    const items = await listBankExceptions({
      companyId: ctx.userCompanyId,
      status,
      sourceKind,
      limit,
    });

    return ApiHandler.success({ items, total: items.length });
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/finance/bank-transactions/exceptions
 * Sincroniza excepciones bancarias, registra discrepancias o resuelve con traza
 * (rechaza con 409 cualquier intento de ocultar una diferencia sin disposición).
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = postSchema.parse(await req.json());

    if (body.action === "SYNC") {
      const summary = await syncCompanyBankExceptions({
        companyId: ctx.userCompanyId,
        now: body.nowIso ? new Date(body.nowIso) : undefined,
        pendingThresholdDays: body.pendingThresholdDays,
      });
      return ApiHandler.success(summary);
    }

    if (body.action === "REPORT_DISCREPANCY") {
      const sourceTable =
        body.sourceKind === "PAYMENT_RUN_ITEM"
          ? "payment_run_items"
          : body.sourceKind === "GATEWAY_TRANSACTION"
            ? "gateway_transactions"
            : "bank_transactions";

      const result = await recordBankDiscrepancyException({
        companyId: ctx.userCompanyId,
        branchId: body.branchId ?? null,
        actorId: ctx.userId,
        now: body.nowIso ? new Date(body.nowIso) : undefined,
        source: {
          sourceKind: body.sourceKind,
          sourceTable,
          sourceId: body.sourceId,
          sourceBankAccountId: body.sourceBankAccountId ?? null,
          direction: body.direction,
          valueDate: body.valueDate,
          amountCents: body.amountCents,
          expectedAmountCents: body.expectedAmountCents ?? null,
          differenceCents: body.differenceCents,
          discrepancyCode: body.discrepancyCode,
          reference: body.reference ?? null,
          description: body.description ?? null,
        },
      });
      return ApiHandler.success(result);
    }

    const resolution = await resolveBankExceptionOnReconciliation({
      companyId: ctx.userCompanyId,
      sourceKind: body.sourceKind,
      sourceId: body.sourceId,
      matchedTargetType: body.matchedTargetType,
      matchedTargetId: body.matchedTargetId ?? null,
      bankAmountCents: body.bankAmountCents,
      targetAmountCents: body.targetAmountCents,
      actorId: ctx.userId,
      disposition: body.disposition ?? null,
      notes: body.notes ?? null,
      now: body.nowIso ? new Date(body.nowIso) : undefined,
    });

    return ApiHandler.success(resolution);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
