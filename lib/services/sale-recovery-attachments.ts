import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { branches, evidence, salesEntries } from "@/lib/db/schema";
import { requireAuth } from "@/lib/tenant-context";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { ApiError } from "@/lib/api/error";
import { generatePresignedUrl, isR2Configured, uploadToR2 } from "@/lib/storage/r2-client";
import { EVIDENCE_URL_TTL_SECONDS } from "@/lib/storage/scoped-evidence";
import type { DbExecutor } from "./fefo-allocator";

const uuid = z.string().uuid().toLowerCase();
const reference = z.object({ branchId: uuid, id: uuid }).strict();
const upload = z.object({ branchId: uuid, legacySaleId: uuid,
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv", "text/plain", "application/json"]),
  buffer: z.custom<Buffer>(value => Buffer.isBuffer(value) && value.byteLength > 0 && value.byteLength <= 20 * 1024 * 1024),
}).strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw ApiError.badRequest("Datos de evidencia inválidos; revisa archivo, tamaño e identificadores");
  return result.data;
}
async function actor() {
  const { user } = await requireAuth();
  if (!user?.id || !hasPermission(user.role, "inventory", "manage")) throw ApiError.forbidden("Sin capacidad para gestionar evidencia de recuperación");
  return user;
}
function scopeFor(user: Awaited<ReturnType<typeof actor>>, branchId: string) {
  const company = uuid.safeParse(user.companyId);
  const scope = resolveBranchScope(user.role, user.branchId?.toLowerCase(), branchId);
  if (!company.success || scope.kind !== "BRANCH" || scope.branchId !== branchId) throw ApiError.forbidden("Sucursal fuera del alcance autorizado");
  return { companyId: company.data, branchId, actorId: user.id };
}
type Scope = ReturnType<typeof scopeFor>;
async function subject(q: DbExecutor, scope: Scope, id: string) {
  const [sale] = await q.select({ id: salesEntries.id }).from(salesEntries)
    .innerJoin(branches, and(eq(branches.id, salesEntries.branchId), eq(branches.companyId, salesEntries.companyId)))
    .where(and(eq(salesEntries.id, id), eq(salesEntries.companyId, scope.companyId), eq(salesEntries.branchId, scope.branchId)))
    .for("share", { of: salesEntries });
  if (!sale) throw ApiError.notFound("Venta no encontrada");
}
const prefix = (scope: Scope, saleId: string) => `companies/${scope.companyId}/branches/${scope.branchId}/sales-recovery/${saleId}/`;
async function attachment(q: DbExecutor, scope: Scope, id: string, lock: "share" | "update") {
  const [row] = await q.select({ record: evidence }).from(evidence)
    .innerJoin(salesEntries, and(eq(evidence.entityId, sql`${salesEntries.id}::text`), eq(evidence.companyId, salesEntries.companyId), eq(evidence.branchId, salesEntries.branchId)))
    .innerJoin(branches, and(eq(branches.id, salesEntries.branchId), eq(branches.companyId, salesEntries.companyId)))
    .where(and(eq(evidence.id, id), eq(evidence.entityType, "SALE_RECOVERY"), eq(evidence.companyId, scope.companyId), eq(evidence.branchId, scope.branchId), isNull(evidence.deletedAt)))
    .for(lock, { of: evidence });
  if (!row) throw ApiError.notFound("Evidencia no encontrada");
  return row.record;
}

/** Adjunta bytes; no atestigua finalidad, veracidad o consumo histórico ni autoriza stock. */
export async function createRecoveryAttachment(input: unknown) {
  const user = await actor(), data = parse(upload, input), scope = scopeFor(user, data.branchId);
  const buffer = Buffer.from(data.buffer); // No retener un Buffer mutable del llamador durante I/O.
  if (!isR2Configured()) throw new ApiError("Almacenamiento privado no disponible", 503);
  return withCompanyContext(scope, async q => {
    await subject(q, scope, data.legacySaleId);
    const id = randomUUID(), key = `${prefix(scope, data.legacySaleId)}${id}`;
    try { await uploadToR2(buffer, key, data.mimeType); }
    catch { throw new ApiError("No fue posible guardar la evidencia", 502); }
    const [record] = await q.insert(evidence).values({ id, companyId: scope.companyId, branchId: scope.branchId,
      entityType: "SALE_RECOVERY", entityId: data.legacySaleId, kind: data.mimeType.startsWith("image/") ? "PHOTO" : "FILE",
      mimeType: data.mimeType, url: key, storageKey: key, createdBy: scope.actorId }).returning({ id: evidence.id, entityId: evidence.entityId,
      branchId: evidence.branchId, kind: evidence.kind, mimeType: evidence.mimeType, createdAt: evidence.createdAt });
    return record;
  });
}
export async function getRecoveryAttachmentUrl(input: unknown) {
  const user = await actor(), data = parse(reference, input), scope = scopeFor(user, data.branchId);
  return withCompanyContext(scope, async q => {
    const row = await attachment(q, scope, data.id, "share");
    const expected = prefix(scope, row.entityId), suffix = row.storageKey?.slice(expected.length);
    if (!row.storageKey?.startsWith(expected) || !uuid.safeParse(suffix).success) throw ApiError.notFound("Evidencia privada no disponible");
    if (!isR2Configured()) throw new ApiError("Almacenamiento privado no disponible", 503);
    try { return { id: row.id, url: await generatePresignedUrl(row.storageKey, EVIDENCE_URL_TTL_SECONDS) }; }
    catch { throw new ApiError("No fue posible abrir la evidencia", 502); }
  });
}
export async function removeRecoveryAttachment(input: unknown) {
  const user = await actor(), data = parse(reference, input), scope = scopeFor(user, data.branchId);
  return withCompanyContext(scope, async q => {
    const row = await attachment(q, scope, data.id, "update");
    await q.update(evidence).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(evidence.id, row.id), eq(evidence.companyId, scope.companyId), eq(evidence.branchId, scope.branchId)));
    return { id: row.id, deleted: true };
  });
}
