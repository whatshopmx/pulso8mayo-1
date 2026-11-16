import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import type { Role } from "@/lib/permissions";
import { isBranchScopedRole } from "@/lib/branch-scope";
import { parseOperatingCfdi } from "./operating-cfdi-parser";

export const OPERATING_CFDI_ROLES = ["SUPER_ADMIN", "OWNER", "ADMIN", "GERENTE", "SUPERVISOR"] as const;
export interface OperatingCfdiActor {
  userId: string; companyId: string; role: Role; assignedBranchId?: string | null;
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/** Contexto de sesión resuelto en servidor; nunca se construye con el formulario. */
export function assertOperatingCfdiAccess(actor: OperatingCfdiActor) {
  if (!actor.userId || !actor.companyId || !OPERATING_CFDI_ROLES.some(role => role === actor.role)) {
    throw ApiError.forbidden("No tienes permiso para cargar CFDI de gastos operativos.");
  }
  if (isBranchScopedRole(actor.role) && !actor.assignedBranchId) {
    throw ApiError.forbidden("Tu usuario no tiene una sucursal asignada.");
  }
}

/** Solo lee empresa/sucursal. No resuelve proveedores, OC, productos ni obligaciones. */
export async function previewOperatingCfdi(actor: OperatingCfdiActor, input: { xml: string; branchId: string }) {
  assertOperatingCfdiAccess(actor);
  if (!uuid.test(input.branchId) || !uuid.test(actor.companyId)) throw ApiError.badRequest("La empresa o sucursal no tiene un identificador válido.");
  const branchId = input.branchId.toLowerCase();
  if (isBranchScopedRole(actor.role) && actor.assignedBranchId?.toLowerCase() !== branchId) {
    throw ApiError.forbidden("No tienes permiso para cargar CFDI en esa sucursal.");
  }
  const [companyRows, branchRows] = await Promise.all([
    db.select({ taxId: companies.taxId }).from(companies).where(eq(companies.id, actor.companyId)).limit(1),
    db.select({ id: branches.id }).from(branches).where(and(
      eq(branches.id, branchId), eq(branches.companyId, actor.companyId), eq(branches.active, true),
    )).limit(1),
  ]);
  if (!branchRows.length) throw ApiError.notFound("La sucursal no está disponible para esta empresa.");
  const company = companyRows[0];
  if (!company?.taxId?.trim()) throw ApiError.badRequest("Configura el RFC de la empresa antes de cargar un CFDI.");
  const document = parseOperatingCfdi(input.xml, company.taxId);
  return { ...document, branchId: branchRows[0].id, xmlSha256: createHash("sha256").update(input.xml, "utf8").digest("hex") };
}
