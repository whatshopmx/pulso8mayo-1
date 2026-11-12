import { and, asc, eq, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import {
  accountingAccounts, accountingEvents, accountingGatewayLinks, accountingJournalLines, accountingJournals,
  accountingSourceLinks, bankTransactions, branches, companyBankAccounts, financialPeriods, gatewayTransactions, users,
} from "@/lib/db/schema";
import type { withCompanyContext } from "@/lib/db/tenant-context";
import { finishAccountingEventIn, recordAccountingEventIn } from "./event-store";
import { insertJournalLines, postInTransaction } from "./journal-service";
import { resolveRuleIn, ruleBlockerMessage } from "./mapping-service";
import { isAccountingPostingEnabled } from "./expense-adapter";

/**
 * FC-12 — liquidaciones de pasarela.
 *
 * Una partida de `gateway_transactions` con depósito bancario confirmado consume
 * la cuenta **por liquidar** que los cortes ya registraron: no crea ingreso. La
 * comisión medida se registra como gasto en la fecha del depósito, aparte de la
 * estimación operativa que sigue viviendo en `aggregator_settlements` (FC-18).
 *
 * Nada se infiere. El adquirente debe estar vinculado a un destino
 * (`CARD`/`PLATFORM`/`OTHER`), el depósito debe existir y cuadrar con el neto, y
 * si el bruto liquidado excede lo efectivamente registrado el hecho queda
 * PENDIENTE con su motivo. `accounting_capacity_guard` es la autoridad final.
 */
export const SETTLEMENT_RECOGNIZED = "SETTLEMENT_RECOGNIZED";

/** El destino del vínculo declara qué rol por liquidar consume la partida. */
export const SETTLEMENT_DESTINATIONS = { CARD: "CARD_RECEIVABLE", PLATFORM: "PLATFORM_RECEIVABLE",
  OTHER: "OTHER_RECEIVABLE" } as const;
export const SETTLEMENT_ROLES = { reception: "RECEPTION_SOURCE", commission: "COMMISSION_EXPENSE",
  tax: "RECOVERABLE_TAX" } as const;

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Event = typeof accountingEvents.$inferSelect;
type Fact = Parameters<typeof recordAccountingEventIn>[1];
type RuleEntry = Awaited<ReturnType<typeof resolveRuleIn>>["entries"][number];
type SourceRow = typeof gatewayTransactions.$inferSelect;
/** Identidad, montos y fechas: nunca números de cuenta, tarjeta ni referencias. */
type Settlement = Pick<SourceRow, "id" | "companyId" | "branchId" | "acquirer" | "externalId" | "grossAmountCents"
  | "feeAmountCents" | "feeVatCents" | "netAmountCents" | "destinationBankAccountId" | "status" | "importedBy">
  & { businessDate: string };

const settlementColumns = { id: gatewayTransactions.id, companyId: gatewayTransactions.companyId,
  branchId: gatewayTransactions.branchId, acquirer: gatewayTransactions.acquirer,
  externalId: gatewayTransactions.externalId, grossAmountCents: gatewayTransactions.grossAmountCents,
  feeAmountCents: gatewayTransactions.feeAmountCents, feeVatCents: gatewayTransactions.feeVatCents,
  netAmountCents: gatewayTransactions.netAmountCents,
  destinationBankAccountId: gatewayTransactions.destinationBankAccountId, status: gatewayTransactions.status,
  importedBy: gatewayTransactions.importedBy,
  businessDate: sql<string>`coalesce(${gatewayTransactions.settlementDate},
    ${gatewayTransactions.transactionDate}::date)::text` } as const;

/** Mismo cerrojo de empresa que los cortes: serializa reconocimiento y liquidación. */
async function settlementLock(tx: Tx, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${companyId}, 601))`);
}

/** El depósito definitivo es el match confirmado de `bank_transactions`, no una estimación. */
async function depositOf(tx: Tx, companyId: string, sourceId: string) {
  const [deposit] = await tx.select({ id: bankTransactions.id, accountId: bankTransactions.sourceBankAccountId,
    valueDate: bankTransactions.valueDate, amountCents: bankTransactions.amountCents }).from(bankTransactions)
    .where(and(eq(bankTransactions.companyId, companyId),
      eq(bankTransactions.matchedGatewayTransactionId, sourceId), eq(bankTransactions.matchStatus, "MATCHED")))
    .orderBy(asc(bankTransactions.valueDate), asc(bankTransactions.id)).limit(1);
  return deposit ?? null;
}

async function sourceOf(tx: Tx, companyId: string, sourceId: string) {
  const [source] = await tx.select(settlementColumns).from(gatewayTransactions).where(and(
    eq(gatewayTransactions.companyId, companyId), eq(gatewayTransactions.id, sourceId))).limit(1);
  return (source as Settlement) ?? null;
}

async function existingJournal(tx: Tx, companyId: string, sourceId: string) {
  const [journal] = await tx.select().from(accountingJournals).where(and(
    eq(accountingJournals.companyId, companyId), eq(accountingJournals.sourceType, "GATEWAY_SETTLEMENT"),
    eq(accountingJournals.sourceId, sourceId), eq(accountingJournals.eventType, SETTLEMENT_RECOGNIZED),
    eq(accountingJournals.sourceVersion, 1),
  )).limit(1);
  return journal ?? null;
}

/**
 * Saldos por liquidar efectivos de una cuenta. Espeja `accounting_capacity_guard`:
 * los cortes debitan, las devoluciones acreditan, las liquidaciones acreditan y
 * sus reversas devuelven capacidad. Cambiar uno exige cambiar el otro.
 */
async function receivableCents(tx: Tx, companyId: string, accountId: string) {
  const [row] = await tx.select({ total: sql<string>`coalesce(sum(${accountingJournalLines.debitCents}::bigint
    - ${accountingJournalLines.creditCents}::bigint), 0)::text` }).from(accountingJournalLines)
    .innerJoin(accountingJournals, and(eq(accountingJournals.companyId, companyId),
      eq(accountingJournals.id, accountingJournalLines.journalId)))
    .where(and(eq(accountingJournalLines.companyId, companyId), eq(accountingJournalLines.accountId, accountId),
      sql`(${accountingJournalLines.memo} like 'SALE:%\_RECEIVABLE' or ${accountingJournalLines.memo} = 'SETTLEMENT:RECEIVABLE')`,
      sql`(${accountingJournals.sourceType} in ('DAILY_SALES_CUT','SALES_REFUND','GATEWAY_SETTLEMENT')
        or exists (select 1 from "accounting_journals" o where o.company_id = ${accountingJournals.companyId}
          and o.id = ${accountingJournals.reversalOfId}
          and o.source_type in ('DAILY_SALES_CUT','SALES_REFUND','GATEWAY_SETTLEMENT')))`,
      eq(accountingJournals.status, "POSTED"))).limit(1);
  return Number(row?.total ?? 0);
}

function entryOf(entries: RuleEntry[], role: string) {
  return entries.find(entry => entry.role === role) ?? null;
}

type Ready = { deposit: { id: string; accountId: string | null; valueDate: string; amountCents: number };
  bank: { id: string; accountId: string }; link: { accountId: string; destination: string | null };
  money: { gross: number; fee: number; vat: number; net: number } };

/** Motivo a motivo: un `string` es el bloqueo accionable; `Ready` significa publica. */
async function eligibility(tx: Tx, fact: Fact, source: Settlement): Promise<string | Ready> {
  const money = { gross: source.grossAmountCents, fee: source.feeAmountCents,
    vat: source.feeVatCents, net: source.netAmountCents };
  if (Object.values(money).some(value => !Number.isSafeInteger(value) || value < 0)) {
    return "Los importes de la liquidación deben ser centavos enteros no negativos.";
  }
  if (source.status !== "SETTLED") {
    return "Sólo una transacción liquidada por la pasarela consume la cuenta por liquidar; un reembolso o un cargo desconocido no es dinero.";
  }
  if (!source.externalId) {
    return "La transacción no tiene identificador externo de la pasarela, así que no se puede vincular de forma inequívoca; requiere una corrección auditada.";
  }
  if (money.gross !== money.net + money.fee + money.vat) {
    return `El bruto de la pasarela (${money.gross}) no cuadra con neto + comisión + IVA (${money.net + money.fee + money.vat}); la liquidación no se recalcula.`;
  }
  if (money.net <= 0) return "El neto depositado debe ser mayor que cero para contabilizar la liquidación.";
  const [branch] = await tx.select({ id: branches.id, ownershipType: branches.ownershipType }).from(branches)
    .where(and(eq(branches.companyId, fact.companyId), eq(branches.id, source.branchId), eq(branches.active, true))).limit(1);
  if (!branch) return "La sucursal de la liquidación no está activa en esta empresa.";
  if (branch.ownershipType !== "OWNED") {
    return "La liquidación de una franquicia requiere revisar la entidad legal; no se contabiliza como propia.";
  }
  const [actor] = await tx.select({ id: users.id }).from(users).where(and(
    eq(users.companyId, fact.companyId), eq(users.id, fact.actorId), eq(users.active, true), isNull(users.deletedAt),
  )).limit(1);
  if (!actor) return "Quien importó la transacción ya no es un usuario activo de esta empresa; se requiere una corrección auditada.";
  const deposit = await depositOf(tx, fact.companyId, source.id);
  if (!deposit) return "Falta el depósito bancario confirmado que respalda esta liquidación; concilia el extracto antes de contabilizar.";
  if (deposit.amountCents !== money.net) {
    return `El depósito confirmado (${deposit.amountCents}) no coincide con el neto declarado por la pasarela (${money.net}).`;
  }
  if (!source.destinationBankAccountId || source.destinationBankAccountId !== deposit.accountId) {
    return "La cuenta de destino declarada por la pasarela no es la cuenta donde aterrizó el depósito confirmado.";
  }
  if (fact.accountingDate !== deposit.valueDate) {
    return "La fecha del depósito cambió después de capturar el hecho; requiere revisión, no mover el pendiente de periodo.";
  }
  if (fact.branchId !== source.branchId) {
    return "La sucursal del hecho cambió después de capturar el hecho; requiere revisión.";
  }
  const [bank] = await tx.select({ id: companyBankAccounts.id, active: companyBankAccounts.active,
    currency: companyBankAccounts.currency, accountId: accountingSourceLinks.accountId })
    .from(companyBankAccounts).leftJoin(accountingSourceLinks, and(
      eq(accountingSourceLinks.companyId, fact.companyId),
      eq(accountingSourceLinks.bankAccountId, companyBankAccounts.id),
    )).where(and(eq(companyBankAccounts.companyId, fact.companyId),
      eq(companyBankAccounts.id, deposit.accountId))).limit(1);
  if (!bank) return "La cuenta bancaria del depósito ya no existe en el catálogo de la empresa.";
  if (!bank.active || bank.currency !== "MXN") {
    return "La cuenta bancaria del depósito no está activa en MXN. Revisa el catálogo antes de contabilizar.";
  }
  if (!bank.accountId) {
    return "La cuenta bancaria del depósito no tiene vínculo contable. Configúralo en Cuentas para cada operación.";
  }
  const [target] = await tx.select({ kind: accountingAccounts.kind, active: accountingAccounts.active,
    postable: accountingAccounts.postable, validFrom: accountingAccounts.validFrom, validTo: accountingAccounts.validTo })
    .from(accountingAccounts).where(and(eq(accountingAccounts.companyId, fact.companyId),
      eq(accountingAccounts.id, bank.accountId))).limit(1);
  if (!target || target.kind !== "ASSET" || !target.active || !target.postable
    || target.validFrom > fact.accountingDate || (target.validTo && target.validTo < fact.accountingDate)) {
    return "La cuenta contable del banco debe ser de activo, estar activa, ser de movimiento y estar vigente en la fecha del depósito.";
  }
  const [link] = await tx.select({ accountId: accountingGatewayLinks.accountId,
    destination: accountingGatewayLinks.salesDestination }).from(accountingGatewayLinks).where(and(
    eq(accountingGatewayLinks.companyId, fact.companyId), eq(accountingGatewayLinks.gatewayAcquirer, source.acquirer),
  )).limit(1);
  if (!link) {
    return `El adquirente ${source.acquirer} no tiene vínculo con una cuenta por liquidar. Decláralo en Liquidaciones antes de contabilizar.`;
  }
  return { deposit, bank: { id: bank.id, accountId: bank.accountId }, link, money };
}

/** Publica la liquidación o devuelve el motivo que la deja pendiente. */
async function settleIn(tx: Tx, fact: Fact, source: Settlement) {
  await settlementLock(tx, fact.companyId);
  const existing = await existingJournal(tx, fact.companyId, fact.sourceId);
  if (existing) return { journal: existing, reason: null as string | null };
  // Freeze links and rule selection under the same lock as catalog mutations.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${fact.companyId}, 505))`);
  const ready = await eligibility(tx, fact, source);
  if (typeof ready === "string") return { journal: null, reason: ready };
  const { bank, link, money } = ready;

  const role = SETTLEMENT_DESTINATIONS[link.destination as keyof typeof SETTLEMENT_DESTINATIONS];
  if (!role) return { journal: null, reason: `El destino declarado para ${source.acquirer} no es CARD, PLATFORM ni OTHER; decláralo de nuevo.` };
  const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(
    eq(financialPeriods.companyId, fact.companyId), eq(financialPeriods.year, Number(fact.accountingDate.slice(0, 4))),
    eq(financialPeriods.month, Number(fact.accountingDate.slice(5, 7))), eq(financialPeriods.status, "CLOSED"),
  )).limit(1);
  if (closed) {
    return { journal: null, reason: `El periodo de ${fact.accountingDate.slice(0, 7)} está cerrado; la liquidación no se puede contabilizar en esa fecha.` };
  }
  const preview = await resolveRuleIn(tx, fact.companyId, SETTLEMENT_RECOGNIZED, fact.accountingDate);
  const blocker = ruleBlockerMessage(preview);
  if (blocker) return { journal: null, reason: blocker };
  const required = [...(money.fee > 0 ? [SETTLEMENT_ROLES.commission] : []),
    ...(money.vat > 0 ? [SETTLEMENT_ROLES.tax] : []), role];
  const missing = required.filter(role => !entryOf(preview.entries, role));
  if (missing.length) {
    const labels: Record<string, string> = { RECEPTION_SOURCE: "la recepción del depósito",
      COMMISSION_EXPENSE: "la comisión medida", RECOVERABLE_TAX: "el IVA documentado de la comisión",
      CARD_RECEIVABLE: "lo por liquidar de tarjetas", PLATFORM_RECEIVABLE: "lo por liquidar de plataformas",
      OTHER_RECEIVABLE: "lo por liquidar de otros cobros" };
    return { journal: null, reason: `Faltan cuentas para ${missing.map(entry => labels[entry] ?? entry).join(", ")} en la regla de liquidaciones. Revisa Cuentas para cada operación.` };
  }
  // As in treasury payments, the selected bank's explicit link is authoritative.
  // A generic reception role may supply a cost center, but never another bank.
  const reception = entryOf(preview.entries, SETTLEMENT_ROLES.reception);
  const receivable = entryOf(preview.entries, role)!;
  if (receivable.accountId !== link.accountId) {
    return { journal: null, reason: `El vínculo de ${source.acquirer} y la regla de liquidaciones usan cuentas por liquidar distintas para ${link.destination}; deben coincidir.` };
  }
  const outstanding = await receivableCents(tx, fact.companyId, receivable.accountId);
  if (money.gross > outstanding) {
    return { journal: null, reason: `La liquidación (${money.gross}) excede la cuenta por liquidar registrada por los cortes (${outstanding}); revisa la fuente canónica antes de publicar.` };
  }
  const commission = money.fee > 0 ? entryOf(preview.entries, SETTLEMENT_ROLES.commission)! : null;
  const tax = money.vat > 0 ? entryOf(preview.entries, SETTLEMENT_ROLES.tax)! : null;
  const [account] = await tx.select({ code: accountingAccounts.code }).from(accountingAccounts).where(and(
    eq(accountingAccounts.companyId, fact.companyId), eq(accountingAccounts.id, receivable.accountId))).limit(1);
  const lines = [
    { accountId: bank.accountId, costCenterId: reception?.costCenterId ?? null,
      debitCents: money.net, creditCents: 0, memo: "SETTLEMENT:NET" },
    ...(commission ? [{ accountId: commission.accountId, costCenterId: commission.costCenterId ?? null,
      debitCents: money.fee, creditCents: 0, memo: "SETTLEMENT:COMMISSION" }] : []),
    ...(tax ? [{ accountId: tax.accountId, costCenterId: tax.costCenterId ?? null,
      debitCents: money.vat, creditCents: 0, memo: "SETTLEMENT:COMMISSION_VAT" }] : []),
    { accountId: receivable.accountId, costCenterId: receivable.costCenterId ?? null,
      debitCents: 0, creditCents: money.gross, memo: "SETTLEMENT:RECEIVABLE" },
  ];
  const [draft] = await tx.insert(accountingJournals).values({ companyId: fact.companyId,
    accountingDate: fact.accountingDate, businessDate: source.businessDate, branchId: source.branchId,
    description: `Liquidación ${source.acquirer} ${source.externalId} (${account?.code ?? role})`, currency: "MXN",
    sourceType: "GATEWAY_SETTLEMENT", sourceId: source.id, sourceVersion: 1, eventType: SETTLEMENT_RECOGNIZED,
    ruleId: preview.rule!.id, ruleVersion: preview.rule!.version, createdBy: fact.actorId, updatedBy: fact.actorId,
  }).returning();
  if (!draft) throw new Error("No se pudo crear la póliza de la liquidación.");
  await insertJournalLines(tx, fact.companyId, draft.id, lines);
  const journal = await postInTransaction(tx, fact.companyId, fact.actorId, draft.id, draft.version,
    "Liquidación contabilizada al confirmar el depósito bancario.");
  return { journal, reason: null as string | null };
}

/**
 * Entrada de la conciliación: captura el hecho y lo publica en la misma
 * transacción. Sin depósito confirmado no hay hecho que registrar.
 */
export async function settleConfirmedTransactionIn(tx: Tx, companyId: string, actorId: string, sourceId: string) {
  if (!isAccountingPostingEnabled()) return { journal: null, reason: "La contabilización automática aún no está habilitada." };
  await settlementLock(tx, companyId);
  const source = await sourceOf(tx, companyId, sourceId);
  if (!source) return { journal: null, reason: "La transacción de pasarela no existe en esta empresa." };
  const deposit = await depositOf(tx, companyId, source.id);
  if (!deposit) return { journal: null, reason: "Falta el depósito bancario confirmado que respalda esta liquidación." };
  const fact: Fact = { companyId, branchId: source.branchId, sourceType: "GATEWAY_SETTLEMENT", sourceId: source.id,
    eventType: SETTLEMENT_RECOGNIZED, sourceVersion: 1, actorId, accountingDate: deposit.valueDate };
  await recordAccountingEventIn(tx, fact);
  const result = await settleIn(tx, fact, source);
  await finishAccountingEventIn(tx, fact, result);
  return result;
}

/** Reintento del hecho capturado; la identidad congelada manda sobre la fuente actual. */
export async function postSettlementEventIn(tx: Tx, event: Event) {
  await settlementLock(tx, event.companyId);
  const fact: Fact = { companyId: event.companyId, branchId: event.branchId, sourceType: event.sourceType,
    sourceId: event.sourceId, eventType: event.eventType, sourceVersion: event.sourceVersion,
    actorId: event.actorId, accountingDate: event.accountingDate ?? "" };
  const pending = async (reason: string) => {
    const result = { journal: null, reason };
    await finishAccountingEventIn(tx, event, result);
    return result;
  };
  if (!event.accountingDate) return pending("El hecho no tiene fecha contable; requiere una corrección auditada.");
  const source = await sourceOf(tx, event.companyId, event.sourceId);
  if (!source) return pending("La transacción de pasarela ya no existe en esta empresa.");
  const result = await settleIn(tx, fact, source);
  await finishAccountingEventIn(tx, event, result);
  return result;
}

/** Barrido acotado: partidas liquidadas con depósito confirmado y hecho ausente. */
export async function recoverSettlementFacts(tx: Tx, companyId: string) {
  // Keep the observed match and fact capture atomic against ordinary unmatching.
  await settlementLock(tx, companyId);
  const rows = await tx.select(settlementColumns).from(gatewayTransactions)
    .innerJoin(bankTransactions, and(eq(bankTransactions.companyId, companyId),
      eq(bankTransactions.matchedGatewayTransactionId, gatewayTransactions.id),
      eq(bankTransactions.matchStatus, "MATCHED")))
    .innerJoin(branches, and(eq(branches.id, gatewayTransactions.branchId), eq(branches.companyId, companyId)))
    .innerJoin(users, and(eq(users.id, gatewayTransactions.importedBy), eq(users.companyId, companyId)))
    .where(and(eq(gatewayTransactions.companyId, companyId), eq(gatewayTransactions.status, "SETTLED"),
      isNotNull(gatewayTransactions.externalId), isNotNull(gatewayTransactions.importedBy),
      notExists(tx.select({ one: sql`1` }).from(accountingEvents).where(and(
        eq(accountingEvents.companyId, gatewayTransactions.companyId),
        eq(accountingEvents.sourceType, "GATEWAY_SETTLEMENT"),
        eq(accountingEvents.sourceId, gatewayTransactions.id),
        eq(accountingEvents.eventType, SETTLEMENT_RECOGNIZED), eq(accountingEvents.sourceVersion, 1))))))
    .orderBy(asc(gatewayTransactions.settlementDate), asc(gatewayTransactions.id)).limit(25);
  for (const row of rows) {
    const source = row as Settlement;
    const deposit = await depositOf(tx, companyId, source.id);
    if (!deposit) continue;
    await recordAccountingEventIn(tx, { companyId, branchId: source.branchId, sourceType: "GATEWAY_SETTLEMENT",
      sourceId: source.id, eventType: SETTLEMENT_RECOGNIZED, sourceVersion: 1,
      actorId: source.importedBy!, accountingDate: deposit.valueDate });
  }
  return rows.length;
}
