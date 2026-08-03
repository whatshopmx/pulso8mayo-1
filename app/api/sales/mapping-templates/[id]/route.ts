import { NextRequest } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { posMappingTemplates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const updateTemplateSchema = z.object({
  name: z.string().min(1, "El nombre de la plantilla es requerido.").optional(),
  posSystem: z.string().optional().nullable(),
  mapping: z.record(z.string(), z.any()).optional(),
  paymentMethodMapping: z.record(z.string(), z.any()).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { id } = await params;

    const body = await req.json();
    const data = updateTemplateSchema.parse(body);

    if (data.isDefault) {
      await db
        .update(posMappingTemplates)
        .set({ isDefault: false })
        .where(eq(posMappingTemplates.companyId, tenant.id));
    }

    const [updated] = await db
      .update(posMappingTemplates)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posMappingTemplates.id, id),
          eq(posMappingTemplates.companyId, tenant.id)
        )
      )
      .returning();

    if (!updated) {
      throw ApiError.notFound("La plantilla especificada no fue encontrada.");
    }

    return ApiHandler.success(updated);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { id } = await params;

    const [deleted] = await db
      .delete(posMappingTemplates)
      .where(
        and(
          eq(posMappingTemplates.id, id),
          eq(posMappingTemplates.companyId, tenant.id)
        )
      )
      .returning();

    if (!deleted) {
      throw ApiError.notFound("La plantilla especificada no fue encontrada.");
    }

    return ApiHandler.success({ message: "Plantilla eliminada correctamente." });
  } catch (error) {
    return ApiHandler.error(error);
  }
}
