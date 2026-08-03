import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { posMappingTemplates, users } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

const createTemplateSchema = z.object({
  name: z.string().min(1, "El nombre de la plantilla es requerido."),
  posSystem: z.string().optional().nullable(),
  mapping: z.record(z.string(), z.any()),
  paymentMethodMapping: z.record(z.string(), z.any()).optional().nullable(),
  isDefault: z.boolean().default(false),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

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
      .where(eq(posMappingTemplates.companyId, tenant.id))
      .orderBy(desc(posMappingTemplates.isDefault), desc(posMappingTemplates.createdAt));

    return ApiHandler.success(templates);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = createTemplateSchema.parse(body);

    if (data.isDefault) {
      // Unset previous default templates for this tenant
      await db
        .update(posMappingTemplates)
        .set({ isDefault: false })
        .where(eq(posMappingTemplates.companyId, tenant.id));
    }

    const [created] = await db
      .insert(posMappingTemplates)
      .values({
        companyId: tenant.id,
        name: data.name,
        posSystem: data.posSystem || null,
        mapping: data.mapping,
        paymentMethodMapping: data.paymentMethodMapping || null,
        isDefault: data.isDefault,
        createdBy: user.id,
      })
      .returning();

    return ApiHandler.success(created);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
