import { ApiError } from "@/lib/api/error";
import { MAX_OPERATING_CFDI_BYTES } from "./operating-cfdi-parser";

const MAX_BODY_BYTES = MAX_OPERATING_CFDI_BYTES + 32768;
const tooLarge = () => new ApiError("El archivo XML excede el tamaño máximo de 1 MB o el formulario es demasiado grande.", 413);

/** Vista previa y confirmación comparten los mismos límites y decodificación. */
export async function readOperatingCfdiUpload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !req.body) throw ApiError.badRequest("Se requiere un formulario multipart con un archivo XML.");
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw ApiError.badRequest("El tamaño declarado del formulario no es válido.");
  if (length && Number(length) > MAX_BODY_BYTES) throw tooLarge();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "content-type": contentType } }).formData(); }
  catch { throw ApiError.badRequest("El formulario multipart no es válido."); }
  const file = form.get("file");
  if (form.getAll("file").length !== 1 || !(file instanceof File)) throw ApiError.badRequest("Selecciona un único archivo XML.");
  if (file.size > MAX_OPERATING_CFDI_BYTES) throw tooLarge();
  const mime = file.type.split(";")[0].trim().toLowerCase();
  if (!file.size || file.name.length > 255 || !/\.xml$/i.test(file.name)
    || !["", "application/xml", "text/xml", "application/octet-stream"].includes(mime)) {
    throw ApiError.badRequest("El archivo debe ser un XML no vacío con extensión .xml y tipo compatible.");
  }
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw ApiError.badRequest("El archivo debe contener XML con codificación UTF-8 válida."); }
  return { form, xml };
}
