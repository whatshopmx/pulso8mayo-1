import type { NextRequest } from "next/server";
import { z } from "zod";
import { declareSalesCut, recordSalesRefund } from "@/lib/services/accounting/sales-adapter";
import { refundDeclarationSchema, saleDeclarationSchema } from "@/lib/services/accounting/sales-contract";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("DECLARE"), document: saleDeclarationSchema }).strict(),
  z.object({ action: z.literal("REFUND"), document: refundDeclarationSchema }).strict(),
]);
export async function POST(req: NextRequest) {
  try {
    await journalPrincipal(req, "read");
    const input = requestSchema.parse(await journalJson(req));
    const ctx = await journalPrincipal(req, input.action === "DECLARE" ? "publish" : "reverse");
    return journalResponse(input.action === "DECLARE" ? await declareSalesCut(ctx, input.document)
      : await recordSalesRefund(ctx, input.document));
  } catch (error) { return journalError(error); }
}
