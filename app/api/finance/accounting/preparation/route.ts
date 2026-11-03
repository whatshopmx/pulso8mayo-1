import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAccount, linkSource, readAccountingPreparation } from "@/lib/services/accounting/account-service";
import { previewExpenseRecognition } from "@/lib/services/accounting/expense-adapter";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";
import { ApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import { getRoleScope } from "@/lib/rbac/resource-scope";

async function principal(req: NextRequest, action: "read" | "update") {
  const ctx = await journalPrincipal(req, action);
  if (!hasPermission(ctx.role, "settings", "update") || getRoleScope(ctx.role) !== "COMPANY") {
    throw ApiError.forbidden("Preparar la contabilidad requiere permiso de configuración y alcance de empresa.");
  }
  return ctx;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await principal(req, "read");
    const { expenseId } = z.object({ expenseId: z.uuid().optional() }).strict()
      .parse(Object.fromEntries(req.nextUrl.searchParams));
    return journalResponse(expenseId ? await previewExpenseRecognition(ctx, expenseId) : await readAccountingPreparation(ctx));
  } catch (error) { return journalError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await principal(req, "update");
    const { action, input } = z.object({ action: z.enum(["account", "link"]), input: z.unknown() }).strict()
      .parse(await journalJson(req));
    // The existing services validate the complete input, tenant and active actor.
    return journalResponse(action === "account"
      ? await createAccount(ctx, input as Parameters<typeof createAccount>[1])
      : await linkSource(ctx, input as Parameters<typeof linkSource>[1]), 201);
  } catch (error) { return journalError(error); }
}
