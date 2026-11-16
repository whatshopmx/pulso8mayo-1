import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { setTenantContext } from "@/lib/db/tenant-context";
import { branches, companies, invoices, operatingExpenses, payees, suppliers, users } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { isBranchScopedRole } from "@/lib/branch-scope";
import { assertOperatingCfdiAccess, type OperatingCfdiActor } from "./operating-cfdi-preview";
import { normalizeCfdiRfc, parseOperatingCfdi } from "./operating-cfdi-parser";
import { createOperatingExpenseIn, notifyOperatingExpenseCreated, type CreateExpenseInput } from "./expense-service";
import { associatePayeeInvoiceIn } from "./payee-finance-service";
import { AuditService } from "./audit-service";

const common = { branchId: z.uuid(), payeeId: z.uuid() };
const confirmation = z.discriminatedUnion("mode", [
  z.object({ ...common, mode: z.literal("CREATE"), category: z.enum(["RENTA", "SERVICIOS", "MANTENIMIENTO", "PUBLICIDAD", "SERVICIOS_PROFESIONALES", "OTROS"]),
    description: z.string().trim().min(1).max(1000), costCenterId: z.uuid().optional(), dueDate: z.iso.date().optional() }).strict(),
  z.object({ ...common, mode: z.literal("ASSOCIATE"), expenseId: z.uuid() }).strict(),
]);
export interface OperatingCfdiConfirmation { invoiceId: string; expenseId: string; outcome: "CREATED" | "ASSOCIATED" | "EXISTING" }
const duplicate = () => ApiError.conflict("El CFDI ya está registrado o requiere revisión. Abre el documento desde su contexto autorizado; no se creará otra obligación.");

/** El XML original se valida otra vez: ningún importe/hash de la vista previa es autoridad. */
export async function confirmOperatingCfdi(actor: OperatingCfdiActor, xml: string, raw: unknown): Promise<OperatingCfdiConfirmation> {
  assertOperatingCfdiAccess(actor);
  const parsed = confirmation.safeParse(raw);
  if (!parsed.success) throw ApiError.badRequest("Los datos de confirmación del gasto no son válidos.");
  const data = parsed.data;
  if (isBranchScopedRole(actor.role) && actor.assignedBranchId?.toLowerCase() !== data.branchId.toLowerCase()) throw ApiError.forbidden("No puedes confirmar CFDI en esa sucursal.");
  type Notice = { input: CreateExpenseInput; creation: Awaited<ReturnType<typeof createOperatingExpenseIn>> };
  let committed: { result: OperatingCfdiConfirmation; notice?: Notice };
  try {
    committed = await db.transaction(async tx => {
      await setTenantContext(tx, { companyId: actor.companyId, actorId: actor.userId });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.companyId}, 614))`);
      const [user] = await tx.select({ role: users.role, branchId: users.branchId }).from(users).where(and(
        eq(users.id, actor.userId), eq(users.companyId, actor.companyId), eq(users.active, true), sql`${users.deletedAt} is null`,
      )).for("share").limit(1);
      if (!user || user.role !== actor.role || (isBranchScopedRole(user.role) && user.branchId?.toLowerCase() !== data.branchId.toLowerCase())) throw ApiError.forbidden("La sesión ya no tiene permiso para confirmar el gasto.");
      const [company] = await tx.select({ taxId: companies.taxId }).from(companies).where(eq(companies.id, actor.companyId)).for("share").limit(1);
      const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, data.branchId), eq(branches.companyId, actor.companyId), eq(branches.active, true))).for("share").limit(1);
      const [payee] = await tx.select({ id: payees.id, taxId: payees.taxId }).from(payees).where(and(eq(payees.id, data.payeeId), eq(payees.companyId, actor.companyId), eq(payees.active, true))).for("share").limit(1);
      if (!branch || !payee) throw ApiError.notFound("La sucursal o contraparte no está disponible para esta empresa.");
      if (!company?.taxId || !payee.taxId) throw ApiError.badRequest("Configura los RFC de la empresa y contraparte antes de confirmar el CFDI.");
      const document = parseOperatingCfdi(xml, company.taxId);
      if (normalizeCfdiRfc(payee.taxId) !== document.emitter.rfc) throw ApiError.badRequest("El RFC emisor no corresponde a la contraparte seleccionada.");
      const readiness = await tx.execute(sql`select exists(select 1 from pg_index where indexrelid=to_regclass('invoices_uuid_casefold_unique')
        and indrelid=to_regclass('invoices') and indisunique and indisvalid) as ready`);
      if (!(readiness.rows[0] as { ready?: boolean })?.ready) throw ApiError.conflict("La captura de CFDI requiere la migración de unicidad fiscal antes de habilitarse.");

      let target: typeof operatingExpenses.$inferSelect | undefined;
      if (data.mode === "ASSOCIATE") {
        [target] = await tx.select().from(operatingExpenses).where(and(eq(operatingExpenses.id, data.expenseId), eq(operatingExpenses.companyId, actor.companyId),
          eq(operatingExpenses.branchId, branch.id), eq(operatingExpenses.payeeId, payee.id))).for("update").limit(1);
        if (!target) throw ApiError.notFound("El gasto no está disponible en tu alcance.");
        if (target.amount !== document.totalCents || (target.taxAmount !== null && target.taxAmount !== document.taxCents)) throw ApiError.conflict("El importe o impuesto del gasto no coincide con el CFDI; no se ajustará automáticamente.");
      }
      const [existing] = await tx.select().from(invoices).where(and(eq(invoices.companyId, actor.companyId), sql`upper(${invoices.uuid}) = ${document.uuid}`)).for("update").limit(1);
      if (existing) {
        if (existing.branchId !== branch.id || (existing.payeeId && existing.payeeId !== payee.id)
          || existing.total !== document.totalCents || existing.subtotal !== document.subtotalCents || existing.taxAmount !== document.taxCents
          || existing.currency !== document.currency || existing.fecha !== document.fecha || normalizeCfdiRfc(existing.rfcEmisor) !== document.emitter.rfc
          || normalizeCfdiRfc(existing.rfcReceptor) !== document.receiver.rfc || existing.destination === "INVENTORY_PURCHASE") throw duplicate();
        if (existing.xmlContent?.trim()) {
          let stored;
          try { stored = parseOperatingCfdi(existing.xmlContent, company.taxId); } catch { throw duplicate(); }
          if (stored.uuid !== document.uuid || stored.fecha !== document.fecha || stored.emitter.rfc !== document.emitter.rfc
            || stored.receiver.rfc !== document.receiver.rfc || stored.totalCents !== document.totalCents
            || stored.subtotalCents !== document.subtotalCents || stored.taxCents !== document.taxCents) throw duplicate();
        }
        if (existing.supplierId) {
          const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, existing.supplierId), eq(suppliers.companyId, actor.companyId), eq(suppliers.payeeId, payee.id))).limit(1);
          if (!supplier) throw duplicate();
        }
        const linked = await tx.select().from(operatingExpenses).where(and(eq(operatingExpenses.companyId, actor.companyId), eq(operatingExpenses.invoiceId, existing.id))).limit(2);
        if (linked.length) {
          if (linked.length !== 1 || linked[0].branchId !== branch.id || linked[0].payeeId !== payee.id || linked[0].amount !== document.totalCents
            || (target && target.id !== linked[0].id)) throw duplicate();
          return { result: { invoiceId: existing.id, expenseId: linked[0].id, outcome: "EXISTING" as const } };
        }
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actor.companyId}, 505))`);
      let invoice = existing;
      if (!invoice) {
        [invoice] = await tx.insert(invoices).values({ companyId: actor.companyId, branchId: branch.id, payeeId: payee.id, supplierId: null,
          destination: "OPERATING_EXPENSE", classifiedAt: new Date(), classifiedBy: actor.userId, classificationSource: "CAPTURE",
          classificationReason: "CFDI operativo confirmado desde Finanzas", uuid: document.uuid, folio: document.folio, serie: document.serie,
          fecha: document.fecha, subtotal: document.subtotalCents, taxAmount: document.taxCents, total: document.totalCents, currency: document.currency,
          rfcEmisor: document.emitter.rfc, nombreEmisor: document.emitter.name, rfcReceptor: document.receiver.rfc, nombreReceptor: document.receiver.name,
          dueDate: data.mode === "CREATE" ? data.dueDate : target?.dueDate, xmlContent: xml,
        }).returning();
      }
      let notice: Notice | undefined;
      if (data.mode === "CREATE") {
        const input: CreateExpenseInput = { companyId: actor.companyId, branchId: branch.id, payeeId: payee.id, requestedBy: actor.userId,
          category: data.category, description: data.description, costCenterId: data.costCenterId, dueDate: data.dueDate,
          businessDate: document.fecha.slice(0, 10), amountCents: document.totalCents, taxCents: document.taxCents };
        const creation = await createOperatingExpenseIn(tx, input);
        target = creation.expense; notice = { input, creation };
      }
      if (!target) throw ApiError.internal("No se resolvió el gasto del CFDI.");
      if (existing && !existing.payeeId) await tx.update(invoices).set({ payeeId: payee.id })
        .where(and(eq(invoices.companyId, actor.companyId), eq(invoices.id, existing.id)));
      await associatePayeeInvoiceIn(tx, { companyId: actor.companyId, payeeId: payee.id, expenseId: target.id,
        invoiceId: invoice.id, actorId: actor.userId, branchId: branch.id });
      if (target.taxAmount === null) await tx.update(operatingExpenses).set({ taxAmount: document.taxCents, updatedAt: new Date() }).where(and(eq(operatingExpenses.companyId, actor.companyId), eq(operatingExpenses.id, target.id)));
      if (existing) {
        await tx.update(invoices).set({ payeeId: payee.id, destination: "OPERATING_EXPENSE", classifiedAt: new Date(), classifiedBy: actor.userId,
          classificationSource: "CAPTURE", classificationReason: "CFDI operativo confirmado desde Finanzas",
          xmlContent: existing.xmlContent?.trim() ? existing.xmlContent : xml, updatedAt: new Date() }).where(and(eq(invoices.companyId, actor.companyId), eq(invoices.id, invoice.id)));
      }
      await AuditService.logInventoryAction({ companyId: actor.companyId, branchId: branch.id, entityType: "PAYEE", action: "UPDATE", entityId: payee.id,
        performedBy: actor.userId, reason: "Confirmación atómica de CFDI de gasto operativo",
        newValue: { invoiceId: invoice.id, expenseId: target.id, invoiceCreated: !existing, taxCents: document.taxCents } }, tx);
      return { result: { invoiceId: invoice.id, expenseId: target.id, outcome: data.mode === "CREATE" ? "CREATED" as const : "ASSOCIATED" as const }, notice };
    }, { isolationLevel: "read committed" });
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } } | null;
    const code = failure?.code ?? failure?.cause?.code;
    if (code === "23505") throw duplicate(); // Tampoco revela UUID/IDs de una empresa ajena.
    throw error;
  }
  if (committed.notice) {
    try { await notifyOperatingExpenseCreated(committed.notice.input, committed.notice.creation); }
    catch { console.warn("operating-cfdi-confirm: el aviso posterior al commit no pudo completarse"); }
  }
  return committed.result;
}
