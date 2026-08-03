import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  getTenantOperatingConfig,
  upsertTenantOperatingConfig,
} from "@/lib/services/tenant-operating-config-service";

const updateConfigSchema = z.object({
  purchasingStructure: z.enum(["CENTRALIZADA", "POR_SUCURSAL", "HIBRIDO"]).optional(),
  foodProduction: z.enum(["IN_SITU", "COCINA_CENTRAL", "MIXTO"]).optional(),
  treasuryModel: z.enum(["CUENTA_UNICA", "CUENTA_POR_SUCURSAL", "MIXTO"]).optional(),
  supplierPayment: z.enum(["CENTRALIZADO", "POR_SUCURSAL", "HIBRIDO"]).optional(),
  managerAutonomy: z.enum(["ALTA", "MEDIA", "BAJA"]).optional(),
  payrollDispersion: z.enum(["CONSOLIDADA", "POR_RAZON_SOCIAL", "MIXTO"]).optional(),
  tenantType: z.enum(["GRUPO_PROPIO", "MIXTO_FRANQUICIAS"]).optional(),
  managerAuthLimitCents: z.number().int().nonnegative().optional(),
  doubleApprovalThresholdCents: z.number().int().nonnegative().optional(),
  pettyCashLimitCents: z.number().int().nonnegative().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const config = await getTenantOperatingConfig(tenant.id);
    return ApiHandler.success(config);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    if (user.role !== "ADMIN" && user.role !== "OWNER" && user.role !== "SUPER_ADMIN") {
      throw ApiError.forbidden("Solo administradores pueden modificar la configuración del modelo operativo.");
    }

    const body = await req.json();
    const data = updateConfigSchema.parse(body);

    const updated = await upsertTenantOperatingConfig(tenant.id, data);
    return ApiHandler.success(updated);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
