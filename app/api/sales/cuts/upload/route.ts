import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import { isR2Configured } from "@/lib/storage/r2-client";
import {
  assertPosUploadValid,
  sanitizePosFileName,
  storePosUpload,
} from "@/lib/storage/pos-upload";
import {
  ingestSalesCut,
  previewSalesCut,
  SalesIngestionError,
  type SalesCutShift,
} from "@/lib/services/sales-ingestion-service";

/** Mismos roles que la captura y la lectura del módulo de ventas. */
const ROLES_VENTAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const SHIFTS = ["MATUTINO", "VESPERTINO", "COMPLETO"] as const;

/**
 * POST /api/sales/cuts/upload
 *
 * Captura de un corte desde el archivo del POS (productor directo del módulo de
 * ventas). Antes subía los bytes con el namespace legacy `sales-cuts`, que no
 * lleva empresa/sucursal/día: la clave persistida en `raw_file_url` no podía
 * verificarse contra el contrato POS y la lectura autorizada la rechazaba.
 *
 * Ahora usa el mismo contrato que el cierre por smart link (`INV-01.b4.storage`):
 *  - alcance de sucursal resuelto de la sesión, antes de escribir;
 *  - validación de tamaño/MIME del export;
 *  - key canónica `companies/{companyId}/branches/{branchId}/pos/{businessDate}/…`
 *    con la empresa de la sesión y el día efectivo del corte;
 *  - se persiste la KEY, nunca una URL pública.
 *
 * El día efectivo lo decide el archivo (o el formulario como respaldo), así que
 * se resuelve con `previewSalesCut` antes de escribir los bytes y ese mismo
 * resultado se reutiliza para ingestar: la key y la fila no pueden discrepar.
 */
export const POST = withRoleAuth([...ROLES_VENTAS], async (req, { auth }) => {
  try {
    const companyId = auth.tenantId;
    if (!companyId) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const user = auth.user;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const branchId = ((formData.get("branchId") as string | null) ?? "").trim();
    const shift = formData.get("shift") as SalesCutShift | null;
    const businessDateStr = ((formData.get("businessDate") as string | null) ?? "").trim();

    if (!file || typeof file.arrayBuffer !== "function") {
      throw ApiError.badRequest("El archivo de corte es requerido.");
    }
    if (!branchId) {
      throw ApiError.badRequest("La sucursal es requerida.");
    }
    if (!shift || !SHIFTS.includes(shift)) {
      throw ApiError.badRequest(
        "El turno es requerido y debe ser MATUTINO, VESPERTINO o COMPLETO."
      );
    }

    // El archivo es evidencia financiera del corte: solo se captura para una
    // sucursal que el rol pueda leer. Sin esta guardia, un gerente podía dejar
    // el corte y su evidencia en una sucursal ajena que luego no podría abrir.
    const scope = resolveBranchScope(user.role ?? "EMPLEADO", user.branchId, branchId);
    if (scope.kind === "NONE" || (scope.kind === "BRANCH" && scope.branchId !== branchId)) {
      throw ApiError.forbidden("No puedes subir archivos POS de otra sucursal.");
    }
    await assertBranchOfCompany(companyId, branchId);

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    try {
      assertPosUploadValid({ byteLength: buffer.length, mimeType });
    } catch (validationError) {
      throw ApiError.badRequest(
        validationError instanceof Error ? validationError.message : "Archivo POS inválido."
      );
    }

    // La fecha que gobierna la key es la que buildSalesCut resuelve (fecha del
    // archivo > fecha capturada). Se rechaza o se acepta con las mismas reglas
    // que la ingesta: aquí solo se lee, no se persiste nada.
    const preview = await previewSalesCut({
      buffer,
      fileName: file.name,
      businessDate: businessDateStr || undefined,
    });

    // Si el corte no es válido (fecha futura, sin total, etc.) no se escribe el
    // objeto: `ingestSalesCut` devolverá el mismo rechazo sin dejar bytes
    // huérfanos. Sin R2 configurado se deja un marcador `local://` explícito que
    // NO afirma durabilidad, igual que el cierre por smart link.
    let rawFileUrl: string | undefined;
    if (preview.errors.length === 0 && preview.businessDate) {
      rawFileUrl = isR2Configured()
        ? await storePosUpload({
            companyId,
            branchId,
            businessDate: preview.businessDate,
            fileName: file.name,
            buffer,
            mimeType,
          })
        : `local://pos-uploads/${companyId}/${branchId}/${preview.businessDate}-${sanitizePosFileName(file.name)}`;
    }

    const result = await ingestSalesCut({
      companyId,
      branchId,
      buffer,
      fileName: file.name,
      shift,
      source: "UPLOAD",
      businessDate: businessDateStr || undefined,
      receivedBy: user.id,
      rawFileUrl,
      precomputed: preview,
    });

    return ApiHandler.success(result);
  } catch (error) {
    if (error instanceof SalesIngestionError) {
      return ApiHandler.error(new ApiError(error.message, 400, error.code));
    }
    return ApiHandler.error(error);
  }
});
