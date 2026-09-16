import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  GatewayReportService,
} from "@/lib/services/gateway-report-service";
import type { AcquirerType } from "@/lib/services/gateway-report-parser";
import {
  isR2Configured,
  uploadToR2,
  generateFileKey,
} from "@/lib/storage/r2-client";

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * POST /api/finance/reconciliation/upload
 *
 * Sube y procesa un reporte de pasarela (CSV o Excel de Clip, Mercado Pago, bancos).
 * Normaliza transacciones, segrega comisiones e IVA del 16% e inserta idempotentemente.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const branchId = formData.get("branchId") as string | null;
    const acquirer = (formData.get("acquirer") as AcquirerType | null) || "OTHER";

    if (!file || typeof file === "string") {
      throw ApiError.badRequest("El archivo de reporte es requerido.");
    }
    if (!branchId) {
      throw ApiError.badRequest("La sucursal es requerida.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw ApiError.badRequest(
        "El archivo excede el tamaño máximo permitido (15MB)."
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Almacenar archivo original en R2 si está configurado
    let rawFileUrl: string | undefined = undefined;
    if (isR2Configured()) {
      try {
        const fileKey = generateFileKey(
          ctx.userCompanyId,
          ctx.userId,
          "gateway-reports",
          file.name
        );
        await uploadToR2(
          buffer,
          fileKey,
          file.type || "application/octet-stream"
        );
        rawFileUrl = fileKey;
      } catch (r2Err) {
        console.warn("[Gateway Upload] R2 upload failed (non-fatal):", r2Err);
      }
    }

    const result = await GatewayReportService.importReport({
      companyId: ctx.userCompanyId,
      branchId,
      acquirer,
      fileName: file.name,
      buffer,
      userId: ctx.userId,
      rawFileUrl,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
