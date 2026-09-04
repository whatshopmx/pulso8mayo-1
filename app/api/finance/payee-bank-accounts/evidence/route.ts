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
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/finance/payee-bank-accounts/evidence
 *
 * Sube el CEP de Banxico para la verificación de una cuenta de payee. Espejo
 * de `supplier-bank-accounts/evidence`; ruta propia (y prefijo propio en R2)
 * por la misma razón que esa: un CEP de payee archivado bajo el prefijo de
 * proveedor es invisible el día que alguien audite por qué se autorizó.
 */
export async function POST(req: NextRequest) {
  try {
    const { ctx } = await requirePermissionApi("settings", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || typeof file === "string") {
      throw ApiError.badRequest("El archivo del CEP es requerido.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw ApiError.badRequest("El archivo excede el tamaño máximo permitido (10MB).");
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw ApiError.badRequest(
        "Tipo de archivo no permitido. Sube el CEP en PDF o una captura (JPG, PNG, WebP).",
      );
    }

    if (isR2Configured()) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const storageKey = generateFileKey(
        ctx.userCompanyId,
        ctx.userId,
        "payee-clabe-verification-cep",
        file.name,
      );
      await uploadToR2(buffer, storageKey, file.type || "application/octet-stream");
      const previewUrl = await generatePresignedUrl(storageKey);
      return ApiHandler.success({ storageKey, previewUrl });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    return ApiHandler.success({
      storageKey: `local://payee-clabe-verification-cep/${Date.now()}_${safeName}`,
      previewUrl: null,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
