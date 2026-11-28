import { NextRequest } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  checkAndInvalidateOnMaterialChange,
  getDocumentApprovalStatus,
  recordDocumentApproval,
} from "@/lib/services/document-approval-service";
import {
  defaultAuthoritySourceForDocument,
  type ApprovalAuthoritySource,
  type ApprovalDocumentType,
  type DocumentMaterialPayloadMap,
} from "@/lib/services/document-approval-rules";

const docTypeSchema = z.enum(["OC", "OS", "INVOICE", "EXPENSE", "PAYMENT_RUN", "PAYROLL"]);

const authoritySourceSchema = z.enum([
  "APPROVAL_MATRIX",
  "INVOICE_MATCH_POLICY",
  "EXPENSE_AUTH_RULES",
  "TREASURY_DUAL_APPROVAL",
  "PAYROLL_SNAPSHOT_NOM03",
]);

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECORD_APPROVAL"),
    docType: docTypeSchema,
    docId: z.string().uuid(),
    branchId: z.string().uuid().optional().nullable(),
    materialPayload: z.record(z.string(), z.unknown()),
    requiredRole: z.string().min(1),
    authoritySource: authoritySourceSchema.optional(),
    secondaryApproverId: z.string().optional().nullable(),
    requiresDualApproval: z.boolean().optional(),
    requesterId: z.string().optional().nullable(),
    evidenceId: z.string().uuid().optional().nullable(),
    expectedVersion: z.number().int().min(0).optional(),
    reason: z.string().max(500).optional().nullable(),
  }),
  z.object({
    action: z.literal("EVALUATE_MATERIAL_CHANGE"),
    docType: docTypeSchema,
    docId: z.string().uuid(),
    currentMaterialPayload: z.record(z.string(), z.unknown()),
    reason: z.string().max(500).optional().nullable(),
  }),
]);

/**
 * GET /api/finance/approvals/documents?docType=...&docId=...
 * Devuelve la versión aprobada, autoridad declarada, sucursal, evidencia,
 * huella material e historial del documento solicitado (OC, OS, INVOICE,
 * EXPENSE, PAYMENT_RUN o PAYROLL).
 */
export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const actorScope = resolveBranchScope(ctx.userRole as Role, ctx.userBranchId);
    if (actorScope.kind === "NONE") {
      throw ApiError.forbidden("Tu usuario no tiene alcance de sucursal asignado.");
    }

    const sp = req.nextUrl.searchParams;
    const rawDocType = sp.get("docType");
    const rawDocId = sp.get("docId");
    if (!rawDocType || !rawDocId) {
      throw ApiError.badRequest("Los parámetros docType y docId son obligatorios.");
    }

    const docType = docTypeSchema.parse(rawDocType) as ApprovalDocumentType;
    const docId = z.string().uuid("docId debe ser un UUID válido.").parse(rawDocId);

    const status = await getDocumentApprovalStatus({
      companyId: ctx.userCompanyId,
      docType,
      docId,
    });

    if (
      actorScope.kind === "BRANCH" &&
      status.branchId &&
      status.branchId !== actorScope.branchId
    ) {
      throw ApiError.forbidden("No tienes permiso para consultar aprobaciones de otra sucursal.");
    }

    return ApiHandler.success(status);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/finance/approvals/documents
 * Registra aprobación canónica con versión/autoridad/sucursal/evidencia/concurrencia
 * o evalúa e invalida por cambio material dentro de transacción auditada (`AUD-02`).
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const actorScope = resolveBranchScope(ctx.userRole as Role, ctx.userBranchId);
    const body = postSchema.parse(await req.json());

    if (body.action === "RECORD_APPROVAL") {
      const docType = body.docType as ApprovalDocumentType;
      const authoritySource: ApprovalAuthoritySource =
        body.authoritySource ?? defaultAuthoritySourceForDocument(docType);

      const res = await recordDocumentApproval({
        companyId: ctx.userCompanyId,
        docType,
        docId: body.docId,
        branchId: body.branchId ?? null,
        materialPayload:
          body.materialPayload as unknown as DocumentMaterialPayloadMap[typeof docType],
        authority: {
          requiredRole: body.requiredRole,
          actualActorRole: ctx.userRole,
          approverId: ctx.userId,
          secondaryApproverId: body.secondaryApproverId ?? null,
          requiresDualApproval: body.requiresDualApproval ?? false,
          authoritySource,
        },
        actorScope,
        requesterId: body.requesterId ?? null,
        evidenceId: body.evidenceId ?? null,
        expectedVersion: body.expectedVersion,
        reason: body.reason ?? null,
      });

      return ApiHandler.success(res);
    }

    const docType = body.docType as ApprovalDocumentType;
    const outcome = await checkAndInvalidateOnMaterialChange({
      companyId: ctx.userCompanyId,
      docType,
      docId: body.docId,
      currentMaterialPayload:
        body.currentMaterialPayload as unknown as DocumentMaterialPayloadMap[typeof docType],
      actorId: ctx.userId,
      reason: body.reason ?? null,
    });

    return ApiHandler.success(outcome);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
