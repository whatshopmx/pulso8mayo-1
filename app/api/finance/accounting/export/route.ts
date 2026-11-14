import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { journalError, journalPrincipal } from "@/lib/services/accounting/journal-http";
import {
  exportCloseCsv,
  exportClosePdf,
  exportQuerySchema,
} from "@/lib/services/accounting/export-service";

export async function GET(req: NextRequest) {
  try {
    const ctx = await journalPrincipal(req, "read");
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const parsed = exportQuerySchema.parse({
      year: sp.get("year") ?? now.getUTCFullYear(),
      month: sp.get("month") ?? now.getUTCMonth() + 1,
      version: sp.get("version") || undefined,
      branchId: sp.get("branchId") || null,
      format: sp.get("format") || "csv",
    });

    if (parsed.format === "pdf") {
      const { filename, buffer } = await exportClosePdf(ctx, parsed);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const { filename, content } = await exportCloseCsv(ctx, parsed);
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return journalError(error);
  }
}
