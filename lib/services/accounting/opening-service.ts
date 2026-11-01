import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { accountingJournalLines, accountingJournals, accountingOpeningDocuments, accountingOpenings, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { getRoleScope } from "@/lib/rbac/resource-scope";
import { hasPermission, type Role } from "@/lib/permissions";
import { MAX_CENTS, totalsOf } from "./amounts";
import { insertJournalLines, postInTransaction } from "./journal-service";

/**
 * FC-08 — balanced opening.
 *
 * One opening per company. It fixes the start date, the supporting documents and
 * a balanced journal published in the same transaction; if the posting fails, no
 * opening row remains. The opening cannot overlap journals already posted on or
 * before its date: that invariant lives in the database guards (0130), not only
 * here.
 */
export interface AccountingContext { companyId: string; actorId: string; role: Role }
type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
const day = z.iso.date().refine(value => value >= "0001-01-01", "Fecha inválida.");
const lineSchema = z.object({
  accountId: z.uuid(),
  costCenterId: z.uuid().nullable().optional(),
  debitCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  creditCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  memo: z.string().trim().max(200).nullable().optional(),
}).strict().refine(line => (line.debitCents > 0) !== (line.creditCents > 0), {
  message: "Cada renglón debe llevar exactamente un cargo o un abono.",
});
const documentSchema = z.object({
  label: z.string().trim().min(1).max(120),
  reference: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(0).max(MAX_CENTS).nullable().optional(),
}).strict();

export const openingSchema = z.object({
  openingDate: day,
  memo: z.string().trim().min(1).max(500).nullable().optional(),
  reason: z.string().trim().min(5).max(500),
  lines: z.array(lineSchema).min(2).max(200),
  documents: z.array(documentSchema).min(1).max(50),
}).strict();

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
}

async function run<T>(ctx: AccountingContext, action: "read" | "create",
  operation: (tx: Tx, companyId: string, actorId: string) => Promise<T>) {
  try {
    if (!hasPermission(ctx.role, "settings", "update")) {
      throw ApiError.forbidden("No puedes administrar la apertura contable.");
    }
    if (action === "create" && (!hasPermission(ctx.role, "accounting", "publish") || getRoleScope(ctx.role) !== "COMPANY")) {
      throw ApiError.forbidden("Publicar la apertura requiere el permiso de publicación sobre toda la empresa.");
    }
    const principal = z.object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
      .parse({ companyId: ctx.companyId, actorId: ctx.actorId });
    return await withCompanyContext(principal, async tx => {
      const [actor] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.id, principal.actorId), eq(users.companyId, principal.companyId), eq(users.role, ctx.role),
        eq(users.active, true), isNull(users.deletedAt),
      )).limit(1);
      if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");
      if (action === "create") {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${principal.companyId}, 508))`);
      }
      return operation(tx, principal.companyId, principal.actorId);
    });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) throw ApiError.badRequest("Revisa los datos de la apertura.");
    if (error instanceof RangeError) throw ApiError.badRequest(error.message);
    const code = databaseCode(error);
    if (code === "23505") throw ApiError.conflict("Esta empresa ya tiene una apertura contable.");
    if (code === "23503") throw ApiError.notFound("Una cuenta o documento de la apertura no existe en esta empresa.");
    if (code === "23514") throw ApiError.conflict("La apertura no cumple las reglas de balance, fecha o solapamiento.");
    if (["40001", "40P01", "0A000"].includes(code ?? "")) throw ApiError.conflict("Repite la operación en una transacción READ COMMITTED.");
    throw ApiError.internal("No se pudo procesar la apertura contable.");
  }
}

/** Creates the opening journal, documents and posting in one transaction. */
export function createOpening(ctx: AccountingContext, input: z.input<typeof openingSchema>) {
  return run(ctx, "create", async (tx, companyId, actorId) => {
    const data = openingSchema.parse(input);
    const totals = totalsOf(data.lines);
    if (!totals.balanced) {
      throw ApiError.badRequest(`La apertura debe cuadrar: cargos ${totals.debitCents} y abonos ${totals.creditCents}.`);
    }
    const [existing] = await tx.select({ id: accountingOpenings.id }).from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId)).limit(1);
    if (existing) throw ApiError.conflict("Esta empresa ya tiene una apertura contable; corrígela con una reversa.");
    const openingId = randomUUID();
    const [journal] = await tx.insert(accountingJournals).values({
      companyId, accountingDate: data.openingDate, description: `Apertura contable al ${data.openingDate}`,
      currency: "MXN", sourceType: "OPENING", sourceId: openingId, sourceVersion: 1,
      createdBy: actorId, updatedBy: actorId,
    }).returning();
    if (!journal) throw ApiError.internal("No se pudo crear la póliza de apertura.");
    await insertJournalLines(tx, companyId, journal.id, data.lines.map(line => ({
      accountId: line.accountId, costCenterId: line.costCenterId ?? null,
      debitCents: line.debitCents, creditCents: line.creditCents, memo: line.memo ?? null,
    })));
    const [opening] = await tx.insert(accountingOpenings).values({
      id: openingId, companyId, journalId: journal.id, openingDate: data.openingDate,
      memo: data.memo ?? null, createdBy: actorId,
    }).returning();
    if (!opening) throw ApiError.internal("No se pudo registrar la apertura.");
    await tx.insert(accountingOpeningDocuments).values(data.documents.map(document => ({
      companyId, openingId, label: document.label, reference: document.reference,
      amountCents: document.amountCents ?? null,
    })));
    const posted = await postInTransaction(tx, companyId, actorId, journal.id, journal.version, data.reason);
    return { opening, journal: posted, documents: data.documents };
  });
}

export function getOpening(ctx: AccountingContext) {
  return run(ctx, "read", async (tx, companyId) => {
    const [opening] = await tx.select().from(accountingOpenings)
      .where(eq(accountingOpenings.companyId, companyId)).limit(1);
    if (!opening) return null;
    const documents = await tx.select().from(accountingOpeningDocuments)
      .where(and(eq(accountingOpeningDocuments.companyId, companyId),
        eq(accountingOpeningDocuments.openingId, opening.id)))
      .orderBy(asc(accountingOpeningDocuments.label));
    const [journal] = await tx.select({
      id: accountingJournals.id, number: accountingJournals.number, status: accountingJournals.status,
      accountingDate: accountingJournals.accountingDate, description: accountingJournals.description,
      postedAt: accountingJournals.postedAt, postedBy: accountingJournals.postedBy,
      postingReason: accountingJournals.postingReason,
    }).from(accountingJournals).where(and(
      eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, opening.journalId),
    )).limit(1);
    const lines = await tx.select({
      id: accountingJournalLines.id, accountId: accountingJournalLines.accountId,
      debitCents: accountingJournalLines.debitCents, creditCents: accountingJournalLines.creditCents,
      memo: accountingJournalLines.memo, lineNumber: accountingJournalLines.lineNumber,
    }).from(accountingJournalLines).where(and(
      eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, opening.journalId),
    )).orderBy(asc(accountingJournalLines.lineNumber));
    return { opening, documents, journal: journal ?? null, lines, totals: totalsOf(lines) };
  });
}
