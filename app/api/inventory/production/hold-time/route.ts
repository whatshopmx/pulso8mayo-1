import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { HoldTimeService } from "@/lib/services/hold-time-service";
import { HOLD_TIME_WARNING_MINUTES } from "@/lib/inventory/hold-time";

/**
 * Task 5 (plan-loteprod-gaps §6.4) — tablero "en línea" y confirmación de
 * descarte por tiempo de retención.
 *
 * Códigos de error estables (la UI lee `error.details.code`, nunca el texto):
 * los de `HoldTimeDiscardErrorCode` más `BRANCH_REQUIRED`. Mismo contrato que
 * el módulo de mermas.
 */

/**
 * Sucursal efectiva. El tablero es POR SUCURSAL: una tanda vencida es una
 * acción física en una línea concreta, así que "todas" no aplica.
 * GERENTE/SUPERVISOR quedan clavados a la suya vía `resolveBranchScope`; una
 * sucursal de otro tenant es 404, no 403, para no filtrar existencia.
 */
async function resolveBranch(
    tenantId: string,
    role: string,
    userBranchId: string | null,
    requestedBranchId: string | null
): Promise<string> {
    const alcance = resolveBranchScope(role as never, userBranchId, requestedBranchId);

    if (alcance.kind !== "BRANCH") {
        // ALL (admin sin sucursal pedida) y NONE (rol de sucursal sin sucursal
        // asignada) caen aquí: en ambos casos no hay línea que mostrar.
        throw ApiError.badRequest("Selecciona una sucursal para el tablero en línea", {
            code: "BRANCH_REQUIRED",
        });
    }

    const [branch] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, alcance.branchId), eq(branches.companyId, tenantId)))
        .limit(1);
    if (!branch) throw ApiError.notFound("Sucursal no encontrada");

    return branch.id;
}

/**
 * GET /api/inventory/production/hold-time?branchId=…&warningMinutes=…
 * Tandas por vencer y vencidas sin tirar de una sucursal.
 */
export const GET = withTenantAuth(async (req: NextRequest, { auth }) => {
    const { searchParams } = new URL(req.url);
    const branchId = await resolveBranch(
        auth.tenantId,
        (auth.user as { role?: string }).role ?? "ADMIN",
        auth.user.branchId ?? null,
        searchParams.get("branchId")
    );

    const rawWarning = Number(searchParams.get("warningMinutes"));
    const warningMinutes =
        Number.isFinite(rawWarning) && rawWarning > 0 && rawWarning <= 240
            ? Math.floor(rawWarning)
            : HOLD_TIME_WARNING_MINUTES;

    const board = await HoldTimeService.getBoard({
        companyId: auth.tenantId,
        branchId,
        warningMinutes,
    });

    return ApiHandler.success({ ...board, branchId, warningMinutes });
});

/**
 * POST /api/inventory/production/hold-time
 * Body: { resultId, discardedQuantity, branchId?, notes? }
 *
 * Confirma cuánto se tiró de una tanda vencida. `discardedQuantity: 0` es una
 * respuesta legítima ("alcanzó a venderse"): cierra la tanda sin merma.
 */
export const POST = withTenantAuth(async (req: NextRequest, { auth }) => {
    const body = await req.json().catch(() => ({}));

    const resultId = typeof body.resultId === "string" ? body.resultId : "";
    if (!resultId) throw ApiError.badRequest("Falta la tanda a confirmar");

    const discardedQuantity = Number(body.discardedQuantity);
    if (!Number.isFinite(discardedQuantity) || discardedQuantity < 0) {
        throw ApiError.badRequest("Cantidad inválida", { code: "INVALID_QUANTITY" });
    }

    const branchId = await resolveBranch(
        auth.tenantId,
        (auth.user as { role?: string }).role ?? "ADMIN",
        auth.user.branchId ?? null,
        typeof body.branchId === "string" ? body.branchId : null
    );

    const outcome = await HoldTimeService.confirmDiscard({
        companyId: auth.tenantId,
        branchId,
        resultId,
        discardedQuantity,
        recordedBy: auth.user.id,
        notes: typeof body.notes === "string" && body.notes ? body.notes : null,
    });

    if (!outcome.ok) {
        // `strict: false` no estrecha uniones por discriminante booleano
        // (tsconfig del repo): la rama de error se acota a mano.
        const fail = outcome as Extract<typeof outcome, { ok: false }>;

        if (fail.code === "RESULT_NOT_FOUND") {
            throw ApiError.notFound(fail.message, { code: fail.code });
        }
        // ALREADY_DISCARDED es 409: no es un dato mal formado, es una carrera
        // que ya terminó (el cron o el propio doble clic la cerró antes).
        if (fail.code === "ALREADY_DISCARDED") {
            throw new ApiError(fail.message, 409, { code: fail.code });
        }
        throw ApiError.badRequest(fail.message, { code: fail.code });
    }

    return ApiHandler.success({
        resultId,
        discardedQuantity: outcome.discardedQuantity,
        wasteId: outcome.wasteId,
    });
});
