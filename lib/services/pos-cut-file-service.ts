import { and, eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/db/tenant-context";
import { withPosFileContext } from "@/lib/db/pos-file-runtime";

/** Scope recibido de la sesión/guardias, nunca del contenido de la referencia. */
export async function readPosCutFileRecord(scope: TenantScope, cutId: string, client?: typeof db) {
  return withPosFileContext(scope, async tx => {
    const conditions = [eq(dailySalesCuts.companyId, scope.companyId), eq(dailySalesCuts.id, cutId)];
    if (scope.branchId) conditions.push(eq(dailySalesCuts.branchId, scope.branchId));
    const [cut] = await tx.select({ id: dailySalesCuts.id, branchId: dailySalesCuts.branchId,
      businessDate: dailySalesCuts.businessDate, rawFileUrl: dailySalesCuts.rawFileUrl })
      .from(dailySalesCuts).where(and(...conditions)).limit(1);
    return cut;
  }, client);
}

export async function linkPosCutFileRecord(
  scope: TenantScope & { branchId: string; businessDate: string },
  reference: string,
  notes: string,
  client?: typeof db,
) {
  return withPosFileContext(scope, tx => tx.update(dailySalesCuts).set({
    rawFileUrl: reference, validationNotes: notes, updatedAt: new Date(),
  }).where(and(eq(dailySalesCuts.companyId, scope.companyId), eq(dailySalesCuts.branchId, scope.branchId),
    eq(dailySalesCuts.businessDate, scope.businessDate))).returning({ id: dailySalesCuts.id }), client);
}
