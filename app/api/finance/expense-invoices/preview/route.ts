import { NextResponse } from "next/server";
import { ApiError, isApiError } from "@/lib/api/error";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { readOperatingCfdiUpload } from "@/lib/services/operating-cfdi-upload";
import { assertOperatingCfdiAccess, previewOperatingCfdi } from "@/lib/services/operating-cfdi-preview";

export async function POST(req: Request) {
  try {
    const auth = await requireTenantAuth();
    const actor = { userId: auth.user.id, companyId: auth.tenantId, role: auth.user.role, assignedBranchId: auth.branchId };
    assertOperatingCfdiAccess(actor);
    const { form, xml } = await readOperatingCfdiUpload(req);
    const branchId = form.get("branchId");
    if (form.getAll("branchId").length !== 1 || typeof branchId !== "string") throw ApiError.badRequest("Selecciona una sucursal válida.");
    const preview = await previewOperatingCfdi(actor, { xml, branchId });
    return NextResponse.json({ success: true, data: preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!isApiError(error)) console.error("operating-cfdi-preview: fallo inesperado", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ success: false, error: {
      message: isApiError(error) ? error.message : "No se pudo generar la vista previa del CFDI.",
    } }, { status: isApiError(error) ? error.statusCode : 500, headers: { "Cache-Control": "no-store" } });
  }
}
