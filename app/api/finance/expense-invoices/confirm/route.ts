import { NextResponse } from "next/server";
import { ApiError, isApiError } from "@/lib/api/error";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { assertOperatingCfdiAccess } from "@/lib/services/operating-cfdi-preview";
import { readOperatingCfdiUpload } from "@/lib/services/operating-cfdi-upload";
import { confirmOperatingCfdi } from "@/lib/services/operating-cfdi-confirm";

export async function POST(req: Request) {
  try {
    const auth = await requireTenantAuth();
    const actor = { userId: auth.user.id, companyId: auth.tenantId, role: auth.user.role, assignedBranchId: auth.branchId };
    assertOperatingCfdiAccess(actor);
    const { form, xml } = await readOperatingCfdiUpload(req);
    const data = form.get("data");
    if (form.getAll("data").length !== 1 || typeof data !== "string") throw ApiError.badRequest("Faltan los datos de confirmación del gasto.");
    let metadata: unknown;
    try { metadata = JSON.parse(data); } catch { throw ApiError.badRequest("Los datos de confirmación no son JSON válido."); }
    const result = await confirmOperatingCfdi(actor, xml, metadata);
    return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isApiError(error)) console.error("operating-cfdi-confirm: fallo inesperado", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ success: false, error: {
      message: isApiError(error) ? error.message : "No se pudo confirmar el CFDI del gasto.",
    } }, { status: isApiError(error) ? error.statusCode : 500, headers: { "Cache-Control": "no-store" } });
  }
}
