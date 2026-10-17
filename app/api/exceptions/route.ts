import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiHandler } from "@/lib/api/response";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { exceptionBranchScope } from "@/lib/api/exception-access";
import { ExceptionService } from "@/lib/services/exception-service";
import type {
  ExceptionDomain,
  ExceptionSeverity,
  ExceptionStatus,
  QsrRiskCategory,
} from "@/lib/services/exception-types";

const DOMAINS = [
  "operacion",
  "cumplimiento",
  "equipos",
  "personal",
  "inventario",
  "finanzas",
] as const;

const SEVERITIES = ["info", "warning", "high", "critical", "fatal"] as const;

const QSR_CATEGORIES = ["DINERO", "INOCUIDAD", "ABASTO", "PERSONAL"] as const;

const createSchema = z.object({
  branchId: z.string().optional().nullable(),
  domain: z.enum(DOMAINS),
  qsrCategory: z.enum(QSR_CATEGORIES),
  severity: z.enum(SEVERITIES),
  subjectType: z.string().min(1, "El tipo de sujeto es requerido."),
  subjectId: z.string().min(1, "El id del sujeto es requerido."),
  reason: z.string().min(1, "La razón es requerida."),
  ownerId: z.string().optional().nullable(),
  actionMeta: z.record(z.string(), z.unknown()).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * GET /api/exceptions
 * Feed de excepciones del tenant, acotado por sucursal según el rol.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { ctx } = await requirePermissionApi("exceptions", "read", {
      audit: { action: "READ", req },
    });

    const scope = exceptionBranchScope(ctx.userRole, ctx.userBranchId);
    if (scope.kind === "NONE") {
      return ApiHandler.success({ exceptions: [], total: 0 });
    }

    const { searchParams } = new URL(req.url);
    const requestedBranch = searchParams.get("branchId");
    const branchId =
      scope.kind === "BRANCH" ? scope.branchId : (requestedBranch ?? null);

    const statusParam = searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",").filter(Boolean) as ExceptionStatus[])
      : undefined;

    // `open=true` usa el feed de control (excluye terminales).
    const rows =
      searchParams.get("open") === "true"
        ? await ExceptionService.listOpen(ctx.userCompanyId, { branchId })
        : await ExceptionService.list(ctx.userCompanyId, {
            branchId,
            status,
            domain: (searchParams.get("domain") as ExceptionDomain) || undefined,
            severity:
              (searchParams.get("severity") as ExceptionSeverity) || undefined,
            qsrCategory:
              (searchParams.get("qsrCategory") as QsrRiskCategory) || undefined,
            ownerId: searchParams.get("ownerId") ?? undefined,
            subjectType: searchParams.get("subjectType") ?? undefined,
            limit: Number(searchParams.get("limit") ?? 200),
            offset: Number(searchParams.get("offset") ?? 0),
          });

    return ApiHandler.success({ exceptions: rows, total: rows.length });
  } catch (error) {
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/exceptions
 * Alta manual de excepción (upsert idempotente por subject).
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { ctx } = await requirePermissionApi("exceptions", "update", {
      audit: { action: "UPDATE", req },
    });
    const body = await req.json();
    const input = createSchema.parse(body);

    const row = await ExceptionService.raise({
      companyId: ctx.userCompanyId,
      branchId: input.branchId ?? null,
      domain: input.domain,
      qsrCategory: input.qsrCategory,
      severity: input.severity,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.reason,
      ownerId: input.ownerId ?? null,
      actionMeta: input.actionMeta ?? null,
      metadata: input.metadata ?? null,
      actorId: ctx.userId,
    });

    return ApiHandler.success({ exception: row }, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
