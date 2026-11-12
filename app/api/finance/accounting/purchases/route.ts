import type { NextRequest } from "next/server";
import { declarePurchase } from "@/lib/services/accounting/purchase-adapter";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";

/** Declare a reviewed existing document, without duplicating stock or invoice capture. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "publish");
    return journalResponse(await declarePurchase(ctx, await journalJson(req)), 201);
  } catch (error) { return journalError(error); }
}
