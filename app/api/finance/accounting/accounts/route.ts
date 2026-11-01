import type { NextRequest } from "next/server";
import { z } from "zod";
import { listAccounts } from "@/lib/services/accounting/account-service";
import { journalError, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";

export async function GET(req:NextRequest) {
  try {
    const ctx=await journalPrincipal(req,"create");
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1)}).strict()
      .parse(Object.fromEntries(req.nextUrl.searchParams));
    return journalResponse(await listAccounts(ctx,{page:query.page,pageSize:100}));
  } catch(error) { return journalError(error); }
}
