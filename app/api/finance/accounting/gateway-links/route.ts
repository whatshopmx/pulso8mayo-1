import type { NextRequest } from "next/server";
import { z } from "zod";
import { linkGateway, listGatewayLinks } from "@/lib/services/accounting/account-service";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";

/** Private configuration; uses the existing accounting flag, session and settings permission. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "read");
    const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
      .parse(Object.fromEntries(req.nextUrl.searchParams));
    return journalResponse(await listGatewayLinks(ctx, { page: query.page, pageSize: 100 }));
  } catch (error) { return journalError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "update");
    return journalResponse(await linkGateway(ctx, await journalJson(req)), 201);
  } catch (error) { return journalError(error); }
}
