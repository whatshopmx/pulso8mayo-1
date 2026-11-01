import { and, asc, eq, isNull } from "drizzle-orm";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { accountingAccounts, accountingSourceLinks, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";

/** Internal principal supplied by an authenticated server boundary; no public endpoint in FC-05. */
export interface AccountingContext { companyId: string; actorId: string; role: Role }
type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
const day = z.iso.date().refine(value => value >= "0001-01-01", "Fecha inválida.");
const fields = {
  name: z.string().trim().min(1).max(160),
  parentId: z.uuid().nullable().optional(),
  postable: z.boolean().optional(), active: z.boolean().optional(),
  validFrom: day, validTo: day.nullable().optional(),
};
const createSchema = z.object({ ...fields,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/),
  kind: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  normalBalance: z.enum(["DEBIT", "CREDIT"]),
}).strict();
const patchSchema = z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0);
const linkSchema = z.union([
  z.object({ accountId: z.uuid(), costCenterId: z.uuid() }).strict(),
  z.object({ accountId: z.uuid(), bankAccountId: z.uuid() }).strict(),
]);
const pageSchema = z.object({ page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25) }).strict();

function databaseCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
}

async function run<T>(ctx: AccountingContext, operation: (tx: Tx, companyId: string, actorId: string) => Promise<T>) {
  try {
    if (!hasPermission(ctx.role, "settings", "update")) throw ApiError.forbidden("No puedes administrar el catálogo contable.");
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
    if (error instanceof ZodError) throw ApiError.badRequest("Revisa los datos del catálogo contable.");
    const code = databaseCode(error);
    if (code === "23505") throw ApiError.conflict("El código o vínculo ya existe en esta empresa.");
    if (code === "23503") throw ApiError.notFound("La referencia no existe en esta empresa.");
    if (code === "23514") throw ApiError.conflict("Revisa la jerarquía, vigencia y elegibilidad de la cuenta o su origen.");
    if (["40001", "40P01", "0A000"].includes(code ?? "")) throw ApiError.conflict("Repite la operación en una transacción READ COMMITTED.");
    throw ApiError.internal("No se pudo procesar el catálogo contable.");
  }
}

export function createAccount(ctx: AccountingContext, input: z.input<typeof createSchema>) {
  return run(ctx, async (tx, companyId, actorId) => {
    const data = createSchema.parse(input);
    const [row] = await tx.insert(accountingAccounts).values({ ...data, companyId, createdBy: actorId, updatedBy: actorId }).returning();
    return row;
  });
}

/** Identity/type/normal balance are immutable; reparenting is checked atomically in PostgreSQL. */
export function updateAccount(ctx: AccountingContext, id: string, input: z.input<typeof patchSchema>) {
  return run(ctx, async (tx, companyId, actorId) => {
    const data = patchSchema.parse(input);
    const [row] = await tx.update(accountingAccounts).set({ ...data, updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(accountingAccounts.companyId, companyId), eq(accountingAccounts.id, z.uuid().parse(id)))).returning();
    if (!row) throw ApiError.notFound("Cuenta no encontrada.");
    return row;
  });
}

export function linkSource(ctx: AccountingContext, input: z.input<typeof linkSchema>) {
  return run(ctx, async (tx, companyId, actorId) => {
    const data = linkSchema.parse(input);
    const isCenter = "costCenterId" in data;
    const [row] = await tx.insert(accountingSourceLinks).values({ companyId, accountId: data.accountId,
      costCenterId: isCenter ? data.costCenterId : null, bankAccountId: isCenter ? null : data.bankAccountId,
      createdBy: actorId, updatedBy: actorId,
    }).onConflictDoUpdate({
      target: isCenter ? [accountingSourceLinks.companyId, accountingSourceLinks.costCenterId]
        : [accountingSourceLinks.companyId, accountingSourceLinks.bankAccountId],
      set: { accountId: data.accountId, updatedBy: actorId, updatedAt: new Date() },
    }).returning();
    return row;
  });
}

export function listAccounts(ctx: AccountingContext, options: z.input<typeof pageSchema> = {}) {
  return run(ctx, async (tx, companyId) => {
    const { page, pageSize } = pageSchema.parse(options);
    const rows = await tx.select().from(accountingAccounts).where(eq(accountingAccounts.companyId, companyId))
      .orderBy(asc(accountingAccounts.code), asc(accountingAccounts.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
    return { items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize };
  });
}

export function listSourceLinks(ctx: AccountingContext, options: z.input<typeof pageSchema> = {}) {
  return run(ctx, async (tx, companyId) => {
    const { page, pageSize } = pageSchema.parse(options);
    const rows = await tx.select().from(accountingSourceLinks).where(eq(accountingSourceLinks.companyId, companyId))
      .orderBy(asc(accountingSourceLinks.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
    return { items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize };
  });
}
