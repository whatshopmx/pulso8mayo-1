import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { accountingEvents, accountingJournals, accountingJournalLines, accountingSalesDocuments,
  branches, dailySalesCuts, financialPeriods, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { getRoleScope } from "@/lib/rbac/resource-scope";
import type { AccountingContext } from "./journal-service";
import { insertJournalLines, postInTransaction } from "./journal-service";
import { isAccountingPostingEnabled } from "./expense-adapter";
import { finishAccountingEventIn, recordAccountingEventIn } from "./event-store";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";
import { refundDeclarationSchema, saleDeclarationSchema, salesAmountFields, salesComponents,
  type RefundDeclaration, type SaleDeclaration } from "./sales-contract";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Document = typeof accountingSalesDocuments.$inferSelect;
type Event = typeof accountingEvents.$inferSelect;
type Cut = typeof dailySalesCuts.$inferSelect;
const sourceFact = (document: Document) => ({ companyId: document.companyId, branchId: document.branchId,
  actorId: document.createdBy, accountingDate: document.businessDate,
  sourceType: document.kind === "SALE" ? "DAILY_SALES_CUT" : "SALES_REFUND",
  sourceId: document.kind === "SALE" ? document.cutId : document.id,
  eventType: document.kind === "SALE" ? "SALE_RECOGNIZED" : "SALE_REFUNDED", sourceVersion: document.version });

async function salesLock(tx: Tx, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 601))`);
}
async function assertOpen(tx: Tx, companyId: string, date: string) {
  const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(
    eq(financialPeriods.companyId, companyId), eq(financialPeriods.year, Number(date.slice(0, 4))),
    eq(financialPeriods.month, Number(date.slice(5, 7))), eq(financialPeriods.status, "CLOSED"),
  )).limit(1);
  if (closed) throw ApiError.conflict(`El periodo de ${date.slice(0, 7)} está cerrado.`);
}
async function run<T>(ctx: AccountingContext, action: "publish" | "reverse", operation: (tx: Tx) => Promise<T>) {
  if (!isAccountingPostingEnabled()) throw new ApiError("La contabilización automática aún no está habilitada.", 503);
  try {
    z.uuid().parse(ctx.companyId);
    return await withCompanyContext({ companyId: ctx.companyId, actorId: ctx.actorId }, async tx => {
      const [actor] = await tx.select({ role: users.role }).from(users).where(and(
        eq(users.companyId, ctx.companyId), eq(users.id, ctx.actorId), eq(users.active, true), isNull(users.deletedAt),
      )).limit(1);
      if (!actor || actor.role !== ctx.role || !hasPermission(actor.role, "accounting", action)
        || getRoleScope(actor.role) !== "COMPANY") throw ApiError.forbidden("No tienes permiso para reconocer o corregir estas ventas.");
      await salesLock(tx, ctx.companyId);
      return operation(tx);
    });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) throw ApiError.badRequest("Revisa la declaración contable de venta.");
    let cause: unknown = error;
    for (let depth = 0; depth < 8 && cause && typeof cause === "object"; depth++) {
      const code = "code" in cause ? cause.code : null;
      if (code === "23514" || code === "23505") throw ApiError.conflict("La declaración contradice la fuente, una corrección previa o el saldo disponible.");
      if (code === "23503") throw ApiError.notFound("La fuente o su referencia no existe en esta empresa.");
      cause = "cause" in cause ? cause.cause : null;
    }
    throw ApiError.internal("No se pudo procesar el hecho contable de venta.");
  }
}

function matchesCut(doc: Document, cut: Cut) {
  return cut.status === "VALIDATED" && cut.branchId === doc.branchId && cut.businessDate === doc.businessDate
    && cut.shift === doc.shift && cut.channel === doc.channel && cut.totalSales === doc.totalCents
    && (cut.taxAmount === null || cut.taxAmount === doc.taxCents)
    && (cut.cashSales === null || cut.cashSales === doc.cashCents)
    && (cut.cardSales === null || cut.cardSales === doc.cardCents)
    && (cut.otherPayments === null || cut.otherPayments === doc.platformCents + doc.otherCents);
}
const shiftsOverlap = (column: typeof dailySalesCuts.shift | typeof accountingSalesDocuments.shift, shift: string) =>
  sql`(${column}::text = ${shift} OR ${column}::text = 'COMPLETO' OR ${shift} = 'COMPLETO')`;
const channelsOverlap = (column: typeof dailySalesCuts.channel | typeof accountingSalesDocuments.channel, channel: string) =>
  sql`(${column}::text = ${channel} OR ${column}::text = 'TOTAL' OR ${channel} = 'TOTAL')`;

export async function postSalesEventIn(tx: Tx, event: Event) {
  const companyId = event.companyId;
  await salesLock(tx, companyId);
  const [existing] = await tx.select().from(accountingJournals).where(and(
    eq(accountingJournals.companyId, companyId), eq(accountingJournals.sourceType, event.sourceType),
    eq(accountingJournals.sourceId, event.sourceId), eq(accountingJournals.eventType, event.eventType),
    eq(accountingJournals.sourceVersion, event.sourceVersion),
  )).limit(1);
  if (existing?.status === "POSTED") {
    const result = { journal: existing, reason: null }; await finishAccountingEventIn(tx, event, result); return result;
  }
  const [document] = await tx.select().from(accountingSalesDocuments).where(and(
    eq(accountingSalesDocuments.companyId, companyId),
    event.sourceType === "DAILY_SALES_CUT" ? and(eq(accountingSalesDocuments.cutId, event.sourceId),
      eq(accountingSalesDocuments.kind, "SALE"), eq(accountingSalesDocuments.version, event.sourceVersion))
      : and(eq(accountingSalesDocuments.id, event.sourceId), eq(accountingSalesDocuments.kind, "REFUND")),
  )).limit(1);
  const pending = async (reason: string) => {
    const result = { journal: null, reason }; await finishAccountingEventIn(tx, event, result); return result;
  };
  if (!document) return pending("Falta una declaración explícita de impuesto, propinas, descuento y medios de cobro del corte.");
  if (document.branchId !== event.branchId || document.businessDate !== event.accountingDate) {
    return pending("La fecha o sucursal del hecho cambió; requiere una corrección vinculada, no mover el pendiente de periodo.");
  }
  const [branch] = await tx.select({ id: branches.id, ownershipType: branches.ownershipType }).from(branches).where(and(
    eq(branches.companyId, companyId), eq(branches.id, document.branchId), eq(branches.active, true),
  )).limit(1);
  if (!branch) return pending("La sucursal no está activa en esta empresa.");
  if (branch.ownershipType !== "OWNED") return pending("La venta de una franquicia requiere revisar la entidad legal; no se reconoce como venta propia.");
  if (document.kind === "SALE") {
    const [cut] = await tx.select().from(dailySalesCuts).where(and(eq(dailySalesCuts.companyId, companyId), eq(dailySalesCuts.id, document.cutId))).limit(1);
    if (!cut || !matchesCut(document, cut)) return pending("El corte cambió o no está validado; revisa su declaración sin editar la póliza.");
    const [overlap] = await tx.select({ id: dailySalesCuts.id }).from(dailySalesCuts).where(and(
      eq(dailySalesCuts.companyId, companyId), eq(dailySalesCuts.branchId, document.branchId),
      eq(dailySalesCuts.businessDate, document.businessDate), ne(dailySalesCuts.id, document.cutId),
      ne(dailySalesCuts.status, "REJECTED"), shiftsOverlap(dailySalesCuts.shift, document.shift), channelsOverlap(dailySalesCuts.channel, document.channel),
    )).limit(1);
    const [recognizedOverlap] = await tx.select({ id: accountingSalesDocuments.id }).from(accountingSalesDocuments).where(and(
      eq(accountingSalesDocuments.companyId, companyId), eq(accountingSalesDocuments.branchId, document.branchId),
      eq(accountingSalesDocuments.kind, "SALE"), eq(accountingSalesDocuments.businessDate, document.businessDate),
      ne(accountingSalesDocuments.id, document.id), shiftsOverlap(accountingSalesDocuments.shift, document.shift),
      channelsOverlap(accountingSalesDocuments.channel, document.channel),
      sql`(select coalesce(sum(r.total_cents),0) from accounting_sales_documents r join accounting_events e
        on e.company_id=r.company_id and e.source_id=r.id and e.source_type='SALES_REFUND' and e.status='POSTED'
        where r.company_id=${companyId} and r.original_id=${accountingSalesDocuments.id} and r.kind='REFUND') < ${accountingSalesDocuments.totalCents}`,
    )).limit(1);
    if (overlap || recognizedOverlap) return pending("Hay cortes o declaraciones solapados (TOTAL/canales/turnos). Revisa la fuente canónica antes de publicar.");
  }
  try { await assertOpen(tx, companyId, document.businessDate); }
  catch (error) { if (isApiError(error)) return pending(error.message); throw error; }
  const preview = await resolveRuleIn(tx, companyId, event.eventType, document.businessDate);
  const blocker = ruleBlockerMessage(preview);
  if (blocker) return pending(blocker);
  const components = salesComponents(document), entries = new Map(preview.entries.map(entry => [entry.role, entry]));
  if (components.some(component => !entries.has(component.role))) return pending("Faltan roles contables para los componentes documentados de la venta.");
  let originalLines: typeof accountingJournalLines.$inferSelect[] | null = null;
  if (document.kind === "REFUND") {
    const [original] = await tx.select().from(accountingSalesDocuments).where(and(
      eq(accountingSalesDocuments.companyId, companyId), eq(accountingSalesDocuments.id, document.originalId!),
    )).limit(1);
    const [journal] = original ? await tx.select().from(accountingJournals).where(and(
      eq(accountingJournals.companyId, companyId), eq(accountingJournals.sourceType, "DAILY_SALES_CUT"),
      eq(accountingJournals.sourceId, original.cutId), eq(accountingJournals.sourceVersion, original.version),
      eq(accountingJournals.eventType, "SALE_RECOGNIZED"), eq(accountingJournals.status, "POSTED"),
    )).limit(1) : [];
    if (!journal) return pending("La devolución espera la publicación de su venta original.");
    originalLines = await tx.select().from(accountingJournalLines).where(and(
      eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.journalId, journal.id),
    ));
    if (components.some(component => {
      const line = originalLines!.find(line => line.memo === `SALE:${component.role}`), entry = entries.get(component.role)!;
      return !line || line.accountId !== entry.accountId || line.costCenterId !== (entry.costCenterId ?? null);
    })) return pending("La regla de devolución no coincide con las cuentas o centros de la venta original.");
  }
  if (existing) return pending("Existe un borrador para esta fuente; requiere revisión antes de publicar.");
  const [draft] = await tx.insert(accountingJournals).values({ companyId, branchId: document.branchId,
    accountingDate: document.businessDate, businessDate: document.businessDate, currency: "MXN",
    description: `${document.kind === "SALE" ? "Venta" : "Devolución"}: ${document.documentReference}`,
    sourceType: event.sourceType, sourceId: event.sourceId, sourceVersion: event.sourceVersion,
    eventType: event.eventType, ruleId: preview.rule!.id, ruleVersion: preview.rule!.version,
    createdBy: document.createdBy, updatedBy: document.createdBy,
  }).returning();
  await insertJournalLines(tx, companyId, draft.id, components.map(component => {
    const entry = entries.get(component.role)!, debit = document.kind === "SALE" ? component.debit : !component.debit;
    return { accountId: entry.accountId, costCenterId: entry.costCenterId ?? null,
      debitCents: debit ? component.amount : 0, creditCents: debit ? 0 : component.amount, memo: `SALE:${component.role}` };
  }));
  const journal = await postInTransaction(tx, companyId, document.createdBy, draft.id, draft.version, document.reason);
  const result = { journal, reason: null }; await finishAccountingEventIn(tx, event, result); return result;
}

async function postDocumentIn(tx: Tx, document: Document) {
  const fact = sourceFact(document); await recordAccountingEventIn(tx, fact);
  const [event] = await tx.select().from(accountingEvents).where(and(
    eq(accountingEvents.companyId, fact.companyId), eq(accountingEvents.sourceType, fact.sourceType),
    eq(accountingEvents.sourceId, fact.sourceId), eq(accountingEvents.eventType, fact.eventType),
    eq(accountingEvents.sourceVersion, fact.sourceVersion),
  )).limit(1);
  return { document, ...await postSalesEventIn(tx, event) };
}

export function declareSalesCut(ctx: AccountingContext, input: SaleDeclaration) {
  return run(ctx, "publish", async tx => {
    const data = saleDeclarationSchema.parse(input);
    const [existing] = await tx.select().from(accountingSalesDocuments).where(and(
      eq(accountingSalesDocuments.companyId, ctx.companyId), eq(accountingSalesDocuments.id, data.documentId),
    )).limit(1);
    if (existing) {
      if (existing.kind !== "SALE" || existing.cutId !== data.cutId || existing.version !== data.version
        || existing.originalId !== (data.originalId ?? null) || salesAmountFields.some(key => existing[key] !== data[key])
        || existing.reason !== data.reason || existing.documentReference !== data.documentReference) {
        throw ApiError.conflict("La identidad del documento ya se usó con otros datos.");
      }
      return postDocumentIn(tx, existing);
    }
    const [cut] = await tx.select().from(dailySalesCuts).where(and(
      eq(dailySalesCuts.companyId, ctx.companyId), eq(dailySalesCuts.id, data.cutId),
    )).limit(1);
    if (!cut) throw ApiError.notFound("El corte no existe en esta empresa.");
    await assertOpen(tx, ctx.companyId, cut.businessDate);
    const [captured] = await tx.select().from(accountingEvents).where(and(
      eq(accountingEvents.companyId, ctx.companyId), eq(accountingEvents.sourceType, "DAILY_SALES_CUT"),
      eq(accountingEvents.sourceId, cut.id), eq(accountingEvents.sourceVersion, data.version),
    )).limit(1);
    if (captured && (captured.accountingDate !== cut.businessDate || captured.branchId !== cut.branchId)) {
      throw ApiError.conflict("El corte cambió de fecha o sucursal después de capturar el hecho; requiere revisión de su versión.");
    }
    const [document] = await tx.insert(accountingSalesDocuments).values({
      ...Object.fromEntries(salesAmountFields.map(key => [key, data[key]])) as Pick<Document, typeof salesAmountFields[number]>,
      id: data.documentId, companyId: ctx.companyId, branchId: cut.branchId, cutId: cut.id, kind: "SALE", version: data.version,
      originalId: data.originalId ?? null, businessDate: cut.businessDate, shift: cut.shift, channel: cut.channel,
      documentReference: data.documentReference, reason: data.reason, createdBy: ctx.actorId,
    }).returning();
    return postDocumentIn(tx, document);
  });
}

export function recordSalesRefund(ctx: AccountingContext, input: RefundDeclaration) {
  return run(ctx, "reverse", async tx => {
    const data = refundDeclarationSchema.parse(input);
    const [existing] = await tx.select().from(accountingSalesDocuments).where(and(
      eq(accountingSalesDocuments.companyId, ctx.companyId), eq(accountingSalesDocuments.id, data.documentId),
    )).limit(1);
    if (existing) {
      if (existing.kind !== "REFUND" || existing.originalId !== data.originalId || existing.businessDate !== data.accountingDate
        || salesAmountFields.some(key => existing[key] !== data[key]) || existing.documentReference !== data.documentReference
        || existing.reason !== data.reason) throw ApiError.conflict("La identidad de la devolución ya se usó con otros datos.");
      return postDocumentIn(tx, existing);
    }
    const [original] = await tx.select().from(accountingSalesDocuments).where(and(
      eq(accountingSalesDocuments.companyId, ctx.companyId), eq(accountingSalesDocuments.id, data.originalId),
      eq(accountingSalesDocuments.kind, "SALE"),
    )).limit(1);
    if (!original) throw ApiError.notFound("La venta original no existe en esta empresa.");
    await assertOpen(tx, ctx.companyId, data.accountingDate);
    const [document] = await tx.insert(accountingSalesDocuments).values({
      ...Object.fromEntries(salesAmountFields.map(key => [key, data[key]])) as Pick<Document, typeof salesAmountFields[number]>,
      id: data.documentId, companyId: ctx.companyId, branchId: original.branchId, cutId: original.cutId,
      kind: "REFUND", version: 1, originalId: original.id, businessDate: data.accountingDate,
      shift: original.shift, channel: original.channel, documentReference: data.documentReference, reason: data.reason, createdBy: ctx.actorId,
    }).returning();
    return postDocumentIn(tx, document);
  });
}
