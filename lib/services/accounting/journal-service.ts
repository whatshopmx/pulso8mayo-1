import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import {
  accountingAccounts,
  accountingJournalLines,
  accountingJournals,
  accountingRules,
  branches,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import { getRoleScope } from "@/lib/rbac/resource-scope";
import { resolveBranchScope, type BranchScope } from "@/lib/branch-scope";
import { MAX_CENTS, totalsOf } from "./amounts";
import { describeRuleIn, resolveRuleIn, ruleBlockerMessage } from "./mapping-service";

/**
 * FC-06 — pólizas de partida doble.
 *
 * Borradores: editables con control de versión (optimista). Publicación: una
 * sola transición DRAFT → POSTED que asigna folio, congela la póliza y vuelve a
 * validar balance, número de renglones, vigencia de cuentas y desbordamiento
 * dentro de PostgreSQL (trigger de la migración 0128). Las correcciones se harán
 * con reversa + nueva póliza; una póliza publicada no se edita ni se borra.
 *
 * FC-07: capacidades contables separadas; alcance derivado del actor en DB.
 */
export interface AccountingContext { companyId: string; actorId: string; role: Role }
type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];

const day = z.iso.date().refine(value => value >= "0001-01-01", "Fecha inválida.");
const idSchema = z.uuid();

const lineSchema = z.object({
  accountId: z.uuid(),
  costCenterId: z.uuid().nullable().optional(),
  debitCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  creditCents: z.number().int().min(0).max(MAX_CENTS).default(0),
  memo: z.string().trim().max(200).nullable().optional(),
}).strict().refine(line => (line.debitCents > 0) !== (line.creditCents > 0), {
  message: "Cada renglón debe llevar exactamente un cargo o un abono.",
});

const sourceSchema = z.object({
  type: z.string().trim().min(1).max(40),
  id: z.string().trim().min(1).max(120),
  version: z.number().int().min(1),
  eventType: z.string().trim().min(1).max(40),
}).strict();

const draftFields = {
  accountingDate: day,
  businessDate: day.nullable().optional(),
  description: z.string().trim().min(1).max(500),
  branchId: z.uuid().nullable().optional(),
  source: sourceSchema.nullable().optional(),
  ruleId: z.uuid().nullable().optional(),
  lines: z.array(lineSchema).min(1).max(200),
};
export const journalDraftSchema = z.object(draftFields).strict();
export const journalUpdateSchema = z.object({ ...draftFields, expectedVersion: z.number().int().min(1) }).strict();
const createSchema = journalDraftSchema;
const updateSchema = journalUpdateSchema;
const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
const reason = z.string().trim().min(5).max(500);
const publishSchema = versionSchema.extend({ reason }).strict();
const reversalSchema = publishSchema.extend({ accountingDate: day, replacement: createSchema.optional() }).strict();
const pageSchema = z.object({
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "POSTED"]).optional(),
  branchId: z.uuid().optional(),
}).strict();

type JournalLineInput = z.output<typeof lineSchema>[]

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
}

async function run<T>(
  ctx: AccountingContext,
  action: "read" | "create" | "update" | "delete" | "publish" | "reverse",
  operation: (tx: Tx, companyId: string, actorId: string, scope: BranchScope) => Promise<T>,
): Promise<T> {
  try {
    if ((action !== "read" && getRoleScope(ctx.role) !== "COMPANY") || !hasPermission(ctx.role, "accounting", action)) {
      throw ApiError.forbidden(action === "read"
        ? "No puedes consultar pólizas contables."
        : "No puedes capturar ni publicar pólizas contables.");
    }
    const principal = z.object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
      .parse({ companyId: ctx.companyId, actorId: ctx.actorId });
    return await withCompanyContext(principal, async tx => {
      const [actor] = await tx.select({ id: users.id, branchId: users.branchId }).from(users).where(and(
        eq(users.id, principal.actorId), eq(users.companyId, principal.companyId), eq(users.role, ctx.role),
        eq(users.active, true), isNull(users.deletedAt),
      )).limit(1);
      if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");
      const scope = resolveBranchScope(ctx.role, actor.branchId);
      if (scope.kind === "NONE") throw ApiError.forbidden("No tienes una sucursal asignada para consultar pólizas.");
      if (scope.kind === "BRANCH") {
        const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(
          eq(branches.id, scope.branchId), eq(branches.companyId, principal.companyId), eq(branches.active, true),
        )).limit(1);
        if (!branch) throw ApiError.forbidden("Tu sucursal no está activa en esta empresa.");
      }
      if (action !== "read") {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${principal.companyId}, 505))`);
      }
      return operation(tx, principal.companyId, principal.actorId, scope);
    });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) throw ApiError.badRequest("Revisa los datos de la póliza.");
    if (error instanceof RangeError) throw ApiError.badRequest(error.message);
    const code = databaseCode(error);
    if (code === "23505") throw ApiError.conflict("Ya existe una póliza con ese folio o esa fuente.");
    if (code === "23503") throw ApiError.notFound("La referencia no existe en esta empresa.");
    if (code === "23514") throw ApiError.conflict("La póliza no cumple las reglas de balance, cuentas vigentes o estado.");
    if (["40001", "40P01", "0A000"].includes(code ?? "")) throw ApiError.conflict("Repite la operación en una transacción READ COMMITTED.");
    throw ApiError.internal("No se pudo procesar la póliza.");
  }
}

function cleanMemo(memo: string | null | undefined) {
  const trimmed = memo?.trim();
  return trimmed ? trimmed : null;
}

/** Valida sumas antes de tocar la base: un borrador puede estar descuadrado, no desbordado. */
function assertLineTotals(lines: readonly { debitCents: number; creditCents: number }[]) {
  return totalsOf(lines);
}

export async function insertJournalLines(tx: Tx, companyId: string, journalId: string, lines: JournalLineInput) {
  const values = lines.map((line, index) => ({
    companyId,
    journalId,
    lineNumber: index + 1,
    accountId: line.accountId,
    costCenterId: line.costCenterId ?? null,
    debitCents: line.debitCents,
    creditCents: line.creditCents,
    memo: cleanMemo(line.memo),
  }));
  assertLineTotals(values);
  await tx.insert(accountingJournalLines).values(values);
}

/**
 * Freezes the selected rule on the draft: the version always comes from the
 * database, never from the client, and it must be effective for the date and
 * the same fact as the journal source.
 */
async function ruleSelection(tx: Tx, companyId: string, data: { ruleId?: string | null;
  accountingDate: string; source?: { eventType: string } | null }) {
  if (!data.ruleId) return { ruleId: null, ruleVersion: null };
  const [rule] = await tx.select({ id: accountingRules.id, version: accountingRules.version,
    active: accountingRules.active, effectiveFrom: accountingRules.effectiveFrom,
    eventType: accountingRules.eventType,
  }).from(accountingRules).where(and(
    eq(accountingRules.companyId, companyId), eq(accountingRules.id, data.ruleId),
  )).limit(1);
  if (!rule) throw ApiError.notFound("La regla contable no existe en esta empresa.");
  if (!rule.active) throw ApiError.conflict(`La versión ${rule.version} de la regla está retirada.`);
  if (rule.effectiveFrom > data.accountingDate) {
    throw ApiError.conflict("La regla seleccionada no está vigente en la fecha contable.");
  }
  if (data.source && data.source.eventType !== rule.eventType) {
    throw ApiError.badRequest("El hecho de la póliza y la regla seleccionada no coinciden.");
  }
  return { ruleId: rule.id, ruleVersion: rule.version };
}

async function draftValues(tx: Tx, companyId: string, data: z.output<typeof createSchema>, actorId: string) {
  const rule = await ruleSelection(tx, companyId, data);
  return {
    accountingDate: data.accountingDate,
    businessDate: data.businessDate ?? null,
    description: data.description,
    currency: "MXN" as const,
    branchId: data.branchId ?? null,
    sourceType: data.source?.type ?? null,
    sourceId: data.source?.id ?? null,
    sourceVersion: data.source?.version ?? null,
    eventType: data.source?.eventType ?? null,
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    updatedBy: actorId,
  };
}

export function createDraft(ctx: AccountingContext, input: z.input<typeof createSchema>) {
  return run(ctx, "create", async (tx, companyId, actorId) => {
    const data = createSchema.parse(input);
    assertLineTotals(data.lines);
    const [journal] = await tx.insert(accountingJournals).values({
      ...await draftValues(tx, companyId, data, actorId), companyId, status: "DRAFT", createdBy: actorId,
    }).returning();
    if (!journal) throw ApiError.internal("No se pudo crear la póliza.");
    await insertJournalLines(tx, companyId, journal.id, data.lines);
    return journal;
  });
}

/** Reemplaza los renglones de un borrador; exige la versión observada. */
export function updateDraft(ctx: AccountingContext, journalId: string, input: z.input<typeof updateSchema>) {
  return run(ctx, "update", async (tx, companyId, actorId) => {
    const data = updateSchema.parse(input);
    const id = idSchema.parse(journalId);
    assertLineTotals(data.lines);
    const [current] = await tx.select().from(accountingJournals)
      .where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id))).limit(1);
    if (!current) throw ApiError.notFound("Póliza no encontrada.");
    if (current.status !== "DRAFT") throw ApiError.conflict("La póliza publicada es inmutable; corrige con una reversa.");
    if (current.version !== data.expectedVersion) throw ApiError.conflict("La póliza cambió desde tu última lectura.");
    const [journal] = await tx.update(accountingJournals)
      .set({ ...await draftValues(tx, companyId, data, actorId), version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id),
        eq(accountingJournals.status, "DRAFT"), eq(accountingJournals.version, data.expectedVersion)))
      .returning();
    if (!journal) throw ApiError.conflict("La póliza cambió desde tu última lectura.");
    await tx.delete(accountingJournalLines)
      .where(and(eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, id)));
    await insertJournalLines(tx, companyId, id, data.lines);
    return journal;
  });
}

/**
 * Publica el borrador en una sola transacción. El folio se asigna por empresa
 * bajo un lock de asesor; el trigger de base de datos vuelve a validar el
 * balance y las cuentas antes de aceptar el estado POSTED.
 */
export function publishDraft(ctx: AccountingContext, journalId: string, input: z.input<typeof publishSchema>) {
  return run(ctx, "publish", async (tx, companyId, actorId) => {
    const data = publishSchema.parse(input);
    return postInTransaction(tx, companyId, actorId, idSchema.parse(journalId), data.expectedVersion, data.reason);
  });
}

export async function postInTransaction(tx: Tx, companyId: string, actorId: string, id: string, expectedVersion: number, postingReason: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 506))`);
    const [journal] = await tx.select().from(accountingJournals)
      .where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id)))
      .limit(1).for("update");
    if (!journal) throw ApiError.notFound("Póliza no encontrada.");
    if (journal.status !== "DRAFT") throw ApiError.conflict("La póliza ya está publicada.");
    if (journal.version !== expectedVersion) throw ApiError.conflict("La póliza cambió desde tu última lectura.");
    const lines = await tx.select().from(accountingJournalLines)
      .where(and(eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, id)))
      .orderBy(asc(accountingJournalLines.lineNumber));
    if (lines.length < 2) throw ApiError.conflict("Una póliza necesita al menos dos renglones para publicarse.");
    const totals = totalsOf(lines);
    if (!totals.balanced) {
      throw ApiError.conflict(`Los cargos (${totals.debitCents}) y los abonos (${totals.creditCents}) no coinciden.`);
    }
    const [invalid] = await tx.select({ code: accountingAccounts.code })
      .from(accountingJournalLines)
      .innerJoin(accountingAccounts, and(
        eq(accountingAccounts.companyId, accountingJournalLines.companyId),
        eq(accountingAccounts.id, accountingJournalLines.accountId),
      ))
      .where(and(
        eq(accountingJournalLines.companyId, companyId),
        eq(accountingJournalLines.journalId, id),
        sql`(NOT ${accountingAccounts.active} OR NOT ${accountingAccounts.postable}
          OR ${accountingAccounts.validFrom} > ${journal.accountingDate}
          OR (${accountingAccounts.validTo} IS NOT NULL AND ${accountingAccounts.validTo} < ${journal.accountingDate}))`,
      ))
      .limit(1);
    if (invalid) {
      throw ApiError.conflict(`La cuenta ${invalid.code} no está activa, es acumulativa o no está vigente en la fecha contable.`);
    }
    // FC-08: the applied rule is frozen on this posting. A fact without a rule,
    // a retired version or an unusable required account blocks with its reason.
    let ruleId = journal.ruleId, ruleVersion = journal.ruleVersion;
    if (journal.eventType !== null || ruleId !== null) {
      const preview = ruleId
        ? await describeRuleIn(tx, companyId, ruleId, journal.accountingDate)
        : await resolveRuleIn(tx, companyId, journal.eventType!, journal.accountingDate);
      const blocker = ruleBlockerMessage(preview);
      if (blocker) throw ApiError.conflict(blocker);
      if (!ruleId && preview.rule) { ruleId = preview.rule.id; ruleVersion = preview.rule.version; }
    }
    const [{ next }] = await tx.select({
      next: sql<number>`coalesce(max(${accountingJournals.number}), 0)::int + 1`,
    }).from(accountingJournals).where(eq(accountingJournals.companyId, companyId));
    const [posted] = await tx.update(accountingJournals).set({
      status: "POSTED", number: next, postedBy: actorId, postedAt: new Date(), postingReason,
      ruleId, ruleVersion,
      version: journal.version + 1, updatedBy: actorId, updatedAt: new Date(),
    }).where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id),
      eq(accountingJournals.status, "DRAFT"), eq(accountingJournals.version, expectedVersion))).returning();
    if (!posted) throw ApiError.conflict("La póliza cambió desde tu última lectura.");
    return posted;
}

export function deleteDraft(ctx: AccountingContext, journalId: string, input: z.input<typeof versionSchema>) {
  return run(ctx, "delete", async (tx, companyId) => {
    const { expectedVersion } = versionSchema.parse(input);
    const id = idSchema.parse(journalId);
    const [current] = await tx.select().from(accountingJournals)
      .where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id))).limit(1);
    if (!current) throw ApiError.notFound("Póliza no encontrada.");
    if (current.status !== "DRAFT") throw ApiError.conflict("Una póliza publicada no se borra; corrige con una reversa.");
    if (current.version !== expectedVersion) throw ApiError.conflict("La póliza cambió desde tu última lectura.");
    await tx.delete(accountingJournalLines)
      .where(and(eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, id)));
    const deleted = await tx.delete(accountingJournals)
      .where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id),
        eq(accountingJournals.status, "DRAFT"), eq(accountingJournals.version, expectedVersion)))
      .returning({ id: accountingJournals.id });
    if (!deleted.length) throw ApiError.conflict("La póliza cambió desde tu última lectura.");
    return { id };
  });
}

export function getJournal(ctx: AccountingContext, journalId: string) {
  return run(ctx, "read", async (tx, companyId, _actorId, scope) => {
    const id = idSchema.parse(journalId);
    const [journal] = await tx.select().from(accountingJournals)
      .where(and(eq(accountingJournals.companyId, companyId), eq(accountingJournals.id, id),
        scope.kind === "BRANCH" ? eq(accountingJournals.branchId, scope.branchId) : undefined)).limit(1).for("share");
    if (!journal) throw ApiError.notFound("Póliza no encontrada.");
    const lines = await tx.select({
      id: accountingJournalLines.id, accountId: accountingJournalLines.accountId,
      costCenterId: accountingJournalLines.costCenterId, lineNumber: accountingJournalLines.lineNumber,
      debitCents: accountingJournalLines.debitCents, creditCents: accountingJournalLines.creditCents,
      memo: accountingJournalLines.memo, accountCode: accountingAccounts.code, accountName: accountingAccounts.name,
    }).from(accountingJournalLines)
      .innerJoin(accountingAccounts, and(eq(accountingAccounts.id, accountingJournalLines.accountId), eq(accountingAccounts.companyId, companyId)))
      .where(and(eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, id)))
      .orderBy(asc(accountingJournalLines.lineNumber));
    const rootId = journal.reversalOfId ?? journal.replacementOfId ?? id;
    const related = await tx.select({ id: accountingJournals.id, number: accountingJournals.number,
      status: accountingJournals.status, reversalOfId: accountingJournals.reversalOfId,
      replacementOfId: accountingJournals.replacementOfId, accountingDate: accountingJournals.accountingDate,
      postingReason: accountingJournals.postingReason, postedAt: accountingJournals.postedAt,
      postedBy: accountingJournals.postedBy, description: accountingJournals.description,
    }).from(accountingJournals).where(and(eq(accountingJournals.companyId, companyId),
      scope.kind === "BRANCH" ? eq(accountingJournals.branchId, scope.branchId) : undefined,
      or(eq(accountingJournals.id, rootId), eq(accountingJournals.reversalOfId, rootId),
        eq(accountingJournals.replacementOfId, rootId), eq(accountingJournals.reversalOfId, id), eq(accountingJournals.replacementOfId, id))))
      .orderBy(asc(accountingJournals.createdAt),asc(accountingJournals.id)).limit(6);
    return { ...journal, lines, totals: totalsOf(lines), related: related.filter(row => row.id !== id) };
  });
}

export function listJournals(ctx: AccountingContext, options: z.input<typeof pageSchema> = {}) {
  return run(ctx, "read", async (tx, companyId, _actorId, scope) => {
    const { page, pageSize, status, branchId } = pageSchema.parse(options);
    if (scope.kind === "BRANCH" && branchId && branchId !== scope.branchId) throw ApiError.forbidden("No tienes acceso a esta sucursal.");
    const effectiveBranch = scope.kind === "BRANCH" ? scope.branchId : branchId;
    const rows = await tx.select({ id: accountingJournals.id, number: accountingJournals.number,
      status: accountingJournals.status, description: accountingJournals.description,
      accountingDate: accountingJournals.accountingDate, branchId: accountingJournals.branchId,
      version: accountingJournals.version, reversalOfId: accountingJournals.reversalOfId,
      replacementOfId: accountingJournals.replacementOfId,
    }).from(accountingJournals)
      .where(and(eq(accountingJournals.companyId, companyId), effectiveBranch ? eq(accountingJournals.branchId, effectiveBranch) : undefined,
        status ? eq(accountingJournals.status, status) : undefined))
      .orderBy(desc(accountingJournals.accountingDate), desc(accountingJournals.createdAt), asc(accountingJournals.id))
      .limit(pageSize + 1).offset((page - 1) * pageSize);
    return { items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize,
      capabilities: { create: hasPermission(ctx.role,"accounting","create"), update: hasPermission(ctx.role,"accounting","update"),
        publish: hasPermission(ctx.role,"accounting","publish"), reverse: hasPermission(ctx.role,"accounting","reverse") } };
  });
}

/** Reversa publicada + reemplazo opcional en una misma transacción; no edita el original. */
export function reverseJournal(ctx: AccountingContext, journalId: string, input: z.input<typeof reversalSchema>) {
  return run(ctx, "reverse", async (tx, companyId, actorId) => {
    const data = reversalSchema.parse(input), id = idSchema.parse(journalId);
    const [original] = await tx.select().from(accountingJournals)
      .where(and(eq(accountingJournals.companyId,companyId),eq(accountingJournals.id,id))).limit(1).for("update");
    if (!original) throw ApiError.notFound("Póliza no encontrada.");
    if (["DAILY_SALES_CUT", "SALES_REFUND"].includes(original.sourceType ?? "")) {
      throw ApiError.conflict("Utiliza una devolución vinculada a la venta; la reversa manual no controla su saldo.");
    }
    if (original.status !== "POSTED" || original.reversalOfId || original.version !== data.expectedVersion) {
      throw ApiError.conflict("Solo se revierte una póliza publicada vigente; vuelve a consultar su versión.");
    }
    const [existing] = await tx.select({ id: accountingJournals.id }).from(accountingJournals)
      .where(and(eq(accountingJournals.companyId,companyId),eq(accountingJournals.reversalOfId,id))).limit(1);
    if (existing) throw ApiError.conflict("La póliza ya tiene una reversa.");
    if (data.replacement && (data.replacement.branchId ?? null) !== original.branchId) {
      throw ApiError.badRequest("El reemplazo conserva la sucursal de la póliza original.");
    }
    if (data.replacement && data.replacement.accountingDate !== data.accountingDate) {
      throw ApiError.badRequest("El reemplazo usa la misma fecha contable que la reversa.");
    }
    if (data.replacement?.source) throw ApiError.badRequest("Un ajuste manual no puede atribuirse a otra fuente.");
    const lines = await tx.select().from(accountingJournalLines)
      .where(and(eq(accountingJournalLines.companyId,companyId),eq(accountingJournalLines.journalId,id)))
      .orderBy(asc(accountingJournalLines.lineNumber));
    const [reversalDraft] = await tx.insert(accountingJournals).values({ companyId,
      accountingDate: data.accountingDate, businessDate: original.businessDate, branchId: original.branchId,
      description: `Reversa de póliza ${original.number}`, reversalOfId: id, createdBy:actorId,updatedBy:actorId,
    }).returning();
    await insertJournalLines(tx,companyId,reversalDraft.id,lines.map(line=>({ accountId:line.accountId,costCenterId:line.costCenterId,
      debitCents:line.creditCents,creditCents:line.debitCents,memo:line.memo })));
    const reversal = await postInTransaction(tx,companyId,actorId,reversalDraft.id,1,data.reason);
    let replacement: typeof original | null = null;
    if (data.replacement) {
      assertLineTotals(data.replacement.lines);
      [replacement] = await tx.insert(accountingJournals).values({
        ...await draftValues(tx, companyId, data.replacement, actorId), companyId,
        replacementOfId: id, createdBy: actorId,
      }).returning();
      await insertJournalLines(tx,companyId,replacement.id,data.replacement.lines);
    }
    return { reversal, replacement };
  });
}
