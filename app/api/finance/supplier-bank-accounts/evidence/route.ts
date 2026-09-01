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
 * POST /api/finance/supplier-bank-accounts/evidence
 *
 * Sube el CEP de Banxico y devuelve su llave durable, que después viaja como
 * `evidenceUrl` a `[id]/verify`.
 *
 * Ruta propia y no `/api/expenses/evidence` por dos razones: el permiso
 * (`settings:update` clasificado FINANCIAL, no cualquier sesión autenticada) y
 * el prefijo en R2 — un CEP archivado bajo `expense-evidence` es invisible el
 * día que alguien audite por qué se autorizó una cuenta.
 *
 * Se devuelven la llave y una URL de vista previa por separado: la presignada
 * expira en una hora y lo que se persiste tiene que seguir sirviendo meses
 * después.
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
        "clabe-verification-cep",
        file.name,
      );
      await uploadToR2(buffer, storageKey, file.type || "application/octet-stream");
      const previewUrl = await generatePresignedUrl(storageKey);
      return ApiHandler.success({ storageKey, previewUrl });
    }

    // Fallback local (dev sin R2): la verificación sigue siendo demostrable y
    // la referencia queda anotada como local para que nadie la confunda con un
    // CEP realmente archivado.
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    return ApiHandler.success({
      storageKey: `local://clabe-verification-cep/${Date.now()}_${safeName}`,
      previewUrl: null,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
