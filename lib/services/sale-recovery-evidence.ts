import { createHash } from "node:crypto";
import { z } from "zod";
import { getFromR2 } from "@/lib/storage/r2-client";
import { SaleRecoveryReviewError } from "./sale-recovery-review";

const referenceSchema = z.object({ id: z.string().uuid(), storageKey: z.string().min(1).max(2048),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/) });
const limits = { maxBytes: 20 * 1024 * 1024, timeoutMs: 15000 };

/**
 * Integridad de objetos privados referenciados por registros del servidor.
 * No prueba veracidad documental ni sustituye sesión, scope DB o aprobación.
 * El llamador debe revalidar expediente/estado bajo lock antes de aplicar stock.
 */
export async function verifySaleRecoveryEvidence(companyId: string, records: unknown,
  read: typeof getFromR2 = getFromR2) {
  const company = z.string().uuid().safeParse(companyId);
  const parsed = z.array(referenceSchema).min(1).max(100).safeParse(records);
  if (!company.success || !parsed.success)
    throw new SaleRecoveryReviewError("INVALID_RECORD", "Referencias de evidencia inválidas");
  const references = parsed.data;
  const seen = new Set<string>();
  const prefix = `companies/${company.data}/`;
  for (const reference of references) {
    const segments = reference.storageKey.split("/");
    if (seen.has(reference.id.toLowerCase()) || !reference.storageKey.startsWith(prefix)
      || /[\\\u0000-\u001f\u007f]/.test(reference.storageKey)
      || segments.some(segment => !segment || segment === "." || segment === ".."))
      throw new SaleRecoveryReviewError("INVALID_SCOPE", "Referencia de evidencia fuera del alcance o duplicada");
    seen.add(reference.id.toLowerCase());
  }
  const verified: (z.infer<typeof referenceSchema> & { byteLength: number })[] = [];
  for (const reference of references) {
    let content: Buffer | null;
    try { content = await read(reference.storageKey, { ...limits }); }
    catch { throw new SaleRecoveryReviewError("MISSING_EVIDENCE", "No se pudo verificar el contenido de la evidencia"); }
    if (!content?.byteLength || content.byteLength > limits.maxBytes
      || createHash("sha256").update(content).digest("hex") !== reference.contentSha256)
      throw new SaleRecoveryReviewError("MISSING_EVIDENCE", "Contenido de evidencia ausente, alterado o fuera del límite");
    verified.push({ ...reference, byteLength: content.byteLength });
  }
  return verified;
}
