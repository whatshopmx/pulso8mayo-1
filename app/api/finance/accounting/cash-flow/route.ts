import type { NextRequest } from "next/server";
import { journalError, journalPrincipal, journalResponse } from "@/lib/services/accounting/journal-http";
import { getPnlToCashBridge } from "@/lib/services/accounting/pnl-bridge-service";

export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "read");
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const defaultTo = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const fromDate = sp.get("fromDate") || defaultFrom;
    const toDate = sp.get("toDate") || defaultTo;
    const branchId = sp.get("branchId") || null;

    return journalResponse(
      await getPnlToCashBridge(ctx, {
        fromDate,
        toDate,
        branchId,
      }),
    );
  } catch (error) {
    return journalError(error);
  }
}
