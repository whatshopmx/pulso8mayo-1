import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { PrepListService, PrepListError } from "@/lib/services/prep-list-service";

/**
 * Task 6 (plan-loteprod-gaps §6.2) — completar una línea de la prep list.
 *
 * Es el único punto de la hoja que MUEVE INVENTARIO: dispara la producción real
 * (explosión de receta → FEFO → `recordProduction` → merma por lote
 * insuficiente). Por eso vive en su propia ruta y no en el PATCH de la hoja:
 * marcar un checkbox que descuenta lotes no puede confundirse con corregir la
 * hora límite.
 *
 * Códigos estables en `error.details.code`: `PrepListErrorCode` +
 * `BRANCH_REQUIRED` / `ORDER_REQUIRED`.
 */
export const POST = withTenantAuth(async (req: NextRequest, { auth }) => {
    const body = await req.json().catch(() => ({}));

    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    if (!orderId) throw ApiError.badRequest("Falta la línea a completar", { code: "ORDER_REQUIRED" });

    const alcance = resolveBranchScope(
        ((auth.user as { role?: string }).role ?? "ADMIN") as never,
        auth.user.branchId ?? null,
        typeof body.branchId === "string" ? body.branchId : null
    );
    if (alcance.kind !== "BRANCH") {
        throw ApiError.badRequest("Selecciona una sucursal para completar la línea", {
            code: "BRANCH_REQUIRED",
        });
    }
    const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, alcance.branchId), eq(branches.companyId, auth.tenantId)))
        .limit(1);
    if (!branch) throw ApiError.notFound("Sucursal no encontrada");

    // Sin cantidad se produce lo planeado. Con ella, manda lo realmente hecho:
    // la hoja del manual planea 12 kg pero la cocina cierra con lo que salió.
    let producedQuantity: number | undefined;
    if (body.producedQuantity !== undefined && body.producedQuantity !== null && body.producedQuantity !== "") {
        const value = Number(body.producedQuantity);
        if (!Number.isFinite(value) || value <= 0) {
            throw ApiError.badRequest("La cantidad producida debe ser mayor a cero", {
                code: "INVALID_QUANTITY",
            });
        }
        producedQuantity = value;
    }

    try {
        const outcome = await PrepListService.completeLine({
            companyId: auth.tenantId,
            branchId: branch.id,
            orderId,
            userId: auth.user.id,
            producedQuantity,
            notes: typeof body.notes === "string" && body.notes ? body.notes : null,
        });
        return ApiHandler.success(outcome);
    } catch (error) {
        if (error instanceof PrepListError) {
            if (error.code === "ORDER_NOT_FOUND") {
                throw ApiError.notFound(error.message, { code: error.code });
            }
            // ALREADY_COMPLETED es 409: no es un dato mal formado, es una
            // carrera que ya terminó (dos cocineros sobre el mismo checkbox).
            if (error.code === "ALREADY_COMPLETED") {
                throw new ApiError(error.message, 409, { code: error.code });
            }
            throw ApiError.badRequest(error.message, { code: error.code });
        }
        throw error;
    }
});
