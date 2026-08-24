import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { ingestSalesCut, SalesIngestionError, type SalesCutShift } from "@/lib/services/sales-ingestion-service";
import { isR2Configured, uploadToR2, generateFileKey } from "@/lib/storage/r2-client";

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const branchId = formData.get("branchId") as string;
    const shift = formData.get("shift") as SalesCutShift; // "MATUTINO" | "VESPERTINO" | "COMPLETO"
    const businessDateStr = formData.get("businessDate") as string; // optional YYYY-MM-DD

    if (!file) {
      throw ApiError.badRequest("El archivo de corte es requerido.");
    }
    if (!branchId) {
      throw ApiError.badRequest("La sucursal es requerida.");
    }
    if (!shift || !["MATUTINO", "VESPERTINO", "COMPLETO"].includes(shift)) {
      throw ApiError.badRequest("El turno es requerido y debe ser MATUTINO, VESPERTINO o COMPLETO.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Upload to R2 if configured
    let rawFileUrl: string | undefined = undefined;
    if (isR2Configured()) {
      try {
        const fileKey = generateFileKey(tenant.id, user.id, "sales-cuts", file.name);
        await uploadToR2(buffer, fileKey, file.type || "application/octet-stream");
        // Provenance: se persiste la KEY (identificador durable del objeto), no
        // una URL pública. La re-lectura pasa por presigned con guardia.
        rawFileUrl = fileKey;
      } catch (r2Err) {
        console.warn("[Sales Upload API] R2 upload failed (non-fatal):", r2Err);
      }
    }

    const result = await ingestSalesCut({
      companyId: tenant.id,
      branchId,
      buffer,
      fileName: file.name,
      shift,
      source: "UPLOAD",
      businessDate: businessDateStr || undefined,
      receivedBy: user.id,
      rawFileUrl
    });

    return ApiHandler.success(result);
  } catch (error) {
    if (error instanceof SalesIngestionError) {
      return ApiHandler.error(new ApiError(error.message, 400, error.code));
    }
    return ApiHandler.error(error);
  }
}
