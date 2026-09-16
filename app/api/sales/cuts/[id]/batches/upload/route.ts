import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  isR2Configured,
  uploadToR2,
  generateFileKey,
  generatePresignedUrl,
} from "@/lib/storage/r2-client";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

/**
 * POST /api/sales/cuts/[id]/batches/upload
 *
 * Sube la fotografía o escaneo del voucher de cierre de lote físico.
 * Devuelve la llave durable en R2 y la URL de vista previa.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || typeof file === "string") {
      throw ApiError.badRequest("La fotografía del voucher es requerida.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw ApiError.badRequest("El archivo excede el tamaño máximo permitido (10MB).");
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw ApiError.badRequest(
        "Tipo de archivo no permitido. Sube una fotografía (JPG, PNG, WebP) o PDF del voucher."
      );
    }

    if (isR2Configured()) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const storageKey = generateFileKey(
        ctx.userCompanyId,
        ctx.userId,
        `tpv-vouchers/${id}`,
        file.name
      );
      await uploadToR2(buffer, storageKey, file.type || "application/octet-stream");
      const previewUrl = await generatePresignedUrl(storageKey);
      return ApiHandler.success({ storageKey, previewUrl });
    }

    // Fallback local
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    return ApiHandler.success({
      storageKey: `local://tpv-vouchers/${id}/${Date.now()}_${safeName}`,
      previewUrl: null,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
