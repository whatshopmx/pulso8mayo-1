import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { PrepListService, PrepListError } from "@/lib/services/prep-list-service";
import { normalizeDeadlineTime, normalizeStation, PREP_SHIFT_LABELS } from "@/lib/inventory/prep-list";

/**
 * Task 6 (plan-loteprod-gaps §6.2) — Hoja de Producción Diaria.
 *
 * Códigos de error estables (la UI lee `error.details.code`, nunca el texto):
 * los de `PrepListErrorCode` más `BRANCH_REQUIRED`, `INVALID_DATE`,
 * `INVALID_DEADLINE` e `INVALID_SHIFT`. Mismo contrato que el tablero de §6.4.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sucursal efectiva. La hoja es POR SUCURSAL: una estación y un turno son
 * físicos, así que "todas" no aplica. GERENTE/SUPERVISOR quedan clavados a la
 * suya; una sucursal de otro tenant es 404, no 403, para no filtrar existencia.
 */
async function resolveBranch(
    tenantId: string,
    role: string,
    userBranchId: string | null,
    requestedBranchId: string | null
): Promise<string> {
    const alcance = resolveBranchScope(role as never, userBranchId, requestedBranchId);

    if (alcance.kind !== "BRANCH") {
        throw ApiError.badRequest("Selecciona una sucursal para ver la prep list", {
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

/** "HH:MM" válida, null para borrarla, o 400 con código estable. */
function readDeadline(raw: unknown): string | null {
    if (raw === undefined) return null;
    const normalized = normalizeDeadlineTime(typeof raw === "string" ? raw : null);
    if (normalized === undefined) {
        throw ApiError.badRequest("Hora límite inválida (usa HH:MM)", { code: "INVALID_DEADLINE" });
    }
    return normalized;
}

/** Turno del enum `shift_type`, o null. */
function readShift(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === "") return null;
    const value = String(raw).toUpperCase();
    if (!(value in PREP_SHIFT_LABELS)) {
        throw ApiError.badRequest("Turno inválido", { code: "INVALID_SHIFT" });
    }
    return value;
}

/**
 * GET /api/inventory/production/prep-list?branchId=…&date=YYYY-MM-DD
 * La hoja del día agrupada por estación, con el lote FEFO de cada línea.
 */
export const GET = withTenantAuth(async (req: NextRequest, { auth }) => {
    const { searchParams } = new URL(req.url);
    const branchId = await resolveBranch(
        auth.tenantId,
        (auth.user as { role?: string }).role ?? "ADMIN",
        auth.user.branchId ?? null,
        searchParams.get("branchId")
    );

    const rawDate = searchParams.get("date");
    if (rawDate && !DATE_RE.test(rawDate)) {
        throw ApiError.badRequest("Fecha inválida (usa YYYY-MM-DD)", { code: "INVALID_DATE" });
    }

    const day = await PrepListService.getPrepList({
        companyId: auth.tenantId,
        branchId,
        date: rawDate,
    });

    return ApiHandler.success({ ...day, branchId });
});

/**
 * POST /api/inventory/production/prep-list
 * Body: { branchId?, recipeId, plannedQuantity, unit?, date, station?, shift?,
 *         responsibleUserId?, deadlineTime?, notes? }
 *
 * Crea una línea de la hoja. Es una orden de producción con las columnas de
 * §6.2: la orden "suelta" de antes sigue siendo válida y cae en "Sin estación".
 */
export const POST = withTenantAuth(async (req: NextRequest, { auth }) => {
    const body = await req.json().catch(() => ({}));

    const branchId = await resolveBranch(
        auth.tenantId,
        (auth.user as { role?: string }).role ?? "ADMIN",
        auth.user.branchId ?? null,
        typeof body.branchId === "string" ? body.branchId : null
    );

    const recipeId = typeof body.recipeId === "string" ? body.recipeId : "";
    if (!recipeId) throw ApiError.badRequest("Falta la receta", { code: "RECIPE_REQUIRED" });

    const plannedQuantity = Number(body.plannedQuantity);
    if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
        throw ApiError.badRequest("La cantidad a producir debe ser mayor a cero", {
            code: "INVALID_QUANTITY",
        });
    }

    const rawDate = typeof body.date === "string" ? body.date : "";
    if (!rawDate || !DATE_RE.test(rawDate)) {
        throw ApiError.badRequest("Fecha inválida (usa YYYY-MM-DD)", { code: "INVALID_DATE" });
    }

    const order = await PrepListService.createLine({
        companyId: auth.tenantId,
        branchId,
        recipeId,
        plannedQuantity: Math.round(plannedQuantity),
        unit: typeof body.unit === "string" && body.unit ? body.unit : "PORTION",
        // Medianoche UTC: `planned_date` se compara como fecha de calendario
        // (`::date`), nunca como instante — ver el encabezado del servicio.
        plannedDate: new Date(`${rawDate}T00:00:00.000Z`),
        station: normalizeStation(body.station),
        shift: readShift(body.shift),
        responsibleUserId: typeof body.responsibleUserId === "string" && body.responsibleUserId
            ? body.responsibleUserId
            : null,
        deadlineTime: readDeadline(body.deadlineTime),
        notes: typeof body.notes === "string" && body.notes ? body.notes : null,
        createdBy: auth.user.id,
    });

    return ApiHandler.success({ order });
});

/**
 * PATCH /api/inventory/production/prep-list
 * Body: { orderId, branchId?, station?, shift?, responsibleUserId?, deadlineTime?,
 *         plannedQuantity?, notes? }
 *
 * Edita las columnas de la hoja. No toca producción ya registrada: completar es
 * la otra ruta.
 */
export const PATCH = withTenantAuth(async (req: NextRequest, { auth }) => {
    const body = await req.json().catch(() => ({}));

    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    if (!orderId) throw ApiError.badRequest("Falta la línea a editar", { code: "ORDER_REQUIRED" });

    const branchId = await resolveBranch(
        auth.tenantId,
        (auth.user as { role?: string }).role ?? "ADMIN",
        auth.user.branchId ?? null,
        typeof body.branchId === "string" ? body.branchId : null
    );

    // Sólo se escribe lo que vino en el body: un PATCH sin `station` no la borra.
    const patch: Parameters<typeof PrepListService.updateLine>[0]["patch"] = {};
    if ("station" in body) patch.station = normalizeStation(body.station);
    if ("shift" in body) patch.shift = readShift(body.shift);
    if ("responsibleUserId" in body) {
        patch.responsibleUserId = typeof body.responsibleUserId === "string" && body.responsibleUserId
            ? body.responsibleUserId
            : null;
    }
    if ("deadlineTime" in body) patch.deadlineTime = readDeadline(body.deadlineTime);
    if ("status" in body && typeof body.status === "string") {
        patch.status = body.status as never;
    }
    if ("notes" in body) {
        patch.notes = typeof body.notes === "string" && body.notes ? body.notes : null;
    }
    if ("plannedQuantity" in body) {
        const quantity = Number(body.plannedQuantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw ApiError.badRequest("La cantidad a producir debe ser mayor a cero", {
                code: "INVALID_QUANTITY",
            });
        }
        patch.plannedQuantity = Math.round(quantity);
    }

    if (Object.keys(patch).length === 0) {
        throw ApiError.badRequest("Nada que actualizar", { code: "EMPTY_PATCH" });
    }

    try {
        const order = await PrepListService.updateLine({
            companyId: auth.tenantId,
            branchId,
            orderId,
            patch,
        });
        return ApiHandler.success({ order });
    } catch (error) {
        if (error instanceof PrepListError) {
            throw ApiError.notFound(error.message, { code: error.code });
        }
        throw error;
    }
});
