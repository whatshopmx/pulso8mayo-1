import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  createPayee,
  deactivatePayee,
  listPayees,
} from "@/lib/services/payee-service";

/**
 * GET /api/finance/payees — catálogo de contrapartes de la empresa.
 *
 * Filtros: `search` (nombre/RFC/contacto/correo/teléfono, ILIKE) y `active`
 * (`active=false` para incluir las dadas de baja; por defecto solo activas,
 * que es lo que necesita el form de gasto).
 */
export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const includeInactive = searchParams.get("active") === "false";

    const payees = await listPayees(tenant.id, { search, includeInactive });
    return ApiHandler.success(payees);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

const payeeSchema = z.object({
  name: z.string().trim().min(1, "El nombre de la contraparte es obligatorio."),
  taxId: z.string().trim().optional().nullable(),
  contactName: z.string().trim().optional().nullable(),
  email: z
    .union([z.string().trim().email("El correo no es válido."), z.literal("")])
    .optional()
    .nullable(),
  phone: z.string().trim().optional().nullable(),
});

/**
 * POST /api/finance/payees — crea una contraparte.
 *
 * Requiere sesión (para auditar quién crea) y tenant (para saber a qué empresa
 * pertenece). El RFC es opcional a propósito: un plomero o una ferretería que
 * no emiten CFDI son contrapartes legítimas de gasto.
 */
export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }
    const { user } = await requireAuth();

    const body = await req.json();
    const data = payeeSchema.parse(body);

    const payee = await createPayee({
      companyId: tenant.id,
      branchId: tenant.branchId ?? null,
      performedBy: user.id,
      name: data.name,
      taxId: data.taxId || null,
      contactName: data.contactName || null,
      email: data.email || null,
      phone: data.phone || null,
    });

    return ApiHandler.success(payee, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}