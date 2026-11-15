import { createHash } from "node:crypto";
import { z } from "zod";
import { hasPermission, type Role } from "@/lib/permissions";
import { normalizeSaleConsumptionIdentity, soldQuantity, validateSaleDay } from "./sale-consumption-contract";
import { saleSnapshotDemand } from "./sale-consumption-snapshot";

/** DTOs de registros cargados por el servidor. Este módulo no lee pruebas ni autoriza stock. */
const uuid = z.string().uuid().toLowerCase();
const text = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
// PostgreSQL conserva seis decimales: Date por sí sola eliminaría los tres últimos.
const instant = z.string().datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .refine(value => Number.isFinite(Date.parse(value)) && /^\d{4}-/.test(new Date(value).toISOString()))
  .transform(value => {
    const fraction = /\.(\d+)(?=Z|[+-])/.exec(value)?.[1] ?? "";
    const whole = value.replace(/\.\d+(?=Z|[+-])/, "");
    return `${new Date(whole).toISOString().slice(0, 19)}.${fraction.padEnd(6, "0")}Z`;
  });
const day = z.string().refine(value => { try { validateSaleDay(value); return true; } catch { return false; } });
const sold = z.string().refine(value => { try { soldQuantity(value); return true; } catch { return false; } });
const identitySchema = z.object({ companyId: uuid, branchId: uuid, source: text, productKey: text, saleDay: day }).strict();
const legacySchema = z.object({ id: uuid, companyId: uuid, branchId: uuid, recipeId: uuid, saleDay: day,
  quantitySold: sold, totalRevenueCents: z.number().int().min(0).max(2147483647).nullable(), updatedAt: instant }).strict();
const evidenceSchema = z.object({ id: uuid, attestationId: uuid, companyId: uuid, branchId: uuid, legacySaleId: uuid,
  purpose: z.enum(["SALE", "RECIPE_VERSION", "NO_PRIOR_CONSUMPTION"]), storageKey: z.string().min(1).max(2048),
  contentSha256: hash, byteLength: z.number().int().min(1).max(20 * 1024 * 1024),
  sourceReference: z.string().trim().min(1).max(2000), verificationReason: z.string().trim().min(1).max(2000),
  verifiedRole: z.enum(["ADMIN", "OWNER", "SUPER_ADMIN"]), verifiedBy: text,
  evidenceUpdatedAt: instant, createdAt: instant, verifiedAt: instant, deletedAt: instant.nullable() }).strict();
const inputSchema = z.object({ schemaVersion: z.literal(2), idempotencyKey: uuid, requestedBy: text, reason: z.string().trim().min(1).max(2000),
  identity: identitySchema, legacy: legacySchema, observedHeadId: uuid.nullable(),
  consumptionState: z.enum(["NOT_APPLIED", "APPLIED", "UNKNOWN"]), observedMovementIds: z.array(uuid).max(10000),
  recipeSnapshot: z.object({ schemaVersion: z.literal(1), recipeId: uuid, versionKey: hash,
    definition: z.record(z.string(), z.unknown()) }).strict(), evidence: z.array(evidenceSchema).max(100) }).strict();
const approvalSchema = z.object({ companyId: uuid, branchId: uuid, proposalHash: hash, stateHash: hash,
  decision: z.enum(["APPROVED", "REJECTED"]), approvedBy: text, approverRole: text, approvedAt: instant }).strict();

export class SaleRecoveryReviewError extends Error {
  constructor(public readonly code: "INVALID_RECORD" | "INVALID_SCOPE" | "MISSING_EVIDENCE" | "UNPROVEN_CONSUMPTION" | "CONFLICT" | "FORBIDDEN", message: string) {
    super(message); this.name = "SaleRecoveryReviewError";
  }
}
function fail(code: SaleRecoveryReviewError["code"], message: string): never { throw new SaleRecoveryReviewError(code, message); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

/**
 * Prepara una propuesta para revisión independiente, nunca una orden de aplicación.
 * El futuro servicio debe cargar evidencia/contenido/estado desde persistencia con scope;
 * pasar objetos recibidos por HTTP a esta función no demuestra que existan esas pruebas.
 */
export function prepareSaleRecoveryReview(records: unknown) {
  let proposal: z.infer<typeof inputSchema>;
  try { proposal = inputSchema.parse(structuredClone(records)); }
  catch { return fail("INVALID_RECORD", "Expediente inválido: revisa campos, fechas, precisión y registros de evidencia"); }
  try { proposal.identity = normalizeSaleConsumptionIdentity(proposal.identity); }
  catch { return fail("INVALID_RECORD", "Identidad de recuperación inválida"); }
  proposal.legacy.quantitySold = soldQuantity(proposal.legacy.quantitySold);
  const { identity, legacy, recipeSnapshot } = proposal;
  if (legacy.companyId !== identity.companyId || legacy.branchId !== identity.branchId || legacy.saleDay !== identity.saleDay
    || recipeSnapshot.recipeId !== legacy.recipeId || recipeSnapshot.definition.companyId !== identity.companyId)
    fail("INVALID_SCOPE", "El expediente no coincide con empresa, sucursal, receta o día de la venta");
  if (proposal.observedHeadId !== null) fail("CONFLICT", "La venta ya tiene una revisión; requiere revisar su recuperación específica");
  if (proposal.consumptionState !== "NOT_APPLIED" || proposal.observedMovementIds.length)
    fail("UNPROVEN_CONSUMPTION", "Consumo previo existente o desconocido: esta propuesta no permite inferir consumo cero");
  const seen = new Set<string>(), seenAttestations = new Set<string>();
  for (const proof of proposal.evidence) {
    if (seen.has(proof.id) || seenAttestations.has(proof.attestationId)) fail("INVALID_RECORD", "Evidencia o atestación duplicada en el expediente");
    seen.add(proof.id); seenAttestations.add(proof.attestationId);
    if (proof.companyId !== identity.companyId || proof.branchId !== identity.branchId || proof.legacySaleId !== legacy.id)
      fail("INVALID_SCOPE", "La evidencia no pertenece a esta venta, empresa y sucursal");
    const key = `companies/${identity.companyId}/branches/${identity.branchId}/sales-recovery/${legacy.id}/${proof.id}`;
    if (proof.storageKey !== key)
      fail("INVALID_RECORD", "Evidencia sin clave de almacenamiento durable de la empresa");
    // Todas las fechas ya están normalizadas a UTC con longitud/precisión iguales.
    if (proof.deletedAt !== null || proof.evidenceUpdatedAt < proof.createdAt || proof.verifiedAt < proof.evidenceUpdatedAt)
      fail("MISSING_EVIDENCE", "Evidencia retirada o sin verificación temporal válida");
  }
  for (const purpose of ["SALE", "RECIPE_VERSION", "NO_PRIOR_CONSUMPTION"] as const)
    if (!proposal.evidence.some(proof => proof.purpose === purpose)) fail("MISSING_EVIDENCE", `Falta evidencia de ${purpose}`);
  let demand: ReturnType<typeof saleSnapshotDemand>;
  try { demand = saleSnapshotDemand(recipeSnapshot, legacy.quantitySold); }
  catch { return fail("INVALID_RECORD", "Snapshot histórico alterado, desconocido o incompatible"); }
  proposal.evidence.sort((a, b) => a.id.localeCompare(b.id));
  const stateHash = digest({ version: 2, identity, legacy, observedHeadId: proposal.observedHeadId,
    snapshotVersionKey: recipeSnapshot.versionKey, consumptionState: proposal.consumptionState, observedMovementIds: proposal.observedMovementIds,
    evidenceState: proposal.evidence.map(proof => ({ id: proof.id, attestationId: proof.attestationId,
      evidenceUpdatedAt: proof.evidenceUpdatedAt, contentSha256: proof.contentSha256, byteLength: proof.byteLength })) });
  return { proposal, stateHash, proposalHash: digest({ version: 2, proposal }), demand };
}
export type PreparedSaleRecoveryReview = ReturnType<typeof prepareSaleRecoveryReview>;

/** Solo verifica coherencia de registros ya cargados por el servidor; no prueba origen ni ejecuta reparación. */
export function assertRecoveryReviewMatches(prepared: PreparedSaleRecoveryReview, decisionRecord: unknown, currentRecords: unknown): void {
  const frozen = prepareSaleRecoveryReview(prepared.proposal);
  const current = prepareSaleRecoveryReview(currentRecords);
  if (frozen.proposalHash !== prepared.proposalHash || frozen.stateHash !== prepared.stateHash
    || current.proposalHash !== prepared.proposalHash || current.stateHash !== prepared.stateHash
    || canonical(frozen.demand) !== canonical(prepared.demand))
    fail("CONFLICT", "El expediente o el estado de la venta cambió; requiere otra revisión");
  const parsed = approvalSchema.safeParse(decisionRecord);
  if (!parsed.success) fail("INVALID_RECORD", "Registro de aprobación inválido");
  const decision = parsed.data;
  if (decision.companyId !== frozen.proposal.identity.companyId || decision.branchId !== frozen.proposal.identity.branchId)
    fail("INVALID_SCOPE", "La aprobación no corresponde a esta empresa y sucursal");
  if (decision.proposalHash !== prepared.proposalHash || decision.stateHash !== prepared.stateHash)
    fail("CONFLICT", "La aprobación no coincide con el expediente y estado revisados");
  if (decision.decision !== "APPROVED" || decision.approvedBy === frozen.proposal.requestedBy
    || !["ADMIN", "OWNER", "SUPER_ADMIN"].includes(decision.approverRole)
    || !hasPermission(decision.approverRole as Role, "inventory", "manage"))
    fail("FORBIDDEN", "La revisión necesita otro aprobador con autoridad administrativa y capacidad de inventario");
  if (frozen.proposal.evidence.some(proof => proof.verifiedAt > decision.approvedAt))
    fail("CONFLICT", "La aprobación precede a la evidencia verificada del expediente");
}
