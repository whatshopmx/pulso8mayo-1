import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, operatingExpenses } from "@/lib/db/schema";
import { ApiError, isApiError } from "@/lib/api/error";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { isBranchScopedRole } from "@/lib/branch-scope";
import { assertOperatingCfdiAccess } from "@/lib/services/operating-cfdi-preview";

/** El XML se entrega solo como adjunto de un gasto accesible; nunca se interpreta. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTenantAuth();
    assertOperatingCfdiAccess({ userId: auth.user.id, companyId: auth.tenantId, role: auth.user.role, assignedBranchId: auth.branchId });
    const parsed = z.uuid().safeParse((await params).id);
    if (!parsed.success) throw ApiError.badRequest("El identificador del comprobante no es válido.");
    const [document] = await db.select({ xml: invoices.xmlContent }).from(invoices)
      .innerJoin(operatingExpenses, and(eq(operatingExpenses.invoiceId, invoices.id),
        eq(operatingExpenses.companyId, auth.tenantId), eq(operatingExpenses.branchId, invoices.branchId)))
      .where(and(eq(invoices.companyId, auth.tenantId), eq(invoices.id, parsed.data),
        isBranchScopedRole(auth.user.role) ? eq(operatingExpenses.branchId, auth.branchId!) : undefined)).limit(1);
    if (!document?.xml?.trim()) throw ApiError.notFound("No hay un XML disponible para un gasto en tu alcance.");
    return new Response(document.xml, { headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="cfdi-${parsed.data}.xml"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: isApiError(error) ? error.message : "No se pudo consultar el XML del gasto." } },
      { status: isApiError(error) ? error.statusCode : 500, headers: { "Cache-Control": "no-store" } });
  }
}
