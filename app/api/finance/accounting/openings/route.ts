import type { NextRequest } from "next/server";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";
import { createOpening, getOpening } from "@/lib/services/accounting/opening-service";

/** FC-08 — balanced opening of the ledger. Single per company and immutable. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "read");
    return journalResponse(await getOpening(ctx));
  } catch (error) { return journalError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "publish");
    return journalResponse(await createOpening(ctx, await journalJson(req)), 201);
  } catch (error) { return journalError(error); }
}
