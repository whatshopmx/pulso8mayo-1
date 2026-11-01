import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { accountingAccounts, accountingRuleEntries, accountingRules, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import { getRoleScope } from "@/lib/rbac/resource-scope";

/**
 * FC-08 — recognition rules by fact and effective date.
 *
 * A rule is one immutable version: a revision inserts a new row that supersedes
 * the previous one and carries its own effective date. Nothing is mapped
 * automatically and no rule is seeded; a company must configure its own. The
 * journal freezes `ruleId`/`ruleVersion`, and publishing re-checks the mapping so
 * a missing rule or account blocks the journal with an explicit reason.
 */
export interface AccountingContext { companyId: string; actorId: string; role: Role }
type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
const day = z.iso.date().refine(value => value >= "0001-01-01", "Fecha inválida.");
const rolePattern = /^[A-Z][A-Z0-9_]{2,39}$/;
const codePattern = /^[A-Z][A-Z0-9_]{2,31}$/;

const entrySchema = z.object({
  role: z.string().trim().toUpperCase().regex(rolePattern, "Usa un rol como CASH o PAYABLE."),
  accountId: z.uuid(),
  costCenterId: z.uuid().nullable().optional(),
  required: z.boolean().optional(),
}).strict();

const createSchema = z.object({
  code: z.string().trim().toUpperCase().regex(codePattern, "Usa un código como CASH_SALE."),
  name: z.string().trim().min(1).max(160),
  eventType: z.string().trim().toUpperCase().regex(rolePattern, "Usa un hecho como EXPENSE_RECOGNIZED."),
  effectiveFrom: day,
  supersedesId: z.uuid().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().min(1).max(500).nullable().optional(),
  entries: z.array(entrySchema).min(1).max(50),
}).strict().refine(value => new Set(value.entries.map(entry => entry.role)).size === value.entries.length, {
  message: "Cada rol aparece una sola vez en la regla.",
});

const pageSchema = z.object({
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  eventType: z.string().trim().toUpperCase().regex(rolePattern).optional(),
}).strict();

const resolveSchema = z.object({ eventType: z.string().trim().toUpperCase().regex(rolePattern), date: day }).strict();

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
}

async function run<T>(ctx: AccountingContext, action: "read" | "create", operation: (tx: Tx, companyId: string, actorId: string) => Promise<T>) {
  try {
    if (!hasPermission(ctx.role, "settings", "update")) {
      throw ApiError.forbidden("No puedes administrar las reglas contables.");
    }
    if (action === "create" && getRoleScope(ctx.role) !== "COMPANY") {
      throw ApiError.forbidden("Configurar reglas requiere alcance de empresa.");
    }
    const principal = z.object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
      .parse({ companyId: ctx.companyId, actorId: ctx.actorId });
    return await withCompanyContext(principal, async tx => {
      const [actor] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.id, principal.actorId), eq(users.companyId, principal.companyId), eq(users.role, ctx.role),
        eq(users.active, true), isNull(users.deletedAt),
      )).limit(1);
      if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");
      return operation(tx, principal.companyId, principal.actorId);
    });
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) throw ApiError.badRequest("Revisa los datos de la regla contable.");
    const code = databaseCode(error);
    if (code === "23505") throw ApiError.conflict("Ese código, versión o fecha efectiva ya existe en esta empresa.");
    if (code === "23503") throw ApiError.notFound("La cuenta, centro de costo o versión anterior no existe en esta empresa.");
    if (code === "23514") throw ApiError.conflict("La regla no cumple las reglas de versión, vigencia o cuentas.");
    if (["40001", "40P01", "0A000"].includes(code ?? "")) throw ApiError.conflict("Repite la operación en una transacción READ COMMITTED.");
    throw ApiError.internal("No se pudo procesar la regla contable.");
  }
}

/** Inserts a new immutable version with its role → account entries. */
export function createRule(ctx: AccountingContext, input: z.input<typeof createSchema>) {
  return run(ctx, "create", async (tx, companyId, actorId) => {
    const data = createSchema.parse(input);
    let version = 1;
    if (data.supersedesId) {
      const [previous] = await tx.select().from(accountingRules).where(and(
        eq(accountingRules.companyId, companyId), eq(accountingRules.id, data.supersedesId),
      )).limit(1);
      if (!previous) throw ApiError.notFound("La versión anterior no existe en esta empresa.");
      if (previous.code !== data.code) throw ApiError.badRequest("La nueva versión conserva el código de la anterior.");
      version = previous.version + 1;
    }
    const [rule] = await tx.insert(accountingRules).values({
      companyId, code: data.code, name: data.name, eventType: data.eventType, version,
      effectiveFrom: data.effectiveFrom, supersedesId: data.supersedesId ?? null,
      active: data.active ?? true, notes: data.notes ?? null, createdBy: actorId, updatedBy: actorId,
    }).returning();
    if (!rule) throw ApiError.internal("No se pudo crear la regla contable.");
    await tx.insert(accountingRuleEntries).values(data.entries.map(entry => ({
      companyId, ruleId: rule.id, role: entry.role, accountId: entry.accountId,
      costCenterId: entry.costCenterId ?? null, required: entry.required ?? true,
    })));
    return { rule, entries: await listEntriesOf(tx, companyId, rule.id) };
  });
}

async function listEntriesOf(tx: Tx, companyId: string, ruleId: string) {
  return tx.select({
    id: accountingRuleEntries.id, role: accountingRuleEntries.role, required: accountingRuleEntries.required,
    accountId: accountingRuleEntries.accountId, accountCode: accountingAccounts.code,
    accountName: accountingAccounts.name, accountActive: accountingAccounts.active,
    accountPostable: accountingAccounts.postable, accountValidFrom: accountingAccounts.validFrom,
    accountValidTo: accountingAccounts.validTo, costCenterId: accountingRuleEntries.costCenterId,
  }).from(accountingRuleEntries)
    .innerJoin(accountingAccounts, and(
      eq(accountingAccounts.companyId, accountingRuleEntries.companyId),
      eq(accountingAccounts.id, accountingRuleEntries.accountId),
    ))
    .where(and(eq(accountingRuleEntries.companyId, companyId), eq(accountingRuleEntries.ruleId, ruleId)))
    .orderBy(asc(accountingRuleEntries.role));
}

export function listRules(ctx: AccountingContext, options: z.input<typeof pageSchema> = {}) {
  return run(ctx, "read", async (tx, companyId) => {
    const { page, pageSize, eventType } = pageSchema.parse(options);
    const rows = await tx.select({
      id: accountingRules.id, code: accountingRules.code, name: accountingRules.name,
      eventType: accountingRules.eventType, version: accountingRules.version,
      effectiveFrom: accountingRules.effectiveFrom, supersedesId: accountingRules.supersedesId,
      active: accountingRules.active, notes: accountingRules.notes,
    }).from(accountingRules)
      .where(and(eq(accountingRules.companyId, companyId),
        eventType ? eq(accountingRules.eventType, eventType) : undefined))
      .orderBy(asc(accountingRules.eventType), asc(accountingRules.code), desc(accountingRules.version))
      .limit(pageSize + 1).offset((page - 1) * pageSize);
    return { items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize };
  });
}

export function getRule(ctx: AccountingContext, ruleId: string) {
  return run(ctx, "read", async (tx, companyId) => {
    const [rule] = await tx.select().from(accountingRules).where(and(
      eq(accountingRules.companyId, companyId), eq(accountingRules.id, z.uuid().parse(ruleId)),
    )).limit(1);
    if (!rule) throw ApiError.notFound("Regla contable no encontrada.");
    return { rule, entries: await listEntriesOf(tx, companyId, rule.id) };
  });
}

function usableAt(account: { accountActive: boolean; accountPostable: boolean; accountValidFrom: string; accountValidTo: string | null }, date: string) {
  return account.accountActive && account.accountPostable
    && account.accountValidFrom <= date && (account.accountValidTo === null || account.accountValidTo >= date);
}

/**
 * Preview for a fact and date: which version applies, which roles resolve and
 * which blockers would stop a posting. Read-only; it never creates a journal.
 */
export function previewRule(ctx: AccountingContext, input: z.input<typeof resolveSchema>) {
  return run(ctx, "read", async (tx, companyId) => {
    const { eventType, date } = resolveSchema.parse(input);
    return resolveRuleIn(tx, companyId, eventType, date);
  });
}

type Entry = Awaited<ReturnType<typeof listEntriesOf>>[number];

export function ruleBlockers(rule: { active: boolean; version: number } | null, entries: Entry[], date: string,
  eventType: string) {
  const blockers: { code: string; role?: string; reason: string }[] = [];
  if (!rule) {
    blockers.push({ code: "RULE_MISSING", reason: `No hay una regla vigente para ${eventType} el ${date}.` });
    return blockers;
  }
  if (!rule.active) blockers.push({ code: "RULE_RETIRED", reason: `La versión ${rule.version} está retirada.` });
  if (entries.length === 0) blockers.push({ code: "RULE_EMPTY", reason: "La regla no tiene cuentas configuradas." });
  for (const entry of entries) {
    if (!entry.required) continue;
    if (!entry.accountActive) blockers.push({ code: "ACCOUNT_INACTIVE", role: entry.role,
      reason: `La cuenta ${entry.accountCode} del rol ${entry.role} está inactiva.` });
    else if (!entry.accountPostable) blockers.push({ code: "ACCOUNT_NOT_POSTABLE", role: entry.role,
      reason: `La cuenta ${entry.accountCode} del rol ${entry.role} es acumulativa.` });
    else if (!usableAt(entry, date)) blockers.push({ code: "ACCOUNT_OUT_OF_RANGE", role: entry.role,
      reason: `La cuenta ${entry.accountCode} del rol ${entry.role} no está vigente el ${date}.` });
  }
  return blockers;
}

/** Latest version of a fact effective at the date, with its resolved entries. */
export async function resolveRuleIn(tx: Tx, companyId: string, eventType: string, date: string) {
  const [rule] = await tx.select().from(accountingRules).where(and(
    eq(accountingRules.companyId, companyId), eq(accountingRules.eventType, eventType),
    lte(accountingRules.effectiveFrom, date),
  )).orderBy(desc(accountingRules.effectiveFrom), desc(accountingRules.version)).limit(1);
  const entries = rule ? await listEntriesOf(tx, companyId, rule.id) : [];
  return { eventType, date, rule: rule ?? null, entries, blockers: ruleBlockers(rule ?? null, entries, date, eventType) };
}

/** One specific frozen version, checked against the journal date. */
export async function describeRuleIn(tx: Tx, companyId: string, ruleId: string, date: string) {
  const [rule] = await tx.select().from(accountingRules).where(and(
    eq(accountingRules.companyId, companyId), eq(accountingRules.id, ruleId),
  )).limit(1);
  if (!rule) return { eventType: null, date, rule: null, entries: [], blockers: [{
    code: "RULE_MISSING", reason: "La regla seleccionada ya no existe en esta empresa.",
  }] };
  const entries = await listEntriesOf(tx, companyId, rule.id);
  const blockers = ruleBlockers(rule, entries, date, rule.eventType);
  if (rule.effectiveFrom > date) blockers.push({ code: "RULE_OUT_OF_RANGE",
    reason: `La regla ${rule.code} no está vigente el ${date}.` });
  return { eventType: rule.eventType, date, rule, entries, blockers };
}

export function ruleBlockerMessage(preview: { blockers: { reason: string }[] }) {
  return preview.blockers.length === 0 ? null : preview.blockers.map(blocker => blocker.reason).join(" ");
}
