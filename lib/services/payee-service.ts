// Contrapartes (payees) — Fase 1 de `tasks/plan-payees-contrapartes.md`.
//
// `payees` responde "a quién le pagamos" para el dinero que no pasa por el
// inventario: la renta, la luz, el gas, el internet, el contador. Hasta esta
// fase ese dato vivía enterrado en la descripción del gasto y la CxP agrupaba
// por categoría ("RENTA") en vez de por beneficiario real ("Inmobiliaria X").
//
// Reglas de este servicio:
//
//   1. Todo está limitado por empresa: ninguna consulta ni escritura puede
//      cruzar el tenant (patrón de `supplier-bank-account-service.ts` — el
//      cliente no decide la propiedad, el servicio la verifica).
//   2. El nombre es la identidad. "CFE" y "Comisión Federal de Electricidad"
//      son la misma contraparte, así que el duplicado se rechaza
//      case-insensitive (la base lo asegura con el índice único
//      `(company_id, lower(name))`; aquí se devuelve un 400 legible).
//   3. La baja es lógica (`active = false`): los gastos históricos conservan
//      el nombre aunque la contraparte deje de operar.
import { db } from "@/lib/db";
import { payees } from "@/lib/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { AuditService } from "@/lib/services/audit-service";

export interface CreatePayeeInput {
  companyId: string;
  /** Sucursal del operador que crea; se registra en la auditoría, no en el payee. */
  branchId?: string | null;
  name: string;
  taxId?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  performedBy: string;
}

export interface ListPayeesOptions {
  search?: string;
  /** `false` (default) devuelve solo activos — lo que necesita el form de gasto. */
  includeInactive?: boolean;
}

/**
 * Lista las contrapartes de la empresa. Tenant-scoped: `companyId` sale del
 * tenant autenticado, nunca de un parámetro del cliente.
 */
export async function listPayees(companyId: string, opts: ListPayeesOptions = {}) {
  const conditions = [eq(payees.companyId, companyId)];
  if (!opts.includeInactive) {
    conditions.push(eq(payees.active, true));
  }
  const search = opts.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        sql`${payees.name} ILIKE ${pattern}`,
        sql`${payees.taxId} ILIKE ${pattern}`,
        sql`${payees.contactName} ILIKE ${pattern}`,
        sql`${payees.email} ILIKE ${pattern}`,
        sql`${payees.phone} ILIKE ${pattern}`,
      ),
    );
  }

  return db
    .select()
    .from(payees)
    .where(and(...conditions))
    .orderBy(desc(payees.createdAt));
}

/**
 * Verifica que un payee exista y pertenezca a la empresa. Devuelve `null` si
 * no — el llamador decide si es un 400 (payload inválido) o un 404 (recurso
 * inexistente). Nunca filtra: si el payee es de otra empresa, no existe.
 */
export async function getPayeeForCompany(companyId: string, payeeId: string) {
  const [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, payeeId), eq(payees.companyId, companyId)))
    .limit(1);
  return payee ?? null;
}

/**
 * Crea una contraparte. Rechaza nombre vacío y duplicado (case-insensitive)
 * con 400 explicativo; el índice único de la base queda como red de seguridad
 * contra la carrera de doble clic.
 */
export async function createPayee(input: CreatePayeeInput) {
  const name = input.name.trim();
  if (!name) {
    throw ApiError.badRequest("El nombre de la contraparte es obligatorio.");
  }

  const [existing] = await db
    .select({ id: payees.id })
    .from(payees)
    .where(
      and(
        eq(payees.companyId, input.companyId),
        sql`lower(${payees.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (existing) {
    throw ApiError.badRequest(
      `Ya existe una contraparte llamada "${name}". Búscala en el catálogo o usa un nombre distinto.`,
    );
  }

  let payee;
  try {
    [payee] = await db
      .insert(payees)
      .values({
        companyId: input.companyId,
        name,
        taxId: input.taxId?.trim() || null,
        contactName: input.contactName?.trim() || null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
      })
      .returning();
  } catch (error) {
    // El índice `(company_id, lower(name))` es la red de seguridad para la
    // carrera: si llegó hasta aquí es porque dos llamadas crearon el mismo
    // nombre casi al mismo tiempo. Se devuelve el mismo 400 legible.
    if (
      error instanceof Error &&
      (error as any).code === "23505" &&
      String((error as any).detail ?? "").includes("payees_company_name_unique")
    ) {
      throw ApiError.badRequest(
        `Ya existe una contraparte llamada "${name}". Búscala en el catálogo o usa un nombre distinto.`,
      );
    }
    throw error;
  }

  await AuditService.logInventoryAction({
    companyId: input.companyId,
    branchId: input.branchId ?? "",
    action: "CREATE",
    entityType: "PAYEE",
    entityId: payee.id,
    newValue: {
      name: payee.name,
      taxId: payee.taxId,
      contactName: payee.contactName,
      email: payee.email,
      phone: payee.phone,
    },
    performedBy: input.performedBy,
    reason: "Contraparte creada",
  });

  return payee;
}

/**
 * Baja lógica: `active = false`. Los gastos históricos que la referencian no
 * se tocan — el nombre que congelaron sigue siendo el que se muestra.
 */
export async function deactivatePayee(
  companyId: string,
  payeeId: string,
  performedBy: string,
  branchId?: string | null,
) {
  const [current] = await db
    .select({ id: payees.id, active: payees.active })
    .from(payees)
    .where(and(eq(payees.id, payeeId), eq(payees.companyId, companyId)))
    .limit(1);

  if (!current) {
    throw ApiError.notFound("La contraparte no existe en esta empresa.");
  }
  if (!current.active) {
    throw ApiError.badRequest("La contraparte ya está dada de baja.");
  }

  const [updated] = await db
    .update(payees)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(payees.id, payeeId), eq(payees.companyId, companyId)))
    .returning();

  await AuditService.logInventoryAction({
    companyId,
    branchId: branchId ?? "",
    action: "UPDATE",
    entityType: "PAYEE",
    entityId: payeeId,
    oldValue: { active: true },
    newValue: { active: false },
    performedBy,
    reason: "Contraparte dada de baja",
  });

  return updated;
}