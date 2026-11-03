import type { NextRequest } from "next/server";
import { z } from "zod";
import { listPendingAccountingEvents, pendingAccountingQuery, retryAccountingEvent } from "@/lib/services/accounting/event-service";
import { journalError, journalJson, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";

export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "read");
    return journalResponse(await listPendingAccountingEvents(ctx,
      pendingAccountingQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
  } catch (error) { return journalError(error); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "publish");
    const { eventId } = z.object({ eventId: z.uuid() }).strict().parse(await journalJson(req));
    return journalResponse(await retryAccountingEvent(ctx, eventId));
  } catch (error) { return journalError(error); }
}
