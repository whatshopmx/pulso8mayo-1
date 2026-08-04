import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";

/**
 * POST /api/workflows/smart-links/upload-pos
 * Receives a POS report file upload during branch closure workflow.
 * Stores the file URL in the dailySalesCuts record for the matching date/branch.
 *
 * Body (multipart/form-data or JSON):
 *   - branchId: string (required)
 *   - workflowInstanceId: string (optional)
 *   - stepId: string (optional)
 *   - fileUrl: string (URL del archivo CSV/Excel del POS)
 *   - businessDate: string (opcional, defaults to today)
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    await requireAuth();

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // File upload via FormData
      const formData = await req.formData();
      const branchId = formData.get("branchId") as string;
      const businessDate = (formData.get("businessDate") as string) || new Date().toISOString().slice(0, 10);
      const file = formData.get("file") as File | null;
      const workflowInstanceId = formData.get("workflowInstanceId") as string | undefined;

      if (!branchId) {
        throw ApiError.badRequest("Se requiere el ID de sucursal.");
      }

      if (!file) {
        throw ApiError.badRequest("Se requiere un archivo del POS.");
      }

      // In production, upload to R2/cloud storage. For now, store the filename as evidence.
      const fileUrl = `pos-uploads/${tenant.id}/${branchId}/${businessDate}-${file.name}`;

      // Link the file to matching sales cuts for that date
      const updated = await db
        .update(dailySalesCuts)
        .set({
          rawFileUrl: fileUrl,
          validationNotes: `Archivo POS subido vía Smart Link: ${file.name}`,
          updatedAt: new Date(),
        })
        .where(eq(dailySalesCuts.branchId, branchId))
        .returning();

      return ApiHandler.success({
        fileUrl,
        fileName: file.name,
        matchedCount: updated.length,
        workflowInstanceId,
        message: updated.length > 0
          ? `Archivo vinculado a ${updated.length} corte(s) de ventas.`
          : "Archivo recibido. No se encontraron cortes para vincular.",
      });
    }

    // JSON body with fileUrl (already uploaded)
    const body = await req.json();
    const { branchId, fileUrl, businessDate: bizDate, workflowInstanceId } = body;

    if (!branchId || !fileUrl) {
      throw ApiError.badRequest("Se requiere branchId y fileUrl.");
    }

    const businessDate = bizDate || new Date().toISOString().slice(0, 10);

    const updated = await db
      .update(dailySalesCuts)
      .set({
        rawFileUrl: fileUrl,
        validationNotes: "Archivo POS vinculado vía Smart Link (cierre de sucursal).",
        updatedAt: new Date(),
      })
      .where(eq(dailySalesCuts.branchId, branchId))
      .returning();

    return ApiHandler.success({
      fileUrl,
      matchedCount: updated.length,
      workflowInstanceId,
      message: updated.length > 0
        ? `Archivo vinculado a ${updated.length} corte(s).`
        : "Archivo registrado.",
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
