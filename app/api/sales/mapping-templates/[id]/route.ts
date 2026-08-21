import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { posMappingTemplates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Plantillas de mapeo POS: cómo se ingesta la venta.
 *
 * A2 cerró `/dashboard/sales/mapping` y la ruta de colección, pero **esta se
 * quedó abierta**: un EMPLEADO no podía crear una plantilla y sí podía editar o
 * borrar la que ya existía. Es la superficie más apalancada del módulo — no lees
 * el dinero, defines cómo se cuenta.
 *
 * Misma lista que `ROLES_VENTAS` en `app/api/sales/cuts/route.ts`, donde está la
 * justificación completa.
 */
const ROLES_VENTAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const updateTemplateSchema = z.object({
  name: z.string().min(1, "El nombre de la plantilla es requerido.").optional(),
  posSystem: z.string().optional().nullable(),
  mapping: z.record(z.string(), z.any()).optional(),
  paymentMethodMapping: z.record(z.string(), z.any()).optional().nullable(),
  isDefault: z.boolean().optional(),
});

export const PUT = withRoleAuth([...ROLES_VENTAS], async (req, { params, auth }) => {
  // El `try/catch` se conserva dentro del wrapper: `withRoleAuth` traduce
  // `ApiError`, pero un `ZodError` caería a 500 y aquí ya devolvía 400.
  try {
    const { id } = await params;

    const body = await req.json();
    const data = updateTemplateSchema.parse(body);

    // Los dos pasos van en una transacción (A14). Sin ella, marcar como default
    // una plantilla que no existe dejaba a la empresa **sin ninguna**: el primer
    // UPDATE limpiaba el `isDefault` de todas, el segundo no encontraba fila y
    // el `throw` salía con el borrado ya comprometido. Sin plantilla default se
    // cae la autodetección de archivos POS, que es de lo que vive la ingesta.
    const updated = await db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx
          .update(posMappingTemplates)
          .set({ isDefault: false })
          .where(eq(posMappingTemplates.companyId, auth.tenantId));
      }

      const [fila] = await tx
        .update(posMappingTemplates)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posMappingTemplates.id, id),
            eq(posMappingTemplates.companyId, auth.tenantId)
          )
        )
        .returning();

      if (!fila) {
        // Dentro de la transacción: deshace también el `isDefault` limpiado.
        throw ApiError.notFound("La plantilla especificada no fue encontrada.");
      }

      return fila;
    });

    return ApiHandler.success(updated);
  } catch (error) {
    return ApiHandler.error(error);
  }
});

export const DELETE = withRoleAuth([...ROLES_VENTAS], async (_req, { params, auth }) => {
  try {
    const { id } = await params;

    const [deleted] = await db
      .delete(posMappingTemplates)
      .where(
        and(
          eq(posMappingTemplates.id, id),
          eq(posMappingTemplates.companyId, auth.tenantId)
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
});
