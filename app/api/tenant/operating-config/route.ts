import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import {
    getTenantOperatingConfig,
    upsertTenantOperatingConfig,
} from "@/lib/services/tenant-config-service";

const dimensionEnums = {
    purchasingStructure: z.enum(["CENTRALIZADA", "POR_SUCURSAL", "HIBRIDO"]),
    foodProduction: z.enum(["IN_SITU", "COCINA_CENTRAL", "MIXTO"]),
    treasuryModel: z.enum(["CUENTA_UNICA", "CUENTA_POR_SUCURSAL", "MIXTO"]),
    supplierPayment: z.enum(["CENTRALIZADO", "POR_SUCURSAL", "HIBRIDO"]),
    managerAutonomy: z.enum(["ALTA", "MEDIA", "BAJA"]),
    payrollDispersion: z.enum(["CONSOLIDADA", "POR_RAZON_SOCIAL", "MIXTO"]),
    tenantType: z.enum(["GRUPO_PROPIO", "MIXTO_FRANQUICIAS"]),
} as const;

// Thresholds are integers in cents; null means "sin tope".
const thresholdSchema = z.number().int().min(0).nullable();

const updateOperatingConfigSchema = z.object({
    ...dimensionEnums,
    managerAuthLimitCents: thresholdSchema,
    doubleApprovalThresholdCents: thresholdSchema,
    pettyCashLimitCents: thresholdSchema,
}).partial();

export async function GET() {
    try {
        const tenant = await requireTenant();
        if (!tenant.id) throw ApiError.badRequest("No hay una empresa seleccionada.");

        const config = await getTenantOperatingConfig(tenant.id);
        return ApiHandler.success(config);
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function PUT(req: NextRequest) {
    try {
        const tenant = await requireTenant();
        const { user } = await requireAuth();
        if (!tenant.id) throw ApiError.badRequest("No hay una empresa seleccionada.");

        // Solo OWNER / ADMIN / SUPER_ADMIN pueden cambiar el modelo operativo
        if (!hasPermission(user.role, "settings", "update")) {
            throw ApiError.forbidden("Solo un administrador u owner puede modificar el modelo operativo.");
        }

        const body = await req.json();
        const data = updateOperatingConfigSchema.parse(body);

        if (Object.keys(data).length === 0) {
            throw ApiError.badRequest("No se enviaron campos para actualizar.");
        }

        const config = await upsertTenantOperatingConfig(tenant.id, data);
        return ApiHandler.success(config);
    } catch (error) {
        return ApiHandler.error(error);
    }
}
