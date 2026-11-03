import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { branches, financialPeriods, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { resolveBranchScope } from "@/lib/branch-scope";
import { isAccountingPostingEnabled } from "./expense-adapter";

type Tx = Parameters<Parameters<typeof withCompanyContext>[1]>[0];
type Writer = Pick<Tx, "select" | "insert">;
/** The SQL AFTER INSERT trigger persists the fact in this source transaction. */
export async function persistSalesCutInScope<T>(scope: { companyId: string; branchId: string;
  actorId?: string; businessDate: string }, operation: (writer: Writer) => Promise<T>) {
  if (!isAccountingPostingEnabled()) return operation(db);
  const parsed = z.object({ companyId: z.uuid(), branchId: z.uuid(), actorId: z.string().min(1).max(160),
    businessDate: z.iso.date().refine(value => value >= "0001-01-01") }).safeParse(scope);
  if (!parsed.success) throw ApiError.badRequest("La captura contable requiere empresa, sucursal, fecha y actor explícitos.");
  return withCompanyContext(parsed.data, async tx => {
    const [actor] = await tx.select({ role: users.role, branchId: users.branchId }).from(users).where(and(
      eq(users.companyId, scope.companyId), eq(users.id, parsed.data.actorId), eq(users.active, true), isNull(users.deletedAt),
    )).limit(1);
    if (!actor || !["OWNER", "SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"].includes(actor.role)) {
      throw ApiError.forbidden("No tienes permiso para capturar cortes financieros.");
    }
    const branchScope = resolveBranchScope(actor.role, actor.branchId);
    if (branchScope.kind === "NONE" || (branchScope.kind === "BRANCH" && branchScope.branchId !== scope.branchId)) {
      throw ApiError.forbidden("La sucursal no está en tu ámbito.");
    }
    const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(
      eq(branches.companyId, scope.companyId), eq(branches.id, scope.branchId), eq(branches.active, true),
    )).limit(1);
    if (!branch) throw ApiError.notFound("La sucursal no está activa en esta empresa.");
    const [closed] = await tx.select({ id: financialPeriods.id }).from(financialPeriods).where(and(
      eq(financialPeriods.companyId, scope.companyId), eq(financialPeriods.year, Number(scope.businessDate.slice(0, 4))),
      eq(financialPeriods.month, Number(scope.businessDate.slice(5, 7))), eq(financialPeriods.status, "CLOSED"),
    )).limit(1);
    if (closed) throw ApiError.conflict("El periodo está cerrado; no se puede capturar el corte.");
    const readiness = await tx.execute(sql`select exists(select 1 from pg_trigger t
      where t.tgrelid=to_regclass('daily_sales_cuts') and t.tgname='accounting_capture_sales_cut'
        and t.tgfoid=to_regprocedure('accounting_capture_sales_cut()') and t.tgenabled in ('O','A')) as ready`);
    if (readiness.rows[0]?.ready !== true) throw new ApiError("La captura contable aún no está disponible. Revisa la actualización del sistema.", 503);
    await tx.execute(sql`select set_config('app.accounting_posting_enabled', '1', true)`);
    return operation(tx);
  });
}
