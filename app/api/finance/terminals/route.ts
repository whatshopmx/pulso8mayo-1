import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError, isApiError } from "@/lib/api/error";
import { TerminalService } from "@/lib/services/terminal-service";
import { terminalAcquirerEnum } from "@/lib/db/schema";
import { z } from "zod";

const createTerminalSchema = z.object({
  branchId: z.string().uuid("Sucursal inválida"),
  serialNumber: z.string().min(2, "El número de serie debe tener al menos 2 caracteres"),
  alias: z.string().min(2, "El alias debe tener al menos 2 caracteres"),
  acquirer: z.enum(terminalAcquirerEnum.enumValues),
  affiliationNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateTerminalSchema = z.object({
  id: z.string().uuid("ID de terminal inválido"),
  branchId: z.string().uuid("Sucursal inválida").optional(),
  alias: z.string().min(2, "El alias debe tener al menos 2 caracteres").optional(),
  acquirer: z.enum(terminalAcquirerEnum.enumValues).optional(),
  affiliationNumber: z.string().optional().nullable(),
  active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "read", {
      classification: "FINANCIAL",
      audit: { action: "READ", req },
    });

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    const terminals = await TerminalService.getTerminals(
      ctx.userCompanyId,
      branchId
    );

    return ApiHandler.success({ terminals });
  } catch (error: any) {
    if (isApiError(error)) return ApiHandler.error(error, error.statusCode);
    return ApiHandler.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const parsed = createTerminalSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(
        ApiError.badRequest(
          parsed.error.issues.map((e) => e.message).join(", ")
        )
      );
    }

    const terminal = await TerminalService.createTerminal({
      companyId: ctx.userCompanyId,
      branchId: parsed.data.branchId,
      serialNumber: parsed.data.serialNumber,
      alias: parsed.data.alias,
      acquirer: parsed.data.acquirer,
      affiliationNumber: parsed.data.affiliationNumber,
      notes: parsed.data.notes,
      userId: ctx.userId,
    });

    return ApiHandler.success({ terminal }, 201);
  } catch (error: any) {
    if (isApiError(error)) return ApiHandler.error(error, error.statusCode);
    return ApiHandler.error(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const body = await req.json();
    const parsed = updateTerminalSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(
        ApiError.badRequest(
          parsed.error.issues.map((e) => e.message).join(", ")
        )
      );
    }

    const { id, ...data } = parsed.data;

    const terminal = await TerminalService.updateTerminal(
      id,
      ctx.userCompanyId,
      {
        ...data,
        userId: ctx.userId,
      }
    );

    return ApiHandler.success({ terminal });
  } catch (error: any) {
    if (isApiError(error)) return ApiHandler.error(error, error.statusCode);
    return ApiHandler.error(error);
  }
}
