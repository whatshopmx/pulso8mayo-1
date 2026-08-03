import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  calculatePropinasDistribution,
  getPropinasHistory,
} from "@/lib/services/propinas-service";

const createPropinasSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  shift: z.enum(["MATUTINO", "VESPERTINO", "COMPLETO"]),
  totalPoolCents: z.number().int().positive("El pozo de propinas debe ser mayor a cero."),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") || undefined;

    const history = await getPropinasHistory(tenant.id, branchId);
    return ApiHandler.success(history);
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
    const data = createPropinasSchema.parse(body);

    const result = await calculatePropinasDistribution({
      companyId: tenant.id,
      branchId: data.branchId,
      businessDate: data.businessDate,
      shift: data.shift,
      totalPoolCents: data.totalPoolCents,
      registeredBy: user.id,
    });

    return ApiHandler.success(result);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
