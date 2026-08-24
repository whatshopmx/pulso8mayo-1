import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  SalesIngestService,
  guessMapping,
  detectDelimiter,
  type SalesColumnMapping,
} from "@/lib/services/sales-ingest-service";

/**
 * POST /api/workflows/smart-links/upload-pos
 * Receives a POS report file upload during branch closure workflow.
 * Stores the file URL in the dailySalesCuts record for the matching date/branch
 * and ingests the sales rows via SalesIngestService (T10: el cierre del gerente
 * alimenta las ventas reales sin paso manual).
 *
 * El fallo de parseo NO bloquea la evidencia: si el archivo no se puede leer
 * como CSV de ventas, se guarda igual y se registra una advertencia.
 *
 * Body (multipart/form-data or JSON):
 *   - branchId: string (required)
 *   - workflowInstanceId: string (optional)
 *   - stepId: string (optional)
 *   - fileUrl: string (URL del archivo CSV/Excel del POS; ruta JSON)
 *   - businessDate: string (opcional, defaults to today)
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const auth = await requireAuth();

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

      // T10: intentar ingestar ventas del archivo. Cualquier fallo aquí deja
      // solo una advertencia — la evidencia del workflow se guarda siempre.
      let salesSummary: Awaited<ReturnType<typeof SalesIngestService.ingest>> | null = null;
      let parseWarning: string | undefined;

      try {
        const csvText = await file.text();
        const delimiter = detectDelimiter(csvText);
        const headers = csvText.split(/\r?\n/, 1)[0]?.split(delimiter).map((h) => h.trim()) ?? [];
        const mapping =
          guessMapping(headers) ??
          (formData.get("mapping")
            ? (JSON.parse(formData.get("mapping") as string) as SalesColumnMapping)
            : null);

        if (!mapping) {
          parseWarning =
            "No se pudieron identificar las columnas del archivo; se guardó como evidencia pero no generó ventas.";
        } else {
          const parsed = SalesIngestService.buildRows(csvText, mapping, {
            defaultDay: businessDate,
            delimiter,
          });
          if (parsed.rows.length === 0) {
            parseWarning = `El archivo no contiene filas de ventas válidas (${parsed.errors[0]?.message ?? "sin datos"}); se guardó como evidencia.`;
          } else {
            salesSummary = await SalesIngestService.ingest({
              companyId: tenant.id,
              branchId,
              userId: auth.user.id,
              rows: parsed.rows,
            });
            if (parsed.errors.length > 0 || salesSummary.errors.length > 0) {
              parseWarning = `${parsed.errors.length + salesSummary.errors.length} fila(s) omitida por errores.`;
            }
          }
        }
      } catch (parseError) {
        console.error("[upload-pos] parse/ingest failed:", parseError);
        parseWarning =
          "El archivo se guardó como evidencia pero no pudo procesarse como ventas.";
      }

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
        ...(salesSummary ? { sales: salesSummary } : {}),
        ...(parseWarning ? { warning: parseWarning } : {}),
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
