import { NextRequest } from "next/server";
import { requirePermissionApi } from "@/lib/rbac/abac";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { TreasuryService } from "@/lib/services/treasury-service";
import { paymentRunStatusEnum } from "@/lib/db/schema";
import { z } from "zod";

const updateStatusSchema = z.object({
  status: z.enum(paymentRunStatusEnum.enumValues),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const paymentRunId = id;

    // La autorización va **antes** de leer la corrida: consultarla primero para
    // luego comprobar el tenant le confirmaba a cualquier sesión si un id de
    // corrida existe. Ahora el servicio filtra por `companyId` en la misma
    // consulta y devuelve el mismo 404 para "no existe" y "no es tuya".
    const { ctx } = await requirePermissionApi("reports", "update", {
      classification: "FINANCIAL",
      audit: { action: "UPDATE", req },
    });

    if (!ctx.userCompanyId) {
      return ApiHandler.error(ApiError.forbidden("No hay una empresa asignada a tu usuario."));
    }

    const body = await req.json();
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsed.success) {
      return ApiHandler.error(ApiError.badRequest("Estado inválido."));
    }

    const { status } = parsed.data;

    // C18 — el filtro de rol se aplica en el servicio, con `actorRole` de la
    // sesión. Aquí la comprobación era la única puerta y quedaba en el cuerpo
    // de la ruta: cualquier otra entrada al servicio la saltaba. Esta sigue
    // siendo la segunda red, no la primera.
    const updatedRun = await TreasuryService.updatePaymentRunStatus(
      paymentRunId,
      ctx.userCompanyId,
      status,
      ctx.userId,
      ctx.userRole
    );

    return ApiHandler.success(updatedRun);
  } catch (error: any) {
    if (error.message === "Payment run not found") {
      return ApiHandler.error(ApiError.notFound("Corrida de pago no encontrada."));
    }
    if (error instanceof ApiError) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
