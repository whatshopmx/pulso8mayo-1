import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { hasPermission, type Role } from "@/lib/permissions";
import { createRecoveryAttachment, getRecoveryAttachmentUrl, removeRecoveryAttachment } from "@/lib/services/sale-recovery-attachments";

function capability(role: Role) {
  if (!hasPermission(role, "inventory", "manage")) throw ApiError.forbidden("Sin capacidad para gestionar evidencia de recuperación");
}
/** Limita bytes reales antes de parsear multipart/JSON; Content-Length no es autoridad. */
async function bodyOf(req: Request, maximum: number): Promise<ArrayBuffer> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) throw ApiError.badRequest("Tamaño de solicitud inválido");
  if (declared !== null && Number(declared) > maximum) throw new ApiError("La solicitud excede el tamaño permitido", 413);
  const reader = req.body?.getReader();
  if (!reader) throw ApiError.badRequest("La solicitud requiere contenido");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel().catch(() => {}); throw new ApiError("La solicitud excede el tamaño permitido", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

export const POST = withTenantAuth(async (req, { auth }) => {
  capability(auth.user.role as Role);
  const body = await bodyOf(req, 21 * 1024 * 1024); // 20 MiB de archivo + envoltorio multipart.
  let form: FormData;
  try { form = await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw ApiError.badRequest("Se requiere un archivo multipart válido"); }
  for (const key of form.keys()) {
    if (!["file", "branchId", "legacySaleId"].includes(key) || form.getAll(key).length !== 1) throw ApiError.badRequest("Campos de evidencia inválidos o duplicados");
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw ApiError.badRequest("El archivo de evidencia es requerido");
  if (file.size > 20 * 1024 * 1024) throw new ApiError("El archivo excede 20 MiB", 413);
  const data = await createRecoveryAttachment({ branchId: form.get("branchId"), legacySaleId: form.get("legacySaleId"),
    mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
  return ApiHandler.success(data, 201);
});

export const GET = withTenantAuth(async (req, { auth }) => {
  capability(auth.user.role as Role);
  const params = new URL(req.url).searchParams;
  for (const key of params.keys()) {
    if (!["id", "branchId"].includes(key) || params.getAll(key).length !== 1) throw ApiError.badRequest("Consulta de evidencia inválida");
  }
  const result = await getRecoveryAttachmentUrl({ id: params.get("id"), branchId: params.get("branchId") });
  const response = ApiHandler.success(result);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

export const DELETE = withTenantAuth(async (req, { auth }) => {
  capability(auth.user.role as Role);
  const body = await bodyOf(req, 4096); let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(body)); }
  catch { throw ApiError.badRequest("JSON de evidencia inválido"); }
  return ApiHandler.success(await removeRecoveryAttachment(input));
});
