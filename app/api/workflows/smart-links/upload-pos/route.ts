import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import { hasPermission } from "@/lib/permissions";
import { validateSaleDay } from "@/lib/services/sale-consumption-contract";
import {
  SalesIngestService,
  guessMapping,
  detectDelimiter,
  splitCsv,
} from "@/lib/services/sales-ingest-service";

const uploadScope = z.object({ branchId: z.string().uuid(), businessDate: z.string().refine(value => {
  try { validateSaleDay(value); return true; } catch { return false; }
}, "Día del corte inválido") });
const mappingSchema = z.object({ recipeRef: z.string().min(1), quantitySold: z.string().min(1),
  productKey: z.string().optional(), saleDate: z.string().optional(), totalRevenue: z.string().optional() });
async function assertUploadScope(companyId: string, branchId: string, auth: Awaited<ReturnType<typeof requireAuth>>) {
  const scope = resolveBranchScope(auth.user.role ?? "EMPLEADO", auth.user.branchId, branchId);
  if (scope.kind === "NONE" || (scope.kind === "BRANCH" && scope.branchId !== branchId)) throw ApiError.forbidden("No puedes subir archivos POS de otra sucursal.");
  await assertBranchOfCompany(companyId, branchId);
}

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
    if (auth.user.companyId !== tenant.id) throw ApiError.forbidden("La empresa no coincide con tu sesión.");
    if (!hasPermission(auth.user.role ?? "EMPLEADO", "inventory", "manage")) throw ApiError.forbidden("No tienes permisos para registrar ventas.");

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // File upload via FormData
      const formData = await req.formData();
      const { branchId, businessDate } = uploadScope.parse({ branchId: formData.get("branchId"),
        businessDate: formData.get("businessDate") ?? new Date().toISOString().slice(0, 10) });
      const file = formData.get("file") as File | null;
      const workflowInstanceId = formData.get("workflowInstanceId") as string | undefined;

      if (!file || typeof file.text !== "function") {
        throw ApiError.badRequest("Se requiere un archivo del POS.");
      }
      await assertUploadScope(tenant.id, branchId, auth);

      // In production, upload to R2/cloud storage. For now, store the filename as evidence.
      const fileUrl = `pos-uploads/${tenant.id}/${branchId}/${businessDate}-${file.name}`;

      // T10: intentar ingestar ventas del archivo. Cualquier fallo aquí deja
      // solo una advertencia — la evidencia del workflow se guarda siempre.
      let salesSummary: Awaited<ReturnType<typeof SalesIngestService.ingest>> | null = null;
      let parseWarning: string | undefined;

      try {
        const csvText = await file.text();
        const delimiter = detectDelimiter(csvText);
        const headers = splitCsv(csvText, delimiter)[0] ?? [];
        const mapping =
          (formData.get("mapping")
            ? mappingSchema.parse(JSON.parse(formData.get("mapping") as string))
            : guessMapping(headers));

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
              source: "pos:import",
              rows: parsed.rows,
            });
            salesSummary = { ...salesSummary, errors: [...parsed.errors, ...salesSummary.errors],
              revenueComplete: parsed.errors.length === 0 && salesSummary.revenueComplete };
            if (salesSummary.errors.length > 0) {
              parseWarning = `${salesSummary.errors.length} fila(s) omitida por errores.`;
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
        .where(and(eq(dailySalesCuts.companyId, tenant.id), eq(dailySalesCuts.branchId, branchId), eq(dailySalesCuts.businessDate, businessDate)))
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
    const body = z.object({ branchId: z.string().uuid(), fileUrl: z.string().min(1), businessDate: z.string().optional(), workflowInstanceId: z.string().optional() }).parse(await req.json());
    const { fileUrl, workflowInstanceId } = body;
    const { branchId, businessDate } = uploadScope.parse({ branchId: body.branchId, businessDate: body.businessDate ?? new Date().toISOString().slice(0, 10) });
    await assertUploadScope(tenant.id, branchId, auth);

    const updated = await db
      .update(dailySalesCuts)
      .set({
        rawFileUrl: fileUrl,
        validationNotes: "Archivo POS vinculado vía Smart Link (cierre de sucursal).",
        updatedAt: new Date(),
      })
      .where(and(eq(dailySalesCuts.companyId, tenant.id), eq(dailySalesCuts.branchId, branchId), eq(dailySalesCuts.businessDate, businessDate)))
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
