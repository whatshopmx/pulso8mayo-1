import { NextRequest } from "next/server";
import { equipmentService } from "@/lib/services/equipment-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenant, requireAuth } from "@/lib/tenant-context";
import { resolveEquipmentScope } from "@/lib/equipment/scope";
import { z } from "zod";

const createWarrantySchema = z.object({
  warrantyNumber: z.string().optional(),
  warrantyType: z.string().optional(),
  provider: z.string().min(1),
  providerContact: z.string().optional(),
  providerPhone: z.string().optional(),
  providerEmail: z.string().optional(),
  coverageDescription: z.string().optional(),
  warrantyTerms: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  maxClaims: z.number().optional(),
  warrantyDocumentUrl: z.string().optional(),
  purchaseReceiptUrl: z.string().optional(),
  alertDaysBefore: z.number().optional(),
});

/**
 * Garantías de un equipo.
 *
 * Las garantías son un recurso del expediente, no una tabla suelta: se cuelgan
 * de un equipo y heredan su frontera. Las dos rutas empiezan por
 * `getEquipmentInScope`, así que un `equipmentId` de otra empresa responde 404 y
 * uno de otra sucursal de la misma empresa responde 403 — antes se listaban y se
 * creaban garantías sobre cualquier equipo con sólo tener su id.
 *
 * La lista lleva además la empresa en su propio `WHERE` (dos capas para el mismo
 * hueco); al crear, el `equipmentId` que se guarda es el del equipo ya validado,
 * no el del URL.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();
    const { id } = await params;
    
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const scope = resolveEquipmentScope(user.role, user.branchId ?? null, tenant.branchId ?? null);

    const equipment = await equipmentService.getEquipmentInScope({
      equipmentId: id,
      companyId: tenant.id,
      scope,
    });

    const warranties = await equipmentService.getWarrantiesByEquipment(equipment.id, tenant.id);
    
    return ApiHandler.success(warranties);
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireAuth();
    const tenant = await requireTenant();
    const { id } = await params;
    
    if (!tenant.id) {
      return ApiHandler.error(new Error("Unauthorized"), 401);
    }

    const scope = resolveEquipmentScope(user.role, user.branchId ?? null, tenant.branchId ?? null);

    // La guarda va antes de leer el cuerpo: rechazar por validación primero
    // confirmaría que el equipo existe aunque no sea tuyo.
    const equipment = await equipmentService.getEquipmentInScope({
      equipmentId: id,
      companyId: tenant.id,
      scope,
    });

    const body = await req.json();
    const data = createWarrantySchema.parse(body);

    const warranty = await equipmentService.createWarranty(
      {
        equipmentId: equipment.id,
        companyId: tenant.id,
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      },
      tenant.userId
    );
    
    return ApiHandler.success(warranty, 201);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
