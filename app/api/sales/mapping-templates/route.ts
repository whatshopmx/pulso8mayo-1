import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { db } from "@/lib/db";
import { posMappingTemplates, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Mismos roles que el resto de Ventas y Finanzas: `EMPLEADO` y `READONLY`
 * quedan fuera. La razón está escrita en `app/api/sales/cuts/route.ts`.
 */
const ROLES_VENTAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const createTemplateSchema = z.object({
  name: z.string().min(1, "El nombre de la plantilla es requerido."),
  posSystem: z.string().optional().nullable(),
  mapping: z.record(z.string(), z.any()),
  paymentMethodMapping: z.record(z.string(), z.any()).optional().nullable(),
  isDefault: z.boolean().default(false),
});

export const GET = withRoleAuth([...ROLES_VENTAS], async (req, { auth }) => {
  try {
    const templates = await db
      .select({
        id: posMappingTemplates.id,
        companyId: posMappingTemplates.companyId,
        name: posMappingTemplates.name,
        posSystem: posMappingTemplates.posSystem,
        mapping: posMappingTemplates.mapping,
        paymentMethodMapping: posMappingTemplates.paymentMethodMapping,
        isDefault: posMappingTemplates.isDefault,
        createdByName: users.name,
        createdAt: posMappingTemplates.createdAt,
        updatedAt: posMappingTemplates.updatedAt,
      })
      .from(posMappingTemplates)
      .leftJoin(users, eq(posMappingTemplates.createdBy, users.id))
      .where(eq(posMappingTemplates.companyId, auth.tenantId))
      .orderBy(desc(posMappingTemplates.isDefault), desc(posMappingTemplates.createdAt));

    return ApiHandler.success(templates);
  } catch (error) {
    return ApiHandler.error(error);
  }
});

export const POST = withRoleAuth([...ROLES_VENTAS], async (req, { auth }) => {
  try {
    const body = await req.json();
    const data = createTemplateSchema.parse(body);

    if (data.isDefault) {
      // Unset previous default templates for this tenant
      await db
        .update(posMappingTemplates)
        .set({ isDefault: false })
        .where(eq(posMappingTemplates.companyId, auth.tenantId));
    }

    const [created] = await db
      .insert(posMappingTemplates)
      .values({
        companyId: auth.tenantId,
        name: data.name,
        posSystem: data.posSystem || null,
        mapping: data.mapping,
        paymentMethodMapping: data.paymentMethodMapping || null,
        isDefault: data.isDefault,
        createdBy: auth.user.id,
      })
      .returning();

    return ApiHandler.success(created);
  } catch (error) {
    return ApiHandler.error(error);
  }
});
