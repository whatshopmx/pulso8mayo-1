/**
 * Almacenamiento POS privado y durable (INV-01.b4.storage).
 *
 * El cierre de sucursal sube el archivo del POS (CSV/Excel/texto). Antes, la
 * ruta `upload-pos` fabricaba un path (`pos-uploads/…`) y lo guardaba en
 * `daily_sales_cuts.raw_file_url` sin escribir ningún byte: la evidencia del
 * corte quedaba como una cadena que no apuntaba a nada durable.
 *
 * Este módulo cierra esa brecha:
 *  - La KEY del objeto en R2 lleva jerarquía de tenancy
 *      `companies/{companyId}/branches/{branchId}/pos/{businessDate}/{ts}_{nombre}`
 *    `companyId` SIEMPRE sale del servidor (sesión), jamás del cliente.
 *  - En BD se persiste la KEY (identificador durable), no una URL pública: la
 *    URL firmada se deriva en el momento de lectura y expira.
 *  - La lectura pasa por una ruta con guardia de empresa/sucursal
 *    (`/api/sales/cuts/[id]/pos-file`), nunca por una URL pública navegable.
 *
 * Sin R2 configurado la ruta degrada a `local://…` y NO afirma durabilidad: el
 * modelo privado durable exige R2 (mismo criterio que `scoped-evidence.ts`).
 */
import { uploadToR2, generatePresignedUrl } from "./r2-client";
import { isR2ObjectKey } from "./scoped-evidence";

/** Tamaño máximo del export del POS: 10 MiB. */
export const POS_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** TTL por defecto de la URL firmada de lectura: 10 minutos. */
export const POS_UPLOAD_URL_TTL_SECONDS = 600;

/**
 * MIME aceptados para el export del POS. Se admiten CSV/Excel/texto/JSON y
 * `octet-stream` (los POS suelen reportar el CSV sin tipo o como binario).
 */
export const POS_UPLOAD_ALLOWED_MIME_TYPES: readonly string[] = [
  "text/csv",
  "text/plain",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
];

/** Normaliza el nombre del archivo para que sea un segmento de key seguro. */
export function sanitizePosFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Un nombre que tras sanitizar no conserva ningún alfanumérico ("///" → "___")
  // no aporta identidad: cae al nombre por defecto en vez de una key vacía.
  return /[a-zA-Z0-9]/.test(base) ? base : "pos.csv";
}

/**
 * Key canónica del objeto POS. El timestamp evita colisiones al repetir la
 * subida del mismo archivo; la repetición crea un objeto nuevo sin mutar el
 * anterior (append-only en storage, como exige el contrato de evidencia).
 */
export function buildPosUploadKey(
  companyId: string,
  branchId: string,
  businessDate: string,
  fileName: string
): string {
  const safe = sanitizePosFileName(fileName);
  return `companies/${companyId}/branches/${branchId}/pos/${businessDate}/${Date.now()}_${safe}`;
}

/**
 * Validación de entrada del archivo POS. Lanza `Error` con mensaje en español;
 * la ruta lo traduce a `ApiError.badRequest` (400), no a 500.
 */
export function assertPosUploadValid(args: {
  byteLength: number;
  mimeType: string;
}): void {
  if (!Number.isSafeInteger(args.byteLength) || args.byteLength <= 0) {
    throw new Error("El archivo del POS está vacío.");
  }
  if (args.byteLength > POS_UPLOAD_MAX_BYTES) {
    throw new Error(
      `El archivo del POS excede el tamaño máximo (${POS_UPLOAD_MAX_BYTES / (1024 * 1024)} MiB).`
    );
  }
  if (!POS_UPLOAD_ALLOWED_MIME_TYPES.includes(args.mimeType)) {
    throw new Error("Tipo de archivo POS no permitido.");
  }
}

/**
 * Persiste los bytes del POS en R2 y devuelve la KEY del objeto.
 *
 * No hay fallback local aquí: si R2 no está configurado, `uploadToR2` lanza y
 * el error se propaga. La ruta decide el fallback `local://` explícito, que no
 * afirma durabilidad.
 */
export async function storePosUpload(args: {
  companyId: string;
  branchId: string;
  businessDate: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<string> {
  assertPosUploadValid({ byteLength: args.buffer.length, mimeType: args.mimeType });
  const key = buildPosUploadKey(
    args.companyId,
    args.branchId,
    args.businessDate,
    args.fileName
  );
  return uploadToR2(args.buffer, key, args.mimeType);
}

/**
 * Normaliza el valor persistido en `raw_file_url` a una URL consumible:
 * - KEY de R2 (modelo privado) → GET presignado con TTL corto.
 * - URL `http(s)://` o `local://` (legacy / seed / fallback) → tal cual.
 * Devuelve `null` si no hay nada que mostrar o el presignado falla.
 */
export async function resolvePosUploadUrl(
  value: string | null | undefined,
  expiresIn: number = POS_UPLOAD_URL_TTL_SECONDS
): Promise<string | null> {
  if (!value) return null;
  if (!isR2ObjectKey(value)) return value;
  try {
    return await generatePresignedUrl(value, expiresIn);
  } catch (error) {
    console.error("[pos-upload] Error presignando key:", error);
    return null;
  }
}
