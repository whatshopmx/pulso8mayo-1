import type { NextRequest } from "next/server";
import { createDraft, journalDraftSchema, listJournals } from "@/lib/services/accounting/journal-service";
import { journalError, journalJson, journalPrincipal, journalQuerySchema, journalResponse } from "@/lib/services/accounting/journal-http";

export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req,"read");
    return journalResponse(await listJournals(ctx,journalQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
  } catch(error) { return journalError(error); }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req,"create");
    const input = journalDraftSchema.omit({source:true}).strict().parse(await journalJson(req));
    return journalResponse(await createDraft(ctx,input),201);
  } catch(error) { return journalError(error); }
}
