import { NextRequest } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { isR2Configured, uploadToR2, generateFileKey, generatePresignedUrl } from "@/lib/storage/r2-client";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

/**
 * POST /api/expenses/evidence
 * Sube la foto del ticket de un gasto sin CFDI y devuelve su URL (R2, o
 * fallback local `local://` cuando no hay credenciales — dev). El URL se
 * envía después en POST /api/expenses como `evidenceUrl`.
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || typeof file === "string") {
      throw ApiError.badRequest("El archivo de evidencia es requerido.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw ApiError.badRequest("El archivo excede el tamaño máximo permitido (10MB).");
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw ApiError.badRequest("Tipo de archivo no permitido. Sube una foto (JPG, PNG, WebP, HEIC) o PDF.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (isR2Configured()) {
      const fileKey = generateFileKey(tenant.id, user.id, "expense-evidence", file.name);
      await uploadToR2(buffer, fileKey, file.type || "application/octet-stream");
      // Se persiste la KEY (durable); la URL que consume el cliente para
      // preview es presignada y expira — el bucket ya no es público.
      const url = await generatePresignedUrl(fileKey);
      return ApiHandler.success({ url, storageKey: fileKey });
    }

    // Fallback local (dev sin R2): la API sigue funcionando y guarda la referencia.
    return ApiHandler.success({
      url: `local://expense-evidence/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`,
      storageKey: null,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
